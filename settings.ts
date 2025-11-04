import { App, PluginSettingTab, Setting } from "obsidian";
import AudioWorks from "./main";

export interface AudioWorksSettings {
	waveformStyle: "bars" | "line";
	recordingsFolder: string;
	format: "webm" | "mp3";
}

export const DEFAULT_SETTINGS: AudioWorksSettings = {
	waveformStyle: "bars",
	recordingsFolder: "recordings",
	format: "webm",
};

export class AudioWorksSettingTab extends PluginSettingTab {
	plugin: AudioWorks;

	constructor(app: App, plugin: AudioWorks) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "AudioWorks Settings" });

		// --- Waveform Style ---
		new Setting(containerEl)
			.setName("Waveform style")
			.setDesc("Choose how the waveform is visualized during and after recording.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("bars", "Bars")
					.addOption("line", "Continuous line")
					.setValue(this.plugin.settings.waveformStyle)
					.onChange(async (value) => {
						this.plugin.settings.waveformStyle = value as "bars" | "line";
						await this.plugin.saveSettings();
					})
			);

		// --- Recordings Folder ---
		new Setting(containerEl)
			.setName("Recordings folder")
			.setDesc("Folder inside your vault where recordings will be saved.")
			.addText((text) =>
				text
					.setPlaceholder("recordings")
					.setValue(this.plugin.settings.recordingsFolder)
					.onChange(async (value) => {
						this.plugin.settings.recordingsFolder = value.trim() || "recordings";
						await this.plugin.saveSettings();
					})
			);

		// --- Format ---
		new Setting(containerEl)
			.setName("Recording format")
			.setDesc("Choose the format for saved recordings.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("webm", "WebM (default, smaller)")
					.addOption("mp3", "MP3 (larger, more compatible)")
					.setValue(this.plugin.settings.format)
					.onChange(async (value) => {
						this.plugin.settings.format = value as "webm" | "mp3";
						await this.plugin.saveSettings();
					})
			);
	}
}