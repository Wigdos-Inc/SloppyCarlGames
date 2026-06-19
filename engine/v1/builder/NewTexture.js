// Create 2D textures (like grass or pebbles) to populate the world with.

// Used by NewObject.js to apply 2D and/or 3D textures to model parts.
// Uses NewObject.js to build simple 3D textures (like grass, pebbles, etc)

import visualTemplates from "./templates/textures.json" with { type: "json" };
import { CONFIG } from "../core/config.js";
import { Log, ENTITY_TYPES } from "../core/meta.js";

function parseHexColor(hex) {
	// Builders assume templates are canonicalized upstream; minimal parsing only.
	const value = (hex).replace("#", "").trim();
	const r = Number.parseInt(value.slice(0, 2), 16);
	const g = Number.parseInt(value.slice(2, 4), 16);
	const b = Number.parseInt(value.slice(4, 6), 16);
	return `rgb(${r}, ${g}, ${b})`;
}


// Frequency patterns decouple spatial frequency (UVs on meshes, periods on decals) from the
// canvas appearance. Maps each pattern to its CONFIG.RENDERING.Texture block. Non-frequency
// patterns (noise, radial) are absent — a lookup miss means "not a frequency pattern".
const frequencyPatternConfig = {
	tiles  : "Tiles",
	stripes: "Stripes",
	grid   : "Grid",
};

function drawShape(ctx, shape, x, y, width, height) {
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
}

