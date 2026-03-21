// UI pipeline coordinator for menus and in-game elements.
// Purpose: receives UI payloads from the game, builds HTML elements via NewUI,
// and hands them to Render for insertion into output.html. Handles UI music kickoff.
// Limits: does not touch gameplay state, input logic, or low-level DOM rendering.
// Pipeline: game -> UI payload -> BuildElements() -> RenderPayload() -> ENGINE_UI_RENDERED event.

/* === IMPORTS === */
// Rendering and audio handlers.

import { Cache, Log, SendEvent, Cursor, ExitGame, PushToSession, SESSION_KEYS } from "../core/meta.js";
import { BuildElements } from "../builder/NewUI.js";
import { RenderPayload, RemoveRoot } from "./Render.js";
import { PlayMusic } from "./Sound.js";
import { UpdateInputEventTypes } from "./Controls.js";
import { ValidateMenuUIPayload } from "../core/validate.js";


/* === MENU UI === */
// Applies game menu payloads and handles music switching.

function CreateUI(payload) { 
	// Build UI elements from payload and render them.
	const builtElements = BuildElements(payload.elements, payload.screenId);
	RenderPayload({
		rootId: payload.rootId,
		...payload,
		elements: builtElements,
	});
}

function indexElements(definitions, index) {
	// Walk element tree to map ids for input routing.
	definitions.forEach((definition) => {
		if (definition.id) index[definition.id] = definition;
		indexElements(definition.children, index);
	});
}

function createUiRuntimeMaps() {
	return {
		hoverOverMap: {},
		hoverOutMap: {},
		clickMap: {},
		inputMap: {},
		changeMap: {},
		keyMap: {},
	};
}

function setPrecomputedAction(targetMap, elementId, action) {
	targetMap[elementId] = action;
}

function getActionFromDefinition(definition, eventType) {
	if (definition.events[eventType]) return definition.events[eventType];

	if (definition.on[eventType]) return definition.on[eventType];

	const capitalized = eventType.charAt(0).toUpperCase() + eventType.slice(1);
	const direct = definition[`on${capitalized}`];
	return direct || null;
}

function buildUiRuntimeMapsFromIndex(index) {
	const runtime = createUiRuntimeMaps();

	Object.keys(index).forEach((elementId) => {
		const definition = index[elementId];

		setPrecomputedAction(runtime.hoverOverMap, elementId, getActionFromDefinition(definition, "pointerover"));
		setPrecomputedAction(runtime.hoverOutMap, elementId, getActionFromDefinition(definition, "pointerout"));
		setPrecomputedAction(runtime.clickMap, elementId, getActionFromDefinition(definition, "click"));
		setPrecomputedAction(runtime.inputMap, elementId, getActionFromDefinition(definition, "input"));
		setPrecomputedAction(runtime.changeMap, elementId, getActionFromDefinition(definition, "change"));
		setPrecomputedAction(runtime.keyMap, elementId, getActionFromDefinition(definition, "keydown"));
		if (!runtime.keyMap[elementId]) {
			setPrecomputedAction(runtime.keyMap, elementId, getActionFromDefinition(definition, "keyup"));
		}
	});

	return runtime;
}

function resolvePrecomputedAction(type, targetId) {
	const runtime = Cache.UI.uiRuntime;
	switch (type) {
		case "pointerover": return runtime.hoverOverMap[targetId];
		case "pointerout": return runtime.hoverOutMap[targetId];
		case "click": return runtime.clickMap[targetId];
		case "input": return runtime.inputMap[targetId];
		case "change": return runtime.changeMap[targetId];
		case "keydown":
		case "keyup":
			return runtime.keyMap[targetId];
		default: return null;
	}
}

function countInlineStyleKeys(styles) {
	let count = 0;
	Object.keys(styles).forEach((key) => {
		if (key !== "classList") count++;
	});
	return count;
}

function styleActionHasManyInlineStyles(action) {
	if (Array.isArray(action)) {
		for (let index = 0; index < action.length; index += 1) {
			if (styleActionHasManyInlineStyles(action[index])) {
				return true;
			}
		}
		return false;
	}

	if (action.type !== "style" || !action.styles) return false;

	return countInlineStyleKeys(action.styles) >= 5;
}

