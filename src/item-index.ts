// In-memory index of parsed SweetClaude items. Keys are logical (Kansidian-
// relative) path strings — NOT Obsidian TFile references — so the same index
// works whether the vault is `.sweetclaude/` (legacy) or the project root
// (project-root mode, where many .sweetclaude/* files have no TFile because
// Obsidian's indexer skips dotdirs).

import { parseSweetClaudeFile, type ParsedItem } from "./parser";
import type { FileAccess } from "./file-access";
import { matchesAnyRoot } from "./paths";

export type IndexChange =
	| { kind: "added"; id: string }
	| { kind: "changed"; id: string }
	| { kind: "removed"; id: string }
	| { kind: "noop" };

export type IndexListener = (change: IndexChange) => void;

export interface ItemIndexOptions {
	scanPaths: string[]; // logical (Kansidian-relative) dirs
}

export class ItemIndex {
	private readonly items = new Map<string, ParsedItem>(); // key: logical path
	private readonly listeners = new Set<IndexListener>();
	private access: FileAccess;
	private scanPaths: string[];
	// Bumped on every rebuild; a rebuild that finishes after a newer one started
	// discards its results instead of clobbering the fresher index.
	private generation = 0;

	constructor(access: FileAccess, options: ItemIndexOptions) {
		this.access = access;
		this.scanPaths = options.scanPaths;
	}

	setScanPaths(paths: string[]): void {
		this.scanPaths = paths;
	}

	setAccess(access: FileAccess): void {
		this.access = access;
	}

	size(): number {
		return this.items.size;
	}

	async rebuild(): Promise<void> {
		const generation = ++this.generation;
		const paths = await this.access.listMarkdownUnder(this.scanPaths);
		const parsed = await Promise.all(
			paths.map(async (p) => [p, await this.readAndParse(p)] as const),
		);
		if (generation !== this.generation) return;
		this.items.clear();
		for (const [p, item] of parsed) {
			if (item) this.items.set(p, item);
		}
		this.emit({ kind: "noop" });
	}

	subscribe(listener: IndexListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	notifyChange(): void {
		this.emit({ kind: "noop" });
	}

	all(): ParsedItem[] {
		return Array.from(this.items.values());
	}

	entries(): Array<[string, ParsedItem]> {
		return Array.from(this.items.entries());
	}

	byStatus(status: string): ParsedItem[] {
		return this.all().filter((i) => i.enums.status === status);
	}

	byMilestone(milestoneId: string): ParsedItem[] {
		return this.all().filter((i) => i.enums.milestone === milestoneId);
	}

	get(logicalPath: string): ParsedItem | undefined {
		return this.items.get(logicalPath);
	}

	// Vault-event handlers. Caller already filtered for tracked paths.
	async onPathModified(logicalPath: string): Promise<void> {
		if (!this.tracks(logicalPath)) return;
		await this.indexPath(logicalPath);
	}

	async onPathCreated(logicalPath: string): Promise<void> {
		if (!this.tracks(logicalPath)) return;
		await this.indexPath(logicalPath);
	}

	onPathDeleted(logicalPath: string): void {
		const existing = this.items.get(logicalPath);
		if (!existing) return;
		this.items.delete(logicalPath);
		this.emit({ kind: "removed", id: existing.id });
	}

	async onPathRenamed(newLogicalPath: string, oldLogicalPath: string): Promise<void> {
		const existing = this.items.get(oldLogicalPath);
		if (existing) {
			this.items.delete(oldLogicalPath);
			this.emit({ kind: "removed", id: existing.id });
		}
		if (!this.tracks(newLogicalPath)) return;
		await this.indexPath(newLogicalPath);
	}

	private tracks(logicalPath: string): boolean {
		if (!logicalPath.toLowerCase().endsWith(".md")) return false;
		return matchesAnyRoot(logicalPath, this.scanPaths);
	}

	// Returns null when the file can't be read (e.g. deleted between list and
	// read) or isn't a recognisable SweetClaude item.
	private async readAndParse(logicalPath: string): Promise<ParsedItem | null> {
		let content: string;
		try {
			content = await this.access.read(logicalPath);
		} catch {
			return null;
		}
		return parseSweetClaudeFile(content, logicalPath);
	}

	private async indexPath(logicalPath: string): Promise<void> {
		const previous = this.items.get(logicalPath);
		const parsed = await this.readAndParse(logicalPath);

		if (!parsed) {
			if (previous) {
				this.items.delete(logicalPath);
				this.emit({ kind: "removed", id: previous.id });
			}
			return;
		}

		this.items.set(logicalPath, parsed);
		if (!previous) {
			this.emit({ kind: "added", id: parsed.id });
		} else if (enumsEqual(previous, parsed)) {
			this.emit({ kind: "noop" });
		} else {
			this.emit({ kind: "changed", id: parsed.id });
		}
	}

	private emit(change: IndexChange): void {
		for (const listener of this.listeners) listener(change);
	}
}

function enumsEqual(a: ParsedItem, b: ParsedItem): boolean {
	const ae = a.enums;
	const be = b.enums;
	if (ae.status !== be.status) return false;
	if (ae.horizon !== be.horizon) return false;
	if (ae.milestone !== be.milestone) return false;
	if (ae.effort !== be.effort) return false;
	if (ae.dependsOn.length !== be.dependsOn.length) return false;
	for (let i = 0; i < ae.dependsOn.length; i++) {
		if (ae.dependsOn[i] !== be.dependsOn[i]) return false;
	}
	return a.title === b.title;
}
