// Pure writer for SweetClaude bold-key markdown artifacts.
// Surgical splice: replaces only the leading enum portion of a `**Field:** …`
// line. Annotations after ' (', ' —', or ' - ' are preserved byte-identical.
// No `obsidian` imports.

import { extractEnum } from "./parser";

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function updateBoldKeyEnum(
	content: string,
	field: string,
	newEnum: string,
): string {
	const lineRe = new RegExp(
		`^(\\*\\*${escapeRegex(field)}:\\*\\*\\s*)(.*)$`,
		"m",
	);
	const match = content.match(lineRe);
	if (!match) return content;

	const prefix = match[1]!;
	const value = match[2]!;
	const currentEnum = extractEnum(value);
	if (currentEnum === newEnum) return content;

	// Find the annotation delimiter (if any) in the original value, in the
	// same way the parser does. Everything from the delimiter onward is the
	// annotation and must be preserved verbatim.
	const delimiters = [" (", " —", " - "];
	let cut = value.length;
	for (const d of delimiters) {
		const i = value.indexOf(d);
		if (i !== -1 && i < cut) cut = i;
	}
	const annotation = value.slice(cut); // includes the leading space + delimiter

	const newValue = newEnum + annotation;
	const newLine = prefix + newValue;
	// Function-form replacement: returning a literal avoids `$1`/`$&` expansion
	// when the preserved annotation contains a dollar sign (e.g. "($1.2M budget)").
	return content.replace(lineRe, () => newLine);
}

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
	// Function-form replacement: returning a literal avoids `$1`/`$&` expansion
	// when the preserved trailing comment contains a dollar sign (e.g. "# see $1").
	const newBlock = fullBlock.replace(lineRe, () => prefix + newEnum + comment);
	return newBlock + content.slice(fullBlock.length);
}
