package server

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

type RuntimeEntry struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Version string `json:"version"`
}
type RuntimeRegistry struct {
	HostName  string         `json:"hostName"`
	CheckedAt string         `json:"checkedAt"`
	Runtimes  []RuntimeEntry `json:"runtimes"`
}

func (s *Server) localEnvironmentDelete(w http.ResponseWriter, r *http.Request, u User) {
	host := r.URL.Query().Get("host")
	if host == "" || len(host) > 256 {
		failure(w, 400, "设备名称无效")
		return
	}
	tx, err := s.store.DB.Begin()
	if err != nil {
		failure(w, 500, "清理环境配置失败")
		return
	}
	defer tx.Rollback()
	if _, err = tx.Exec("DELETE FROM runtime_registries WHERE user_id=$1 AND host_name=$2", u.ID, host); err == nil {
		_, err = tx.Exec("DELETE FROM proxies WHERE user_id=$1", u.ID)
	}
	if err != nil {
		failure(w, 500, "清理环境配置失败")
		return
	}
	if tx.Commit() != nil {
		failure(w, 500, "清理环境配置失败")
		return
	}
	response(w, 200, map[string]bool{"deleted": true})
}

func (s *Server) runtimeRead(w http.ResponseWriter, r *http.Request, u User) {
	host := r.URL.Query().Get("host")
	if host == "" || len(host) > 256 {
		failure(w, 400, "设备名称无效")
		return
	}
	var raw []byte
	err := s.store.DB.QueryRow("SELECT registry FROM runtime_registries WHERE user_id=$1 AND host_name=$2", u.ID, host).Scan(&raw)
	if err == sql.ErrNoRows {
		response(w, 200, map[string]any{"registry": nil})
		return
	}
	if err != nil {
		failure(w, 500, "读取运行时失败")
		return
	}
	var registry RuntimeRegistry
	if json.Unmarshal(raw, &registry) != nil {
		failure(w, 500, "运行时记录无效")
		return
	}
	response(w, 200, map[string]any{"registry": registry})
}
func (s *Server) runtimeWrite(w http.ResponseWriter, r *http.Request, u User) {
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var registry RuntimeRegistry
	if decoder.Decode(&registry) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		failure(w, 400, "运行时记录无效")
		return
	}
	if strings.TrimSpace(registry.HostName) == "" || len(registry.HostName) > 256 || len(registry.Runtimes) > 2 {
		failure(w, 400, "运行时记录无效")
		return
	}
	if _, err := time.Parse(time.RFC3339, registry.CheckedAt); err != nil {
		failure(w, 400, "检测时间无效")
		return
	}
	seen := map[string]bool{}
	for _, item := range registry.Runtimes {
		if (item.ID != "cc" && item.ID != "codex") || seen[item.ID] || len(item.Name) > 80 || len(item.Version) > 512 {
			failure(w, 400, "运行时记录无效")
			return
		}
		seen[item.ID] = true
	}
	raw, _ := json.Marshal(registry)
	if _, err := s.store.DB.Exec("INSERT INTO runtime_registries(user_id,host_name,registry) VALUES($1,$2,$3::jsonb) ON CONFLICT(user_id,host_name) DO UPDATE SET registry=excluded.registry", u.ID, registry.HostName, string(raw)); err != nil {
		failure(w, 500, "保存运行时失败")
		return
	}
	response(w, 200, map[string]any{"saved": true})
}
