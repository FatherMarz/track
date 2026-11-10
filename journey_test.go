package main

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func testJourney(t *testing.T) string {
	t.Helper()
	dir := testRepo(t)
	if err := initJourney(dir); err != nil {
		t.Fatal(err)
	}
	return dir
}

func journeyDo(t *testing.T, dir string, in JourneyAction) *Journey {
	t.Helper()
	j, err := journeyChange(dir, in, "me")
	if err != nil {
		t.Fatal(err)
	}
	return j
}

func TestJourneyPreservesHistoryAcrossMoveReopenAndDeletion(t *testing.T) {
	dir := testJourney(t)
	c, err := Create(dir, "web", "Launch version one", Patch{}, "agent")
	if err != nil {
		t.Fatal(err)
	}
	day := time.Now().Format("2006-01-02")
	journeyDo(t, dir, JourneyAction{Action: "quest", CardID: c.ID, Date: day, XP: 50})
	st := "in-review"
	if _, err := Update(dir, c.ID, Patch{Status: &st}, "agent"); err != nil {
		t.Fatal(err)
	}
	j := journeyDo(t, dir, JourneyAction{Action: "accept", CardID: c.ID, XP: 10, Reflection: "The first version people could actually use."})
	if len(j.Victories) != 1 || j.Victories[0].XP != 10 || j.Victories[0].Crew != "You + your agents" {
		t.Fatalf("victory: %+v", j.Victories)
	}
	uid := c.UID
	name, proj, todo := "A different name", "home", "todo"
	c, err = Update(dir, c.ID, Patch{Title: &name, Project: &proj, Status: &todo}, "me")
	if err != nil {
		t.Fatal(err)
	}
	if c.UID != uid {
		t.Fatal("identity changed on move")
	}
	j = journeyDo(t, dir, JourneyAction{Action: "accept", CardID: c.ID, XP: 50})
	if len(j.Victories) != 1 || j.Victories[0].Title != "Launch version one" || j.Victories[0].Project != "web" {
		t.Fatalf("history changed: %+v", j.Victories)
	}
	if err := os.Remove(c.Path); err != nil {
		t.Fatal(err)
	}
	b, _ := loadBoard(dir)
	saved, _, err := readJourney(dir, b)
	if err != nil || len(saved.Victories) != 1 || saved.Victories[0].Reflection == "" {
		t.Fatalf("lost snapshot: %+v, %v", saved, err)
	}
}

func TestJourneyEarlierWorkUsesCompletionDateNotLastEdit(t *testing.T) {
	dir := testRepo(t)
	c, err := Create(dir, "web", "An earlier launch", Patch{}, "me")
	if err != nil {
		t.Fatal(err)
	}
	c.Status = "done"
	c.Updated = "2026-10-15 12:00"
	c.Activity = append(c.Activity, "2026-04-03 09:00 me: in-progress → done", "2026-10-15 12:00 me noted: Updated the description")
	b, _ := loadBoard(dir)
	if err := b.writeCard(c); err != nil {
		t.Fatal(err)
	}
	if err := initJourney(dir); err != nil {
		t.Fatal(err)
	}
	b, _ = loadBoard(dir)
	j, fresh, err := readJourney(dir, b)
	if err != nil || fresh || len(j.Victories) != 1 {
		t.Fatalf("import: %+v %v", j, err)
	}
	v := j.Victories[0]
	if !strings.HasPrefix(v.At, "2026-04-03") || v.Kind != "earlier" || v.XP != 0 || v.Estimated {
		t.Fatalf("incorrect earlier win: %+v", v)
	}
	if err := initJourney(dir); err != nil {
		t.Fatal(err)
	}
	j, _, _ = readJourney(dir, b)
	if len(j.Victories) != 1 {
		t.Fatal("history imported twice")
	}
}

func TestJourneyQuestLimitAgentGateAndConcurrentAcceptance(t *testing.T) {
	dir := testJourney(t)
	day := time.Now().Format("2006-01-02")
	var cards []*Card
	for i := 0; i < 4; i++ {
		c, err := Create(dir, "web", "A useful task", Patch{}, "me")
		if err != nil {
			t.Fatal(err)
		}
		cards = append(cards, c)
	}
	for _, c := range cards[:3] {
		journeyDo(t, dir, JourneyAction{Action: "quest", CardID: c.ID, Date: day, XP: 25})
	}
	if _, err := journeyChange(dir, JourneyAction{Action: "quest", CardID: cards[3].ID, Date: day, XP: 25}, "me"); err == nil {
		t.Fatal("accepted a fourth quest")
	}
	if _, err := journeyChange(dir, JourneyAction{Action: "accept", CardID: cards[0].ID, XP: 25}, "agent"); err == nil {
		t.Fatal("agent awarded itself XP")
	}
	if _, err := journeyChange(dir, JourneyAction{Action: "accept", CardID: cards[0].ID, XP: 25}, "me"); err == nil {
		t.Fatal("accepted unfinished task")
	}
	st := "done"
	Update(dir, cards[0].ID, Patch{Status: &st}, "agent")
	var wg sync.WaitGroup
	errs := make(chan error, 6)
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := journeyChange(dir, JourneyAction{Action: "accept", CardID: cards[0].ID, XP: 50}, "me")
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	b, _ := loadBoard(dir)
	j, _, _ := readJourney(dir, b)
	if len(j.Victories) != 1 || j.Victories[0].XP != 1 { // the agent finished it, so it earned 1
		t.Fatalf("duplicate awards: %+v", j.Victories)
	}
}

