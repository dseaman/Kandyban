// Pure parser for SweetClaude bold-key markdown artifacts (BL-*, I-*, MS-*).
// No `obsidian` imports. Strings in, structured object out.

export type ItemKind = "backlog" | "milestone";

export interface ParsedItem {
	id: string;
	kind: ItemKind;
	title: string;
	raw: Record<string, string>;
	enums: {
		status?: string;
		horizon?: string;
		milestone?: string;
		effort?: string;
		dependsOn: string[];
	};
}

const H1_RE = /^# ([A-Z]+-\d+): (.+?)\s*$/;
// Keys may contain spaces ("Roadmap Item"), digits, underscores
// ("mode_introduced"), and hyphens. keyToField normalises all of these.
const BOLD_KEY_RE = /^\*\*([A-Za-z][A-Za-z 0-9_-]*):\*\*\s*(.*?)\s*$/;
// A Markdown section heading (`## Description`, `## Outcome`, …) terminates the
// header region. The H1 is consumed separately, before scanning starts.
const HEADING_RE = /^#{1,6}\s/;
const MILESTONE_PREFIX = "MS";

function keyToField(rawKey: string): string {
	return rawKey.toLowerCase().replace(/[\s-]+/g, "_");
}

// Splits a bold-key value on the first annotation delimiter and returns the
// leading enum portion. Delimiters: ' (', ' —' (em-dash), ' - ' (ASCII hyphen
// with spaces). Same rule applied for filtering on read; the writer uses the
// same delimiter set when splicing.
export function extractEnum(value: string): string {
	const delimiters = [" (", " —", " - "];
	let cut = value.length;
	for (const d of delimiters) {
		const i = value.indexOf(d);
		if (i !== -1 && i < cut) cut = i;
	}
	return value.slice(0, cut).trim();
}

function normaliseStatus(value: string): string {
	const e = extractEnum(value).toLowerCase();
	return e.replace(/_/g, "-");
}

function normaliseHorizon(value: string): string {
	return extractEnum(value).toLowerCase();
}

function canonicaliseMilestone(value: string): string | undefined {
	const enumPart = extractEnum(value);
	const m = enumPart.match(/^(MS-\d+)/);
	return m ? m[1] : enumPart || undefined;
}

export function parseDependsOn(value: string): string[] {
	const trimmed = value.trim();
	if (!trimmed || trimmed === "(none)" || trimmed.toLowerCase() === "none") return [];
	return trimmed
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && s !== "(none)");
}

export function parseSweetClaudeFile(content: string): ParsedItem | null {
	const lines = content.split(/\r?\n/);

	// Find the H1.
	let h1Index = -1;
	let id = "";
	let title = "";
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const m = line.match(H1_RE);
		if (m) {
			h1Index = i;
			id = m[1]!;
			title = m[2]!;
			break;
		}
	}
	if (h1Index === -1) return null;

	// Collect bold-key fields from the header region. SweetClaude's issue
	// template scatters fields across multiple blocks and interleaves them with
	// multi-line prose (Evidence/Update paragraphs that themselves contain bold
	// markdown), with **Milestone:** often sitting below that prose. So we scan
	// the whole region up to the first `##`-style section heading, collecting
	// every bold-key line and ignoring prose, rather than stopping at the first
	// non-field line. First-wins, so a prose line that mimics a field can't
	// clobber the real value above it.
	const raw: Record<string, string> = {};
	for (let i = h1Index + 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (HEADING_RE.test(line)) break;
		const m = line.match(BOLD_KEY_RE);
		if (!m) continue;
		const field = keyToField(m[1]!);
		if (raw[field] === undefined) raw[field] = m[2]!;
	}

	if (Object.keys(raw).length === 0) return null;

	const kind: ItemKind = id.startsWith(`${MILESTONE_PREFIX}-`) ? "milestone" : "backlog";

	const enums: ParsedItem["enums"] = { dependsOn: [] };

	if (raw["status"] !== undefined) enums.status = normaliseStatus(raw["status"]);
	if (raw["horizon"] !== undefined) enums.horizon = normaliseHorizon(raw["horizon"]);
	else if (raw["priority"] !== undefined) enums.horizon = normaliseHorizon(raw["priority"]);
	if (raw["milestone"] !== undefined) {
		const c = canonicaliseMilestone(raw["milestone"]);
		if (c) enums.milestone = c;
	}
	if (raw["effort"] !== undefined) {
		const e = extractEnum(raw["effort"]).toLowerCase();
		if (e) enums.effort = e;
	}
	if (raw["depends_on"] !== undefined) enums.dependsOn = parseDependsOn(raw["depends_on"]);

	return { id, kind, title, raw, enums };
}
