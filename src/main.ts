import {
	debounce,
	Keymap,
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	type TAbstractFile,
	type UserEvent,
	type WorkspaceLeaf,
} from "obsidian";
import {
	collectScanPaths,
	DEFAULT_SETTINGS,
	type KansidianSettings,
	KansidianSettingTab,
} from "./settings";
import { ItemIndex } from "./item-index";
import { updateBoldKeyEnum, updateFrontmatterEnum } from "./writer";
import { detectFormat } from "./format";
import {
	detectMode,
	type FileAccess,
	ProjectRootAccess,
	VaultAccess,
} from "./file-access";
import { KANSIDIAN_BOARD_VIEW_TYPE, KansidianBoardView } from "./views/board-view";
import { KANSIDIAN_LIST_VIEW_TYPE, KansidianListView } from "./views/list-view";

export type EnumKind = "status" | "horizon";

export type ProjectMode = "flow" | "kanban" | "shape_up" | "agile" | "agile_enterprise" | "unset";

const KNOWN_MODES: ProjectMode[] = ["flow", "kanban", "shape_up", "agile", "agile_enterprise"];

// Plugin IDs we recognize as providing dotdir indexing. If any of these is
// enabled, project-root-mode click-to-open into Obsidian's editor works
// natively. Otherwise we fall back to the system handler.
const KNOWN_HIDDEN_FILES_PLUGINS = ["show-hidden-files", "obsidian-show-dotfiles"];

function isMarkdownTAbstractFile(file: TAbstractFile | null): file is TFile {
	return file instanceof TFile && file.extension === "md";
}

function nextInCycle(current: string | undefined, cycle: readonly string[]): string {
	if (cycle.length === 0) return current ?? "";
	if (!current) return cycle[0]!;
	const i = cycle.indexOf(current);
	if (i === -1) return cycle[0]!;
	return cycle[(i + 1) % cycle.length]!;
}

export default class KansidianPlugin extends Plugin {
	settings!: KansidianSettings;
	index!: ItemIndex;
	mode: ProjectMode = "unset";
	vaultMode: "legacy" | "project-root" | "no-project" = "no-project";
	private access!: FileAccess;
	private hiddenPluginNoticeShown = false;

	// Settings text fields fire onChange per keystroke; wait for a pause in
	// typing before rescanning so we don't walk the vault once per character.
	private readonly debouncedRebuild = debounce(() => void this.index.rebuild(), 500, true);

	async onload() {
		await this.loadSettings();

		// Detect which vault layout we're in before anything else.
		await this.detectVaultLayout();

		this.index = new ItemIndex(this.access, {
			scanPaths: collectScanPaths(this.settings),
		});

		this.addSettingTab(new KansidianSettingTab(this.app, this));

		this.addRibbonIcon("kanban-square", "Kandyban board", () => {
			void this.activateView(KANSIDIAN_BOARD_VIEW_TYPE);
		});
		this.addRibbonIcon("list-checks", "Kandyban list", () => {
			void this.activateView(KANSIDIAN_LIST_VIEW_TYPE);
		});

		this.registerView(
			KANSIDIAN_BOARD_VIEW_TYPE,
			(leaf) => new KansidianBoardView(leaf, this),
		);
		this.registerView(
			KANSIDIAN_LIST_VIEW_TYPE,
			(leaf) => new KansidianListView(leaf, this),
		);

		this.addCommand({
			id: "open-board",
			name: "Open board",
			callback: () => void this.activateView(KANSIDIAN_BOARD_VIEW_TYPE),
		});
		this.addCommand({
			id: "open-list",
			name: "Open list",
			callback: () => void this.activateView(KANSIDIAN_LIST_VIEW_TYPE),
		});
		this.addCommand({
			id: "cycle-status",
			name: "Cycle status forward",
			checkCallback: (checking) => this.cycleActiveFile(checking, "status"),
		});
		this.addCommand({
			id: "cycle-horizon",
			name: "Cycle horizon forward",
			checkCallback: (checking) => this.cycleActiveFile(checking, "horizon"),
		});
		this.addCommand({
			id: "rescan-and-hint",
			name: "Rescan project",
			callback: () => void this.rescan(),
		});

		// Vault events. In legacy mode, fires for all tracked files. In
		// project-root mode, only fires for tracked files that Obsidian has
		// indexed (i.e. with a hidden-files plugin installed). Either way the
		// adapter side keeps working.
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				const logical = this.vaultPathToLogical(file.path);
				if (logical && isMarkdownTAbstractFile(file)) {
					void this.index.onPathModified(logical);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				const logical = this.vaultPathToLogical(file.path);
				if (logical && isMarkdownTAbstractFile(file)) {
					void this.index.onPathCreated(logical);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				const logical = this.vaultPathToLogical(file.path);
				if (logical) this.index.onPathDeleted(logical);
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				const newLogical = this.vaultPathToLogical(file.path);
				const oldLogical = this.vaultPathToLogical(oldPath);
				if (newLogical && oldLogical) {
					void this.index.onPathRenamed(newLogical, oldLogical);
				}
			}),
		);

