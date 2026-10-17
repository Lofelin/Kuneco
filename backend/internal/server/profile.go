package server

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"
)

type UserSettings struct {
	Name     *string `json:"name,omitempty"`
	Avatar   *string `json:"avatar,omitempty"`
	Language *string `json:"language,omitempty"`
}

func (s *Store) applySettings(u *User) error {
	var raw []byte
	err := s.DB.QueryRow("SELECT settings FROM user_settings WHERE user_id=$1", u.ID).Scan(&raw)
	if err == sql.ErrNoRows {
		u.Language = "zh-CN"
		return nil
	}
	if err != nil {
		return err
	}
	var v UserSettings
	if err = json.Unmarshal(raw, &v); err != nil {
		return err
	}
	if v.Name != nil {
		u.Name = *v.Name
	}
	if v.Avatar != nil {
		u.AvatarURL = *v.Avatar
	}
	u.Language = "zh-CN"
	if v.Language != nil {
		u.Language = *v.Language
	}
	return nil
}
func (s *Server) updateProfile(w http.ResponseWriter, r *http.Request, u User) {
	r.Body = http.MaxBytesReader(w, r.Body, 800*1024)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	var v UserSettings
	if d.Decode(&v) != nil || d.Decode(&struct{}{}) != io.EOF {
		failure(w, 400, "请求格式无效")
		return
	}
	if v.Name != nil {
		n := strings.TrimSpace(*v.Name)
		if n == "" || utf8.RuneCountInString(n) > 80 {
			failure(w, 400, "名称需要 1 至 80 个字符")
			return
		}
		v.Name = &n
	}
	if v.Language != nil && *v.Language != "zh-CN" && *v.Language != "en-US" {
		failure(w, 400, "语言无效")
		return
	}
	if v.Avatar != nil {
		parts := strings.SplitN(*v.Avatar, ",", 2)
		if len(parts) != 2 || (parts[0] != "data:image/png;base64" && parts[0] != "data:image/jpeg;base64") {
			failure(w, 400, "头像只支持 PNG 或 JPEG")
			return
		}
		b, e := base64.StdEncoding.DecodeString(parts[1])
		if e != nil || len(b) > 512*1024 {
			failure(w, 400, "头像最大 512 KB")
			return
		}
		cfg, format, e := image.DecodeConfig(bytes.NewReader(b))
		if e != nil || cfg.Width > 4096 || cfg.Height > 4096 || !strings.Contains(parts[0], format) {
			failure(w, 400, "头像无效")
			return
		}
	}
	raw, _ := json.Marshal(v)
	_, err := s.store.DB.Exec("INSERT INTO user_settings VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET settings=user_settings.settings || excluded.settings", u.ID, string(raw))
	if err != nil {
		failure(w, 500, "保存失败")
		return
	}
	if s.store.applySettings(&u) != nil {
		failure(w, 500, "读取失败")
		return
	}
	response(w, 200, u)
}
