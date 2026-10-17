package main

import (
	"context"
	"flag"
	"log"
	"os"
	"time"

	"kuneco/backend/internal/migration"
	"kuneco/backend/internal/server"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load(".env")
	source := flag.String("source", "data/accounts.db", "read-only SQLite source")
	flag.Parse()
	directory := os.Getenv("DATA_DIR")
	if directory == "" {
		directory = "data"
	}
	// Refuse generating a fresh key for existing encrypted records.
	if os.Getenv("DATA_ENCRYPTION_KEY") == "" {
		if _, err := os.Stat(directory + "/encryption.key"); err != nil {
			log.Fatal("original encryption.key is required")
		}
	}
	store, err := server.OpenStore(os.Getenv("DATABASE_URL"), directory, os.Getenv("DATA_ENCRYPTION_KEY"))
	if err != nil {
		log.Fatal(err)
	}
	defer store.DB.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err = migration.Import(ctx, store.DB, *source); err != nil {
		log.Fatal(err)
	}
	log.Print("SQLite import committed to PostgreSQL; retain the original encryption key and source backup")
}
