package server

import (
	_ "embed"
	"encoding/base64"
	"html/template"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
)

var returnPath = regexp.MustCompile(`^/auth/return/[a-f0-9]{64}$`)

func validDesktopReturn(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !returnPath.MatchString(u.Path) {
		return false
	}
	port, err := strconv.Atoi(u.Port())
	return err == nil && port >= 1024 && port <= 65535
}

//go:embed assets/kuneco-mark.png
var desktopLogo []byte

var desktopReturnPage = template.Must(template.New("desktop-return").Parse(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>正在打开Kuneco</title><link rel="icon" type="image/png" href="data:image/png;base64,` + base64.StdEncoding.EncodeToString(desktopLogo) + `"><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;}body{background:#fafafa;color:#202127;font-family:system-ui,-apple-system,sans-serif}.return-viewport{position:fixed;inset:0;display:flex;overflow:auto;padding:24px}main{width:min(100%,514px);flex:none;margin:auto;padding:24px 36px;text-align:center;background:white;border:1px solid #e5e5e9;border-radius:12px;box-shadow:0 1px 3px #0001}.kuneco-logo{display:block;width:48px;height:48px;object-fit:contain;margin:0 auto 16px}h1{font-size:24px;font-weight:600;margin:0 0 12px}p{font-size:14px;color:#777883;line-height:1.6;margin:0 0 20px}a{display:inline-block;padding:8px 12px;border:1px solid #e5e5e9;border-radius:7px;color:inherit;text-decoration:none;font-size:14px;font-weight:500}a:hover{background:#f3f3f5}</style></head><body><div class="return-viewport"><main><img class="kuneco-logo" src="data:image/png;base64,` + base64.StdEncoding.EncodeToString(desktopLogo) + `" alt="Kuneco" width="48" height="48"><h1>正在打开Kuneco</h1><p>{{if .}}没有自动打开？点击下方按钮返回桌面应用。{{else}}登录已完成，请返回Kuneco桌面应用。{{end}}</p>{{if .}}<a href="{{.}}">打开Kuneco桌面应用</a>{{end}}</main></div></body></html>`))

func renderDesktopReturn(w http.ResponseWriter, target string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
	if !validDesktopReturn(target) {
		target = ""
	}
	_ = desktopReturnPage.Execute(w, target)
}
