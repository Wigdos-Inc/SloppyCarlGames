// Create 2D textures (like grass or pebbles) to populate the world with.

// Used by NewObject.js for mesh and decal textures
// Used by NewScatter.js for scatter batch texture IDs
// Used by NewVoid.js for void face textures
// Used by handlers/game/Texture.js for runtime custom textures
// Used by handlers/game/Level.js to prepare level visual resources

import VISUAL_TEMPLATES from "./templates/textures.json" with { type: "json" };
import { CONFIG } from "../core/config.js";
import { Log, ENTITY_TYPES } from "../core/meta.js";

const rgbaToCss = (c) => `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`;

// Cache-key form; a raw color object stringifies to [object Object].
const formatColorKey = (c) => `${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)},${c.a.toFixed(4)}`;

// Must include every field that affects the bake, or distinct meshes collapse onto one entry.
function ComputeGeneratedTextureID(generatedTexture) {
	const parts = [generatedTexture.id];
	if (generatedTexture.primary       !== null) parts.push(`p=${formatColorKey(generatedTexture.primary)}`);
	if (generatedTexture.secondary     !== null) parts.push(`s=${formatColorKey(generatedTexture.secondary)}`);
	if (generatedTexture.shape         !== null) parts.push(`sh=${generatedTexture.shape}`);
	if (generatedTexture.compositeMode !== null) parts.push(`cm=${generatedTexture.compositeMode}`);
	if (generatedTexture.density       !== 1)    parts.push(`d=${generatedTexture.density}`);
	if (generatedTexture.speckSize     !== 1)    parts.push(`ss=${generatedTexture.speckSize}`);
	return parts.join("::");
}

// Decal render source, shared by NewObject.js (per-mesh) and NewScatter.js (per-batch).
function InitializeDecalDisplay(customTextures) {
	customTextures.forEach((decal) => {
		decal.displayTransform = decal.localTransform;
		decal.displayColor = null;
		decal.activeSourceKey = null;
	});
}

function IsTextureTransparent(generatedTexture) {
	return (generatedTexture.primary !== null && generatedTexture.primary.a < 1)
		|| (generatedTexture.secondary !== null && generatedTexture.secondary.a < 1);
}

const formatDecalColor = (c) => c === null ? "n" : formatColorKey(c);
const formatDecalTransform = (t) => `${t.position.x},${t.position.y},${t.position.z}|${t.rotation.value}|${t.scale.x},${t.scale.y},${t.scale.z}`;

function formatDecalDetail(d) {
	return d === null ? "n" 
		: `${d.baseTextureID}|${d.density}|${d.speckSize}|${d.animated}|${formatDecalColor(d.primary)}|${formatDecalColor(d.secondary)}`;
}

function formatDecalSource(src) {
	return src.decalType === "image" ? `image|${src.imagePath}|${src.sourceType}` 
		: `shape|${src.shape}|${formatDecalColor(src.color)}|${formatDecalDetail(src.detail)}`;
}

function formatCustomTextureEntry(ct) {
	const base = `${ct.decalType}|${ct.side}|${formatDecalTransform(ct.localTransform)}`;
	if (ct.decalType === "image") return `${base}|img=${ct.imagePath}|op=${ct.opacity}`;
	const sourcesKey = ct.sources === null ? "n" : Object.keys(ct.sources).sort().map((key) => `${key}=${formatDecalSource(ct.sources[key])}`).join(",");
	return `${base}|${ct.shape}|${formatDecalColor(ct.color)}|${formatDecalDetail(ct.detail)}|src=${sourcesKey}`;
}

// Two parts must never collapse into one scatter batch if their decal authoring differs.
function ComputeCustomTextureSignature(customTextures) {
	if (customTextures.length === 0) return "none";
	return customTextures.map(formatCustomTextureEntry).join(";;");
}

// Map frequency patterns to CONFIG.RENDERING.Texture blocks. Absent = not a frequency pattern.
const FREQUENCY_PATTERN_CONFIG = {
	tiles  : "Tiles",
	stripes: "Stripes",
	grid   : "Grid",
};

// Erase footprint first for translucent paint only (avoids double-blend); opaque skips it.
function fillReplacing(ctx, replace, drawFn) {
	if (!replace) { drawFn(); return; }
	const paintStyle = ctx.fillStyle;
	ctx.globalCompositeOperation = "destination-out";
	ctx.fillStyle = "#000";
	drawFn();
	ctx.globalCompositeOperation = "source-over";
	ctx.fillStyle = paintStyle;
	drawFn();
}

