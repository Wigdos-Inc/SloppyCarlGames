// Create 2D textures (like grass or pebbles) to populate the world with.

// Used by NewObject.js to apply 2D and/or 3D textures to model parts.
// Uses NewObject.js to build simple 3D textures (like grass, pebbles, etc)

import visualTemplates from "./templates/textures.json" with { type: "json" };
import { Log, ENTITY_TYPES } from "../core/meta.js";

function parseHexColor(hex) {
	// Builders assume templates are canonicalized upstream; minimal parsing only.
	const value = (hex).replace("#", "").trim();
	const r = Number.parseInt(value.slice(0, 2), 16);
	const g = Number.parseInt(value.slice(2, 4), 16);
	const b = Number.parseInt(value.slice(4, 6), 16);
	return `rgb(${r}, ${g}, ${b})`;
}


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
		default: {
			ctx.fillRect(x, y, width, height);
		}
	}
}

function drawPattern(ctx, size, textureDefinition, textureScale) {
	const primary = parseHexColor(textureDefinition.primary);
	const secondary = parseHexColor(textureDefinition.secondary);
	const pattern = textureDefinition.pattern;
    const draw = (x, y, width, height) => drawShape(ctx, textureDefinition.shape, x, y, width, height);

    ctx.fillStyle = primary;
    ctx.fillRect(0, 0, size, size);

	switch (pattern) {
		case "checker": {
			const cell = Math.max(4, Math.floor((size / 8) * textureScale));
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
		case "stripes": {
			const stripe = Math.max(3, Math.floor((size / 10) * textureScale));
			ctx.fillStyle = secondary;
			for (let y = 0; y < size; y += stripe * 2) ctx.fillRect(0, y, size, stripe);
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
			const speck = Math.max(1, Math.floor(textureDefinition.speckSize * textureScale));
			const densityScale = Math.max(0.05, textureScale * textureScale);
			const speckCount = Math.min(16000, Math.max(size * 2, Math.floor((size * size * 0.02 * textureDefinition.density) / densityScale)));
			ctx.fillStyle = secondary;
			for (let index = 0; index < speckCount; index++) {
				const x = Math.floor(Math.random() * (size - speck));
				const y = Math.floor(Math.random() * (size - speck));
				draw(x, y, speck, speck);
			}
			return;
		}
		default: {
			const line = Math.max(2, Math.floor((size / 8) * textureScale));
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
	}
}

function toPowerOfTwoSize(value) {
	let size = 8;
	const target = Math.max(8, Math.min(512, Math.floor(value)));
	while (size < target) size *= 2;
	return size;
}

function resolveTextureSize(textureDefinition, usageEntry) {
	const baseSize = textureDefinition.size;
	if (usageEntry.isTerrain !== true) return toPowerOfTwoSize(baseSize);

	const scaleMultiplier = Math.max(1, Math.min(8, usageEntry.maxSpan / 24));
	return toPowerOfTwoSize(baseSize * scaleMultiplier);
}

function BuildTextureSurface(textureDefinition, resolvedSize, textureScale) {
	const size = resolvedSize || textureDefinition.size;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext("2d");

	drawPattern(context, size, textureDefinition, textureScale);
	return canvas;
}

function createUsageEntry(baseTextureID) {
	return {
		isTerrain        : false,
		maxSpan          : 1,
		density          : null,
		speckSize        : null,
		animatedRequested: false,
		holdTimeSpeed    : 1,
		blendTimeSpeed   : 1,
		baseTextureID    : baseTextureID,
		shape            : null,
	};
}

function registerTextureUsage(id, options, usage) {
	if (!usage[id]) usage[id] = createUsageEntry(id);
	const entry = usage[id];
	if (options.isTerrain) { entry.isTerrain = true; entry.maxSpan = options.maxSpan; }
	if (options.density || options.density === 0) entry.density = options.density;
	if (options.speckSize || options.speckSize === 0) entry.speckSize = options.speckSize;
	if (options.baseTextureID) entry.baseTextureID = options.baseTextureID;
	if (options.shape) entry.shape = options.shape;
	if (options.animatedRequested === true) entry.animatedRequested = true;
	if (options.holdTimeSpeed || options.holdTimeSpeed === 0) entry.holdTimeSpeed = options.holdTimeSpeed;
	if (options.blendTimeSpeed || options.blendTimeSpeed === 0) entry.blendTimeSpeed = options.blendTimeSpeed;
}

function collectMesh(mesh, options, ownerKey, usage, customTextureUsage) {
	let materialTextureID = mesh.material.textureID;
	const animatedRequested = mesh.detail.texture.animated === true;
	if (animatedRequested) {
		materialTextureID = `${mesh.material.textureID}::animated=${ownerKey}`;
		mesh.material.textureID = materialTextureID;
	}
	registerTextureUsage(materialTextureID, {
		isTerrain     : options.isTerrain,
		maxSpan       : options.maxSpan,
		density       : mesh.detail.texture.density,
		speckSize     : mesh.detail.texture.speckSize,
		baseTextureID : mesh.detail.texture.baseTextureID,
		shape         : mesh.detail.texture.shape,
		animatedRequested,
		holdTimeSpeed : mesh.detail.texture.holdTimeSpeed,
		blendTimeSpeed: mesh.detail.texture.blendTimeSpeed,
	}, usage);
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
				decalType: "shape",
				ct,
				mesh,
				placement: { side: ct.side, localTransform: ct.localTransform },
			};
		}
		collectDecalAlternateSources(id, ct, mesh, customTextureUsage);
	});
}

