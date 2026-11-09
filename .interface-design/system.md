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
- Journey follows one continuous story: chapters in start-date order, the milestones within each chapter, then wins and the monthly trail. Lifetime totals and levels stay in a quiet header line.
- Desktop hero: 32px heading, 48px totals. Phone hero: 28px heading, 40px totals.
- Section heading: 16px/500. Win title: 15px/500. Metadata: 11–12px.
- Keep typography and columns readable at 320px. Controls on phones need approximately 44px targets.
- My day uses a single narrow column. Keep its quick-add field, task title, and completion circle prominent.
- My day is a compact checklist: 12px task text, 1.4 line height, 5px row padding, and no metadata beneath titles.
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
