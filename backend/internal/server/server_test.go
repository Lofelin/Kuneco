package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"kuneco/backend/internal/migration"
	"github.com/joho/godotenv"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// Each test runs against a real PostgreSQL schema with a random isolated name.
func testDatabase(t *testing.T) string {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		values, _ := godotenv.Read("../../.env")
		databaseURL = values["DATABASE_URL"]
	}
	if databaseURL == "" {
		t.Skip("PostgreSQL integration tests require TEST_DATABASE_URL or backend/.env")
	}
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal("invalid test database configuration")
	}
	schema := "test_" + hash(randomToken())[:24]
	if _, err = admin.Exec("CREATE SCHEMA " + schema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Exec("DROP SCHEMA " + schema + " CASCADE"); admin.Close() })
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal("invalid test database URL")
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	return parsed.String()
}
func testServer(t *testing.T) *Server {
	t.Helper()
	store, err := OpenStore(testDatabase(t), t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.DB.Close() })
	s := New(Config{PublicURL: "http://localhost:8787", GoogleClientID: "fixture", GoogleClientSecret: "fixture"}, store)
	return s
}
func request(s *Server, method, path, body, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.RemoteAddr = "198.51.100.10:4444"
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}
func login(t *testing.T, s *Server, sub string) (User, string) {
	t.Helper()
	verifier := randomToken()
	body, _ := json.Marshal(map[string]string{"challenge": challenge(verifier), "returnURL": "http://127.0.0.1:45678/auth/return/" + strings.Repeat("a", 64)})
	started := request(s, "POST", "/v1/auth/google/start", string(body), "")
	if started.Code != 200 {
		t.Fatal(started.Body.String())
	}
	var start struct {
		FlowID string `json:"flowId"`
	}
	json.Unmarshal(started.Body.Bytes(), &start)
	authorize := request(s, "GET", "/v1/auth/google/authorize?flow="+start.FlowID, "", "")
	if authorize.Code != 302 {
		t.Fatal(authorize.Body.String())
	}
	target, _ := url.Parse(authorize.Header().Get("Location"))
	state := target.Query().Get("state")
	if target.Query().Get("code_challenge_method") != "S256" || target.Query().Get("nonce") == "" || target.Query().Get("scope") != "openid email profile" {
		t.Fatal("missing OAuth protections")
	}
	s.Authenticate = func(ctx context.Context, code string, f *Flow) (User, error) {
		if code != "fixture-code" || f.Nonce != target.Query().Get("nonce") || challenge(f.Verifier) != target.Query().Get("code_challenge") {
			t.Fatal("invalid exchange binding")
		}
		return User{GoogleSub: sub, Email: sub + "@example.test", EmailVerified: true, Name: "Fixture " + sub}, nil
	}
	r := httptest.NewRequest("GET", "/v1/auth/google/callback?state="+state+"&code=fixture-code", nil)
	r.AddCookie(authorize.Result().Cookies()[0])
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if !strings.Contains(w.Header().Get("Content-Type"), "text/html") || !strings.Contains(w.Body.String(), "打开Kuneco桌面应用") || !strings.Contains(w.Body.String(), "http://127.0.0.1:45678/auth/return/") {
		t.Fatal("missing desktop return page")
	}
	replay := httptest.NewRecorder()
	s.Handler().ServeHTTP(replay, r)
	if replay.Code != 400 {
		t.Fatal("callback replay accepted")
	}
	bad, _ := json.Marshal(map[string]string{"flowId": start.FlowID, "verifier": "wrong"})
	if request(s, "POST", "/v1/auth/google/poll", string(bad), "").Code != 400 {
		t.Fatal("poll secret not enforced")
	}
	poll, _ := json.Marshal(map[string]string{"flowId": start.FlowID, "verifier": verifier})
	result := request(s, "POST", "/v1/auth/google/poll", string(poll), "")
	var completed struct {
		Token string
		User  User
	}
	json.Unmarshal(result.Body.Bytes(), &completed)
	if result.Code != 200 || completed.Token == "" {
		t.Fatal("login incomplete")
	}
	return completed.User, completed.Token
}
func TestLoginSessionsAndEncryptedOwnerProxy(t *testing.T) {
	s := testServer(t)
	a, tokenA := login(t, s, "a")
	b, tokenB := login(t, s, "b")
	if a.ID == b.ID || a.LoginIP != "198.51.100.10" {
		t.Fatal("wrong identity or login IP")
	}
	repeated, _ := login(t, s, "a")
	if repeated.ID != a.ID {
		t.Fatal("Google subject does not retain user ID")
	}
	p := Proxy{Protocol: "http", Host: "203.0.113.42", Port: 12323, Username: "fixture", Password: "secret-fixture-password"}
	body, _ := json.Marshal(p)
	if request(s, "PUT", "/v1/me/proxy", string(body), tokenA).Code != 200 {
		t.Fatal("save failed")
	}
	if request(s, "GET", "/v1/me/proxy", "", tokenB).Body.String() != "{\"proxy\":null}\n" {
		t.Fatal("proxy crossed users")
	}
	saved := request(s, "GET", "/v1/me/proxy", "", tokenA)
	if !strings.Contains(saved.Body.String(), p.Host) {
		t.Fatal("proxy not restored")
	}
	var encrypted []byte
	s.store.DB.QueryRow("SELECT config FROM proxies WHERE user_id=$1", a.ID).Scan(&encrypted)
	if strings.Contains(string(encrypted), p.Password) {
		t.Fatal("plaintext credential persisted")
	}
	var tokenHash string
	s.store.DB.QueryRow("SELECT token_hash FROM sessions WHERE user_id=$1", a.ID).Scan(&tokenHash)
	if tokenHash == tokenA {
		t.Fatal("plaintext session persisted")
	}
	if _, err := s.store.DB.Exec("INSERT INTO proxies VALUES($1,$2,$3)", b.ID, encrypted, "now"); err != nil {
		t.Fatal(err)
	}
	if request(s, "GET", "/v1/me/proxy", "", tokenB).Code != 500 {
		t.Fatal("ciphertext not bound to owner")
	}
	if request(s, "POST", "/v1/auth/logout", "", tokenA).Code != 200 || request(s, "GET", "/v1/me", "", tokenA).Code != 401 {
		t.Fatal("logout did not revoke")
	}
	if request(s, "GET", "/v1/me", "", tokenB).Code != 200 {
		t.Fatal("logout revoked another user")
	}
	if request(s, "PUT", "/v1/me/proxy", string(body), "").Code != 401 {
		t.Fatal("anonymous proxy write")
	}
}
func TestOAuthCSRFExpiryAndIPTrust(t *testing.T) {
	s := testServer(t)
	if request(s, "GET", "/v1/auth/google/callback?state=forged&code=fixture", "", "").Code != 400 {
		t.Fatal("CSRF accepted")
	}
	s.flows["expired"] = &Flow{ID: "expired", Challenge: challenge("value"), Expires: time.Now().Add(-time.Second)}
	if request(s, "POST", "/v1/auth/google/poll", `{"flowId":"expired","verifier":"value"}`, "").Code != 400 {
		t.Fatal("expired flow accepted")
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "198.51.100.10:5555"
	r.Header.Set("X-Forwarded-For", "1.2.3.4")
	if s.clientIP(r) != "198.51.100.10" {
		t.Fatal("untrusted forwarded IP accepted")
	}
	s.cfg.TrustedProxies = []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")}
	r.RemoteAddr = "10.0.0.1:5555"
	r.Header.Set("X-Forwarded-For", "203.0.113.9, 10.0.0.2")
	if s.clientIP(r) != "203.0.113.9" {
		t.Fatal("trusted chain incorrect")
	}
	s.cfg.GoogleClientSecret = ""
	if request(s, "POST", "/v1/auth/google/start", `{}`, "").Code != 503 {
		t.Fatal("missing OAuth config bypassed")
	}
}
func TestPersistentSessionsAndProxy(t *testing.T) {
	directory := t.TempDir()
	databaseURL := testDatabase(t)
	store, err := OpenStore(databaseURL, directory, "")
	if err != nil {
		t.Fatal(err)
	}
	user, token, err := store.Login(User{GoogleSub: "subject", Name: "Fixture"}, "1.2.3.4", "1.2.3.4", "server_peer", "test")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.SaveProxy(user.ID, Proxy{Protocol: "socks5", Host: "203.0.113.8", Port: 1080, Password: "test-secret"}); err != nil {
		t.Fatal(err)
	}
	store.DB.Close()
	store, err = OpenStore(databaseURL, directory, "")
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	restored, err := store.Session(token)
	if err != nil || restored.ID != user.ID {
		t.Fatal("session lost after restart")
	}
	p, err := store.Proxy(user.ID)
	if err != nil || p.Password != "test-secret" {
		t.Fatal("proxy lost after restart")
	}
}

func TestConcurrentGoogleLogins(t *testing.T) {
	s := testServer(t)
	const count = 20
	ids := make(chan string, count)
	errs := make(chan error, count)
	var workers sync.WaitGroup
	for i := 0; i < count; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			user, token, err := s.store.Login(User{GoogleSub: "same-sub", Name: "Fixture"}, "", "", "test", "test")
			if err == nil {
				var restored User
				restored, err = s.store.Session(token)
				if err == nil && restored.ID != user.ID {
					err = sql.ErrNoRows
				}
			}
			ids <- user.ID
			errs <- err
		}()
	}
	workers.Wait()
	close(ids)
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var first string
	for id := range ids {
		if first == "" {
			first = id
		}
		if id != first {
			t.Fatal("concurrent login created divergent users")
		}
	}
}

