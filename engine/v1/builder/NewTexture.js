// Create 2D textures (like grass or pebbles) to populate the world with.

// Used by NewObject.js to apply 2D and/or 3D textures to model parts.
// Uses NewObject.js to build simple 3D textures (like grass, pebbles, etc)

import { normalizeVector3 } from "../math/Vector3.js";
import { Log } from "../core/meta.js";

let visualTemplatePromise = null;
let visualTemplateCache = null;

function parseHexColor(hex, fallback) {
	if (typeof hex !== "string") {
		return fallback;
	}

	const value = hex.replace("#", "").trim();
	if (value.length !== 6) {
		return fallback;
	}

	const r = Number.parseInt(value.slice(0, 2), 16);
	const g = Number.parseInt(value.slice(2, 4), 16);
	const b = Number.parseInt(value.slice(4, 6), 16);
	if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
		return fallback;
	}

	return `rgb(${r}, ${g}, ${b})`;
}

function ensureTemplateShape(value) {
	const source = value && typeof value === "object" ? value : {};
	return {
		textures: source.textures && typeof source.textures === "object" ? source.textures : {},
		scatterTypes: source.scatterTypes && typeof source.scatterTypes === "object" ? source.scatterTypes : {},
	};
}

async function LoadEngineVisualTemplates() {
	if (visualTemplateCache) {
		return visualTemplateCache;
	}

	if (!visualTemplatePromise) {
		visualTemplatePromise = fetch(new URL("./templates/textures.json", import.meta.url))
			.then((response) => response.json())
			.then((json) => ensureTemplateShape(json))
			.catch(() => ensureTemplateShape(null));
	}

	visualTemplateCache = await visualTemplatePromise;
	return visualTemplateCache;
}

function drawPattern(ctx, size, textureDefinition) {
	const primary = parseHexColor(textureDefinition.primary, "rgb(170, 180, 190)");
	const secondary = parseHexColor(textureDefinition.secondary, "rgb(100, 110, 120)");
	const pattern = textureDefinition.pattern || "grid";

	ctx.fillStyle = primary;
	ctx.fillRect(0, 0, size, size);

	if (pattern === "checker") {
		const cell = Math.max(4, Math.floor(size / 8));
		for (let x = 0; x < size; x += cell) {
			for (let y = 0; y < size; y += cell) {
				if ((x / cell + y / cell) % 2 === 0) {
					ctx.fillStyle = secondary;
					ctx.fillRect(x, y, cell, cell);
				}
			}
		}
		return;
	}

	if (pattern === "stripes") {
		const stripe = Math.max(3, Math.floor(size / 10));
		ctx.fillStyle = secondary;
		for (let y = 0; y < size; y += stripe * 2) {
			ctx.fillRect(0, y, size, stripe);
		}
		return;
	}

	if (pattern === "radial") {
		const gradient = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.1, size * 0.5, size * 0.5, size * 0.6);
		gradient.addColorStop(0, secondary);
		gradient.addColorStop(1, primary);
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, size, size);
		return;
	}

	if (pattern === "noise") {
		const speck = Math.max(2, Math.floor(size / 16));
		ctx.fillStyle = secondary;
		for (let index = 0; index < size * 2; index += 1) {
			const x = Math.floor(Math.random() * (size - speck));
			const y = Math.floor(Math.random() * (size - speck));
			ctx.fillRect(x, y, speck, speck);
		}
		return;
	}

	const line = Math.max(2, Math.floor(size / 8));
	ctx.strokeStyle = secondary;
	ctx.lineWidth = 1;
	for (let x = 0; x <= size; x += line) {
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, size);
		ctx.stroke();
	}
	for (let y = 0; y <= size; y += line) {
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(size, y);
		ctx.stroke();
	}
}

function buildTextureSurface(textureDefinition) {
	if (typeof document === "undefined") {
		return null;
	}

	const size = Number.isFinite(textureDefinition.size) ? Math.max(8, textureDefinition.size) : 64;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext("2d");
	if (!context) {
		return null;
	}

	drawPattern(context, size, textureDefinition);
	return canvas;
}

