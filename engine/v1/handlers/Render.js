// Renderer and displayer of all visual elements.

// End of any visual pipeline to display contents to Game (document.body)

/* === CONSTANTS === */
// Element ids and defaults for engine rendering.

const defaultUiRootId = "engine-ui-root";

/* === IMPORTS === */
// UI element builder.

import { BuildElements } from "../builder/NewUI.js";

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

function wait(milliseconds) {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
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

	const elements = BuildElements(payload.elements);
	root.appendChild(elements);
}

/* === ELEMENTS === */
// Utility helpers for updating rendered elements.

function GetElement(elementId) {
	return document.getElementById(elementId);
}

function SetElementText(elementId, text) {
	const element = GetElement(elementId);
	if (element) {
		element.textContent = text;
	}
}

function SetElementSource(elementId, src) {
	const element = GetElement(elementId);
	if (element && "src" in element) {
		element.src = src;
	}
}

function SetElementStyle(elementId, styles) {
	const element = GetElement(elementId);
	if (element && styles && typeof styles === "object") {
		Object.assign(element.style, styles);
	}
}

function FadeElement(elementId, targetOpacity, durationSeconds) {
	const element = GetElement(elementId);
	if (!element) {
		return Promise.resolve();
	}

	const fadeDuration = Math.max(0, durationSeconds || 0);
	element.style.transition = `opacity ${fadeDuration}s ease`;
	element.style.opacity = String(targetOpacity);

	return wait(fadeDuration * 1000);
}

function RemoveRoot(rootId) {
	const element = document.getElementById(rootId);
	if (element && element.parentNode) {
		element.parentNode.removeChild(element);
	}
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