// null = derive from alpha (legacy default). New mode: also add to canonSchemas.json allowedValues.
const resolveReplace = (definition) =>
	definition.compositeMode !== null ? definition.compositeMode === "replace" : definition.secondary.a < 1;

function drawShape(ctx, shape, replace, x, y, width, height) {
	fillReplacing(ctx, replace, () => {
		switch (shape) {
			case "circle": {
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
				break;
			}
			case "diamond": {
				ctx.beginPath();
				ctx.moveTo(x + width * 0.5, y);
				ctx.lineTo(x + width, y + height * 0.5);
				ctx.lineTo(x + width * 0.5, y + height);
				ctx.lineTo(x, y + height * 0.5);
				ctx.closePath();
				ctx.fill();
				break;
			}
			default: { ctx.fillRect(x, y, width, height) }
		}
	});
}

function drawPattern(ctx, size, textureDefinition, textureScale, periods = 1) {
	const primary = rgbaToCss(textureDefinition.primary);
	const secondary = rgbaToCss(textureDefinition.secondary);
	const replace = resolveReplace(textureDefinition);
    const draw = (x, y, width, height) => drawShape(ctx, textureDefinition.shape, replace, x, y, width, height);

    ctx.fillStyle = primary;
    ctx.fillRect(0, 0, size, size);

	switch (textureDefinition.pattern) {
		case "tiles": {
			const cfg       = CONFIG.RENDERING.Texture.Tiles;
			const cellCount = periods;
			if (cellCount === 0) return;
			const cellSize  = size / cellCount;
			const blockSize = Math.max(1, Math.floor(cellSize * textureDefinition.speckSize * cfg.SpeckSize));
			const inset     = (cellSize - blockSize) / 2;
			ctx.fillStyle = secondary;
			for (let xi = 0; xi < cellCount; xi++) for (let yi = 0; yi < cellCount; yi++) {
				fillReplacing(ctx, replace, () => ctx.fillRect(Math.round(xi * cellSize + inset), Math.round(yi * cellSize + inset), blockSize, blockSize));
			}
			return;
		}
		case "stripes": {
			const cfg            = CONFIG.RENDERING.Texture.Stripes;
			const stripeCount    = periods;
			if (stripeCount === 0) return;
			const pitch          = size / stripeCount;
			const effSpeckSize   = textureDefinition.speckSize * cfg.SpeckSize;
			const offStripeWidth = Math.max(1, Math.floor(pitch * effSpeckSize / (1 + effSpeckSize)));
			ctx.fillStyle = secondary;
			for (let yi = 0; yi < stripeCount; yi++) fillReplacing(ctx, replace, () => ctx.fillRect(0, Math.round(yi * pitch), size, offStripeWidth));
			return;
		}
		case "radial": {
			const gradient = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.1, size * 0.5, size * 0.5, size * 0.6);
			gradient.addColorStop(0, secondary);
			gradient.addColorStop(1, primary);
			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, size, size);
			return;
		}
		// REPEAT-wrapped raw UVs sample only near y=0/size (see grass-blade); stops meet at the wrap so it's seamless.
		case "linear": {
			const mid = rgbaToCss({
				r: (textureDefinition.primary.r + textureDefinition.secondary.r) / 2,
				g: (textureDefinition.primary.g + textureDefinition.secondary.g) / 2,
				b: (textureDefinition.primary.b + textureDefinition.secondary.b) / 2,
				a: (textureDefinition.primary.a + textureDefinition.secondary.a) / 2,
			});
			const gradient = ctx.createLinearGradient(0, 0, 0, size);
			gradient.addColorStop(0, mid);
			gradient.addColorStop(0.1, secondary);
			gradient.addColorStop(0.9, primary);
			gradient.addColorStop(1, mid);
			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, size, size);
			return;
		}
		case "noise": {
			const effSpeckSize = textureDefinition.speckSize * CONFIG.RENDERING.Texture.Noise.SpeckSize;
			const effDensity   = textureDefinition.density   * CONFIG.RENDERING.Texture.Noise.Density;
			const speck = Math.max(1, Math.floor(effSpeckSize * textureScale));
			const speckCount = Math.min(16000, Math.floor((size * size * effDensity) / (speck * speck)));
			const drawWrapped = (x, y) => {
				draw(x, y, speck, speck);
				const wrapX = x + speck > size;
				const wrapY = y + speck > size;
				if (wrapX)          draw(x - size, y,        speck, speck);
				if (wrapY)          draw(x,        y - size, speck, speck);
				if (wrapX && wrapY) draw(x - size, y - size, speck, speck);
			};
			ctx.fillStyle = secondary;
			for (let index = 0; index < speckCount; index++) drawWrapped(Math.random() * size, Math.random() * size);
			return;
		}
		case "grid": {
			// Checker lattice, cell = pitch/2. speckSize 1 = clean 50/50, >1 overlaps.
			const cfg         = CONFIG.RENDERING.Texture.Grid;
			const cellsPerRow = periods;
			if (cellsPerRow === 0) return;
			const cell      = size / (cellsPerRow * 2);
			const ratio     = textureDefinition.speckSize * cfg.SpeckSize;
			const blockSize = Math.max(1, Math.round(cell * ratio));
			const drawWrapped = (cx, cy) => {
				const x0 = cx - blockSize / 2;
				const y0 = cy - blockSize / 2;
				for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
					const x = x0 + dx, y = y0 + dy;
					if (x + blockSize <= 0 || x >= size || y + blockSize <= 0 || y >= size) continue;
					fillReplacing(ctx, replace, () => ctx.fillRect(Math.round(x), Math.round(y), blockSize, blockSize));
				}
			};
			ctx.fillStyle = secondary;
			const cellsTotal = cellsPerRow * 2;
			for (let j = 0; j < cellsTotal; j++) for (let i = 0; i < cellsTotal; i++) {
				if ((i + j) % 2 !== 0) continue;
				drawWrapped((i + 0.5) * cell, (j + 0.5) * cell);
			}
			return;
		}
		default: return;
	}
}