function collectTextureReferences(sceneGraph) {
	const ids = new Set(["default-grid"]);

	const collectMesh = (mesh) => {
		if (!mesh || !mesh.material || !mesh.material.textureID) {
			return;
		}
		ids.add(mesh.material.textureID);
	};

	const terrain = Array.isArray(sceneGraph && sceneGraph.terrain) ? sceneGraph.terrain : [];
	terrain.forEach(collectMesh);

	const triggers = Array.isArray(sceneGraph && sceneGraph.triggers) ? sceneGraph.triggers : [];
	triggers.forEach(collectMesh);

	const scatter = Array.isArray(sceneGraph && sceneGraph.scatter) ? sceneGraph.scatter : [];
	scatter.forEach(collectMesh);

	const entities = Array.isArray(sceneGraph && sceneGraph.entities) ? sceneGraph.entities : [];
	entities.forEach((entity) => {
		if (entity && entity.model && Array.isArray(entity.model.parts)) {
			entity.model.parts.forEach((part) => collectMesh(part.mesh));
		}
		if (entity && entity.mesh) {
			collectMesh(entity.mesh);
		}
	});

	return Array.from(ids);
}

function createTextureRegistry(templateRegistry, textureIDs) {
	const textureDefinitions = templateRegistry && templateRegistry.textures ? templateRegistry.textures : {};
	const fallback = textureDefinitions["default-grid"] || {
		id: "default-grid",
		size: 64,
		pattern: "grid",
		primary: "#b3beca",
		secondary: "#748394",
	};

	const registry = {};
	textureIDs.forEach((textureID) => {
		const definition = textureDefinitions[textureID] || fallback;
		const source = buildTextureSurface(definition);
		registry[textureID] = {
			id: textureID,
			definition: definition,
			source: source,
		};
	});

	if (!registry["default-grid"]) {
		registry["default-grid"] = {
			id: "default-grid",
			definition: fallback,
			source: buildTextureSurface(fallback),
		};
	}

	Log(
		"ENGINE",
		`Texture group created: count=${Object.keys(registry).length}, ids=${Object.keys(registry).join(", ")}`,
		"log",
		"Level"
	);

	return registry;
}

function ResolveScatterType(templateRegistry, scatterTypeID) {
	if (!templateRegistry || !templateRegistry.scatterTypes || !scatterTypeID) {
		return null;
	}

	const definition = templateRegistry.scatterTypes[scatterTypeID];
	if (!definition || typeof definition !== "object") {
		return null;
	}

	const scaleRange = definition.scaleRange && typeof definition.scaleRange === "object"
		? definition.scaleRange
		: { min: 1, max: 1 };

	return {
		...definition,
		noiseScale: Number.isFinite(definition.noiseScale) ? definition.noiseScale : 0.1,
		heightMin: Number.isFinite(definition.heightMin) ? definition.heightMin : -Infinity,
		heightMax: Number.isFinite(definition.heightMax) ? definition.heightMax : Infinity,
		slopeMax: Number.isFinite(definition.slopeMax) ? definition.slopeMax : 1,
		scaleRange: {
			min: Number.isFinite(scaleRange.min) ? scaleRange.min : 1,
			max: Number.isFinite(scaleRange.max) ? scaleRange.max : 1,
		},
		parts: Array.isArray(definition.parts)
			? definition.parts.map((part) => ({
				...part,
				dimensions: normalizeVector3(part.dimensions, { x: 0.5, y: 0.5, z: 0.5 }),
				localPosition: normalizeVector3(part.localPosition, { x: 0, y: 0, z: 0 }),
				localRotation: normalizeVector3(part.localRotation, { x: 0, y: 0, z: 0 }),
				localScale: normalizeVector3(part.localScale, { x: 1, y: 1, z: 1 }),
			}))
			: [],
	};
}

async function PrepareLevelVisualResources(sceneGraph) {
	const templates = await LoadEngineVisualTemplates();
	const textureIDs = collectTextureReferences(sceneGraph);
	const textureRegistry = createTextureRegistry(templates, textureIDs);

	sceneGraph.visualResources = {
		textureRegistry: textureRegistry,
		scatterRegistry: templates.scatterTypes || {},
	};

	const scatterTypeCount = templates && templates.scatterTypes
		? Object.keys(templates.scatterTypes).length
		: 0;
	Log(
		"ENGINE",
		`Visual resources ready: textures=${Object.keys(textureRegistry).length}, scatterTypes=${scatterTypeCount}`,
		"log",
		"Level"
	);

	return sceneGraph;
}

export {
	LoadEngineVisualTemplates,
	PrepareLevelVisualResources,
	ResolveScatterType,
};