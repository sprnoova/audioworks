import { App, Plugin, PluginManifest, WorkspaceLeaf, ItemView, Notice, setIcon } from "obsidian";
import { AudioWorksSettingTab, DEFAULT_SETTINGS, AudioWorksSettings } from "./settings";
import {VIEW_TYPE_RECORDER, RecorderView} from "recorderview";


export default class AudioWorks extends Plugin {
	settings: AudioWorksSettings;

	async onload() {
		console.log("Loading AudioWorks plugin...");
		// Add settings tab
		await this.loadSettings();
		this.addSettingTab(new AudioWorksSettingTab(this.app, this));

		// Register the custom view
		this.registerView(
			VIEW_TYPE_RECORDER,
			(leaf: WorkspaceLeaf) => new RecorderView(leaf, this)
		);

		// Command to open the recorder in a new tab
		this.addCommand({
			id: "open-recorder-view",
			name: "Open Audio Recorder",
			callback: () => this.activateView(),
		});
		
		// Ribbon icon shortcut
		this.addRibbonIcon("mic", "Open Audio Recorder", () => {
			this.activateView();
		});
	}

	async activateView() {
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({
			type: VIEW_TYPE_RECORDER,
			active: true,
		});
		this.app.workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	onunload() {
		this.app.workspace
			.getLeavesOfType(VIEW_TYPE_RECORDER)
			.forEach((leaf) => leaf.detach());
	}
}