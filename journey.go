package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Journey lives with the board, in git. Victories preserve the title, project,
// date and reflection that existed when the result was accepted.
type Journey struct {
	Version    int            `json:"version"`
	Started    string         `json:"started"`
	Victories  []Victory      `json:"victories"`
	Milestones []Milestone    `json:"milestones"`
	Quests     []Quest        `json:"quests"`
	Personal   []PersonalTask `json:"personal"`
	Chapters   []Chapter      `json:"chapters"`
}

type Chapter struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Started     string `json:"started"`
	Created     string `json:"created"`
}

type PersonalTask struct {
	Date    string `json:"date"`
	CardUID string `json:"card_uid"`
	Title   string `json:"title"`
}

type Victory struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"` // card, milestone, earlier
	CardUID     string `json:"card_uid,omitempty"`
	CardID      string `json:"card_id,omitempty"`
	MilestoneID string `json:"milestone_id,omitempty"`
	Title       string `json:"title"`
	Project     string `json:"project"`
	ProjectName string `json:"project_name"`
	At          string `json:"at"`
	AcceptedAt  string `json:"accepted_at,omitempty"`
	Reflection  string `json:"reflection"`
	Crew        string `json:"crew"`
	XP          int    `json:"xp"`
	Estimated   bool   `json:"estimated,omitempty"`
}

type Milestone struct {
	ChapterID   string   `json:"chapter_id"`
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Project     string   `json:"project"`
	Description string   `json:"description"`
	Target      string   `json:"target"`
	CardUIDs    []string `json:"card_uids"`
	Created     string   `json:"created"`
	Achieved    string   `json:"achieved"`
	Archived    bool     `json:"archived"`
}

type Quest struct {
	Date    string `json:"date"`
	CardUID string `json:"card_uid"`
	Title   string `json:"title"`
	XP      int    `json:"xp"`
}

type JourneyAction struct {
	ChapterID   string   `json:"chapter_id"`
	UTCOffset   int      `json:"utc_offset_minutes"`
	Action      string   `json:"action"`
	CardID      string   `json:"card_id"`
	ID          string   `json:"id"`
	Date        string   `json:"date"`
	XP          int      `json:"xp"`
	Title       string   `json:"title"`
	Project     string   `json:"project"`
	Description string   `json:"description"`
	Target      string   `json:"target"`
	CardUIDs    []string `json:"card_uids"`
	Reflection  string   `json:"reflection"`
}

func newJourneyID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}

func projectName(b *Board, key string) string {
	if p, ok := b.project(key); ok {
		return p.Name
	}
	return key
}

func crew(c *Card) string {
	for _, a := range c.Activity {
		if strings.Contains(a, " agent:") || strings.Contains(a, " agent noted:") {
			return "You + your agents"
		}
	}
	return "You"
}

func earlierDate(c *Card) (string, bool) {
	for _, a := range c.Activity {
		if strings.HasSuffix(a, " → done") && len(a) >= len(timeFmt) {
			if t, err := time.ParseInLocation(timeFmt, a[:len(timeFmt)], time.Local); err == nil {
				return t.Format(time.RFC3339), false
			}
		}
	}
	if t, err := time.ParseInLocation(timeFmt, c.Updated, time.Local); err == nil {
		return t.Format(time.RFC3339), true
	}
	return "", true
}

func readJourney(dir string, b *Board) (*Journey, bool, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "journey.json"))
	if err == nil {
		var j Journey
		if err := json.Unmarshal(raw, &j); err != nil {
			return nil, false, fmt.Errorf("journey.json: %w", err)
		}
		if j.Version != 1 {
			return nil, false, errors.New("unsupported journey.json version")
		}
		if j.Victories == nil {
			j.Victories = []Victory{}
		}
		if j.Milestones == nil {
			j.Milestones = []Milestone{}
		}
		if j.Quests == nil {
			j.Quests = []Quest{}
		}
		if j.Personal == nil {
			j.Personal = []PersonalTask{}
		}
		if j.Chapters == nil {
			j.Chapters = []Chapter{}
		}
		return &j, false, nil
	}
	if !os.IsNotExist(err) {
		return nil, false, err
	}
	j := &Journey{Version: 1, Started: time.Now().Format(time.RFC3339), Victories: []Victory{}, Milestones: []Milestone{}, Quests: []Quest{}, Personal: []PersonalTask{}, Chapters: []Chapter{}}
	for _, c := range b.Cards {
		if c.Status != "done" {
			continue
		}
		at, estimated := earlierDate(c)
		j.Victories = append(j.Victories, Victory{ID: "card:" + c.UID, Kind: "earlier", CardUID: c.UID, CardID: c.ID,
			Title: c.Title, Project: c.Project, ProjectName: projectName(b, c.Project), At: at, Estimated: estimated, Crew: crew(c)})
	}
	return j, true, nil
}

