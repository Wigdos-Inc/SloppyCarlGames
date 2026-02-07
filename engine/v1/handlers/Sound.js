// Initializes and Controls Sound Files

// Used by cutscene/AudioSync.js, UI.js and game/Level.js for managing audio files.

/* === IMPORTS === */
// Logging support.

import { log } from "../core/meta.js";

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

function configureAudio(audio, options) {
	if (options && typeof options.volume === "number") {
		audio.volume = Math.max(0, Math.min(1, options.volume));
	}

	if (options && typeof options.rate === "number") {
		audio.playbackRate = options.rate;
	}

	if (options && typeof options.loop === "boolean") {
		audio.loop = options.loop;
	}
}

function playAudio(src, options) {
	const audio = new Audio(src);
	configureAudio(audio, options);
	audio.play();
	return audio;
}

/* === SFX === */
// One-shot audio playback.

function PlaySfx(src, options) {
	if (!src) {
		return Promise.resolve();
	}

	const sfxId = nextSfxId;
	nextSfxId += 1;
	const label = (options && (options.id || options.name)) || src;

	log("ENGINE", `Audio play (sfx): ${sfxId} ${label}`, "log", "Audio");

	const audio = playAudio(src, options);
	activeSfx.push({ id: sfxId, src: src, label: label, audio: audio });

	return new Promise((resolve) => {
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
	if (!src) {
		return Promise.resolve();
	}

	const voiceId = nextVoiceId;
	nextVoiceId += 1;
	const label = (options && (options.id || options.name)) || src;

	log("ENGINE", `Audio play (voice): ${voiceId} ${label}`, "log", "Audio");

	const audio = playAudio(src, options);
	activeVoice.push({ id: voiceId, src: src, label: label, audio: audio });

	return new Promise((resolve) => {
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
	if (!trackName || !src) {
		return;
	}

	if (activeMusic.name === trackName && activeMusic.audio) {
		return;
	}

	if (activeMusic.audio) {
		log("ENGINE", `Audio stop (music): ${activeMusic.name}`, "log", "Audio");
		activeMusic.audio.pause();
		activeMusic.audio.currentTime = 0;
	}

	log("ENGINE", `Audio play (music): ${trackName}`, "log", "Audio");

	const audio = playAudio(src, options);
	activeMusic.name = trackName;
	activeMusic.audio = audio;
}

function PauseMusic() {
	if (!activeMusic.audio || activeMusic.audio.paused) {
		return;
	}

	log("ENGINE", `Audio pause (music): ${activeMusic.name}`, "log", "Audio");
	activeMusic.audio.pause();
}

function ResumeMusic() {
	if (!activeMusic.audio || !activeMusic.audio.paused) {
		return;
	}

	log("ENGINE", `Audio resume (music): ${activeMusic.name}`, "log", "Audio");
	activeMusic.audio.play();
}

function StopMusic() {
	if (!activeMusic.audio) {
		return;
	}

	log("ENGINE", `Audio stop (music): ${activeMusic.name}`, "log", "Audio");

	activeMusic.audio.pause();
	activeMusic.audio.currentTime = 0;
	activeMusic.audio = null;
	activeMusic.name = null;
}

function StopSfx(idOrSrc) {
	if (activeSfx.length === 0) {
		return;
	}

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
		log("ENGINE", `Audio stop (sfx): ${item.id} ${item.label}`, "log", "Audio");
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
	StopMusic();
	if (activeSfx.length === 0) {
		if (activeVoice.length === 0) {
			return;
		}
	}

	activeSfx.forEach((item) => {
		log("ENGINE", `Audio stop (sfx): ${item.id} ${item.label}`, "log", "Audio");
		item.audio.pause();
		item.audio.currentTime = 0;
	});

	activeVoice.forEach((item) => {
		log("ENGINE", `Audio stop (voice): ${item.id} ${item.label}`, "log", "Audio");
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