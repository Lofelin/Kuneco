package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

var errCookieConflict = errors.New("cookie revision conflict")

type CookieSnapshot struct {
	Revision int64           `json:"revision"`
	Payload  json.RawMessage `json:"payload"`
}

func (s *Store) Cookies(owner, environment string) (CookieSnapshot, error) {
	result := CookieSnapshot{Payload: json.RawMessage("null")}
	var encrypted []byte
	err := s.DB.QueryRow("SELECT revision,payload FROM browser_cookies WHERE user_id=$1 AND environment=$2", owner, environment).Scan(&result.Revision, &encrypted)
	if err == sql.ErrNoRows {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	n := s.aead.NonceSize()
	if len(encrypted) < n {
		return result, errors.New("invalid chat ciphertext")
	}
	data, err := s.aead.Open(nil, encrypted[:n], encrypted[n:], []byte("cookies:"+owner+":"+environment))
	if err == nil {
		result.Payload = data
	}
	return result, err
}
func (s *Store) SaveCookies(owner, environment string, snapshot CookieSnapshot) (int64, error) {
	if snapshot.Revision < 0 || len(snapshot.Payload) > 1536*1024 || !json.Valid(snapshot.Payload) {
		return 0, errors.New("invalid chat snapshot")
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "cookies:"+owner+":"+environment); err != nil {
		return 0, err
	}
	var revision int64
	err = tx.QueryRow("SELECT revision FROM browser_cookies WHERE user_id=$1 AND environment=$2", owner, environment).Scan(&revision)
	if err != nil && err != sql.ErrNoRows {
		return 0, err
	}
	if snapshot.Revision != revision {
		return revision, errCookieConflict
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return 0, err
	}
	encrypted := s.aead.Seal(nonce, nonce, snapshot.Payload, []byte("cookies:"+owner+":"+environment))
	revision++
	if _, err = tx.Exec("INSERT INTO browser_cookies(user_id,environment,revision,payload) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,environment) DO UPDATE SET revision=excluded.revision,payload=excluded.payload", owner, environment, revision, encrypted); err != nil {
		return 0, err
	}
	return revision, tx.Commit()
}
func cookieEnvironment(w http.ResponseWriter, r *http.Request) string {
	e := r.URL.Query().Get("environment")
	if e == "" || len(e) > 256 {
		failure(w, 400, "环境标识无效")
		return ""
	}
	return e
}
func (s *Server) cookiesRead(w http.ResponseWriter, r *http.Request, u User) {
	e := cookieEnvironment(w, r)
	if e == "" {
		return
	}
	snapshot, err := s.store.Cookies(u.ID, e)
	if err != nil {
		failure(w, 500, "读取 Cookie 失败")
		return
	}
	response(w, 200, snapshot)
}
func (s *Server) cookiesWrite(w http.ResponseWriter, r *http.Request, u User) {
	e := cookieEnvironment(w, r)
	if e == "" {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1600*1024)
	var snapshot CookieSnapshot
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&snapshot) != nil || decoder.Decode(&struct{}{}) != io.EOF || len(snapshot.Payload) == 0 || !json.Valid(snapshot.Payload) {
		failure(w, 400, "Cookie 数据无效或过大")
		return
	}
	var rows []json.RawMessage
	if json.Unmarshal(snapshot.Payload, &rows) != nil || len(rows) > 10000 {
		failure(w, 400, "Cookie 数据无效")
		return
	}
	revision, err := s.store.SaveCookies(u.ID, e, snapshot)
	if err == errCookieConflict {
		failure(w, 409, "Cookie 已更新，请重试")
		return
	}
	if err != nil {
		failure(w, 500, "保存 Cookie 失败")
		return
	}
	response(w, 200, map[string]int64{"revision": revision})
}
