import { ItemView, Menu, setIcon, WorkspaceLeaf } from "obsidian";
import type KansidianPlugin from "../main";
import type { ParsedItem } from "../parser";
import { captureFocus, restoreFocus } from "./preserve-focus";
import { modeBadge, renderModePlaceholder, shouldShowPlaceholder } from "./mode-placeholder";
import { compareItems, type SortColumn, type SortState } from "./list-sort";

const FOCUSABLE_SELECTORS = [".kansidian-list-search"];

export const KANSIDIAN_LIST_VIEW_TYPE = "kandyban-list";

const SORTABLE_COLUMNS: SortColumn[] = ["id", "title", "status", "horizon", "milestone", "scope"];

type FilterKey = "status" | "horizon" | "milestone";

interface ListFilters {
	search: string;
	status: Set<string> | null;
	horizon: Set<string> | null;
	milestone: Set<string> | null;
}

type EnumField = "Status" | "Horizon" | "Priority";

type Entry = [string, ParsedItem]; // [logicalPath, item]

function nextSortState(current: SortState | null, column: SortColumn): SortState | null {
	if (current?.column !== column) return { column, direction: "asc" };
	if (current.direction === "asc") return { column, direction: "desc" };
	return null;
}

function filterButtonLabel(
	key: string,
	options: string[],
	selection: Set<string> | null,
): string {
	if (options.length === 0) return `${key}: —`;
	if (selection === null) return `${key}: all (${options.length})`;
	if (selection.size === 0) return `${key}: none`;
	return `${key}: ${selection.size} of ${options.length}`;
}

