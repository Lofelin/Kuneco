package server

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

func TestChatObjectsEncryptedOwnerScopedAndIdempotent(t *testing.T) {
	s := testServer(t)
	a, ta := login(t, s, "objects-a")
	_, tb := login(t, s, "objects-b")
	data := `{"data":"private attachment","next":null}`
	hash := sha256.Sum256([]byte(data))
	id := hex.EncodeToString(hash[:])
	route := "/v1/me/chat-objects/_local/" + id
	for i := 0; i < 2; i++ {
		if w := request(s, "PUT", route, data, ta); w.Code != 200 {
			t.Fatalf("save: %d %s", w.Code, w.Body.String())
		}
	}
	if w := request(s, "GET", route, "", ta); w.Code != 200 || w.Body.String() != data {
		t.Fatal("roundtrip failed")
	}
	if w := request(s, "GET", strings.Replace(route, "/_local/", "/00000000-0000-0000-0000-000000000000/", 1), "", ta); w.Code != 404 {
		t.Fatal("cross-environment read")
	}
	if w := request(s, "GET", route, "", tb); w.Code != 404 {
		t.Fatal("cross-owner read")
	}
	if w := request(s, "GET", route, "", ""); w.Code != 401 {
		t.Fatal("anonymous read")
	}
	if w := request(s, "PUT", route, `{"data":"changed","next":null}`, ta); w.Code != 400 {
		t.Fatal("bad hash accepted")
	}
	var encrypted []byte
	if err := s.store.DB.QueryRow("SELECT payload FROM chat_objects WHERE user_id=$1 AND object_id=$2", a.ID, id).Scan(&encrypted); err != nil || strings.Contains(string(encrypted), "private attachment") {
		t.Fatal("unencrypted object")
	}
}
