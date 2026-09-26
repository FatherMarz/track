package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const usage = `track: a local task board. Cards are markdown files in a git repo.

Usage:
  track init <folder>                     make a new data repo and point track at it
  track add <project> <title> [flags]     add a card
  track capture <words>                   add a card from spoken words ("fix the login bug under website")
  track list [--project p] [--status s] [--filter "..."] [--all]
  track show <id>
  track move <id> <status>                backlog, todo, in-progress, in-review, done, canceled
  track edit <id> [flags]
  track note <id> <text>
  track projects                          list projects
  track check                             list card files track cannot read
  track sync                              push the data repo to its remote
  track serve [--port 4747] [--host 127.0.0.1]

Card flags: --title --status --priority --label (repeatable) --labels a,b
            --assignee me|agent|none --parent ID --due YYYY-MM-DD --body text --project p
Global:     --json   machine-readable output
            --as me|agent   who made the change (default agent, or $TRACK_ACTOR)
            --data <folder> data repo (default from ~/.config/track/config.yml or $TRACK_DATA)
`

type args struct {
	pos   []string
	flags map[string][]string
}

func (a args) has(k string) bool { _, ok := a.flags[k]; return ok }
func (a args) get(k string) string {
	if v := a.flags[k]; len(v) > 0 {
		return v[len(v)-1]
	}
	return ""
}
func (a args) ptr(k string) *string {
	if !a.has(k) {
		return nil
	}
	v := a.get(k)
	return &v
}

var boolFlags = map[string]bool{"json": true, "all": true, "help": true}

func parseArgs(in []string) args {
	a := args{flags: map[string][]string{}}
	for i := 0; i < len(in); i++ {
		s := in[i]
		if s == "--" {
			a.pos = append(a.pos, in[i+1:]...)
			break
		}
		if strings.HasPrefix(s, "--") {
			k, v, eq := strings.Cut(s[2:], "=")
			if !eq && !boolFlags[k] && i+1 < len(in) {
				v = in[i+1]
				i++
			}
			a.flags[k] = append(a.flags[k], v)
			continue
		}
		a.pos = append(a.pos, s)
	}
	return a
}

func configPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "track", "config.yml")
}

func dataDir(a args) (string, error) {
	if d := a.get("data"); d != "" {
		return filepath.Abs(d)
	}
	if d := os.Getenv("TRACK_DATA"); d != "" {
		return d, nil
	}
	raw, err := os.ReadFile(configPath())
	if err == nil {
		if doc, err := parseMini(string(raw)); err == nil && str(doc, "data") != "" {
			return str(doc, "data"), nil
		}
	}
	return "", errors.New("no data repo set. Run \"track init <folder>\" first")
}

func actor(a args, fallback string) string {
	if v := a.get("as"); v != "" {
		return v
	}
	if v := os.Getenv("TRACK_ACTOR"); v != "" {
		return v
	}
	return fallback
}

func patchFrom(a args) Patch {
	p := Patch{Title: a.ptr("title"), Status: a.ptr("status"), Priority: a.ptr("priority"),
		Assignee: a.ptr("assignee"), Parent: a.ptr("parent"), Due: a.ptr("due"), Body: a.ptr("body"), Project: a.ptr("project")}
	if a.has("label") || a.has("labels") {
		var l []string
		l = append(l, a.flags["label"]...)
		for _, s := range a.flags["labels"] {
			l = append(l, strings.Split(s, ",")...)
		}
		p.Labels = &l
	}
	return p
}

func printJSON(v any) {
	e := json.NewEncoder(os.Stdout)
	e.SetIndent("", "  ")
	e.Encode(v)
}

func line(c *Card) string {
	extra := ""
	if c.Assignee != "" {
		extra += "  @" + c.Assignee
	}
	if len(c.Labels) > 0 {
		extra += "  [" + strings.Join(c.Labels, ", ") + "]"
	}
	if c.Due != "" {
		extra += "  due " + c.Due
	}
	return fmt.Sprintf("%-9s %-12s %-7s %s%s", c.ID, c.Status, c.Priority, c.Title, extra)
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "track:", err)
		os.Exit(1)
	}
}

