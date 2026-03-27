// Creates and Track Player Model

// Received JSON payload (character id) from game, validated by core/validate.js
// Uses characters.json for character model details
// Uses builder/NewEntity.js to create model
// Used by Master.js to pass on model data

import { BuildObject, UpdateObjectWorldAabb } from "../builder/NewObject.js";
import { NormalizeVector3, AddVector3, SubtractVector3, RotateByEuler, MultiplyVector3, ScaleVector3 } from "../math/Vector3.js";
import { UnitVector3 } from "../math/Utilities.js";
import { EPSILON, Log } from "../core/meta.js";

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

function createAabb(min, max) {
	return { min: { x: min.x, y: min.y, z: min.z }, max: { x: max.x, y: max.y, z: max.z } };
}

function mergeAabb(accumulator, bounds) {
	if (!accumulator) return createAabb(bounds.min, bounds.max);
	if (bounds.min.x < accumulator.min.x) accumulator.min.x = bounds.min.x;
	if (bounds.min.y < accumulator.min.y) accumulator.min.y = bounds.min.y;
	if (bounds.min.z < accumulator.min.z) accumulator.min.z = bounds.min.z;
	if (bounds.max.x > accumulator.max.x) accumulator.max.x = bounds.max.x;
	if (bounds.max.y > accumulator.max.y) accumulator.max.y = bounds.max.y;
	if (bounds.max.z > accumulator.max.z) accumulator.max.z = bounds.max.z;
	return accumulator;
}

function buildSphereAabb(center, radius) {
	return {
		min: { x: center.x - radius, y: center.y - radius, z: center.z - radius },
		max: { x: center.x + radius, y: center.y + radius, z: center.z + radius },
	};
}

function buildCapsuleAabb(segmentStart, segmentEnd, radius) {
	return {
		min: {
			x: Math.min(segmentStart.x, segmentEnd.x) - radius,
			y: Math.min(segmentStart.y, segmentEnd.y) - radius,
			z: Math.min(segmentStart.z, segmentEnd.z) - radius,
		},
		max: {
			x: Math.max(segmentStart.x, segmentEnd.x) + radius,
			y: Math.max(segmentStart.y, segmentEnd.y) + radius,
			z: Math.max(segmentStart.z, segmentEnd.z) + radius,
		},
	};
}

function computeLowestPartsAabb(model, modelBottomY) {
	let lowest = null;
	for (let index = 0; index < model.parts.length; index++) {
		const bounds = model.parts[index].mesh.worldAabb;
		if (Math.abs(bounds.min.y - modelBottomY) <= EPSILON) lowest = mergeAabb(lowest, bounds);
	}
	return lowest;
}

function applyProfileAabb(target, bounds) {
	target.min.set(bounds.min);
	target.max.set(bounds.max);
}

function InitializePlayerCollisionProfile(playerState) {
	const model = playerState.model;
	applyModelPose(model);

	const fullAabb = computePlayerAabb(model);
	const totalWidth = fullAabb.max.x - fullAabb.min.x;
	const totalHeight = fullAabb.max.y - fullAabb.min.y;
	const totalDepth = fullAabb.max.z - fullAabb.min.z;
	const footprint = Math.max(totalWidth, totalDepth);
	const modelBottomY = fullAabb.min.y;
	const lowestAabb = computeLowestPartsAabb(model, modelBottomY);
	const bottomWidth = lowestAabb.max.x - lowestAabb.min.x;
	const bottomDepth = lowestAabb.max.z - lowestAabb.min.z;
	const lowerRadius = Math.max(0.0001, Math.max(bottomWidth, bottomDepth) * 0.5);
	const bodyRadius = Math.max(0.0001, footprint * 0.5);
	const useCapsule = totalHeight > totalWidth;
	const capsuleRadius = Math.max(0.0001, footprint * 0.5);
	const capsuleCylinderHeight = Math.max(0, totalHeight - (lowerRadius * 2));
	const lowerCenter = {
		x: (lowestAabb.min.x + lowestAabb.max.x) * 0.5,
		y: modelBottomY + lowerRadius,
		z: (lowestAabb.min.z + lowestAabb.max.z) * 0.5,
	};
	const rootPosition = playerState.transform.position;
	const bodyCenter = ScaleVector3(AddVector3(fullAabb.min, fullAabb.max), 0.5);
	const capsuleStart = {
		x: lowerCenter.x,
		y: modelBottomY + (lowerRadius * 2) + capsuleRadius,
		z: lowerCenter.z,
	};
	const capsuleEnd = {
		x: lowerCenter.x,
		y: capsuleStart.y + capsuleCylinderHeight,
		z: lowerCenter.z,
	};

	const profile = playerState.collision.profile;
	profile.useCapsule = useCapsule && capsuleCylinderHeight > EPSILON;
	profile.modelBottomY.value = modelBottomY;
	applyProfileAabb(profile.modelAabb, fullAabb);
	applyProfileAabb(profile.lowestAabb, lowestAabb);
	profile.bodyCenterOffset.set(SubtractVector3(bodyCenter, rootPosition));
	profile.bodyRadius.value = bodyRadius;
	profile.lowerSphereOffset.set(SubtractVector3(lowerCenter, rootPosition));
	profile.lowerSphereRadius.value = lowerRadius;
	profile.upperCapsuleRadius.value = capsuleRadius;
	profile.upperCapsuleHalfHeight.value = capsuleCylinderHeight * 0.5;
	profile.upperCapsuleStartOffset.set(SubtractVector3(capsuleStart, rootPosition));
	profile.upperCapsuleEndOffset.set(SubtractVector3(capsuleEnd, rootPosition));
}

