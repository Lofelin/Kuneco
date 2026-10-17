package server

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestCookieScopesEncryptionAndConflict(t *testing.T) {
	s := testServer(t)
	u, token := login(t, s, "cookie-user")
	_, other := login(t, s, "other-cookie-user")
	route := "/v1/me/browser-cookies?environment=env-a"
	body := `{"revision":0,"payload":[{"domain":"example.test","name":"session","value":"test-secret-cookie"}]}`
	if w := request(s, "PUT", route, body, token); w.Code != 200 {
		t.Fatal(w.Code)
	}
	if w := request(s, "PUT", route, body, token); w.Code != 409 {
		t.Fatal("expected revision conflict", w.Code)
	}
	for _, v := range []struct{ route, token string }{{route, other}, {"/v1/me/browser-cookies?environment=env-b", token}} {
		w := request(s, "GET", v.route, "", v.token)
		var snapshot CookieSnapshot
		json.Unmarshal(w.Body.Bytes(), &snapshot)
		if w.Code != 200 || string(snapshot.Payload) != "null" {
			t.Fatal("scope leaked")
		}
	}
	if w := request(s, "GET", route, "", ""); w.Code != 401 {
		t.Fatal("unauthenticated access")
	}
	var raw []byte
	if err := s.store.DB.QueryRow("SELECT payload FROM browser_cookies WHERE user_id=$1", u.ID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("test-secret-cookie")) {
		t.Fatal("plaintext storage")
	}
	w := request(s, "GET", route, "", token)
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte("test-secret-cookie")) {
		t.Fatal("roundtrip failed")
	}
}
