package server

import (
	"encoding/json"
	"strings"
	"sync"
	"testing"
)

func TestPasswordRegistrationLoginAndIsolation(t *testing.T) {
	s := testServer(t)
	login := func(name, password string) (User, string, int) {
		body, _ := json.Marshal(map[string]string{"username": name, "password": password, "confirmPassword": password})
		res := request(s, "POST", "/v1/auth/password", string(body), "")
		var result struct {
			User  User   `json:"user"`
			Token string `json:"token"`
		}
		json.Unmarshal(res.Body.Bytes(), &result)
		return result.User, result.Token, res.Code
	}
	first, token, status := login("神农", "fixture-secret-123")
	if status != 200 || first.ID == "" {
		t.Fatal("registration failed", status)
	}
	if first.Username != "神农" {
		t.Fatal("username missing")
	}
	if request(s, "PUT", "/v1/me/proxy", `{"protocol":"http","host":"198.51.100.20","port":8080,"username":"test","password":"private"}`, token).Code != 200 {
		t.Fatal("save proxy failed")
	}
	request(s, "POST", "/v1/auth/logout", "{}", token)
	again, token2, status := login("神农", "fixture-secret-123")
	if status != 200 || first.ID != again.ID {
		t.Fatal("account changed on login")
	}
	if request(s, "GET", "/v1/me/proxy", "", token2).Code != 200 {
		t.Fatal("restore failed")
	}
	if _, _, code := login("神农", "wrong-password"); code != 400 {
		t.Fatal("wrong password accepted")
	}
	other, otherToken, status := login("女娲", "other-secret-123")
	if status != 200 || other.ID == first.ID {
		t.Fatal("accounts not isolated")
	}
	if strings.Contains(request(s, "GET", "/v1/me/proxy", "", otherToken).Body.String(), "198.51.100.20") {
		t.Fatal("proxy leaked")
	}
	var encoded string
	if err := s.store.DB.QueryRow("SELECT password_hash FROM password_credentials WHERE username=$1", "神农").Scan(&encoded); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(encoded, "fixture-secret") {
		t.Fatal("plaintext password stored")
	}
	if request(s, "GET", "/v1/me", "", token).Code != 401 {
		t.Fatal("logout token still valid")
	}
}
func TestConcurrentPasswordRegistration(t *testing.T) {
	s := testServer(t)
	var wg sync.WaitGroup
	ids := make(chan string, 3)
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			u, _, err := s.store.PasswordLogin("concurrent", "fixture-password", "ip", "peer", "agent")
			if err != nil {
				t.Error(err)
				return
			}
			ids <- u.ID
		}()
	}
	wg.Wait()
	close(ids)
	var id string
	for next := range ids {
		if id != "" && id != next {
			t.Fatal("duplicate account")
		}
		id = next
	}
}

func TestPasswordConfirmationRequired(t *testing.T) {
	s := testServer(t)
	for _, confirm := range []string{"", "different"} {
		res := request(s, "POST", "/v1/auth/password", `{"username":"new-user","password":"fixture-password","confirmPassword":"`+confirm+`"}`, "")
		if res.Code != 400 {
			t.Fatal("confirmation mismatch accepted")
		}
	}
	var count int
	s.store.DB.QueryRow("SELECT count(*) FROM password_credentials").Scan(&count)
	if count != 0 {
		t.Fatal("invalid confirmation created an account")
	}
}
