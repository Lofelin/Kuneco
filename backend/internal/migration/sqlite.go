// Package migration provides a one-time, read-only SQLite import into PostgreSQL.
// The account server does not import this package or use a SQLite fallback.
package migration

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// Import copies IDs, session hashes and encrypted bytes verbatim. It refuses
// nonempty targets and commits all four tables atomically. Keep the original
// encryption key alongside the PostgreSQL deployment.
func Import(ctx context.Context, destination *sql.DB, sourcePath string) error {
	absolute, err := filepath.Abs(sourcePath)
	if err != nil {
		return err
	}
	sourceURL := url.URL{Scheme: "file", Path: absolute, RawQuery: "mode=ro"}
	source, err := sql.Open("sqlite", sourceURL.String())
	if err != nil {
		return err
	}
	defer source.Close()
	source.SetMaxOpenConns(1)
	// Use one SQLite snapshot even if the caller has not stopped the old server.
	snapshot, err := source.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer snapshot.Rollback()
	tx, err := destination.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "LOCK TABLE users,sessions,login_events,proxies IN ACCESS EXCLUSIVE MODE"); err != nil {
		return err
	}
	for _, table := range []string{"users", "sessions", "login_events", "proxies"} {
		var count int
		if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM "+table).Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			return errors.New("migration requires an empty PostgreSQL account database")
		}
	}
	definitions := []struct {
		table, columns, placeholders string
		size                         int
	}{
		{"users", "id,google_sub,email,name,profile", "$1,$2,$3,$4,$5", 5},
		{"sessions", "token_hash,user_id,expires", "$1,$2,$3", 3},
		{"login_events", "id,user_id,ip,peer_ip,ip_source,user_agent,created_at", "$1,$2,$3,$4,$5,$6,$7", 7},
		{"proxies", "user_id,config,updated_at", "$1,$2,$3", 3},
	}
	for _, d := range definitions {
		rows, err := snapshot.QueryContext(ctx, "SELECT "+d.columns+" FROM "+d.table)
		if err != nil {
			return fmt.Errorf("read %s: %w", d.table, err)
		}
		for rows.Next() {
			values := make([]any, d.size)
			pointers := make([]any, d.size)
			for i := range values {
				pointers[i] = &values[i]
			}
			if err = rows.Scan(pointers...); err != nil {
				rows.Close()
				return err
			}
			if _, err = tx.ExecContext(ctx, "INSERT INTO "+d.table+"("+d.columns+") VALUES("+d.placeholders+")", values...); err != nil {
				rows.Close()
				return fmt.Errorf("import %s: %w", d.table, err)
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
	}
	// Restart identity after copied SQLite IDs, including empty source databases.
	if _, err = tx.ExecContext(ctx, `SELECT setval(pg_get_serial_sequence('login_events','id'),COALESCE(MAX(id),1),COUNT(*)>0) FROM login_events`); err != nil {
		return err
	}
	return tx.Commit()
}
