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
		const speck = Math.max(
			1,
			Number.isFinite(textureDefinition.speckSize)
				? Math.floor(textureDefinition.speckSize)
				: 2
		);
		const density = Number.isFinite(textureDefinition.density)
			? Math.max(0.1, textureDefinition.density)
			: 1;
		const speckCount = Math.min(16000, Math.max(size * 2, Math.floor(size * size * 0.02 * density)));
		ctx.fillStyle = secondary;
		for (let index = 0; index < speckCount; index += 1) {
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

function toPowerOfTwoSize(value) {
	let size = 8;
	const target = Math.max(8, Math.min(512, Math.floor(value)));
	while (size < target) {
		size *= 2;
	}
	return size;
}

function resolveTextureSize(textureDefinition, usageEntry) {
	const baseSize = Number.isFinite(textureDefinition.size) ? Math.max(8, textureDefinition.size) : 64;
	if (!usageEntry || usageEntry.isTerrain !== true) {
		return toPowerOfTwoSize(baseSize);
	}

	const span = Math.max(1, usageEntry.maxSpan || 1);
	const scaleMultiplier = Math.max(1, Math.min(8, span / 24));
	return toPowerOfTwoSize(baseSize * scaleMultiplier);
}

function buildTextureSurface(textureDefinition, resolvedSize) {
	if (typeof document === "undefined") {
		return null;
	}

	const size = Number.isFinite(resolvedSize)
		? Math.max(8, resolvedSize)
		: (Number.isFinite(textureDefinition.size) ? Math.max(8, textureDefinition.size) : 64);
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

function collectTextureUsage(sceneGraph) {
	const usage = {
		"default-grid": { isTerrain: false, maxSpan: 1 },
	};

	const register = (textureID, options) => {
		const id = textureID || "default-grid";
		if (!usage[id]) {
			usage[id] = { isTerrain: false, maxSpan: 1 };
		}

		const entry = usage[id];
		if (options && options.isTerrain === true) {
			entry.isTerrain = true;
			entry.maxSpan = Math.max(entry.maxSpan, options.maxSpan || 1);
		}
	};

	const collectMesh = (mesh, options) => {
		if (!mesh || !mesh.material || !mesh.material.textureID) {
			return;
		}
		register(mesh.material.textureID, options || null);
	};

	const terrain = Array.isArray(sceneGraph && sceneGraph.terrain) ? sceneGraph.terrain : [];
	terrain.forEach((mesh) => {
		const dimensions = normalizeVector3(mesh && mesh.dimensions, { x: 1, y: 1, z: 1 });
		const scale = normalizeVector3(mesh && mesh.transform && mesh.transform.scale, { x: 1, y: 1, z: 1 });
		const span = Math.max(1, dimensions.x * scale.x, dimensions.z * scale.z);
		collectMesh(mesh, { isTerrain: true, maxSpan: span });
	});

	const triggers = Array.isArray(sceneGraph && sceneGraph.triggers) ? sceneGraph.triggers : [];
	triggers.forEach((mesh) => collectMesh(mesh, null));

	const scatter = Array.isArray(sceneGraph && sceneGraph.scatter) ? sceneGraph.scatter : [];
	scatter.forEach((mesh) => collectMesh(mesh, null));

	const entities = Array.isArray(sceneGraph && sceneGraph.entities) ? sceneGraph.entities : [];
	entities.forEach((entity) => {
		if (entity && entity.model && Array.isArray(entity.model.parts)) {
			entity.model.parts.forEach((part) => collectMesh(part.mesh, null));
		}
		if (entity && entity.mesh) {
			collectMesh(entity.mesh, null);
		}
	});

	return usage;
}

function createTextureRegistry(templateRegistry, textureUsage) {
	const textureDefinitions = templateRegistry && templateRegistry.textures ? templateRegistry.textures : {};
	const fallback = textureDefinitions["default-grid"] || {
		id: "default-grid",
		size: 64,
		pattern: "grid",
		primary: "#b3beca",
		secondary: "#748394",
	};

	const registry = {};
	const usage = textureUsage && typeof textureUsage === "object"
		? textureUsage
		: { "default-grid": { isTerrain: false, maxSpan: 1 } };
	const textureIDs = Object.keys(usage);
	textureIDs.forEach((textureID) => {
		const definition = textureDefinitions[textureID] || fallback;
		const resolvedSize = resolveTextureSize(definition, usage[textureID]);
		const source = buildTextureSurface(definition, resolvedSize);
		registry[textureID] = {
			id: textureID,
			definition: {
				...definition,
				size: resolvedSize,
			},
			source: source,
		};
	});

	if (!registry["default-grid"]) {
		const fallbackSize = resolveTextureSize(fallback, usage["default-grid"] || null);
		registry["default-grid"] = {
			id: "default-grid",
			definition: {
				...fallback,
				size: fallbackSize,
			},
			source: buildTextureSurface(fallback, fallbackSize),
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
	const textureUsage = collectTextureUsage(sceneGraph);
	const textureRegistry = createTextureRegistry(templates, textureUsage);

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