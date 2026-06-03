import { ItemView, setIcon, WorkspaceLeaf } from "obsidian";
import type KansidianPlugin from "../main";
import type { ParsedItem } from "../parser";
import { captureFocus, restoreFocus } from "./preserve-focus";
import { modeBadge, renderModePlaceholder, shouldShowPlaceholder } from "./mode-placeholder";
import { compareItems, type SortState } from "./list-sort";

// Cards default-sort by horizon within each column: now → … → someday in the
// configured vocabulary, with missing horizons last (see compareItems).
const HORIZON_SORT: SortState = { column: "horizon", direction: "asc" };

const FOCUSABLE_SELECTORS = [".kansidian-board-search"];

export const KANSIDIAN_BOARD_VIEW_TYPE = "kandyban-board";

interface BoardFilters {
	search: string;
	horizon: string;
	milestone: string;
}

type Entry = [string, ParsedItem]; // [logicalPath, item]

// Drag payload: we use the logical file path (unique per file) rather than
// the item id (not unique when data has duplicate MS-NNN ids).
const DRAG_MIME = "application/x-kandyban-file-path";

// Highlight window (ms) after a drag-drop during which the destination card
// gets the "just moved" CSS class. Slightly larger than the flash animation
// so the highlight survives re-renders triggered by the same change event.
const JUST_MOVED_WINDOW_MS = 1200;

// FLIP transition duration (ms) for cards animating from old to new position.
const FLIP_DURATION_MS = 280;

export class KansidianBoardView extends ItemView {
	private readonly plugin: KansidianPlugin;
	private unsubscribe?: () => void;
	private filters: BoardFilters = { search: "", horizon: "", milestone: "" };
	private recentlyMovedPath: string | null = null;
	private recentlyMovedAt = 0;

	constructor(leaf: WorkspaceLeaf, plugin: KansidianPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return KANSIDIAN_BOARD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Kandyban board";
	}

	getIcon(): string {
		return "kanban-square";
	}

