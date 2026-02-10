// Initializes and Controls Sound Files

// Used by cutscene/AudioSync.js, UI.js and game/Level.js for managing audio files.

/* === IMPORTS === */
// Logging support.

import { CONFIG } from "../core/config.js";
import { Log } from "../core/meta.js";

/* === STATE === */
// Active music tracking.

const activeMusic = {
	name: null,
	audio: null,
};

const activeSfx = [];
const activeVoice = [];
let nextSfxId = 1;
let nextVoiceId = 1;

/* === INTERNALS === */
// Audio creation helpers.

function resolveVolume(channel) {
	// Pull channel-specific volume from config.
	if (!CONFIG || !CONFIG.VOLUME) {
		return 1;
	}

	if (channel === "Music") {
		return CONFIG.VOLUME.Music;
	}

	if (channel === "Sfx") {
		return CONFIG.VOLUME.Sfx;
	}

	if (channel === "Voice") {
		return CONFIG.VOLUME.Voice;
	}

	return 1;
}

function configureAudio(audio, options, channel) {
	// Apply volume, rate, and looping options.
	const volume = resolveVolume(channel);
	if (typeof volume === "number") {
		audio.volume = Math.max(0, Math.min(1, volume));
	}

	if (options && typeof options.rate === "number") {
		audio.playbackRate = options.rate;
	}

	if (options && typeof options.loop === "boolean") {
		audio.loop = options.loop;
	}
}

function playAudio(src, options, channel) {
	// Create and start a new audio instance.
	const audio = new Audio(src);
	configureAudio(audio, options, channel);
	audio.play();
	return audio;
}

/* === SFX === */
// One-shot audio playback.

function PlaySfx(src, options) {
	// Reject empty sources early.
	if (!src) {
		return Promise.resolve();
	}

	const sfxId = nextSfxId;
	nextSfxId += 1;
	const label = (options && (options.id || options.name)) || src;

	Log("ENGINE", `Audio play (sfx): ${sfxId} ${label}`, "log", "Audio");

	const audio = playAudio(src, options, "Sfx");
	activeSfx.push({ id: sfxId, src: src, label: label, audio: audio });

	return new Promise((resolve) => {
		// Clean up SFX tracking on completion.
		const finalize = () => {
			const index = activeSfx.findIndex((item) => item.id === sfxId);
			if (index >= 0) {
				activeSfx.splice(index, 1);
			}
			resolve();
		};

		audio.addEventListener("ended", finalize);
		audio.addEventListener("error", finalize);
	});
}

/* === VOICE === */
// One-shot voice playback.

function PlayVoice(src, options) {
	// Reject empty sources early.
	if (!src) {
		return Promise.resolve();
	}

	const voiceId = nextVoiceId;
	nextVoiceId += 1;
	const label = (options && (options.id || options.name)) || src;

	Log("ENGINE", `Audio play (voice): ${voiceId} ${label}`, "log", "Audio");

	const audio = playAudio(src, options, "Voice");
	activeVoice.push({ id: voiceId, src: src, label: label, audio: audio });

	return new Promise((resolve) => {
		// Clean up voice tracking on completion.
		const finalize = () => {
			const index = activeVoice.findIndex((item) => item.id === voiceId);
			if (index >= 0) {
				activeVoice.splice(index, 1);
			}
			resolve();
		};

		audio.addEventListener("ended", finalize);
		audio.addEventListener("error", finalize);
	});
}

/* === MUSIC === */
// Persistent music playback with track swapping.

function PlayMusic(trackName, src, options) {
	// Ignore invalid requests.
	if (!trackName || !src) {
		return;
	}

	if (activeMusic.name === trackName && activeMusic.audio) {
		return;
	}

	if (activeMusic.audio) {
		// Stop the previous track before swapping.
		Log("ENGINE", `Audio stop (music): ${activeMusic.name}`, "log", "Audio");
		activeMusic.audio.pause();
		activeMusic.audio.currentTime = 0;
	}

	Log("ENGINE", `Audio play (music): ${trackName}`, "log", "Audio");

	const audio = playAudio(src, options, "Music");
	activeMusic.name = trackName;
	activeMusic.audio = audio;
}

function PauseMusic() {
	// Pause only when a track is active.
	if (!activeMusic.audio || activeMusic.audio.paused) {
		return;
	}

	Log("ENGINE", `Audio pause (music): ${activeMusic.name}`, "log", "Audio");
	activeMusic.audio.pause();
}

function ResumeMusic() {
	// Resume only when a track is paused.
	if (!activeMusic.audio || !activeMusic.audio.paused) {
		return;
	}

	Log("ENGINE", `Audio resume (music): ${activeMusic.name}`, "log", "Audio");
	activeMusic.audio.play();
}

function StopMusic() {
	// Stop and clear active music.
	if (!activeMusic.audio) {
		return;
	}

	Log("ENGINE", `Audio stop (music): ${activeMusic.name}`, "log", "Audio");

	activeMusic.audio.pause();
	activeMusic.audio.currentTime = 0;
	activeMusic.audio = null;
	activeMusic.name = null;
}

function StopSfx(idOrSrc) {
	// Bail when there are no active SFX.
	if (activeSfx.length === 0) {
		return;
	}

	// Match targets by id or src.
	const targets = activeSfx.filter((item) => {
		if (!idOrSrc) {
			return false;
		}

		return item.id === idOrSrc || item.src === idOrSrc;
	});

	if (!idOrSrc) {
		return;
	}

	targets.forEach((item) => {
		Log("ENGINE", `Audio stop (sfx): ${item.id} ${item.label}`, "log", "Audio");
		item.audio.pause();
		item.audio.currentTime = 0;
	});

	for (let index = activeSfx.length - 1; index >= 0; index -= 1) {
		const item = activeSfx[index];
		if (item.id === idOrSrc || item.src === idOrSrc) {
			activeSfx.splice(index, 1);
		}
	}
}

function StopAllAudio() {
	// Stop music first, then clear active one-shots.
	StopMusic();
	if (activeSfx.length === 0) {
		if (activeVoice.length === 0) {
			return;
		}
	}

	activeSfx.forEach((item) => {
		Log("ENGINE", `Audio stop (sfx): ${item.id} ${item.label}`, "log", "Audio");
		item.audio.pause();
		item.audio.currentTime = 0;
	});

	activeVoice.forEach((item) => {
		Log("ENGINE", `Audio stop (voice): ${item.id} ${item.label}`, "log", "Audio");
		item.audio.pause();
		item.audio.currentTime = 0;
	});

	activeSfx.length = 0;
	activeVoice.length = 0;
}

/* === EXPORTS === */
// Public audio controls for engine modules.

export {
	PlaySfx,
	PlayVoice,
	PlayMusic,
	PauseMusic,
	ResumeMusic,
	StopMusic,
	StopSfx,
	StopAllAudio,
};