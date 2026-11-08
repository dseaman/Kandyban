// Pure path helpers shared by the file-access layer and the item index.
// No `obsidian` imports, so the index stays unit-testable.

// True when `path` is one of `roots` or sits anywhere beneath one of them.
export function matchesAnyRoot(path: string, roots: string[]): boolean {
	const normalised = path.replace(/^\/+/, "");
	for (const r of roots) {
		const root = r.replace(/\/+$/, "");
		if (root.length === 0) continue;
		if (normalised === root || normalised.startsWith(`${root}/`)) return true;
	}
	return false;
}
