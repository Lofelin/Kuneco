package server

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"
)

type Config struct {
	PublicURL, GoogleClientID, GoogleClientSecret string
	TrustedProxies                                []netip.Prefix
}
type Flow struct {
	ID, State, Challenge, Verifier, Nonce, IP, PeerIP, IPSource, Agent, Token, Failure, ReturnURL string
	User                                                                                          *User
	Expires                                                                                       time.Time
	Started, Consumed                                                                             bool
}
type Server struct {
	cfg              Config
	store            *Store
	mu               sync.Mutex
	passwordAttempts map[string][]time.Time
	flows            map[string]*Flow
	client           *http.Client
	Authenticate     func(context.Context, string, *Flow) (User, error)
}

func New(cfg Config, store *Store) *Server {
	s := &Server{cfg: cfg, store: store, flows: map[string]*Flow{}, client: &http.Client{Timeout: 15 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	s.Authenticate = s.googleIdentity
	return s
}
func response(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}
func failure(w http.ResponseWriter, status int, message string) {
	response(w, status, map[string]string{"error": message})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 16384)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if d.Decode(v) != nil {
		failure(w, 400, "请求格式无效")
		return false
	}
	if d.Decode(&struct{}{}) != io.EOF {
		failure(w, 400, "请求格式无效")
		return false
	}
	return true
}
func challenge(value string) string {
	sum := sha256.Sum256([]byte(value))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
func equal(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }
func (s *Server) oauth() oauth2.Config {
	return oauth2.Config{ClientID: s.cfg.GoogleClientID, ClientSecret: s.cfg.GoogleClientSecret, RedirectURL: s.cfg.PublicURL + "/v1/auth/google/callback", Scopes: []string{"openid", "email", "profile"}, Endpoint: oauth2.Endpoint{AuthURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token"}}
}
func (s *Server) googleIdentity(ctx context.Context, code string, f *Flow) (User, error) {
	cfg := s.oauth()
	ctx = context.WithValue(ctx, oauth2.HTTPClient, s.client)
	token, err := cfg.Exchange(ctx, code, oauth2.VerifierOption(f.Verifier))
	if err != nil {
		return User{}, err
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok {
		return User{}, errors.New("missing ID token")
	}
	verifier := oidc.NewVerifier("https://accounts.google.com", oidc.NewRemoteKeySet(ctx, "https://www.googleapis.com/oauth2/v3/certs"), &oidc.Config{ClientID: s.cfg.GoogleClientID})
	verified, err := verifier.Verify(ctx, raw)
	if err != nil {
		return User{}, err
	}
	var claims struct {
		Sub, Email, Name, Picture, Locale, Nonce string
		Verified                                 bool `json:"email_verified"`
	}
	if err = verified.Claims(&claims); err != nil || !equal(claims.Nonce, f.Nonce) || claims.Sub == "" || !claims.Verified {
		return User{}, errors.New("invalid verified identity")
	}
	return User{GoogleSub: claims.Sub, Email: claims.Email, EmailVerified: claims.Verified, Name: claims.Name, AvatarURL: claims.Picture, Locale: claims.Locale}, nil
}
func (s *Server) trusted(ip netip.Addr) bool {
	for _, prefix := range s.cfg.TrustedProxies {
		if prefix.Contains(ip) {
			return true
		}
	}
	return false
}
func (s *Server) peer(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
func (s *Server) clientIP(r *http.Request) string {
	peer := s.peer(r)
	addr, err := netip.ParseAddr(peer)
	if err != nil || !s.trusted(addr) {
		return peer
	}
	chain := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(chain) - 1; i >= 0; i-- {
		value := strings.TrimSpace(chain[i])
		ip, err := netip.ParseAddr(value)
		if err != nil {
			return peer
		}
		if !s.trusted(ip) {
			return value
		}
	}
	return peer
}
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if s.store.DB.PingContext(ctx) != nil {
			response(w, 503, map[string]any{"ok": false, "database": "postgresql"})
			return
		}
		response(w, 200, map[string]any{"ok": true, "database": "postgresql", "googleConfigured": s.cfg.GoogleClientID != "" && s.cfg.GoogleClientSecret != ""})
	})
	mux.HandleFunc("POST /v1/auth/password", s.passwordLogin)
	mux.HandleFunc("POST /v1/auth/google/start", s.start)
	mux.HandleFunc("GET /v1/auth/google/authorize", s.authorize)
	mux.HandleFunc("GET /v1/auth/google/callback", s.callback)
	mux.HandleFunc("POST /v1/auth/google/poll", s.poll)
	mux.HandleFunc("PUT /v1/me/profile", s.authorized(s.updateProfile))
	mux.HandleFunc("GET /v1/me/browser-settings", s.authorized(s.browserSettingsRead))
	mux.HandleFunc("PUT /v1/me/browser-settings", s.authorized(s.browserSettingsWrite))
	mux.HandleFunc("GET /v1/me/browser-cookies", s.authorized(s.cookiesRead))
	mux.HandleFunc("PUT /v1/me/browser-cookies", s.authorized(s.cookiesWrite))
	mux.HandleFunc("GET /v1/me/runtimes", s.authorized(s.runtimeRead))
	mux.HandleFunc("PUT /v1/me/runtimes", s.authorized(s.runtimeWrite))
	mux.HandleFunc("DELETE /v1/me/local-environment", s.authorized(s.localEnvironmentDelete))
	mux.HandleFunc("GET /v1/me", s.authorized(func(w http.ResponseWriter, r *http.Request, u User) { response(w, 200, u) }))
	mux.HandleFunc("POST /v1/auth/logout", s.authorized(func(w http.ResponseWriter, r *http.Request, u User) {
		if s.store.Logout(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")) != nil {
			failure(w, 500, "退出失败")
			return
		}
		response(w, 200, map[string]bool{"ok": true})
	}))
	mux.HandleFunc("GET /v1/me/proxy", s.authorized(func(w http.ResponseWriter, r *http.Request, u User) {
		p, err := s.store.Proxy(u.ID)
		if err != nil {
			failure(w, 500, "读取配置失败")
			return
		}
		response(w, 200, map[string]any{"proxy": p})
	}))
	mux.HandleFunc("PUT /v1/me/proxy", s.authorized(func(w http.ResponseWriter, r *http.Request, u User) {
		var p Proxy
		if !decode(w, r, &p) {
			return
		}
		if !p.Valid() {
			failure(w, 400, "代理配置无效")
			return
		}
		if s.store.SaveProxy(u.ID, p) != nil {
			failure(w, 500, "保存失败")
			return
		}
		response(w, 200, map[string]bool{"saved": true})
	}))
	mux.HandleFunc("GET /v1/me/chat-objects/{environment}/{id}", s.authorized(s.chatObjectRead))
	mux.HandleFunc("PUT /v1/me/chat-objects/{environment}/{id}", s.authorized(s.chatObjectWrite))
	mux.HandleFunc("GET /v1/me/memories", s.authorized(s.memoryRead))
	mux.HandleFunc("PUT /v1/me/memories", s.authorized(s.memoryWrite))
	mux.HandleFunc("GET /v1/me/chats", s.authorized(s.chatRead))
	mux.HandleFunc("PUT /v1/me/chats", s.authorized(s.chatWrite))
	mux.HandleFunc("GET /v1/me/avatar", s.authorized(s.avatar))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		mux.ServeHTTP(w, r)
	})
}
func (s *Server) authorized(next func(http.ResponseWriter, *http.Request, User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			failure(w, 401, "请先登录")
			return
		}
		u, err := s.store.Session(strings.TrimPrefix(header, "Bearer "))
		if err != nil {
			failure(w, 401, "登录已过期，请重新登录")
			return
		}
		next(w, r, u)
	}
}
func (s *Server) start(w http.ResponseWriter, r *http.Request) {
	if s.cfg.GoogleClientID == "" || s.cfg.GoogleClientSecret == "" {
		failure(w, 503, "服务端尚未配置 Google OAuth")
		return
	}
	var body struct {
		Challenge string `json:"challenge"`
		DirectIP  string `json:"directIp"`
		ReturnURL string `json:"returnURL"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.ReturnURL != "" && !validDesktopReturn(body.ReturnURL) {
		failure(w, 400, "客户端返回地址无效")
		return
	}
	decoded, err := base64.RawURLEncoding.DecodeString(body.Challenge)
	if err != nil || len(decoded) != 32 {
		failure(w, 400, "登录校验无效")
		return
	}
	peer := s.peer(r)
	ip := s.clientIP(r)
	source := "server_peer"
	if ip != peer {
		source = "trusted_reverse_proxy"
	}
	if p := net.ParseIP(peer); p != nil && p.IsLoopback() && ip == peer {
		ip = ""
		source = "loopback_no_public_probe"
		if candidate := net.ParseIP(body.DirectIP); candidate != nil && candidate.IsGlobalUnicast() && !candidate.IsPrivate() {
			ip = body.DirectIP
			source = "client_direct_probe"
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	active := 0
	for id, f := range s.flows {
		if now.After(f.Expires) {
			delete(s.flows, id)
		} else if f.PeerIP == peer {
			active++
		}
	}
	if active >= 10 || len(s.flows) >= 1000 {
		failure(w, 429, "登录请求过多，请稍后重试")
		return
	}
	f := &Flow{ReturnURL: body.ReturnURL, ID: randomToken(), State: randomToken(), Challenge: body.Challenge, Verifier: oauth2.GenerateVerifier(), Nonce: randomToken(), IP: ip, PeerIP: peer, IPSource: source, Agent: r.UserAgent(), Expires: now.Add(10 * time.Minute)}
	s.flows[f.ID] = f
	response(w, 200, map[string]any{"flowId": f.ID, "authorizationUrl": s.cfg.PublicURL + "/v1/auth/google/authorize?flow=" + url.QueryEscape(f.ID), "expiresIn": 600})
}
func (s *Server) authorize(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	f := s.flows[r.URL.Query().Get("flow")]
	if f == nil || time.Now().After(f.Expires) || f.Started {
		s.mu.Unlock()
		failure(w, 400, "登录链接失效，请从客户端重新登录")
		return
	}
	f.Started = true
	s.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "oauth_state", Value: f.State, Path: "/v1/auth/google", MaxAge: 600, HttpOnly: true, Secure: strings.HasPrefix(s.cfg.PublicURL, "https:"), SameSite: http.SameSiteLaxMode})
	cfg := s.oauth()
	http.Redirect(w, r, cfg.AuthCodeURL(f.State, oauth2.S256ChallengeOption(f.Verifier), oauth2.SetAuthURLParam("nonce", f.Nonce), oauth2.SetAuthURLParam("prompt", "select_account")), 302)
}
func (s *Server) callback(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	cookie, err := r.Cookie("oauth_state")
	if err != nil || !equal(cookie.Value, state) || state == "" {
		failure(w, 400, "登录状态校验失败")
		return
	}
	s.mu.Lock()
	var f *Flow
	for _, candidate := range s.flows {
		if equal(candidate.State, state) {
			f = candidate
			break
		}
	}
	if f == nil || !f.Started || f.Consumed || time.Now().After(f.Expires) {
		s.mu.Unlock()
		failure(w, 400, "登录已过期或已经使用")
		return
	}
	f.Consumed = true
	s.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "oauth_state", Value: "", Path: "/v1/auth/google", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	if r.URL.Query().Get("error") != "" {
		s.mu.Lock()
		f.Failure = "Google 登录已取消"
		s.mu.Unlock()
		failure(w, 400, "登录已取消，可以返回客户端重试")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	u, err := s.Authenticate(ctx, r.URL.Query().Get("code"), f)
	if err == nil {
		u, fToken, e := s.store.Login(u, f.IP, f.PeerIP, f.IPSource, f.Agent)
		err = e
		if err == nil {
			s.mu.Lock()
			f.User = &u
			f.Token = fToken
			s.mu.Unlock()
		}
	}
	if err != nil {
		s.mu.Lock()
		f.Failure = "Google 身份验证失败，请重新登录"
		s.mu.Unlock()
		failure(w, 502, "登录验证失败，可以返回客户端重试")
		return
	}
	renderDesktopReturn(w, f.ReturnURL)
}
func (s *Server) poll(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FlowID   string `json:"flowId"`
		Verifier string `json:"verifier"`
	}
	if !decode(w, r, &body) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	f := s.flows[body.FlowID]
	if f == nil || time.Now().After(f.Expires) || !equal(challenge(body.Verifier), f.Challenge) {
		failure(w, 400, "登录请求失效")
		return
	}
	if f.Failure != "" {
		failure(w, 400, f.Failure)
		return
	}
	if f.User == nil {
		response(w, 200, map[string]string{"status": "pending"})
		return
	}
	response(w, 200, map[string]any{"status": "complete", "user": f.User, "token": f.Token, "expiresIn": 30 * 24 * 3600})
}
func (s *Server) avatar(w http.ResponseWriter, r *http.Request, u User) {
	if strings.HasPrefix(u.AvatarURL, "data:image/") {
		parts := strings.SplitN(u.AvatarURL, ",", 2)
		data, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			failure(w, 500, "头像读取失败")
			return
		}
		w.Header().Set("Content-Type", strings.TrimSuffix(strings.TrimPrefix(parts[0], "data:"), ";base64"))
		w.Write(data)
		return
	}
	target, err := url.Parse(u.AvatarURL)
	if err != nil || target.Scheme != "https" || target.User != nil || !(target.Hostname() == "googleusercontent.com" || strings.HasSuffix(target.Hostname(), ".googleusercontent.com")) {
		failure(w, 404, "暂无头像")
		return
	}
	req, _ := http.NewRequestWithContext(r.Context(), "GET", target.String(), nil)
	res, err := s.client.Do(req)
	if err != nil {
		failure(w, 502, "头像暂不可用")
		return
	}
	defer res.Body.Close()
	mime := strings.Split(res.Header.Get("Content-Type"), ";")[0]
	if res.StatusCode != 200 || (mime != "image/png" && mime != "image/jpeg" && mime != "image/webp") {
		failure(w, 502, "头像格式无效")
		return
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 2*1024*1024+1))
	if err != nil || len(data) > 2*1024*1024 {
		failure(w, 502, "头像过大")
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Write(data)
}
