import { describe, it, expect } from "vitest";
import { ItemIndex, type IndexChange } from "../src/item-index";
import type { FileAccess } from "../src/file-access";
import { matchesAnyRoot } from "../src/paths";

// In-memory FileAccess. `gate` lets a test hold a listing open to simulate a
// slow rebuild racing a newer one; it's captured when the listing is requested.
class FakeAccess implements FileAccess {
	files = new Map<string, string>();
	gate: Promise<void> | null = null;

	vaultPath(logical: string): string {
		return logical;
	}
	async read(path: string): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`ENOENT ${path}`);
		return content;
	}
	async write(path: string, content: string): Promise<void> {
		this.files.set(path, content);
	}
	async listMarkdownUnder(roots: string[]): Promise<string[]> {
		const gate = this.gate;
		if (gate) await gate;
		return [...this.files.keys()].filter((p) => p.endsWith(".md") && matchesAnyRoot(p, roots));
	}
	getTFile(): null {
		return null;
	}
	usesVaultEvents(): boolean {
		return false;
	}
}

const item = (id: string, status: string): string => `# ${id}: Title ${id}\n\n**Status:** ${status}\n`;

function setup(): { access: FakeAccess; index: ItemIndex; changes: IndexChange[] } {
	const access = new FakeAccess();
	access.files.set("product/issues/I-001.md", item("I-001", "open"));
	access.files.set("product/issues/I-002.md", item("I-002", "done"));
	access.files.set("product/issues/notes.md", "no heading, not an item");
	access.files.set("elsewhere/I-003.md", item("I-003", "open"));
	const index = new ItemIndex(access, { scanPaths: ["product/issues"] });
	const changes: IndexChange[] = [];
	index.subscribe((c) => changes.push(c));
	return { access, index, changes };
}

describe("ItemIndex", () => {
	it("rebuild indexes parseable items under the scan paths only", async () => {
		const { index, changes } = setup();
		await index.rebuild();
		expect(index.all().map((i) => i.id).sort()).toEqual(["I-001", "I-002"]);
		expect(changes).toEqual([{ kind: "noop" }]);
	});

	it("a stale rebuild finishing late doesn't overwrite a newer one", async () => {
		const { access, index } = setup();
		let release!: () => void;
		access.gate = new Promise((r) => (release = r));
		const slow = index.rebuild(); // old scan paths, held open

		access.gate = null;
		index.setScanPaths(["elsewhere"]);
		await index.rebuild();
		release();
		await slow;

		expect(index.all().map((i) => i.id)).toEqual(["I-003"]);
	});

	it("emits changed / noop / removed for modifications", async () => {
		const { access, index, changes } = setup();
		await index.rebuild();
		changes.length = 0;

		access.files.set("product/issues/I-001.md", item("I-001", "done"));
		await index.onPathModified("product/issues/I-001.md");
		await index.onPathModified("product/issues/I-001.md");
		access.files.set("product/issues/I-001.md", "not an item any more");
		await index.onPathModified("product/issues/I-001.md");

		expect(changes).toEqual([
			{ kind: "changed", id: "I-001" },
			{ kind: "noop" },
			{ kind: "removed", id: "I-001" },
		]);
		expect(index.get("product/issues/I-001.md")).toBeUndefined();
	});

	it("handles create, rename out of scope, and delete", async () => {
		const { access, index, changes } = setup();
		await index.rebuild();
		changes.length = 0;

		access.files.set("product/issues/I-004.md", item("I-004", "open"));
		await index.onPathCreated("product/issues/I-004.md");
		await index.onPathRenamed("archive/I-004.md", "product/issues/I-004.md");
		index.onPathDeleted("product/issues/I-002.md");

		expect(changes).toEqual([
			{ kind: "added", id: "I-004" },
			{ kind: "removed", id: "I-004" },
			{ kind: "removed", id: "I-002" },
		]);
		expect(index.all().map((i) => i.id)).toEqual(["I-001"]);
	});
});