function payloadHasHeavyInlineStyleActions(definitions) {
	for (let index = 0; index < definitions.length; index += 1) {
		const definition = definitions[index];

		const events = definition.events;
		const eventNames = Object.keys(events);
		for (let eventIndex = 0; eventIndex < eventNames.length; eventIndex++) {
			if (styleActionHasManyInlineStyles(events[eventNames[eventIndex]])) return true;
		}

		if (payloadHasHeavyInlineStyleActions(definition.children)) return true;
	}

	return false;
}

function HandleUiAction(action) {
	// Dispatch a resolved UI action or engine event.
	if (Array.isArray(action)) {
		return action.some((entry) => HandleUiAction(entry));
	}

	if (typeof action === "string") {
		SendEvent("UI_REQUEST", { screenId: action });
		return true;
	}

	if (action.type === "ui") {
		ApplyMenuUI(action.payload);
		return true;
	}

	if (action.type === "request") {
		SendEvent("UI_REQUEST", { screenId: action.screenId });
		return true;
	}

	if (action.type === "event") {
		SendEvent(action.name, action.payload || null);
		return true;
	}

	if (action.type === "exit") {
		ExitGame();
		return true;
	}

	if (action.type === "style") {
		const element = document.getElementById(action.targetId);
		if (element) {
			const styles = action.styles;
			const classListConfig = styles.classList;

			classListConfig.add.forEach(addClass => element.classList.add(addClass));
			classListConfig.remove.forEach(removeClass => element.classList.remove(removeClass));

			const inlineStyles = {};
			const styleKeys = Object.keys(styles);
			for (let index = 0; index < styleKeys.length; index++) {
				const key = styleKeys[index];
				if (key === "classList") {
					continue;
				}
				inlineStyles[key] = styles[key];
			}
			Object.assign(element.style, inlineStyles);

			return true;
		}
	}

	return false;
}

function ApplyMenuUI(payload) {
	// Validation & Normalization
	payload = ValidateMenuUIPayload(payload);

	// Update Input Events Engine Listens for
	UpdateInputEventTypes({ payloadType: "ui", payload: payload });

	Log("ENGINE", `UI screen load: ${payload.screenId}`, "log", "UI");

	if (payloadHasHeavyInlineStyleActions(payload.elements)) {
		Log(
			"ENGINE",
			"Many style actions detected. Consider using CSS Stylesheet + classList for better performance.",
			"warn",
			"UI"
		);
	}

	// Cache the latest UI payload for input routing.
	Cache.UI.lastPayload = payload;
	Cache.UI.screenID = payload.screenId;

	Cache.UI.elementIndex = {};
	indexElements(payload.elements, Cache.UI.elementIndex);

	Cache.UI.uiRuntime = buildUiRuntimeMapsFromIndex(Cache.UI.elementIndex);
	PushToSession(SESSION_KEYS.Cache, Cache);

	const screenLabel = payload.screenId;
	Log("ENGINE", `UI Render: ${screenLabel}`, "log", "UI");

	CreateUI(payload);
	Cursor.changeState("enabled");

	// Start UI music after render.
	const music = payload.music;
	if (music) PlayMusic(music.name, music.src, music);

	// Notify engine consumers that the UI has been rendered and music (if any) started.
	const resolvedRootId = payload.rootId || "engine-ui-root";
	SendEvent("ENGINE_UI_RENDERED", { screenId: payload.screenId, rootId: resolvedRootId });

	// If a boot sequence is awaiting the UI application, resolve it here.
	if (Cache.UI.startupUiAppliedResolve) Cache.UI.startupUiAppliedResolve(true);
	Cache.UI.startupUiAppliedResolve = null;
}

function LoadScreen(payload) {
	UpdateInputEventTypes({ request: "ui" });
	Cursor.changeState("hidden");
	ApplyMenuUI(payload);
}

function ClearUI(rootId) {
	const resolvedRootId = rootId || "engine-ui-root";

	Cache.UI.lastPayload = null;
	Cache.UI.screenID = null;
	Cache.UI.elementIndex = {};
	Cache.UI.uiRuntime = createUiRuntimeMaps();
	PushToSession(SESSION_KEYS.Cache, Cache);

	RemoveRoot(resolvedRootId);
	Log("ENGINE", `UI cleared: ${resolvedRootId}`, "log", "UI");
}

/* === EXPORTS === */
// Public UI API for engine modules.

export { CreateUI, ApplyMenuUI, LoadScreen, ClearUI, HandleUiAction, resolvePrecomputedAction }; 