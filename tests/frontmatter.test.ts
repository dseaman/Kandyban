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
    expect(s["done"]).toBeUndefined();
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
