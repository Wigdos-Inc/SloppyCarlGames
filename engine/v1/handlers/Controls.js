// User Input Handler

// Allows creating, tracking, and clearing input event listeners.

import { Cache, Log, SendEvent } from "../core/meta.js";
import { CONFIG } from "../core/config.js";
import { GetActiveLevel } from "./game/Level.js";
import { HandleFreeCamInput, HandleDefaultCamInput } from "./game/Camera.js";
import { HandleUiAction, resolvePrecomputedAction } from "./UI.js";

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

function resetEventTypes() {
	Object.keys(eventTypes).forEach((key) => {
		eventTypes[key] = false;
	});
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
		Object.keys(definition.events).forEach((eventName) => {
			if (definition.events[eventName]) markEventFromDefinitionEventName(eventName);
		});

		Object.keys(definition.on).forEach((eventName) => {
			if (definition.on[eventName]) markEventFromDefinitionEventName(eventName);
		});

		Object.keys(directEventNameMap).forEach((directKey) => {
			if (definition[directKey]) setEventType(directEventNameMap[directKey], true);
		});

		scanUiDefinitionsForEvents(definition.children);
	});
}

// Update Input Events Engine Listens for
function UpdateInputEventTypes(options) {
	const payload = options.payload;

	resetEventTypes();

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
		if (!this.target || !type || typeof handler !== "function") {
			return () => {};
		}

		const once = options && options.once === true;
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
		if (!this.target || !type || typeof handler !== "function") {
			return;
		}

		const index = this.listeners.findIndex(
			(item) => item.type === type && item.wrapped === handler
		);
		if (index < 0) {
			return;
		}

		const [listener] = this.listeners.splice(index, 1);
		this.target.removeEventListener(listener.type, listener.wrapped, listener.options);
	}

	clear() {
		if (!this.target) {
			return;
		}

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
		targetId   : target?.id || null,
		targetType : target?.type || null,
		value      : target && "value" in target ? target.value : null,
		checked    : target && "checked" in target ? target.checked : null,
		key        : "key" in event ? event.key : null,
		code       : "code" in event ? event.code : null,
		button     : "button" in event ? event.button : null,
		pointerType: "pointerType" in event ? event.pointerType : null,
		clientX    : "clientX" in event ? event.clientX : null,
		clientY    : "clientY" in event ? event.clientY : null,
		screenId   : Cache.UI.screenID,
	};
}

function StartInputRouter(target) {
	// Register global input listeners for UI routing.
	const router = new Controls(target);

	const handler = (event) => {
		const type = event.type;
		const targetId = event.target?.id || null;
		let consumed = false;

		if (eventTypes[type] === true) {
			const action = resolvePrecomputedAction(type, targetId);
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
			const freeCamEnabled = !!(CONFIG.DEBUG.ALL === true && CONFIG.DEBUG.LEVELS && CONFIG.DEBUG.LEVELS.FreeCam === true);
			if (levelIsLoaded && freeCamEnabled) {
				consumed = HandleFreeCamInput(event, activeLevel);
			} else if (levelIsLoaded && !freeCamEnabled) {
				consumed = HandleDefaultCamInput(event);
			}
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

	Object.keys(eventTypes).forEach((eventType) => router.on(eventType, handler));
	return router;
}

export {
	Controls,
	StartInputRouter,
	resetEventTypes,
	UpdateInputEventTypes,
};