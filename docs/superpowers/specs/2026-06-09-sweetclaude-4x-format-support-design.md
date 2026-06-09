# SweetClaude 4.x dual-format support — design

**Date:** 2026-06-09
**Status:** Approved (brainstorming) — pending implementation plan

## Problem

Kandyban only recognizes SweetClaude 3.x (SC3) work-item files, which carry their
metadata in an H1 (`# ISSUE-001: Title`) plus `**Bold-key:** value` lines.
SweetClaude 4.x (SC4) changed the serialization: metadata now lives in a `---`
YAML frontmatter block, and the markdown body starts at `## Description` with no
`#` H1. A real SC4 issue:

```markdown
---
id: ISSUE-001
type: story
title: "Teams & roles CRUD"
status: active
priority: P0
effort: m
epic: EP-001
origin: manual
created: 2026-06-09
---

## Description
...
```

Kandyban's `parseSweetClaudeFile` rejects this at its first gate — it requires the
SC3 H1 (`H1_RE = /^# ([A-Z]+-\d+): /`) and at least one bold-key field; the
frontmatter file matches neither, so the file is silently skipped. The scan
directory (`product/backlog`) and `.md` extension were never the problem; the
format is.

Confirmed against a real SC4 project (`resource-planning-tool`) and the framework
docs at `carson-sweet/sweetclaude/docs/user-guide/4.x-beta`.

## Goals

- SC4 frontmatter work items render on the board and list views.
- Drag-to-cycle-status and the cycle commands write back to SC4 frontmatter
  **byte-identically** (full read+write parity with SC3).
- SC3 support is unchanged — this repo dogfoods SC3 (`I-*` bold-key); both formats
  must round-trip byte-identically. That dual pass is the regression net and the
  ADR-002 non-destructive guarantee made concrete.

## Non-goals (round one)

- Resolving an epic *id* (`EP-001`) to its epic *title* for grouping chips — the
  chip shows the id, exactly as it shows `MS-001` today. Title resolution is a
  later step.
- Modeling the full SC4 taxonomy (story/bug/chore/debt as distinct first-class
  kinds). Everything is a card except grouping entities (epic/milestone).
- Migrating or rewriting SC3 files into SC4, or vice versa.

## Confirmed SC4 vocabulary & schema

From `planning-concepts.md`:

- **Status:** `new → ready → active → blocked → deferred → done → abandoned`
  (entities like epics also use `planned`). Treated as **free-form configurable
  strings**, not a hardcoded enum — SC4 lets projects override vocabulary
  (the `resource-planning-tool` project uses `priority: P0/P1/P2`).
- **Priority:** `next · sooner · soon · later · someday` — the same words this
  repo's Kandyban already calls `horizon`.

Real frontmatter fields observed:
- Issue: `id, type, title, status, priority, effort, epic, origin, created`.
- Epic: `id, type, title, status, release, objective, completion_criteria` (a
  **nested list of maps**), `depends_on: []` (a **YAML array**), `created, updated`.
- Sanitized framework fixtures (`STORY-001-*`, `BUG-001-*`, `EP-001-*`) carry
  **no `id:` in frontmatter** — the id is only in the filename.

Directory layout: `product/backlog/`, `product/issues/`, `product/roadmap/`
(epics under `roadmap/epics/`), possibly typed subdirs (`backlog/stories/`,
`backlog/bugs/`, `backlog/chores/`, `backlog/debt/`, `backlog/done/`). Kandyban's
scan already recurses, so nested dirs are reachable.

## Field mapping (SC3 → internal model → SC4)

| Internal field | SC3 source | SC4 source |
|---|---|---|
| `id` | H1 `# I-001:` | frontmatter `id:`, else **filename** `^([A-Z]+-\d+)` |
| `title` | H1 text | frontmatter `title:` (strip surrounding quotes) |
| `status` | `**Status:**` | `status:` |
| `horizon` | `**Horizon:**` / `**Priority:**` | `priority:` |
| grouping (`milestone` slot) | `**Milestone:**` `MS-NNN` | `epic:` `EP-NNN` |
| `effort` | `**Effort:**` | `effort:` |
| `dependsOn` | comma string | YAML array `depends_on:` |
| `kind` | id `MS-` → entity | `type: epic\|milestone` (or id prefix `EP-`/`MS-`) → entity, else card |

The internal model field stays named `milestone` (least churn); for SC4 items it
holds the `epic:` reference.

## Architecture — two front-ends, shared model

### 1. `src/format.ts` (new)
`detectFormat(content): "sc3" | "sc4" | null`
- `sc4` when the file opens with a `---` frontmatter block containing ≥1 key.
- `sc3` when it has a bold-key H1 (`# PREFIX-NNN:`).
- `null` when neither (preserves current skip behavior).

Pure, no `obsidian` import, independently testable.