function collectTextureUsage(sceneGraph) {
	const usage = { "default-grid": createUsageEntry("default-grid") };
	const customTextureUsage = {};
	const nonTerrainOptions = { isTerrain: false, maxSpan: 1 };

	sceneGraph.terrain.forEach((mesh) => {
		const span = Math.max(mesh.dimensions.x * mesh.transform.scale.x, mesh.dimensions.z * mesh.transform.scale.z);
		collectMesh(mesh, { isTerrain: true, maxSpan: span }, mesh.id, usage, customTextureUsage);
		collectCustomTextures(mesh, customTextureUsage);
	});

	sceneGraph.triggers.forEach((mesh) => collectMesh(mesh, nonTerrainOptions, mesh.id, usage, customTextureUsage));
	sceneGraph.scatter.forEach((mesh) => collectMesh(mesh, nonTerrainOptions, mesh.id, usage, customTextureUsage));
	sceneGraph.obstacles.forEach((obstacle) => {
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
		registerTextureUsage(batch.textureID, {
			isTerrain      : false,
			maxSpan        : 1,
			density        : null,
			speckSize      : null,
			baseTextureID  : batch.textureID,
			shape          : null,
			animatedRequested: false,
			holdTimeSpeed  : 1,
			blendTimeSpeed : 1,
		}, usage);
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
		const sc    = ct.localTransform.scale;
		const dim   = mesh.dimensions;
		const faceSizes = {
			front: [dim.x, dim.y], back:   [dim.x, dim.y],
			top:   [dim.x, dim.z], bottom: [dim.x, dim.z],
			right: [dim.z, dim.y], left:   [dim.z, dim.y],
		};
		const [faceW, faceH] = faceSizes[ct.side];
		const partFaceSize  = Math.max(faceW, faceH);
		const autoRatio     = partFaceSize > 0 ? Math.max(sc.x, sc.y) / partFaceSize : 1;

		const partDetail        = mesh.detail.texture;
		const partBlueprint     = visualTemplates.textures[partDetail.baseTextureID];
		const partEffDensity    = partDetail.density    !== null ? partDetail.density    : partBlueprint.density;
		const partEffSpeckSize  = partDetail.speckSize  !== null ? partDetail.speckSize  : partBlueprint.speckSize;

		const decalBlueprint    = visualTemplates.textures[ct.detail.baseTextureID];
		const resolvedBlueprint = {
			...decalBlueprint,
			density:   partEffDensity   * ct.detail.density,
			speckSize: partEffSpeckSize * ct.detail.speckSize,
		};
		const resolvedSize       = toPowerOfTwoSize(decalBlueprint.size);
		const effectiveScale     = autoRatio > 0 ? textureScale / autoRatio : textureScale;
		const texCanvas          = BuildTextureSurface(resolvedBlueprint, resolvedSize, effectiveScale);

		ctx.globalCompositeOperation = "source-atop";
		ctx.drawImage(texCanvas, 0, 0, size, size);
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
		let resolvedTextureBlueprint = (usageEntry.density || usageEntry.density === 0)
			? { ...textureBlueprint, density: usageEntry.density }
			: { ...textureBlueprint };
		if (usageEntry.speckSize || usageEntry.speckSize === 0) {
			resolvedTextureBlueprint = {
				...resolvedTextureBlueprint,
				speckSize: usageEntry.speckSize,
			};
		}
		if (usageEntry.shape) {
			resolvedTextureBlueprint = {
				...resolvedTextureBlueprint,
				shape: usageEntry.shape,
			};
		}

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
		const source = cu.decalType === "image"
			? cu.bitmap
			: compositeShapeDecal(cu.ct, cu.mesh, options.textureScale);
		registry[id] = {
			id,
			source,
			placement: cu.placement,
			dirty    : false,
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
	const { usage, customTextureUsage } = collectTextureUsage(sceneGraph);
	const textureRegistry = createTextureRegistry(usage, customTextureUsage, { textureScale: sceneGraph.world.textureScale });

	sceneGraph.visualResources = {
		textureRegistry,
		scatterRegistry: visualTemplates.scatterTypes,
		primitiveGeometry: sceneGraph.scatterPrimitiveGeometry,
	};

	const textureCount = Object.keys(textureRegistry).length;
	const scatterTypeCount = Object.keys(visualTemplates.scatterTypes).length;
	Log(
		"ENGINE",
		`Visual resources ready: textures=${textureCount}, scatterTypes=${scatterTypeCount}`,
		"log",
		"Level"
	);

	return sceneGraph;
}

export { PrepareLevelVisualResources, BuildTextureSurface, AddToVisualResources };