function toPowerOfTwoSize(value) {
	let size = 8;
	const target = Math.max(8, Math.min(512, Math.floor(value)));
	while (size < target) size *= 2;
	return size;
}

function resolveTextureSize(textureDefinition, usageEntry) {
	if (usageEntry.isTerrain !== true) return toPowerOfTwoSize(textureDefinition.size);
	return toPowerOfTwoSize(textureDefinition.size * Math.max(1, Math.min(8, usageEntry.maxSpan / 24)));
}

function buildTextureSurface(textureDefinition, resolvedSize, textureScale, periods = 1) {
	const size = resolvedSize || textureDefinition.size;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	drawPattern(canvas.getContext("2d"), size, textureDefinition, textureScale, periods);
	return canvas;
}

function createUsageEntry(baseTextureID) {
	return {
		isTerrain: false, maxSpan: 1, density: 1, speckSize: 1, animatedRequested: false,
		holdTimeSpeed: 1, blendTimeSpeed: 1, baseTextureID, shape: null, compositeMode: null,
		primaryOverride: null, secondaryOverride: null,
	};
}

function registerTextureUsage(id, options, usage) {
	if (!usage[id]) usage[id] = createUsageEntry(id);
	const entry = usage[id];
	if (options.isTerrain) { entry.isTerrain = true; entry.maxSpan = options.maxSpan; }
	entry.density = options.density;
	entry.speckSize = options.speckSize;
	entry.baseTextureID = options.baseTextureID;
	entry.shape = options.shape;
	entry.compositeMode = options.compositeMode;
	entry.animatedRequested = options.animatedRequested;
	entry.holdTimeSpeed = options.holdTimeSpeed;
	entry.blendTimeSpeed = options.blendTimeSpeed;
	entry.primaryOverride   = options.primaryOverride;
	entry.secondaryOverride = options.secondaryOverride;
}

// Texture definition -> registerTextureUsage options. Shared by mesh and scatter-batch collection.
function textureRegistrationOptions(texture, isTerrain, maxSpan) {
	return {
		isTerrain, maxSpan,
		density          : texture.density,
		speckSize        : texture.speckSize,
		baseTextureID    : texture.id,
		shape            : texture.shape,
		compositeMode    : texture.compositeMode,
		animatedRequested: texture.animated === true,
		holdTimeSpeed    : texture.holdTimeSpeed,
		blendTimeSpeed   : texture.blendTimeSpeed,
		primaryOverride  : texture.primary,
		secondaryOverride: texture.secondary,
	};
}

