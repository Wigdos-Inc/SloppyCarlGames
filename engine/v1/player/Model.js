// Creates and Track Player Model

// Received JSON payload (character id) from game, validated by core/validate.js
// Uses characters.json for character model details
// Uses builder/NewEntity.js to create model
// Used by Master.js to pass on model data

import { BuildObject, UpdateObjectWorldAabb } from "../builder/NewObject.js";
import { NormalizeVector3, AddVector3 } from "../math/Vector3.js";
import { DegreesToRadians, ToNumber } from "../math/Utilities.js";
import { Log } from "../core/meta.js";

function cloneTransform(transform, fallback) {
	const source = transform && typeof transform === "object" ? transform : {};
	const fb = fallback && typeof fallback === "object" ? fallback : {};
	const position = NormalizeVector3(source.position, fb.position || { x: 0, y: 0, z: 0 });
	const rotation = NormalizeVector3(source.rotation, fb.rotation || { x: 0, y: 0, z: 0 });
	const rotationRad = {
		x: DegreesToRadians(rotation.x),
		y: DegreesToRadians(rotation.y),
		z: DegreesToRadians(rotation.z),
	};
	const scale = NormalizeVector3(source.scale, fb.scale || { x: 1, y: 1, z: 1 });
	const pivot = NormalizeVector3(source.pivot, fb.pivot || { x: 0, y: 0, z: 0 });
	return { position, rotation: rotationRad, scale, pivot };
}

function multiplyVector3(a, b) {
	const left = NormalizeVector3(a, { x: 1, y: 1, z: 1 });
	const right = NormalizeVector3(b, { x: 1, y: 1, z: 1 });
	return { x: left.x * right.x, y: left.y * right.y, z: left.z * right.z };
}

function composeTransform(parentTransform, localTransform) {
	const parent = cloneTransform(parentTransform);
	const local = cloneTransform(localTransform);
	return {
		position: AddVector3(parent.position, local.position),
		rotation: AddVector3(parent.rotation, local.rotation),
		scale: multiplyVector3(parent.scale, local.scale),
		pivot: local.pivot,
	};
}

function buildPart(partDefinition, entityId, index) {
	const source = partDefinition && typeof partDefinition === "object" ? partDefinition : {};
	const localTransform = {
		position: NormalizeVector3(source.localPosition, { x: 0, y: 0, z: 0 }),
		rotation: NormalizeVector3(source.localRotation, { x: 0, y: 0, z: 0 }),
		scale: NormalizeVector3(source.localScale, { x: 1, y: 1, z: 1 }),
		pivot: NormalizeVector3(source.pivot, { x: 0, y: 0, z: 0 }),
	};

	const mesh = BuildObject(
		{
			id: source.id || `${entityId}-part-${index}`,
			primitive: source.primitive || source.shape || "cube",
			dimensions: NormalizeVector3(source.dimensions, { x: 1, y: 1, z: 1 }),
			textureID: source.textureID || "default-grid",
			textureColor: source.textureColor || { r: 1, g: 1, b: 1, a: 1 },
			textureOpacity: ToNumber(source.textureOpacity, 1),
			pivot: localTransform.pivot,
			role: "entity-part",
			parentId: source.parentId || null,
		},
		{ role: "entity-part" }
	);

	return {
		id: mesh.id,
		label: source.label || null,
		parentId: source.parentId || null,
		children: [],
		localTransform: cloneTransform(localTransform),
		defaultLocalTransform: cloneTransform(localTransform),
		mesh: mesh,
	};
}

function computeExpandedAabb(aabb, padding) {
	if (!aabb || !aabb.min || !aabb.max) {
		return null;
	}
	const pad = Math.max(0, ToNumber(padding, 24));
	return {
		min: {
			x: aabb.min.x - pad,
			y: aabb.min.y - pad,
			z: aabb.min.z - pad,
		},
		max: {
			x: aabb.max.x + pad,
			y: aabb.max.y + pad,
			z: aabb.max.z + pad,
		},
	};
}

function applyModelPose(model) {
	if (!model || !Array.isArray(model.parts)) {
		return;
	}

	const byId = model.index || {};
	const applyPart = (partId, parentTransform) => {
		const part = byId[partId];
		if (!part) { return; }

		const worldTransform = composeTransform(parentTransform, part.localTransform);
		part.mesh.transform = {
			position: worldTransform.position,
			rotation: worldTransform.rotation,
			scale: worldTransform.scale,
			pivot: worldTransform.pivot,
		};
		UpdateObjectWorldAabb(part.mesh);

		part.children.forEach((childId) => applyPart(childId, worldTransform));
	};

	const rootTransform = cloneTransform(model.rootTransform);
	model.roots.forEach((rootId) => applyPart(rootId, rootTransform));
}

