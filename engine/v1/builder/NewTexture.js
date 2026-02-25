// Create 2D textures (like grass or pebbles) to populate the world with.

// Used by NewObject.js to apply 2D and/or 3D textures to model parts.
// Uses NewObject.js to build simple 3D textures (like grass, pebbles, etc)

import { NormalizeVector3 } from "../math/Vector3.js";
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

function toNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function hashNoise(x, y, seed) {
	const value = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
	return value - Math.floor(value);
}

function normalizeShape(shape) {
	if (typeof shape !== "string") {
		return "square";
	}

	const value = shape.trim().toLowerCase();
	if (value === "circle" || value === "diamond") {
		return value;
	}

	return "square";
}

function drawShape(ctx, shape, x, y, width, height) {
	if (shape === "circle") {
		ctx.beginPath();
		ctx.ellipse(
			x + width * 0.5,
			y + height * 0.5,
			Math.max(0.5, width * 0.5),
			Math.max(0.5, height * 0.5),
			0,
			0,
			Math.PI * 2
		);
		ctx.fill();
		return;
	}

	if (shape === "diamond") {
		ctx.beginPath();
		ctx.moveTo(x + width * 0.5, y);
		ctx.lineTo(x + width, y + height * 0.5);
		ctx.lineTo(x + width * 0.5, y + height);
		ctx.lineTo(x, y + height * 0.5);
		ctx.closePath();
		ctx.fill();
		return;
	}

	ctx.fillRect(x, y, width, height);
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

function drawPattern(ctx, size, textureDefinition, textureScale = 1) {
    const primary = parseHexColor(textureDefinition.primary, "rgb(170, 180, 190)");
    const secondary = parseHexColor(textureDefinition.secondary, "rgb(100, 110, 120)");
    const pattern = textureDefinition.pattern || "grid";
    const featureScale = Math.max(0.05, typeof textureScale === "number" ? textureScale : 1);
    const shape = normalizeShape(textureDefinition.shape);
    const draw = (x, y, width, height) => drawShape(ctx, shape, x, y, width, height);

    ctx.fillStyle = primary;
    ctx.fillRect(0, 0, size, size);

    if (pattern === "checker") {
        const cell = Math.max(4, Math.floor((size / 8) * featureScale));
        for (let x = 0; x < size; x += cell) {
            for (let y = 0; y < size; y += cell) {
                if ((x / cell + y / cell) % 2 === 0) {
                    ctx.fillStyle = secondary;
                    draw(x, y, cell, cell);
                }
            }
        }
        return;
    }

    if (pattern === "stripes") {
        const stripe = Math.max(3, Math.floor((size / 10) * featureScale));
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
        const baseSpeck = Number.isFinite(textureDefinition.speckSize)
            ? Math.floor(textureDefinition.speckSize)
            : 2;
        const speck = Math.max(1, Math.floor(baseSpeck * featureScale));
        const density = Number.isFinite(textureDefinition.density)
            ? Math.max(0.1, textureDefinition.density)
            : 1;
        const densityScale = Math.max(0.05, featureScale * featureScale);
        const speckCount = Math.min(16000, Math.max(size * 2, Math.floor((size * size * 0.02 * density) / densityScale)));
        ctx.fillStyle = secondary;
        for (let index = 0; index < speckCount; index += 1) {
            const x = Math.floor(Math.random() * (size - speck));
            const y = Math.floor(Math.random() * (size - speck));
            draw(x, y, speck, speck);
        }
        return;
    }

    const line = Math.max(2, Math.floor((size / 8) * featureScale));
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

function buildTextureSurface(textureDefinition, resolvedSize, textureScale) {
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

	drawPattern(context, size, textureDefinition, textureScale);
	return canvas;
}

function collectTextureUsage(sceneGraph) {
	const usage = {
		"default-grid": { isTerrain: false, maxSpan: 1, density: null, baseTextureID: "default-grid", shape: null },
	};

	const register = (textureID, options) => {
		const id = textureID || "default-grid";
		if (!usage[id]) {
			usage[id] = { isTerrain: false, maxSpan: 1, density: null, baseTextureID: id, shape: null };
		}

		const entry = usage[id];
		if (options && options.isTerrain === true) {
			entry.isTerrain = true;
			entry.maxSpan = Math.max(entry.maxSpan, options.maxSpan || 1);
		}

		if (options && Number.isFinite(options.density)) {
			entry.density = Number.isFinite(entry.density)
				? Math.max(entry.density, options.density)
				: options.density;
		}

		if (options && typeof options.baseTextureID === "string" && options.baseTextureID.length > 0) {
			entry.baseTextureID = options.baseTextureID;
		}

		if (options && typeof options.shape === "string" && options.shape.length > 0) {
			entry.shape = normalizeShape(options.shape);
		}
	};

	const collectMesh = (mesh, options) => {
		if (!mesh || !mesh.material || !mesh.material.textureID) {
			return;
		}
		const detailDensity = mesh.detail && mesh.detail.texture && Number.isFinite(mesh.detail.texture.density)
			? mesh.detail.texture.density
			: null;
		const detailTexture = mesh.detail && mesh.detail.texture && typeof mesh.detail.texture === "object"
			? mesh.detail.texture
			: null;
		register(mesh.material.textureID, {
			...(options || {}),
			density: Number.isFinite(detailDensity) ? detailDensity : (options ? options.density : null),
			baseTextureID: detailTexture && typeof detailTexture.baseTextureID === "string"
				? detailTexture.baseTextureID
				: (detailTexture && typeof detailTexture.textureID === "string" ? detailTexture.textureID : mesh.material.textureID),
			shape: detailTexture && typeof detailTexture.shape === "string" ? detailTexture.shape : null,
		});
	};

	const terrain = Array.isArray(sceneGraph && sceneGraph.terrain) ? sceneGraph.terrain : [];
	terrain.forEach((mesh) => {
		const dimensions = NormalizeVector3(mesh && mesh.dimensions, { x: 1, y: 1, z: 1 });
		const scale = NormalizeVector3(mesh && mesh.transform && mesh.transform.scale, { x: 1, y: 1, z: 1 });
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

function createTextureRegistry(templateRegistry, textureUsage, options) {
	const textureDefinitions = templateRegistry && templateRegistry.textures ? templateRegistry.textures : {};
	const resolvedOptions = options && typeof options === "object" ? options : {};
	const textureScale = Math.max(0.05, toNumber(resolvedOptions.textureScale, 1));
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
		: { "default-grid": { isTerrain: false, maxSpan: 1, density: null, baseTextureID: "default-grid", shape: null } };
	const textureIDs = Object.keys(usage);
	textureIDs.forEach((textureID) => {
		const usageEntry = usage[textureID] || {};
		const baseTextureID = typeof usageEntry.baseTextureID === "string" && usageEntry.baseTextureID.length > 0
			? usageEntry.baseTextureID
			: textureID;
		const definition = textureDefinitions[baseTextureID] || textureDefinitions[textureID] || fallback;
		const resolvedSize = resolveTextureSize(definition, usage[textureID]);
		const usageDensity = usage[textureID] && Number.isFinite(usage[textureID].density)
			? Math.max(0.1, usage[textureID].density)
			: null;
		const usageShape = typeof usageEntry.shape === "string" && usageEntry.shape.length > 0
			? normalizeShape(usageEntry.shape)
			: null;
		let resolvedDefinition = usageDensity
			? { ...definition, density: usageDensity }
			: { ...definition };
		if (usageShape) {
			resolvedDefinition = {
				...resolvedDefinition,
				shape: usageShape,
			};
		}
		const source = buildTextureSurface(resolvedDefinition, resolvedSize, textureScale);
		registry[textureID] = {
			id: textureID,
			definition: {
				...resolvedDefinition,
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
			source: buildTextureSurface(fallback, fallbackSize, textureScale),
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

async function PrepareLevelVisualResources(sceneGraph) {
	const templates = await LoadEngineVisualTemplates();
	const textureUsage = collectTextureUsage(sceneGraph);
	const world = sceneGraph && sceneGraph.world && typeof sceneGraph.world === "object"
		? sceneGraph.world
		: {};
	const textureRegistry = createTextureRegistry(templates, textureUsage, {
		textureScale: toNumber(world.textureScale, 1),
	});

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
};