function collectMesh(mesh, options, ownerKey, usage, customTextureUsage) {
	// Per-face meshes draw from faceTextureGroups; material.textureID is never bound.
	if (mesh.geometry.faceTextureGroups) return;

	const texture = mesh.detail.texture;
	let materialTextureID = mesh.material.textureID;
	if (texture.animated === true) {
		materialTextureID = `${mesh.material.textureID}::animated=${ownerKey}`;
		mesh.material.textureID = materialTextureID;
	}
	registerTextureUsage(materialTextureID, textureRegistrationOptions(texture, options.isTerrain, options.maxSpan), usage);
}

function collectDecalAlternateSources(baseId, ct, mesh, customTextureUsage) {
	if (ct.sources === null) return;
	const placement = { side: ct.side, localTransform: ct.localTransform };
	for (const sourceKey in ct.sources) {
		const src = ct.sources[sourceKey];
		const altId = `${baseId}::${sourceKey}`;
		if (src.decalType === "image") customTextureUsage[altId] = { decalType: "image", bitmap: src.bitmap, placement };
		else {
			customTextureUsage[altId] = {
				decalType: "shape",
				ct: {
					shape: src.shape, color: src.color, detail: src.detail,
					localTransform: { scale: ct.localTransform.scale }, side: ct.side, mutable: false,
				},
				mesh, placement,
			};
		}
	}
}

function collectCustomTextures(mesh, customTextureUsage) {
	mesh.customTextures.forEach((ct, index) => {
		const id = `${mesh.id}::customTexture::${index}`;
		if (ct.decalType === "image") {
			customTextureUsage[id] = {
				decalType: "image",
				bitmap   : ct.bitmap,
				opacity  : ct.opacity,
				placement: { side: ct.side, localTransform: ct.localTransform },
			};
		} 
		else {
			customTextureUsage[id] = {
				decalType: "shape", ct, mesh,
				placement: { side: ct.side, localTransform: ct.localTransform },
			};
		}
		collectDecalAlternateSources(id, ct, mesh, customTextureUsage);
	});
}

function collectTextureUsage(sceneGraph) {
	const usage = { "default-tiles": createUsageEntry("default-tiles") };
	const customTextureUsage = {};
	const nonTerrainOptions = { isTerrain: false, maxSpan: 1 };

	sceneGraph.terrain.forEach((mesh) => {
		if (mesh.meta.mode !== "default") return;
		const span = Math.max(mesh.dimensions.x * mesh.transform.scale.x, mesh.dimensions.z * mesh.transform.scale.z);
		collectMesh(mesh, { isTerrain: true, maxSpan: span }, mesh.id, usage, customTextureUsage);
		collectCustomTextures(mesh, customTextureUsage);
	});

	sceneGraph.triggers.forEach((mesh) => collectMesh(mesh, nonTerrainOptions, mesh.id, usage, customTextureUsage));
	sceneGraph.scatter.forEach((mesh) => collectMesh(mesh, nonTerrainOptions, mesh.id, usage, customTextureUsage));
	sceneGraph.obstacles.forEach((obstacle) => {
		if (obstacle.mode !== "default") return;
		collectMesh(obstacle.mesh, nonTerrainOptions, obstacle.mesh.id, usage, customTextureUsage);
		obstacle.parts.forEach((part) => {
			collectMesh(part, nonTerrainOptions, part.id, usage, customTextureUsage);
			collectCustomTextures(part, customTextureUsage);
		});
	});

	if (sceneGraph.waterVisual) {
		const waterMeshes = [];
		if (sceneGraph.waterVisual.body) waterMeshes.push(sceneGraph.waterVisual.body);
		if (sceneGraph.waterVisual.top) waterMeshes.push(sceneGraph.waterVisual.top);
		waterMeshes.forEach((mesh) => collectMesh(mesh, nonTerrainOptions, mesh.id, usage, customTextureUsage));
	}

	// Collect texture IDs from instanced scatter batches. Decal texture(s) bake once per batch
	// (keyed by batchKey), not once per instance — batchKey already guarantees identical authoring.
	sceneGraph.scatterBatches.forEach((batch, batchKey) => {
		registerTextureUsage(batch.textureID, textureRegistrationOptions(batch.texture, false, 1), usage);
		if (batch.customTextures.length > 0) {
			collectCustomTextures(
				{ id: batchKey, customTextures: batch.customTextures, dimensions: batch.dimensions, detail: { texture: batch.texture } },
				customTextureUsage
			);
		}
	});

	sceneGraph.entities.forEach((entity) => {
		entity.model.parts.forEach((part) => {
			collectMesh(part.mesh, nonTerrainOptions, part.mesh.id, usage, customTextureUsage);
			collectCustomTextures(part.mesh, customTextureUsage);
		});
	});

	return { usage, customTextureUsage };
}

