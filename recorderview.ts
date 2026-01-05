import { ItemView, Notice, setIcon } from "obsidian";
import type AudioWorksPlugin from "./main";

export const VIEW_TYPE_RECORDER = "audio-recorder-view";

export class RecorderView extends ItemView {
	/* ===============================
	        Core plugin / audio state
	   =============================== */
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

	/* ===============================
	        DOM elements
	   =============================== */
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private audioContainer: HTMLElement | null = null;
	private waveformScroll: HTMLElement | null = null;

	/* ===============================
	        Waveform model
	   =============================== */

	// One entry = one time slice (≈ one animation frame)
	private waveformHistory: number[] = [];

	// Rendering constants
	private readonly PX_PER_SECOND = 100;
	private readonly HISTORY_RESOLUTION = 1 / 60; // seconds per entry
	private readonly CANVAS_HEIGHT = 500;


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
		/** -- DOM -- **/
		const container = this.containerEl
		container.empty();
		// Defining css class
		container.addClass(VIEW_TYPE_RECORDER);

		// Adding html elements
		container.createEl("h2", { text: "🎙 Audio Recorder" });
		this.audioContainer = container.createDiv({ cls: "audio-player-container" });
		this.waveformScroll = this.audioContainer.createDiv({cls: "waveform-scroll"});

        // Waveform canvas
		this.canvas = this.waveformScroll.createEl("canvas", { cls: "waveform-canvas" });
		this.canvas.width = 0;
		this.canvas.height = this.CANVAS_HEIGHT;

		this.ctx = this.canvas.getContext("2d");

		// Buttons
		const pauseBtn = container.createEl("button", { cls: "pause-btn" });
		setIcon(pauseBtn, "pause");
		pauseBtn.disabled = true;

		const RecordBtn = container.createEl("button", { cls: "record-btn" });  //Start-Stop
		setIcon(RecordBtn, "play")
		/** --------- **/