export class KansidianListView extends ItemView {
	private readonly plugin: KansidianPlugin;
	private unsubscribe?: () => void;
	private filters: ListFilters = {
		search: "",
		status: null,
		horizon: null,
		milestone: null,
	};
	private sort: SortState | null = null;
	private openPopover: {
		wrapper: HTMLElement;
		popover: HTMLElement;
		key: FilterKey;
		options: string[];
		cleanup: () => void;
	} | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: KansidianPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return KANSIDIAN_LIST_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Kandyban list";
	}

	getIcon(): string {
		return "list-checks";
	}

	async onOpen(): Promise<void> {
		this.unsubscribe = this.plugin.index.subscribe(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
	}

	private render(opts?: { preservePopover?: boolean }): void {
		const preserved =
			opts?.preservePopover && this.openPopover
				? { key: this.openPopover.key, options: this.openPopover.options }
				: null;
		this.closeOpenPopover();
		const root = this.containerEl.children[1];
		if (!root) return;
		const focusSnapshot = captureFocus(this.containerEl, FOCUSABLE_SELECTORS);
		let toolbarRendered = false;
		try {
			root.empty();
			root.addClass("kansidian-list-root");

			const mode = this.plugin.mode;
			if (shouldShowPlaceholder(mode)) {
				renderModePlaceholder(root, mode);
				return;
			}
			toolbarRendered = true;

			// Milestone files (MS-*) are entities items belong to, not work items
			// themselves — surface only backlog items as rows, matching the board.
			const entries = this.plugin.index
				.entries()
				.filter(([, item]) => item.kind === "backlog");
			const filtered = this.applyFilters(entries);
			const sorted = this.applySort(filtered);

			const header = root.createDiv({ cls: "kansidian-list-header" });
			header.createEl("h2", { text: `Kandyban list (${filtered.length} of ${entries.length}) · ${modeBadge(mode)}` });

			this.renderToolbar(root.createDiv({ cls: "kansidian-list-toolbar" }), entries);

			const table = root.createEl("table", { cls: "kansidian-list-table" });
			const thead = table.createEl("thead");
			const headerRow = thead.createEl("tr");
			for (const column of SORTABLE_COLUMNS) {
				this.renderHeaderCell(headerRow, column);
			}

			const tbody = table.createEl("tbody");
			if (filtered.length === 0) {
				const emptyRow = tbody.createEl("tr");
				const cell = emptyRow.createEl("td");
				cell.colSpan = SORTABLE_COLUMNS.length;
				cell.setText(
					entries.length === 0
						? "No items in the index yet. Check the configured paths in settings."
						: "No items match the current filters.",
				);
			} else {
				for (const [file, item] of sorted) {
					this.renderRow(tbody, file, item);
				}
			}
		} finally {
			restoreFocus(this.containerEl, focusSnapshot);
		}

		if (toolbarRendered && preserved) {
			const wrapper = root.querySelector(`.kansidian-list-filter-${preserved.key}`);
			if (wrapper instanceof HTMLElement) {
				this.toggleFilterPopover(wrapper, preserved.key, preserved.options);
			}
		}
	}

	private applySort(entries: Entry[]): Entry[] {
		if (!this.sort) return entries;
		const vocab = {
			status: this.plugin.settings.statusEnums,
			horizon: this.plugin.settings.horizonEnums,
		};
		const sort = this.sort;
		return [...entries].sort(([, a], [, b]) => compareItems(a, b, sort, vocab));
	}

	private renderHeaderCell(headerRow: HTMLElement, column: SortColumn): void {
		const th = headerRow.createEl("th", { cls: "kansidian-list-th" });
		th.createSpan({ text: column, cls: "kansidian-list-th-label" });

		const indicator = th.createSpan({ cls: "kansidian-list-th-indicator" });
		if (this.sort?.column === column) {
			setIcon(indicator, this.sort.direction === "asc" ? "arrow-up" : "arrow-down");
			th.addClass("kansidian-list-th-active");
		}

		th.addEventListener("click", () => this.cycleSort(column));
	}

	private cycleSort(column: SortColumn): void {
		this.sort = nextSortState(this.sort, column);
		this.render();
	}

	private applyFilters(entries: Entry[]): Entry[] {
		const { search, status, horizon, milestone } = this.filters;
		const needle = search.trim().toLowerCase();
		return entries.filter(([, item]) => {
			if (status !== null) {
				if (!item.enums.status || !status.has(item.enums.status)) return false;
			}
			if (horizon !== null) {
				if (!item.enums.horizon || !horizon.has(item.enums.horizon)) return false;
			}
			if (milestone !== null) {
				if (!item.enums.milestone || !milestone.has(item.enums.milestone)) return false;
			}
			if (needle) {
				const haystack = `${item.id} ${item.title}`.toLowerCase();
				if (!haystack.includes(needle)) return false;
			}
			return true;
		});
	}

	private closeOpenPopover(): void {
		if (!this.openPopover) return;
		this.openPopover.cleanup();
		this.openPopover.popover.remove();
		this.openPopover = null;
	}

	private renderToolbar(toolbar: HTMLElement, entries: Entry[]): void {
		const searchWrapper = toolbar.createDiv({ cls: "kansidian-search-wrapper" });
		const searchInput = searchWrapper.createEl("input", {
			type: "search",
			placeholder: "Search id or title…",
			cls: "kansidian-list-search",
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
			const refocus = this.containerEl.querySelector<HTMLInputElement>(".kansidian-list-search");
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
		const uniqueStatuses = sortedUnique(items.map((i) => i.enums.status));
		const uniqueHorizons = sortedUnique(items.map((i) => i.enums.horizon));
		const uniqueMilestones = sortedUnique(items.map((i) => i.enums.milestone));

		this.renderMultiSelectFilter(toolbar, "status", uniqueStatuses);
		this.renderMultiSelectFilter(toolbar, "horizon", uniqueHorizons);
		this.renderMultiSelectFilter(toolbar, "milestone", uniqueMilestones);
	}

	private renderMultiSelectFilter(
		toolbar: HTMLElement,
		key: FilterKey,
		options: string[],
	): void {
		const selection = this.filters[key];
		const wrapper = toolbar.createDiv({
			cls: `kansidian-list-filter kansidian-list-filter-${key}`,
		});
		const button = wrapper.createEl("button", {
			cls: "kansidian-list-filter-button",
			text: filterButtonLabel(key, options, selection),
		});
		if (selection !== null) button.addClass("kansidian-list-filter-button-active");
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			this.toggleFilterPopover(wrapper, key, options);
		});
	}

	private toggleFilterPopover(
		anchor: HTMLElement,
		key: FilterKey,
		options: string[],
	): void {
		if (this.openPopover?.wrapper === anchor) {
			this.closeOpenPopover();
			return;
		}
		this.closeOpenPopover();

		const popover = anchor.createDiv({ cls: "kansidian-list-filter-popover" });
		const selection = this.filters[key];
		const allActive = selection === null;
		const someSelected = selection !== null && selection.size > 0;

		const allRow = popover.createDiv({
			cls: "kansidian-list-filter-row kansidian-list-filter-all",
		});
		const allCheckbox = allRow.createEl("input", { type: "checkbox" });
		allCheckbox.checked = allActive;
		allCheckbox.indeterminate = someSelected;
		allRow.createSpan({ text: `all ${key}` });
		allRow.addEventListener("click", (event) => {
			event.stopPropagation();
			this.filters[key] = allActive ? new Set<string>() : null;
			this.render({ preservePopover: true });
		});

		for (const opt of options) {
			const row = popover.createDiv({ cls: "kansidian-list-filter-row" });
			const checkbox = row.createEl("input", { type: "checkbox" });
			checkbox.checked = selection === null || selection.has(opt);
			row.createSpan({ text: opt });
			row.addEventListener("click", (event) => {
				event.stopPropagation();
				this.toggleFilterValue(key, options, opt);
			});
		}

		const onDocumentClick = (event: MouseEvent): void => {
			if (!(event.target instanceof Node)) return;
			if (popover.contains(event.target) || anchor.contains(event.target)) return;
			this.closeOpenPopover();
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") this.closeOpenPopover();
		};
		document.addEventListener("mousedown", onDocumentClick);
		document.addEventListener("keydown", onKeyDown);

		this.openPopover = {
			wrapper: anchor,
			popover,
			key,
			options,
			cleanup: () => {
				document.removeEventListener("mousedown", onDocumentClick);
				document.removeEventListener("keydown", onKeyDown);
			},
		};
	}

	private toggleFilterValue(key: FilterKey, options: string[], opt: string): void {
		const current = this.filters[key];
		if (current === null) {
			const next = new Set(options);
			next.delete(opt);
			this.filters[key] = next;
		} else if (current.has(opt)) {
			current.delete(opt);
		} else {
			current.add(opt);
			if (current.size === options.length) {
				this.filters[key] = null;
			}
		}
		this.render({ preservePopover: true });
	}

	private renderRow(tbody: HTMLElement, logicalPath: string, item: ParsedItem): void {
		const row = tbody.createEl("tr", { cls: "kansidian-list-row" });

		const idCell = row.createEl("td", { text: item.id, cls: "kansidian-list-id" });
		const titleCell = row.createEl("td", { text: item.title, cls: "kansidian-list-title" });
		const statusCell = row.createEl("td", { cls: "kansidian-list-cell-enum" });
		const horizonCell = row.createEl("td", { cls: "kansidian-list-cell-enum" });
		row.createEl("td", { text: item.enums.milestone ?? "", cls: "kansidian-list-milestone" });
		row.createEl("td", { text: item.raw["scope"] ?? "", cls: "kansidian-list-scope" });

		this.renderEnumCell(statusCell, logicalPath, item, "status", this.plugin.settings.statusEnums);
		this.renderEnumCell(horizonCell, logicalPath, item, "horizon", this.plugin.settings.horizonEnums);

		const openFile = (): void => {
			void this.plugin.openLogical(logicalPath);
		};
		idCell.addEventListener("click", openFile);
		titleCell.addEventListener("click", openFile);
	}

	private renderEnumCell(
		cell: HTMLElement,
		logicalPath: string,
		item: ParsedItem,
		which: "status" | "horizon",
		vocabulary: string[],
	): void {
		const current = item.enums[which] ?? "";
		cell.empty();
		cell.setText(current);

		if (vocabulary.length === 0) return;

		cell.addEventListener("click", (event) => {
			event.stopPropagation();
			this.openEnumMenu(event, logicalPath, item, which, vocabulary, current);
		});
	}

	private openEnumMenu(
		event: MouseEvent,
		logicalPath: string,
		item: ParsedItem,
		which: "status" | "horizon",
		vocabulary: string[],
		current: string,
	): void {
		const menu = new Menu();
		// Show the current value first if it isn't in the configured vocabulary,
		// so the user can see what the file actually has.
		const choices = vocabulary.includes(current) ? vocabulary : [current, ...vocabulary];

		for (const opt of choices) {
			menu.addItem((menuItem) => {
				menuItem.setTitle(opt);
				if (opt === current) menuItem.setIcon("checkmark");
				menuItem.onClick(() => {
					if (opt === current) return;
					const field: EnumField =
						which === "status"
							? "Status"
							: item.raw["horizon"] !== undefined
								? "Horizon"
								: "Priority";
					void this.plugin.applyEnumChange(logicalPath, field, opt);
				});
			});
		}

		menu.showAtMouseEvent(event);
	}
}

function sortedUnique(values: Array<string | undefined>): string[] {
	const set = new Set<string>();
	for (const v of values) {
		if (typeof v === "string" && v.length > 0) set.add(v);
	}
	return Array.from(set).sort();
}
