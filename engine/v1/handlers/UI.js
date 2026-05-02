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
	const elements = BuildElements(payload.elements, payload.screenId);
	RenderPayload({ rootId: payload.rootId, ...payload, elements });
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

function getActionFromDefinition(definition, eventType) {
	if (definition.events[eventType]) return definition.events[eventType];
	if (definition.on[eventType]) return definition.on[eventType];

	const capitalized = eventType.charAt(0).toUpperCase() + eventType.slice(1);
	const direct = definition[`on${capitalized}`];
	return direct || null;
}

function analyzeUiDefinitions(definitions, analysis = null) {
	const result = analysis || {
		elementIndex             : {},
		uiRuntime                : createUiRuntimeMaps(),
		hasHeavyInlineStyleActions: false,
	};

	definitions.forEach((definition) => {
		const elementId = definition.id;
		if (elementId) {
			result.elementIndex[definition.id] = definition;
			result.uiRuntime.hoverOverMap[definition.id] = getActionFromDefinition(definition, "pointerover");
			result.uiRuntime.hoverOutMap[definition.id] = getActionFromDefinition(definition, "pointerout");
			result.uiRuntime.clickMap[definition.id] = getActionFromDefinition(definition, "click");
			result.uiRuntime.inputMap[definition.id] = getActionFromDefinition(definition, "input");
			result.uiRuntime.changeMap[definition.id] = getActionFromDefinition(definition, "change");
			result.uiRuntime.keyMap[definition.id] =
				getActionFromDefinition(definition, "keydown") || getActionFromDefinition(definition, "keyup");
		}

		if (!result.hasHeavyInlineStyleActions) {
			result.hasHeavyInlineStyleActions = Object.keys(definition.events)
				.some((eventName) => styleActionHasManyInlineStyles(definition.events[eventName]));
		}

		analyzeUiDefinitions(definition.children, result);
	});

	return result;
}

function ResolvePrecomputedAction(type, targetId) {
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
	for (const key in styles) {
		if (key !== "classList") count++;
	}
	return count;
}

function styleActionHasManyInlineStyles(action) {
	if (Array.isArray(action)) return action.some((entry) => styleActionHasManyInlineStyles(entry));
	if (action.type !== "style" || !action.styles) return false;
	return countInlineStyleKeys(action.styles) >= 5;
}

function HandleUiAction(action) {
	// Dispatch a resolved UI action or engine event.
	if (Array.isArray(action)) return action.some((entry) => HandleUiAction(entry));

	if (typeof action === "string") {
		SendEvent("UI_REQUEST", { screenId: action });
		return true;
	}

	switch (action.type) {
		case "ui"     : ApplyMenuUI(action.payload);                            return true;
		case "request": SendEvent("UI_REQUEST", { screenId: action.screenId }); return true;
		case "event"  : SendEvent(action.name, action.payload);                 return true;
		case "exit"   : ExitGame();                                             return true;
		case "style"  :
			const element = document.getElementById(action.targetId);
			if (element) {
				const styles = action.styles;
				const classListConfig = styles.classList;

				if (classListConfig) {
					if (classListConfig.add)    classListConfig.add.forEach(addClass => element.classList.add(addClass));
					if (classListConfig.remove) classListConfig.remove.forEach(removeClass => element.classList.remove(removeClass));
				}

				const inlineStyles = {};
				for (const key in styles) {
					if (key !== "classList") inlineStyles[key] = styles[key];
				}
				Object.assign(element.style, inlineStyles);

				return true;
			}
		default: return false;
	}
}

function ApplyMenuUI(payload) {
	// Validation & Normalization
	payload = ValidateMenuUIPayload(payload);
	if (payload === null) return null;

	// Update Input Events Engine Listens for
	UpdateInputEventTypes({ payloadType: "ui", payload });

	Log("ENGINE", `UI screen load: ${payload.screenId}`, "log", "UI");
	const uiAnalysis = analyzeUiDefinitions(payload.elements);

	if (uiAnalysis.hasHeavyInlineStyleActions) {
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
	Cache.UI.elementIndex = uiAnalysis.elementIndex;
	Cache.UI.uiRuntime = uiAnalysis.uiRuntime;
	PushToSession(SESSION_KEYS.Cache, Cache);

	const screenLabel = payload.screenId;
	Log("ENGINE", `UI Render: ${screenLabel}`, "log", "UI");

	CreateUI(payload);
	Cursor.changeState("enabled");

	// Start UI music after render.
	const music = payload.music;
	if (music) PlayMusic(music.name, music.src, music);

	// Notify engine consumers that the UI has been rendered and music (if any) started.
	SendEvent("UI_RENDERED", { screenId: payload.screenId, rootId: payload.rootId });

	// If a boot sequence is awaiting the UI application, resolve it here.
	if (Cache.UI.startupUiAppliedResolve) Cache.UI.startupUiAppliedResolve(true);
	Cache.UI.startupUiAppliedResolve = null;

	return payload;
}

function LoadScreen(payload) {
	UpdateInputEventTypes({ request: "ui" });
	Cursor.changeState("hidden");
	ApplyMenuUI(payload);
}

function ClearUI(rootId) {
	Cache.UI.lastPayload = null;
	Cache.UI.screenID = null;
	Cache.UI.elementIndex = {};
	Cache.UI.uiRuntime = createUiRuntimeMaps();
	PushToSession(SESSION_KEYS.Cache, Cache);

	RemoveRoot(rootId);
	Log("ENGINE", `UI cleared: ${rootId}`, "log", "UI");
}

/* === EXPORTS === */
// Public UI API for engine modules.

export { CreateUI, ApplyMenuUI, LoadScreen, ClearUI, HandleUiAction, ResolvePrecomputedAction }; 