func TestSQLiteMigrationPreservesRecords(t *testing.T) {
	s := testServer(t)
	user, token, err := s.store.Login(User{GoogleSub: "migrate", Name: "Fixture"}, "", "", "test", "test")
	if err != nil {
		t.Fatal(err)
	}
	proxy := Proxy{Protocol: "http", Host: "203.0.113.4", Port: 12323, Password: "migration-secret"}
	if err = s.store.SaveProxy(user.ID, proxy); err != nil {
		t.Fatal(err)
	}
	// Materialize a legacy-format SQLite fixture from real PostgreSQL rows.
	sourcePath := filepath.Join(t.TempDir(), "legacy.db")
	source, err := sql.Open("sqlite", sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	tables := []struct {
		name, ddl string
		size      int
	}{
		{"users", "id TEXT,google_sub TEXT,email TEXT,name TEXT,profile TEXT", 5},
		{"sessions", "token_hash TEXT,user_id TEXT,expires INTEGER", 3},
		{"login_events", "id INTEGER,user_id TEXT,ip TEXT,peer_ip TEXT,ip_source TEXT,user_agent TEXT,created_at TEXT", 7},
		{"proxies", "user_id TEXT,config BLOB,updated_at TEXT", 3},
	}
	for _, table := range tables {
		if _, err = source.Exec("CREATE TABLE " + table.name + "(" + table.ddl + ")"); err != nil {
			t.Fatal(err)
		}
		rows, err := s.store.DB.Query("SELECT * FROM " + table.name)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			values := make([]any, table.size)
			ptrs := make([]any, table.size)
			for i := range values {
				ptrs[i] = &values[i]
			}
			if err = rows.Scan(ptrs...); err != nil {
				t.Fatal(err)
			}
			if _, err = source.Exec("INSERT INTO "+table.name+" VALUES("+strings.TrimSuffix(strings.Repeat("?,", table.size), ",")+")", values...); err != nil {
				t.Fatal(err)
			}
		}
		if err = rows.Err(); err != nil {
			t.Fatal(err)
		}
		rows.Close()
	}
	if _, err = s.store.DB.Exec("TRUNCATE chat_objects,browser_cookies,password_credentials,users,sessions,login_events,proxies,chat_states,user_settings,runtime_registries"); err != nil {
		t.Fatal(err)
	}
	if err = migration.Import(context.Background(), s.store.DB, sourcePath); err != nil {
		t.Fatal(err)
	}
	restored, err := s.store.Session(token)
	if err != nil || restored.ID != user.ID {
		t.Fatal("migrated session not usable")
	}
	saved, err := s.store.Proxy(user.ID)
	if err != nil || *saved != proxy {
		t.Fatal("migrated ciphertext not usable")
	}
	if _, _, err = s.store.Login(User{GoogleSub: "after-import"}, "", "", "test", "test"); err != nil {
		t.Fatal("identity sequence not advanced", err)
	}
	if err = migration.Import(context.Background(), s.store.DB, sourcePath); err == nil {
		t.Fatal("nonempty target overwritten")
	}
	if _, err = s.store.Session(token); err != nil {
		t.Fatal("refused reimport modified records")
	}
	// A bad foreign key after users have been inserted must roll back everything.
	if _, err = source.Exec("UPDATE sessions SET user_id='missing-user'"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.store.DB.Exec("TRUNCATE chat_objects,browser_cookies,password_credentials,users,sessions,login_events,proxies,chat_states,user_settings,runtime_registries"); err != nil {
		t.Fatal(err)
	}
	if err = migration.Import(context.Background(), s.store.DB, sourcePath); err == nil {
		t.Fatal("invalid source unexpectedly imported")
	}
	for _, table := range tables {
		var count int
		if err = s.store.DB.QueryRow("SELECT count(*) FROM " + table.name).Scan(&count); err != nil || count != 0 {
			t.Fatal("failed import was not atomic")
		}
	}
}

func TestHealthChecksDatabase(t *testing.T) {
	s := testServer(t)
	if w := request(s, "GET", "/health", "", ""); w.Code != 200 || !strings.Contains(w.Body.String(), "postgresql") {
		t.Fatal("healthy PostgreSQL not reported")
	}
	s.store.DB.Close()
	if w := request(s, "GET", "/health", "", ""); w.Code != 503 {
		t.Fatal("unavailable database reported healthy")
	}
}

func TestChatOwnershipAndRevisions(t *testing.T) {
	s := testServer(t)
	a, ta := login(t, s, "chat-a")
	_, tb := login(t, s, "chat-b")
	body := `{"revision":0,"payload":{"sessions":[{"id":"one","archived":true}],"views":[{"id":"one","messages":[{"role":"user","text":"private chat"}]}]}}`
	if request(s, "PUT", "/v1/me/chats", body, ta).Code != 200 {
		t.Fatal("chat save failed")
	}
	if !strings.Contains(request(s, "GET", "/v1/me/chats", "", ta).Body.String(), "private chat") {
		t.Fatal("chat not restored")
	}
	if strings.Contains(request(s, "GET", "/v1/me/chats", "", tb).Body.String(), "private chat") {
		t.Fatal("chat leaked across users")
	}
	if request(s, "PUT", "/v1/me/chats", body, ta).Code != 409 {
		t.Fatal("stale update silently overwrote data")
	}
	if request(s, "GET", "/v1/me/chats", "", "").Code != 401 {
		t.Fatal("anonymous read allowed")
	}
	var encrypted []byte
	if err := s.store.DB.QueryRow("SELECT payload FROM chat_states WHERE user_id=$1", a.ID).Scan(&encrypted); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encrypted), "private chat") {
		t.Fatal("plaintext chat stored")
	}
}

