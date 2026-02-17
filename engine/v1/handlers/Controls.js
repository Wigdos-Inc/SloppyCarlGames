// User Input Handler

// Allows creating, tracking, and clearing input event listeners.

import { Cache, Log, sendEvent } from "../core/meta.js";
import { HandleUiAction, ResolveUiAction } from "./UI.js";

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

function resolveCachedAction(event) {
	// Check cached payloads for a matching action.
	if (Cache && Cache.UI) {
		return { handler: HandleUiAction, resolved: ResolveUiAction(event) };
	}

	return null;
}

function StartInputRouter(target) {
	// Register global input listeners for UI routing.
	const router = new Controls(target);
	const eventTypes = [
		"click",
		"pointerdown",
		"pointerup",
		"pointerover",
		"pointerout",
		"input",
		"change",
		"keydown",
		"keyup",
	];

	const handler = (event) => {
		const targetId = event && event.target ? event.target.id : null;

		// Log each user interaction the router sees.
		Log(
			"ENGINE",
			`User Input: ${event.type} ${"on " + (targetId || "document")}`.trim(),
			"log",
			"Controls"
		);

		// Use cached actions when available.
		const match = resolveCachedAction(event);
		if (match && match.resolved && match.handler(match.resolved.action)) {
			Log(
				"ENGINE",
				`Input action handled: ${event.type} ${match.resolved.targetId}`,
				"log",
				"Controls"
			);
			return;
		}

		// Fallback to game-controlled handling.
		sendEvent("USER_INPUT", buildInteractionPayload(event));
	};

	eventTypes.forEach((eventType) => {
		router.on(eventType, handler);
	});

	return router;
}

export { Controls, StartInputRouter };