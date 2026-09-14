# Knowledge vault — conventions

This folder is a personal knowledge base distilled from conversation transcripts
(`../sessions/*.md`, one file per session, each with a session id, date, summary,
action items, terms, people and the full transcript). It is maintained by an
automated Claude Code run (`brain-map.mjs`) and read by humans in a markdown/Obsidian
viewer and by the Transcribe app, which quotes notes as live cues during conversations.
Keep it accurate, terse and well-linked.

## Layout

- `index.md` — entry point: what this vault covers, links to the sections below, and a
  short "current focus" paragraph (what the owner is working on right now).
- `people/<Name>.md` — one per person: role/team, what they own, how they relate to the
  owner, dated interactions (one line each), open items with them.
- `tools/<Name>.md` — systems, apps, datasets and services (e.g. internal tools, vendor
  products): what it is, what it's used for, how it connects to other tools, known issues.
- `terms/<Term>.md` — acronyms, jargon, metrics, codes: a one-paragraph definition in the
  owner's context, how it's calculated or used, related terms.
- `projects/<Name>.md` — initiatives and workstreams: goal, status, decisions, next steps,
  people involved, sources.
- `decisions.md` — dated log of decisions (`- 2026-09-03 — decision — why — [[projects/X]] (s5)`).
- `open-items.md` — open action items grouped by person, each with its source session
  (`(s12)`) and date; remove items that later sessions show as done.
- `timeline.md` — one line per session, newest first: date, title, 1-sentence gist, link.

## Rules

- **Never invent.** Only record what the transcripts support; when uncertain say so
  (`(unclear)`). Transcripts are machine-generated and mis-hear names and acronyms:
  reconcile obvious variants into one note and list the variants under `aliases`.
- **Merge, don't duplicate.** Before creating a note, search for an existing one
  (including aliases). Update in place; keep the newest information first.
- **Cite sources** by session id, e.g. `(s5)`, and keep a `sources:` list in frontmatter.
- **Link liberally** with `[[people/Name]]`, `[[tools/Name]]`, `[[terms/Term]]`,
  `[[projects/Name]]` — a link to a note that doesn't exist yet is fine.
- **Stay short.** Notes ≤ ~300 words; prefer bullets. `index.md` ≤ 60 lines.
- File names: Title Case words separated by spaces are fine; no slashes or colons.
- Frontmatter on every note:
  ```
  ---
  type: person | tool | term | project
  aliases: []
  updated: YYYY-MM-DD
  sources: [s1, s5]
  ---
  ```
- Do not modify anything outside this folder. Do not delete notes; mark stale ones with
  `status: stale` in frontmatter instead.
