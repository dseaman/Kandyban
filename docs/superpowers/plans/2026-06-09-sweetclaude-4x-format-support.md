# SweetClaude 4.x Dual-Format Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Kandyban recognize and round-trip SweetClaude 4.x YAML-frontmatter work items alongside the existing 3.x bold-key markdown, byte-identically in both directions.

**Architecture:** Two parser front-ends behind a per-file format detector, both emitting the same `ParsedItem`. A new dependency-free frontmatter reader handles SC4; a parallel frontmatter write-splice mirrors the existing bold-key splice. SC3 code paths are left untouched; both formats round-trip byte-identically as the regression net (ADR-002).

**Tech Stack:** TypeScript (ESM, strict), Obsidian plugin API, Vitest. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-06-09-sweetclaude-4x-format-support-design.md`

**Conventions for every task:**
- Run a single test file with: `npx vitest run tests/<file>.test.ts`
- Run the whole suite with: `npm test`
- `src/parser.ts`, `src/writer.ts`, `src/format.ts`, `src/frontmatter.ts` must NOT import `obsidian` or any 3rd-party module — they are pure string-in/data-out units.

---

## File Structure

- **Create** `src/frontmatter.ts` — pure low-level YAML frontmatter reader: extract the block, read top-level scalars, read arrays. No mapping logic.
- **Create** `src/format.ts` — `detectFormat(content)` → `"sc3" | "sc4" | null`.
- **Modify** `src/parser.ts` — extract existing logic into `parseBoldKey()`; add `parseFrontmatterItem()`; dispatch on format; add `logicalPath` param.
- **Modify** `src/item-index.ts` — pass the logical path into the parser (line ~130).
- **Modify** `src/writer.ts` — add `updateFrontmatterEnum()`.
- **Modify** `src/main.ts` — `applyEnumChange()` dispatches to the right splicer by detected format.
- **Modify** `src/settings.ts` — add `roadmapPath` default + scan key + UI row.
- **Create** fixtures under `tests/fixtures/` — SC4 issue, story (id only in filename), epic (nested YAML), done item.
- **Create/Modify** tests: `tests/frontmatter.test.ts`, `tests/format.test.ts`, `tests/parser.test.ts`, `tests/writer.test.ts`.

---

## Task 1: Frontmatter reader (`src/frontmatter.ts`)

**Files:**
- Create: `src/frontmatter.ts`
- Test: `tests/frontmatter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/frontmatter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractFrontmatter, readScalars, readArray } from "../src/frontmatter";

const ISSUE = `---
id: ISSUE-001
type: story
title: "Teams & roles CRUD"
status: active
priority: P0
effort: m
epic: EP-001
---

## Description
status: not-a-field
`;

const EPIC = `---
id: EP-001
type: epic
title: "Team & Capacity Foundation"
status: new
completion_criteria:
  - id: cc-1
    done: false
depends_on: []
---
`;

describe("extractFrontmatter", () => {
  it("returns the block body when content opens with frontmatter", () => {
    const fm = extractFrontmatter(ISSUE);
    expect(fm).not.toBeNull();
    expect(fm!).toContain("id: ISSUE-001");
    expect(fm!).not.toContain("## Description");
  });

  it("returns null when there is no leading frontmatter", () => {
    expect(extractFrontmatter("# I-001: Title\n**Status:** done")).toBeNull();
  });

  it("returns null when the block is never closed", () => {
    expect(extractFrontmatter("---\nid: X\nno closing")).toBeNull();
  });
});

describe("readScalars", () => {
  it("reads top-level scalars, lowercases keys, strips quotes", () => {
    const s = readScalars(extractFrontmatter(ISSUE)!);
    expect(s["id"]).toBe("ISSUE-001");
    expect(s["title"]).toBe("Teams & roles CRUD");
    expect(s["status"]).toBe("active");
    expect(s["priority"]).toBe("P0");
    expect(s["epic"]).toBe("EP-001");
  });

  it("ignores indented (nested) keys", () => {
    const s = readScalars(extractFrontmatter(EPIC)!);
    expect(s["id"]).toBe("EP-001");
    expect(s["done"]).toBeUndefined(); // nested under completion_criteria
    expect(s["cc-1"]).toBeUndefined();
  });
});

