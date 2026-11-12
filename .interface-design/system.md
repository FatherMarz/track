# Track

Track is a local board for one person and their agents. My day is the person's quiet list.
Journey makes completed work visible over months and preserves what each accomplishment meant.

## Direction

- Domain: daily runs, milestones, a crew, completed outcomes, a trail, personal keepsakes.
- Palette: graphite background, charcoal surfaces, silver text, slate metadata, violet progress, brass milestones.
- Preserve the existing Track typeface and CSS tokens. Add semantic tokens for milestone brass and a faint violet fill.
- Signature: immutable wins with the original title, date, project, contribution, and reflection.
- Prefer lasting progress over expiring streaks, public leaderboards, or rewards for moving cards.

## Composition

- Use surface shifts and quiet borders. Avoid decorative shadows within the page.
- Use a 4px spacing grid. Page padding is 40px on desktop and 16px on phones.
- Journey is compact: a three-cell stats strip (finished, milestones, level with meter), chapters, short milestone rows, then Wins with inline filters, a 48px monthly trail and one-line win rows (title, project, date).
- No eyebrows, explainer lines or duplicate buttons. Page actions live in the top bar.
- Section heading: 16px/500. Win title: 15px/500. Metadata: 11–12px.
- Keep typography and columns readable at 320px. Controls on phones need approximately 44px targets.
- My day uses a single narrow column. Keep its quick-add field, task title, and completion circle prominent.
- My Day is a compact checklist: 13px task text, 6px row padding, no metadata beneath titles, no filler copy.
- Order: title + date + Pin/Journey/Track links on one line, boxed quick-add, Today (with done count), From earlier (tap + to pull into today), then folded Other to-dos and Milestones (+ Add) lines, then Scratchpad.
- Clamp long personal titles to two lines. The task remains available in full when opened.
- The sticky note uses 14px horizontal padding, a 22px heading, and 18px completion circles on fine pointers.
- Keep larger hit areas for coarse pointers. Preserve expanded lists and draft input through live updates.
- The sticky window removes app navigation. Full Track remains one link away.
- Opening the root URL defaults to compact My day. The `full=1` query opts into the complete board; project and Journey deep links stay accessible.

## Patterns

- A win is recorded once per stable card UID. Agent results require the person's acceptance.
- A milestone is a named outcome with an optional target date, linked tasks, and a reflection on completion.
- Use a timeline grouped by month and a monthly bar trail. Filters never change lifetime totals.
- Personal tasks use the existing `me` assignee. Today selection is separate from the three-quest limit.
- Preserve in-progress input through live board updates. Use a native dialog for forms and a native Mac panel for pinning.
- The data repo owns Journey. Source code and public marketing pages never receive personal records.

- Put Record milestone and Plan a milestone beside each chapter. Accomplishment forms accept past dates and optional reflections.
- My day exposes + Milestone without leaving the note. Completed milestones stay visible in a collapsed list.
- Task completion updates the list immediately and rolls back on failure. Celebrate confirmed saves with a short violet-and-brass confetti burst; honor reduced motion.
- The native Edit menu owns macOS Command shortcuts. Preserve text selection and caret direction through live updates.

- Phone and Home Screen launches use full Track navigation and start on My day. Desktop browser roots and the native Mac companion default to the compact note.
- Preserve one board across devices. Export PNG Home Screen icons from the existing SVG mark; do not put personal tailnet hostnames in app source.

- My day has a bottom-anchored Scratchpad: quiet label, saved state, Clear, and a 12px textarea (16px on touch devices).
- The scratchpad retains its DOM, selection, and scroll position through board updates. It saves outside task and Journey history and lasts until cleared.

- The native Track.app owns the Track Dock icon. Dock activation restores the My day companion and enables always-on-top, including after closing or minimizing it.
- Desktop browser views show Open pinned note; the native view shows the real Pin/Pinned toggle. Hide the desktop launcher on touch devices.