function AddToVisualResources(built, objectType, sceneGraph) {
	const usage = {};
	const customTextureUsage = {};
	const nonTerrainOptions = { isTerrain: false, maxSpan: 1 };

	if (ENTITY_TYPES.includes(objectType)) {
		built.model.parts.forEach((part) => {
			collectMesh(part.mesh, nonTerrainOptions, part.mesh.id, usage, customTextureUsage);
			collectCustomTextures(part.mesh, customTextureUsage);
		});
	} 
	else if (objectType === "obstacle") {
		collectMesh(built.mesh, nonTerrainOptions, built.mesh.id, usage, customTextureUsage);
		built.parts.forEach((part) => {
			collectMesh(part, nonTerrainOptions, part.id, usage, customTextureUsage);
			collectCustomTextures(part, customTextureUsage);
		});
	} 
	else {
		const span = Math.max(built.dimensions.x * built.transform.scale.x, built.dimensions.z * built.transform.scale.z);
		collectMesh(built, { isTerrain: true, maxSpan: span }, built.id, usage, customTextureUsage);
		collectCustomTextures(built, customTextureUsage);
	}

	const newEntries = createTextureRegistry(usage, customTextureUsage, { textureScale: sceneGraph.world.textureScale });
	for (const id in newEntries) {
		if (!sceneGraph.visualResources.textureRegistry[id]) sceneGraph.visualResources.textureRegistry[id] = newEntries[id];
	}
}

