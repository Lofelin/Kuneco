package server

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDesktopReturnTarget(t *testing.T) {
	good := "http://127.0.0.1:45678/auth/return/" + strings.Repeat("a", 64)
	if !validDesktopReturn(good) {
		t.Fatal("valid loopback return rejected")
	}
	for _, raw := range []string{"https://evil.test", strings.Replace(good, "127.0.0.1", "evil.test", 1), strings.Replace(good, ":45678", ":80", 1), good + "?token=secret", good + "#secret", strings.Replace(good, "127.0.0.1", "user@127.0.0.1", 1)} {
		if validDesktopReturn(raw) {
			t.Fatalf("unsafe return accepted: %s", raw)
		}
	}
	w := httptest.NewRecorder()
	renderDesktopReturn(w, "https://evil.test")
	if !strings.Contains(w.Body.String(), `class="kuneco-logo" src="data:image/png;base64,`) || strings.Contains(w.Body.String(), "ZgotmplZ") || !strings.Contains(w.Header().Get("Content-Security-Policy"), "img-src data:") {
		t.Fatal("return page logo missing or blocked")
	}
	if strings.Contains(w.Body.String(), "evil.test") || strings.Contains(w.Body.String(), "<script>") {
		t.Fatal("unsafe return rendered")
	}
}
