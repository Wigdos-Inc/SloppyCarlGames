// Maintains Full Cutscene State.
// Handles startup intro cinematics (pre-rendered video or in-engine payloads).

import { Wait, log, sendEvent } from "../core/meta.js";
import { CONFIG } from "../core/config.js";
import { RenderPayload } from "./Render.js";
import { UIElement } from "../builder/NewUI.js";

function normalizeIntroPayload(payload) {
	if (!payload) {
		return null;
	}

	if (typeof payload === "string") {
		return { type: "video", src: payload };
	}

	if (typeof payload !== "object") {
		return null;
	}

	if (payload.type === "video" || payload.src || payload.videoSrc) {
		return {
			type: "video",
			src: payload.src || payload.videoSrc,
			muted: payload.muted,
			loop: payload.loop,
			fit: payload.fit,
			fadeOutSeconds: payload.fadeOutSeconds,
		};
	}

	return { type: "cutscene", payload: payload };
}

async function playVideoCutscene(payload, options) {
	if (!payload || !payload.src) {
		return;
	}

	const rootId = (options && options.rootId) || "engine-startup-overlay";
	const videoId = (options && options.videoId) || "engine-intro-video";
	const fadeOutSeconds =
		typeof payload.fadeOutSeconds === "number" ? payload.fadeOutSeconds : 0.5;
	const fadeLeadSeconds =
		typeof payload.fadeLeadSeconds === "number" ? payload.fadeLeadSeconds : 0.5;

	const video = document.createElement("video");
	video.id = videoId;
	video.src = payload.src;
	video.autoplay = true;
	video.playsInline = true;
	video.controls = false;
	video.muted = payload.muted === true;
	video.loop = payload.loop === true;
	if (CONFIG && CONFIG.VOLUME && typeof CONFIG.VOLUME.Cutscene === "number") {
		video.volume = Math.max(0, Math.min(1, CONFIG.VOLUME.Cutscene));
	}
	video.style.position = "absolute";
	video.style.inset = "0";
	video.style.width = "100%";
	video.style.height = "100%";
	video.style.objectFit = payload.fit || "cover";
	video.style.opacity = "1";

	const fragment = document.createDocumentFragment();
	fragment.appendChild(video);
	RenderPayload({
		rootId: rootId,
		rootStyles: {
			position: "fixed",
			inset: "0",
			background: "black",
			zIndex: "9999",
		},
		replace: false,
		elements: fragment,
	});

	await new Promise((resolve) => {
		if (Number.isFinite(video.duration) && video.duration > 0) {
			resolve();
			return;
		}
		video.addEventListener("loadedmetadata", resolve, { once: true });
	});

	const frameStartSeconds = 1 / 30;
	if (Number.isFinite(video.duration) && video.duration > frameStartSeconds) {
		video.currentTime = frameStartSeconds;
	}

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
		const playPromise = video.play();
		if (playPromise && typeof playPromise.catch === "function") {
			await playPromise.catch(() => null);
		}
	} catch (error) {
		void error;
	}

	if (!video.loop) {
		await new Promise((resolve) => {
			const finish = () => resolve();
			video.addEventListener("ended", finish, { once: true });
			video.addEventListener("error", finish, { once: true });
		});
	}

	if (fadePromise) {
		await fadePromise;
		await Wait(1000);
	}
	UIElement.get(videoId).remove();
}

function ensureCutsceneCurtain(rootId) {
	if (typeof document === "undefined") {
		return null;
	}

	const root = document.getElementById(rootId);
	if (!root) {
		return null;
	}

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

async function fadeCutsceneToBlack(options) {
	const rootId = (options && options.rootId) || "engine-startup-overlay";
	const fadeOutSeconds =
		options && typeof options.fadeOutSeconds === "number" ? options.fadeOutSeconds : 0.5;
	const curtain = ensureCutsceneCurtain(rootId);
	if (!curtain) {
		return;
	}
	const curtainElement = UIElement.get(curtain.id);
	await curtainElement.fadeTo(1, fadeOutSeconds);
}

async function playEngineCutscene(payload, options) {
	const data = payload && payload.payload ? payload.payload : payload;
	const durationSeconds = payload && typeof payload.durationSeconds === "number"
		? payload.durationSeconds
		: null;
	const fallbackWaitMs =
		options && typeof options.fallbackWaitMs === "number" ? options.fallbackWaitMs : null;
	const fadeLeadSeconds =
		payload && typeof payload.fadeLeadSeconds === "number" ? payload.fadeLeadSeconds : 0.5;

	sendEvent("IntroCinematicStart", data || null);
	if (typeof durationSeconds === "number") {
		const waitMs = Math.max(0, (durationSeconds - fadeLeadSeconds) * 1000);
		await Wait(waitMs);
		await fadeCutsceneToBlack(options);
		await Wait(fadeLeadSeconds * 1000);
		await Wait(1000);
		return;
	}

	if (typeof fallbackWaitMs === "number") {
		const waitMs = Math.max(0, fallbackWaitMs - 500);
		await Wait(waitMs);
		await fadeCutsceneToBlack(options);
		await Wait(500);
		await Wait(1000);
	}
}

async function PlayIntroCinematic(payload, options) {
	if (CONFIG && CONFIG.CUTSCENE && (CONFIG.CUTSCENE.DisableAll || CONFIG.CUTSCENE.SkipIntro)) {
		log("ENGINE", "Intro cinematic skipped by config.", "log", "Cutscene");
		return false;
	}

	const resolved = normalizeIntroPayload(payload);
	if (!resolved) {
		return false;
	}

	const label = resolved.type === "video" ? resolved.src : "intro-cutscene";
	log("ENGINE", `Intro cinematic start: ${resolved.type} ${label}`, "log", "Cutscene");

	if (resolved.type === "video") {
		await playVideoCutscene(resolved, options);
		log("ENGINE", `Intro cinematic end: ${resolved.type} ${label}`, "log", "Cutscene");
		return true;
	}

	await playEngineCutscene(resolved, options);
	log("ENGINE", `Intro cinematic end: ${resolved.type} ${label}`, "log", "Cutscene");
	return true;
}

export { PlayIntroCinematic };