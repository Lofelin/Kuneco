package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/joho/godotenv"
)

// Opt-in, read-only verification of the app's migrated scope in its actual DB.
func TestMemoryLiveBackendPersistence(t *testing.T) {
	owner, environment := os.Getenv("KUNECO_MEMORY_LIVE_OWNER"), os.Getenv("KUNECO_MEMORY_LIVE_ENVIRONMENT")
	if owner == "" || environment == "" {
		t.Skip("set KUNECO_MEMORY_LIVE_OWNER and KUNECO_MEMORY_LIVE_ENVIRONMENT for read-only live verification")
	}
	values, err := godotenv.Read("../../.env")
	if err != nil {
		t.Fatal("backend configuration unavailable")
	}
	directory := values["DATA_DIR"]
	if directory == "" {
		directory = "data"
	}
	if !filepath.IsAbs(directory) {
		directory = filepath.Join("../..", directory)
	}
	store, err := OpenStore(values["DATABASE_URL"], directory, values["DATA_ENCRYPTION_KEY"])
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	snapshot, err := store.Memories(owner, environment)
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		Items   []json.RawMessage `json:"items"`
		Jobs    []json.RawMessage `json:"jobs"`
		Imports []string          `json:"imports"`
	}
	if json.Unmarshal(snapshot.Payload, &payload) != nil || snapshot.Revision < 1 || len(payload.Imports) < 1 {
		t.Fatal("migrated server snapshot missing")
	}
	var encrypted []byte
	if err = store.DB.QueryRow("SELECT payload FROM memory_states WHERE user_id=$1 AND environment=$2", owner, environment).Scan(&encrypted); err != nil {
		t.Fatal(err)
	}
	if json.Valid(encrypted) {
		t.Fatal("database payload is not encrypted")
	}
	t.Logf("server revision=%d items=%d jobs=%d migrations=%d encrypted=true", snapshot.Revision, len(payload.Items), len(payload.Jobs), len(payload.Imports))
}