func writeJourney(dir string, j *Journey) error {
	raw, err := json.MarshalIndent(j, "", "  ")
	if err != nil {
		return err
	}
	p := filepath.Join(dir, "journey.json")
	if err := os.WriteFile(p+".tmp", append(raw, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(p+".tmp", p)
}

func initJourney(dir string) error {
	return withLock(dir, func() error {
		b, err := loadBoard(dir)
		if err != nil {
			return err
		}
		j, fresh, err := readJourney(dir, b)
		if err != nil {
			return err
		}
		if !fresh {
			return nil
		}
		if err := writeJourney(dir, j); err != nil {
			return err
		}
		return commit(dir, "Start Journey and preserve earlier completed work")
	})
}

func (j *Journey) victory(uid string) *Victory {
	for i := range j.Victories {
		if j.Victories[i].CardUID == uid {
			return &j.Victories[i]
		}
	}
	return nil
}

func validDay(s string) bool {
	t, err := time.Parse("2006-01-02", s)
	return err == nil && t.Format("2006-01-02") == s
}

func validJourneyID(id string) bool {
	b, err := hex.DecodeString(id)
	return err == nil && len(b) == 16
}

func achievementDate(in JourneyAction) error {
	if in.UTCOffset < -840 || in.UTCOffset > 840 {
		return errors.New("invalid time zone offset")
	}
	if !validDay(in.Date) || in.Date > time.Now().In(time.FixedZone("browser", -in.UTCOffset*60)).Format("2006-01-02") {
		return errors.New("choose an achievement date today or earlier")
	}
	return nil
}

func journeyChange(dir string, in JourneyAction, actor string) (*Journey, error) {
	if actor != "me" {
		return nil, errors.New("only you can choose quests and accept accomplishments")
	}
	var out *Journey
	err := withLock(dir, func() error {
		b, err := loadBoard(dir)
		if err != nil {
			return err
		}
		j, _, err := readJourney(dir, b)
		if err != nil {
			return err
		}
		stamp := time.Now().Format(time.RFC3339)
		chapterExists := func(id string) bool {
			if id == "" {
				return true
			}
			for _, ch := range j.Chapters {
				if ch.ID == id {
					return true
				}
			}
			return false
		}
		switch in.Action {
		case "chapter-create", "chapter-update":
			in.Title = strings.TrimSpace(in.Title)
			if in.Title == "" || len(in.Title) > 240 {
				return errors.New("give the chapter a title of 1 to 240 characters")
			}
			if len(in.Description) > 8000 {
				return errors.New("keep the chapter description under 8000 characters")
			}
			if !validDay(in.Date) {
				return errors.New("choose a valid chapter start date")
			}
			if in.Action == "chapter-create" {
				id := in.ID
				if id == "" {
					id = newJourneyID()
				}
				if !validJourneyID(id) {
					return errors.New("invalid chapter identity")
				}
				for _, ch := range j.Chapters {
					if ch.ID == id {
						out = j
						return nil
					}
				}
				j.Chapters = append(j.Chapters, Chapter{ID: id, Title: in.Title, Description: strings.TrimSpace(in.Description), Started: in.Date, Created: stamp})
			} else {
				found := false
				for i := range j.Chapters {
					ch := &j.Chapters[i]
					if ch.ID == in.ID {
						ch.Title = in.Title
						ch.Description = strings.TrimSpace(in.Description)
						ch.Started = in.Date
						found = true
						break
					}
				}
				if !found {
					return errors.New("chapter not found")
				}
			}
		case "milestone-chapter":
			if !chapterExists(in.ChapterID) {
				return errors.New("choose an existing chapter")
			}
			found := false
			for i := range j.Milestones {
				if j.Milestones[i].ID == in.ID {
					j.Milestones[i].ChapterID = in.ChapterID
					found = true
					break
				}
			}
			if !found {
				return errors.New("milestone not found")
			}
		case "quest", "unquest", "accept", "personal-add", "personal-remove", "personal-complete":
			c, ok := b.card(in.CardID)
			if !ok {
				return fmt.Errorf("no card %s", in.CardID)
			}
			if in.Action == "personal-add" || in.Action == "personal-remove" {
				if c.Assignee != "me" {
					return errors.New("My day only holds tasks assigned to you")
				}
				if !validDay(in.Date) {
					return errors.New("choose a valid date")
				}
				if in.Action == "personal-add" {
					if c.Status == "done" || c.Status == "canceled" {
						return errors.New("choose an unfinished personal task")
					}
					for _, task := range j.Personal {
						if task.CardUID == c.UID && task.Date == in.Date {
							out = j
							return nil
						}
					}
					j.Personal = append(j.Personal, PersonalTask{Date: in.Date, CardUID: c.UID, Title: c.Title})
				} else {
					keep := []PersonalTask{}
					for _, task := range j.Personal {
						if task.CardUID != c.UID || task.Date != in.Date {
							keep = append(keep, task)
						}
					}
					j.Personal = keep
				}
			} else if in.Action == "unquest" {
				if j.victory(c.UID) != nil {
					return errors.New("completed quests stay in your history")
				}
				qs := []Quest{}
				for _, q := range j.Quests {
					if q.Date != in.Date || q.CardUID != c.UID {
						qs = append(qs, q)
					}
				}
				j.Quests = qs
			} else if in.Action == "quest" {
				if !validDay(in.Date) {
					return errors.New("choose a valid quest date")
				}
				if c.Status == "canceled" || j.victory(c.UID) != nil {
					return errors.New("choose an unfinished quest")
				}
				if in.XP != 10 && in.XP != 25 && in.XP != 50 {
					return errors.New("quest XP must be 10, 25 or 50")
				}
				n := 0
				for _, q := range j.Quests {
					if q.Date == in.Date {
						n++
						if q.CardUID == c.UID {
							return errors.New("this quest is already in your run")
						}
					}
				}
				if n >= 3 {
					return errors.New("a daily run holds up to three quests")
				}
				j.Quests = append(j.Quests, Quest{Date: in.Date, CardUID: c.UID, Title: c.Title, XP: in.XP})
			} else {
				if in.Action == "personal-complete" {
					if c.Assignee != "me" || c.Status == "canceled" {
						return errors.New("only your own unfinished tasks can be completed here")
					}
					if in.Date == "" {
						in.Date = time.Now().Format("2006-01-02")
					}
					if !validDay(in.Date) {
						return errors.New("choose a valid completion date")
					}
					selected := false
					for _, task := range j.Personal {
						if task.CardUID == c.UID && task.Date == in.Date {
							selected = true
							break
						}
					}
					if !selected {
						j.Personal = append(j.Personal, PersonalTask{Date: in.Date, CardUID: c.UID, Title: c.Title})
					}
				}
				// Repeated requests, reopening a task and project moves cannot award twice.
				if j.victory(c.UID) != nil {
					if in.Action == "personal-complete" {
						if c.Status != "done" {
							c.Activity = append(c.Activity, now()+" me: "+c.Status+" → done")
							c.Status = "done"
							c.Updated = now()
							if err := b.writeCard(c); err != nil {
								return err
							}
						}
						if err := writeJourney(dir, j); err != nil {
							return err
						}
						out = j
						return commit(dir, "Complete personal task without a second reward (me)")
					}
					out = j
					return nil
				}
				if in.Action == "personal-complete" {
					if c.Assignee != "me" || c.Status == "canceled" {
						return errors.New("only your own unfinished tasks can be completed here")
					}
					in.XP = 10
				}
				if in.Action != "personal-complete" && c.Status != "done" && c.Status != "in-review" {
					return errors.New("finish the task or send it for review before you record the win")
				}
				if in.XP != 10 && in.XP != 25 && in.XP != 50 {
					return errors.New("win XP must be 10, 25 or 50")
				}
				xp := in.XP
				for i := len(j.Quests) - 1; i >= 0; i-- {
					if j.Quests[i].CardUID == c.UID {
						xp = j.Quests[i].XP
						break
					}
				}
				if len(in.Reflection) > 8000 {
					return errors.New("keep the reflection under 8000 characters")
				}
				j.Victories = append(j.Victories, Victory{ID: "card:" + c.UID, Kind: "card", CardUID: c.UID, CardID: c.ID,
					Title: c.Title, Project: c.Project, ProjectName: projectName(b, c.Project), At: stamp, AcceptedAt: stamp,
					Reflection: strings.TrimSpace(in.Reflection), XP: xp, Crew: crew(c)})
				if c.Status != "done" {
					c.Activity = append(c.Activity, now()+" me: "+c.Status+" → done")
					c.Status = "done"
					c.Updated = now()
					if err := b.writeCard(c); err != nil {
						return err
					}
				}
			}
		case "milestone-create", "milestone-update", "milestone-record":
			in.Title = strings.TrimSpace(in.Title)
			if in.Title == "" || len(in.Title) > 240 {
				return errors.New("give the milestone a title of 1 to 240 characters")
			}
			if len(in.Description) > 8000 {
				return errors.New("keep the milestone description under 8000 characters")
			}
			if in.Target != "" && !validDay(in.Target) {
				return errors.New("choose a valid target date")
			}
			if in.Project != "" {
				if _, ok := b.project(in.Project); !ok {
					return errors.New("choose an existing project")
				}
			}
			if !chapterExists(in.ChapterID) {
				return errors.New("choose an existing chapter")
			}
			if in.Action == "milestone-record" {
				if !validJourneyID(in.ID) {
					return errors.New("invalid milestone identity")
				}
				if err := achievementDate(in); err != nil {
					return err
				}
				if len(in.Reflection) > 8000 {
					return errors.New("keep the reflection under 8000 characters")
				}
				if len(in.CardUIDs) > 0 {
					return errors.New("record an accomplished milestone without linked tasks")
				}
				for _, m := range j.Milestones {
					if m.ID == in.ID {
						out = j
						return nil
					}
				}
				j.Milestones = append(j.Milestones, Milestone{ID: in.ID, ChapterID: in.ChapterID, Title: in.Title, Project: in.Project, Description: strings.TrimSpace(in.Description), CardUIDs: []string{}, Created: stamp, Achieved: in.Date})
				j.Victories = append(j.Victories, Victory{ID: "milestone:" + in.ID, Kind: "milestone", MilestoneID: in.ID, Title: in.Title, Project: in.Project, ProjectName: projectName(b, in.Project), At: in.Date, AcceptedAt: stamp, Reflection: strings.TrimSpace(in.Reflection), XP: 100, Crew: "You"})
				break
			}
			seen := map[string]bool{}
			for _, uid := range in.CardUIDs {
				found := false
				for _, c := range b.Cards {
					if c.UID == uid {
						found = true
						break
					}
				}
				if !found || seen[uid] {
					return errors.New("linked tasks must be unique existing cards")
				}
				seen[uid] = true
			}
			if in.CardUIDs == nil {
				in.CardUIDs = []string{}
			}
			if in.Action == "milestone-create" {
				j.Milestones = append(j.Milestones, Milestone{ID: newJourneyID(), ChapterID: in.ChapterID, Title: in.Title, Project: in.Project,
					Description: strings.TrimSpace(in.Description), Target: in.Target, CardUIDs: in.CardUIDs, Created: stamp})
			} else {
				found := false
				for i := range j.Milestones {
					m := &j.Milestones[i]
					if m.ID != in.ID {
						continue
					}
					found = true
					if m.Achieved != "" || m.Archived {
						return errors.New("only active milestones can be edited")
					}
					m.Title = in.Title
					m.ChapterID = in.ChapterID
					m.Project = in.Project
					m.Description = strings.TrimSpace(in.Description)
					m.Target = in.Target
					m.CardUIDs = in.CardUIDs
				}
				if !found {
					return errors.New("milestone not found")
				}
			}
		case "milestone-complete", "milestone-archive":
			found := false
			for i := range j.Milestones {
				m := &j.Milestones[i]
				if m.ID != in.ID {
					continue
				}
				found = true
				if m.Achieved != "" {
					out = j
					return nil
				}
				if in.Action == "milestone-archive" {
					m.Archived = true
					break
				}
				if m.Archived {
					return errors.New("this milestone is archived")
				}
				if err := achievementDate(in); err != nil {
					return err
				}
				if len(in.Reflection) > 8000 {
					return errors.New("keep the reflection under 8000 characters")
				}
				for _, uid := range m.CardUIDs {
					if j.victory(uid) == nil {
						return errors.New("record the linked task wins before you achieve this milestone")
					}
				}
				m.Achieved = in.Date
				j.Victories = append(j.Victories, Victory{ID: "milestone:" + m.ID, Kind: "milestone", MilestoneID: m.ID,
					Title: m.Title, Project: m.Project, ProjectName: projectName(b, m.Project), At: in.Date, AcceptedAt: stamp,
					Reflection: strings.TrimSpace(in.Reflection), XP: 100, Crew: "You + your crew"})
			}
			if !found {
				return errors.New("milestone not found")
			}
		default:
			return errors.New("unknown Journey action")
		}
		if err := writeJourney(dir, j); err != nil {
			return err
		}
		out = j
		return commit(dir, "Journey: "+in.Action+" ("+actor+")")
	})
	return out, err
}
