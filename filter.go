package main

import "strings"

// matchFilter applies a view filter such as "project:web status:todo,in-progress label:bug login".
// The web page uses the same rules in JavaScript.
func matchFilter(b *Board, c *Card, filter string) bool {
	for _, tok := range strings.Fields(filter) {
		k, v, ok := strings.Cut(tok, ":")
		if !ok || v == "" {
			if !strings.Contains(strings.ToLower(c.ID+" "+c.Title+" "+c.Body), strings.ToLower(tok)) {
				return false
			}
			continue
		}
		vals := strings.Split(strings.ToLower(v), ",")
		hit := false
		for _, want := range vals {
			switch strings.ToLower(k) {
			case "project":
				if p, ok := b.project(want); ok && p.Key == c.Project {
					hit = true
				}
			case "status":
				if s, err := normStatus(want); err == nil && s == c.Status {
					hit = true
				}
				if want == "open" && c.Status != "done" && c.Status != "canceled" {
					hit = true
				}
			case "priority":
				if s, err := normPriority(want); err == nil && s == c.Priority {
					hit = true
				}
			case "label":
				for _, l := range c.Labels {
					if strings.EqualFold(l, want) {
						hit = true
					}
				}
			case "assignee":
				if want == c.Assignee || (want == "none" && c.Assignee == "") {
					hit = true
				}
			default:
				hit = strings.Contains(strings.ToLower(c.Title), strings.ToLower(tok))
			}
		}
		if !hit {
			return false
		}
	}
	return true
}
