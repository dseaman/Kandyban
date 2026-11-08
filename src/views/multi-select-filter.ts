// Checkbox-popover filters shared by the board and list views. Each filter key
// holds a selection: null means "everything" (no filtering), a Set means only
// those values. The views re-render their whole DOM on every change, so the
// controller remembers which popover was open and reopens it afterwards.

export type Selection = Set<string> | null;

interface OpenPopover<K extends string> {
	wrapper: HTMLElement;
	popover: HTMLElement;
	key: K;
	cleanup: () => void;
}

export function filterButtonLabel(
	key: string,
	options: string[],
	selection: Selection,
): string {
	if (options.length === 0) return `${key}: —`;
	if (selection === null) return `${key}: all (${options.length})`;
	if (selection.size === 0) return `${key}: none`;
	return `${key}: ${selection.size} of ${options.length}`;
}

export class MultiSelectFilters<K extends string> {
	private readonly selections = new Map<K, Selection>();
	private readonly wrappers = new Map<K, { el: HTMLElement; options: string[] }>();
	private open: OpenPopover<K> | null = null;
	private reopenKey: K | null = null;

	constructor(
		private readonly rerender: () => void,
		private readonly labelFor: (value: string) => string = (v) => v,
	) {}

	get(key: K): Selection {
		return this.selections.get(key) ?? null;
	}

	// True when `value` passes the filter for `key`. An undefined value only
	// passes when the filter is inactive.
	matches(key: K, value: string | undefined): boolean {
		const selection = this.get(key);
		if (selection === null) return true;
		return value !== undefined && selection.has(value);
	}

	// Call at the start of the view's render: drops the previous DOM's popover.
	beginRender(): void {
		this.closePopover();
		this.wrappers.clear();
	}

	// Call at the end of the view's render: reopens the popover the user was
	// interacting with, if the render was triggered from inside it.
	endRender(): void {
		const key = this.reopenKey;
		this.reopenKey = null;
		if (key === null) return;
		const wrapper = this.wrappers.get(key);
		if (wrapper) this.openPopover(key, wrapper.el, wrapper.options);
	}

	// Removes the open popover and its document listeners (e.g. on view close).
	closePopover(): void {
		if (!this.open) return;
		this.open.cleanup();
		this.open.popover.remove();
		this.open = null;
	}

	renderButton(toolbar: HTMLElement, key: K, options: string[]): void {
		const selection = this.get(key);
		const wrapper = toolbar.createDiv({
			cls: `kansidian-list-filter kansidian-list-filter-${key}`,
		});
		this.wrappers.set(key, { el: wrapper, options });
		const button = wrapper.createEl("button", {
			cls: "kansidian-list-filter-button",
			text: filterButtonLabel(key, options, selection),
		});
		if (selection !== null) button.addClass("kansidian-list-filter-button-active");
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			if (this.open?.wrapper === wrapper) {
				this.closePopover();
			} else {
				this.openPopover(key, wrapper, options);
			}
		});
	}

	private openPopover(key: K, anchor: HTMLElement, options: string[]): void {
		this.closePopover();

		const popover = anchor.createDiv({ cls: "kansidian-list-filter-popover" });
		const selection = this.get(key);
		const allActive = selection === null;

		const allRow = popover.createDiv({
			cls: "kansidian-list-filter-row kansidian-list-filter-all",
		});
		const allCheckbox = allRow.createEl("input", { type: "checkbox" });
		allCheckbox.checked = allActive;
		allCheckbox.indeterminate = selection !== null && selection.size > 0;
		allRow.createSpan({ text: `all ${key}` });
		allRow.addEventListener("click", (event) => {
			event.stopPropagation();
			this.update(key, allActive ? new Set<string>() : null);
		});

		for (const opt of options) {
			const row = popover.createDiv({ cls: "kansidian-list-filter-row" });
			const checkbox = row.createEl("input", { type: "checkbox" });
			checkbox.checked = selection === null || selection.has(opt);
			row.createSpan({ text: this.labelFor(opt) });
			row.addEventListener("click", (event) => {
				event.stopPropagation();
				this.update(key, toggled(selection, options, opt));
			});
		}

		const onDocumentClick = (event: MouseEvent): void => {
			if (!(event.target instanceof Node)) return;
			if (popover.contains(event.target) || anchor.contains(event.target)) return;
			this.closePopover();
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") this.closePopover();
		};
		activeDocument.addEventListener("mousedown", onDocumentClick);
		activeDocument.addEventListener("keydown", onKeyDown);

		this.open = {
			wrapper: anchor,
			popover,
			key,
			cleanup: () => {
				activeDocument.removeEventListener("mousedown", onDocumentClick);
				activeDocument.removeEventListener("keydown", onKeyDown);
			},
		};
	}

	private update(key: K, selection: Selection): void {
		this.selections.set(key, selection);
		this.reopenKey = key;
		this.rerender();
	}
}

// Next selection after clicking `opt`. Selecting every option collapses back
// to null ("all") so newly appearing values aren't hidden by a stale list.
export function toggled(current: Selection, options: string[], opt: string): Selection {
	if (current === null) {
		const next = new Set(options);
		next.delete(opt);
		return next;
	}
	const next = new Set(current);
	if (next.has(opt)) {
		next.delete(opt);
		return next;
	}
	next.add(opt);
	return next.size === options.length ? null : next;
}
