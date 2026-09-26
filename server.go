package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed web
var webFiles embed.FS

type hub struct {
	mu      sync.Mutex
	version int
	subs    map[chan int]bool
}

func (h *hub) bump() {
	h.mu.Lock()
	h.version++
	v := h.version
	for ch := range h.subs {
		select {
		case ch <- v:
		default:
		}
	}
	h.mu.Unlock()
}

// snapshot fingerprints every data file, so the server sees changes from agents and hand edits.
func snapshot(dir string) uint64 {
	h := fnv.New64a()
	add := func(p string) {
		if st, err := os.Stat(p); err == nil {
			fmt.Fprintf(h, "%s|%d|%d\n", p, st.Size(), st.ModTime().UnixNano())
		}
	}
	add(filepath.Join(dir, "projects.yml"))
	add(filepath.Join(dir, "views.yml"))
	filepath.WalkDir(filepath.Join(dir, "cards"), func(p string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(p, ".md") {
			add(p)
		}
		return nil
	})
	return h.Sum64()
}

func serve(dir, host, port string) error {
	if host == "" {
		host = "127.0.0.1"
	}
	if port == "" {
		port = "4747"
	}
	if _, err := loadBoard(dir); err != nil {
		return err
	}
	h := &hub{subs: map[chan int]bool{}}

	// Watch the data folder. Any change reaches open pages at once. A change nobody
	// committed (a hand edit) is committed after two quiet seconds.
	go func() {
		last := snapshot(dir)
		var changedAt time.Time
		for range time.Tick(700 * time.Millisecond) {
			if s := snapshot(dir); s != last {
				last = s
				changedAt = time.Now()
				h.bump()
			}
			if !changedAt.IsZero() && time.Since(changedAt) > 2*time.Second {
				changedAt = time.Time{}
				if err := withLock(dir, func() error { return commit(dir, "Hand edit") }); err != nil {
					log.Println("commit:", err)
				}
			}
		}
	}()
	// Back up to the private remote every five minutes.
	go func() {
		for range time.Tick(5 * time.Minute) {
			if out, err := push(dir); err != nil {
				log.Println("push:", out)
			}
		}
	}()

	mux := http.NewServeMux()
	fail := func(w http.ResponseWriter, err error) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
	}
	ok := func(w http.ResponseWriter, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(v)
	}
	who := func(r *http.Request) string {
		if a := r.Header.Get("X-Track-Actor"); a != "" {
			return a
		}
		return "me"
	}

	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		b, err := loadBoard(dir)
		if err != nil {
			fail(w, err)
			return
		}
		h.mu.Lock()
		v := h.version
		h.mu.Unlock()
		ok(w, map[string]any{"projects": b.allProjects(), "views": b.Views, "cards": b.Cards, "broken": b.Broken,
			"statuses": Statuses, "priorities": Priorities, "version": v})
	})
	mux.HandleFunc("POST /api/cards", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Project string `json:"project"`
			Title   string `json:"title"`
			Patch
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			fail(w, err)
			return
		}
		c, err := Create(dir, in.Project, in.Title, in.Patch, who(r))
		if err != nil {
			fail(w, err)
			return
		}
		h.bump()
		ok(w, c)
	})
	mux.HandleFunc("POST /api/capture", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Text string `json:"text"`
		}
		raw, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
		if err := json.Unmarshal(raw, &in); err != nil || in.Text == "" {
			in.Text = strings.TrimSpace(string(raw))
		}
		if in.Text == "" {
			fail(w, fmt.Errorf("nothing to add"))
			return
		}
		b, err := loadBoard(dir)
		if err != nil {
			fail(w, err)
			return
		}
		key, title := parseCapture(b, in.Text)
		if key == "" {
			key = inbox.Key
		}
		c, err := Create(dir, key, title, Patch{}, who(r))
		if err != nil {
			fail(w, err)
			return
		}
		h.bump()
		p, _ := b.project(c.Project)
		msg := fmt.Sprintf("Added %s to %s: %s", c.ID, p.Name, c.Title)
		// Siri reads a plain sentence back. Everything else gets the card.
		if r.URL.Query().Get("format") == "text" {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			fmt.Fprintln(w, msg)
			return
		}
		ok(w, map[string]any{"card": c, "message": msg})
	})
	mux.HandleFunc("PATCH /api/cards/{id}", func(w http.ResponseWriter, r *http.Request) {
		var p Patch
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			fail(w, err)
			return
		}
		c, err := Update(dir, r.PathValue("id"), p, who(r))
		if err != nil {
			fail(w, err)
			return
		}
		h.bump()
		ok(w, c)
	})
	mux.HandleFunc("POST /api/views", func(w http.ResponseWriter, r *http.Request) {
		var v View
		if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
			fail(w, err)
			return
		}
		if err := SetView(dir, v, false); err != nil {
			fail(w, err)
			return
		}
		h.bump()
		ok(w, v)
	})
	mux.HandleFunc("DELETE /api/views/{name}", func(w http.ResponseWriter, r *http.Request) {
		if err := SetView(dir, View{Name: r.PathValue("name")}, true); err != nil {
			fail(w, err)
			return
		}
		h.bump()
		ok(w, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/events", func(w http.ResponseWriter, r *http.Request) {
		fl, isFlusher := w.(http.Flusher)
		if !isFlusher {
			http.Error(w, "streaming not supported", 500)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		ch := make(chan int, 4)
		h.mu.Lock()
		h.subs[ch] = true
		h.mu.Unlock()
		defer func() {
			h.mu.Lock()
			delete(h.subs, ch)
			h.mu.Unlock()
		}()
		fmt.Fprintf(w, "retry: 2000\n\n")
		fl.Flush()
		ping := time.NewTicker(25 * time.Second)
		defer ping.Stop()
		for {
			select {
			case v := <-ch:
				fmt.Fprintf(w, "data: %d\n\n", v)
				fl.Flush()
			case <-ping.C:
				fmt.Fprintf(w, ": ping\n\n")
				fl.Flush()
			case <-r.Context().Done():
				return
			}
		}
	})
	static, _ := fs.Sub(webFiles, "web")
	files := http.FileServerFS(static)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})

	addr := net.JoinHostPort(host, port)
	fmt.Printf("Track is running at http://%s (data: %s)\n", addr, dir)
	return http.ListenAndServe(addr, mux)
}
