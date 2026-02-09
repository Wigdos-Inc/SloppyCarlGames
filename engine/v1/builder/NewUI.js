// UI element factory and helper wrapper.
// Purpose: translate UI payload definitions into DOM nodes and provide UIElement helpers.
// Limits: no rendering to DOM roots and no game logic; UI.js owns the pipeline.
// Pipeline: UI.js -> BuildElements() -> RenderPayload(); UIElement used by Render helpers.

/* === BUILDERS === */
// Converts UI payload definitions into DOM elements.

import { Wait, log } from "../core/meta.js";

class UIElement {
	constructor(elementId) {
		this.elementId = elementId;
	}
	
	get element() {
		if (typeof document === "undefined") {
			return null;
		}
		return document.getElementById(this.elementId);
	}

	setText(text) {
		log("ENGINE", `Set ${this.elementId} Text to ${text}`, "log", "UI");
		const element = this.element;
		if (element) {
			element.textContent = text;
		}
		return this;
	}

	setSource(src) {
		log("ENGINE", `Set ${this.elementId} Source to "${src}".`, "log", "UI");
		const element = this.element;
		if (element && "src" in element) {
			element.src = src;
		}
		return this;
	}

	setStyle(styles) {
		log("ENGINE", `Applied Styles to ${this.elementId}.`, "log", "UI");
		const element = this.element;
		if (element && styles && typeof styles === "object") {
			Object.assign(element.style, styles);
		}
		return this;
	}

	fadeTo(targetOpacity, durationSeconds) {
		log(
			"ENGINE",
			`Set ${this.elementId} Opacity to "${targetOpacity}" in ${durationSeconds}s.`,
			"log",
			"UI"
		);
		const element = this.element;
		if (!element) {
			return Promise.resolve();
		}

		const fadeDuration = Math.max(0, durationSeconds || 0);
		element.style.transition = `opacity ${fadeDuration}s ease`;
		element.style.opacity = String(targetOpacity);

		return Wait(fadeDuration * 1000);
	}

	remove() {
		log("ENGINE", `Removed ${this.elementId}.`, "log", "UI");
		const element = this.element;
		if (element && element.parentNode) {
			element.parentNode.removeChild(element);
		}
	}

	static get(elementId) {
		return new UIElement(elementId);
	}

	static removeRoot(rootId) {
		if (typeof document === "undefined") {
			return;
		}
		log("ENGINE", `Removed ${rootId}.`, "log", "UI");
		const element = document.getElementById(rootId);
		if (element && element.parentNode) {
			element.parentNode.removeChild(element);
		}
	}
}

function BuildElement(definition) {
	if (!definition || typeof definition !== "object") {
		return document.createElement("div");
	}

	const elementType = definition.type || "div";
	const element = document.createElement(elementType);

	if (definition.id) {
		element.id = definition.id;
	}

	if (definition.className) {
		element.className = definition.className;
	}

	if (definition.text) {
		element.textContent = definition.text;
	}

	if (definition.src && elementType === "img") {
		element.src = definition.src;
	}

	if (definition.styles && typeof definition.styles === "object") {
		Object.assign(element.style, definition.styles);
	}

	if (Array.isArray(definition.children)) {
		definition.children.forEach((child) => {
			element.appendChild(BuildElement(child));
		});
	}

	return element;
}

function collectElementIds(definition, ids) {
	if (!definition || typeof definition !== "object") {
		return;
	}

	if (definition.id) {
		ids.push(definition.id);
	}

	if (Array.isArray(definition.children)) {
		definition.children.forEach((child) => collectElementIds(child, ids));
	}
}

function BuildElements(definitions, menuId) {
	const fragment = document.createDocumentFragment();
	const ids = [];

	if (Array.isArray(definitions)) {
		definitions.forEach((definition) => collectElementIds(definition, ids));
		definitions.forEach((definition) => {
			fragment.appendChild(BuildElement(definition));
		});
	}

	const resolvedMenuId = menuId || "unknown";
	log("ENGINE", `Building ${resolvedMenuId}: ${ids.join(", ")}`, "log", "UI");

	return fragment;
}

/* === EXPORTS === */
// Public builders for UI payloads.

export { BuildElement, BuildElements, UIElement };