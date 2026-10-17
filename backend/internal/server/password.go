package server

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

var errCredentials = errors.New("用户名或密码错误")

// Password identities are separate from verified Google identities, including
// when the chosen username looks like an email address.
func (s *Store) PasswordLogin(username, password, ip, peer, agent string) (User, string, error) {
	username = strings.ToLower(strings.TrimSpace(username))
	if utf8.RuneCountInString(username) < 2 || utf8.RuneCountInString(username) > 64 || strings.ContainsFunc(username, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) || utf8.RuneCountInString(password) < 8 || len(password) > 72 {
		return User{}, "", errors.New("用户名需为2至64个字符，密码至少8个字符且不超过72字节")
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return User{}, "", err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "password:"+username); err != nil {
		return User{}, "", err
	}
	var profile, subject, encoded string
	err = tx.QueryRow("SELECT users.profile,users.google_sub,credentials.password_hash FROM password_credentials credentials JOIN users ON users.id=credentials.user_id WHERE credentials.username=$1", username).Scan(&profile, &subject, &encoded)
	var user User
	if err == sql.ErrNoRows {
		hashBytes, hashErr := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if hashErr != nil {
			return user, "", hashErr
		}
		user = User{ID: randomToken(), GoogleSub: "password:" + username, Username: username, Name: username, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
		subject = user.GoogleSub
		data, _ := json.Marshal(user)
		if _, err = tx.Exec("INSERT INTO users(id,google_sub,email,name,profile) VALUES($1,$2,$3,$4,$5)", user.ID, subject, "", user.Name, string(data)); err != nil {
			return user, "", err
		}
		if _, err = tx.Exec("INSERT INTO password_credentials(username,user_id,password_hash) VALUES($1,$2,$3)", username, user.ID, string(hashBytes)); err != nil {
			return user, "", err
		}
	} else if err != nil {
		return user, "", err
	} else {
		if bcrypt.CompareHashAndPassword([]byte(encoded), []byte(password)) != nil {
			return user, "", errCredentials
		}
		if err = json.Unmarshal([]byte(profile), &user); err != nil {
			return user, "", err
		}
		user.GoogleSub = subject
	}
	if err = tx.Commit(); err != nil {
		return user, "", err
	}
	return s.Login(user, ip, peer, "account_service_request", agent)
}

func (s *Server) passwordLogin(w http.ResponseWriter, r *http.Request) {
	var value struct {
		Username        string `json:"username"`
		Password        string `json:"password"`
		ConfirmPassword string `json:"confirmPassword"`
	}
	if !decode(w, r, &value) {
		return
	}
	if value.Password != value.ConfirmPassword {
		failure(w, 400, "两次输入的密码不一致")
		return
	}
	// Bound password hashing attempts per peer without retaining passwords.
	peer := s.clientIP(r)
	s.mu.Lock()
	now := time.Now()
	if s.passwordAttempts == nil {
		s.passwordAttempts = map[string][]time.Time{}
	}
	attempts := s.passwordAttempts[peer]
	recent := attempts[:0]
	for _, at := range attempts {
		if now.Sub(at) < time.Minute {
			recent = append(recent, at)
		}
	}
	if len(recent) >= 15 {
		s.mu.Unlock()
		failure(w, 429, "尝试过于频繁，请稍后重试")
		return
	}
	if len(s.passwordAttempts) > 10000 {
		for key, times := range s.passwordAttempts {
			if len(times) == 0 || now.Sub(times[len(times)-1]) > time.Minute {
				delete(s.passwordAttempts, key)
			}
		}
	}
	if len(s.passwordAttempts) >= 10000 && s.passwordAttempts[peer] == nil {
		s.mu.Unlock()
		failure(w, 429, "尝试过于频繁，请稍后重试")
		return
	}
	s.passwordAttempts[peer] = append(recent, now)
	s.mu.Unlock()
	user, token, err := s.store.PasswordLogin(value.Username, value.Password, peer, s.peer(r), r.UserAgent())
	if err != nil {
		failure(w, 400, "登录失败，请检查用户名和密码。用户名需为2至64个字符，密码至少8个字符且不超过72字节。")
		return
	}
	response(w, 200, map[string]any{"user": user, "token": token})
}
