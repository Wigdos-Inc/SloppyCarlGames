// User Input Handler

// Allows creating, tracking, and clearing input event listeners.

import { Cache, Log, sendEvent } from "../core/meta.js";
import { CONFIG } from "../core/config.js";
import { GetActiveLevel } from "./game/Level.js";
import { HandleFreeCamInput } from "./game/Camera.js";
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
	if (!type || !(type in eventTypes)) {
		return;
	}
	eventTypes[type] = enabled === true;

	console.log("TEST: SET EVENT TYPE TO TRUE: " + type)
}

function markEventFromDefinitionEventName(eventName) {
	if (!eventName || typeof eventName !== "string") {
		return;
	}
	const normalized = eventName.toLowerCase();
	if (normalized in eventTypes) {
		eventTypes[normalized] = true;
	}
}

function scanUiDefinitionsForEvents(definitions) {
	if (!Array.isArray(definitions)) {
		return;
	}

	definitions.forEach((definition) => {
		if (!definition || typeof definition !== "object") {
			return;
		}

		const events = definition.events && typeof definition.events === "object" ? definition.events : null;
		if (events) {
			Object.keys(events).forEach((eventName) => {
				if (events[eventName]) {
					markEventFromDefinitionEventName(eventName);
				}
			});
		}

		const onMap = definition.on && typeof definition.on === "object" ? definition.on : null;
		if (onMap) {
			Object.keys(onMap).forEach((eventName) => {
				if (onMap[eventName]) {
					markEventFromDefinitionEventName(eventName);
				}
			});
		}

		Object.keys(directEventNameMap).forEach((directKey) => {
			if (definition[directKey]) {
				setEventType(directEventNameMap[directKey], true);
			}
		});

		if (Array.isArray(definition.children)) {
			scanUiDefinitionsForEvents(definition.children);
		}
	});
}

function configureEventTypesFromUiPayload(payload) {
	const source = payload && typeof payload === "object" ? payload : null;
	if (!source) {
		return;
	}

	scanUiDefinitionsForEvents(source.elements);
}

function configureEventTypesFromLevelPayload(payload) {
	const source = payload && typeof payload === "object" ? payload : null;
	if (!source) {
		return;
	}

	setEventType("pointerdown", true);
	setEventType("mousemove", true);
	setEventType("wheel", true);
	setEventType("keydown", true);
	setEventType("keyup", true);
}

function configureEventTypesFromPayload(payloadType, payload) {
	if (payloadType === "ui") {
		configureEventTypesFromUiPayload(payload);
		return;
	}

	if (payloadType === "level") {
		configureEventTypesFromLevelPayload(payload);
	}
}

class Controls {
	constructor(target) {
		this.target = target || (typeof window !== "undefined" ? window : null);
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
	const target = event && event.target ? event.target : null;
	return {
		type: event && event.type ? event.type : null,
		targetId: target && target.id ? target.id : null,
		targetType: target && target.type ? target.type : null,
		value: target && "value" in target ? target.value : null,
		checked: target && "checked" in target ? target.checked : null,
		key: event && "key" in event ? event.key : null,
		code: event && "code" in event ? event.code : null,
		button: event && "button" in event ? event.button : null,
		pointerType: event && "pointerType" in event ? event.pointerType : null,
		clientX: event && "clientX" in event ? event.clientX : null,
		clientY: event && "clientY" in event ? event.clientY : null,
		screenId: Cache && Cache.UI ? Cache.UI.screenID : null,
	};
}

function StartInputRouter(target) {
	// Register global input listeners for UI routing.
	const router = new Controls(target);

	const onUiRequest = () => {
		resetEventTypes();
	};
	const onLevelRequest = () => {
		resetEventTypes();
	};
	const onLoadGame = () => {
		resetEventTypes();
	};
	const onUiPayloadProcessed = (event) => {
		const payload = event && event.detail && event.detail.payload ? event.detail.payload : null;
		configureEventTypesFromPayload("ui", payload);
	};
	const onLevelPayloadProcessed = (event) => {
		const payload = event && event.detail && event.detail.payload ? event.detail.payload : null;
		configureEventTypesFromPayload("level", payload);
	};

	router.on("UI_REQUEST", onUiRequest);
	router.on("LEVEL_REQUEST", onLevelRequest);
	router.on("LOAD_GAME", onLoadGame);
	router.on("ENGINE_UI_PAYLOAD_PROCESSED", onUiPayloadProcessed);
	router.on("ENGINE_LEVEL_PAYLOAD_PROCESSED", onLevelPayloadProcessed);

	const handler = (event) => {
		const type = event && event.type ? event.type : null;
		const targetId = event && event.target ? event.target.id : null;
		let consumed = false;

		if (type && eventTypes[type] === true) {
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
			const freeCamEnabled = Boolean(CONFIG && CONFIG.DEBUG && CONFIG.DEBUG.LEVELS && CONFIG.DEBUG.LEVELS.FreeCam === true);
			if (levelIsLoaded && freeCamEnabled) {
				consumed = HandleFreeCamInput(event, activeLevel);
				if (consumed) {
					return;
				}
			}
		}

		if (consumed) {
			Log(
				"ENGINE",
				`Input action handled: ${type} on ${targetId || "document"}`,
				"log",
				"Controls"
			);
			return;
		}

		// Always forward unconsumed events to game-level handlers.
		sendEvent("USER_INPUT", buildInteractionPayload(event));
	};

	Object.keys(eventTypes).forEach((eventType) => {
		router.on(eventType, handler);
	});

	return router;
}

export {
	Controls,
	StartInputRouter,
	resetEventTypes,
	configureEventTypesFromPayload,
};