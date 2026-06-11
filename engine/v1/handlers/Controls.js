// User Input Handler

// Allows creating, tracking, and clearing input event listeners.

import { Cache, Log, SendEvent } from "../core/meta.js";
import { CONFIG } from "../core/config.js";
import { GetActiveLevel, ToggleLevelLoopPause } from "./game/Level.js";
import { IsSimulatorActive, HandleSimulatorInput } from "./game/Simulator.js";
import { HandleFreeCamInput, HandleDefaultCamInput } from "./game/Camera.js";
import { HandleUiAction, ResolvePrecomputedAction } from "./UI.js";
import { TriggerPlayerRespawnSequence } from "../player/Master.js";

const eventTypes = {
	pointerover: false,
	pointerout: false,
	click: false,
	pointerdown: false,
	pointerup: false,
	keydown: false,
	keyup: false,
	wheel: false,
	input: false,
	change: false,
	mousemove: false,
};

const directEventNameMap = {
	onClick: "click",
	onInput: "input",
	onChange: "change",
	onPointerover: "pointerover",
	onPointerout: "pointerout",
	onPointerdown: "pointerdown",
	onPointerup: "pointerup",
	onKeydown: "keydown",
	onKeyup: "keyup",
	onWheel: "wheel",
	onMousemove: "mousemove",
};

const ResetEventTypes = () => Object.keys(eventTypes).forEach(key => eventTypes[key] = false);
const setEventType = (type, enabled) => eventTypes[type] = enabled === true;

function markEventFromDefinitionEventName(eventName) {
	const normalized = eventName.toLowerCase();
	if (normalized in eventTypes) eventTypes[normalized] = true;
}

function scanUiDefinitionsForEvents(definitions) {

	definitions.forEach((definition) => {
		for (const eventName in definition.events) markEventFromDefinitionEventName(eventName);
		for (const eventName in definition.on) markEventFromDefinitionEventName(eventName);
		for (const directKey in directEventNameMap) {
			if (definition[directKey]) setEventType(directEventNameMap[directKey], true);
		}

		scanUiDefinitionsForEvents(definition.children);
	});
}

// Update Input Events Engine Listens for
function UpdateInputEventTypes(options) {
	ResetEventTypes();

	switch (options.payloadType) {
		case "ui"   : scanUiDefinitionsForEvents(options.payload.elements); return;
		case "level":
			setEventType("pointerdown", true);
			setEventType("mousemove", true);
			setEventType("wheel", true);
			setEventType("keydown", true);
			setEventType("keyup", true);
	}
}

class Controls {
	constructor(target = window) {
		this.target = target;
		this.listeners = [];
	}

	on(type, handler, options) {
		const once = options?.once === true;
		// Wrap once-only handlers so they self-remove.
		const wrapped = once
			? (...args) => {
				handler(...args);
				this.off(type, wrapped);
			}
			: handler;
		const resolvedOptions = once ? { ...options, once: false } : options;

		this.listeners.push({ type: type, wrapped: wrapped, options: resolvedOptions });
		this.target.addEventListener(type, wrapped, resolvedOptions);

		return () => this.off(type, wrapped);
	}

	off(type, handler) {
		const index = this.listeners.findIndex((item) => item.type === type && item.wrapped === handler);
		if (index < 0) return;

		const [listener] = this.listeners.splice(index, 1);
		this.target.removeEventListener(listener.type, listener.wrapped, listener.options);
	}

	clear() {
		this.listeners.forEach((listener) => {
			this.target.removeEventListener(
				listener.type,
				listener.wrapped,
				listener.options
			);
		});
		this.listeners.length = 0;
	}
}

function buildInteractionPayload(event) {
	// Capture a lightweight event snapshot for the game.
	return {
		type       : event.type,
		targetId   : event.target?.id ?? null,
		targetType : event.target?.type ?? null,
		value      : event.target?.value ?? null,
		checked    : event.target?.checked ?? null,
		key        : event.key ?? null,
		code       : event.code ?? null,
		button     : event.button ?? null,
		pointerType: event.pointerType ?? null,
		clientX    : event.clientX ?? null,
		clientY    : event.clientY ?? null,
		screenId   : Cache.UI.screenID,
	};
}

function handleDebugLevelInput(event, activeLevel) {
	if (CONFIG.DEBUG.ALL !== true) return false;
	if (event.type !== "keydown") return false;
	if (event.code !== "KeyR") return false;
	if (!activeLevel.player) return false;

	TriggerPlayerRespawnSequence();
	return true;
}

function StartInputRouter(target) {
	// Register global input listeners for UI routing.
	const router = new Controls(target);

	const handler = (event) => {
		const targetId = event.target?.id ?? null;
		let consumed = false;

		if (eventTypes[event.type] === true) {
			const action = ResolvePrecomputedAction(event.type, targetId);
			if (action) {
				consumed = HandleUiAction(action);
				if (consumed) {
					Log(
						"ENGINE",
						`Input action handled: ${event.type} ${targetId || "document"}`,
						"log",
						"Controls"
					);
					return;
				}
			}

			const activeLevel = GetActiveLevel();
			const levelIsLoaded = Boolean(activeLevel);
			if (levelIsLoaded && event.type === "keydown" && event.code === "KeyP") {
				ToggleLevelLoopPause();
				consumed = true;
			} 
			else if (levelIsLoaded && handleDebugLevelInput(event, activeLevel)) consumed = true;
			else if (levelIsLoaded && IsSimulatorActive()) consumed = HandleSimulatorInput(event);

			if (!consumed && levelIsLoaded) {
				if (!!(CONFIG.DEBUG.ALL === true && CONFIG.DEBUG.LEVELS.FreeCam === true)) consumed = HandleFreeCamInput(event, activeLevel);
				else consumed = HandleDefaultCamInput(event);
			}
		}

		if (consumed) {
			Log(
				"ENGINE",
				`Input action handled: ${event.type} ${targetId ? `on ${targetId}` : ""}`,
				"log",
				"Controls"
			);
			return;
		}

		// Always forward unconsumed events to game-level handlers.
		SendEvent("USER_INPUT", buildInteractionPayload(event));
	};

	for (const eventType in eventTypes) router.on(eventType, handler);
	return router;
}

export { Controls, StartInputRouter, ResetEventTypes, UpdateInputEventTypes };