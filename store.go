package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var Statuses = []string{"backlog", "todo", "in-progress", "in-review", "done", "canceled"}
var Priorities = []string{"urgent", "high", "medium", "low", "none"}
var Assignees = []string{"", "me", "agent"}

const timeFmt = "2006-01-02 15:04"

// The Inbox holds cards that arrive without a project. It is built in and not listed in projects.yml.
var inbox = Project{Key: "inbox", Name: "Inbox", Prefix: "IN", Color: "#8a8f98"}

type Project struct {
	Key     string   `json:"key"`
	Name    string   `json:"name"`
	Prefix  string   `json:"prefix"`
	Color   string   `json:"color"`
	Aliases []string `json:"aliases"`
	// Description says what work belongs here. Tools that sort incoming work read it.
	Description string `json:"description"`
}

type View struct {
	Name   string `json:"name"`
	Filter string `json:"filter"`
}

type Card struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Status   string   `json:"status"`
	Priority string   `json:"priority"`
	Labels   []string `json:"labels"`
	Assignee string   `json:"assignee"`
	Parent   string   `json:"parent"`
	Due      string   `json:"due"`
	Created  string   `json:"created"`
	Updated  string   `json:"updated"`
	Body     string   `json:"body"`
	Activity []string `json:"activity"`
	Project  string   `json:"project"`
	Path     string   `json:"-"`
}

type Broken struct {
	Path  string `json:"path"`
	Error string `json:"error"`
}

