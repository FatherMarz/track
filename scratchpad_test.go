package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestScratchpadSurvivesRestartAndClearRemovesIt(t *testing.T) {
	dir := testRepo(t)
	if err := initJourney(dir); err != nil {
		t.Fatal(err)
	}
	s := &scratchpadStore{path: filepath.Join(t.TempDir(), "notes", "pad.json")}
	text := "Call tomorrow\nA loose thought, not a task. 📝"
	if err := s.write(text); err != nil {
		t.Fatal(err)
	}
	restarted := &scratchpadStore{path: s.path}
	note, err := restarted.read()
	if err != nil || note.Text != text {
		t.Fatalf("lost scratchpad: %+v %v", note, err)
	}
	info, _ := os.Stat(s.path)
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("note permissions: %o", info.Mode().Perm())
	}
	if err := restarted.write(""); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.path); !os.IsNotExist(err) {
		t.Fatalf("clear retained the note: %v", err)
	}
	note, err = (&scratchpadStore{path: s.path}).read()
	if err != nil || note.Text != "" {
		t.Fatalf("cleared note returned after restart: %+v %v", note, err)
	}
	if status, _ := git(dir, "status", "--porcelain"); status != "" {
		t.Fatalf("scratchpad changed board history: %s", status)
	}
}

func TestScratchpadHTTPPersistsTextAndRejectsBadWrites(t *testing.T) {
	s := &scratchpadStore{path: filepath.Join(t.TempDir(), "pad.json")}
	call := func(method, body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		s.serveHTTP(w, httptest.NewRequest(method, "/api/scratchpad", strings.NewReader(body)))
		return w
	}
	if w := call("PUT", `{"text":"A thought"}`); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := call("PUT", `invalid`); w.Code != 400 {
		t.Fatalf("bad JSON accepted: %d", w.Code)
	}
	raw, _ := json.Marshal(scratchpadNote{Text: strings.Repeat("x", 65<<10)})
	if w := call("PUT", string(raw)); w.Code != 400 {
		t.Fatalf("oversized note accepted: %d", w.Code)
	}
	w := call("GET", "")
	var note scratchpadNote
	if err := json.Unmarshal(w.Body.Bytes(), &note); err != nil || note.Text != "A thought" {
		t.Fatalf("valid note overwritten: %s", w.Body)
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("scratchpad can be cached")
	}
	if w := call("DELETE", ""); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := call("GET", ""); !strings.Contains(w.Body.String(), `"text":""`) {
		t.Fatal(w.Body.String())
	}
}

func TestScratchpadIsScopedToBoardNotDirectoryAlias(t *testing.T) {
	t.Setenv("TRACK_SCRATCHPAD_DIR", t.TempDir())
	board := t.TempDir()
	alias := filepath.Join(t.TempDir(), "board")
	if err := os.Symlink(board, alias); err != nil {
		t.Fatal(err)
	}
	a, err := newScratchpadStore(board)
	if err != nil {
		t.Fatal(err)
	}
	b, err := newScratchpadStore(alias)
	if err != nil {
		t.Fatal(err)
	}
	c, err := newScratchpadStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if a.path != b.path || a.path == c.path {
		t.Fatal("scratchpad identity is incorrect")
	}
}
