package server

import (
	"encoding/json"
	"testing"
)

func TestRuntimeRegistryAccountAndDeviceIsolation(t *testing.T) {
	s := testServer(t)
	_, a := login(t, s, "runtime-user-a")
	_, b := login(t, s, "runtime-user-b")
	route := "/v1/me/runtimes?host=machine-A"
	if request(s, "GET", route, "", "").Code != 401 {
		t.Fatal("anonymous read allowed")
	}
	var result struct {
		Registry *RuntimeRegistry `json:"registry"`
	}
	if err := json.Unmarshal(request(s, "GET", route, "", a).Body.Bytes(), &result); err != nil || result.Registry != nil {
		t.Fatal("new user has registry")
	}
	body := `{"hostName":"machine-A","checkedAt":"2026-10-14T12:00:00Z","runtimes":[{"id":"codex","name":"Codex","version":"codex-cli 0.142.5"}]}`
	if r := request(s, "PUT", "/v1/me/runtimes", body, a); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	restarted := New(s.cfg, s.store)
	if err := json.Unmarshal(request(restarted, "GET", route, "", a).Body.Bytes(), &result); err != nil || result.Registry == nil || len(result.Registry.Runtimes) != 1 {
		t.Fatal("registry not persisted")
	}
	for _, path := range []string{route, "/v1/me/runtimes?host=machine-B"} {
		token := b
		if path != route {
			token = a
		}
		result.Registry = nil
		if err := json.Unmarshal(request(s, "GET", path, "", token).Body.Bytes(), &result); err != nil || result.Registry != nil {
			t.Fatal("registry leaked to different account or device")
		}
	}
}

func TestRuntimeRegistryValidation(t *testing.T) {
	s := testServer(t)
	_, token := login(t, s, "runtime-validation")
	for _, body := range []string{
		`{"hostName":"A","checkedAt":"invalid","runtimes":[]}`,
		`{"hostName":"A","checkedAt":"2026-10-14T12:00:00Z","runtimes":[{"id":"unknown"}]}`,
		`{"hostName":"A","checkedAt":"2026-10-14T12:00:00Z","runtimes":[{"id":"cc"},{"id":"cc"}]}`,
		`{"hostName":"A","checkedAt":"2026-10-14T12:00:00Z","runtimes":[],"userId":"other"}`,
	} {
		if request(s, "PUT", "/v1/me/runtimes", body, token).Code != 400 {
			t.Fatal("invalid registry accepted")
		}
	}
}