		// Watch SweetClaude's state files for mode changes (regardless of vault
		// layout). Post-v3.18 projects keep the value in sweetclaude.yaml; older
		// projects still write it to phase.yaml.
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				const logical = this.vaultPathToLogical(file.path);
				if (logical === "state/sweetclaude.yaml" || logical === "state/phase.yaml") {
					void this.refreshMode();
				}
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			void this.index.rebuild();
			void this.refreshMode();
			this.maybeNudgeHiddenFilesPlugin();
		});

		console.debug(`Kandyban: loaded (vaultMode=${this.vaultMode})`);
	}

	onunload() {
		console.debug("Kandyban: unloaded");
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<KansidianSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		if (this.index) {
			this.index.setScanPaths(collectScanPaths(this.settings));
			this.debouncedRebuild();
		}
	}

	// (Re)detect the vault layout and pick the matching file-access strategy.
	// Re-run on rescan so a project created after Obsidian started is found
	// without reloading the plugin.
	private async detectVaultLayout(): Promise<void> {
		const detected = await detectMode(this.app.vault);
		if (detected === "legacy") {
			this.vaultMode = "legacy";
			this.access = new VaultAccess(this.app.vault);
		} else if (detected === "project-root") {
			this.vaultMode = "project-root";
			this.access = new ProjectRootAccess(this.app.vault);
		} else {
			this.vaultMode = "no-project";
			// Default to legacy access so list/board can render the empty-state
			// placeholder without crashing.
			this.access = new VaultAccess(this.app.vault);
		}
		this.index?.setAccess(this.access);
	}

	async refreshMode(): Promise<void> {
		const previous = this.mode;
		// sweetclaude.yaml is canonical post-v3.18. When present, treat it as
		// the only source of truth — older projects without it still keep mode
		// in phase.yaml, so probe that as the fallback.
		const sourcePaths = ["state/sweetclaude.yaml", "state/phase.yaml"];
		this.mode = "unset";
		for (const path of sourcePaths) {
			const result = await this.readModeFrom(path);
			if (result.exists) {
				this.mode = result.mode ?? "unset";
				break;
			}
		}
		if (this.mode !== previous) this.index.notifyChange();
	}

	private async readModeFrom(
		logicalPath: string,
	): Promise<{ exists: boolean; mode: ProjectMode | null }> {
		let content: string;
		try {
			content = await this.access.read(logicalPath);
		} catch {
			return { exists: false, mode: null };
		}
		const match = content.match(/^mode:\s*([a-z_]+)\s*$/m);
		const parsed = match?.[1] as ProjectMode | undefined;
		const mode = parsed && KNOWN_MODES.includes(parsed) ? parsed : null;
		return { exists: true, mode };
	}

	// Full refresh: vault layout, project mode, and the item index. Needed in
	// project-root mode, where edits made outside Obsidian (e.g. by Claude Code)
	// don't fire vault events.
	async rescan(): Promise<void> {
		await this.detectVaultLayout();
		await this.refreshMode();
		await this.index.rebuild();
		const count = this.index.all().filter((i) => i.kind === "backlog").length;
		new Notice(
			this.vaultMode === "no-project"
				? "Kandyban: no SweetClaude project found in this vault."
				: `Kandyban: rescanned — ${count} item${count === 1 ? "" : "s"}.`,
		);
	}

	// Translate an Obsidian vault path (e.g. ".sweetclaude/product/backlog/BL-001.md"
	// in project-root mode, or "product/backlog/BL-001.md" in legacy mode) into
	// the Kansidian-logical path that the index uses as a key. Returns null if
	// the path isn't part of Kansidian's scope.
	vaultPathToLogical(vaultPath: string): string | null {
		if (this.vaultMode === "project-root") {
			const prefix = ".sweetclaude/";
			if (vaultPath === ".sweetclaude" || vaultPath.startsWith(prefix)) {
				return vaultPath.startsWith(prefix) ? vaultPath.slice(prefix.length) : "";
			}
			return null;
		}
		return vaultPath;
	}

	// Reverse of vaultPathToLogical. Used by view openFile helpers.
	logicalToVaultPath(logical: string): string {
		return this.access.vaultPath(logical);
	}

	// Opens an item's file. A plain click focuses the file's existing tab if it
	// is already open, otherwise opens a new tab; Cmd/Ctrl-click, middle-click,
	// etc. follow Obsidian's usual new-tab/split/window conventions.
	async openLogical(logical: string, evt?: UserEvent): Promise<void> {
		const tfile = this.access.getTFile(logical);
		if (tfile) {
			const { workspace } = this.app;
			const paneType = Keymap.isModEvent(evt);
			if (!paneType) {
				const existing = workspace
					.getLeavesOfType("markdown")
					.find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === tfile.path);
				if (existing) {
					await workspace.revealLeaf(existing);
					return;
				}
			}
			await workspace.getLeaf(typeof paneType === "string" ? paneType : "tab").openFile(tfile);
			return;
		}
		// Fallback: hand off to the OS for files Obsidian can't open (no TFile
		// because no hidden-files plugin in project-root mode).
		const vaultPath = this.access.vaultPath(logical);
		try {
			// Obsidian provides this via the app object; works on desktop only.
			const adapter = this.app.vault.adapter as unknown as {
				getFullPath?: (path: string) => string;
			};
			const fullPath = adapter.getFullPath?.(vaultPath);
			if (fullPath) {
				// Electron's shell.openPath via Obsidian's helper.
				const electron = (window as unknown as { require?: (m: string) => unknown }).require;
				if (electron) {
					const { shell } = electron("electron") as { shell: { openPath: (p: string) => Promise<string> } };
					await shell.openPath(fullPath);
					return;
				}
			}
		} catch {
			// fall through to notice
		}
		new Notice(
			`Couldn't open ${vaultPath} in Obsidian (no TFile available). Install a "Show Hidden Files" community plugin for full Obsidian integration in project-root mode.`,
			8000,
		);
	}

	private cycleActiveFile(checking: boolean, which: EnumKind): boolean {
		const file = this.app.workspace.getActiveFile();
		if (!file || !isMarkdownTAbstractFile(file)) return false;
		const logical = this.vaultPathToLogical(file.path);
		if (!logical) return false;
		const item = this.index.get(logical);
		if (!item || item.enums[which] === undefined) return false;
		if (checking) return true;
		const vocabulary = which === "status" ? this.settings.statusEnums : this.settings.horizonEnums;
		void this.applyEnumChange(logical, which, nextInCycle(item.enums[which], vocabulary));
		return true;
	}

	// Writes a new status/horizon value back to the item's file. Horizon lives
	// in `**Horizon:**` or `**Priority:**` (SC3) or `priority:` (SC4). Failures
	// are surfaced as a notice rather than silently ignored.
	async applyEnumChange(logicalPath: string, which: EnumKind, newEnum: string): Promise<void> {
		const item = this.index.get(logicalPath);
		const name = item?.id ?? logicalPath;
		let label = which === "status" ? "Status" : "Horizon";
		try {
			const content = await this.access.read(logicalPath);
			let next: string;
			if (detectFormat(content) === "sc4") {
				if (which === "horizon") label = "Priority";
				next = updateFrontmatterEnum(content, label.toLowerCase(), newEnum);
			} else {
				if (which === "horizon" && item?.raw["horizon"] === undefined) label = "Priority";
				next = updateBoldKeyEnum(content, label, newEnum);
			}
			if (next === content) {
				if (item?.enums[which] !== newEnum) {
					new Notice(`Kandyban: couldn't update ${name} — no ${label} field found in the file.`);
				}
				return;
			}
			await this.access.write(logicalPath, next);
		} catch (error) {
			console.error(`Kandyban: failed to update ${logicalPath}`, error);
			new Notice(`Kandyban: couldn't update ${name} — ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		// In project-root mode without a hidden-files plugin, vault events won't
		// fire — surface the change via the index manually.
		if (!this.access.usesVaultEvents()) {
			await this.index.onPathModified(logicalPath);
		}
		new Notice(`Kandyban: ${label} → ${newEnum}`);
	}

	private async activateView(viewType: string): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(viewType);
		if (existing.length > 0) {
			await workspace.revealLeaf(existing[0]!);
			return;
		}
		const leaf: WorkspaceLeaf | null = workspace.getLeaf("tab");
		if (!leaf) return;
		await leaf.setViewState({ type: viewType, active: true });
		await workspace.revealLeaf(leaf);
	}

	private maybeNudgeHiddenFilesPlugin(): void {
		if (this.vaultMode !== "project-root") return;
		if (this.hiddenPluginNoticeShown) return;
		const plugins = (this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
		const enabled = plugins?.enabledPlugins;
		if (!enabled) return;
		for (const id of KNOWN_HIDDEN_FILES_PLUGINS) {
			if (enabled.has(id)) return; // already covered
		}
		this.hiddenPluginNoticeShown = true;
		new Notice(
			"Kandyban: running in project-root mode. Install a show-hidden-files community plugin to let click-to-open land in Obsidian instead of the system handler.",
			10000,
		);
	}
}
