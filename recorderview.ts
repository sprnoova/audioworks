
import { ItemView, Notice, setIcon } from "obsidian";
import type AudioWorksPlugin from "./main";

export const VIEW_TYPE_RECORDER = "audio-recorder-view";

export class RecorderView extends ItemView {
	private plugin: AudioWorksPlugin;
	private mediaRecorder: MediaRecorder | null = null;
	private audioCtx: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private source: MediaStreamAudioSourceNode | null = null;
	private dataArray: Uint8Array | null = null;
	private animationFrame: number | null = null;
	private chunks: BlobPart[] = [];
	private isRecording = false;
	private isPaused = false;

	private canvas: HTMLCanvasElement | null = null;
	private canvasCtx: CanvasRenderingContext2D | null = null;
	private audioContainer: HTMLElement | null = null;

	// Scrolling waveform data
	private waveformHistory: number[] = [];
	private maxHistoryLength = 500; // Number of data points to keep

	constructor(leaf: any, plugin: AudioWorksPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_RECORDER;
	}

	getDisplayText() {
		return "Audio Recorder";
	}

	getIcon() {
		return "mic";
	}

	async onOpen() {
		const container = this.containerEl
		container.empty();
		//defining class
		container.addClass(VIEW_TYPE_RECORDER);

		/** -- HTML -- **/
		//adding html elements
		container.createEl("h2", { text: "🎙 Audio Recorder" });
		this.audioContainer = container.createDiv({ cls: "audio-player-container" });

        //waveform canvas
		this.canvas = container.createEl("canvas", { cls: "waveform-canvas" });
		this.canvas.width = container.clientWidth;
		this.canvas.height = 500;
		this.canvasCtx = this.canvas.getContext("2d");

		//buttons
		const pauseBtn = container.createEl("button", { cls: "pause-btn" });
		setIcon(pauseBtn, "pause");
		pauseBtn.disabled = true;

		const RecordBtn = container.createEl("button", { cls: "record-btn" });  //Start-Stop
		setIcon(RecordBtn, "play")
		/** --------- **/

		/** btn events **/
		RecordBtn.onclick = async () => {
			if (this.isRecording) {
				// Stopping
				await this.stopRecording();
				setIcon(RecordBtn, "play")
				pauseBtn.disabled = true;
				this.isPaused = false;
				setIcon(pauseBtn, "pause")
			} else {
				// Starting
				try {
				await this.startRecording();
				setIcon(RecordBtn, "square")
				pauseBtn.disabled = false;} catch (err) {
					console.error(err);
					new Notice("Failed to start recording");
				}
			}
		};
		pauseBtn.onclick = async () => {
			if (!this.mediaRecorder) return;
			if (!this.isPaused) {
				// Pausing
				this.mediaRecorder.pause();
				this.isPaused = true;
				setIcon(pauseBtn, "play");
				new Notice("Recording paused");
			} else {
				// Resuming
				this.mediaRecorder.resume();
				this.isPaused = false;
				setIcon(pauseBtn, "pause");
				new Notice("Recording resumed");
			}
		};
		/** ----- **/

	}

