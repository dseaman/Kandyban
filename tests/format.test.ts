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
