package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

const memoryMaxBytes = 32 * 1024 * 1024

var errMemoryConflict = errors.New("memory revision conflict")

type MemorySnapshot struct {
	Revision   int64           `json:"revision"`
	Payload    json.RawMessage `json:"payload"`
	ServerTime int64           `json:"serverTime,omitempty"`
}

func memoryEnvironment(r *http.Request) (string, bool) {
	v := r.URL.Query().Get("environment")
	return v, v != "" && len(v) <= 256 && !strings.ContainsAny(v, "\x00\r\n")
}
func validMemoryPayload(raw json.RawMessage, owner, environment string) bool {
	var p struct {
		Version  int                          `json:"version"`
		Items    []map[string]json.RawMessage `json:"items"`
		Jobs     []map[string]json.RawMessage `json:"jobs"`
		Settings []map[string]json.RawMessage `json:"settings"`
		Imports  []string                     `json:"imports"`
	}
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	if d.Decode(&p) != nil || p.Version != 2 || p.Items == nil || p.Jobs == nil || p.Settings == nil || len(p.Items) > 10000 || len(p.Jobs) > 20000 || len(p.Settings) > 1 || len(p.Imports) > 512 {
		return false
	}
	str := func(row map[string]json.RawMessage, key string) string {
		var value string
		_ = json.Unmarshal(row[key], &value)
		return value
	}
	scoped := func(row map[string]json.RawMessage) bool {
		if str(row, "owner") != owner {
			return false
		}
		if environment == "local" {
			return string(row["environmentId"]) == "null"
		}
		return str(row, "environmentId") == environment
	}
	ids := map[string]bool{}
	active := 0
	for _, item := range p.Items {
		id := str(item, "id")
		status := str(item, "status")
		var revision int
		var enabled bool
		if !scoped(item) || id == "" || len(id) > 160 || ids[id] || str(item, "title") == "" || utf8.RuneCountInString(str(item, "title")) > 80 || str(item, "content") == "" || utf8.RuneCountInString(str(item, "content")) > 4000 || json.Unmarshal(item["revision"], &revision) != nil || revision < 1 || json.Unmarshal(item["enabled"], &enabled) != nil || !strings.Contains("|active|conflict|resolved|deleted|", "|"+status+"|") {
			return false
		}
		ids[id] = true
		if status == "active" || status == "conflict" {
			active++
		}
	}
	if active > 1000 {
		return false
	}
	ids = map[string]bool{}
	for _, job := range p.Jobs {
		id := str(job, "id")
		status := str(job, "status")
		var source map[string]json.RawMessage
		if !scoped(job) || id == "" || len(id) > 160 || ids[id] || !strings.Contains("|queued|running|completed|failed|cancelled|", "|"+status+"|") || json.Unmarshal(job["source"], &source) != nil || str(source, "turnId") == "" || !strings.Contains("|cc|codex|deepseek|", "|"+str(source, "engine")+"|") {
			return false
		}
		ids[id] = true
		if status == "running" {
			var lease int64
			if json.Unmarshal(job["leaseUntil"], &lease) != nil || lease > time.Now().Add(3*time.Minute).UnixMilli() || str(job, "workerId") == "" {
				return false
			}
		}
	}
	for _, setting := range p.Settings {
		if !scoped(setting) {
			return false
		}
		for _, key := range []string{"automatic", "recall"} {
			if value, ok := setting[key]; ok {
				var b bool
				if json.Unmarshal(value, &b) != nil {
					return false
				}
			}
		}
		for key, allowed := range map[string][]int{"limit": {4, 8, 12}, "budget": {3000, 6000, 12000}} {
			if value, ok := setting[key]; ok {
				var n int
				if json.Unmarshal(value, &n) != nil {
					return false
				}
				found := false
				for _, v := range allowed {
					found = found || v == n
				}
				if !found {
					return false
				}
			}
		}
	}
	for _, key := range p.Imports {
		if len(key) != 64 {
			return false
		}
	}
	return true
}
func (s *Store) Memories(owner, environment string) (MemorySnapshot, error) {
	result := MemorySnapshot{Payload: json.RawMessage("null"), ServerTime: time.Now().UnixMilli()}
	var encrypted []byte
	err := s.DB.QueryRow("SELECT revision,payload FROM memory_states WHERE user_id=$1 AND environment=$2", owner, environment).Scan(&result.Revision, &encrypted)
	if err == sql.ErrNoRows {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	n := s.aead.NonceSize()
	if len(encrypted) < n {
		return result, errors.New("invalid memory ciphertext")
	}
	data, err := s.aead.Open(nil, encrypted[:n], encrypted[n:], []byte("memory:"+owner+":"+environment))
	if err == nil {
		result.Payload = data
	}
	return result, err
}
func (s *Store) SaveMemories(owner, environment string, snapshot MemorySnapshot) (int64, error) {
	if snapshot.Revision < 0 || len(snapshot.Payload) > memoryMaxBytes || !validMemoryPayload(snapshot.Payload, owner, environment) {
		return 0, errors.New("invalid memory snapshot")
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "memory:"+owner+":"+environment); err != nil {
		return 0, err
	}
	var revision int64
	err = tx.QueryRow("SELECT revision FROM memory_states WHERE user_id=$1 AND environment=$2", owner, environment).Scan(&revision)
	if err != nil && err != sql.ErrNoRows {
		return 0, err
	}
	if revision != snapshot.Revision {
		return revision, errMemoryConflict
	}
	nonce := make([]byte, s.aead.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return 0, err
	}
	encrypted := s.aead.Seal(nonce, nonce, snapshot.Payload, []byte("memory:"+owner+":"+environment))
	revision++
	_, err = tx.Exec("INSERT INTO memory_states(user_id,environment,revision,payload) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,environment) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=now()", owner, environment, revision, encrypted)
	if err != nil {
		return 0, err
	}
	return revision, tx.Commit()
}
func (s *Server) memoryRead(w http.ResponseWriter, r *http.Request, u User) {
	environment, ok := memoryEnvironment(r)
	if !ok {
		failure(w, 400, "记忆环境无效")
		return
	}
	snapshot, err := s.store.Memories(u.ID, environment)
	if err != nil {
		failure(w, 500, "读取记忆失败")
		return
	}
	response(w, 200, snapshot)
}
func (s *Server) memoryWrite(w http.ResponseWriter, r *http.Request, u User) {
	environment, ok := memoryEnvironment(r)
	if !ok {
		failure(w, 400, "记忆环境无效")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, memoryMaxBytes+1024)
	var snapshot MemorySnapshot
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if d.Decode(&snapshot) != nil || d.Decode(&struct{}{}) != io.EOF || snapshot.Revision < 0 || !validMemoryPayload(snapshot.Payload, u.ID, environment) {
		failure(w, 400, "记忆数据格式无效或过大")
		return
	}
	revision, err := s.store.SaveMemories(u.ID, environment, snapshot)
	if err == errMemoryConflict {
		failure(w, 409, "其他设备已更新记忆，请重试")
		return
	}
	if err != nil {
		failure(w, 500, "保存记忆失败")
		return
	}
	response(w, 200, map[string]int64{"revision": revision, "serverTime": time.Now().UnixMilli()})
}