func run(argv []string) error {
	if len(argv) == 0 || argv[0] == "help" || argv[0] == "--help" || argv[0] == "-h" {
		fmt.Print(usage)
		return nil
	}
	cmd, a := argv[0], parseArgs(argv[1:])
	if cmd == "init" {
		return cmdInit(a)
	}
	dir, err := dataDir(a)
	if err != nil {
		return err
	}
	who := actor(a, "agent")
	switch cmd {
	case "add":
		if len(a.pos) < 2 {
			return errors.New("usage: track add <project> <title>")
		}
		c, err := Create(dir, a.pos[0], strings.Join(a.pos[1:], " "), patchFrom(a), who)
		if err != nil {
			return err
		}
		return show(a, c)
	case "capture":
		text := strings.Join(a.pos, " ")
		if strings.TrimSpace(text) == "" {
			return errors.New("usage: track capture <words>")
		}
		b, err := loadBoard(dir)
		if err != nil {
			return err
		}
		key, title := parseCapture(b, text)
		if title == "" {
			return errors.New("nothing to add")
		}
		if key == "" {
			key = inbox.Key
		}
		c, err := Create(dir, key, title, Patch{}, actor(a, "me"))
		if err != nil {
			return err
		}
		if a.has("json") {
			printJSON(c)
			return nil
		}
		p, _ := b.project(c.Project)
		fmt.Printf("Added %s to %s: %s\n", c.ID, p.Name, c.Title)
		return nil
	case "list", "ls":
		b, err := loadBoard(dir)
		if err != nil {
			return err
		}
		filter := a.get("filter")
		if v := a.get("project"); v != "" {
			filter += " project:" + v
		}
		if v := a.get("status"); v != "" {
			filter += " status:" + v
		} else if !a.has("all") && !strings.Contains(filter, "status:") {
			filter += " status:open"
		}
		out := []*Card{}
		for _, c := range b.Cards {
			if matchFilter(b, c, filter) {
				out = append(out, c)
			}
		}
		sort.SliceStable(out, func(i, j int) bool {
			if out[i].Project != out[j].Project {
				return out[i].Project < out[j].Project
			}
			return indexOf(Statuses, out[i].Status) > indexOf(Statuses, out[j].Status)
		})
		if a.has("json") {
			printJSON(out)
			return nil
		}
		for _, c := range out {
			fmt.Println(line(c))
		}
		if len(b.Broken) > 0 {
			fmt.Fprintf(os.Stderr, "track: %d card file(s) cannot be read. Run \"track check\".\n", len(b.Broken))
		}
		return nil
	case "show":
		if len(a.pos) < 1 {
			return errors.New("usage: track show <id>")
		}
		b, err := loadBoard(dir)
		if err != nil {
			return err
		}
		c, ok := b.card(a.pos[0])
		if !ok {
			return fmt.Errorf("no card %s", a.pos[0])
		}
		return show(a, c)
	case "move", "mv":
		if len(a.pos) < 2 {
			return errors.New("usage: track move <id> <status>")
		}
		s := strings.Join(a.pos[1:], "-")
		c, err := Update(dir, a.pos[0], Patch{Status: &s}, who)
		if err != nil {
			return err
		}
		return show(a, c)
	case "edit":
		if len(a.pos) < 1 {
			return errors.New("usage: track edit <id> [flags]")
		}
		c, err := Update(dir, a.pos[0], patchFrom(a), who)
		if err != nil {
			return err
		}
		return show(a, c)
	case "note":
		if len(a.pos) < 2 {
			return errors.New("usage: track note <id> <text>")
		}
		n := strings.Join(a.pos[1:], " ")
		c, err := Update(dir, a.pos[0], Patch{Note: &n}, who)
		if err != nil {
			return err
		}
		return show(a, c)
	case "projects":
		b, err := loadBoard(dir)
		if err != nil {
			return err
		}
		if a.has("json") {
			printJSON(b.allProjects())
			return nil
		}
		for _, p := range b.allProjects() {
			fmt.Printf("%-8s %-6s %s  (%s)\n", p.Key, p.Prefix, p.Name, strings.Join(p.Aliases, ", "))
		}
		return nil
	case "check":
		b, err := loadBoard(dir)
		if err != nil {
			return err
		}
		if a.has("json") {
			printJSON(b.Broken)
		} else if len(b.Broken) == 0 {
			fmt.Printf("All %d cards read fine.\n", len(b.Cards))
		} else {
			for _, br := range b.Broken {
				fmt.Printf("%s: %s\n", br.Path, br.Error)
			}
		}
		if len(b.Broken) > 0 {
			os.Exit(1)
		}
		return nil
	case "sync":
		if err := withLock(dir, func() error { return commit(dir, "Hand edit") }); err != nil {
			return err
		}
		out, err := push(dir)
		if err != nil {
			return fmt.Errorf("push failed: %s", out)
		}
		fmt.Println("Synced.")
		return nil
	case "serve":
		return serve(dir, a.get("host"), a.get("port"))
	}
	return fmt.Errorf("unknown command %q. Run \"track help\"", cmd)
}

func indexOf(list []string, s string) int {
	for i, v := range list {
		if v == s {
			return i
		}
	}
	return -1
}

func show(a args, c *Card) error {
	if a.has("json") {
		printJSON(c)
		return nil
	}
	fmt.Println(line(c))
	if c.Body != "" {
		fmt.Println("\n" + c.Body)
	}
	if len(c.Activity) > 0 {
		fmt.Println()
		for _, l := range c.Activity {
			fmt.Println("  " + l)
		}
	}
	return nil
}

func cmdInit(a args) error {
	if len(a.pos) < 1 {
		return errors.New("usage: track init <folder>")
	}
	dir, err := filepath.Abs(a.pos[0])
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(dir, "cards", inbox.Key), 0o755); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
		if out, err := git(dir, "init", "-q", "-b", "main"); err != nil {
			return fmt.Errorf("git init: %s", out)
		}
	}
	pf := filepath.Join(dir, "projects.yml")
	if _, err := os.Stat(pf); err != nil {
		os.WriteFile(pf, []byte(`# Projects. Cards live in cards/<key>/. Aliases are the words "track capture" listens for.
projects:
  - key: work
    name: Work
    prefix: WORK
    color: "#5e6ad2"
    aliases: [job]
`), 0o644)
	}
	if _, err := os.Stat(filepath.Join(dir, "views.yml")); err != nil {
		saveViews(dir, []View{{Name: "Urgent", Filter: "priority:urgent status:open"}})
	}
	os.WriteFile(filepath.Join(dir, "cards", inbox.Key, ".keep"), nil, 0o644)
	if err := os.MkdirAll(filepath.Dir(configPath()), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(configPath(), []byte("data: "+quoteMini(dir)+"\n"), 0o644); err != nil {
		return err
	}
	if err := withLock(dir, func() error { return commit(dir, "track init") }); err != nil {
		return err
	}
	fmt.Printf("Data repo ready at %s. Edit projects.yml to add your projects.\n", dir)
	return nil
}