type Board struct {
	Dir      string    `json:"-"`
	Projects []Project `json:"projects"`
	Views    []View    `json:"views"`
	Cards    []*Card   `json:"cards"`
	Broken   []Broken  `json:"broken"`
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func loadBoard(dir string) (*Board, error) {
	b := &Board{Dir: dir, Cards: []*Card{}, Broken: []Broken{}, Views: []View{}}
	raw, err := os.ReadFile(filepath.Join(dir, "projects.yml"))
	if err != nil {
		return nil, fmt.Errorf("no projects.yml in %s (run \"track init\")", dir)
	}
	doc, err := parseMini(string(raw))
	if err != nil {
		return nil, fmt.Errorf("projects.yml: %v", err)
	}
	for _, n := range nodes(doc, "projects") {
		p := Project{Key: str(n, "key"), Name: str(n, "name"), Prefix: strings.ToUpper(str(n, "prefix")), Color: str(n, "color"), Aliases: strs(n, "aliases"), Description: str(n, "description")}
		if p.Key == "" || p.Prefix == "" {
			return nil, fmt.Errorf("projects.yml: every project needs key and prefix")
		}
		if p.Name == "" {
			p.Name = p.Key
		}
		if p.Color == "" {
			p.Color = "#5e6ad2"
		}
		b.Projects = append(b.Projects, p)
	}
	if raw, err := os.ReadFile(filepath.Join(dir, "views.yml")); err == nil {
		doc, err := parseMini(string(raw))
		if err != nil {
			b.Broken = append(b.Broken, Broken{"views.yml", err.Error()})
		} else {
			for _, n := range nodes(doc, "views") {
				b.Views = append(b.Views, View{Name: str(n, "name"), Filter: str(n, "filter")})
			}
		}
	}
	for _, p := range b.allProjects() {
		files, _ := filepath.Glob(filepath.Join(dir, "cards", p.Key, "*.md"))
		for _, f := range files {
			c, err := readCard(f)
			if err != nil {
				rel, _ := filepath.Rel(dir, f)
				b.Broken = append(b.Broken, Broken{rel, err.Error()})
				continue
			}
			c.Project = p.Key
			b.Cards = append(b.Cards, c)
		}
	}
	sort.Slice(b.Cards, func(i, j int) bool { return b.Cards[i].Updated > b.Cards[j].Updated })
	return b, nil
}

func (b *Board) allProjects() []Project {
	return append([]Project{inbox}, b.Projects...)
}

func (b *Board) project(key string) (Project, bool) {
	for _, p := range b.allProjects() {
		if strings.EqualFold(p.Key, key) || strings.EqualFold(p.Prefix, key) || strings.EqualFold(p.Name, key) {
			return p, true
		}
	}
	return Project{}, false
}

func (b *Board) card(id string) (*Card, bool) {
	for _, c := range b.Cards {
		if strings.EqualFold(c.ID, id) {
			return c, true
		}
	}
	return nil, false
}

func (b *Board) nextID(p Project) string {
	max := 0
	for _, c := range b.Cards {
		if n, ok := strings.CutPrefix(c.ID, p.Prefix+"-"); ok {
			if v, err := strconv.Atoi(n); err == nil && v > max {
				max = v
			}
		}
	}
	// Broken files still hold an id. Never hand it out twice.
	for _, br := range b.Broken {
		base := filepath.Base(br.Path)
		if n, ok := strings.CutPrefix(base, p.Prefix+"-"); ok {
			digits := strings.SplitN(n, "-", 2)[0]
			digits = strings.TrimSuffix(digits, ".md")
			if v, err := strconv.Atoi(digits); err == nil && v > max {
				max = v
			}
		}
	}
	return fmt.Sprintf("%s-%d", p.Prefix, max+1)
}

func readCard(path string) (*Card, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	text := strings.ReplaceAll(string(raw), "\r\n", "\n")
	if !strings.HasPrefix(text, "---\n") {
		return nil, errors.New("card must start with a --- header")
	}
	end := strings.Index(text[4:], "\n---")
	if end < 0 {
		return nil, errors.New("card header has no closing ---")
	}
	head := text[4 : 4+end]
	rest := strings.TrimPrefix(text[4+end+4:], "\n")
	doc, err := parseMini(head)
	if err != nil {
		return nil, err
	}
	c := &Card{
		ID: strings.ToUpper(str(doc, "id")), Title: str(doc, "title"), Status: str(doc, "status"),
		Priority: str(doc, "priority"), Labels: strs(doc, "labels"), Assignee: str(doc, "assignee"),
		Parent: str(doc, "parent"), Due: str(doc, "due"), Created: str(doc, "created"),
		Updated: str(doc, "updated"), Path: path, Activity: []string{},
	}
	if c.ID == "" || c.Title == "" {
		return nil, errors.New("card needs id and title")
	}
	if c.Priority == "" {
		c.Priority = "none"
	}
	if !contains(Statuses, c.Status) {
		return nil, fmt.Errorf("unknown status %q (use %s)", c.Status, strings.Join(Statuses, ", "))
	}
	if !contains(Priorities, c.Priority) {
		return nil, fmt.Errorf("unknown priority %q (use %s)", c.Priority, strings.Join(Priorities, ", "))
	}
	if !contains(Assignees, c.Assignee) {
		return nil, fmt.Errorf("unknown assignee %q (use me or agent)", c.Assignee)
	}
	body, act, found := strings.Cut(rest, "\n## Activity\n")
	if !found && strings.HasPrefix(rest, "## Activity\n") {
		body, act = "", strings.TrimPrefix(rest, "## Activity\n")
	}
	c.Body = strings.TrimSpace(body)
	for _, l := range strings.Split(act, "\n") {
		if s, ok := strings.CutPrefix(strings.TrimSpace(l), "- "); ok {
			c.Activity = append(c.Activity, s)
		}
	}
	return c, nil
}

func (c *Card) render() string {
	var s strings.Builder
	s.WriteString("---\n")
	fmt.Fprintf(&s, "id: %s\n", c.ID)
	fmt.Fprintf(&s, "title: %s\n", quoteMini(c.Title))
	fmt.Fprintf(&s, "status: %s\n", c.Status)
	fmt.Fprintf(&s, "priority: %s\n", c.Priority)
	fmt.Fprintf(&s, "labels: %s\n", listMini(c.Labels))
	if c.Assignee != "" {
		fmt.Fprintf(&s, "assignee: %s\n", c.Assignee)
	}
	if c.Parent != "" {
		fmt.Fprintf(&s, "parent: %s\n", c.Parent)
	}
	if c.Due != "" {
		fmt.Fprintf(&s, "due: %s\n", c.Due)
	}
	fmt.Fprintf(&s, "created: %s\n", quoteMini(c.Created))
	fmt.Fprintf(&s, "updated: %s\n", quoteMini(c.Updated))
	s.WriteString("---\n\n")
	if c.Body != "" {
		s.WriteString(c.Body + "\n\n")
	}
	s.WriteString("## Activity\n")
	for _, a := range c.Activity {
		s.WriteString("- " + a + "\n")
	}
	return s.String()
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func slug(title string) string {
	s := strings.Trim(slugRe.ReplaceAllString(strings.ToLower(title), "-"), "-")
	if len(s) > 50 {
		s = strings.TrimRight(s[:50], "-")
	}
	return s
}

func (b *Board) writeCard(c *Card) error {
	name := c.ID
	if s := slug(c.Title); s != "" {
		name += "-" + s
	}
	path := filepath.Join(b.Dir, "cards", c.Project, name+".md")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(c.render()), 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	if c.Path != "" && c.Path != path {
		os.Remove(c.Path)
	}
	c.Path = path
	return nil
}

// withLock runs fn while holding a file lock, so the web page, agents and hand edits never write at once.
func withLock(dir string, fn func() error) error {
	f, err := os.OpenFile(filepath.Join(dir, ".git", "track.lock"), os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	return fn()
}

type Patch struct {
	Title    *string   `json:"title"`
	Status   *string   `json:"status"`
	Priority *string   `json:"priority"`
	Labels   *[]string `json:"labels"`
	Assignee *string   `json:"assignee"`
	Parent   *string   `json:"parent"`
	Due      *string   `json:"due"`
	Body     *string   `json:"body"`
	Project  *string   `json:"project"`
	Note     *string   `json:"note"`
}

func now() string { return time.Now().Format(timeFmt) }

func normStatus(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(strings.ReplaceAll(s, " ", "-"), "_", "-")
	switch s {
	case "progress", "doing", "started", "inprogress", "wip":
		s = "in-progress"
	case "review", "inreview":
		s = "in-review"
	case "cancel", "cancelled":
		s = "canceled"
	}
	if !contains(Statuses, s) {
		return "", fmt.Errorf("unknown status %q (use %s)", s, strings.Join(Statuses, ", "))
	}
	return s, nil
}

func normPriority(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	switch s {
	case "0", "no":
		s = "none"
	case "1", "p0":
		s = "urgent"
	case "2", "p1":
		s = "high"
	case "3", "p2", "med":
		s = "medium"
	case "4", "p3":
		s = "low"
	}
	if !contains(Priorities, s) {
		return "", fmt.Errorf("unknown priority %q (use %s)", s, strings.Join(Priorities, ", "))
	}
	return s, nil
}

// Create adds a card and commits it. It reloads from disk inside the lock so ids never collide.
func Create(dir, projectKey, title string, p Patch, actor string) (*Card, error) {
	var out *Card
	err := withLock(dir, func() error {
		b, err := loadBoard(dir)
		if err != nil {
			return err
		}
		proj, ok := b.project(projectKey)
		if !ok {
			return fmt.Errorf("no project %q", projectKey)
		}
		title = strings.TrimSpace(title)
		if title == "" {
			return errors.New("a card needs a title")
		}
		t := now()
		c := &Card{ID: b.nextID(proj), Title: title, Status: "todo", Priority: "none", Labels: []string{},
			Created: t, Updated: t, Project: proj.Key, Activity: []string{t + " " + actor + ": created"}}
		p.Title = nil
		if _, err := applyPatch(b, c, p, actor, t); err != nil {
			return err
		}
		c.Activity = c.Activity[:1]
		if err := b.writeCard(c); err != nil {
			return err
		}
		out = c
		return commit(dir, fmt.Sprintf("%s: created (%s)", c.ID, actor))
	})
	return out, err
}

// Update changes a card and commits it.
func Update(dir, id string, p Patch, actor string) (*Card, error) {
	var out *Card
	err := withLock(dir, func() error {
		b, err := loadBoard(dir)
		if err != nil {
			return err
		}
		c, ok := b.card(id)
		if !ok {
			return fmt.Errorf("no card %s", id)
		}
		t := now()
		changes, err := applyPatch(b, c, p, actor, t)
		if err != nil {
			return err
		}
		if len(changes) == 0 {
			out = c
			return nil
		}
		c.Updated = t
		if err := b.writeCard(c); err != nil {
			return err
		}
		out = c
		return commit(dir, fmt.Sprintf("%s: %s (%s)", c.ID, strings.Join(changes, ", "), actor))
	})
	return out, err
}

func applyPatch(b *Board, c *Card, p Patch, actor, t string) ([]string, error) {
	var changes []string
	log := func(s string) {
		changes = append(changes, s)
		c.Activity = append(c.Activity, t+" "+actor+": "+s)
	}
	if p.Title != nil && strings.TrimSpace(*p.Title) != "" && strings.TrimSpace(*p.Title) != c.Title {
		c.Title = strings.TrimSpace(*p.Title)
		log("renamed to \"" + c.Title + "\"")
	}
	if p.Status != nil {
		s, err := normStatus(*p.Status)
		if err != nil {
			return nil, err
		}
		if s != c.Status {
			log(c.Status + " → " + s)
			c.Status = s
		}
	}
	if p.Priority != nil {
		s, err := normPriority(*p.Priority)
		if err != nil {
			return nil, err
		}
		if s != c.Priority {
			c.Priority = s
			log("priority " + s)
		}
	}
	if p.Labels != nil {
		l := []string{}
		for _, v := range *p.Labels {
			if v = strings.TrimSpace(v); v != "" && !contains(l, v) {
				l = append(l, v)
			}
		}
		if strings.Join(l, ",") != strings.Join(c.Labels, ",") {
			c.Labels = l
			log("labels [" + strings.Join(l, ", ") + "]")
		}
	}
	if p.Assignee != nil {
		a := strings.ToLower(strings.TrimSpace(*p.Assignee))
		if a == "none" || a == "nobody" {
			a = ""
		}
		if !contains(Assignees, a) {
			return nil, fmt.Errorf("unknown assignee %q (use me, agent or none)", a)
		}
		if a != c.Assignee {
			c.Assignee = a
			if a == "" {
				log("unassigned")
			} else {
				log("assigned to " + a)
			}
		}
	}
	if p.Parent != nil && strings.ToUpper(*p.Parent) != c.Parent {
		c.Parent = strings.ToUpper(strings.TrimSpace(*p.Parent))
		log("parent " + c.Parent)
	}
	if p.Due != nil && *p.Due != c.Due {
		d := strings.TrimSpace(*p.Due)
		if d != "" {
			if _, err := time.Parse("2006-01-02", d); err != nil {
				return nil, fmt.Errorf("due date must look like 2026-10-01")
			}
		}
		c.Due = d
		if d == "" {
			log("due date removed")
		} else {
			log("due " + d)
		}
	}
	if p.Body != nil && strings.TrimSpace(*p.Body) != c.Body {
		c.Body = strings.TrimSpace(*p.Body)
		log("description edited")
	}
	if p.Project != nil {
		proj, ok := b.project(*p.Project)
		if !ok {
			return nil, fmt.Errorf("no project %q", *p.Project)
		}
		if proj.Key != c.Project {
			old := c.ID
			c.ID = b.nextID(proj)
			c.Project = proj.Key
			log("moved from " + old + " to " + proj.Name)
		}
	}
	if p.Note != nil && strings.TrimSpace(*p.Note) != "" {
		n := strings.Join(strings.Fields(*p.Note), " ")
		changes = append(changes, "note")
		c.Activity = append(c.Activity, t+" "+actor+" noted: "+n)
	}
	return changes, nil
}

func saveViews(dir string, views []View) error {
	var s strings.Builder
	s.WriteString("# Saved views. Filter words: project: status: priority: label: assignee: plus any search text.\nviews:\n")
	for _, v := range views {
		fmt.Fprintf(&s, "  - name: %s\n    filter: %s\n", quoteMini(v.Name), quoteMini(v.Filter))
	}
	return os.WriteFile(filepath.Join(dir, "views.yml"), []byte(s.String()), 0o644)
}

func SetView(dir string, v View, remove bool) error {
	return withLock(dir, func() error {
		b, err := loadBoard(dir)
		if err != nil {
			return err
		}
		out := []View{}
		for _, old := range b.Views {
			if !strings.EqualFold(old.Name, v.Name) {
				out = append(out, old)
			}
		}
		msg := "view " + v.Name + " removed"
		if !remove {
			if strings.TrimSpace(v.Name) == "" {
				return errors.New("a view needs a name")
			}
			out = append(out, v)
			msg = "view " + v.Name + " saved"
		}
		if err := saveViews(dir, out); err != nil {
			return err
		}
		return commit(dir, msg)
	})
}
