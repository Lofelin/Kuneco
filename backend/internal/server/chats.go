package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

var errChatConflict = errors.New("chat revision conflict")

type ChatSnapshot struct {
	Revision int64           `json:"revision"`
	Payload  json.RawMessage `json:"payload"`
}

func (s *Store) Chats(owner string) (ChatSnapshot, error) {
	result := ChatSnapshot{Payload: json.RawMessage("null")}
	var encrypted []byte
	err := s.DB.QueryRow("SELECT revision,payload FROM chat_states WHERE user_id=$1", owner).Scan(&result.Revision, &encrypted)
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
	data, err := s.aead.Open(nil, encrypted[:n], encrypted[n:], []byte("chats:"+owner))
	if err == nil {
		result.Payload = data
	}
	return result, err
}
func (s *Store) SaveChats(owner string, snapshot ChatSnapshot) (int64, error) {
	if snapshot.Revision < 0 || len(snapshot.Payload) > 1536*1024 || !json.Valid(snapshot.Payload) {
		return 0, errors.New("invalid chat snapshot")
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "chats:"+owner); err != nil {
		return 0, err
	}
	var revision int64
	err = tx.QueryRow("SELECT revision FROM chat_states WHERE user_id=$1", owner).Scan(&revision)
	if err != nil && err != sql.ErrNoRows {
		return 0, err
	}
	if snapshot.Revision != revision {
		return revision, errChatConflict
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return 0, err
	}
	encrypted := s.aead.Seal(nonce, nonce, snapshot.Payload, []byte("chats:"+owner))
	revision++
	if _, err = tx.Exec("INSERT INTO chat_states(user_id,revision,payload) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=now()", owner, revision, encrypted); err != nil {
		return 0, err
	}
	return revision, tx.Commit()
}
func (s *Server) chatRead(w http.ResponseWriter, r *http.Request, u User) {
	snapshot, err := s.store.Chats(u.ID)
	if err != nil {
		failure(w, 500, "读取对话失败")
		return
	}
	response(w, 200, snapshot)
}
func (s *Server) chatWrite(w http.ResponseWriter, r *http.Request, u User) {
	r.Body = http.MaxBytesReader(w, r.Body, 1600*1024)
	var snapshot ChatSnapshot
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&snapshot) != nil || decoder.Decode(&struct{}{}) != io.EOF || len(snapshot.Payload) == 0 || !json.Valid(snapshot.Payload) {
		failure(w, 400, "对话数据格式无效或过大")
		return
	}
	revision, err := s.store.SaveChats(u.ID, snapshot)
	if err == errChatConflict {
		failure(w, 409, "其他设备已更新对话，请重新加载后重试")
		return
	}
	if err != nil {
		failure(w, 500, "保存对话失败")
		return
	}
	response(w, 200, map[string]int64{"revision": revision})
}