	async startRecording() {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

		this.audioCtx = new AudioContext();
		this.source = this.audioCtx.createMediaStreamSource(stream);
		this.analyser = this.audioCtx.createAnalyser();
		this.analyser.fftSize = 2048;

		const bufferLength = this.analyser.frequencyBinCount;
		this.dataArray = new Uint8Array(bufferLength);

		this.source.connect(this.analyser);

		// Reset waveform history
		this.waveformHistory = [];

		// Start visualizing
		this.drawWaveform();

		this.mediaRecorder = new MediaRecorder(stream);
		this.chunks = [];

		this.mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) this.chunks.push(e.data);
		};

		this.mediaRecorder.onstop = async () => {
			const blob = new Blob(this.chunks, { type: "audio/webm" });
			await this.saveRecording(blob);
			this.stopVisualization(); // stop drawing
		};

		this.mediaRecorder.start();
		this.isRecording = true;
		new Notice("Recording...");
	}

	async stopRecording() {
		if (!this.mediaRecorder || !this.isRecording) return;
		this.mediaRecorder.stop();
		this.isRecording = false;
		new Notice("Recording stopped");
	}

	async saveRecording(blob: Blob) {
		try {
			const arrayBuffer = await blob.arrayBuffer();

			// Save to /Recordings/ directory in vault
			const folder = "recordings";
			const vault = this.app.vault;

			if (!(await vault.adapter.exists(folder))) {
				await vault.createFolder(folder);
			}

			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const filename = `${folder}/recording-${timestamp}.webm`; // WebM for now

			await vault.createBinary(filename, arrayBuffer);
			new Notice(`Saved as ${filename}`);

			this.showAudioPlayer(filename, blob);
		} catch (err) {
			console.error(err);
			new Notice("Failed to save recording");
		}
	}

    private stopVisualization() {
		if (this.animationFrame) {
			cancelAnimationFrame(this.animationFrame);
			this.animationFrame = null;
		}
	}

	private drawWaveform() {
		if (!this.canvasCtx || !this.analyser || !this.dataArray) return;
		const ctx = this.canvasCtx;
		const analyser = this.analyser;
		const dataArray = this.dataArray;
		const width = this.canvas!.width;
		const height = this.canvas!.height;

		const draw = () => {
			// Don't continue if paused
			if (this.isPaused) {
				this.animationFrame = requestAnimationFrame(draw);
				return;
			}

			this.animationFrame = requestAnimationFrame(draw);
			analyser.getByteTimeDomainData(dataArray as Uint8Array<ArrayBuffer>);

			// Calculate RMS (Root Mean Square) for amplitude
			let sum = 0;
			for (let i = 0; i < dataArray.length; i++) {
				const normalized = (dataArray[i] - 128) / 128;
				sum += normalized * normalized;
			}
			const rms = Math.sqrt(sum / dataArray.length);
			const amplitude = rms * 2; // Scale for visibility

			// Add new amplitude to history
			this.waveformHistory.push(amplitude);
			
			// Keep history at max length
			if (this.waveformHistory.length > this.maxHistoryLength) {
				this.waveformHistory.shift();
			}

			// Clear canvas
			ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--background-primary");
			ctx.fillRect(0, 0, width, height);

			// Draw center line
			ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue("--background-modifier-border");
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(0, height / 2);
			ctx.lineTo(width, height / 2);
			ctx.stroke();

			// Draw waveform based on style
			if (this.plugin.settings.waveformStyle === "line") {
				this.drawLineWaveform(ctx, width, height);
			} else {
				this.drawBarWaveform(ctx, width, height);
			}
		};
		draw();
	}

	private drawLineWaveform(ctx: CanvasRenderingContext2D, width: number, height: number) {
		if (this.waveformHistory.length < 2) return;

		const pointSpacing = width / this.maxHistoryLength;
		
		ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue("--interactive-accent");
		ctx.lineWidth = 2;
		ctx.beginPath();

		// Draw upper wave
		for (let i = 0; i < this.waveformHistory.length; i++) {
			const x = i * pointSpacing;
			const amplitude = this.waveformHistory[i];
			const y = height / 2 - (amplitude * height * 0.4);
			
			if (i === 0) {
				ctx.moveTo(x, y);
			} else {
				ctx.lineTo(x, y);
			}
		}

		// Draw lower wave (mirror)
		for (let i = this.waveformHistory.length - 1; i >= 0; i--) {
			const x = i * pointSpacing;
			const amplitude = this.waveformHistory[i];
			const y = height / 2 + (amplitude * height * 0.4);
			ctx.lineTo(x, y);
		}

		ctx.closePath();
		ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--interactive-accent") + "40"; // Add transparency
		ctx.fill();
		ctx.stroke();
	}

	private drawBarWaveform(ctx: CanvasRenderingContext2D, width: number, height: number) {
		const barWidth = width / this.maxHistoryLength;
		const accentColor = getComputedStyle(document.body).getPropertyValue("--interactive-accent");

		for (let i = 0; i < this.waveformHistory.length; i++) {
			const x = i * barWidth;
			const amplitude = this.waveformHistory[i];
			const barHeight = amplitude * height * 0.4;

			// Create gradient for each bar (more recent = brighter)
			const opacity = 0.3 + (i / this.waveformHistory.length) * 0.7;
			ctx.fillStyle = accentColor + Math.floor(opacity * 255).toString(16).padStart(2, '0');
			
			// Draw bar from center
			ctx.fillRect(x, height / 2 - barHeight, barWidth - 1, barHeight * 2);
		}
	}

	private showAudioPlayer(filename: string, blob: Blob) {
		if (!this.audioContainer) return;
		this.audioContainer.empty();

		const title = this.audioContainer.createEl("p", {
			text: `▶️ ${filename}`,
			cls: "audio-player-title"
		});

		const audio = this.audioContainer.createEl("audio", {
			cls: "audio-player"
		});

		audio.controls = true;
		audio.src = URL.createObjectURL(blob);
	}

	async onClose() {
		this.containerEl.empty();
	}
}