func TestJourneyMilestoneLinksDatesAndImmutableSnapshot(t *testing.T) {
	dir := testJourney(t)
	c, _ := Create(dir, "web", "Finish the release", Patch{}, "me")
	j := journeyDo(t, dir, JourneyAction{Action: "milestone-create", Title: "My first launch", Project: "web", Target: "2027-01-01", CardUIDs: []string{c.UID}})
	m := j.Milestones[0]
	if _, err := journeyChange(dir, JourneyAction{Action: "milestone-complete", ID: m.ID, Date: "2026-01-01"}, "me"); err == nil {
		t.Fatal("milestone bypassed linked work")
	}
	st := "done"
	Update(dir, c.ID, Patch{Status: &st}, "me")
	journeyDo(t, dir, JourneyAction{Action: "accept", CardID: c.ID, XP: 25})
	future := time.Now().AddDate(0, 0, 5).Format("2006-01-02")
	if _, err := journeyChange(dir, JourneyAction{Action: "milestone-complete", ID: m.ID, Date: future}, "me"); err == nil {
		t.Fatal("future milestone accepted")
	}
	j = journeyDo(t, dir, JourneyAction{Action: "milestone-complete", ID: m.ID, Date: "2026-01-01", Reflection: "I finally put it into the world."})
	if len(j.Victories) != 2 || j.Victories[1].XP != 100 || j.Milestones[0].Achieved != "2026-01-01" {
		t.Fatalf("milestone: %+v", j)
	}
	j = journeyDo(t, dir, JourneyAction{Action: "milestone-complete", ID: m.ID, Date: "2026-01-01"})
	if len(j.Victories) != 2 {
		t.Fatal("duplicate milestone reward")
	}
	if _, err := journeyChange(dir, JourneyAction{Action: "milestone-update", ID: m.ID, Title: "Rewrite history"}, "me"); err == nil {
		t.Fatal("achieved milestone edited")
	}
}