// New shape: add method here + normalize.js shapeRequiredFields + canonSchemas.json allowedValues.
const shapeMaskBuilders = {
	square: (w, h) => {
		const canvas = document.createElement("canvas");
		canvas.width = w; canvas.height = h;
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = "white";
		ctx.fillRect(0, 0, w, h);
		return canvas;
	},
	circle: (w, h) => {
		const canvas = document.createElement("canvas");
		canvas.width = w; canvas.height = h;
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = "white";
		ctx.beginPath();
		ctx.ellipse(w * 0.5, h * 0.5, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
		ctx.fill();
		return canvas;
	},
	triangle: (w, h) => {
		const canvas = document.createElement("canvas");
		canvas.width = w; canvas.height = h;
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = "white";
		ctx.beginPath();
		ctx.moveTo(w * 0.5, 0);
		ctx.lineTo(w, h);
		ctx.lineTo(0, h);
		ctx.closePath();
		ctx.fill();
		return canvas;
	},
};

function bakeImageDecalOpacity(bitmap, opacity) {
	const canvas = document.createElement("canvas");
	canvas.width = bitmap.width; canvas.height = bitmap.height;
	const ctx = canvas.getContext("2d");
	ctx.globalAlpha = opacity;
	ctx.drawImage(bitmap, 0, 0);
	return canvas;
}

function compositeShapeDecal(ct, mesh, textureScale) {
	const size = 256;
	const canvas = document.createElement("canvas");
	canvas.width = size; canvas.height = size;
	const ctx = canvas.getContext("2d");

	ctx.fillStyle = ct.mutable ? "rgba(255, 255, 255, 1)" : rgbaToCss(ct.color);
	ctx.fillRect(0, 0, size, size);
	ctx.globalCompositeOperation = "destination-in";
	ctx.drawImage(shapeMaskBuilders[ct.shape](size, size), 0, 0);
	ctx.globalCompositeOperation = "source-over";

	if (ct.detail !== null && ct.detail.baseTextureID !== null) {
		const faceSizes = {
			front: [mesh.dimensions.x, mesh.dimensions.y], back:   [mesh.dimensions.x, mesh.dimensions.y],
			top:   [mesh.dimensions.x, mesh.dimensions.z], bottom: [mesh.dimensions.x, mesh.dimensions.z],
			right: [mesh.dimensions.z, mesh.dimensions.y], left:   [mesh.dimensions.z, mesh.dimensions.y],
		};
		const [faceW, faceH] = faceSizes[ct.side];
		const partFaceSize  = Math.max(faceW, faceH);
		const autoRatio     = partFaceSize > 0 ? Math.max(ct.localTransform.scale.x, ct.localTransform.scale.y) / partFaceSize : 1;

		const decalBlueprint = VISUAL_TEMPLATES.textures[ct.detail.baseTextureID];
		const resolvedBlueprint = {
			...decalBlueprint,
			density:   mesh.detail.texture.density   * ct.detail.density,
			speckSize: mesh.detail.texture.speckSize * ct.detail.speckSize,
			...(ct.detail.primary   !== null && { primary:   ct.detail.primary   }),
			...(ct.detail.secondary !== null && { secondary: ct.detail.secondary }),
		};
		const effectiveScale = autoRatio > 0 ? textureScale / autoRatio : textureScale;

		// Frequency patterns bake period count directly; others ignore periods (default 1).
		const decalConfigKey = FREQUENCY_PATTERN_CONFIG[resolvedBlueprint.pattern];
		const periods = decalConfigKey ? Math.round(resolvedBlueprint.density * CONFIG.RENDERING.Texture[decalConfigKey].Density) : 1;

		ctx.globalCompositeOperation = "source-atop";
		ctx.drawImage(buildTextureSurface(resolvedBlueprint, toPowerOfTwoSize(decalBlueprint.size), effectiveScale, periods), 0, 0, size, size);
		ctx.globalCompositeOperation = "source-over";
	}

	return canvas;
}

// null = static decal. Animation needs the decal to opt in and its preset to support it; the
// preset's own hold/blend times are used, matching shape and compositeMode being preset-only here.
function decalAnimationDefinition(cu) {
	if (cu.decalType !== "shape") return null;
	if (cu.ct.detail === null || cu.ct.detail.baseTextureID === null) return null;
	if (cu.ct.detail.animated !== true) return null;

	const blueprint = VISUAL_TEMPLATES.textures[cu.ct.detail.baseTextureID];
	if (blueprint.animation.able !== true) return null;

	return {
		bakeKind      : "decal",
		ct            : cu.ct,
		mesh          : cu.mesh,
		holdTimeSpeed : 1,
		blendTimeSpeed: 1,
		animation     : { able: true, holdTime: blueprint.animation.holdTime, blendTime: blueprint.animation.blendTime },
	};
}

function createTextureRegistry(usage, customTextureUsage, options) {
	const registry = {};
	for (const textureID in usage) {
		const usageEntry = usage[textureID];
		const textureBlueprint = VISUAL_TEMPLATES.textures[usageEntry.baseTextureID];
		const resolvedSize = resolveTextureSize(textureBlueprint, usageEntry);
		
		// Density baked only for noise; frequency patterns keep it in per-mesh UVs.
		const isFrequencyPattern = FREQUENCY_PATTERN_CONFIG[textureBlueprint.pattern] !== undefined;
		const resolvedTextureBlueprint = {
			...textureBlueprint,
			density:   isFrequencyPattern ? textureBlueprint.density : textureBlueprint.density * usageEntry.density,
			speckSize: textureBlueprint.speckSize * usageEntry.speckSize,
			...(usageEntry.shape              && { shape:     usageEntry.shape                              }),
			...(usageEntry.compositeMode !== null && { compositeMode: usageEntry.compositeMode }),
			...(usageEntry.primaryOverride   !== null && { primary:   usageEntry.primaryOverride   }),
			...(usageEntry.secondaryOverride !== null && { secondary: usageEntry.secondaryOverride }),
		};

		const animatedRequested = usageEntry.animatedRequested === true;
		const templateSupportsAnimation = textureBlueprint.animation.able === true;
		if (animatedRequested && !templateSupportsAnimation) {
			Log(
				"ENGINE",
				`'${usageEntry.baseTextureID}' does not support animation.\nSource: '${textureID}'`,
				"warn",
				"Level"
			);
		}

		registry[textureID] = {
			id: textureID,
			definition: {
				...resolvedTextureBlueprint,
				bakeKind: "surface",
				size: resolvedSize,
				holdTimeSpeed: usageEntry.holdTimeSpeed,
				blendTimeSpeed: usageEntry.blendTimeSpeed,
				animation: {
					able: animatedRequested && templateSupportsAnimation,
					holdTime: textureBlueprint.animation.holdTime,
					blendTime: textureBlueprint.animation.blendTime,
				},
			},
			source: buildTextureSurface(resolvedTextureBlueprint, resolvedSize, options.textureScale),
		};
	};

	for (const id in customTextureUsage) {
		const cu = customTextureUsage[id];
		let source;
		if (cu.decalType === "image") source = cu.opacity < 1 ? bakeImageDecalOpacity(cu.bitmap, cu.opacity) : cu.bitmap;
		else source = compositeShapeDecal(cu.ct, cu.mesh, options.textureScale);
		registry[id] = { id, source, placement: cu.placement, definition: decalAnimationDefinition(cu) };
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
	const { usage, customTextureUsage } = collectTextureUsage(sceneGraph);
	const textureRegistry = createTextureRegistry(usage, customTextureUsage, { textureScale: sceneGraph.world.textureScale });

	// pendingFaceTextures is signature-keyed; identical faces already collapsed, so merge is idempotent.
	for (const id in sceneGraph.pendingFaceTextures) textureRegistry[id] = sceneGraph.pendingFaceTextures[id];
	sceneGraph.pendingFaceTextures = {};

	sceneGraph.visualResources = {
		textureRegistry,
		scatterRegistry: VISUAL_TEMPLATES.scatterTypes,
		primitiveGeometry: sceneGraph.scatterPrimitiveGeometry,
	};

	Log(
		"ENGINE",
		`Visual resources ready: textures=${Object.keys(textureRegistry).length}, scatterTypes=${Object.keys(VISUAL_TEMPLATES.scatterTypes).length}`,
		"log",
		"Level"
	);

	return sceneGraph;
}

// Merges blueprint with per-mesh detail scalars/overrides; null = no override. Shared by NewObject/NewVoid.
function ResolveNoiseFaceBlueprint(textureBlueprint, textureDetail) {
	return {
		...textureBlueprint,
		density  : textureBlueprint.density   * textureDetail.density,
		speckSize: textureBlueprint.speckSize  * textureDetail.speckSize,
		shape        : textureDetail.shape !== null ? textureDetail.shape : textureBlueprint.shape,
		compositeMode: textureDetail.compositeMode !== null ? textureDetail.compositeMode : textureBlueprint.compositeMode,
		...(textureDetail.primary   !== null && { primary:   textureDetail.primary   }),
		...(textureDetail.secondary !== null && { secondary: textureDetail.secondary }),
	};
}

// Paints the base fill and returns a resumable speck job.
function BeginNoiseBake(blueprint, pixelW, pixelH, textureScale) {
	const canvas = document.createElement("canvas");
	canvas.width  = pixelW;
	canvas.height = pixelH;
	const ctx = canvas.getContext("2d");

	const replace = resolveReplace(blueprint);
	const draw = (x, y, width, height) => drawShape(ctx, blueprint.shape, replace, x, y, width, height);

	ctx.fillStyle = rgbaToCss(blueprint.primary);
	ctx.fillRect(0, 0, pixelW, pixelH);

	const effSpeckSize = blueprint.speckSize * CONFIG.RENDERING.Texture.Noise.SpeckSize;
	const effDensity   = blueprint.density   * CONFIG.RENDERING.Texture.Noise.Density;
	const speck = Math.max(1, Math.floor(effSpeckSize * textureScale));

	const drawWrapped = (x, y) => {
		draw(x, y, speck, speck);
		const wrapX = x + speck > pixelW;
		const wrapY = y + speck > pixelH;
		if (wrapX)          draw(x - pixelW, y,         speck, speck);
		if (wrapY)          draw(x,          y - pixelH, speck, speck);
		if (wrapX && wrapY) draw(x - pixelW, y - pixelH, speck, speck);
	};

	ctx.fillStyle = rgbaToCss(blueprint.secondary);
	return {
		canvas, pixelW, pixelH, drawWrapped,
		speckCount: Math.floor((pixelW * pixelH * effDensity) / (speck * speck)),
		drawn     : 0,
	};
}

// Draws up to speckBudget specks. True once the job's full speck count is down.
function AdvanceNoiseBake(job, speckBudget) {
	const target = Math.min(job.speckCount, job.drawn + speckBudget);
	while (job.drawn < target) {
		job.drawWrapped(Math.random() * job.pixelW, Math.random() * job.pixelH);
		job.drawn++;
	}
	return job.drawn >= job.speckCount;
}

function buildNoiseFaceCanvas(blueprint, pixelW, pixelH, textureScale) {
	const job = BeginNoiseBake(blueprint, pixelW, pixelH, textureScale);
	AdvanceNoiseBake(job, job.speckCount);
	return job.canvas;
}

const completedBake = (canvas) => ({ canvas, speckCount: 0, drawn: 0 });

// Definition -> bake job. Face noise resumes across frames; surface and decal bakes arrive complete.
function BeginTextureBake(definition, textureScale) {
	if (definition.bakeKind === "face")  return BeginNoiseBake(definition, definition.pixelW, definition.pixelH, textureScale);
	if (definition.bakeKind === "decal") return completedBake(compositeShapeDecal(definition.ct, definition.mesh, textureScale));
	return completedBake(buildTextureSurface(definition, definition.size, textureScale));
}

function BuildNoiseAnimationOptions(blueprint, textureDetail) {
	if (!blueprint.animation.able || textureDetail.animated !== true) return null;
	return {
		holdTime      : blueprint.animation.holdTime,
		blendTime     : blueprint.animation.blendTime,
		holdTimeSpeed : textureDetail.holdTimeSpeed,
		blendTimeSpeed: textureDetail.blendTimeSpeed,
	};
}

// Memoization gate.
function getOrBuildFaceTexture(store, id, buildFn) {
	const existing = store[id];
	if (existing !== undefined) return existing;
	const entry = buildFn();
	store[id] = entry;
	return entry;
}

// Content signature; ::face= marker is read by Render.js CLAMP_TO_EDGE.
function buildFaceTextureSignature(baseTextureID, resolvedBlueprint, pixelW, pixelH, textureScale, animationOptions) {
	const colorKey = `${formatColorKey(resolvedBlueprint.primary)}|${formatColorKey(resolvedBlueprint.secondary)}|${resolvedBlueprint.shape}|${resolvedBlueprint.compositeMode}`;
	const shapeKey = `d=${resolvedBlueprint.density}|s=${resolvedBlueprint.speckSize}`;
	const sizeKey  = `${pixelW}x${pixelH}`;
	const scaleKey = `ts=${textureScale}`;
	const animKey  = animationOptions
		? `anim=1:${animationOptions.holdTime}:${animationOptions.blendTime}:${animationOptions.holdTimeSpeed}:${animationOptions.blendTimeSpeed}`
		: "anim=0";
	return `${baseTextureID}::face=noise::${colorKey}::${shapeKey}::${sizeKey}::${scaleKey}::${animKey}`;
}

function BuildFaceTextureData(store, textureID, resolvedBlueprint, faceGroupData, faceSpans, textureScale, animationOptions = null) {
	const faceTextureGroups = [];
	for (let i = 0; i < faceGroupData.length; i++) {
		const group  = faceGroupData[i];
		const pixelW = Math.max(1, Math.round(faceSpans[i].uSpan * textureScale));
		const pixelH = Math.max(1, Math.round(faceSpans[i].vSpan * textureScale));
		const faceID = buildFaceTextureSignature(textureID, resolvedBlueprint, pixelW, pixelH, textureScale, animationOptions);
		getOrBuildFaceTexture(store, faceID, () => {
			const canvas = buildNoiseFaceCanvas(resolvedBlueprint, pixelW, pixelH, textureScale);
			const definition = animationOptions ? {
				...resolvedBlueprint,
				holdTimeSpeed : animationOptions.holdTimeSpeed,
				blendTimeSpeed: animationOptions.blendTimeSpeed,
				animation     : { able: true, holdTime: animationOptions.holdTime, blendTime: animationOptions.blendTime },
				bakeKind      : "face",
				pixelW, pixelH,
			} : null;
			return { id: faceID, source: canvas, definition };
		});
		faceTextureGroups.push({ indexStart: group.indexStart, indexCount: group.indexCount, textureID: faceID });
	}
	return { faceTextureGroups };
}

export { 
	PrepareLevelVisualResources, 
	AddToVisualResources, 
	BeginTextureBake, 
	AdvanceNoiseBake, 
	BuildFaceTextureData, 
	ResolveNoiseFaceBlueprint, 
	BuildNoiseAnimationOptions, 
	FREQUENCY_PATTERN_CONFIG, 
	VISUAL_TEMPLATES, 
	ComputeGeneratedTextureID, 
	ComputeCustomTextureSignature, 
	IsTextureTransparent, 
	InitializeDecalDisplay 
};