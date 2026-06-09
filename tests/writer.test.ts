import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseSweetClaudeFile } from "../src/parser";
import { updateBoldKeyEnum, updateFrontmatterEnum } from "../src/writer";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");
const fixture = (name: string): string =>
	readFileSync(join(fixturesDir, name), "utf-8");

describe("updateBoldKeyEnum — surgical splice", () => {
	it("changes a clean Status enum without touching anything else", () => {
		const before = fixture("I-001-clean-enums.md");
		const after = updateBoldKeyEnum(before, "Status", "done");
		expect(after).toContain("**Status:** done");
		expect(after).not.toContain("**Status:** in-progress");
		// Everything outside the Status line is byte-identical
		const beforeWithoutStatus = before.replace(/\*\*Status:\*\* in-progress\n/, "");
		const afterWithoutStatus = after.replace(/\*\*Status:\*\* done\n/, "");
		expect(afterWithoutStatus).toBe(beforeWithoutStatus);
	});

	it("preserves a parenthetical annotation when swapping the leading enum", () => {
		const before = fixture("BL-042-parenthetical-annotation.md");
		const after = updateBoldKeyEnum(before, "Status", "deferred");
		expect(after).toContain("**Status:** deferred (merged 2026-05-19, PR #29)");
		expect(after).not.toContain("**Status:** done (merged 2026-05-19, PR #29)");
	});

	it("preserves an em-dash annotation when swapping the leading enum", () => {
		const before = fixture("BL-099-em-dash-annotation.md");
		const after = updateBoldKeyEnum(before, "Status", "done");
		expect(after).toContain("**Status:** done — blocked on BL-039 quota meter");
	});

	it("preserves the parenthetical annotation on a Horizon field", () => {
		const before = fixture("BL-099-em-dash-annotation.md");
		const after = updateBoldKeyEnum(before, "Horizon", "now");
		expect(after).toContain("**Horizon:** now (Phase B)");
	});

	it("targets only the named field (does not collide on similar names)", () => {
		const before = fixture("I-001-clean-enums.md");
		// "Priority" must not affect "Status"
		const after = updateBoldKeyEnum(before, "Priority", "later");
		expect(after).toContain("**Priority:** later");
		expect(after).toContain("**Status:** in-progress"); // unchanged
	});
});

describe("updateBoldKeyEnum — idempotency", () => {
	it("writing the same enum twice produces byte-identical output", () => {
		const before = fixture("I-001-clean-enums.md");
		const once = updateBoldKeyEnum(before, "Status", "done");
		const twice = updateBoldKeyEnum(once, "Status", "done");
		expect(twice).toBe(once);
	});

	it("writing the current value is a no-op (byte-identical to input)", () => {
		const before = fixture("I-001-clean-enums.md");
		const after = updateBoldKeyEnum(before, "Status", "in-progress");
		expect(after).toBe(before);
	});
});

describe("updateBoldKeyEnum — missing fields", () => {
	it("leaves content unchanged when the named field is absent", () => {
		const before = fixture("I-001-clean-enums.md");
		const after = updateBoldKeyEnum(before, "Severity", "critical");
		expect(after).toBe(before);
	});
});

describe("round-trip byte identity (the load-bearing contract)", () => {
	const cases: Array<{ file: string; field: string }> = [
		{ file: "I-001-clean-enums.md", field: "Status" },
		{ file: "I-001-clean-enums.md", field: "Priority" },
		{ file: "BL-042-parenthetical-annotation.md", field: "Status" },
		{ file: "BL-042-parenthetical-annotation.md", field: "Horizon" },
		{ file: "BL-099-em-dash-annotation.md", field: "Status" },
		{ file: "BL-099-em-dash-annotation.md", field: "Horizon" },
		{ file: "BL-077-underscore-status.md", field: "Horizon" },
		{ file: "BL-021-milestone-with-slug.md", field: "Status" },
		{ file: "MS-003-milestone.md", field: "Status" },
	];

	for (const { file, field } of cases) {
		it(`${file} — re-writing ${field} with its current enum is byte-identical`, () => {
			const before = fixture(file);
			const item = parseSweetClaudeFile(before)!;
			const currentEnum =
				field === "Status"
					? item.enums.status
					: field === "Horizon" || field === "Priority"
						? item.enums.horizon
						: undefined;
			expect(currentEnum).toBeDefined();
			const after = updateBoldKeyEnum(before, field, currentEnum!);
			expect(after).toBe(before);
		});
	}

	it("parse → write → parse produces functionally equivalent enums for every fixture", () => {
		// Writes the parser's normalised enum back; on-disk raw may shift toward
		// canonical form (e.g. in_progress → in-progress), which is expected per
		// the parser's normalisation rules. Functional equivalence is what we
		// guarantee; byte identity is asserted in the per-fixture cases above.
		const files = readdirSync(fixturesDir).filter((n) => n.endsWith(".md") && !n.startsWith("garbage-"));
		for (const f of files) {
			const before = fixture(f);
			const first = parseSweetClaudeFile(before);
			if (!first || !first.enums.status) continue;
			const after = updateBoldKeyEnum(before, "Status", first.enums.status);
			const second = parseSweetClaudeFile(after)!;
			expect(second.enums.status).toBe(first.enums.status);
			expect(second.enums.horizon).toBe(first.enums.horizon);
			expect(second.enums.milestone).toBe(first.enums.milestone);
		}
	});
});

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
    expect(out).toContain("id: EP-999");
    expect(out).toContain("  - id: cc-1");
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

  it("does not expand $-sequences in a preserved trailing comment", () => {
    const src = "---\nstatus: active # see $1 and $& and $`\n---\n";
    const out = updateFrontmatterEnum(src, "status", "done");
    expect(out).toBe("---\nstatus: done # see $1 and $& and $`\n---\n");
  });
});

describe("updateBoldKeyEnum — $-sequence safety", () => {
  it("does not expand $-sequences in a preserved annotation", () => {
    const src = "# I-001: Title\n**Status:** active ($1.2M budget, $& review)";
    const out = updateBoldKeyEnum(src, "Status", "done");
    expect(out).toBe("# I-001: Title\n**Status:** done ($1.2M budget, $& review)");
  });
});
