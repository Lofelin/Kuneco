package server

import "testing"

func TestGoogleOAuthCredentials(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "")
	t.Setenv("GOOGLE_CLIENT_SECRET", "")
	id, secret := GoogleOAuthCredentials()
	if id == "" || secret == "" {
		t.Fatal("fresh installations must have a bundled OAuth client")
	}
	t.Setenv("GOOGLE_CLIENT_ID", "custom-client")
	t.Setenv("GOOGLE_CLIENT_SECRET", "custom-secret")
	id, secret = GoogleOAuthCredentials()
	if id != "custom-client" || secret != "custom-secret" {
		t.Fatal("local OAuth configuration must override the bundled client")
	}
	t.Setenv("GOOGLE_CLIENT_SECRET", "")
	id, secret = GoogleOAuthCredentials()
	if id != "custom-client" || secret != "" {
		t.Fatal("partial overrides must not mix credentials from different clients")
	}
}