func TestProfileSettingsIsolation(t *testing.T) {
	s := testServer(t)
	_, a := login(t, s, "profile-a")
	_, b := login(t, s, "profile-b")
	if request(s, "PUT", "/v1/me/profile", `{"name":"New Name","language":"en-US"}`, a).Code != 200 {
		t.Fatal("save failed")
	}
	var u User
	json.Unmarshal(request(s, "GET", "/v1/me", "", a).Body.Bytes(), &u)
	if u.Name != "New Name" || u.Language != "en-US" {
		t.Fatal("settings not restored")
	}
	json.Unmarshal(request(s, "GET", "/v1/me", "", b).Body.Bytes(), &u)
	if u.Name == "New Name" || u.Language != "zh-CN" {
		t.Fatal("settings leaked")
	}
	for _, body := range []string{`{"email":"other@example.test"}`, `{"avatar":"https://example.com/a.png"}`, `{"language":"invalid"}`, `{"name":" "}`} {
		if request(s, "PUT", "/v1/me/profile", body, a).Code != 400 {
			t.Fatal("invalid profile accepted")
		}
	}
	if request(s, "PUT", "/v1/me/profile", `{"name":"x"}`, "").Code != 401 {
		t.Fatal("anonymous update accepted")
	}
	_, again := login(t, s, "profile-a")
	json.Unmarshal(request(s, "GET", "/v1/me", "", again).Body.Bytes(), &u)
	if u.Name != "New Name" || u.Language != "en-US" {
		t.Fatal("Google login overwrote settings")
	}
}

