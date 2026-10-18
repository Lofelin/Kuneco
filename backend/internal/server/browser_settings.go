package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// Browser settings share the account settings row, but use separate encrypted,
// revisioned namespaces. Profile updates merge other keys without replacing them.
type browserStored struct {
	Revision int64  `json:"revision"`
	Cipher   []byte `json:"cipher"`
}

func browserScope(w http.ResponseWriter, r *http.Request) string {
	scope := r.URL.Query().Get("scope")
	if scope != "account" && (!strings.HasPrefix(scope, "environment:") || len(scope) <= 12 || len(scope) > 268) {
		failure(w, 400, "浏览器设置范围无效")
		return ""
	}
	return "browser:" + scope
}
func (s *Server) browserSettingsRead(w http.ResponseWriter, r *http.Request, u User) {
	key := browserScope(w, r)
	if key == "" {
		return
	}
	var raw []byte
	err := s.store.DB.QueryRow("SELECT settings->$2 FROM user_settings WHERE user_id=$1", u.ID, key).Scan(&raw)
	result := CookieSnapshot{Payload: json.RawMessage("null")}
	if err == sql.ErrNoRows || err == nil && len(raw) == 0 {
		response(w, 200, result)
		return
	}
	var stored browserStored
	if err != nil || json.Unmarshal(raw, &stored) != nil || len(stored.Cipher) < s.store.aead.NonceSize() {
		failure(w, 500, "读取浏览器设置失败")
		return
	}
	n := s.store.aead.NonceSize()
	payload, err := s.store.aead.Open(nil, stored.Cipher[:n], stored.Cipher[n:], []byte(u.ID+":"+key))
	if err != nil {
		failure(w, 500, "读取浏览器设置失败")
		return
	}
	result.Revision = stored.Revision
	result.Payload = payload
	response(w, 200, result)
}
func validBrowserPayload(raw json.RawMessage, account bool) bool {
	var data map[string]json.RawMessage
	if json.Unmarshal(raw, &data) != nil || data == nil {
		return false
	}
	allowed := map[string]bool{"settings": true}
	if !account {
		allowed["permissionDefaultsVersion"] = true
	}
	if account {
		allowed["bookmarks"] = true
	} else {
		for _, k := range []string{"permissions", "agentRules", "extensions", "tabs"} {
			allowed[k] = true
		}
	}
	for k, v := range data {
		if !allowed[k] {
			return false
		}
		if k == "permissionDefaultsVersion" {
			var version int
			if json.Unmarshal(v, &version) != nil || version != 2 {
				return false
			}
		} else if k == "settings" {
			var settings map[string]json.RawMessage
			if json.Unmarshal(v, &settings) != nil || settings == nil {
				return false
			}
			keys := "|restoreTabs|downloadPath|askDownload|agentEnabled|historyAccess|siteTools|zoomByOrigin|"
			if account {
				keys = "|webLinks|localLinks|showFullUrl|annotationScreenshots|"
			}
			for key := range settings {
				if !strings.Contains(keys, "|"+key+"|") {
					return false
				}
			}
		} else {
			var rows []map[string]json.RawMessage
			if json.Unmarshal(v, &rows) != nil || len(rows) > 2000 {
				return false
			}
		}
	}
	return true
}
func (s *Server) browserSettingsWrite(w http.ResponseWriter, r *http.Request, u User) {
	key := browserScope(w, r)
	if key == "" {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2*1024*1024)
	var snapshot CookieSnapshot
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&snapshot) != nil || decoder.Decode(&struct{}{}) != io.EOF || snapshot.Revision < 0 || !validBrowserPayload(snapshot.Payload, key == "browser:account") {
		failure(w, 400, "浏览器设置无效")
		return
	}
	tx, err := s.store.DB.Begin()
	if err != nil {
		failure(w, 500, "保存失败")
		return
	}
	defer tx.Rollback()
	if _, err = tx.Exec("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", u.ID+":"+key); err != nil {
		failure(w, 500, "保存失败")
		return
	}
	var raw []byte
	var stored browserStored
	err = tx.QueryRow("SELECT settings->$2 FROM user_settings WHERE user_id=$1", u.ID, key).Scan(&raw)
	if err != nil && err != sql.ErrNoRows {
		failure(w, 500, "读取失败")
		return
	}
	if len(raw) > 0 && json.Unmarshal(raw, &stored) != nil {
		failure(w, 500, "读取失败")
		return
	}
	if stored.Revision != snapshot.Revision {
		failure(w, 409, "浏览器设置已更新，请重试")
		return
	}
	nonce := make([]byte, s.store.aead.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		failure(w, 500, "保存失败")
		return
	}
	stored.Revision++
	stored.Cipher = s.store.aead.Seal(nonce, nonce, snapshot.Payload, []byte(u.ID+":"+key))
	value, _ := json.Marshal(map[string]browserStored{key: stored})
	_, err = tx.Exec("INSERT INTO user_settings VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET settings=user_settings.settings || excluded.settings", u.ID, string(value))
	if err != nil || tx.Commit() != nil {
		failure(w, 500, "保存失败")
		return
	}
	response(w, 200, map[string]int64{"revision": stored.Revision})
}