function SyncPlayerCollisionFromState(playerState) {
	const collision = playerState.collision;
	const profile = collision.profile;
	const rootPosition = playerState.transform.position;
	const lowerCenter = AddVector3(rootPosition, profile.lowerSphereOffset);
	const lowerRadius = profile.lowerSphereRadius.value;
	const bodyCenter = AddVector3(rootPosition, profile.bodyCenterOffset);
	const bodyRadius = profile.bodyRadius.value;

	collision.playerPhysics.useCapsule = profile.useCapsule;
	collision.playerPhysics.lowerSphere.center.set(lowerCenter);
	collision.playerPhysics.lowerSphere.radius.value = lowerRadius;
	collision.physics.shape = profile.useCapsule ? "player-two-shape" : "sphere";
	collision.physics.bounds.center.set(lowerCenter);
	collision.physics.bounds.radius.value = lowerRadius;
	collision.shape = collision.physics.shape;

	let bounds = buildSphereAabb(lowerCenter, lowerRadius);

	if (profile.useCapsule) {
		const segmentStart = AddVector3(rootPosition, profile.upperCapsuleStartOffset);
		const segmentEnd = AddVector3(rootPosition, profile.upperCapsuleEndOffset);
		const capsuleRadius = profile.upperCapsuleRadius.value;
		collision.playerPhysics.upperCapsule.radius.value = capsuleRadius;
		collision.playerPhysics.upperCapsule.halfHeight.value = profile.upperCapsuleHalfHeight.value;
		collision.playerPhysics.upperCapsule.segmentStart.set(segmentStart);
		collision.playerPhysics.upperCapsule.segmentEnd.set(segmentEnd);
		collision.capsule.radius.value = capsuleRadius;
		collision.capsule.halfHeight.value = profile.upperCapsuleHalfHeight.value;
		collision.capsule.segmentStart.set(segmentStart);
		collision.capsule.segmentEnd.set(segmentEnd);
		bounds = mergeAabb(bounds, buildCapsuleAabb(segmentStart, segmentEnd, capsuleRadius));
	} else {
		collision.playerPhysics.upperCapsule.radius.value = 0;
		collision.playerPhysics.upperCapsule.halfHeight.value = 0;
		collision.playerPhysics.upperCapsule.segmentStart.set(lowerCenter);
		collision.playerPhysics.upperCapsule.segmentEnd.set(lowerCenter);
		collision.capsule.radius.value = 0;
		collision.capsule.halfHeight.value = 0;
		collision.capsule.segmentStart.set(lowerCenter);
		collision.capsule.segmentEnd.set(lowerCenter);
	}

	collision.radius.value = bodyRadius;
	collision.hurtbox.bounds.center.set(bodyCenter);
	collision.hurtbox.bounds.radius.value = bodyRadius * 0.9;
	collision.hitbox.bounds.center.set(bodyCenter);
	collision.hitbox.bounds.radius.value = bodyRadius * 1.1;

	collision.aabb.min.set(bounds.min);
	collision.aabb.max.set(bounds.max);
	const expanded = computeExpandedAabb(collision.aabb, collision.simRadiusPadding);
	collision.simRadiusAabb.min.set(expanded.min);
	collision.simRadiusAabb.max.set(expanded.max);
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

	// Update mesh reference for rendering.
	playerState.mesh = playerState.model.parts[0].mesh;
}

/* === EXPORTS === */

export {
	BuildPlayerModel,
	InitializePlayerCollisionProfile,
	SyncPlayerCollisionFromState,
	UpdatePlayerModelFromState,
	applyModelPose,
	computePlayerAabb,
};