describe("readArray", () => {
  it("reads an inline empty array", () => {
    expect(readArray(extractFrontmatter(EPIC)!, "depends_on")).toEqual([]);
  });

  it("reads an inline populated array", () => {
    const fm = "depends_on: [EP-001, EP-002]";
    expect(readArray(fm, "depends_on")).toEqual(["EP-001", "EP-002"]);
  });

  it("reads a block array", () => {
    const fm = "depends_on:\n  - EP-001\n  - EP-002\nnext_key: x";
    expect(readArray(fm, "depends_on")).toEqual(["EP-001", "EP-002"]);
  });

  it("returns [] when the key is absent", () => {
    expect(readArray("id: X", "depends_on")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/frontmatter.test.ts`
Expected: FAIL — `Cannot find module '../src/frontmatter'`.

- [ ] **Step 3: Implement `src/frontmatter.ts`**

```ts
// Pure, dependency-free reader for the subset of YAML frontmatter Kandyban needs:
// top-level scalar fields and simple arrays. Nested maps/sequences are ignored by
// design — no `obsidian` or 3rd-party imports.

export function extractFrontmatter(content: string): string | null {
	const lines = content.split(/\r?\n/);
	if (lines[0] !== "---") return null;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i] === "---") return lines.slice(1, i).join("\n");
	}
	return null;
}

function stripQuotes(value: string): string {
	const v = value.trim();
	if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
		return v.slice(1, -1);
	}
	return v;
}

// Top-level `key: value` scalars only (column 0, no leading whitespace). First
// occurrence wins. Indented lines (nested map/sequence members) are skipped.
export function readScalars(fm: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of fm.split(/\r?\n/)) {
		const m = line.match(/^([A-Za-z][A-Za-z0-9_]*):[ \t]*(.*)$/);
		if (!m) continue;
		const key = m[1]!.toLowerCase();
		if (out[key] !== undefined) continue;
		out[key] = stripQuotes(m[2]!);
	}
	return out;
}

// Reads a top-level array field in either inline (`key: [a, b]`) or block
// (`key:` then indented `- item` lines) form. Returns [] if absent/empty.
export function readArray(fm: string, key: string): string[] {
	const lines = fm.split(/\r?\n/);
	const keyRe = new RegExp(`^${key}:[ \\t]*(.*)$`);
	for (let i = 0; i < lines.length; i++) {
		const m = (lines[i] ?? "").match(keyRe);
		if (!m) continue;
		const inline = m[1]!.trim();
		if (inline.startsWith("[")) {
			return inline
				.replace(/^\[|\]$/g, "")
				.split(",")
				.map((s) => stripQuotes(s))
				.filter((s) => s.length > 0);
		}
		const items: string[] = [];
		for (let j = i + 1; j < lines.length; j++) {
			const im = (lines[j] ?? "").match(/^[ \t]+-[ \t]*(.*)$/);
			if (!im) break;
			const v = stripQuotes(im[1]!);
			if (v.length > 0) items.push(v);
		}
		return items;
	}
	return [];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/frontmatter.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/frontmatter.ts tests/frontmatter.test.ts
git commit -m "feat: dependency-free YAML frontmatter reader"
```

---

## Task 2: Format detection (`src/format.ts`)

**Files:**
- Create: `src/format.ts`
- Test: `tests/format.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectFormat } from "../src/format";

