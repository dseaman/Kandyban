// Tiny utility for keeping a text input focused across a synchronous
// re-render that destroys and recreates the DOM. Both views call this
// from render() so the user's search field doesn't drop focus mid-typing.

export interface FocusSnapshot {
	selector: string;
	cursor: number | null;
}

export function captureFocus(
	within: Element,
	knownSelectors: string[],
): FocusSnapshot | null {
	const active = within.ownerDocument.activeElement;
	if (!active || !within.contains(active)) return null;
	for (const selector of knownSelectors) {
		if (active.matches(selector)) {
			const cursor = readCursor(active);
			return { selector, cursor };
		}
	}
	return null;
}

export function restoreFocus(within: Element, snapshot: FocusSnapshot | null): void {
	if (!snapshot) return;
	const el = within.querySelector<HTMLInputElement | HTMLTextAreaElement>(snapshot.selector);
	if (!el) return;
	el.focus();
	if (snapshot.cursor !== null && hasSelectionRange(el)) {
		try {
			el.setSelectionRange(snapshot.cursor, snapshot.cursor);
		} catch {
			// Some input types (e.g. type=number) reject setSelectionRange.
		}
	}
}

function readCursor(active: Element): number | null {
	if (!hasSelectionRange(active)) return null;
	try {
		return active.selectionStart;
	} catch {
		return null;
	}
}

function hasSelectionRange(
	el: Element,
): el is HTMLInputElement | HTMLTextAreaElement {
	return (
		(el.instanceOf(HTMLInputElement) || el.instanceOf(HTMLTextAreaElement)) &&
		typeof el.setSelectionRange === "function"
	);
}
