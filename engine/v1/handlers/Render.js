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
	// Resolve or create the UI root container.
	const resolvedRootId = rootId || defaultUiRootId;
	let root = document.getElementById(resolvedRootId);
	if (!root) {
		root = document.createElement("div");
		root.id = resolvedRootId;
		root.style.userSelect = "none";
		root.style.webkitUserSelect = "none";
		root.style.msUserSelect = "none";
		document.body.appendChild(root);
	}

	// Apply root styles when provided.
	if (rootStyles && typeof rootStyles === "object") {
		Object.assign(root.style, rootStyles);
	}

	return root;
}


/* === PAYLOADS === */
// Renders payloads built by the UI builder.

function RenderPayload(payload) {
	// Guard against invalid payloads.
	if (!payload || typeof payload !== "object") {
		return;
	}

	const rootId = payload.rootId || defaultUiRootId;
	const root = ensureRoot(rootId, payload.rootStyles);

	// Replace existing contents by default.
	if (payload.replace !== false) {
		root.innerHTML = "";
	}

	// Append pre-built elements when provided.
	const elements = payload.elements;
	if (elements && typeof elements === "object" && "nodeType" in elements) {
		root.appendChild(elements);
	}
}

/* === LEVEL === */
// Lightweight level debug renderer for testing pipelines.

function RenderLevel(levelState, options) {
	if (typeof document === "undefined") {
		return;
	}

	const resolvedOptions = options && typeof options === "object" ? options : {};
	const rootId = resolvedOptions.rootId || "engine-level-root";
	const rootStyles = resolvedOptions.rootStyles || {
		position: "relative",
		zIndex: "0",
	};

	const pre = document.createElement("pre");
	pre.id = resolvedOptions.elementId || "engine-level-debug";
	pre.textContent = JSON.stringify(levelState || {}, null, 2);
	pre.style.margin = "0";
	pre.style.padding = "16px";
	pre.style.fontSize = "12px";
	pre.style.fontFamily = "Consolas, \"Courier New\", monospace";
	pre.style.color = "#e9f7ff";
	pre.style.background = "rgba(8, 12, 24, 0.85)";
	pre.style.overflow = "auto";
	pre.style.maxHeight = "50vh";
	pre.style.borderTop = "1px solid rgba(110, 220, 255, 0.2)";

	const fragment = document.createDocumentFragment();
	fragment.appendChild(pre);

	RenderPayload({
		rootId: rootId,
		rootStyles: rootStyles,
		replace: true,
		elements: fragment,
	});
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
	RenderLevel,
	GetElement,
	SetElementText,
	SetElementSource,
	SetElementStyle,
	FadeElement,
	RemoveRoot,
};