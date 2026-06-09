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