### 2. `src/parser.ts`
`parseSweetClaudeFile(content, logicalPath)` — **new `logicalPath` param** (the one
rippling signature change; call site updates at `item-index.ts:130`). It calls
`detectFormat`, then dispatches:
- **`parseBoldKey(content)`** — the existing SC3 logic extracted verbatim into a
  function. No behavior change.
- **`parseFrontmatter(content, logicalPath)`** — new. Reads the `---…---` block via
  a **dependency-free top-level reader** that parses only column-0 `key: value`
  scalars and simple `[]` / `- item` arrays, deliberately ignoring nested maps
  (`completion_criteria:`). Maps fields per the table. `id` falls back to the
  filename basename when no `id:` key. `kind` = entity when `type` is
  `epic`/`milestone` or the id prefix is `EP-`/`MS-`, else `backlog`.

Rationale for the hand-rolled reader over a `yaml` dependency: our fields are all
top-level scalars plus one array; a tiny reader keeps `parser.ts` free of the
3rd-party/`obsidian` imports its header forbids, and avoids a runtime dependency.

### 3. `src/writer.ts`
`updateFrontmatterEnum(content, field, newEnum)` — parallel to `updateBoldKeyEnum`:
- Locate the **first** `---…---` block; operate only inside it.
- Splice the **column-0** `field: value` line (so an indented `id: cc-1` /
  `done: false` inside `completion_criteria` can never match).
- Preserve any trailing ` # comment` verbatim, the way the SC3 writer preserves
  ` (…)` / ` — …` annotations.
- No-op (return content unchanged) if the field is absent — matches existing
  writer behavior.

### 4. Write dispatch — `src/main.ts`
`applyEnumChange` reads the file, calls `detectFormat`, and dispatches to the right
splicer, mapping the Kandyban field name (`"Status"` / `"Horizon"`) to the SC4 key
(`status` / `priority`) for the frontmatter path.

### 5. View hygiene — `src/views/board-view.ts`
Ensure the board excludes grouping entities (`kind !== "backlog"`) the way
`list-view.ts:113` already does, so an epic (`type: epic`, `status: new`) doesn't
render as a stray card in the board's status columns.

### 6. Scan paths — `src/settings.ts`
Add `roadmapPath: "product/roadmap"` to `DEFAULT_SETTINGS` and the scan-path key
list, so epics under `roadmap/epics/` are indexed as grouping entities. Recursive
scan already reaches nested directories. Surface it in the settings UI alongside
the existing backlog/issues/milestones paths.

## Data flow

```
listMarkdownUnder(scanPaths)  →  for each .md path:
    read(path)  →  parseSweetClaudeFile(content, path)
        detectFormat(content)
            "sc3" → parseBoldKey(content)
            "sc4" → parseFrontmatter(content, path)   ← id may come from `path`
            null  → skip
    → ParsedItem (shared shape) → ItemIndex → board / list views

drag / cycle  →  applyEnumChange(path, "Status", value)
    read(path) → detectFormat
        "sc3" → updateBoldKeyEnum(content, "Status", value)
        "sc4" → updateFrontmatterEnum(content, "status", value)
    → write(path, next)
```

## Error handling

- Unrecognized files (`detectFormat → null`) are skipped, as today.
- Frontmatter present but missing a mapped field: that field is simply absent on
  the `ParsedItem` (e.g. backlog stories with no `epic:` have no grouping value),
  matching how SC3 handles missing bold-keys.
- Write to an absent field is a no-op — never injects a new key.
- Malformed frontmatter (no closing `---`) → `detectFormat` returns the SC3 or
  `null` branch; never throws.

## Testing

- **Detection** (`format.test.ts`): sc3 / sc4 / null cases, including malformed
  frontmatter and frontmatter-in-body false positives.
- **Parser** (`parser.test.ts`): new SC4 fixtures — issue with `id:` in
  frontmatter; story with id **only** in filename; epic with nested
  `completion_criteria` + `depends_on: []`; a `done` item; quoted title;
  `priority` → horizon; `epic:` → grouping slot; kind classification.
- **Writer** (`writer.test.ts`): round-trip byte-identity — parse → cycle status →
  assert *only* the `status:` line changed; `completion_criteria`, body, and all
  other lines byte-identical. Absent-field no-op. Trailing-comment preservation.
- **Regression:** every existing SC3 fixture stays green; both formats round-trip
  byte-identically.

New fixtures live under `tests/fixtures/` alongside the SC3 ones, anchored on the
real `resource-planning-tool` schema (not the framework's sanitized stubs).

## Out-of-scope follow-ups (note, don't build)

- Epic id → title resolution for grouping chips.
- Typed-subdir-aware kind inference (using `backlog/bugs/` to set a bug kind).
- Writing SC4 fields other than status/priority.
