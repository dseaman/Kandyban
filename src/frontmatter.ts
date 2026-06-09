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
