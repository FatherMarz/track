package main

import (
	"regexp"
	"sort"
	"strings"
)

// parseCapture reads spoken text like "fix the login bug under website" and returns
// the project key and the card title. It looks for a project name or alias after a
// joining word (under, for, in, to, on). An empty key means the Inbox.
func parseCapture(b *Board, text string) (string, string) {
	text = strings.TrimSpace(text)
	type alias struct{ word, key string }
	var aliases []alias
	for _, p := range b.Projects {
		for _, w := range append([]string{p.Key, p.Name, p.Prefix}, p.Aliases...) {
			if w = strings.TrimSpace(w); w != "" {
				aliases = append(aliases, alias{strings.ToLower(w), p.Key})
			}
		}
	}
	// Longest alias first, so "the house" wins over "house".
	sort.Slice(aliases, func(i, j int) bool { return len(aliases[i].word) > len(aliases[j].word) })
	for _, a := range aliases {
		re := regexp.MustCompile(`(?i)[\s,]*\b(?:under|for|in|to|on|into)\s+(?:the\s+)?` + regexp.QuoteMeta(a.word) + `(?:\s+(?:project|board))?\b[\s.,!?]*`)
		if loc := re.FindStringIndex(text); loc != nil {
			title := strings.TrimSpace(text[:loc[0]] + " " + text[loc[1]:])
			return a.key, cleanTitle(title)
		}
		// "Website: fix the login bug"
		re = regexp.MustCompile(`(?i)^` + regexp.QuoteMeta(a.word) + `\s*[:,-]\s*`)
		if loc := re.FindStringIndex(text); loc != nil {
			return a.key, cleanTitle(text[loc[1]:])
		}
	}
	return "", cleanTitle(text)
}

func cleanTitle(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	s = strings.TrimRight(s, ".,!? ")
	for _, lead := range []string{"track ", "add ", "remind me to ", "i need to "} {
		if strings.HasPrefix(strings.ToLower(s), lead) {
			s = s[len(lead):]
		}
	}
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
