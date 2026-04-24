// Initializes and Controls Sound Files

// Used by cutscene/AudioSync.js, UI.js and game/Level.js for managing audio files.

/* === IMPORTS === */
// Logging support.

import { CONFIG } from "../core/config.js";
import { ValidateAudioPayload } from "../core/validate.js";
import { Log } from "../core/meta.js";
import { Clamp01 } from "../math/Utilities.js";

/* === STATE === */
// Active music tracking.

const activeMusic = {
	name: null,
	audio: null,
	options: null,
};

const oneShotChannels = {
	Sfx: {
		active  : [],
		logLabel: "sfx",
		nextId  : 1,
	},
	Voice: {
		active  : [],
		logLabel: "voice",
		nextId  : 1,
	},
};

/* === INTERNALS === */
// Audio creation helpers.

// Pull channel-specific volume from config.
function resolveVolume(channel, options) {
	const applyMaster = (value) => Clamp01(CONFIG.VOLUME.Master * value);

	switch (channel) {
		case "Music"   : return applyMaster(CONFIG.VOLUME.Music);
		case "Sfx"     : return applyMaster(options.category === "Menu" ? CONFIG.VOLUME.MenuSfx : CONFIG.VOLUME.GameSfx);
		case "Voice"   : return applyMaster(CONFIG.VOLUME.Voice);
		case "Cutscene": return applyMaster(CONFIG.VOLUME.Cutscene);
		default        : return applyMaster(1);
	}
}

function configureAudio(audio, options, channel) {
	// Apply volume, rate, and looping options.
	const volume = resolveVolume(channel, options);
	audio.volume = Clamp01(volume);
	audio.playbackRate = options.rate;
	audio.loop = options.loop;
}

// Create and start a new audio instance.
function playAudio(src, options, channel) {
	const audio = new Audio(src);
	configureAudio(audio, options, channel);
	audio.play();
	return audio;
}

function stopTrackedAudio(item, logLabel) {
	Log("ENGINE", `Audio stop (${logLabel}): ${item.id} ${item.label}`, "log", "Audio");
	item.audio.pause();
	item.audio.currentTime = 0;
}

/* === ONE-SHOT AUDIO === */
// Shared one-shot playback for SFX and voice.

function PlayAudio(src, options, channel = "Sfx") {
	const audioPayload = ValidateAudioPayload({ src, options });
	if (audioPayload === null) return Promise.resolve();

	const state = oneShotChannels[channel];
	const oneShotId = state.nextId;
	state.nextId++;
	const label = audioPayload.id || audioPayload.name || audioPayload.src;

	Log("ENGINE", `Audio play (${state.logLabel}): ${oneShotId} ${label}`, "log", "Audio");

	const audio = playAudio(audioPayload.src, audioPayload, channel);
	state.active.push({ id: oneShotId, src: audioPayload.src, label, audio, options: audioPayload });

	return new Promise((resolve) => {
		// Clean up audio tracking on completion.
		const finalize = () => {
			const index = state.active.findIndex((item) => item.id === oneShotId);
			if (index >= 0) state.active.splice(index, 1);
			resolve();
		};

		audio.addEventListener("ended", finalize, { once: true });
		audio.addEventListener("error", finalize, { once: true });
	});
}

/* === MUSIC === */
// Persistent music playback with track swapping.

function PlayMusic(trackName, src, options) {
	const audioPayload = ValidateAudioPayload({ name: trackName, src, options });
	if (audioPayload === null) return;

	if (activeMusic.name === audioPayload.name && activeMusic.audio) return;

	if (activeMusic.audio) {
		// Stop the previous track before swapping.
		Log("ENGINE", `Audio stop (music): ${activeMusic.name}`, "log", "Audio");
		activeMusic.audio.pause();
		activeMusic.audio.currentTime = 0;
	}

	Log("ENGINE", `Audio play (music): ${audioPayload.name}`, "log", "Audio");

	activeMusic.name = audioPayload.name;
	activeMusic.audio = playAudio(audioPayload.src, audioPayload, "Music");
	activeMusic.options = audioPayload;
}

function PauseMusic() {
	// Pause only when a track is active.
	if (!activeMusic.audio || activeMusic.audio.paused) return;

	Log("ENGINE", `Audio pause (music): ${activeMusic.name}`, "log", "Audio");
	activeMusic.audio.pause();
}

function ResumeMusic() {
	// Resume only when a track is paused.
	if (!activeMusic.audio || !activeMusic.audio.paused) return;

	Log("ENGINE", `Audio resume (music): ${activeMusic.name}`, "log", "Audio");
	activeMusic.audio.play();
}

function StopMusic() {
	// Stop and clear active music.
	if (!activeMusic.audio) return;

	Log("ENGINE", `Audio stop (music): ${activeMusic.name}`, "log", "Audio");

	activeMusic.audio.pause();
	activeMusic.audio.currentTime = 0;
	activeMusic.audio = null;
	activeMusic.name = null;
	activeMusic.options = null;
}

function StopSfx(idOrSrc) {
	const activeSfx = oneShotChannels.Sfx.active;

	// Bail when there are no active SFX.
	if (activeSfx.length === 0) return;

	// Match targets by id or src.
	const targets = activeSfx.filter((item) => {
		return !idOrSrc ? false : item.id === idOrSrc || item.src === idOrSrc;
	});

	if (!idOrSrc) return;

	targets.forEach((item) => stopTrackedAudio(item, "sfx"));

	for (let index = activeSfx.length - 1; index >= 0; index--) {
		const item = activeSfx[index];
		if (item.id === idOrSrc || item.src === idOrSrc) activeSfx.splice(index, 1);
	}
}

function StopAllAudio() {
	const activeSfx = oneShotChannels.Sfx.active;
	const activeVoice = oneShotChannels.Voice.active;

	// Stop music first, then clear active one-shots.
	StopMusic();
	if (activeSfx.length === 0 && activeVoice.length === 0) return;

	activeSfx.forEach((item) => stopTrackedAudio(item, "sfx"));
	activeVoice.forEach((item) => stopTrackedAudio(item, "voice"));

	activeSfx.length = 0;
	activeVoice.length = 0;
}

function UpdateActiveAudioVolumes() {
	// Refresh volumes for any currently playing audio.
	if (activeMusic.audio) configureAudio(activeMusic.audio, activeMusic.options, "Music");

	oneShotChannels.Sfx.active.forEach((item) => configureAudio(item.audio, item.options, "Sfx"));
	oneShotChannels.Voice.active.forEach((item) => configureAudio(item.audio, item.options, "Voice"));

	const cutsceneVideo = document.getElementById("engine-intro-video") ?? null;
	if (cutsceneVideo) {
		const volume = resolveVolume("Cutscene", null);
		cutsceneVideo.volume = Clamp01(volume);
	}
}

/* === EXPORTS === */
// Public audio controls for engine modules.

export {
	PlayAudio,
	PlayMusic,
	PauseMusic,
	ResumeMusic,
	StopMusic,
	StopSfx,
	StopAllAudio,
	UpdateActiveAudioVolumes,
};