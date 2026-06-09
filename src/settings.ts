import { App, PluginSettingTab, Setting } from "obsidian";
import type KansidianPlugin from "./main";

export interface KansidianSettings {
	// Vault-relative paths. Both backlog and issues are scanned to support
	// the convention drift between Saive's BL-* layout and the current
	// SweetClaude framework's I-* layout. Either may be empty to disable.
	backlogPath: string;
	issuesPath: string;
	milestonesPath: string;
	roadmapPath: string;

	// Enum vocabularies for the "cycle forward" commands. Comma-separated in
	// the UI, normalised to string[] in memory. First entry is the default
	// when an item has no current value.
	statusEnums: string[];
	horizonEnums: string[];
}

export const DEFAULT_SETTINGS: KansidianSettings = {
	backlogPath: "product/backlog",
	issuesPath: "product/issues",
	milestonesPath: "product/milestones",
	roadmapPath: "product/roadmap",
	statusEnums: ["open", "in-progress", "done"],
	horizonEnums: ["now", "next", "sooner", "soon", "later", "someday"],
};

const SCAN_PATH_KEYS: ReadonlyArray<keyof Pick<
	KansidianSettings,
	"backlogPath" | "issuesPath" | "milestonesPath" | "roadmapPath"
>> = ["backlogPath", "issuesPath", "milestonesPath", "roadmapPath"];

function parseCsvEnum(raw: string, fallback: string[]): string[] {
	const parsed = raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	return parsed.length > 0 ? parsed : fallback;
}

export class KansidianSettingTab extends PluginSettingTab {
	plugin: KansidianPlugin;

	constructor(app: App, plugin: KansidianPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const mode = this.plugin.vaultMode;
		const intro = containerEl.createEl("p");
		if (mode === "legacy") {
			intro.appendText("Vault layout: the vault root is ");
			intro.createEl("code", { text: ".sweetclaude/" });
			intro.appendText(" itself (legacy mode). Paths below are vault-relative.");
		} else if (mode === "project-root") {
			intro.appendText("Vault layout: project root, with ");
			intro.createEl("code", { text: ".sweetclaude/" });
			intro.appendText(
				" as a child dir. Kandyban reads it via vault.adapter (Obsidian's indexer skips dotdirs). Paths below are relative to ",
			);
			intro.createEl("code", { text: ".sweetclaude/" });
			intro.appendText(".");
		} else {
			intro.appendText(
				"No project detected in this vault. Kandyban looks for ",
			);
			intro.createEl("code", { text: "state/sweetclaude.yaml" });
			intro.appendText(" at the vault root, or ");
			intro.createEl("code", { text: ".sweetclaude/state/sweetclaude.yaml" });
			intro.appendText(" inside it. Older projects with ");
			intro.createEl("code", { text: "state/phase.yaml" });
			intro.appendText(" are also detected.");
		}

		new Setting(containerEl)
			.setName("Backlog path")
			.setDesc("Scanned for legacy backlog items (filenames starting with bl-). Leave blank to disable.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.backlogPath)
					.setValue(this.plugin.settings.backlogPath)
					.onChange(async (value) => {
						this.plugin.settings.backlogPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Issues path")
			.setDesc("Scanned for current issues (filenames starting with i-). Leave blank to disable.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.issuesPath)
					.setValue(this.plugin.settings.issuesPath)
					.onChange(async (value) => {
						this.plugin.settings.issuesPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Milestones path")
			.setDesc("Scanned for milestone files (filenames starting with ms-).")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.milestonesPath)
					.setValue(this.plugin.settings.milestonesPath)
					.onChange(async (value) => {
						this.plugin.settings.milestonesPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Roadmap path")
			.setDesc("Scanned for SweetClaude 4.x roadmap entities such as epics (under roadmap/epics/). Leave blank to disable.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.roadmapPath)
					.setValue(this.plugin.settings.roadmapPath)
					.onChange(async (value) => {
						this.plugin.settings.roadmapPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Status enum vocabulary")
			.setDesc(
				"Comma-separated values the cycle-status command rotates through. Default: open, in-progress, done.",
			)
			.addTextArea((area) =>
				area
					.setPlaceholder(DEFAULT_SETTINGS.statusEnums.join(", "))
					.setValue(this.plugin.settings.statusEnums.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.statusEnums = parseCsvEnum(
							value,
							DEFAULT_SETTINGS.statusEnums,
						);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Horizon enum vocabulary")
			.setDesc(
				"Comma-separated values the cycle-horizon command rotates through. Default: now, next, sooner, soon, later, someday.",
			)
			.addTextArea((area) =>
				area
					.setPlaceholder(DEFAULT_SETTINGS.horizonEnums.join(", "))
					.setValue(this.plugin.settings.horizonEnums.join(", "))
					.onChange(async (value) => {
						this.plugin.settings.horizonEnums = parseCsvEnum(
							value,
							DEFAULT_SETTINGS.horizonEnums,
						);
						await this.plugin.saveSettings();
					}),
			);
	}
}

export function collectScanPaths(settings: KansidianSettings): string[] {
	return SCAN_PATH_KEYS.map((k) => settings[k])
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
}
