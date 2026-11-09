package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

// Scratch notes are mutable local state, deliberately outside the board's git
// repository. Clearing a pad removes the file instead of recording its contents.
type scratchpadStore struct {
	mu   sync.Mutex
	path string
}

type scratchpadNote struct {
	Text string `json:"text"`
}

func newScratchpadStore(boardDir string) (*scratchpadStore, error) {
	root := os.Getenv("TRACK_SCRATCHPAD_DIR")
	if root == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		root = filepath.Join(home, ".local", "share", "track", "scratchpads")
	}
	canonical, err := filepath.Abs(boardDir)
	if err != nil {
		return nil, err
	}
	if resolved, err := filepath.EvalSymlinks(canonical); err == nil {
		canonical = resolved
	}
	key := fmt.Sprintf("%x", sha256.Sum256([]byte(canonical)))
	return &scratchpadStore{path: filepath.Join(root, key+".json")}, nil
}

func (s *scratchpadStore) read() (scratchpadNote, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	raw, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return scratchpadNote{}, nil
	}
	if err != nil {
		return scratchpadNote{}, err
	}
	var note scratchpadNote
	err = json.Unmarshal(raw, &note)
	return note, err
}

func (s *scratchpadStore) write(text string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(text) > 64<<10 {
		return errors.New("keep the scratchpad under 64 KB")
	}
	if text == "" {
		if err := os.Remove(s.path + ".tmp"); err != nil && !os.IsNotExist(err) {
			return err
		}
		if err := os.Remove(s.path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	raw, err := json.Marshal(scratchpadNote{Text: text})
	if err != nil {
		return err
	}
	if err := os.WriteFile(s.path+".tmp", raw, 0o600); err != nil {
		return err
	}
	return os.Rename(s.path+".tmp", s.path)
}

func (s *scratchpadStore) serveHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	fail := func(status int, message string) {
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]string{"error": message})
	}
	switch r.Method {
	case http.MethodGet:
		note, err := s.read()
		if err != nil {
			fail(500, "Could not read the scratchpad.")
			return
		}
		json.NewEncoder(w).Encode(note)
	case http.MethodPut, http.MethodDelete:
		var note scratchpadNote
		if r.Method == http.MethodPut {
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10)).Decode(&note); err != nil {
				fail(400, "Could not read the scratchpad text.")
				return
			}
			if len(note.Text) > 64<<10 {
				fail(400, "Keep the scratchpad under 64 KB.")
				return
			}
		}
		if err := s.write(note.Text); err != nil {
			fail(500, "Could not save the scratchpad. Your draft stays on this device.")
			return
		}
		json.NewEncoder(w).Encode(note)
	default:
		w.Header().Set("Allow", "GET, PUT, DELETE")
		fail(405, "Method not allowed.")
	}
}