	async onOpen(): Promise<void> {
		this.unsubscribe = this.plugin.index.subscribe(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
	}

	private render(): void {
		const root = this.containerEl.children[1];
		if (!root) return;

		const focusSnapshot = captureFocus(this.containerEl, FOCUSABLE_SELECTORS);

		// Capture pre-render state for FLIP and scroll preservation.
		const previousColumnsContainer = root.querySelector<HTMLElement>(".kansidian-board-columns");
		const savedScrollLeft = previousColumnsContainer?.scrollLeft ?? 0;
		const previousCardRects = this.snapshotCardRects(root);

		try {
			root.empty();
			root.addClass("kansidian-board-root");

			const mode = this.plugin.mode;
			if (shouldShowPlaceholder(mode)) {
				renderModePlaceholder(root, mode);
				return;
			}

			const entries = this.plugin.index.entries();
			const filtered = this.sortByHorizon(this.applyFilters(entries));

			const header = root.createDiv({ cls: "kansidian-board-header" });
			header.createEl("h2", { text: `Kandyban board (${filtered.length} of ${entries.length}) · ${modeBadge(mode)}` });

			this.renderToolbar(root.createDiv({ cls: "kansidian-board-toolbar" }), entries);

			const columnsContainer = root.createDiv({ cls: "kansidian-board-columns" });
			const columnNames = this.deriveColumns(filtered.map(([, i]) => i));

			for (const columnName of columnNames) {
				this.renderColumn(columnsContainer, columnName, filtered);
			}

			if (columnNames.length === 0) {
				columnsContainer.createEl("p", {
					text: entries.length === 0
						? "No items in the index yet. Check the configured paths in settings."
						: "No items match the current filters.",
				});
			}

			// Restore horizontal scroll so a re-render doesn't bounce the viewport.
			columnsContainer.scrollLeft = savedScrollLeft;

			// Run FLIP after layout settles so getBoundingClientRect is accurate.
			if (previousCardRects.size > 0) {
				window.requestAnimationFrame(() => this.playFlip(previousCardRects, root));
			}
		} finally {
			restoreFocus(this.containerEl, focusSnapshot);
		}
	}

	private snapshotCardRects(root: Element): Map<string, DOMRect> {
		const rects = new Map<string, DOMRect>();
		root.querySelectorAll<HTMLElement>(".kansidian-board-card").forEach((el) => {
			const path = el.dataset["path"];
			if (path) rects.set(path, el.getBoundingClientRect());
		});
		return rects;
	}

	private playFlip(previous: Map<string, DOMRect>, root: Element): void {
		root.querySelectorAll<HTMLElement>(".kansidian-board-card").forEach((card) => {
			const path = card.dataset["path"];
			if (!path) return;
			const before = previous.get(path);
			if (!before) return;
			const after = card.getBoundingClientRect();
			const dx = before.left - after.left;
			const dy = before.top - after.top;
			if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
			// Web Animations API — no inline style mutation; the animation
			// runs once and leaves the card's resting style untouched.
			card.animate(
				[
					{ transform: `translate(${dx}px, ${dy}px)` },
					{ transform: "translate(0, 0)" },
				],
				{ duration: FLIP_DURATION_MS, easing: "ease", fill: "none" },
			);
		});
	}

	// Stable sort: equal-horizon cards keep their incoming (index) order.
	private sortByHorizon(entries: Entry[]): Entry[] {
		const vocab = {
			status: this.plugin.settings.statusEnums,
			horizon: this.plugin.settings.horizonEnums,
		};
		return [...entries].sort(([, a], [, b]) => compareItems(a, b, HORIZON_SORT, vocab));
	}

	private applyFilters(entries: Entry[]): Entry[] {
		const { search, horizon, milestone } = this.filters;
		const needle = search.trim().toLowerCase();
		return entries.filter(([, item]) => {
			if (item.kind !== "backlog") return false; // board surfaces backlog items only
			if (horizon && item.enums.horizon !== horizon) return false;
			if (milestone && item.enums.milestone !== milestone) return false;
			if (needle) {
				const haystack = `${item.id} ${item.title}`.toLowerCase();
				if (!haystack.includes(needle)) return false;
			}
			return true;
		});
	}

	private deriveColumns(items: ParsedItem[]): string[] {
		const configured = this.plugin.settings.statusEnums;
		const inData = new Set<string>();
		for (const i of items) {
			if (i.enums.status) inData.add(i.enums.status);
		}
		const result: string[] = [...configured];
		for (const s of configured) inData.delete(s);
		for (const extra of Array.from(inData).sort()) {
			result.push(extra);
		}
		return result;
	}

	private renderToolbar(toolbar: HTMLElement, entries: Entry[]): void {
		const searchWrapper = toolbar.createDiv({ cls: "kansidian-search-wrapper" });
		const searchInput = searchWrapper.createEl("input", {
			type: "search",
			placeholder: "Search id or title…",
			cls: "kansidian-board-search",
		});
		searchInput.value = this.filters.search;
		searchInput.addEventListener("input", () => {
			this.filters.search = searchInput.value;
			this.render();
		});
		const clearBtn = searchWrapper.createEl("div", {
			cls: "kansidian-search-clear",
			attr: { role: "button", tabindex: "0", "aria-label": "Clear search" },
		});
		setIcon(clearBtn, "x");
		const clear = (): void => {
			this.filters.search = "";
			this.render();
			const refocus = this.containerEl.querySelector<HTMLInputElement>(".kansidian-board-search");
			refocus?.focus();
		};
		clearBtn.addEventListener("click", clear);
		clearBtn.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				clear();
			}
		});

		const items = entries.map(([, item]) => item);
		const uniqueHorizons = sortedUnique(items.map((i) => i.enums.horizon));
		const uniqueMilestones = sortedUnique(items.map((i) => i.enums.milestone));
		this.renderFilterSelect(toolbar, "horizon", uniqueHorizons, this.filters.horizon, (v) => {
			this.filters.horizon = v;
		});
		this.renderFilterSelect(toolbar, "milestone", uniqueMilestones, this.filters.milestone, (v) => {
			this.filters.milestone = v;
		});
	}

	private renderFilterSelect(
		parent: HTMLElement,
		label: string,
		options: string[],
		current: string,
		onChange: (value: string) => void,
	): void {
		const select = parent.createEl("select", { cls: `kansidian-board-filter kansidian-board-filter-${label}` });
		select.createEl("option", { text: `all ${label}`, value: "" });
		for (const opt of options) {
			const el = select.createEl("option", { text: opt, value: opt });
			if (opt === current) el.selected = true;
		}
		select.addEventListener("change", () => {
			onChange(select.value);
			this.render();
		});
	}

	private renderColumn(parent: HTMLElement, status: string, entries: Entry[]): void {
		const column = parent.createDiv({ cls: "kansidian-board-column" });
		const inColumn = entries.filter(([, i]) => (i.enums.status ?? "") === status);

		const head = column.createDiv({ cls: "kansidian-board-column-head" });
		head.createEl("span", { text: status, cls: "kansidian-board-column-name" });
		head.createEl("span", { text: String(inColumn.length), cls: "kansidian-board-column-count" });

		column.dataset["status"] = status;

		column.addEventListener("dragover", (event) => {
			event.preventDefault();
			column.addClass("kansidian-board-column-dropping");
		});
		column.addEventListener("dragleave", () => {
			column.removeClass("kansidian-board-column-dropping");
		});
		column.addEventListener("drop", (event) => {
			event.preventDefault();
			column.removeClass("kansidian-board-column-dropping");
			const filePath = event.dataTransfer?.getData(DRAG_MIME);
			if (!filePath) return;
			this.moveFileToStatus(filePath, status);
		});

		const list = column.createDiv({ cls: "kansidian-board-cards" });
		for (const [logicalPath, item] of inColumn) {
			this.renderCard(list, logicalPath, item);
		}
	}

	private renderCard(parent: HTMLElement, logicalPath: string, item: ParsedItem): void {
		const card = parent.createDiv({ cls: "kansidian-board-card" });
		card.draggable = true;
		card.dataset["path"] = logicalPath;

		if (
			logicalPath === this.recentlyMovedPath &&
			Date.now() - this.recentlyMovedAt < JUST_MOVED_WINDOW_MS
		) {
			card.addClass("kansidian-board-card-just-moved");
		}

		card.createDiv({ cls: "kansidian-board-card-id", text: item.id });
		card.createDiv({ cls: "kansidian-board-card-title", text: item.title });

		const meta = card.createDiv({ cls: "kansidian-board-card-meta" });
		if (item.enums.milestone) {
			meta.createEl("span", {
				text: item.enums.milestone,
				cls: "kansidian-board-card-milestone",
			});
		}
		if (item.enums.horizon) {
			meta.createEl("span", {
				text: item.enums.horizon,
				cls: "kansidian-board-card-horizon-chip",
			});
		}
		if (item.enums.effort) {
			meta.createEl("span", {
				text: item.enums.effort,
				cls: "kansidian-board-card-effort-chip",
			});
		}

		card.addEventListener("dragstart", (event) => {
			event.dataTransfer?.setData(DRAG_MIME, logicalPath);
			if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
			card.addClass("kansidian-board-card-dragging");
		});
		card.addEventListener("dragend", () => {
			card.removeClass("kansidian-board-card-dragging");
		});
		card.addEventListener("click", () => {
			void this.plugin.openLogical(logicalPath);
		});
	}

	private moveFileToStatus(logicalPath: string, targetStatus: string): void {
		const item = this.plugin.index.get(logicalPath);
		if (!item) return;
		if (item.enums.status === targetStatus) return;
		// Mark this card for the destination-highlight flash before the change
		// kicks off the index → render cycle.
		this.recentlyMovedPath = logicalPath;
		this.recentlyMovedAt = Date.now();
		void this.plugin.applyEnumChange(logicalPath, "Status", targetStatus);
	}
}

function sortedUnique(values: Array<string | undefined>): string[] {
	const set = new Set<string>();
	for (const v of values) {
		if (typeof v === "string" && v.length > 0) set.add(v);
	}
	return Array.from(set).sort();
}
