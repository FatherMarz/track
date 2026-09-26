# Track

A local task board for one person and their AI agents. Cards are plain markdown files in a git repo that you own. The `track` command lets agents work with cards safely, and a fast web page lets you do the same by hand.

- **Agent first.** Every command has `--json` output. Every change becomes a git commit with who made it.
- **Readable by hand.** One markdown file per card. You can open any card and change it in an editor.
- **Local only.** One Go program with no outside dependencies. It uses the Go standard library and the `git` already on your machine. It needs no npm and no build step for the page.
- **Linear style.** Projects, the six Linear columns, priorities, labels, a ⌘K command menu, saved views and arrow-key movement.

## Install

```sh
go install github.com/FatherMarz/track@latest
track init ~/track-data          # makes the data repo and remembers where it is
```

Edit `~/track-data/projects.yml` to add your projects:

```yaml
projects:
  - key: web
    name: Website
    prefix: WEB
    color: "#5e6ad2"
    aliases: [website, site]     # words "track capture" listens for
```

## Code and data stay apart

The program keeps nothing about your work. Your cards live in a separate data repo:

```
track-data/
  projects.yml
  views.yml                      # saved views
  cards/
    inbox/IN-3-buy-milk.md       # built-in Inbox for cards with no project
    web/WEB-12-fix-login-timeout.md
```

Track finds the data repo from `~/.config/track/config.yml`, `$TRACK_DATA` or `--data`.

## A card

```markdown
---
id: WEB-12
title: Fix login timeout
status: in-progress
priority: high
labels: [bug]
assignee: agent
due: 2026-10-01
created: 2026-09-25 14:03
updated: 2026-09-25 16:40
---

What is wrong and what done looks like.

## Activity
- 2026-09-25 14:03 me: created
- 2026-09-25 16:40 agent: todo → in-progress
- 2026-09-25 16:41 agent noted: The session cookie expires early.
```

Status is one of `backlog`, `todo`, `in-progress`, `in-review`, `done` or `canceled`. Priority is one of `urgent`, `high`, `medium`, `low` or `none`.

If you edit a card by hand, Track sees the change and commits it. If Track cannot read a card, it lists that card in `track check` and in a banner on the page. It never drops the card.

## Commands

```sh
track add web "Fix login timeout" --priority high --label bug
track capture "fix the login timeout under website"   # finds the project in the words
track list [--project web] [--status todo] [--filter "priority:high label:bug"] [--all] [--json]
track show WEB-12
track move WEB-12 in-progress
track edit WEB-12 --assignee agent --due 2026-10-01
track note WEB-12 "Found the cause"
track check                      # cards Track cannot read
track sync                       # push the data repo to its remote
track serve                      # the web page on http://127.0.0.1:4747
```

Agents mark their changes with `--as agent` (the default) and people with `--as me`.

## The web page

`track serve` starts the page. Home shows every card In Progress across all projects. The Inbox holds cards that arrived without a project.

- ⌘K opens search and every command.
- The arrow keys move between cards and columns. Enter opens a card and Esc closes it.
- Shift with ← or → moves the card to the next column.
- The page updates by itself when an agent or a hand edit changes a card.
- On a phone, each project shows as one list grouped by status.

To reach it from your phone, put it on your tailnet only. Do not use Funnel:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:4747
```

## Voice capture

`POST /api/capture?format=text` takes spoken words as the body. It adds the card and returns one sentence, like "Added WEB-13 to Website: Fix the login timeout". An iOS Shortcut can dictate text, send it with "Get Contents of URL", and speak the reply.

## Licence

MIT
