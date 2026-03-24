// Create 2D textures (like grass or pebbles) to populate the world with.

// Used by NewObject.js to apply 2D and/or 3D textures to model parts.
// Uses NewObject.js to build simple 3D textures (like grass, pebbles, etc)

import visualTemplates from "./templates/textures.json" with { type: "json" };
import { Log } from "../core/meta.js";

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
			for (let index = 0; index < speckCount; index += 1) {
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

function buildTextureSurface(textureDefinition, resolvedSize, textureScale) {
	const size = resolvedSize || textureDefinition.size;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext("2d");

	drawPattern(context, size, textureDefinition, textureScale);
	return canvas;
}

function BuildTextureSurface(textureDefinition, resolvedSize, textureScale) {
	return buildTextureSurface(textureDefinition, resolvedSize, textureScale);
}

function collectTextureUsage(sceneGraph) {
	const usage = { "default-grid": { 
		isTerrain: false, 
		maxSpan: 1, 
		density: null, 
		speckSize: null,
		animatedRequested: false,
		holdTimeSpeed: 1,
		blendTimeSpeed: 1,
		baseTextureID: "default-grid", 
		shape: null 
	}};

	const register = (id, options) => {
		if (!usage[id]) usage[id] = { 
			isTerrain: false, 
			maxSpan: 1, 
			density: null, 
			speckSize: null,
			animatedRequested: false,
			holdTimeSpeed: 1,
			blendTimeSpeed: 1,
			baseTextureID: id, 
			shape: null 
		};
		const entry = usage[id];
		if (options.isTerrain) { entry.isTerrain = true; entry.maxSpan = options.maxSpan; }
		if (options.density || options.density === 0) entry.density = options.density;
		if (options.speckSize || options.speckSize === 0) entry.speckSize = options.speckSize;
		if (options.baseTextureID) entry.baseTextureID = options.baseTextureID;
		if (options.shape) entry.shape = options.shape;
		if (options.animatedRequested === true) entry.animatedRequested = true;
		if (options.holdTimeSpeed || options.holdTimeSpeed === 0) {
			entry.holdTimeSpeed = options.holdTimeSpeed;
		}
		if (options.blendTimeSpeed || options.blendTimeSpeed === 0) {
			entry.blendTimeSpeed = options.blendTimeSpeed;
		}
	};

	const collectMesh = (mesh, options, ownerKey) => {
		const detailTexture = mesh.detail.texture;
		let materialTextureID = mesh.material.textureID;
		const animatedRequested = detailTexture.animated === true;
		if (animatedRequested) {
			materialTextureID = `${mesh.material.textureID}::animated=${ownerKey}`;
			mesh.material.textureID = materialTextureID;
		}

		register(materialTextureID, {
			isTerrain: options.isTerrain,
			maxSpan: options.maxSpan,
			density: detailTexture.density,
			speckSize: detailTexture.speckSize,
			baseTextureID: detailTexture.baseTextureID,
			shape: detailTexture.shape,
			animatedRequested: animatedRequested,
			holdTimeSpeed: detailTexture.holdTimeSpeed,
			blendTimeSpeed: detailTexture.blendTimeSpeed,
		});
	};

	sceneGraph.terrain.forEach((mesh) => {
		const dimensions = mesh.dimensions;
		const scale = mesh.transform.scale;
		const span = Math.max(dimensions.x * scale.x, dimensions.z * scale.z);
		collectMesh(mesh, { isTerrain: true, maxSpan: span }, mesh.id);
	});

	const nonTerrainOptions = { isTerrain: false, maxSpan: 1 };
	sceneGraph.triggers.forEach((mesh) => collectMesh(mesh, nonTerrainOptions, mesh.id));
	sceneGraph.scatter.forEach((mesh) => collectMesh(mesh, nonTerrainOptions, mesh.id));
	sceneGraph.obstacles.forEach((obstacle) => {
		collectMesh(obstacle.mesh, nonTerrainOptions, obstacle.mesh.id);
		obstacle.parts.forEach((part) => collectMesh(part, nonTerrainOptions, part.id));
	});

	// Include any water visual meshes so their textures are registered as well.
	if (sceneGraph.waterVisual) {
		const waterMeshes = [];
		if (sceneGraph.waterVisual.body) waterMeshes.push(sceneGraph.waterVisual.body);
		if (sceneGraph.waterVisual.top) waterMeshes.push(sceneGraph.waterVisual.top);
		waterMeshes.forEach((mesh) => collectMesh(mesh, nonTerrainOptions, mesh.id));
	}

	// Collect texture IDs from instanced scatter batches.
	sceneGraph.scatterBatches.forEach((batch) => {
		register(batch.textureID, {
			isTerrain: false,
			maxSpan: 1,
			density: null,
			speckSize: null,
			baseTextureID: batch.textureID,
			shape: null,
			animatedRequested: false,
			holdTimeSpeed: 1,
			blendTimeSpeed: 1,
		});
	});

	// Collect & register mesh for each part of each entity.
	sceneGraph.entities.forEach((entity) => {
		entity.model.parts.forEach((part) => collectMesh(part.mesh, nonTerrainOptions, part.mesh.id));
	});

	return usage;
}

function createTextureRegistry(usage, options) {
	const textureDefinitions = visualTemplates.textures;
	const resolvedOptions = options;
	const textureScale = resolvedOptions.textureScale;

	const registry = {};
	const textureIDs = Object.keys(usage);
	textureIDs.forEach((textureID) => {
		const usageEntry = usage[textureID];
		const baseTextureID = usageEntry.baseTextureID;
		const textureBlueprint = textureDefinitions[baseTextureID];
		const resolvedSize = resolveTextureSize(textureBlueprint, usage[textureID]);
		const usageDensity = usage[textureID].density;
		const usageSpeckSize = usage[textureID].speckSize;
		const usageShape = usageEntry.shape;
		let resolvedTextureBlueprint = (usageDensity || usageDensity === 0)
			? { ...textureBlueprint, density: usageDensity }
			: { ...textureBlueprint };
		if (usageSpeckSize || usageSpeckSize === 0) {
			resolvedTextureBlueprint = {
				...resolvedTextureBlueprint,
				speckSize: usageSpeckSize,
			};
		}
		if (usageShape) {
			resolvedTextureBlueprint = {
				...resolvedTextureBlueprint,
				shape: usageShape,
			};
		}

		const animatedRequested = usageEntry.animatedRequested === true;
		const templateAnimation = textureBlueprint.animation;
		const templateSupportsAnimation = templateAnimation.able === true;
		const animated = animatedRequested && templateSupportsAnimation;
		if (animatedRequested && !templateSupportsAnimation) {
			Log(
				"ENGINE",
				`'${baseTextureID}' does not support animation.\nSource: '${textureID}'`,
				"warn",
				"Level"
			);
		}

		// Speed multipliers.
		const holdTimeSpeed = usageEntry.holdTimeSpeed;
		const blendTimeSpeed = usageEntry.blendTimeSpeed;

		// Animation stage time in seconds
		const holdTime = templateAnimation.holdTime;
		const blendTime = templateAnimation.blendTime;
		
		const source = buildTextureSurface(resolvedTextureBlueprint, resolvedSize, textureScale);
		registry[textureID] = {
			id: textureID,
			definition: {
				...resolvedTextureBlueprint,
				size: resolvedSize,
				holdTimeSpeed: holdTimeSpeed,
				blendTimeSpeed: blendTimeSpeed,
				animation: {
					able: animated,
					holdTime: holdTime,
					blendTime: blendTime,
				},
			},
			source: source,
			dirty: false,
		};
	});

	Log(
		"ENGINE",
		`Texture group created: count=${Object.keys(registry).length}, ids=${Object.keys(registry).join(", ")}`,
		"log",
		"Level"
	);

	return registry;
}

async function PrepareLevelVisualResources(sceneGraph) {
	const textureUsage = collectTextureUsage(sceneGraph);
	const textureRegistry = createTextureRegistry(
		textureUsage, 
		{ textureScale: sceneGraph.world.textureScale }
	);

	sceneGraph.visualResources = {
		textureRegistry: textureRegistry,
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

export { PrepareLevelVisualResources, BuildTextureSurface };