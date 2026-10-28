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

// Format a color for cache keys (raw would print as [object object]).
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

// Set up each decal's render state and texture key.
function InitializeDecalDisplay(customTextures, dimensions) {
	customTextures.forEach((decal) => {
		decal.displayTransform = decal.localTransform;
		decal.displayColor = null;
		decal.activeSourceKey = null;

		// Key by content and face size. Identical decals share a texture and different ones never collide.
		decal.textureKey = `decal::customTexture::${formatCustomTextureEntry(decal)}::${decalFaceSize(dimensions, decal.side)}`;
	});
}

function IsTextureTransparent(generatedTexture) {
	return (generatedTexture.primary !== null && generatedTexture.primary.a < 1)
		|| (generatedTexture.secondary !== null && generatedTexture.secondary.a < 1);
}

const formatDecalTransform = (t) => `${t.position.x},${t.position.y},${t.position.z}|${t.rotation.value}|${t.scale.x},${t.scale.y},${t.scale.z}`;

// Key a decal's texture by how it looks, plus its animation settings.
const formatDecalTexture = (t) => `${ComputeGeneratedTextureID(t)}|${t.animated}|${t.holdTimeSpeed}|${t.blendTimeSpeed}`;

function formatDecalSource(src) {
	return src.decalType === "image" ? `image|${src.imagePath}|${src.sourceType}` : `shape|${src.shape}|${formatDecalTexture(src.texture)}`;
}

function formatCustomTextureEntry(ct) {
	const base = `${ct.decalType}|${ct.side}|${formatDecalTransform(ct.localTransform)}`;
	if (ct.decalType === "image") return `${base}|img=${ct.imagePath}|op=${ct.opacity}`;
	const sourcesKey = ct.sources === null ? "n" : Object.keys(ct.sources).sort().map((key) => `${key}=${formatDecalSource(ct.sources[key])}`).join(",");
	return `${base}|${ct.shape}|m=${ct.mutable}|${formatDecalTexture(ct.texture)}|src=${sourcesKey}`;
}

// Measure the longest edge of the face a decal sits on.
function decalFaceSize(dimensions, side) {
	const faceSizes = {
		front: [dimensions.x, dimensions.y], back:   [dimensions.x, dimensions.y],
		top:   [dimensions.x, dimensions.z], bottom: [dimensions.x, dimensions.z],
		right: [dimensions.z, dimensions.y], left:   [dimensions.z, dimensions.y],
	};
	return Math.max(...faceSizes[side]);
}

// Prevent scatter with differing decals from sharing a scatter batch.
function ComputeCustomTextureSignature(customTextures) {
	return customTextures.length === 0 ? "none" : customTextures.map(formatCustomTextureEntry).join(";;");
}

// Map frequency patterns to CONFIG.Rendering.Texture blocks (absent = not a frequency pattern).
const FREQUENCY_PATTERN_CONFIG = {
	tiles  : "Tiles",
	stripes: "Stripes",
	grid   : "Grid",
};

// Draw a shape. 
// Note: When it replaces the color below, clear that area first so a see-through color doesn't mix with it.
function fillReplacing(ctx, replace, drawFn) {
	if (!replace) return drawFn();

	// Cut the shape out of the canvas, then paint it normally.
	const paintStyle = ctx.fillStyle;
	ctx.globalCompositeOperation = "destination-out";
	ctx.fillStyle = "#000";
	drawFn();
	ctx.globalCompositeOperation = "source-over";
	ctx.fillStyle = paintStyle;
	drawFn();
}

// null = derive from alpha (legacy default).
const resolveReplace = (def) => def.compositeMode !== null ? def.compositeMode === "replace" : def.secondary.a < 1;