		/* ---- Button events ---- */
		// Record/Stop
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
				pauseBtn.disabled = false;
				} catch (err) {
					console.error(err);
					new Notice("Failed to start recording");
				}
			}
		};
		// Pause/Play
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
		/* ---------------------- */

	}

	async onClose() {
		this.stopVisualization();
		this.containerEl.empty();
	}

	async startRecording() {
		// Get audio input
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
		if (this.canvas) this.canvas.width = 0;

		// Record audio
		this.mediaRecorder = new MediaRecorder(stream);
		this.chunks = [];

		// Saving data to temporary chunks
		this.mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) this.chunks.push(e.data);
		};

		this.mediaRecorder.onstop = async () => {
			const blob = new Blob(this.chunks, { type: `audio/${this.plugin.settings.format}` });
			await this.saveRecording(blob);
			this.stopVisualization(); // stop drawing
		};

		this.mediaRecorder.start();
		this.isRecording = true;

		this.startVisualization();
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
			
			// Save to "./recordings/ " directory in vault
			const folder = "recordings";
			const vault = this.app.vault;

			// Create folder if not already existing
			if (!(await vault.adapter.exists(folder))) {
				await vault.createFolder(folder);
			}

			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const filename = `${folder}/recording-${timestamp}.${this.plugin.settings.format}`;

			await vault.createBinary(filename, arrayBuffer);
			new Notice(`Saved as ${filename}`);

			//** TEMPORARY : show the audio player
			// this.showAudioPlayer(filename, blob);
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

	private startVisualization() {
		if (!this.canvas || !this.ctx || !this.analyser || !this.dataArray) return;

		const ctx = this.ctx;
		const analyser = this.analyser;
		const dataArray = this.dataArray;
		const height = this.canvas.height;

		const pxPerEntry =
			this.PX_PER_SECOND * this.HISTORY_RESOLUTION;

		const bg = getComputedStyle(document.body)
			.getPropertyValue("--background-primary");
		const accent = getComputedStyle(document.body)
			.getPropertyValue("--interactive-accent");

		const draw = () => {
			if (!this.isRecording) return;
			this.animationFrame = requestAnimationFrame(draw);
			if (this.isPaused) return;

			/* ---- Read audio ---- */
			analyser.getByteTimeDomainData(dataArray as Uint8Array<ArrayBuffer>);

			/* ---- RMS amplitude ---- */
			let sum = 0;
			for (let i = 0; i < dataArray.length; i++) {
				const v = (dataArray[i] - 128) / 128;
				sum += v * v;
			}
			const rms = Math.sqrt(sum / dataArray.length);
			const amplitude = rms * 2;

			/* ---- Append history ---- */
			const index = this.waveformHistory.length;
			this.waveformHistory.push(amplitude);

			/* ---- Grow canvas if needed ---- */
			const neededWidth = Math.ceil((index + 1) * pxPerEntry);

			// Resizing the canvas clears it, so we must copy the old content back.
       		if (this.canvas!.width < neededWidth) {
				// Only attempt to copy if the current canvas has a size
				if (this.canvas!.width > 0 && this.canvas!.height > 0) {
					const tempCanvas = document.createElement('canvas');
					tempCanvas.width = this.canvas!.width;
					tempCanvas.height = this.canvas!.height;
					const tempCtx = tempCanvas.getContext('2d');
					
					if (tempCtx) {
						tempCtx.drawImage(this.canvas!, 0, 0);
						this.canvas!.width = neededWidth;
						
						// Restore background and old content
						ctx.fillStyle = bg;
						ctx.fillRect(0, 0, neededWidth, height);
						ctx.drawImage(tempCanvas, 0, 0);
					}
				} else {
					// First frame: just set the width and fill background
					this.canvas!.width = neededWidth;
					ctx.fillStyle = bg;
					ctx.fillRect(0, 0, neededWidth, height);
				}
			}

			/* ---- Draw waveform slice ---- */
			const x = index * pxPerEntry;
			const ampPx = amplitude * height * 0.4;

			ctx.fillStyle = accent;
			ctx.fillRect(
				x,
				height / 2 - ampPx,
				pxPerEntry,
				ampPx * 2
			);

			/* ---- Auto-scroll (right edge) ---- */
			if (this.waveformScroll) {
				this.waveformScroll.scrollLeft =
					this.canvas!.width -
					this.waveformScroll.clientWidth;
			}
		};

		draw();
	}

	/* ===============================
	        old waveform system
	   =============================== */
	/*
	private drawWaveform() {
		if (!this.ctx || !this.analyser || !this.dataArray) return;
		const ctx = this.ctx;
		const analyser = this.analyser;
		const dataArray = this.dataArray;

		// Setting canvas size
		const width = this.canvas!.width;
		const height = this.canvas!.height;
		//const audioDuration = dataArray.length;
		//canvas.width = audioDuration * this.PX_PER_SECOND
		// ^ no need for duration, rather keep the already existing chunks system and assign this to the playhead value (in time) then implement scrollbar first then starting point on left rather than actual right... //


		const draw = () => {
			// Don't continue if paused
			if (this.isPaused) {
				this.animationFrame = requestAnimationFrame(draw);
				return;
			}

			this.animationFrame = requestAnimationFrame(draw);
			analyser.getByteTimeDomainData(dataArray as Uint8Array<ArrayBuffer>);

			// Calculate RMS (Root Mean Square) for amplitude
				// (Basic smoothing)
			let sum = 0;
			for (let i = 0; i < dataArray.length; i++) {
				const normalized = (dataArray[i] - 128) / 128;
				sum += normalized * normalized;
			}
			const rms = Math.sqrt(sum / dataArray.length);
			const amplitude = rms * 2; // Scale for visibility

			// Add new amplitude to history
			this.waveformHistory.push(amplitude);
			// Update the canvas width
			this.canvas!.width = this.waveformHistory.length;

			
			// Keep history at max length
			//if (this.waveformHistory.length > this.maxPlayheadLength) {
			//	this.waveformHistory.shift();
			//}
			

			// Clear canvas
			ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--background-primary");
			ctx.fillRect(0, 0, this.canvas!.width, height);

			// Draw center line
			ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue("--background-modifier-border");
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(0, height / 2);
			ctx.lineTo(this.canvas!.width, height / 2);
			ctx.stroke();

			// Draw waveform based on style
			if (this.plugin.settings.waveformStyle === "line") {
				this.drawLineWaveform(ctx, this.canvas!.width, height);
			} else  if (this.plugin.settings.waveformStyle === "bars") {
				this.drawBarWaveform(ctx, this.canvas!.width, height);
			}
		};
		draw();
	}

	private drawLineWaveform(ctx: CanvasRenderingContext2D, width: number, height: number) {
		if (this.waveformHistory.length < 2) return;

		const pointSpacing = width / this.maxPlayheadLength;
		
		ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue("--interactive-accent");
		ctx.lineWidth = 2;
		ctx.beginPath();

		// Draw upper wave
		for (let i = 0; i < this.maxPlayheadLength; i++) {
			const x = i * pointSpacing;
			const amplitude = this.waveformHistory[this.waveformHistory.length-this.maxPlayheadLength+i];
			const y = height / 2 - (amplitude * height * 0.4);
			
			if (i === 0) {
				ctx.moveTo(x, y);
			} else {
				ctx.lineTo(x, y);
			}
		}

		// Draw lower wave (mirror)
		for (let i = this.maxPlayheadLength - 1; i >= 0; i--) {
			const x = i * pointSpacing;
			const amplitude = this.waveformHistory[this.waveformHistory.length-this.maxPlayheadLength+i];
			const y = height / 2 + (amplitude * height * 0.4);
			ctx.lineTo(x, y);
		}

		ctx.closePath();
		ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--interactive-accent") + "40"; // Add transparency
		ctx.fill();
		ctx.stroke();
	}
	
	// We don't care about bars for now
	private drawBarWaveform(ctx: CanvasRenderingContext2D, width: number, height: number) {
		const barWidth = Math.max(2, width / this.maxPlayheadLength);
		const barSpacing = 1;
		const accentColor = getComputedStyle(document.body).getPropertyValue("--interactive-accent");

		for (let i = 0; i < this.waveformHistory.length; i++) {
			const x = i * barWidth;
			const amplitude = this.waveformHistory[i];
			const barHeight = Math.max(3, amplitude * height * 0.4); // Minimum height of 3px

			// Create gradient for each bar (more recent = brighter)
			const opacity = 0.3 + (i / this.waveformHistory.length) * 0.7;
			
			// Convert to rgba for reliable opacity
			const colorMatch = accentColor.match(/\d+/g);
			if (colorMatch && colorMatch.length >= 3) {
				ctx.fillStyle = `rgba(${colorMatch[0]}, ${colorMatch[1]}, ${colorMatch[2]}, ${opacity})`;
			} else {
				// Fallback if color parsing fails
				ctx.fillStyle = `rgba(136, 108, 255, ${opacity})`;
			}
			
			// Draw bar from center
			ctx.fillRect(x, height / 2 - barHeight, barWidth - barSpacing, barHeight * 2);
		}
	}
	*/

	/** TEMPORARY : shows the audio player (after recording stopped)
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
	*/
}