func TestLocalEnvironmentDeleteIsolation(t *testing.T) {
	s := testServer(t)
	a, ta := login(t, s, "local-delete-a")
	b, tb := login(t, s, "local-delete-b")
	for _, u := range []User{a, b} {
		if err := s.store.SaveProxy(u.ID, Proxy{Protocol: "http", Host: "203.0.113.8", Port: 8080}); err != nil {
			t.Fatal(err)
		}
		for _, host := range []string{"this-device", "other-device"} {
			if _, err := s.store.DB.Exec("INSERT INTO runtime_registries(user_id,host_name,registry) VALUES($1,$2,'{}'::jsonb)", u.ID, host); err != nil {
				t.Fatal(err)
			}
		}
	}
	if request(s, "DELETE", "/v1/me/local-environment?host=this-device", "", "").Code != 401 {
		t.Fatal("anonymous delete allowed")
	}
	if request(s, "DELETE", "/v1/me/local-environment", "", ta).Code != 400 {
		t.Fatal("missing host allowed")
	}
	if request(s, "DELETE", "/v1/me/local-environment?host=this-device", "", ta).Code != 200 {
		t.Fatal("delete failed")
	}
	if p, err := s.store.Proxy(a.ID); err != nil || p != nil {
		t.Fatal("proxy was not cleared")
	}
	if p, err := s.store.Proxy(b.ID); err != nil || p == nil {
		t.Fatal("other account proxy removed")
	}
	if request(s, "GET", "/v1/me/runtimes?host=this-device", "", tb).Code != 200 {
		t.Fatal("other account runtime read failed")
	}
	var count int
	if err := s.store.DB.QueryRow("SELECT count(*) FROM runtime_registries WHERE user_id=$1", b.ID).Scan(&count); err != nil || count != 2 {
		t.Fatal("other account runtime removed")
	}
	if err := s.store.DB.QueryRow("SELECT count(*) FROM runtime_registries WHERE user_id=$1", a.ID).Scan(&count); err != nil || count != 1 {
		t.Fatal("other host runtime removed")
	}
}
