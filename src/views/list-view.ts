import { ItemView, Menu, setIcon, WorkspaceLeaf } from "obsidian";
import type { EnumKind, default as KansidianPlugin } from "../main";
import type { ParsedItem } from "../parser";
import { captureFocus, restoreFocus } from "./preserve-focus";
import { modeBadge, renderModePlaceholder, shouldShowPlaceholder } from "./mode-placeholder";
import { MultiSelectFilters } from "./multi-select-filter";
import { compareItems, sortedOptions, type SortColumn, type SortState, type SortVocabulary } from "./list-sort";

const FOCUSABLE_SELECTORS = [".kansidian-list-search"];

export const KANSIDIAN_LIST_VIEW_TYPE = "kandyban-list";

const SORTABLE_COLUMNS: SortColumn[] = ["id", "title", "status", "horizon", "milestone", "scope"];

type FilterKey = "status" | "horizon" | "milestone";

type Entry = [string, ParsedItem]; // [logicalPath, item]

function nextSortState(current: SortState | null, column: SortColumn): SortState | null {
	if (current?.column !== column) return { column, direction: "asc" };
	if (current.direction === "asc") return { column, direction: "desc" };
	return null;
}

export class KansidianListView extends ItemView {
	private readonly plugin: KansidianPlugin;
	private unsubscribe?: () => void;
	private search = "";
	private readonly filters = new MultiSelectFilters<FilterKey>(() => this.render());
	private sort: SortState | null = null;

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
		this.addAction("refresh-cw", "Rescan project", () => void this.plugin.rescan());
		this.unsubscribe = this.plugin.index.subscribe(() => this.render());
		this.render();
	}

	async onClose(): Promise<void> {
		this.unsubscribe?.();
		this.filters.closePopover();
	}

	private render(): void {
		this.filters.beginRender();
		const root = this.containerEl.children[1];
		if (!root) return;
		const focusSnapshot = captureFocus(this.containerEl, FOCUSABLE_SELECTORS);
		try {
			root.empty();
			root.addClass("kansidian-list-root");

			const mode = this.plugin.mode;
			if (shouldShowPlaceholder(mode)) {
				renderModePlaceholder(root, mode);
				return;
			}

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
		this.filters.endRender();
	}

	private vocab(): SortVocabulary {
		return {
			status: this.plugin.settings.statusEnums,
			horizon: this.plugin.settings.horizonEnums,
		};
	}

	private applySort(entries: Entry[]): Entry[] {
		if (!this.sort) return entries;
		const vocab = this.vocab();
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
		const needle = this.search.trim().toLowerCase();
		return entries.filter(([, item]) => {
			if (!this.filters.matches("status", item.enums.status)) return false;
			if (!this.filters.matches("horizon", item.enums.horizon)) return false;
			if (!this.filters.matches("milestone", item.enums.milestone)) return false;
			if (needle) {
				const haystack = `${item.id} ${item.title}`.toLowerCase();
				if (!haystack.includes(needle)) return false;
			}
			return true;
		});
	}

	private renderToolbar(toolbar: HTMLElement, entries: Entry[]): void {
		const searchWrapper = toolbar.createDiv({ cls: "kansidian-search-wrapper" });
		const searchInput = searchWrapper.createEl("input", {
			type: "search",
			placeholder: "Search id or title…",
			cls: "kansidian-list-search",
		});
		searchInput.value = this.search;
		searchInput.addEventListener("input", () => {
			this.search = searchInput.value;
			this.render();
		});
		const clearBtn = searchWrapper.createEl("div", {
			cls: "kansidian-search-clear",
			attr: { role: "button", tabindex: "0", "aria-label": "Clear search" },
		});
		setIcon(clearBtn, "x");
		const clear = (): void => {
			this.search = "";
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
		const vocab = this.vocab();
		const uniqueStatuses = sortedOptions(items.map((i) => i.enums.status), "status", vocab);
		const uniqueHorizons = sortedOptions(items.map((i) => i.enums.horizon), "horizon", vocab);
		const uniqueMilestones = sortedOptions(items.map((i) => i.enums.milestone), "milestone", vocab);

		this.filters.renderButton(toolbar, "status", uniqueStatuses);
		this.filters.renderButton(toolbar, "horizon", uniqueHorizons);
		this.filters.renderButton(toolbar, "milestone", uniqueMilestones);
	}

	private renderRow(tbody: HTMLElement, logicalPath: string, item: ParsedItem): void {
		const row = tbody.createEl("tr", { cls: "kansidian-list-row" });

		const idCell = row.createEl("td", { text: item.id, cls: "kansidian-list-id" });
		const titleCell = row.createEl("td", { text: item.title, cls: "kansidian-list-title" });
		const statusCell = row.createEl("td", { cls: "kansidian-list-cell-enum" });
		const horizonCell = row.createEl("td", { cls: "kansidian-list-cell-enum" });
		row.createEl("td", { text: item.enums.milestone ?? "", cls: "kansidian-list-milestone" });
		row.createEl("td", { text: item.raw["scope"] ?? "", cls: "kansidian-list-scope" });

		this.renderEnumCell(statusCell, logicalPath, "status", item.enums.status ?? "", this.plugin.settings.statusEnums);
		this.renderEnumCell(horizonCell, logicalPath, "horizon", item.enums.horizon ?? "", this.plugin.settings.horizonEnums);

		const openFile = (event: MouseEvent): void => {
			void this.plugin.openLogical(logicalPath, event);
		};
		// Middle-click opens in a new tab, as elsewhere in Obsidian.
		const openOnMiddleClick = (event: MouseEvent): void => {
			if (event.button !== 1) return;
			event.preventDefault();
			openFile(event);
		};
		for (const cell of [idCell, titleCell]) {
			cell.addEventListener("click", openFile);
			cell.addEventListener("auxclick", openOnMiddleClick);
		}
	}

	private renderEnumCell(
		cell: HTMLElement,
		logicalPath: string,
		which: EnumKind,
		current: string,
		vocabulary: string[],
	): void {
		cell.empty();
		cell.setText(current);

		if (vocabulary.length === 0) return;

		cell.addEventListener("click", (event) => {
			event.stopPropagation();
			this.openEnumMenu(event, logicalPath, which, vocabulary, current);
		});
	}

	private openEnumMenu(
		event: MouseEvent,
		logicalPath: string,
		which: EnumKind,
		vocabulary: string[],
		current: string,
	): void {
		const menu = new Menu();
		// Show the current value first if it isn't in the configured vocabulary,
		// so the user can see what the file actually has.
		const choices = !current || vocabulary.includes(current) ? vocabulary : [current, ...vocabulary];

		for (const opt of choices) {
			menu.addItem((menuItem) => {
				menuItem.setTitle(opt);
				if (opt === current) menuItem.setIcon("checkmark");
				menuItem.onClick(() => {
					if (opt === current) return;
					void this.plugin.applyEnumChange(logicalPath, which, opt);
				});
			});
		}

		menu.showAtMouseEvent(event);
	}
}
