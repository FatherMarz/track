package main

// A small YAML subset, enough for Track's own files:
//
//	key: value
//	key: [a, b, "c d"]
//	key:
//	  - name: x
//	    tags: [a, b]
//
// It keeps Track free of third-party parsers. It is not a general YAML reader.

import (
	"fmt"
	"strconv"
	"strings"
)

type node = map[string]any

func parseMini(text string) (node, error) {
	out := node{}
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	var listKey string
	var list []node
	var scalars []string
	var item node
	flush := func() {
		if listKey == "" {
			return
		}
		if item != nil {
			list = append(list, item)
			item = nil
		}
		if len(list) > 0 {
			out[listKey] = list
		} else if len(scalars) > 0 {
			out[listKey] = scalars
		} else {
			out[listKey] = ""
		}
		listKey, list, scalars = "", nil, nil
	}
	for n, raw := range lines {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		indent := len(raw) - len(strings.TrimLeft(raw, " "))
		if indent == 0 {
			flush()
			k, v, ok := splitKV(trimmed)
			if !ok {
				return nil, fmt.Errorf("line %d: expected \"key: value\"", n+1)
			}
			if v == "" {
				listKey = k
				continue
			}
			val, err := parseValue(v)
			if err != nil {
				return nil, fmt.Errorf("line %d: %v", n+1, err)
			}
			out[k] = val
			continue
		}
		if listKey == "" {
			return nil, fmt.Errorf("line %d: unexpected indent", n+1)
		}
		if strings.HasPrefix(trimmed, "- ") || trimmed == "-" {
			rest := strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
			if item != nil {
				list = append(list, item)
				item = nil
			}
			if k, v, ok := splitKV(rest); ok {
				item = node{}
				val, err := parseValue(v)
				if err != nil {
					return nil, fmt.Errorf("line %d: %v", n+1, err)
				}
				item[k] = val
			} else {
				s, err := parseScalar(rest)
				if err != nil {
					return nil, fmt.Errorf("line %d: %v", n+1, err)
				}
				scalars = append(scalars, s)
			}
			continue
		}
		if item == nil {
			return nil, fmt.Errorf("line %d: expected a list item", n+1)
		}
		k, v, ok := splitKV(trimmed)
		if !ok {
			return nil, fmt.Errorf("line %d: expected \"key: value\"", n+1)
		}
		val, err := parseValue(v)
		if err != nil {
			return nil, fmt.Errorf("line %d: %v", n+1, err)
		}
		item[k] = val
	}
	flush()
	return out, nil
}

// splitKV splits "key: value" at the first colon that sits outside quotes.
func splitKV(s string) (string, string, bool) {
	i := strings.Index(s, ":")
	if i <= 0 {
		return "", "", false
	}
	k := strings.TrimSpace(s[:i])
	if strings.ContainsAny(k, " \"'[") {
		return "", "", false
	}
	return k, strings.TrimSpace(s[i+1:]), true
}

func parseValue(v string) (any, error) {
	if strings.HasPrefix(v, "[") {
		if !strings.HasSuffix(v, "]") {
			return nil, fmt.Errorf("list is missing its closing ]")
		}
		inner := strings.TrimSpace(v[1 : len(v)-1])
		items := []string{}
		if inner == "" {
			return items, nil
		}
		for _, part := range splitComma(inner) {
			s, err := parseScalar(strings.TrimSpace(part))
			if err != nil {
				return nil, err
			}
			if s != "" {
				items = append(items, s)
			}
		}
		return items, nil
	}
	return parseScalar(v)
}

func splitComma(s string) []string {
	var parts []string
	var cur strings.Builder
	var quote rune
	for _, r := range s {
		switch {
		case quote != 0:
			cur.WriteRune(r)
			if r == quote {
				quote = 0
			}
		case r == '"' || r == '\'':
			quote = r
			cur.WriteRune(r)
		case r == ',':
			parts = append(parts, cur.String())
			cur.Reset()
		default:
			cur.WriteRune(r)
		}
	}
	return append(parts, cur.String())
}

func parseScalar(v string) (string, error) {
	if len(v) >= 2 && v[0] == '"' {
		s, err := strconv.Unquote(v)
		if err != nil {
			return "", fmt.Errorf("bad quoted text %s", v)
		}
		return s, nil
	}
	if len(v) >= 2 && v[0] == '\'' && v[len(v)-1] == '\'' {
		return strings.ReplaceAll(v[1:len(v)-1], "''", "'"), nil
	}
	return v, nil
}

func quoteMini(s string) string {
	if s == "" {
		return `""`
	}
	if strings.ContainsAny(s[:1], "#&*!|>'\"%@`{[-? ") || strings.HasSuffix(s, " ") ||
		strings.Contains(s, ": ") || strings.Contains(s, " #") || strings.ContainsAny(s, "\n\t,[]") {
		return strconv.Quote(s)
	}
	return s
}

func listMini(items []string) string {
	q := make([]string, len(items))
	for i, s := range items {
		q[i] = quoteMini(s)
	}
	return "[" + strings.Join(q, ", ") + "]"
}

func str(n node, k string) string {
	s, _ := n[k].(string)
	return s
}

func strs(n node, k string) []string {
	switch v := n[k].(type) {
	case []string:
		return v
	case string:
		if v != "" {
			return []string{v}
		}
	}
	return []string{}
}

func nodes(n node, k string) []node {
	v, _ := n[k].([]node)
	return v
}
