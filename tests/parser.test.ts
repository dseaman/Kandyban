import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseSweetClaudeFile } from "../src/parser";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");
const fixture = (name: string): string =>
	readFileSync(join(fixturesDir, name), "utf-8");

describe("parseSweetClaudeFile — structure", () => {
	it("parses an I-prefix issue with Priority convention", () => {
		const item = parseSweetClaudeFile(fixture("I-001-clean-enums.md"));
		expect(item).not.toBeNull();
		expect(item!.id).toBe("I-001");
		expect(item!.kind).toBe("backlog");
		expect(item!.title).toBe("Plugin scaffold and repo hygiene");
		expect(item!.raw["milestone"]).toBe("MS-001");
		expect(item!.raw["type"]).toBe("chore");
		expect(item!.enums.status).toBe("in-progress");
		expect(item!.enums.horizon).toBe("next"); // Priority normalises to enums.horizon
		expect(item!.enums.milestone).toBe("MS-001");
		expect(item!.enums.effort).toBe("s");
		expect(item!.enums.dependsOn).toEqual([]);
	});

	it("leaves enums.effort undefined when no Effort field is present", () => {
		const item = parseSweetClaudeFile(fixture("BL-042-parenthetical-annotation.md"))!;
		expect(item.raw["effort"]).toBeUndefined();
		expect(item.enums.effort).toBeUndefined();
	});

	it("parses a BL-prefix issue with Horizon convention", () => {
		const item = parseSweetClaudeFile(fixture("BL-042-parenthetical-annotation.md"));
		expect(item).not.toBeNull();
		expect(item!.id).toBe("BL-042");
		expect(item!.kind).toBe("backlog");
		expect(item!.title).toBe("Wire analytics ingest");
		expect(item!.enums.horizon).toBe("next");
	});

	it("parses an MS-prefix milestone file as kind 'milestone'", () => {
		const item = parseSweetClaudeFile(fixture("MS-003-milestone.md"));
		expect(item).not.toBeNull();
		expect(item!.id).toBe("MS-003");
		expect(item!.kind).toBe("milestone");
		expect(item!.title).toBe("Pilot launch");
		expect(item!.enums.status).toBe("active");
	});

	it("reads bold-key fields from a second header block separated by a blank line", () => {
		// SweetClaude's issue template emits the core fields, then a blank line,
		// then **Milestone:**/**Sequence:**. The parser must not stop at the blank.
		const item = parseSweetClaudeFile(fixture("I-200-split-header-block.md"));
		expect(item).not.toBeNull();
		expect(item!.id).toBe("I-200");
		expect(item!.enums.status).toBe("done");
		expect(item!.raw["milestone"]).toBe("MS-001-foundation");
		expect(item!.enums.milestone).toBe("MS-001");
		expect(item!.raw["sequence"]).toBe("1");
	});

	it("reads **Milestone:** that sits below a multi-line prose narrative in the header", () => {
		// Real issues interleave prose (Evidence/Update paragraphs with embedded
		// bold markdown) between the core fields and **Milestone:**. The header
		// region ends at the first `##` section heading, not the first prose line.
		const item = parseSweetClaudeFile(fixture("I-201-prose-interleaved-header.md"));
		expect(item).not.toBeNull();
		expect(item!.id).toBe("I-201");
		expect(item!.enums.status).toBe("backlog");
		expect(item!.raw["milestone"]).toBe("MS-007 (MVP Launch Readiness)");
		expect(item!.enums.milestone).toBe("MS-007");
	});

	it("returns null for a file with no bold-key block", () => {
		expect(parseSweetClaudeFile(fixture("garbage-no-bold-keys.md"))).toBeNull();
	});

	it("returns null for a file with no H1", () => {
		expect(parseSweetClaudeFile(fixture("garbage-no-h1.md"))).toBeNull();
	});
});

describe("parseSweetClaudeFile — enum extraction with annotations", () => {
	it("extracts the leading status enum from a parenthetical annotation", () => {
		const item = parseSweetClaudeFile(fixture("BL-042-parenthetical-annotation.md"))!;
		expect(item.enums.status).toBe("done");
		// raw value preserves the full annotated string
		expect(item.raw["status"]).toBe("done (merged 2026-05-19, PR #29)");
	});

	it("extracts the leading status enum from an em-dash annotation", () => {
		const item = parseSweetClaudeFile(fixture("BL-099-em-dash-annotation.md"))!;
		expect(item.enums.status).toBe("deferred");
		expect(item.raw["status"]).toBe("deferred — blocked on BL-039 quota meter");
	});

	it("extracts horizon enum from annotated horizon value", () => {
		const item = parseSweetClaudeFile(fixture("BL-099-em-dash-annotation.md"))!;
		expect(item.enums.horizon).toBe("later");
		expect(item.raw["horizon"]).toBe("later (Phase B)");
	});
});

describe("parseSweetClaudeFile — normalisation", () => {
	it("normalises legacy in_progress to in-progress", () => {
		const item = parseSweetClaudeFile(fixture("BL-077-underscore-status.md"))!;
		expect(item.enums.status).toBe("in-progress");
		// raw is preserved verbatim
		expect(item.raw["status"]).toBe("in_progress");
	});

	it("canonicalises milestone value with slug suffix to MS-NNN", () => {
		const item = parseSweetClaudeFile(fixture("BL-021-milestone-with-slug.md"))!;
		expect(item.enums.milestone).toBe("MS-002");
		expect(item.raw["milestone"]).toBe("MS-002-browser-extension-mvp");
	});
});

describe("parseSweetClaudeFile — dependsOn", () => {
	it("parses a comma-separated dependsOn list", () => {
		const item = parseSweetClaudeFile(fixture("BL-042-parenthetical-annotation.md"))!;
		expect(item.enums.dependsOn).toEqual(["BL-040", "BL-041"]);
	});

	it("treats (none) as empty array", () => {
		const item = parseSweetClaudeFile(fixture("I-001-clean-enums.md"))!;
		expect(item.enums.dependsOn).toEqual([]);
	});

	it("treats missing Depends on field as empty array", () => {
		const item = parseSweetClaudeFile(fixture("BL-077-underscore-status.md"))!;
		expect(item.enums.dependsOn).toEqual([]);
	});
});

describe("parseSweetClaudeFile — dual Horizon/Priority convention", () => {
	it("treats **Horizon:** and **Priority:** as the same conceptual field", () => {
		const horizonFile = parseSweetClaudeFile(fixture("BL-042-parenthetical-annotation.md"))!;
		const priorityFile = parseSweetClaudeFile(fixture("I-001-clean-enums.md"))!;
		expect(horizonFile.enums.horizon).toBe("next");
		expect(priorityFile.enums.horizon).toBe("next");
		// raw preserves which key was actually used on disk
		expect(horizonFile.raw["horizon"]).toBe("next");
		expect(horizonFile.raw["priority"]).toBeUndefined();
		expect(priorityFile.raw["priority"]).toBe("next");
		expect(priorityFile.raw["horizon"]).toBeUndefined();
	});
});

describe("round-trip parse → readback", () => {
	it("every fixture either parses cleanly or returns null without throwing", () => {
		const files = readdirSync(fixturesDir).filter((n) => n.endsWith(".md"));
		expect(files.length).toBeGreaterThan(0);
		for (const f of files) {
			expect(() => parseSweetClaudeFile(fixture(f))).not.toThrow();
		}
	});
});

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
    expect(item.enums.horizon).toBe("p0");
    expect(item.enums.milestone).toBe("EP-001");
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
