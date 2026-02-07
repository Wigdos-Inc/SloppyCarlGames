// Build HTML UI ELements

// Used by handlers/UI.js

/* === BUILDERS === */
// Converts UI payload definitions into DOM elements.

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

function BuildElements(definitions) {
	const fragment = document.createDocumentFragment();

	if (Array.isArray(definitions)) {
		definitions.forEach((definition) => {
			fragment.appendChild(BuildElement(definition));
		});
	}

	return fragment;
}

/* === EXPORTS === */
// Public builders for UI payloads.

export { BuildElement, BuildElements };