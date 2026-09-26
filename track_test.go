package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func testRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		if out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s", args, out)
		}
	}
	run("init", "-q", "-b", "main")
	run("config", "user.email", "test@example.com")
	run("config", "user.name", "test")
	os.WriteFile(filepath.Join(dir, "projects.yml"), []byte(`projects:
  - key: web
    name: Web
    prefix: WEB
    color: "#5e6ad2"
    aliases: [website]
  - key: home
    name: Home
    prefix: HOME
    aliases: [house, "the house"]
`), 0o644)
	return dir
}

func TestMini(t *testing.T) {
	doc, err := parseMini("title: \"Fix: the thing\"\nlabels: [a, \"b, c\"]\nlist:\n  - name: x\n    tags: [y]\n  - name: z\n")
	if err != nil {
		t.Fatal(err)
	}
	if str(doc, "title") != "Fix: the thing" {
		t.Errorf("title = %q", str(doc, "title"))
	}
	if l := strs(doc, "labels"); len(l) != 2 || l[1] != "b, c" {
		t.Errorf("labels = %v", l)
	}
	if n := nodes(doc, "list"); len(n) != 2 || str(n[1], "name") != "z" || strs(n[0], "tags")[0] != "y" {
		t.Errorf("list = %v", n)
	}
}

func TestCardRoundTrip(t *testing.T) {
	dir := testRepo(t)
	c, err := Create(dir, "web", "Fix: crawler, timeout", Patch{}, "agent")
	if err != nil {
		t.Fatal(err)
	}
	if c.ID != "WEB-1" || c.Status != "todo" {
		t.Fatalf("got %s %s", c.ID, c.Status)
	}
	s, l, n := "in progress", []string{"bug", "crawler"}, "Found the cause"
	if _, err := Update(dir, "web-1", Patch{Status: &s, Labels: &l, Note: &n}, "me"); err != nil {
		t.Fatal(err)
	}
	b, _ := loadBoard(dir)
	got, ok := b.card("WEB-1")
	if !ok || got.Status != "in-progress" || len(got.Labels) != 2 || got.Title != "Fix: crawler, timeout" {
		t.Fatalf("reloaded card wrong: %+v", got)
	}
	if !strings.Contains(strings.Join(got.Activity, "\n"), "me noted: Found the cause") {
		t.Errorf("activity missing note: %v", got.Activity)
	}
	c2, _ := Create(dir, "web", "Second", Patch{}, "agent")
	if c2.ID != "WEB-2" {
		t.Errorf("next id = %s", c2.ID)
	}
	p := "home"
	moved, err := Update(dir, "WEB-2", Patch{Project: &p}, "me")
	if err != nil || moved.ID != "HOME-1" {
		t.Fatalf("move: %v %v", moved, err)
	}
	if files, _ := filepath.Glob(filepath.Join(dir, "cards", "web", "WEB-2*")); len(files) != 0 {
		t.Errorf("old file left behind: %v", files)
	}
}

func TestBrokenCardIsFlaggedNotDropped(t *testing.T) {
	dir := testRepo(t)
	os.MkdirAll(filepath.Join(dir, "cards", "web"), 0o755)
	os.WriteFile(filepath.Join(dir, "cards", "web", "WEB-7-bad.md"), []byte("---\nid: WEB-7\ntitle: x\nstatus: nope\n---\n"), 0o644)
	b, err := loadBoard(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Broken) != 1 {
		t.Fatalf("broken = %v", b.Broken)
	}
	c, _ := Create(dir, "web", "New", Patch{}, "agent")
	if c.ID != "WEB-8" {
		t.Errorf("id reused a broken card's number: %s", c.ID)
	}
}

func TestCapture(t *testing.T) {
	dir := testRepo(t)
	b, _ := loadBoard(dir)
	cases := []struct{ in, key, title string }{
		{"fix the login timeout under website", "web", "Fix the login timeout"},
		{"call the plumber about the leak for the house.", "home", "Call the plumber about the leak"},
		{"Website: ship the pricing page", "web", "Ship the pricing page"},
		{"buy milk", "", "Buy milk"},
	}
	for _, tc := range cases {
		k, title := parseCapture(b, tc.in)
		if k != tc.key || title != tc.title {
			t.Errorf("%q → (%q, %q), want (%q, %q)", tc.in, k, title, tc.key, tc.title)
		}
	}
}
