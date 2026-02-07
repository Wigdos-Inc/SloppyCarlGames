// Handles all UI elements, both in menus and during gameplay

// Receives UI payload from game (elements, styling, transition), validated by core/validate.js
// Uses builder/NewUI.js to build UI elements.
// Feeds Render.js to render UI elements.

/* === IMPORTS === */
// Rendering and audio handlers.

import { log } from "../core/meta.js";
import { RenderPayload } from "./Render.js";
import { PlayMusic } from "./Sound.js";

/* === MENU UI === */
// Applies game menu payloads and handles music switching.

function ApplyMenuUI(payload) {
	if (!payload || typeof payload !== "object") {
		return;
	}

	if (payload.screenId) {
		log("ENGINE", `UI screen load: ${payload.screenId}`, "log", "UI");
	}

	RenderPayload(payload);

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

export { ApplyMenuUI, LoadScreen }; 