function drawPattern(ctx, size, textureDefinition, textureScale, periods = 1) {
	const primary = parseHexColor(textureDefinition.primary);
	const secondary = parseHexColor(textureDefinition.secondary);
    const draw = (x, y, width, height) => drawShape(ctx, textureDefinition.shape, x, y, width, height);

    ctx.fillStyle = primary;
    ctx.fillRect(0, 0, size, size);

	switch (textureDefinition.pattern) {
		case "tiles": {
			const cfg       = CONFIG.RENDERING.Texture.Tiles;
			const cellCount = periods;
			if (cellCount === 0) return;
			const cellSize  = size / cellCount;
			const blockSize = Math.max(1, Math.floor(cellSize * textureDefinition.speckSize * cfg.SpeckSize));
			ctx.fillStyle = secondary;
			for (let xi = 0; xi < cellCount; xi++) for (let yi = 0; yi < cellCount; yi++) {
				ctx.fillRect(Math.round(xi * cellSize), Math.round(yi * cellSize), blockSize, blockSize);
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
			for (let yi = 0; yi < stripeCount; yi++) ctx.fillRect(0, Math.round(yi * pitch), size, offStripeWidth);
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
			const cfg           = CONFIG.RENDERING.Texture.Grid;
			const pairsPerRow   = periods;
			if (pairsPerRow === 0) return;
			const pairSize      = size / pairsPerRow;
			const effSpeckSize  = textureDefinition.speckSize * cfg.SpeckSize;
			const offBlockSize  = Math.max(1, Math.floor(pairSize * effSpeckSize / (1 + effSpeckSize)));
			const baseBlockSize = Math.max(1, Math.floor(pairSize - offBlockSize));
			ctx.fillStyle = secondary;
			let y = 0;
			for (let row = 0; y < size; row++) {
				const rowH = row % 2 === 0 ? baseBlockSize : offBlockSize;
				let x = 0;
				for (let col = 0; x < size; col++) {
					const colW = col % 2 === 0 ? baseBlockSize : offBlockSize;
					if ((row + col) % 2 === 0) ctx.fillRect(x, Math.round(y), colW, rowH);
					x += colW;
				}
				y += rowH;
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

function BuildTextureSurface(textureDefinition, resolvedSize, textureScale, periods = 1) {
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
		holdTimeSpeed: 1, blendTimeSpeed: 1, baseTextureID, shape: null,
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
	entry.animatedRequested = options.animatedRequested;
	entry.holdTimeSpeed = options.holdTimeSpeed;
	entry.blendTimeSpeed = options.blendTimeSpeed;
}

// Map a full texture definition to registerTextureUsage options. Shared by mesh and scatter-batch
// collection so the field mapping (and the animated coercion) lives in one place.
function textureRegistrationOptions(texture, isTerrain, maxSpan) {
	return {
		isTerrain, maxSpan,
		density          : texture.density,
		speckSize        : texture.speckSize,
		baseTextureID    : texture.id,
		shape            : texture.shape,
		animatedRequested: texture.animated === true,
		holdTimeSpeed    : texture.holdTimeSpeed,
		blendTimeSpeed   : texture.blendTimeSpeed,
	};
}

function collectMesh(mesh, options, ownerKey, usage, customTextureUsage) {
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

	// Include any water visual meshes so their textures are registered as well.
	if (sceneGraph.waterVisual) {
		const waterMeshes = [];
		if (sceneGraph.waterVisual.body) waterMeshes.push(sceneGraph.waterVisual.body);
		if (sceneGraph.waterVisual.top) waterMeshes.push(sceneGraph.waterVisual.top);
		waterMeshes.forEach((mesh) => collectMesh(mesh, nonTerrainOptions, mesh.id, usage, customTextureUsage));
	}

	// Collect texture IDs from instanced scatter batches.
	sceneGraph.scatterBatches.forEach((batch) => {
		registerTextureUsage(batch.textureID, textureRegistrationOptions(batch.texture, false, 1), usage);
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

// Adding a shape: add its method here AND in normalize.js shapeRequiredFields AND in
// canonSchemas.json levelCustomTexture.shape.allowedValues.
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

function compositeShapeDecal(ct, mesh, textureScale) {
	const size = 256;
	const canvas = document.createElement("canvas");
	canvas.width = size; canvas.height = size;
	const ctx = canvas.getContext("2d");

	ctx.fillStyle = ct.mutable
		? "rgba(255, 255, 255, 1)"
		: `rgba(${Math.round(ct.color.r * 255)}, ${Math.round(ct.color.g * 255)}, ${Math.round(ct.color.b * 255)}, ${ct.color.a})`;
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

		const partBlueprint     = visualTemplates.textures[mesh.detail.texture.id];
		const partEffDensity   = mesh.detail.texture.density;
		const partEffSpeckSize = mesh.detail.texture.speckSize;

		const decalBlueprint    = visualTemplates.textures[ct.detail.baseTextureID];
		const resolvedBlueprint = {
			...decalBlueprint,
			density:   partEffDensity   * ct.detail.density,
			speckSize: partEffSpeckSize * ct.detail.speckSize,
		};
		const effectiveScale = autoRatio > 0 ? textureScale / autoRatio : textureScale;

		// Frequency patterns stamp a fixed element count onto the decal (no tiling), so the
		// canvas must draw round(density × cfg.Density) periods directly. Non-frequency decals
		// (noise/radial) ignore periods, so the default of 1 is harmless.
		const decalConfigKey = frequencyPatternConfig[resolvedBlueprint.pattern];
		const periods = decalConfigKey ? Math.round(resolvedBlueprint.density * CONFIG.RENDERING.Texture[decalConfigKey].Density) : 1;

		ctx.globalCompositeOperation = "source-atop";
		ctx.drawImage(BuildTextureSurface(resolvedBlueprint, toPowerOfTwoSize(decalBlueprint.size), effectiveScale, periods), 0, 0, size, size);
		ctx.globalCompositeOperation = "source-over";
	}

	return canvas;
}

function createTextureRegistry(usage, customTextureUsage, options) {
	const registry = {};
	for (const textureID in usage) {
		const usageEntry = usage[textureID];
		const textureBlueprint = visualTemplates.textures[usageEntry.baseTextureID];
		const resolvedSize = resolveTextureSize(textureBlueprint, usageEntry);
		// Payload scalars modify rather than override: compose blueprint (internal) × payload.
		// The global scalar is applied later in drawPattern.
		// Frequency patterns (tiles/stripes/grid) carry spatial frequency in their per-mesh UVs,
		// so density is NOT baked into the shared registry canvas — only the speckSize ratio is.
		// Noise still bakes density into its canvas.
		const isFrequencyPattern = frequencyPatternConfig[textureBlueprint.pattern] !== undefined;
		let resolvedTextureBlueprint = {
			...textureBlueprint,
			density:   isFrequencyPattern ? textureBlueprint.density : textureBlueprint.density * usageEntry.density,
			speckSize: textureBlueprint.speckSize * usageEntry.speckSize,
		};
		if (usageEntry.shape) resolvedTextureBlueprint = { ...resolvedTextureBlueprint, shape: usageEntry.shape };

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
				size: resolvedSize,
				holdTimeSpeed: usageEntry.holdTimeSpeed,
				blendTimeSpeed: usageEntry.blendTimeSpeed,
				animation: {
					able: animatedRequested && templateSupportsAnimation,
					holdTime: textureBlueprint.animation.holdTime,
					blendTime: textureBlueprint.animation.blendTime,
				},
			},
			source: BuildTextureSurface(resolvedTextureBlueprint, resolvedSize, options.textureScale),
			dirty: false,
		};
	};

	for (const id in customTextureUsage) {
		const cu = customTextureUsage[id];
		const source = cu.decalType === "image" ? cu.bitmap : compositeShapeDecal(cu.ct, cu.mesh, options.textureScale);
		registry[id] = { id, source, placement: cu.placement, dirty: false };
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

	for (const { id, source, definition } of sceneGraph.pendingFaceTextures) {
		textureRegistry[id] = { id, definition, source, dirty: false };
	}
	sceneGraph.pendingFaceTextures = [];

	sceneGraph.visualResources = {
		textureRegistry,
		scatterRegistry: visualTemplates.scatterTypes,
		primitiveGeometry: sceneGraph.scatterPrimitiveGeometry,
	};

	Log(
		"ENGINE",
		`Visual resources ready: textures=${Object.keys(textureRegistry).length}, scatterTypes=${Object.keys(visualTemplates.scatterTypes).length}`,
		"log",
		"Level"
	);

	return sceneGraph;
}

function BuildNoiseFaceCanvas(blueprint, pixelW, pixelH, textureScale) {
	const canvas = document.createElement("canvas");
	canvas.width  = pixelW;
	canvas.height = pixelH;
	const ctx = canvas.getContext("2d");

	const primary   = parseHexColor(blueprint.primary);
	const secondary = parseHexColor(blueprint.secondary);
	const draw = (x, y, width, height) => drawShape(ctx, blueprint.shape, x, y, width, height);

	ctx.fillStyle = primary;
	ctx.fillRect(0, 0, pixelW, pixelH);

	const effSpeckSize = blueprint.speckSize * CONFIG.RENDERING.Texture.Noise.SpeckSize;
	const effDensity   = blueprint.density   * CONFIG.RENDERING.Texture.Noise.Density;
	const speck = Math.max(1, Math.floor(effSpeckSize * textureScale));
	const speckCount = Math.min(16000, Math.floor((pixelW * pixelH * effDensity) / (speck * speck)));

	const drawWrapped = (x, y) => {
		draw(x, y, speck, speck);
		const wrapX = x + speck > pixelW;
		const wrapY = y + speck > pixelH;
		if (wrapX)          draw(x - pixelW, y,         speck, speck);
		if (wrapY)          draw(x,          y - pixelH, speck, speck);
		if (wrapX && wrapY) draw(x - pixelW, y - pixelH, speck, speck);
	};

	ctx.fillStyle = secondary;
	for (let index = 0; index < speckCount; index++) {
		drawWrapped(Math.random() * pixelW, Math.random() * pixelH);
	}

	return canvas;
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

function BuildFaceTextureData(textureID, ownerId, ownerKind, resolvedBlueprint, faceGroupData, faceSpans, textureScale, animationOptions = null) {
	const faceTextures      = [];
	const faceTextureGroups = [];
	for (let i = 0; i < faceGroupData.length; i++) {
		const group  = faceGroupData[i];
		const pixelW = Math.max(1, Math.round(faceSpans[i].uSpan * textureScale));
		const pixelH = Math.max(1, Math.round(faceSpans[i].vSpan * textureScale));
		const faceID = `${textureID}::face=${i}::${ownerKind}=${ownerId}`;
		const canvas = BuildNoiseFaceCanvas(resolvedBlueprint, pixelW, pixelH, textureScale);
		const definition = animationOptions ? {
			...resolvedBlueprint,
			holdTimeSpeed : animationOptions.holdTimeSpeed,
			blendTimeSpeed: animationOptions.blendTimeSpeed,
			animation     : { able: true, holdTime: animationOptions.holdTime, blendTime: animationOptions.blendTime },
			isFaceTexture : true,
			pixelW,
			pixelH,
		} : null;
		faceTextures.push({ id: faceID, source: canvas, definition });
		faceTextureGroups.push({ indexStart: group.indexStart, indexCount: group.indexCount, textureID: faceID });
	}
	return { faceTextures, faceTextureGroups };
}

export { PrepareLevelVisualResources, BuildTextureSurface, AddToVisualResources, BuildNoiseFaceCanvas, BuildFaceTextureData, BuildNoiseAnimationOptions, frequencyPatternConfig, visualTemplates as VISUAL_TEMPLATES };