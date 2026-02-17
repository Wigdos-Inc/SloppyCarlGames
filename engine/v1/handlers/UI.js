// UI pipeline coordinator for menus and in-game elements.
// Purpose: receives UI payloads from the game, builds HTML elements via NewUI,
// and hands them to Render for insertion into output.html. Handles UI music kickoff.
// Limits: does not touch gameplay state, input logic, or low-level DOM rendering.
// Pipeline: game -> UI payload -> BuildElements() -> RenderPayload() -> ENGINE_UI_RENDERED event.

/* === IMPORTS === */
// Rendering and audio handlers.

import { Cache, Log, sendEvent, Cursor, ExitGame, pushToSession, SESSION_KEYS } from "../core/meta.js";
import { BuildElements } from "../builder/NewUI.js";
import { RenderPayload, RemoveRoot } from "./Render.js";
import { PlayMusic } from "./Sound.js";


/* === MENU UI === */
// Applies game menu payloads and handles music switching.

function CreateUI(payload) { 
	if (!payload || typeof payload !== "object") {
		return;
	}

	// Build UI elements from payload and render them.
	const builtElements = BuildElements(payload.elements, payload.screenId);
	RenderPayload({
		rootId: payload.rootId || "engine-ui-root",
		...payload,
		elements: builtElements,
	});
}

function indexElements(definitions, index) {
	if (!Array.isArray(definitions)) {
		return;
	}

	// Walk element tree to map ids for input routing.
	definitions.forEach((definition) => {
		if (definition && typeof definition === "object") {
			if (definition.id) {
				index[definition.id] = definition;
			}
			if (Array.isArray(definition.children)) {
				indexElements(definition.children, index);
			}
		}
	});
}

function getActionFromDefinition(definition, eventType) {
	// Pull the most specific action mapping for the event.
	if (!definition || typeof definition !== "object" || !eventType) {
		return null;
	}

	if (definition.events && definition.events[eventType]) {
		return definition.events[eventType];
	}

	if (definition.on && definition.on[eventType]) {
		return definition.on[eventType];
	}

	const capitalized = eventType.charAt(0).toUpperCase() + eventType.slice(1);
	const direct = definition[`on${capitalized}`];
	return direct || null;
}

function ResolveUiAction(event) {
	// Match the event target to a cached element definition.
	const target = event && event.target ? event.target : null;
	const targetId = target && target.id ? target.id : null;
	if (!targetId || !Cache || !Cache.UI || !Cache.UI.elementIndex) {
		return null;
	}

	const definition = Cache.UI.elementIndex[targetId];
	const action = getActionFromDefinition(definition, event.type);
	if (!action) {
		return null;
	}

	return { action: action, targetId: targetId };
}

function HandleUiAction(action) {
	// Dispatch a resolved UI action or engine event.
	if (!action) {
		return false;
	}

	if (Array.isArray(action)) {
		return action.some((entry) => HandleUiAction(entry));
	}

	if (typeof action === "string") {
		sendEvent("UI_REQUEST", { screenId: action });
		return true;
	}

	if (action.type === "ui" && action.payload) {
		ApplyMenuUI(action.payload);
		return true;
	}

	if (action.type === "request" && action.screenId) {
		sendEvent("UI_REQUEST", { screenId: action.screenId });
		return true;
	}

	if (action.type === "event" && action.name) {
		sendEvent(action.name, action.payload || null);
		return true;
	}

	if (action.type === "exit") {
		ExitGame();
		return true;
	}

	if (action.type === "style" && action.targetId && action.styles) {
		const element = document.getElementById(action.targetId);
		if (element) {
			Object.assign(element.style, action.styles);
			return true;
		}
	}

	return false;
}

function ApplyMenuUI(payload) {
	if (!payload || typeof payload !== "object") {
		return;
	}

	if (payload.screenId) {
		Log("ENGINE", `UI screen load: ${payload.screenId}`, "log", "UI");
	}

	// Cache the latest UI payload for input routing.
	if (Cache && Cache.UI) {
		Cache.UI.lastPayload = payload;
		Cache.UI.screenID = payload.screenId || null;
		Cache.UI.elementIndex = {};
		indexElements(payload.elements, Cache.UI.elementIndex);
		pushToSession(SESSION_KEYS.Cache, Cache);
	}

	const screenLabel = payload.screenId || "unknown";
	Log("ENGINE", `UI render start: ${screenLabel}`, "log", "UI");

	CreateUI(payload);
	Log("ENGINE", `UI render end: ${screenLabel}`, "log", "UI");
	Cursor.changeState("enabled");

	// Notify listeners that the UI is ready.
	if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
		window.dispatchEvent(
			new CustomEvent("ENGINE_UI_RENDERED", {
				detail: { screenId: payload.screenId || null },
			})
		);
	}

	// Start UI music after render.
	const music = payload.music;
	if (music && music.name && music.src) {
		PlayMusic(music.name, music.src, music);
	}
}

function LoadScreen(payload) {
	Cursor.changeState("hidden");
	ApplyMenuUI(payload);
}

function ClearUI(rootId) {
	const resolvedRootId = rootId || "engine-ui-root";

	if (Cache && Cache.UI) {
		Cache.UI.lastPayload = null;
		Cache.UI.screenID = null;
		Cache.UI.elementIndex = {};
		pushToSession(SESSION_KEYS.Cache, Cache);
	}

	RemoveRoot(resolvedRootId);
	Log("ENGINE", `UI cleared: ${resolvedRootId}`, "log", "UI");
}

/* === EXPORTS === */
// Public UI API for engine modules.

export { CreateUI, ApplyMenuUI, LoadScreen, ClearUI, ResolveUiAction, HandleUiAction }; 