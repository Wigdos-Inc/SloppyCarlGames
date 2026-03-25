// Creates and Track Player Model

// Received JSON payload (character id) from game, validated by core/validate.js
// Uses characters.json for character model details
// Uses builder/NewEntity.js to create model
// Used by Master.js to pass on model data

import { BuildObject, UpdateObjectWorldAabb } from "../builder/NewObject.js";
import { NormalizeVector3, AddVector3, SubtractVector3, RotateByEuler, MultiplyVector3 } from "../math/Vector3.js";
import { UnitVector3 } from "../math/Utilities.js";
import { Log } from "../core/meta.js";

/**
 * Clone and normalize a transform object.
 * @param {object} transform — source transform.
 * @param {object} [fallback] — fallback values.
 * @param {boolean} [rotationInRadians=false] — when true, rotation values are
 *        already in radians and will NOT be converted from degrees. Pass true
 *        when cloning transforms that have already been through this function
 *        (e.g. in composeTransform, applyModelPose, or defaultPose snapshots).
 */
function cloneTransform(transform) {
	const position = transform.position.clone();
	const rotation = transform.rotation.clone();
	const pivot    = transform.pivot.clone();
	const scale    = NormalizeVector3(transform.scale, { x: 1, y: 1, z: 1 });
	return { position, rotation, scale, pivot };
}

/**
 * Compute the center offset for a face on a box with the given dimensions.
 */
function getFaceCenterOffset(dimensions, faceType) {
	const hx = dimensions.x * 0.5;
	const hy = dimensions.y * 0.5;
	const hz = dimensions.z * 0.5;
	switch (faceType) {
		case "top": return { x: 0, y: hy, z: 0 };
		case "bottom": return { x: 0, y: -hy, z: 0 };
		case "front": return { x: 0, y: 0, z: hz };
		case "back": return { x: 0, y: 0, z: -hz };
		case "left": return { x: -hx, y: 0, z: 0 };
		case "right": return { x: hx, y: 0, z: 0 };
		default: return { x: 0, y: 0, z: 0 };
	}
}

function composeTransform(parentTransform, localTransform) {
	const parent = cloneTransform(parentTransform);
	const local = cloneTransform(localTransform);
	const rotatedChildPos = RotateByEuler(local.position, parent.rotation);
	return {
		position: local.position.set(AddVector3(parent.position, rotatedChildPos)),
		rotation: local.rotation.add(parent.rotation),
		scale: MultiplyVector3(parent.scale, local.scale),
		pivot: local.pivot,
	};
}

function buildPart(source) {
	const pos = source.localPosition;
	const rot = source.localRotation;
	const dim = source.dimensions;
	const piv = source.pivot;
	const dimensions = new UnitVector3(dim.x, dim.y, dim.z, "cnu");
	const localTransform = {
		position: new UnitVector3(pos.x, pos.y, pos.z, "cnu"),
		rotation: new UnitVector3(rot.x, rot.y, rot.z, "degrees").toRadians(true),
		scale: source.localScale,
		pivot: new UnitVector3(piv.x, piv.y, piv.z, "cnu"),
	};

	const mesh = BuildObject(
		{
			id: source.id,
			shape: source.shape,
			complexity: source.complexity,
			dimensions: dimensions,
			position: new UnitVector3(0, 0, 0, "cnu"),
			rotation: new UnitVector3(0, 0, 0, "radians"),
			scale: { x: 1, y: 1, z: 1 },
			pivot: localTransform.pivot,
			primitiveOptions: source.primitiveOptions,
			texture: source.texture,
			detail: source.detail,
			role: "entity-part",
			collisionShape: "none",
			parentId: source.parentId,
		},
		{ role: "entity-part" }
	);

	return {
		id: mesh.id,
		label: source.label,
		parentId: source.parentId,
		anchorPoint: source.anchorPoint,
		attachmentPoint: source.attachmentPoint,
		children: [],
		dimensions: dimensions,
		localTransform: cloneTransform(localTransform),
		defaultLocalTransform: cloneTransform(localTransform),
		mesh: mesh,
	};
}

function computeExpandedAabb(aabb, padding) {
	const pad = Math.max(0, padding);
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
	const byId = model.index || {};
	const applyPart = (partId, parentTransform) => {
		const part = byId[partId];
		if (!part) { return; }

		const worldTransform = composeTransform(parentTransform, part.localTransform);
		part.mesh.transform.position.set(worldTransform.position);
		part.mesh.transform.rotation.set(worldTransform.rotation);
		part.mesh.transform.scale = worldTransform.scale;
		part.mesh.transform.pivot.set(worldTransform.pivot);
		UpdateObjectWorldAabb(part.mesh);

		part.children.forEach((childId) => applyPart(childId, worldTransform));
	};

	// rootTransform rotation comes from playerState (already in radians).
	const rootTransform = cloneTransform(model.rootTransform);
	model.roots.forEach((rootId) => applyPart(rootId, rootTransform));
}