function drawShape(ctx, shape, replace, x, y, width, height) {
	fillReplacing(ctx, replace, () => {
		switch (shape) {
			case "circle": {
				ctx.beginPath();
				ctx.ellipse(
					x + width  * 0.5,
					y + height * 0.5,
					Math.max(0.5, width  * 0.5),
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
	const primary   = rgbaToCss(textureDefinition.primary);
	const secondary = rgbaToCss(textureDefinition.secondary);
	const replace   = resolveReplace(textureDefinition);
    const draw = (x, y, width, height) => drawShape(ctx, textureDefinition.shape, replace, x, y, width, height);

    ctx.fillStyle = primary;
    ctx.fillRect(0, 0, size, size);

	switch (textureDefinition.pattern) {
		case "tiles": {
			if (periods === 0) return;

			const cellSize  = size / periods;
			const blockSize = Math.max(1, Math.floor(cellSize * textureDefinition.speckSize * CONFIG.Rendering.Texture.Tiles.SpeckSize));
			const inset     = (cellSize - blockSize) * 0.5;
			ctx.fillStyle   = secondary;
			for (let xi = 0; xi < periods; xi++) for (let yi = 0; yi < periods; yi++) {
				fillReplacing(ctx, replace, () => ctx.fillRect(Math.round(xi * cellSize + inset), Math.round(yi * cellSize + inset), blockSize, blockSize));
			}
			return;
		}
		case "stripes": {
			if (periods === 0) return;

			const pitch          = size / periods;
			const effSpeckSize   = textureDefinition.speckSize * CONFIG.Rendering.Texture.Stripes.SpeckSize;
			const offStripeWidth = Math.max(1, Math.floor(pitch * effSpeckSize / (1 + effSpeckSize)));
			ctx.fillStyle = secondary;
			for (let yi = 0; yi < periods; yi++) fillReplacing(ctx, replace, () => ctx.fillRect(0, Math.round(yi * pitch), size, offStripeWidth));
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
		// Note: Raw UVs repeat, so the gradient's two ends are matched to hide the seam.
		case "linear": {
			const mid = rgbaToCss({
				r: (textureDefinition.primary.r + textureDefinition.secondary.r) * 0.5,
				g: (textureDefinition.primary.g + textureDefinition.secondary.g) * 0.5,
				b: (textureDefinition.primary.b + textureDefinition.secondary.b) * 0.5,
				a: (textureDefinition.primary.a + textureDefinition.secondary.a) * 0.5,
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
			const speck = Math.max(1, Math.floor(textureDefinition.speckSize * CONFIG.Rendering.Texture.Noise.SpeckSize * textureScale));
			const speckCount = Math.min(16000, Math.floor((size**2 * textureDefinition.density   * CONFIG.Rendering.Texture.Noise.Density) / (speck**2)));
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
			if (periods === 0) return;

			const cell      = size / (periods * 2);
			const blockSize = Math.max(1, Math.round(cell * (textureDefinition.speckSize * CONFIG.Rendering.Texture.Grid.SpeckSize)));
			const drawWrapped = (cx, cy) => {
				const x0 = cx - blockSize * 0.5;
				const y0 = cy - blockSize * 0.5;
				for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
					const x = x0 + dx, y = y0 + dy;
					if (x + blockSize <= 0 || x >= size || y + blockSize <= 0 || y >= size) continue;
					fillReplacing(ctx, replace, () => ctx.fillRect(Math.round(x), Math.round(y), blockSize, blockSize));
				}
			};
			ctx.fillStyle = secondary;
			const cellsTotal = periods * 2;
			for (let j = 0; j < cellsTotal; j++) for (let i = 0; i < cellsTotal; i++) {
				if ((i + j) % 2 !== 0) continue;
				drawWrapped((i + 0.5) * cell, (j + 0.5) * cell);
			}
			return;
		}
		case "flat":
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
	return toPowerOfTwoSize(textureDefinition.size * (usageEntry.isTerrain !== true ? 1 : Math.max(1, Math.min(8, usageEntry.maxSpan / 24))));
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
	if (options.isTerrain) {
		entry.isTerrain = true;
		entry.maxSpan = options.maxSpan;
	}
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

// Gather the settings that decide how a texture is baked, for a mesh or a scatter batch.
function textureRegistrationOptions(texture, isTerrain, maxSpan) {
	const { density, speckSize, shape, compositeMode, holdTimeSpeed, blendTimeSpeed } = texture;
	return {
		isTerrain, maxSpan, density, speckSize,
		baseTextureID    : texture.id,
		shape, compositeMode,
		animatedRequested: texture.animated === true,
		holdTimeSpeed, blendTimeSpeed,
		primaryOverride  : texture.primary,
		secondaryOverride: texture.secondary,
	};
}

function collectMesh(mesh, options, ownerKey, usage, customTextureUsage) {
	// Skip meshes textured per face. Their face textures were already built with the mesh.
	if (mesh.geometry.faceTextureGroups) return;

	// Use a sprite's image as it is, stored the same way as an image decal.
	if (mesh.material.textureID.startsWith("sprite::")) {
		const { bitmap } = mesh.sprite.image;
		customTextureUsage[mesh.material.textureID] = { decalType: "image", bitmap, opacity: 1, placement: null };
		return;
	}

	let materialTextureID = mesh.material.textureID;
	if (mesh.detail.texture.animated === true) {
		materialTextureID = `${mesh.material.textureID}::animated=${ownerKey}`;
		mesh.material.textureID = materialTextureID;
	}
	registerTextureUsage(materialTextureID, textureRegistrationOptions(mesh.detail.texture, options.isTerrain, options.maxSpan), usage);
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
					shape: src.shape, texture: src.texture,
					localTransform: { scale: ct.localTransform.scale }, side: ct.side, mutable: false,
				},
				mesh, placement,
			};
		}
	}
}

function collectCustomTextures(mesh, customTextureUsage) {
	mesh.customTextures.forEach((ct) => {
		const id = ct.textureKey;
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

// Visit every textured mesh with its kind: terrain, plain (no decals) or detailed (decals).
function ForEachTexturedMesh(sceneGraph, visit) {
	sceneGraph.terrain.forEach((mesh)  => { 
		if (mesh.meta.mode === "default") visit(mesh, "terrain"); 
	});
	sceneGraph.triggers.forEach((mesh) => visit(mesh, "plain"));
	sceneGraph.scatter.forEach((mesh)  => visit(mesh, "plain"));
	sceneGraph.obstacles.forEach((obstacle) => {
		if (obstacle.mode !== "default") return;
		obstacle.parts.forEach((part) => visit(part, "detailed"));
	});
	sceneGraph.entities.forEach((entity) => entity.model.parts.forEach((part) => visit(part.mesh, "detailed")));

	if (sceneGraph.waterVisual) {
		if (sceneGraph.waterVisual.body) visit(sceneGraph.waterVisual.body, "plain");
		if (sceneGraph.waterVisual.top) visit(sceneGraph.waterVisual.top, "plain");
	}
}

// Measure the widest side a terrain texture covers. An upright plane's second side is its height.
function terrainSpan({ shape, dimensions, transform }) {
	const depth = shape === "plane" ? dimensions.y * transform.scale.y : dimensions.z * transform.scale.z;
	return Math.max(dimensions.x * transform.scale.x, depth);
}

function collectTextureUsage(sceneGraph) {
	const usage = { "default-tiles": createUsageEntry("default-tiles") };
	const customTextureUsage = {};
	const nonTerrainOptions = { isTerrain: false, maxSpan: 1 };

	ForEachTexturedMesh(sceneGraph, (mesh, kind) => {
		const options = kind === "terrain"
			? { isTerrain: true, maxSpan: terrainSpan(mesh) }
			: nonTerrainOptions;
		collectMesh(mesh, options, mesh.id, usage, customTextureUsage);
		if (kind !== "plain") collectCustomTextures(mesh, customTextureUsage);
	});

	// Collect texture IDs from scatter batches. Decals bake once per distinct decal, not per instance.
	sceneGraph.scatterBatches.forEach((batch) => {
		registerTextureUsage(batch.textureID, textureRegistrationOptions(batch.texture, false, 1), usage);
		if (batch.customTextures.length > 0) {
			collectCustomTextures(
				{ customTextures: batch.customTextures, dimensions: batch.dimensions },
				customTextureUsage
			);
		}
	});

	// Collect the walls lining each void, which the walk above skips. They reuse their host's texture and never change how it tiles.
	const collectVoidWalls = (voidRecords) => voidRecords.forEach((record) => {
		for (const hostId in record.relations) {
			record.relations[hostId].voidWallMeshes.forEach((mesh) => collectMesh(mesh, nonTerrainOptions, mesh.id, usage, customTextureUsage));
		}
	});
	collectVoidWalls(sceneGraph.voids.terrain);
	collectVoidWalls(sceneGraph.voids.obstacles);

	return { usage, customTextureUsage };
}

function AddToVisualResources(built, objectType, sceneGraph) {
	const usage = {}, customTextureUsage = {};
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
		collectMesh(built, { isTerrain: true, maxSpan: terrainSpan(built) }, built.id, usage, customTextureUsage);
		collectCustomTextures(built, customTextureUsage);
	}

	const newEntries = createTextureRegistry(usage, customTextureUsage, { textureScale: sceneGraph.world.textureScale });
	for (const id in newEntries) {
		if (!sceneGraph.visualResources.textureRegistry[id]) sceneGraph.visualResources.textureRegistry[id] = newEntries[id];
	}
}

function createMaskCanvas(w, h) {
	const canvas = document.createElement("canvas");
	canvas.width = w; canvas.height = h;
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "white";
	return { canvas, ctx };
}

// Note: When adding a shape, also add it in normalize.js (shapeRequiredFields) and canonSchemas.json (allowedValues).
const shapeMaskBuilders = {
	square: (w, h) => {
		const { canvas, ctx } = createMaskCanvas(w, h);
		ctx.fillRect(0, 0, w, h);
		return canvas;
	},
	circle: (w, h) => {
		const { canvas, ctx } = createMaskCanvas(w, h);
		ctx.beginPath();
		ctx.ellipse(w * 0.5, h * 0.5, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
		ctx.fill();
		return canvas;
	},
	triangle: (w, h) => {
		const { canvas, ctx } = createMaskCanvas(w, h);
		ctx.beginPath();
		ctx.moveTo(w * 0.5, 0);
		ctx.lineTo(w, h);
		ctx.lineTo(0, h);
		ctx.closePath();
		ctx.fill();
		return canvas;
	},
	pill: (w, h, aspect) => {
		const { canvas, ctx } = createMaskCanvas(w, h);
		const wide = aspect >= 1;
		const rx = wide ? w / (2 * aspect) : w * 0.5;
		const ry = wide ? h * 0.5 : h * aspect * 0.5;
		(wide ? [[rx, h * 0.5], [w - rx, h * 0.5]] : [[w * 0.5, ry], [w * 0.5, h - ry]]).forEach(([cx, cy]) => {
			ctx.beginPath();
			ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
			ctx.fill();
		});
		if (wide) ctx.fillRect(rx, 0, w - 2 * rx, h);
		else ctx.fillRect(0, ry, w, h - 2 * ry);
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

// Bake a shape decal into its own canvas.
function compositeShapeDecal(ct, mesh, textureScale) {
	const size = 256;
	const canvas = document.createElement("canvas");
	canvas.width = size; canvas.height = size;
	const ctx = canvas.getContext("2d");

	const partFaceSize  = decalFaceSize(mesh.dimensions, ct.side);
	const autoRatio     = partFaceSize > 0 ? Math.max(ct.localTransform.scale.x, ct.localTransform.scale.y) / partFaceSize : 1;

	// Note: Leave the colors out of a mutable decal. The GPU tints it, and baking them in too would apply them twice.
	const overrides = ct.mutable ? { ...ct.texture, primary: null, secondary: null } : ct.texture;
	const decalBlueprint = VISUAL_TEMPLATES.textures[ct.texture.id];
	const resolvedBlueprint = ResolveTextureBlueprint(decalBlueprint, overrides);
	const effectiveScale = autoRatio > 0 ? textureScale / autoRatio : textureScale;

	// Count how often tiles, stripes and grids repeat across the decal. Other patterns ignore it.
	const decalConfigKey = FREQUENCY_PATTERN_CONFIG[resolvedBlueprint.pattern];
	const periods = decalConfigKey ? Math.round(resolvedBlueprint.density * CONFIG.Rendering.Texture[decalConfigKey].Density) : 1;

	// Paint the pattern, then cut away everything outside the decal's shape.
	ctx.drawImage(buildTextureSurface(resolvedBlueprint, toPowerOfTwoSize(decalBlueprint.size), effectiveScale, periods), 0, 0, size, size);
	ctx.globalCompositeOperation = "destination-in";
	
	// Keep the shape's round ends round when the decal is stretched.
	ctx.drawImage(shapeMaskBuilders[ct.shape](size, size, ct.localTransform.scale.x / ct.localTransform.scale.y), 0, 0);
	ctx.globalCompositeOperation = "source-over";

	return canvas;
}

// Describe how a shape decal animates, when it asks to and its texture can.
function decalAnimationDefinition(cu) {
	if (cu.decalType !== "shape")        return null;
	if (cu.ct.texture.animated !== true) return null;

	const blueprint = VISUAL_TEMPLATES.textures[cu.ct.texture.id];
	if (blueprint.animation.able !== true) return null;

	return {
		bakeKind      : "decal",
		ct            : cu.ct,
		mesh          : cu.mesh,
		holdTimeSpeed : cu.ct.texture.holdTimeSpeed,
		blendTimeSpeed: cu.ct.texture.blendTimeSpeed,
		animation     : { able: true, holdTime: blueprint.animation.holdTime, blendTime: blueprint.animation.blendTime },
	};
}

function createTextureRegistry(usage, customTextureUsage, options) {
	const registry = {};
	for (const textureID in usage) {
		const usageEntry = usage[textureID];
		const textureBlueprint = VISUAL_TEMPLATES.textures[usageEntry.baseTextureID];
		const resolvedSize = resolveTextureSize(textureBlueprint, usageEntry);
		
		// Bake density into noise only. Repeating patterns (tiles, stripes, grids) take it from each mesh's texture coordinates.
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

	// Add the face textures built during the level build.
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

// Merge a preset with per-mesh or per-decal values and overrides (null = no override).
function ResolveTextureBlueprint(textureBlueprint, textureDetail) {
	return {
		...textureBlueprint,
		density  : textureBlueprint.density    * textureDetail.density,
		speckSize: textureBlueprint.speckSize  * textureDetail.speckSize,
		shape        : textureDetail.shape !== null ? textureDetail.shape : textureBlueprint.shape,
		compositeMode: textureDetail.compositeMode !== null ? textureDetail.compositeMode : textureBlueprint.compositeMode,
		...(textureDetail.primary   !== null && { primary:   textureDetail.primary   }),
		...(textureDetail.secondary !== null && { secondary: textureDetail.secondary }),
	};
}

// Paint the base fill and return a resumable speck job.
function BeginNoiseBake(blueprint, pixelW, pixelH, textureScale) {
	const canvas = document.createElement("canvas");
	canvas.width  = pixelW;
	canvas.height = pixelH;
	const ctx = canvas.getContext("2d");

	const replace = resolveReplace(blueprint);
	const draw = (x, y, width, height) => drawShape(ctx, blueprint.shape, replace, x, y, width, height);

	ctx.fillStyle = rgbaToCss(blueprint.primary);
	ctx.fillRect(0, 0, pixelW, pixelH);

	const speck = Math.max(1, Math.floor((blueprint.speckSize * CONFIG.Rendering.Texture.Noise.SpeckSize) * textureScale));
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
		speckCount: Math.floor((pixelW * pixelH * (blueprint.density   * CONFIG.Rendering.Texture.Noise.Density)) / (speck**2)),
		drawn     : 0,
	};
}

// Continue a noise texture's bake by scattering its next batch of specks.
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

// Turn a definition into a bake job. Face noise resumes across frames, while surface and decal bakes arrive complete.
function BeginTextureBake(definition, textureScale) {
	switch (definition.bakeKind) {
		case "face" : return BeginNoiseBake(definition, definition.pixelW, definition.pixelH, textureScale);
		case "decal": return completedBake(compositeShapeDecal(definition.ct, definition.mesh, textureScale));
		default     : return completedBake(buildTextureSurface(definition, definition.size, textureScale));
	}
}

function BuildNoiseAnimationOptions(blueprint, textureDetail) {
	if (!blueprint.animation.able || textureDetail.animated !== true) return null;
	const { holdTime, blendTime } = blueprint.animation, { holdTimeSpeed, blendTimeSpeed } = textureDetail;
	return { holdTime, blendTime, holdTimeSpeed, blendTimeSpeed };
}

// Build a face texture once, and reuse it for every face with the same ID.
function getOrBuildFaceTexture(store, id, buildFn) {
	if (store[id] !== undefined) return store[id];

	const entry = buildFn();
	store[id] = entry;
	return entry;
}

// Build a face texture's ID from everything that changes its look, tagged as a face texture.
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
			const source = buildNoiseFaceCanvas(resolvedBlueprint, pixelW, pixelH, textureScale);
			const definition = animationOptions ? {
				...resolvedBlueprint,
				holdTimeSpeed : animationOptions.holdTimeSpeed,
				blendTimeSpeed: animationOptions.blendTimeSpeed,
				animation     : { able: true, holdTime: animationOptions.holdTime, blendTime: animationOptions.blendTime },
				bakeKind      : "face",
				pixelW, pixelH,
			} : null;

			return { id: faceID, source, definition };
		});
		faceTextureGroups.push({ indexStart: group.indexStart, indexCount: group.indexCount, textureID: faceID });
	}
	return faceTextureGroups;
}

export {
	PrepareLevelVisualResources,
	AddToVisualResources,
	ForEachTexturedMesh,
	BeginTextureBake,
	AdvanceNoiseBake,
	BuildFaceTextureData, 
	ResolveTextureBlueprint,
	BuildNoiseAnimationOptions, 
	FREQUENCY_PATTERN_CONFIG,
	ComputeGeneratedTextureID,
	ComputeCustomTextureSignature, 
	IsTextureTransparent, 
	InitializeDecalDisplay 
};