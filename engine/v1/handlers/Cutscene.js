// Maintains Full Cutscene State.
// Handles startup intro cinematics (pre-rendered video or in-engine payloads).

import { Wait, Log, SendEvent } from "../core/meta.js";
import { CONFIG } from "../core/config.js";
import { RenderPayload } from "./Render.js";
import { UIElement } from "../builder/NewUI.js";
import { ValidateCutscenePayload } from "../core/validate.js";

const defaultCutsceneConfig = {
	rootId: "engine-startup-overlay",
	videoId: "engine-intro-video",
	fallbackWaitMs: null,
	fadeOutSeconds: 0.5,
};

async function playRenderedCutsceneInternal(payload, options) {
	const videoId = options.videoId;
	const fadeOutSeconds = payload.fadeOutSeconds;
	const fadeLeadSeconds = payload.fadeLeadSeconds;

	// Build the video element and container styling.
	const video = document.createElement("video");
	video.id = videoId;
	video.src = payload.source;
	video.autoplay = true;
	video.playsInline = true;
	video.controls = false;
	video.muted = payload.muted;
	video.loop = payload.loop;
	video.style.position = "absolute";
	video.style.inset = "0";
	video.style.width = "100%";
	video.style.height = "100%";
	video.style.objectFit = payload.fit;
	video.style.opacity = "1";

	if (video.muted) video.volume = 0;
	else video.volume = Math.max(0, Math.min(1, CONFIG.VOLUME.Master * CONFIG.VOLUME.Cutscene));

	const fragment = document.createDocumentFragment();
	fragment.appendChild(video);
	RenderPayload({
		rootId: options.rootId,
		rootStyles: {
			position: "fixed",
			inset: "0",
			background: "black",
			zIndex: "9999",
		},
		replace: false,
		elements: fragment,
	});

	// Wait for metadata so duration and seeking are valid.
	await new Promise((resolve) => {
		if (Number.isFinite(video.duration) && video.duration > 0) {
			resolve();
			return;
		}
		video.addEventListener("loadedmetadata", resolve, { once: true });
	});

	// Start from frame 2 to avoid first-frame flashes.
	const frameStartSeconds = 1 / 30;
	if (Number.isFinite(video.duration) && video.duration > frameStartSeconds) {
		video.currentTime = frameStartSeconds;
	}

	// Schedule a fade before the video ends.
	let fadePromise = null;
	if (!video.loop && Number.isFinite(video.duration)) {
		const fadeStartSeconds = Math.max(0, video.duration - fadeLeadSeconds);
		const waitMs = Math.max(0, (fadeStartSeconds - video.currentTime) * 1000);
		fadePromise = (async () => {
			await Wait(waitMs);
			await UIElement.get(videoId).fadeTo(0, fadeOutSeconds);
		})();
	}

	try {
		// Attempt playback and swallow autoplay failures.
		const playPromise = video.play();
		if (playPromise && typeof playPromise.catch === "function") {
			await playPromise.catch(() => null);
		}
	} catch (error) {
		void error;
	}

	if (!video.loop) {
		// Wait until the video ends or errors.
		await new Promise((resolve) => {
			const finish = () => resolve();
			video.addEventListener("ended", finish, { once: true });
			video.addEventListener("error", finish, { once: true });
		});
	}

	if (fadePromise) {
		// Hold on black before removing the element.
		await fadePromise;
		await Wait(1000);
	}
	UIElement.get(videoId).remove();
}

function ensureCutsceneCurtain(rootId) {
	// Reuse a persistent curtain overlay for fades.
	const root = document.getElementById(rootId);

	let curtain = document.getElementById("engine-cutscene-curtain");
	if (!curtain) {
		curtain = document.createElement("div");
		curtain.id = "engine-cutscene-curtain";
		curtain.style.position = "absolute";
		curtain.style.inset = "0";
		curtain.style.background = "black";
		curtain.style.opacity = "0";
		curtain.style.pointerEvents = "none";
		root.appendChild(curtain);
	}

	return curtain;
}

// Fade the curtain overlay to black.
async function fadeCutsceneToBlack(options) {
	const curtain = ensureCutsceneCurtain(options.rootId);
	const curtainElement = UIElement.get(curtain.id);
	await curtainElement.fadeTo(1, options.fadeOutSeconds);
}

async function playEngineCutsceneInternal(payload, options) {
	const durationSeconds = payload.durationSeconds;
	const fadeLeadSeconds = payload.fadeLeadSeconds;

	// Fade to black before the end of the cutscene.
	const waitMs = Math.max(0, (durationSeconds - fadeLeadSeconds) * 1000);
	await Wait(waitMs);
	await fadeCutsceneToBlack(options);
	await Wait(fadeLeadSeconds * 1000);
	await Wait(1000);
	return;
}

async function PlayRenderedCutscene(payload, options = defaultCutsceneConfig) {
	const resolved = ValidateCutscenePayload(payload, "rendered");
	if (resolved === null) return false;

	if (CONFIG.DEBUG.SKIP.Cutscene === true) {
		Log("ENGINE", "Rendered cutscene skipped by settings.", "log", "Cutscene");
		return false;
	}

	await playRenderedCutsceneInternal(resolved, options);
	return true;
}

async function PlayEngineCutscene(payload, options = defaultCutsceneConfig) {
	const resolved = ValidateCutscenePayload(payload, "engine");
	if (resolved === null) return false;

	if (CONFIG.DEBUG.SKIP.Cutscene === true) {
		Log("ENGINE", "Engine cutscene skipped by settings.", "log", "Cutscene");
		return false;
	}

	await playEngineCutsceneInternal(resolved, options);
	return true;
}

export { PlayEngineCutscene, PlayRenderedCutscene };