function computePlayerAabb(model) {
	if (!model || !Array.isArray(model.parts) || model.parts.length === 0) {
		return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
	}

	let minX = Infinity, minY = Infinity, minZ = Infinity;
	let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

	model.parts.forEach((part) => {
		const bounds = part.mesh && part.mesh.worldAabb ? part.mesh.worldAabb : null;
		if (!bounds) { return; }
		if (bounds.min.x < minX) { minX = bounds.min.x; }
		if (bounds.min.y < minY) { minY = bounds.min.y; }
		if (bounds.min.z < minZ) { minZ = bounds.min.z; }
		if (bounds.max.x > maxX) { maxX = bounds.max.x; }
		if (bounds.max.y > maxY) { maxY = bounds.max.y; }
		if (bounds.max.z > maxZ) { maxZ = bounds.max.z; }
	});

	return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

/**
 * Build a player model from a character definition.
 * @param {object} characterDefinition — from characters.json
 * @param {{ x, y, z }} spawnPosition
 * @returns {object} — model object with rootTransform, parts[], index{}, roots[], defaultPose.
 */
function BuildPlayerModel(characterDefinition, spawnPosition) {
	const charDef = characterDefinition && typeof characterDefinition === "object" ? characterDefinition : {};
	const modelDef = charDef.model && typeof charDef.model === "object" ? charDef.model : {};
	const partsArray = Array.isArray(modelDef.parts) ? modelDef.parts : [];
	const entityId = charDef.id || "player";
	const pos = NormalizeVector3(spawnPosition, { x: 0, y: 0, z: 0 });

	const model = {
		rootTransform: {
			position: { ...pos },
			rotation: { x: 0, y: 0, z: 0 },
			scale: { x: 1, y: 1, z: 1 },
			pivot: { x: 0, y: 0, z: 0 },
		},
		parts: partsArray.map((part, index) => buildPart(part, entityId, index)),
	};

	// Build index and parent→child links.
	const index = {};
	model.parts.forEach((part) => { index[part.id] = part; });
	model.parts.forEach((part) => {
		if (part.parentId && index[part.parentId]) {
			index[part.parentId].children.push(part.id);
		}
	});

	model.defaultPose = {
		rootTransform: cloneTransform(model.rootTransform),
		parts: model.parts.map((part) => ({ id: part.id, localTransform: cloneTransform(part.localTransform) })),
	};

	model.index = index;
	model.roots = model.parts.filter((part) => !part.parentId).map((part) => part.id);

	applyModelPose(model);
	Log("ENGINE", `Player model built: ${entityId} with ${model.parts.length} parts.`, "log", "Level");

	return model;
}

/**
 * Update the player's model root transform from playerState, then re-pose.
 * @param {object} playerState — full player state with transform and model.
 */
function UpdatePlayerModelFromState(playerState) {
	if (!playerState || !playerState.model) { return; }

	playerState.model.rootTransform.position = NormalizeVector3(
		playerState.transform ? playerState.transform.position : null,
		{ x: 0, y: 0, z: 0 }
	);
	playerState.model.rootTransform.rotation = NormalizeVector3(
		playerState.transform ? playerState.transform.rotation : null,
		{ x: 0, y: 0, z: 0 }
	);
	playerState.model.rootTransform.scale = NormalizeVector3(
		playerState.transform ? playerState.transform.scale : null,
		{ x: 1, y: 1, z: 1 }
	);

	applyModelPose(playerState.model);

	// Update collision AABB from model.
	playerState.collision = playerState.collision || {};
	playerState.collision.aabb = computePlayerAabb(playerState.model);
	playerState.collision.simRadiusPadding = ToNumber(playerState.collision.simRadiusPadding, 24);
	playerState.collision.simRadiusAabb = computeExpandedAabb(
		playerState.collision.aabb,
		playerState.collision.simRadiusPadding
	);

	// Update mesh reference for rendering.
	playerState.mesh = playerState.model.parts && playerState.model.parts[0]
		? playerState.model.parts[0].mesh
		: null;
}

/* === EXPORTS === */

export { BuildPlayerModel, UpdatePlayerModelFromState, applyModelPose, computePlayerAabb };