function computePlayerAabb(model) {
	let minX = Infinity, minY = Infinity, minZ = Infinity;
	let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

	model.parts.forEach((part) => {
		const bounds = part.mesh.worldAabb;
		if (bounds.min.x < minX) { minX = bounds.min.x; }
		if (bounds.min.y < minY) { minY = bounds.min.y; }
		if (bounds.min.z < minZ) { minZ = bounds.min.z; }
		if (bounds.max.x > maxX) { maxX = bounds.max.x; }
		if (bounds.max.y > maxY) { maxY = bounds.max.y; }
		if (bounds.max.z > maxZ) { maxZ = bounds.max.z; }
	});

	return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

function computePlayerCapsuleFromAabb(aabb) {
	const width = aabb.max.x - aabb.min.x;
	const height = aabb.max.y - aabb.min.y;
	const depth = aabb.max.z - aabb.min.z;
	const radius = Math.max(0.0001, Math.max(width, depth) * 0.5);
	const halfHeight = Math.max(0, (height * 0.5) - radius);
	const centerX = (aabb.min.x + aabb.max.x) * 0.5;
	const centerY = (aabb.min.y + aabb.max.y) * 0.5;
	const centerZ = (aabb.min.z + aabb.max.z) * 0.5;

	// Unit Instancing happens later.
	return {
		radius: radius,
		halfHeight: halfHeight,
		segmentStart: { x: centerX, y: centerY - halfHeight, z: centerZ },
		segmentEnd: { x: centerX, y: centerY + halfHeight, z: centerZ },
	};
}

/**
 * Build a player model from a character definition.
 * @param {object} characterDefinition — from characters.json
 * @param {{ x, y, z }} spawnPosition
 * @returns {object} — model object with rootTransform, parts[], index{}, roots[], defaultPose.
 */
function BuildPlayerModel(characterDefinition, spawnPosition) {
	const entityId = characterDefinition.id;
	const pos = spawnPosition;
	const defRootTransform = characterDefinition.model.rootTransform;

	const model = {
		rootTransform: {
			position: new UnitVector3(pos.x, pos.y, pos.z, "cnu"),
			rotation: new UnitVector3(0, 0, 0, "radians"),
			scale: NormalizeVector3(defRootTransform.scale, { x: 1, y: 1, z: 1 }),
			pivot: new UnitVector3(0, 0, 0, "cnu"),
		},
		parts: characterDefinition.model.parts.map((part, index) => buildPart(part, entityId, index)),
	};

	// Build index and parent→child links.
	const index = {};
	model.parts.forEach((part) => { index[part.id] = part; });
	model.parts.forEach((part) => {
		if (part.parentId && part.parentId !== "root" && index[part.parentId]) {
			index[part.parentId].children.push(part.id);
		}
	});

	// Ground-up positioning with anchor/attachment faces.
	model.parts.forEach((part) => {
		if (part.parentId === "root") part.localTransform.position.y += part.dimensions.y * 0.5;
		else if (part.parentId && index[part.parentId]) {
			const parent = index[part.parentId];
			const attachOffset = getFaceCenterOffset(parent.dimensions, part.attachmentPoint || "top");
			const anchorOffset = getFaceCenterOffset(part.dimensions, part.anchorPoint || "center");
			part.localTransform.position.add(SubtractVector3(attachOffset, anchorOffset));
		}
	});

	// Snapshot default transforms AFTER ground-up positioning.
	model.defaultPose = {
		rootTransform: cloneTransform(model.rootTransform),
		parts: model.parts.map((part) => ({ id: part.id, localTransform: cloneTransform(part.localTransform) })),
	};

	model.index = index;
	model.roots = model.parts.filter((part) => part.parentId === "root").map((part) => part.id);

	applyModelPose(model);
	Log("ENGINE", `Player model built: ${entityId} with ${model.parts.length} parts.`, "log", "Level");

	return model;
}

/**
 * Update the player's model root transform from playerState, then re-pose.
 * @param {object} playerState — full player state with transform and model.
 */
function UpdatePlayerModelFromState(playerState) {
	playerState.model.rootTransform.position.set(playerState.transform.position);
	playerState.model.rootTransform.rotation.set(playerState.transform.rotation);
	playerState.model.rootTransform.scale = playerState.transform.scale;

	applyModelPose(playerState.model);

	// Update collision AABB from model.
	const aabb = computePlayerAabb(playerState.model);
	playerState.collision.aabb.min.set(aabb.min);
	playerState.collision.aabb.max.set(aabb.max);
	const expanded = computeExpandedAabb(
		playerState.collision.aabb,
		playerState.collision.simRadiusPadding
	);
	if (expanded) {
		playerState.collision.simRadiusAabb.min.set(expanded.min);
		playerState.collision.simRadiusAabb.max.set(expanded.max);
	}

	const capsule = computePlayerCapsuleFromAabb(aabb);
	playerState.collision.capsule.radius.value = capsule.radius;
	playerState.collision.capsule.halfHeight.value = capsule.halfHeight;
	playerState.collision.capsule.segmentStart.set(capsule.segmentStart);
	playerState.collision.capsule.segmentEnd.set(capsule.segmentEnd);

	// Update mesh reference for rendering.
	playerState.mesh = playerState.model.parts[0].mesh;
}

/* === EXPORTS === */

export { BuildPlayerModel, UpdatePlayerModelFromState, applyModelPose, computePlayerAabb };
