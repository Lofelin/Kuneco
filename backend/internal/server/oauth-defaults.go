package server

import (
	_ "embed"
	"encoding/json"
	"os"
)

// Shared OAuth client for source installations. User tokens and database secrets
// are never part of this configuration. Local overrides must supply both fields.
//
//go:embed google-oauth.json
var defaultGoogleOAuth []byte

func GoogleOAuthCredentials() (clientID, clientSecret string) {
	clientID, clientSecret = os.Getenv("GOOGLE_CLIENT_ID"), os.Getenv("GOOGLE_CLIENT_SECRET")
	if clientID != "" || clientSecret != "" {
		return
	}
	var defaults struct {
		ClientID     string `json:"client_id"`
		ClientSecret string `json:"client_secret"`
	}
	if err := json.Unmarshal(defaultGoogleOAuth, &defaults); err != nil {
		panic("invalid bundled Google OAuth configuration")
	}
	return defaults.ClientID, defaults.ClientSecret
}