describe("detectFormat", () => {
  it("detects sc4 when content opens with a frontmatter block", () => {
    expect(detectFormat("---\nid: ISSUE-001\nstatus: active\n---\n\n## Description")).toBe("sc4");
  });

  it("detects sc3 when content has a bold-key H1", () => {
    expect(detectFormat("# I-001: Title\n**Status:** done")).toBe("sc3");
  });

  it("returns null for content matching neither", () => {
    expect(detectFormat("# Just a heading\nsome prose")).toBeNull();
  });

  it("does not treat a frontmatter-like block in the body as sc4", () => {
    expect(detectFormat("# I-001: Title\n\n---\nnot: frontmatter\n---")).toBe("sc3");
  });

  it("returns null when an unclosed frontmatter block has no H1", () => {
    expect(detectFormat("---\nid: X\nno closing fence")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/format.test.ts`
Expected: FAIL — `Cannot find module '../src/format'`.

- [ ] **Step 3: Implement `src/format.ts`**

```ts
import { extractFrontmatter } from "./frontmatter";

const SC3_H1_RE = /^# [A-Z]+-\d+: /m;
const HAS_KEY_RE = /^[A-Za-z][A-Za-z0-9_]*:/m;

export type ArtifactFormat = "sc3" | "sc4";

export function detectFormat(content: string): ArtifactFormat | null {
	const fm = extractFrontmatter(content);
	if (fm !== null && HAS_KEY_RE.test(fm)) return "sc4";
	if (SC3_H1_RE.test(content)) return "sc3";
	return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format.ts tests/format.test.ts
git commit -m "feat: per-file SC3/SC4 format detection"
```

---

## Task 3: SC4 fixtures

**Files:**
- Create: `tests/fixtures/ISSUE-001-teams-roles-crud.md`
- Create: `tests/fixtures/STORY-007-filename-only-id.md`
- Create: `tests/fixtures/EP-001-team-capacity-foundation.md`
- Create: `tests/fixtures/STORY-009-done-item.md`

- [ ] **Step 1: Create the issue fixture (id in frontmatter)**

`tests/fixtures/ISSUE-001-teams-roles-crud.md`:

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

Full CRUD for teams and roles.
```

- [ ] **Step 2: Create the story fixture with NO id in frontmatter (id comes from filename)**

`tests/fixtures/STORY-007-filename-only-id.md`:

```markdown
---
type: story
title: Example story
status: backlog
---

Body without an id field; id must be derived from the filename.
```

- [ ] **Step 3: Create the epic fixture with nested YAML**

`tests/fixtures/EP-001-team-capacity-foundation.md`:

```markdown
---
id: EP-001
type: epic
title: "Team & Capacity Foundation"
status: new
release: null
completion_criteria:
  - id: cc-1
    description: "Full CRUD for teams"
    done: false
  - id: cc-2
    description: "Roles within a team"
    done: false
depends_on: []
created: 2026-06-08T16:37:58+00:00
updated: 2026-06-08T17:50:00+00:00
---

## Description

Foundational data model for resource planning.
```

- [ ] **Step 4: Create the done fixture**

`tests/fixtures/STORY-009-done-item.md`:

```markdown
---
id: STORY-009
type: story
title: Already finished
status: done
priority: soon
---

## Description

A completed item.
```

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/ISSUE-001-teams-roles-crud.md tests/fixtures/STORY-007-filename-only-id.md tests/fixtures/EP-001-team-capacity-foundation.md tests/fixtures/STORY-009-done-item.md
git commit -m "test: SC4 frontmatter fixtures anchored on real schema"
```

---

## Task 4: SC4 parser front-end (`src/parser.ts`)

**Files:**
- Modify: `src/parser.ts`
- Test: `tests/parser.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/parser.test.ts` (inside the file, new `describe` block):

```ts
describe("parseSweetClaudeFile — SC4 frontmatter", () => {
  it("parses an issue with id in frontmatter", () => {
    const item = parseSweetClaudeFile(
      fixture("ISSUE-001-teams-roles-crud.md"),
      "product/backlog/ISSUE-001-teams-roles-crud.md",
    )!;
    expect(item.id).toBe("ISSUE-001");
    expect(item.kind).toBe("backlog");
    expect(item.title).toBe("Teams & roles CRUD");
    expect(item.enums.status).toBe("active");
    expect(item.enums.horizon).toBe("p0"); // priority normalises into the horizon slot
    expect(item.enums.milestone).toBe("EP-001"); // epic → grouping slot
    expect(item.enums.effort).toBe("m");
    expect(item.enums.dependsOn).toEqual([]);
  });

  it("derives id from the filename when frontmatter has no id", () => {
    const item = parseSweetClaudeFile(
      fixture("STORY-007-filename-only-id.md"),
      "product/backlog/stories/STORY-007-filename-only-id.md",
    )!;
    expect(item.id).toBe("STORY-007");
    expect(item.kind).toBe("backlog");
    expect(item.title).toBe("Example story");
    expect(item.enums.status).toBe("backlog");
  });

  it("classifies an epic as a grouping entity (kind=milestone)", () => {
    const item = parseSweetClaudeFile(
      fixture("EP-001-team-capacity-foundation.md"),
      "product/roadmap/epics/EP-001-team-capacity-foundation.md",
    )!;
    expect(item.id).toBe("EP-001");
    expect(item.kind).toBe("milestone");
    expect(item.enums.status).toBe("new");
    expect(item.enums.dependsOn).toEqual([]);
  });

  it("returns null when frontmatter has no usable id (no id field, unparseable filename)", () => {
    const item = parseSweetClaudeFile("---\ntitle: X\nstatus: new\n---\n", "notes/scratch.md");
    expect(item).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/parser.test.ts`
Expected: FAIL — SC4 file returns null (current parser requires an H1), and the second arg is ignored.

- [ ] **Step 3: Refactor existing logic into `parseBoldKey` and add the SC4 path**

In `src/parser.ts`:

1. Add imports at the top (after the existing header comment):

```ts
import { detectFormat } from "./format";
import { extractFrontmatter, readScalars, readArray } from "./frontmatter";
```

2. Rename the current exported `parseSweetClaudeFile` function to a private `parseBoldKey` (change ONLY the signature line; the body is unchanged):

```ts
function parseBoldKey(content: string): ParsedItem | null {
```

3. Add the new dispatcher and SC4 parser at the end of the file:

```ts
function idFromPath(logicalPath: string): string {
	const base = logicalPath.split("/").pop() ?? "";
	const m = base.match(/^([A-Z]+-\d+)/);
	return m ? m[1]! : "";
}

function parseFrontmatterItem(fm: string, logicalPath: string): ParsedItem | null {
	const scalars = readScalars(fm);

	const id = scalars["id"] || idFromPath(logicalPath);
	if (!id) return null;

	const title = scalars["title"] ?? "";
	const type = (scalars["type"] ?? "").toLowerCase();
	const isEntity = type === "epic" || type === "milestone" || /^(EP|MS)-/.test(id);
	const kind: ItemKind = isEntity ? "milestone" : "backlog";

	const enums: ParsedItem["enums"] = { dependsOn: [] };
	if (scalars["status"] !== undefined) enums.status = normaliseStatus(scalars["status"]);
	if (scalars["priority"] !== undefined) enums.horizon = normaliseHorizon(scalars["priority"]);
	if (scalars["epic"] !== undefined && scalars["epic"].length > 0) {
		enums.milestone = canonicaliseMilestone(scalars["epic"]);
	}
	if (scalars["effort"] !== undefined && scalars["effort"].length > 0) {
		enums.effort = extractEnum(scalars["effort"]).toLowerCase();
	}
	enums.dependsOn = readArray(fm, "depends_on");

	return { id, kind, title, raw: scalars, enums };
}

export function parseSweetClaudeFile(content: string, logicalPath = ""): ParsedItem | null {
	const format = detectFormat(content);
	if (format === "sc4") {
		const fm = extractFrontmatter(content);
		if (fm === null) return null;
		return parseFrontmatterItem(fm, logicalPath);
	}
	if (format === "sc3") return parseBoldKey(content);
	return null;
}
```

Note: `parseBoldKey` previously short-circuited on `h1Index === -1`; that check stays inside it and is now only reached for sc3-detected content, so behavior is identical for SC3 files.

- [ ] **Step 4: Run the parser tests (new + existing) to verify they pass**

Run: `npx vitest run tests/parser.test.ts`
Expected: PASS — both the new SC4 cases and all pre-existing SC3 cases (the defaulted `logicalPath` keeps single-arg callers green).

- [ ] **Step 5: Commit**

```bash
git add src/parser.ts tests/parser.test.ts
git commit -m "feat: parse SC4 frontmatter items behind shared model"
```

---

## Task 5: Thread the logical path through the index

**Files:**
- Modify: `src/item-index.ts` (the `parseSweetClaudeFile(content)` call, ~line 130)

- [ ] **Step 1: Update the call site**

In `src/item-index.ts`, inside `indexPath`, change:

```ts
const parsed = parseSweetClaudeFile(content);
```

to:

```ts
const parsed = parseSweetClaudeFile(content, logicalPath);
```

- [ ] **Step 2: Verify the full suite still passes**

Run: `npm test`
Expected: PASS (no test regressions).

- [ ] **Step 3: Verify it type-checks and builds**

Run: `npm run build`
Expected: completes with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/item-index.ts
git commit -m "feat: pass logical path to parser for filename-derived ids"
```

---

## Task 6: Frontmatter write-splice (`src/writer.ts`)

**Files:**
- Modify: `src/writer.ts`
- Test: `tests/writer.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/writer.test.ts`:

```ts
import { updateFrontmatterEnum } from "../src/writer";

describe("updateFrontmatterEnum", () => {
  const ISSUE = `---
id: ISSUE-001
type: story
title: "Teams & roles CRUD"
status: active
priority: P0
epic: EP-001
---

## Description

status: this is body prose, not a field.
`;

  it("replaces a top-level scalar value and leaves the rest byte-identical", () => {
    const out = updateFrontmatterEnum(ISSUE, "status", "done");
    expect(out).toBe(ISSUE.replace("status: active", "status: done"));
  });

  it("never touches an indented (nested) key of the same name", () => {
    const epic = `---
id: EP-001
status: new
completion_criteria:
  - id: cc-1
    done: false
---
`;
    const out = updateFrontmatterEnum(epic, "id", "EP-999");
    expect(out).toContain("id: EP-999"); // top-level id changed
    expect(out).toContain("  - id: cc-1"); // nested id untouched
  });

  it("is a no-op when the value already matches", () => {
    const out = updateFrontmatterEnum(ISSUE, "status", "active");
    expect(out).toBe(ISSUE);
  });

  it("is a no-op when the field is absent", () => {
    const out = updateFrontmatterEnum(ISSUE, "milestone", "MS-002");
    expect(out).toBe(ISSUE);
  });

  it("preserves a trailing comment", () => {
    const src = "---\nstatus: active # current\n---\n";
    const out = updateFrontmatterEnum(src, "status", "done");
    expect(out).toBe("---\nstatus: done # current\n---\n");
  });

  it("does nothing when there is no leading frontmatter block", () => {
    const src = "# I-001: Title\n**Status:** done";
    expect(updateFrontmatterEnum(src, "status", "x")).toBe(src);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/writer.test.ts`
Expected: FAIL — `updateFrontmatterEnum` is not exported.

- [ ] **Step 3: Implement `updateFrontmatterEnum`**

Add to `src/writer.ts` (the existing `escapeRegex` helper is reused):

```ts
function stripQuotes(value: string): string {
	const v = value.trim();
	if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
		return v.slice(1, -1);
	}
	return v;
}

// Splice the leading scalar of a top-level `field:` line inside the first
// frontmatter block, preserving everything else byte-identically: the closing
// fence, the body, nested maps, line endings, and any trailing `# comment`.
export function updateFrontmatterEnum(
	content: string,
	field: string,
	newEnum: string,
): string {
	const block = content.match(/^---\r?\n[\s\S]*?\r?\n---/);
	if (!block) return content;
	const fullBlock = block[0];

	// Column-0 key only (the `m` flag's `^` matches line starts; the key is not
	// preceded by whitespace, so indented nested keys never match). Group 1 is
	// `field: ` + leading spaces; group 2 is the scalar; group 3 is an optional
	// trailing comment to preserve.
	const lineRe = new RegExp(
		`^(${escapeRegex(field)}:[ \\t]*)([^\\r\\n#]*?)([ \\t]*#[^\\r\\n]*)?$`,
		"m",
	);
	const m = fullBlock.match(lineRe);
	if (!m) return content;

	const prefix = m[1]!;
	const currentValue = m[2]!;
	const comment = m[3] ?? "";
	if (stripQuotes(currentValue) === newEnum) return content;

	// The block is anchored at index 0 by the `^---` match, so the file is exactly
	// `fullBlock + remainder`. Splice the one line inside the block and reattach the
	// untouched remainder — byte-identical except the replaced scalar.
	const newBlock = fullBlock.replace(lineRe, prefix + newEnum + comment);
	return newBlock + content.slice(fullBlock.length);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/writer.test.ts`
Expected: PASS (all cases, including byte-identity and nested-key safety).

- [ ] **Step 5: Commit**

```bash
git add src/writer.ts tests/writer.test.ts
git commit -m "feat: byte-identical frontmatter enum write-splice"
```

---

## Task 7: Dispatch writes by format (`src/main.ts`)

**Files:**
- Modify: `src/main.ts` (`applyEnumChange`, ~line 318; imports near line 15)

- [ ] **Step 1: Add imports**

In `src/main.ts`, update the writer import and add the format import:

```ts
import { updateBoldKeyEnum, updateFrontmatterEnum } from "./writer";
import { detectFormat } from "./format";
```

- [ ] **Step 2: Replace the body of `applyEnumChange`**

Replace:

```ts
	async applyEnumChange(logicalPath: string, field: string, newEnum: string): Promise<void> {
		const content = await this.access.read(logicalPath);
		const next = updateBoldKeyEnum(content, field, newEnum);
		if (next === content) return;
```

with:

```ts
	async applyEnumChange(logicalPath: string, field: string, newEnum: string): Promise<void> {
		const content = await this.access.read(logicalPath);
		const next =
			detectFormat(content) === "sc4"
				? updateFrontmatterEnum(content, field.toLowerCase() === "horizon" ? "priority" : field.toLowerCase(), newEnum)
				: updateBoldKeyEnum(content, field, newEnum);
		if (next === content) return;
```

(The rest of the method — write, index refresh, notice — is unchanged. The caller passes `"Status"`, `"Horizon"`, or `"Priority"`; for SC4 these map to the lowercase frontmatter keys `status`/`priority`.)

- [ ] **Step 3: Verify the suite and build**

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: dispatch enum writes by detected artifact format"
```

---

## Task 8: Scan the roadmap directory (`src/settings.ts`)

**Files:**
- Modify: `src/settings.ts` (interface, `DEFAULT_SETTINGS`, `SCAN_PATH_KEYS`, `display()` UI)

- [ ] **Step 1: Add the field to the interface and defaults**

In `KansidianSettings`, add after `milestonesPath`:

```ts
	roadmapPath: string;
```

In `DEFAULT_SETTINGS`, add after `milestonesPath`:

```ts
	roadmapPath: "product/roadmap",
```

- [ ] **Step 2: Add it to the scan-path keys**

Change `SCAN_PATH_KEYS` to include the new key:

```ts
const SCAN_PATH_KEYS: ReadonlyArray<keyof Pick<
	KansidianSettings,
	"backlogPath" | "issuesPath" | "milestonesPath" | "roadmapPath"
>> = ["backlogPath", "issuesPath", "milestonesPath", "roadmapPath"];
```

- [ ] **Step 3: Add the settings UI row**

In `display()`, after the "Milestones path" `Setting` block, add:

```ts
		new Setting(containerEl)
			.setName("Roadmap path")
			.setDesc("Scanned for SweetClaude 4.x roadmap entities such as epics (under roadmap/epics/). Leave blank to disable.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.roadmapPath)
					.setValue(this.plugin.settings.roadmapPath)
					.onChange(async (value) => {
						this.plugin.settings.roadmapPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);
```

This mirrors the adjacent "Milestones path" block exactly. `saveSettings()` (in `main.ts:189`) already re-derives scan paths via `this.index.setScanPaths(collectScanPaths(this.settings))`, so adding `roadmapPath` to `SCAN_PATH_KEYS` is all that's needed for the new directory to be scanned on save.

- [ ] **Step 4: Verify build and suite**

Run: `npm run build`
Expected: no TypeScript errors.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts
git commit -m "feat: scan product/roadmap so SC4 epics index as grouping entities"
```

---

## Task 9: Board entity-exclusion guard test

**Files:**
- Test: `tests/parser.test.ts` (a focused assertion; no source change — board already excludes `kind !== "backlog"` at `board-view.ts:169`)

- [ ] **Step 1: Add a guard test**

Append to `tests/parser.test.ts`:

```ts
describe("SC4 epics are grouping entities, not cards", () => {
  it("an epic parses with kind=milestone so views exclude it from card columns", () => {
    const epic = parseSweetClaudeFile(
      fixture("EP-001-team-capacity-foundation.md"),
      "product/roadmap/epics/EP-001-team-capacity-foundation.md",
    )!;
    // board-view applyFilters and list-view both gate on kind === "backlog".
    expect(epic.kind).toBe("milestone");
  });
});
```

- [ ] **Step 2: Run and verify it passes**

Run: `npx vitest run tests/parser.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/parser.test.ts
git commit -m "test: lock SC4 epic as grouping entity (excluded from board cards)"
```

---

## Task 10: Full regression + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: PASS — every SC3 fixture and every new SC4 test green. This is the byte-identity regression net for both formats.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: no TypeScript errors; `main.js` produced.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new lint errors (eslint-plugin-obsidianmd).

- [ ] **Step 4: Manual smoke (Obsidian)**

Open the `resource-planning-tool` vault (or this repo's vault). Confirm:
- SC4 issues from `product/backlog` appear as board cards.
- An epic does NOT appear as a card; `EP-001` shows as a grouping chip on issues that reference it.
- Dragging an SC4 card to a new status column rewrites only the `status:` line (verify with `git diff` — frontmatter and body otherwise byte-identical).
- This repo's own SC3 `I-*` items still render and still drag-write correctly.

- [ ] **Step 5: No commit** (verification only). If any check fails, return to the relevant task.

---

## Self-Review

**Spec coverage:**
- §1 format.ts → Task 2. ✓
- §2 parser (signature, parseBoldKey, parseFrontmatter, id-from-filename, dependency-free reader) → Tasks 1, 4, 5. ✓
- §3 writer frontmatter splice (column-0, comment preservation, no-op) → Task 6. ✓
- §4 write dispatch → Task 7. ✓
- §4 view hygiene → already satisfied (`board-view.ts:169`); locked by Task 9. ✓
- §5 roadmapPath scan → Task 8. ✓
- §6 testing (detection, parser, round-trip byte-identity, SC3 regression) → Tasks 1, 2, 4, 6, 10. ✓
- Field mapping table (id/title/status/horizon←priority/milestone←epic/effort/dependsOn/kind) → Task 4 assertions. ✓

**Placeholder scan:** Every step contains complete code. No "TBD"/"handle edge cases"/"similar to" placeholders. Task 8's `.onChange` body was verified against the real file: it calls only `await this.plugin.saveSettings()`, which already re-derives scan paths (`main.ts:189`) — no separate refresh method exists or is needed.

**Type consistency:** `parseSweetClaudeFile(content, logicalPath?)`, `parseBoldKey(content)`, `parseFrontmatterItem(fm, logicalPath)`, `idFromPath(logicalPath)`, `detectFormat(content)`, `extractFrontmatter`/`readScalars`/`readArray`, `updateFrontmatterEnum(content, field, newEnum)` — names and signatures are consistent across all tasks. `ParsedItem`/`ItemKind`/`enums.milestone`/`enums.horizon`/`enums.dependsOn` reuse the existing model unchanged.