func TestJourneyCorruptionIsNotOverwritten(t *testing.T) {
	dir := testJourney(t)
	p := filepath.Join(dir, "journey.json")
	if err := os.WriteFile(p, []byte("broken json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := journeyChange(dir, JourneyAction{Action: "milestone-create", Title: "A goal"}, "me"); err == nil {
		t.Fatal("corruption ignored")
	}
	raw, _ := os.ReadFile(p)
	if string(raw) != "broken json" {
		t.Fatal("corrupted history overwritten")
	}
}

func TestMyDayIsPersonalAndCompletionRecordsOnce(t *testing.T) {
	dir := testJourney(t)
	me := "me"
	c, err := Create(dir, "home", "Book the appointment", Patch{Assignee: &me}, "me")
	if err != nil {
		t.Fatal(err)
	}
	agent, err := Create(dir, "web", "Agent work", Patch{}, "agent")
	if err != nil {
		t.Fatal(err)
	}
	day := time.Now().Format("2006-01-02")
	if _, err := journeyChange(dir, JourneyAction{Action: "personal-add", CardID: agent.ID, Date: day}, "me"); err == nil {
		t.Fatal("agent work entered My day")
	}
	j := journeyDo(t, dir, JourneyAction{Action: "personal-add", CardID: c.ID, Date: day})
	if len(j.Personal) != 1 {
		t.Fatal("personal task missing")
	}
	j = journeyDo(t, dir, JourneyAction{Action: "personal-add", CardID: c.ID, Date: day})
	if len(j.Personal) != 1 {
		t.Fatal("duplicate personal task")
	}
	j = journeyDo(t, dir, JourneyAction{Action: "personal-complete", CardID: c.ID})
	if len(j.Victories) != 1 || j.Victories[0].XP != 10 {
		t.Fatalf("personal win: %+v", j.Victories)
	}
	b, _ := loadBoard(dir)
	done, _ := b.card(c.ID)
	if done.Status != "done" {
		t.Fatal("personal task not marked done")
	}
	todo := "todo"
	if _, err := Update(dir, c.ID, Patch{Status: &todo}, "me"); err != nil {
		t.Fatal(err)
	}
	j = journeyDo(t, dir, JourneyAction{Action: "personal-complete", CardID: c.ID})
	b, _ = loadBoard(dir)
	done, _ = b.card(c.ID)
	if done.Status != "done" || len(j.Victories) != 1 {
		t.Fatal("reopened personal task did not complete without another reward")
	}
}

func TestRetrospectiveMilestoneAndChapterOrganization(t *testing.T) {
	dir := testJourney(t)
	chapterID, milestoneID := newJourneyID(), newJourneyID()
	in := JourneyAction{Action: "chapter-create", ID: chapterID, Title: "The first year", Date: "2025-01-01", Description: "Learning to ship."}
	j := journeyDo(t, dir, in)
	if len(j.Chapters) != 1 {
		t.Fatal("chapter was not saved")
	}
	j = journeyDo(t, dir, in)
	if len(j.Chapters) != 1 {
		t.Fatal("duplicate chapter")
	}
	win := JourneyAction{Action: "milestone-record", ID: milestoneID, Title: "Launched the first version", Date: "2025-04-12", Reflection: "I did it before I felt ready.", ChapterID: chapterID}
	j = journeyDo(t, dir, win)
	if len(j.Victories) != 1 || len(j.Milestones) != 1 || j.Milestones[0].Achieved != "2025-04-12" || j.Milestones[0].ChapterID != chapterID || j.Victories[0].At != "2025-04-12" || j.Victories[0].XP != 100 {
		t.Fatalf("retrospective record: %+v", j)
	}
	original := j.Victories[0]
	j = journeyDo(t, dir, win)
	if len(j.Victories) != 1 || len(j.Milestones) != 1 {
		t.Fatal("retry duplicated the accomplishment")
	}
	second := newJourneyID()
	journeyDo(t, dir, JourneyAction{Action: "chapter-create", ID: second, Title: "Building my business", Date: "2025-06-01"})
	j = journeyDo(t, dir, JourneyAction{Action: "milestone-chapter", ID: milestoneID, ChapterID: second})
	if j.Milestones[0].ChapterID != second || j.Victories[0] != original {
		t.Fatal("organizing the chapter rewrote an accomplishment")
	}
	if _, err := journeyChange(dir, JourneyAction{Action: "milestone-record", ID: newJourneyID(), Title: "Future win", Date: time.Now().AddDate(0, 0, 3).Format("2006-01-02")}, "me"); err == nil {
		t.Fatal("future accomplishment accepted")
	}
	if _, err := journeyChange(dir, JourneyAction{Action: "milestone-chapter", ID: milestoneID, ChapterID: newJourneyID()}, "me"); err == nil {
		t.Fatal("missing chapter accepted")
	}
	if _, err := journeyChange(dir, JourneyAction{Action: "milestone-record", ID: "bad-id", Title: "Broken identity", Date: "2025-01-01"}, "me"); err == nil {
		t.Fatal("invalid identity accepted")
	}
	b, _ := loadBoard(dir)
	saved, _, err := readJourney(dir, b)
	if err != nil || len(saved.Chapters) != 2 || saved.Victories[0] != original {
		t.Fatalf("saved history: %+v, %v", saved, err)
	}
}

func TestFinishedTaskEarnsOnceTenForMeOneForAgent(t *testing.T) {
	dir := testJourney(t)
	done, todo := "done", "todo"
	a, _ := Create(dir, "web", "Finished from the CLI", Patch{}, "agent")
	b1, _ := Create(dir, "web", "Dragged to Done", Patch{}, "me")
	if _, err := Update(dir, a.ID, Patch{Status: &done}, "agent"); err != nil {
		t.Fatal(err)
	}
	if err := Reorder(dir, "done", []string{b1.ID, a.ID}, "me"); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(dir, "home", "Born finished", Patch{Status: &done}, "me"); err != nil {
		t.Fatal(err)
	}
	Update(dir, a.ID, Patch{Status: &todo}, "me")
	Update(dir, a.ID, Patch{Status: &done}, "me")
	board, _ := loadBoard(dir)
	j, _, err := readJourney(dir, board)
	if err != nil || len(j.Victories) != 3 {
		t.Fatalf("wins: %+v, %v", j, err)
	}
	for i, v := range j.Victories {
		want := 10
		if i == 0 { // the agent finished this one
			want = 1
		}
		if v.XP != want || v.Kind != "card" {
			t.Fatalf("win: %+v", v)
		}
	}
	if j.Victories[0].Crew != "You + your agents" {
		t.Fatalf("crew: %+v", j.Victories[0])
	}
	if out, _ := git(dir, "status", "--porcelain"); out != "" {
		t.Fatalf("uncommitted: %s", out)
	}
}
