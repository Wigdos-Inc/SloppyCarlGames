// UI pipeline coordinator for menus and in-game elements.
// Purpose: receives UI payloads from the game, builds HTML elements via NewUI,
// and hands them to Render for insertion into output.html. Handles UI music kickoff.
// Limits: does not touch gameplay state, input logic, or low-level DOM rendering.
// Pipeline: game -> UI payload -> BuildElements() -> RenderPayload() -> ENGINE_UI_RENDERED event.

/* === IMPORTS === */
// Rendering and audio handlers.

import { log } from "../core/meta.js";
import { BuildElements } from "../builder/NewUI.js";
import { RenderPayload } from "./Render.js";
import { PlayMusic } from "./Sound.js";

/* === MENU UI === */
// Applies game menu payloads and handles music switching.

function CreateUI(payload) {
	if (!payload || typeof payload !== "object") {
		return;
	}

	const builtElements = BuildElements(payload.elements, payload.screenId);
	RenderPayload({
		...payload,
		elements: builtElements,
	});
}

function ApplyMenuUI(payload) {
	if (!payload || typeof payload !== "object") {
		return;
	}

	if (payload.screenId) {
		log("ENGINE", `UI screen load: ${payload.screenId}`, "log", "UI");
	}

	const screenLabel = payload.screenId || "unknown";
	log("ENGINE", `UI render start: ${screenLabel}`, "log", "UI");

	CreateUI(payload);
	log("ENGINE", `UI render end: ${screenLabel}`, "log", "UI");

	if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
		window.dispatchEvent(
			new CustomEvent("ENGINE_UI_RENDERED", {
				detail: { screenId: payload.screenId || null },
			})
		);
	}

	const music = payload.music;
	if (music && music.name && music.src) {
		PlayMusic(music.name, music.src, music);
	}
}

function LoadScreen(payload) {
	ApplyMenuUI(payload);
}

/* === EXPORTS === */
// Public UI API for engine modules.

export { CreateUI, ApplyMenuUI, LoadScreen }; 