// UI element factory and helper wrapper.
// Purpose: translate UI payload definitions into DOM nodes and provide UIElement helpers.
// Limits: no rendering to DOM roots and no game logic; UI.js owns the pipeline.
// Pipeline: UI.js -> BuildElements() -> RenderPayload(); UIElement used by Render helpers.

/* === BUILDERS === */
// Converts UI payload definitions into DOM elements.

import { Wait, Log } from "../core/meta.js";

class UIElement {
	constructor(elementId) {
		this.elementId = elementId;
	}
	
	get element() {
		return document.getElementById(this.elementId);
	}

	setText(text) {
		// Update element text content.
		Log("ENGINE", `Set ${this.elementId} Text to ${text}`, "log", "UI");
		this.element.textContent = text;
		return this;
	}

	setSource(src) {
		// Update image or media source.
		Log("ENGINE", `Set ${this.elementId} Source to "${src}".`, "log", "UI");
		this.element.src = src;
		return this;
	}

	setStyle(styles) {
		// Apply inline styles to the element.
		Log("ENGINE", `Applied Styles to ${this.elementId}.`, "log", "UI");
		Object.assign(this.element.style, styles);
		return this;
	}

	fadeTo(targetOpacity, durationSeconds) {
		// Animate opacity over the given duration.
		Log(
			"ENGINE",
			`Set ${this.elementId} Opacity to "${targetOpacity}" in ${durationSeconds}s.`,
			"log",
			"UI"
		);

		this.element.style.transition = `opacity ${durationSeconds}s ease`;
		this.element.style.opacity = String(targetOpacity);

		return Wait(durationSeconds * 1000);
	}

	remove() {
		// Remove element from the DOM.
		Log("ENGINE", `Removed ${this.elementId}.`, "log", "UI");
		this.element.parentNode.removeChild(this.element);
	}

	static get(elementId) {
		// Build a helper for a specific element id.
		return new UIElement(elementId);
	}

	static removeRoot(rootId) {
		// Remove a root container by id.
		Log("ENGINE", `Removed ${rootId}.`, "log", "UI");
		const element = document.getElementById(rootId);
		element.parentNode.removeChild(element);
	}
}

function BuildElement(definition) {
	// Create a single DOM element from a normalized definition.
	// `definition` is expected to be produced by `core/normalize.MenuUIPayload`.
	const elementType = definition.type;
	const element = document.createElement(elementType);

	if (definition.id) element.id = definition.id;
	if (definition.className) element.className = definition.className;
	if (definition.text !== undefined) element.textContent = definition.text;

	Object.entries(definition.attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));

	if ("value" in definition) element.value = definition.value;
	if ("checked" in definition) element.checked = Boolean(definition.checked);

	if (definition.src && elementType === "img") element.src = definition.src;
	Object.assign(element.style, definition.styles);

	// Recursively append child elements (definitions.children is normalized to an array).
	definition.children.forEach((child) => element.appendChild(BuildElement(child)));
	return element;
}

function collectElementIds(definition, ids) {
	// Gather ids for logging and input routing. `definition` is normalized.
	if (definition.id) ids.push(definition.id);
	definition.children.forEach((child) => collectElementIds(child, ids));
}

function BuildElements(definitions, menuId) {
	// Build a fragment of UI elements from definitions.
	const fragment = document.createDocumentFragment();
	const ids = [];

	// `definitions` is expected to be an array produced by `core/normalize.MenuUIPayload`.
	definitions.forEach((definition) => collectElementIds(definition, ids));
	definitions.forEach((definition) => fragment.appendChild(BuildElement(definition)));

	Log("ENGINE", `Building ${menuId}:\n- ${ids.join("\n- ")}`, "log", "UI");

	return fragment;
}

/* === EXPORTS === */
// Public builders for UI payloads.

export { BuildElement, BuildElements, UIElement };