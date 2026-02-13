// Single Object (shape) Generator

// Called by anything that wants any 3D element.

/* === IMPORTS === */
// Logging and texture helpers.

import { Log } from "../core/meta.js";
import { normalizeVector3 } from "../math/Vector3.js";
import { ApplyTextures } from "./NewTexture.js";

/* === INTERNALS === */
// Local ids and normalizers for object definitions.

let objectCounter = 0;

function nextObjectId(prefix) {
	objectCounter += 1;
	return `${prefix}-${objectCounter}`;
}

function normalizeTransform(definition) {
	const transform = definition && definition.transform ? definition.transform : definition;
	return {
		position: normalizeVector3(transform && transform.position, { x: 0, y: 0, z: 0 }),
		rotation: normalizeVector3(transform && transform.rotation, { x: 0, y: 0, z: 0 }),
		scale: normalizeVector3(transform && transform.scale, { x: 1, y: 1, z: 1 }),
	};
}

function normalizeGeometry(definition) {
	const geometry = definition && definition.geometry ? definition.geometry : definition;
	const size = geometry && geometry.size ? geometry.size : geometry;
	const sizeVector = normalizeVector3(size, { x: 1, y: 1, z: 1 });

	return {
		width: Number(geometry && geometry.width ? geometry.width : sizeVector.x),
		height: Number(geometry && geometry.height ? geometry.height : sizeVector.y),
		depth: Number(geometry && geometry.depth ? geometry.depth : sizeVector.z),
		radius: Number(geometry && geometry.radius ? geometry.radius : Math.max(sizeVector.x, sizeVector.z) * 0.5),
		length: Number(geometry && geometry.length ? geometry.length : sizeVector.z),
		segments: Number(geometry && geometry.segments ? geometry.segments : 1),
	};
}

function normalizeMaterial(definition) {
	const material = definition && definition.material ? definition.material : definition;
	return {
		color: material && material.color ? material.color : "#ffffff",
		opacity: Number(material && material.opacity !== undefined ? material.opacity : 1),
		metallic: Number(material && material.metallic !== undefined ? material.metallic : 0),
		roughness: Number(material && material.roughness !== undefined ? material.roughness : 0.8),
		emissive: material && material.emissive ? material.emissive : null,
	};
}

/* === BUILDERS === */
// Public builders for object payloads.

function BuildObject(definition, options) {
	if (!definition || typeof definition !== "object") {
		return null;
	}

	const prefix = options && options.defaultPrefix ? options.defaultPrefix : "obj";
	const id = definition.id || nextObjectId(prefix);
	const shape = definition.shape || definition.type || "box";
	const transform = normalizeTransform(definition);
	const geometry = normalizeGeometry(definition);
	const material = normalizeMaterial(definition);

	const objectData = {
		id: id,
		shape: shape,
		transform: transform,
		geometry: geometry,
		material: material,
		tags: Array.isArray(definition.tags) ? definition.tags : [],
		meta: definition.meta && typeof definition.meta === "object" ? definition.meta : {},
	};

	const textureResult = ApplyTextures(objectData, definition.textures, {
		objectBuilder: BuildObject,
		defaultPrefix: `${id}-detail`,
	});

	objectData.textures = textureResult.textures;
	objectData.detailObjects = textureResult.detailObjects;

	Log("ENGINE", `Built object ${id} (${shape}).`, "log", "Builder");
	return objectData;
}

function BuildObjects(definitions, options) {
	if (!Array.isArray(definitions)) {
		return [];
	}

	return definitions
		.map((definition) => BuildObject(definition, options))
		.filter((objectData) => objectData);
}

function BuildTerrain(terrainPayload) {
	if (!terrainPayload) {
		return [];
	}

	if (Array.isArray(terrainPayload)) {
		return BuildObjects(terrainPayload, { defaultPrefix: "terrain" });
	}

	if (Array.isArray(terrainPayload.parts)) {
		return BuildObjects(terrainPayload.parts, { defaultPrefix: "terrain" });
	}

	const terrainObject = BuildObject(terrainPayload, { defaultPrefix: "terrain" });
	return terrainObject ? [terrainObject] : [];
}

/* === EXPORTS === */
// Public object pipeline surface.

export { BuildObject, BuildObjects, BuildTerrain };