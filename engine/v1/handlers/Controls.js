// User Input Handler

// Allows creating, tracking, and clearing input event listeners.

import { Cache, Log, SendEvent } from "../core/meta.js";
import { CONFIG } from "../core/config.js";
import { GetActiveLevel } from "./game/Level.js";
import { HandleFreeCamInput, HandleDefaultCamInput } from "./game/Camera.js";
import { HandleUiAction, ResolvePrecomputedAction } from "./UI.js";

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

function ResetEventTypes() {
	for (const key in eventTypes) eventTypes[key] = false;
}

function setEventType(type, enabled) {
	eventTypes[type] = enabled === true;
}

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
	const payload = options.payload;

	ResetEventTypes();

	if (options.payloadType === "ui") {
		scanUiDefinitionsForEvents(payload.elements);
		return;
	}

	if (options.payloadType === "level") {
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
		const index = this.listeners.findIndex(
			(item) => item.type === type && item.wrapped === handler
		);
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
	const target = event.target;
	return {
		type       : event.type,
		targetId   : target?.id ?? null,
		targetType : target?.type ?? null,
		value      : target?.value ?? null,
		checked    : target?.checked ?? null,
		key        : event.key ?? null,
		code       : event.code ?? null,
		button     : event.button ?? null,
		pointerType: event.pointerType ?? null,
		clientX    : event.clientX ?? null,
		clientY    : event.clientY ?? null,
		screenId   : Cache.UI.screenID,
	};
}

function StartInputRouter(target) {
	// Register global input listeners for UI routing.
	const router = new Controls(target);

	const handler = (event) => {
		const type = event.type;
		const targetId = event.target?.id ?? null;
		let consumed = false;

		if (eventTypes[type] === true) {
			const action = ResolvePrecomputedAction(type, targetId);
			if (action) {
				consumed = HandleUiAction(action);
				if (consumed) {
					Log(
						"ENGINE",
						`Input action handled: ${type} ${targetId || "document"}`,
						"log",
						"Controls"
					);
					return;
				}
			}

			const activeLevel = GetActiveLevel();
			const levelIsLoaded = Boolean(activeLevel);
			// FreeCam should only be enabled when global debug is on and level FreeCam is true.
			const freeCamEnabled = !!(CONFIG.DEBUG.ALL === true && CONFIG.DEBUG.LEVELS.FreeCam === true);
			if (levelIsLoaded && freeCamEnabled) consumed = HandleFreeCamInput(event, activeLevel);
			else if (levelIsLoaded && !freeCamEnabled) consumed = HandleDefaultCamInput(event);
		}

		if (consumed) {
			Log(
				"ENGINE",
				`Input action handled: ${type} ${targetId ? `on ${targetId}` : ""}`,
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

export {
	Controls,
	StartInputRouter,
	ResetEventTypes,
	UpdateInputEventTypes,
};