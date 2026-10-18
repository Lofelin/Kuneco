package server

import (
	"strings"
	"testing"
)

func TestBrowserSettingsScopes(t *testing.T) {
	s := testServer(t)
	_, token := login(t, s, "browser-settings")
	_, other := login(t, s, "browser-other")
	route := "/v1/me/browser-settings?scope=account"
	body := `{"revision":0,"payload":{"settings":{"webLinks":"external"},"bookmarks":[]}}`
	if w := request(s, "PUT", route, body, token); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := request(s, "PUT", route, body, token); w.Code != 409 {
		t.Fatal(w.Code)
	}
	for _, x := range []struct{ route, token string }{{route, other}, {"/v1/me/browser-settings?scope=environment:env1", token}} {
		w := request(s, "GET", x.route, "", x.token)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"payload":null`) {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if w := request(s, "GET", route, "", token); w.Code != 200 || !strings.Contains(w.Body.String(), "external") {
		t.Fatal(w.Code)
	}
	if w := request(s, "PUT", route, `{"revision":1,"payload":{"passwords":[]}}`, token); w.Code != 400 {
		t.Fatal(w.Code)
	}
	if w := request(s, "GET", route, "", ""); w.Code != 401 {
		t.Fatal(w.Code)
	}
}
