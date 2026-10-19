package main

import (
	"github.com/joho/godotenv"
	"kuneco/backend/internal/server"
	"log"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"time"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func main() {
	_ = godotenv.Load(".env")
	publicURL := strings.TrimRight(env("PUBLIC_URL", "http://localhost:8787"), "/")
	parsed, err := url.Parse(publicURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "localhost" || parsed.Hostname() == "127.0.0.1"))) {
		log.Fatal("PUBLIC_URL must be HTTPS or localhost HTTP")
	}
	googleClientID, googleClientSecret := server.GoogleOAuthCredentials()
	cfg := server.Config{PublicURL: publicURL, GoogleClientID: googleClientID, GoogleClientSecret: googleClientSecret}
	for _, raw := range strings.Split(os.Getenv("TRUSTED_PROXY_CIDRS"), ",") {
		if strings.TrimSpace(raw) != "" {
			prefix, err := netip.ParsePrefix(strings.TrimSpace(raw))
			if err != nil {
				log.Fatal("invalid trusted proxy CIDR")
			}
			cfg.TrustedProxies = append(cfg.TrustedProxies, prefix)
		}
	}
	store, err := server.OpenStore(os.Getenv("DATABASE_URL"), env("DATA_DIR", "data"), os.Getenv("DATA_ENCRYPTION_KEY"))
	if err != nil {
		log.Fatal("cannot open account store: ", err)
	}
	defer store.DB.Close()
	app := server.New(cfg, store)
	listener := env("LISTEN_ADDR", "127.0.0.1:8787")
	httpServer := &http.Server{Addr: listener, Handler: app.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 45 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	log.Printf("account service listening on %s; Google OAuth configured: %t", listener, cfg.GoogleClientID != "" && cfg.GoogleClientSecret != "")
	log.Fatal(httpServer.ListenAndServe())
}
