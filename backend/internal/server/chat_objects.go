package server

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
)

var chatObjectID = regexp.MustCompile(`^[a-f0-9]{64}$`)

func (s *Server) chatObjectWrite(w http.ResponseWriter, r *http.Request, u User) {
	id := r.PathValue("id")
	environment := r.PathValue("environment")
	if !regexp.MustCompile(`^(_local|_index|[a-f0-9-]{36})$`).MatchString(environment) {
		failure(w, 400, "无效聊天环境")
		return
	}
	if !chatObjectID.MatchString(id) {
		failure(w, 400, "无效聊天对象")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1024*1024)
	data, err := io.ReadAll(r.Body)
	if err != nil || !json.Valid(data) {
		failure(w, 413, "聊天分块过大或无效")
		return
	}
	// IDs cover the exact JSON bytes sent by the client.
	hash := sha256.Sum256(data)
	if hex.EncodeToString(hash[:]) != id {
		failure(w, 400, "聊天分块校验失败")
		return
	}
	nonce := make([]byte, s.store.aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		failure(w, 500, "保存聊天分块失败")
		return
	}
	encrypted := s.store.aead.Seal(nonce, nonce, data, []byte("chat-object:"+u.ID+":"+environment+":"+id))
	_, err = s.store.DB.Exec("INSERT INTO chat_objects(user_id,environment,object_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,environment,object_id) DO NOTHING", u.ID, environment, id, encrypted)
	if err != nil {
		failure(w, 500, "保存聊天分块失败")
		return
	}
	response(w, 200, map[string]bool{"saved": true})
}
func (s *Server) chatObjectRead(w http.ResponseWriter, r *http.Request, u User) {
	id := r.PathValue("id")
	environment := r.PathValue("environment")
	if !regexp.MustCompile(`^(_local|_index|[a-f0-9-]{36})$`).MatchString(environment) {
		failure(w, 400, "无效聊天环境")
		return
	}
	if !chatObjectID.MatchString(id) {
		failure(w, 400, "无效聊天对象")
		return
	}
	var encrypted []byte
	err := s.store.DB.QueryRow("SELECT payload FROM chat_objects WHERE user_id=$1 AND environment=$2 AND object_id=$3", u.ID, environment, id).Scan(&encrypted)
	if err == sql.ErrNoRows {
		failure(w, 404, "聊天分块不存在")
		return
	}
	if err != nil || len(encrypted) < s.store.aead.NonceSize() {
		failure(w, 500, "读取聊天分块失败")
		return
	}
	n := s.store.aead.NonceSize()
	data, err := s.store.aead.Open(nil, encrypted[:n], encrypted[n:], []byte("chat-object:"+u.ID+":"+environment+":"+id))
	if err != nil {
		failure(w, 500, "读取聊天分块失败")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(200)
	_, _ = w.Write(data)
}
