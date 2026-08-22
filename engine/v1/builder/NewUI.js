// UI element factory and helper wrapper.
// Purpose: translate UI payload definitions into DOM nodes, convert authored HTML back into
// payload definitions, and provide UIElement helpers.
// Limits: no rendering to DOM roots and no game logic; UI.js owns the pipeline.
// Pipeline: UI.js -> BuildElements() -> RenderPayload(); UIElement used by Render helpers.

/* === BUILDERS === */
// Converts UI payload definitions into DOM elements.

import { Wait, Log } from "../core/meta.js";

class UIElement {
	constructor(elementId) { this.elementId = elementId; }
	
	get element() { return document.getElementById(this.elementId); }

	// Update element text content.
	setText(text, runtime = false) {
		if (!runtime) Log("ENGINE", `Set ${this.elementId} Text to ${text}`, "log", "UI");
		this.element.textContent = text;
		return this;
	}

	// Update image or media source.
	setSource(src, runtime = false) {
		if (!runtime) Log("ENGINE", `Set ${this.elementId} Source to "${src}".`, "log", "UI");
		this.element.src = src;
		return this;
	}

	// Apply inline styles to the element.
	setStyle(styles, runtime = false) {
		if (!runtime) Log("ENGINE", `Applied Styles to ${this.elementId}.`, "log", "UI");
		Object.assign(this.element.style, styles);
		return this;
	}

	// Animate opacity over the given duration.
	fadeTo(targetOpacity, durationSeconds) {
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

	// Remove element from the DOM.
	remove() {
		Log("ENGINE", `Removed ${this.elementId}.`, "log", "UI");
		this.element.parentNode.removeChild(this.element);
	}

	// Build a helper for a specific element id.
	static get(elementId) { return new UIElement(elementId); }

	// Remove a root container by id, if present.
	static removeRoot(rootId) {
		const element = document.getElementById(rootId);
		if (!element) return;
		Log("ENGINE", `Removed ${rootId}.`, "log", "UI");
		element.parentNode.removeChild(element);
	}
}

function BuildElement(definition, ids = null) {
	// Create a single DOM element from a normalized definition.
	const element = document.createElement(definition.type);

	if (definition.id) {
		element.id = definition.id;
		if (ids) ids.push(definition.id);
	}
	if (definition.className) element.className = definition.className;
	if (definition.text !== undefined) element.textContent = definition.text;

	Object.entries(definition.attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));

	if ("value" in definition) element.value = definition.value;
	if ("checked" in definition) element.checked = Boolean(definition.checked);

	if (definition.src && definition.type === "img") element.src = definition.src;
	Object.assign(element.style, definition.styles);

	// Recursively append child elements.
	definition.children.forEach((child) => element.appendChild(BuildElement(child, ids)));
	return element;
}

function BuildElements(definitions, menuId) {
	// Build a fragment of UI elements from definitions.
	const fragment = document.createDocumentFragment();
	const ids = [];

	// `definitions` is expected to be an array produced by `core/normalize.MenuPayload`.
	definitions.forEach((definition) => fragment.appendChild(BuildElement(definition, ids)));

	Log("ENGINE", `Building ${menuId}:\n- ${ids.join("\n- ")}`, "log", "UI");

	return fragment;
}

/* === HTML CONVERSION === */
// Converts an authored HTML string into a raw menu payload (mirror of BuildElement).

const droppedTags = new Set(["script", "style", "link"]);

const toCamelCase = (name) => name.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());

function readInlineStyles(node) {
	// Object.assign onto a CSSStyleDeclaration ignores kebab keys, so camelCase them here.
	const styles = {};
	node.style.forEach(name, styles[toCamelCase(name)] = node.style.getPropertyValue(name));
	return styles;
}

function collectStylesheet(doc) {
	// Whole document: the parser hoists <style> out of a bare fragment into <head>.
	const blocks = Array.from(doc.querySelectorAll("style"), (node) => node.textContent);
	return blocks.length > 0 ? blocks.join("\n") : null;
}

function parseChildNodes(nodes, wrapText) {
	// Walks in document order; `wrapText` turns orphan text into positioned spans.
	const children = [];
	let text = "";

	nodes.forEach((node) => {
		if (node.nodeType === Node.ELEMENT_NODE) {
			if (!droppedTags.has(node.tagName.toLowerCase())) children.push(parseElement(node));
			return;
		}
		if (node.nodeType !== Node.TEXT_NODE) return;

		const content = node.textContent.replace(/\s+/g, " ");
		if (content.trim() === "") return;
		if (wrapText) children.push({ type: "span", text: content });
		else text += content;
	});

	return { children, text };
}

function parseElement(node) {
	const definition = { type: node.tagName.toLowerCase() };
	const attributes = {};

	for (const attribute of node.attributes) {
		switch (attribute.name) {
			case "id"     : definition.id = attribute.value;        break;
			case "class"  : definition.className = attribute.value; break;
			case "src"    : definition.src = attribute.value;       break;
			case "value"  : definition.value = attribute.value;     break;
			case "checked": definition.checked = true;              break;
			case "style"  :                                         break;
			default       : attributes[attribute.name] = attribute.value;
		}
	}

	// Dropped tags don't count: a script sibling shouldn't force text into a span.
	const keeps = Array.from(node.children).some((child) => !droppedTags.has(child.tagName.toLowerCase()));
	const parsed = parseChildNodes(node.childNodes, keeps);
	const styles = readInlineStyles(node);

	if (parsed.text !== "") definition.text = parsed.text.trim();
	if (Object.keys(styles).length > 0) definition.styles = styles;
	if (Object.keys(attributes).length > 0) definition.attributes = attributes;
	if (parsed.children.length > 0) definition.children = parsed.children;

	return definition;
}

function ParseHTML(html, options) {
	// DOMParser output is inert: no script execution, no resource loading.
	const doc = new DOMParser().parseFromString(html, "text/html");

	const scriptCount = doc.querySelectorAll("script").length;
	if (scriptCount > 0) Log("ENGINE", `Dropped ${scriptCount} script block(s) while converting HTML.`, "log", "UI");

	const stylesheet = collectStylesheet(doc);
	const elements = parseChildNodes(doc.body.childNodes, true).children;

	return { ...options, stylesheet, elements };
}

/* === EXPORTS === */
// Public builders for UI payloads.

export { BuildElement, BuildElements, ParseHTML, UIElement };