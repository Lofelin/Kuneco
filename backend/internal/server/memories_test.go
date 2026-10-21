package server

import (
	"encoding/json"
	"strings"
	"sync"
	"testing"
)

func memoryTestPayload(owner, environment string) string {
	env := `null`
	if environment != "local" {
		b, _ := json.Marshal(environment)
		env = string(b)
	}
	return `{"version":2,"items":[{"id":"memory-1","owner":"` + owner + `","environmentId":` + env + `,"title":"偏好","content":"中文回复","type":"preference","status":"active","enabled":true,"revision":1,"sources":[],"history":[]}],"jobs":[],"settings":[],"imports":[]}`
}
func TestMemoriesAuthenticatedEncryptedRevisionedScopes(t *testing.T) {
	s := testServer(t)
	u, token := login(t, s, "memory-one")
	_, other := login(t, s, "memory-two")
	route := "/v1/me/memories?environment=dev"
	payload := memoryTestPayload(u.ID, "dev")
	body := `{"revision":0,"payload":` + payload + `}`
	if w := request(s, "PUT", route, body, token); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := request(s, "PUT", route, body, token); w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, q := range []struct{ route, token string }{{route, other}, {"/v1/me/memories?environment=other", token}} {
		w := request(s, "GET", q.route, "", q.token)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"payload":null`) {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if w := request(s, "GET", route, "", ""); w.Code != 401 {
		t.Fatal(w.Code)
	}
	if w := request(s, "PUT", route, strings.Replace(body, u.ID, "wrong-owner", 1), token); w.Code != 400 {
		t.Fatal(w.Code)
	}
	var stored []byte
	if err := s.store.DB.QueryRow("SELECT payload FROM memory_states WHERE user_id=$1 AND environment='dev'", u.ID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(stored), "中文回复") {
		t.Fatal("plaintext in database")
	}
	persisted, err := s.store.Memories(u.ID, "dev")
	if err != nil || string(persisted.Payload) != payload || persisted.Revision != 1 {
		t.Fatal("persistence mismatch", err)
	}
}
func TestMemoriesConcurrentWritersAndValidation(t *testing.T) {
	s := testServer(t)
	u, token := login(t, s, "memory-race")
	route := "/v1/me/memories?environment=local"
	payload := memoryTestPayload(u.ID, "local")
	body := `{"revision":0,"payload":` + payload + `}`
	codes := make(chan int, 8)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); codes <- request(s, "PUT", route, body, token).Code }()
	}
	wg.Wait()
	close(codes)
	success := 0
	for code := range codes {
		if code == 200 {
			success++
		} else if code != 409 {
			t.Fatal(code)
		}
	}
	if success != 1 {
		t.Fatal("expected one writer", success)
	}
	for _, invalid := range []string{`{"revision":1,"payload":null}`, strings.Replace(body, `"version":2`, `"version":1`, 1), strings.Replace(body, `"environmentId":null`, `"environmentId":"dev"`, 1), strings.Replace(body, `"revision":1`, `"revision":0`, 1), strings.Replace(body, `"settings":[]`, `"settings":[{"owner":"`+u.ID+`","environmentId":null,"limit":999}]`, 1)} {
		if w := request(s, "PUT", route, invalid, token); w.Code != 400 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if w := request(s, "GET", "/v1/me/memories", "", token); w.Code != 400 {
		t.Fatal(w.Code)
	}
}
