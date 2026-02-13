// Create 2D textures (like grass or pebbles) to populate the world with.

// Used by NewObject.js to apply 2D and/or 3D textures to model parts.
// Uses NewObject.js to build simple 3D textures (like grass, pebbles, etc)

/* === IMPORTS === */
// Logging helpers.

import { Log } from "../core/meta.js";
import { normalizeVector3 } from "../math/Vector3.js";

/* === INTERNALS === */
// Local ids and normalizers for texture definitions.

let textureCounter = 0;

function nextTextureId(prefix) {
	textureCounter += 1;
	return `${prefix}-${textureCounter}`;
}

function normalizeTexture(definition, options) {
	const prefix = options && options.defaultPrefix ? options.defaultPrefix : "tex";
	return {
		id: definition.id || nextTextureId(prefix),
		source: definition.source || definition.src || null,
		type: definition.type || "surface",
		repeat: normalizeVector3(definition.repeat, { x: 1, y: 1, z: 1 }),
		offset: normalizeVector3(definition.offset, { x: 0, y: 0, z: 0 }),
		scale: normalizeVector3(definition.scale, { x: 1, y: 1, z: 1 }),
		channel: definition.channel || "base",
		tint: definition.tint || null,
		meta: definition.meta && typeof definition.meta === "object" ? definition.meta : {},
	};
}

function buildDetailPositions(detailDef, hostTransform) {
	const basePosition = normalizeVector3(hostTransform && hostTransform.position, { x: 0, y: 0, z: 0 });
	const offset = normalizeVector3(detailDef.offset, { x: 0, y: 0, z: 0 });
	const count = Math.max(0, Number(detailDef.count || 0));

	if (Array.isArray(detailDef.points)) {
		return detailDef.points.map((point) => {
			const pos = normalizeVector3(point, { x: 0, y: 0, z: 0 });
			return {
				x: basePosition.x + offset.x + pos.x,
				y: basePosition.y + offset.y + pos.y,
				z: basePosition.z + offset.z + pos.z,
			};
		});
	}

	if (count === 0) {
		return [];
	}

	const region = detailDef.region || {};
	const regionWidth = Number(region.width || 1);
	const regionDepth = Number(region.depth || 1);
	const regionHeight = Number(region.height || 0);

	const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
	const rows = Math.max(1, Math.ceil(count / columns));
	const positions = [];

	for (let i = 0; i < count; i += 1) {
		const col = i % columns;
		const row = Math.floor(i / columns);
		const colRatio = columns === 1 ? 0 : col / (columns - 1);
		const rowRatio = rows === 1 ? 0 : row / (rows - 1);
		const x = (colRatio - 0.5) * regionWidth;
		const z = (rowRatio - 0.5) * regionDepth;
		const y = regionHeight === 0 ? 0 : (rowRatio - 0.5) * regionHeight;

		positions.push({
			x: basePosition.x + offset.x + x,
			y: basePosition.y + offset.y + y,
			z: basePosition.z + offset.z + z,
		});
	}

	return positions;
}

function buildDetailObjects(detailDef, hostTransform, options) {
	const objectBuilder = options && options.objectBuilder ? options.objectBuilder : null;
	if (typeof objectBuilder !== "function") {
		return [];
	}

	const positions = buildDetailPositions(detailDef, hostTransform);
	const prefix = options && options.defaultPrefix ? options.defaultPrefix : "detail";
	const prototypeDef = detailDef.object && typeof detailDef.object === "object" ? detailDef.object : null;

	return positions
		.map((position, index) => {
			const detailId = detailDef.id ? `${detailDef.id}-${index + 1}` : `${prefix}-${index + 1}`;
			const definition = prototypeDef
				? { ...prototypeDef }
				: {
					shape: detailDef.shape || "billboard",
					geometry: detailDef.geometry || detailDef.size || { x: 0.5, y: 0.5, z: 0.5 },
					material: detailDef.material || null,
					tags: detailDef.tags || ["detail"],
				};

			definition.id = detailId;
			definition.transform = {
				position: position,
				rotation: detailDef.rotation || { x: 0, y: 0, z: 0 },
				scale: detailDef.scale || { x: 1, y: 1, z: 1 },
			};

			if (detailDef.textures) {
				definition.textures = detailDef.textures;
			}

			return objectBuilder(definition, { defaultPrefix: prefix });
		})
		.filter((objectData) => objectData);
}

/* === APPLY === */
// Public entry for texture application.

function ApplyTextures(target, texturePayload, options) {
	const payload = texturePayload && typeof texturePayload === "object" ? texturePayload : null;
	const surfaceDefinitions = payload
		? Array.isArray(payload.surface)
			? payload.surface
			: payload.surface
				? [payload.surface]
				: []
		: [];
	const detailDefinitions = payload
		? Array.isArray(payload.detail)
			? payload.detail
			: payload.detail
				? [payload.detail]
				: []
		: [];

	const surfaceTextures = surfaceDefinitions
		.filter((definition) => definition && typeof definition === "object")
		.map((definition) => normalizeTexture(definition, { defaultPrefix: "tex" }));

	const detailTextures = detailDefinitions
		.filter((definition) => definition && typeof definition === "object")
		.map((definition) => normalizeTexture({ ...definition, type: "detail" }, { defaultPrefix: "detail" }));

	const detailObjects = detailDefinitions
		.filter((definition) => definition && typeof definition === "object")
		.flatMap((definition) => buildDetailObjects(definition, target && target.transform, options));

	if (surfaceTextures.length > 0 || detailTextures.length > 0) {
		const targetId = target && target.id ? target.id : "unknown";
		Log("ENGINE", `Applied textures to ${targetId}.`, "log", "Builder");
	}

	return {
		textures: {
			surface: surfaceTextures,
			detail: detailTextures,
		},
		detailObjects: detailObjects,
	};
}

/* === EXPORTS === */
// Public texture pipeline surface.

export { ApplyTextures };