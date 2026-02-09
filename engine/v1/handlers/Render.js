// Renderer and displayer of all visual elements.

// End of any visual pipeline to display contents to Game (document.body)

/* === CONSTANTS === */
// Element ids and defaults for engine rendering.

const defaultUiRootId = "engine-ui-root";

/* === IMPORTS === */
// UI element builder.

import { UIElement } from "../builder/NewUI.js";

/* === INTERNALS === */
// DOM helpers for rendering payloads.

function ensureRoot(rootId, rootStyles) {
	const resolvedRootId = rootId || defaultUiRootId;
	let root = document.getElementById(resolvedRootId);
	if (!root) {
		root = document.createElement("div");
		root.id = resolvedRootId;
		document.body.appendChild(root);
	}

	if (rootStyles && typeof rootStyles === "object") {
		Object.assign(root.style, rootStyles);
	}

	return root;
}


/* === PAYLOADS === */
// Renders payloads built by the UI builder.

function RenderPayload(payload) {
	if (!payload || typeof payload !== "object") {
		return;
	}

	const rootId = payload.rootId || defaultUiRootId;
	const root = ensureRoot(rootId, payload.rootStyles);

	if (payload.replace !== false) {
		root.innerHTML = "";
	}

	const elements = payload.elements;
	if (elements && typeof elements === "object" && "nodeType" in elements) {
		root.appendChild(elements);
	}
}

/* === ELEMENTS === */
// Utility helpers for updating rendered elements.

function GetElement(elementId) {
	return UIElement.get(elementId).element;
}

function SetElementText(elementId, text) {
	UIElement.get(elementId).setText(text);
}

function SetElementSource(elementId, src) {
	UIElement.get(elementId).setSource(src);
}

function SetElementStyle(elementId, styles) {
	UIElement.get(elementId).setStyle(styles);
}

function FadeElement(elementId, targetOpacity, durationSeconds) {
	return UIElement.get(elementId).fadeTo(targetOpacity, durationSeconds);
}

function RemoveRoot(rootId) {
	UIElement.removeRoot(rootId);
}

/* === EXPORTS === */
// Public render helpers for engine modules.

export {
	RenderPayload,
	GetElement,
	SetElementText,
	SetElementSource,
	SetElementStyle,
	FadeElement,
	RemoveRoot,
};