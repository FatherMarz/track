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

## My day and Journey

**My day** is your personal list. It only shows cards assigned to `me`.
Track opens in the compact My day view by default. "Open full Track" opens the complete board.
Add a task in My day to assign it to yourself and choose it for today.
Due and overdue personal tasks also appear here. Other personal tasks stay in the expandable list.
Unfinished tasks from earlier days remain available under "Still on your mind".

Click a task's circle to finish it and record a win. The list updates immediately.
A successful save shows a short confetti burst. Failed saves restore the task. Each personal win earns 10 XP once.
Reopening or moving a task does not create another reward.

The note's **+ Milestone** button records an accomplishment directly.
Choose its actual date, including a past date, and add an optional reflection.
A chapter selector places it in the appropriate part of your story.

The **Scratchpad** beneath My day saves loose notes automatically. It survives restarts and is shared with the phone view.
Its text stays until you clear it. Clearing removes the current note without adding it to git history or Journey.
Scratchpad state lives outside the board repo, under `~/.local/share/track/scratchpads/`.
A local browser draft protects edits during an interruption. It is removed after the server saves the note.

**Journey** follows one continuous order: chapters, their milestones, and the wins along the way.
Create a chapter with a name, start date, and optional context. Chapters appear in date order.
Each chapter offers **Record milestone** for accomplishments and **Plan a milestone** for future goals.
You can move an existing milestone into a chapter without changing its accomplishment snapshot.

Journey preserves completed work, accepted results, milestones, and reflections.
The six-month view shows your progress by month. All wins supports project filters and text search.
You can also view all recorded history.

Choose up to three daily quests on Home.
Every task earns XP once when it moves to Done, from the board, a list, the CLI, or an agent.
A task you finish earns 10 XP. A task an agent finishes earns 1 XP.
A result in In Review earns 10 XP when you accept it.
Every 250 XP adds a level. Missed days do not remove progress.

Create a milestone with a title, project, target date, and optional linked tasks.
Record the linked task wins before you mark the milestone achieved.
You can also create a standalone personal milestone.
An achieved milestone saves its date and reflection, and earns 100 XP once.
You can record an earlier achievement date. Active milestones support edits and archiving.

Journey stores immutable accomplishment snapshots in `journey.json`, beside the cards in your data repo.
Task renames, project moves, and deletions do not rewrite these snapshots.
The first server start imports existing Done cards as earlier work, without retroactive XP.
Activity records supply completion dates. If no completion date exists, Journey labels the last-update date as estimated.
Keep the data repo private if it contains personal information. The app source contains none of this data.

### Floating note on macOS

The native Track app opens My day in a small pinned window. Its Dock icon launches this companion.
Clicking the Dock icon again restores the pinned note after closing or minimizing its window.
The menu-bar checklist icon can show the window, toggle "Always on top", or quit the companion.
The companion remembers its window position. Launching or reopening it from the Dock enables pinning. Track must run on port 4747.
The standard Edit menu supports Command-A, C, X, V, Z, and Shift-Command-Z in text fields.

```sh
sh desktop/build.sh "$HOME/Applications/Track.app"
open "$HOME/Applications/Track.app"
```

The "Open sticky note" button also opens a compact browser window.
The native companion supplies the always-on-top behavior.
In a desktop browser, **Open pinned note** launches the native companion through `track-sticky://open`.
Use `http://127.0.0.1:4747/?full=1#/` to bookmark the complete board directly.

### Track on your phone

Open the private Tailscale HTTPS URL in Safari. Then choose Share, Add to Home Screen, and Open as Web App.
The Home Screen app starts on My day with full navigation to projects and Journey.
The app manifest uses `/?full=1#/mine` as its launch URL.
Phone browsers also default to this full interface. The Mac companion keeps its compact note view.

The Mac must run Track and remain reachable through Tailscale. The phone app uses the same board and history.

## Voice capture

`POST /api/capture?format=text` takes spoken words as the body. It adds the card and returns one sentence, like "Added WEB-13 to Website: Fix the login timeout". An iOS Shortcut can dictate text, send it with "Get Contents of URL", and speak the reply.

## Licence

MIT
