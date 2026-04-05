// Creates and Track Player Model

// Received JSON payload (character id) from game, validated by core/validate.js
// Uses characters.json for character model details
// Uses builder/NewEntity.js to create model
// Used by Master.js to pass on model data

import { BuildObject, UpdateObjectWorldAabb } from "../builder/NewObject.js";
import { 
	AddVector3, 
	SubtractVector3, 
	RotateByEuler, 
	MultiplyVector3, 
	ScaleVector3, 
	ToVector3, 
	CloneVector3 
} from "../math/Vector3.js";
import { UnitVector3 } from "../math/Utilities.js";
import { Log } from "../core/meta.js";

/**
 * Clone a canonical transform object.
 * @param {object} transform — source transform.
 */
function cloneTransform(transform) {
	const position = transform.position.clone();
	const rotation = transform.rotation.clone();
	const pivot    = transform.pivot.clone();
	const scale    = CloneVector3(transform.scale);
	return { position, rotation, scale, pivot };
}

/**
 * Compute the center offset for a face on a box with the given dimensions.
 */
function getFaceCenterOffset(dimensions, faceType) {
	const h = ScaleVector3(dimensions, 0.5);
	switch (faceType) {
		case "top": return { x: 0, y: h.y, z: 0 };
		case "bottom": return { x: 0, y: -h.y, z: 0 };
		case "front": return { x: 0, y: 0, z: h.z };
		case "back": return { x: 0, y: 0, z: -h.z };
		case "left": return { x: -h.x, y: 0, z: 0 };
		case "right": return { x: h.x, y: 0, z: 0 };
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
	const dimensions = source.dimensions.clone();
	const localTransform = {
		position: source.localPosition.clone(),
		rotation: source.localRotation.clone(),
		scale: CloneVector3(source.localScale),
		pivot: source.pivot.clone(),
	};

	const mesh = BuildObject(
		{
			id: source.id,
			shape: source.shape,
			complexity: source.complexity,
			dimensions: dimensions,
			position: new UnitVector3(0, 0, 0, "cnu"),
			rotation: new UnitVector3(0, 0, 0, "radians"),
			scale: ToVector3(1),
			pivot: localTransform.pivot.clone(),
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
		localTransform: localTransform,
		defaultLocalTransform: cloneTransform(localTransform),
		mesh: mesh,
	};
}

function computeExpandedAabb(aabb, padding) {
	return {
		min: SubtractVector3(aabb.min, ToVector3(padding)),
		max: AddVector3(aabb.max, ToVector3(padding)),
	};
}

function applyModelPose(model) {
	const applyPart = (partId, parentTransform) => {
		const part = model.index[partId];

		const worldTransform = composeTransform(parentTransform, part.localTransform);
		part.mesh.transform.position.set(worldTransform.position);
		part.mesh.transform.rotation.set(worldTransform.rotation);
		part.mesh.transform.scale = worldTransform.scale;
		part.mesh.transform.pivot.set(worldTransform.pivot);
		UpdateObjectWorldAabb(part.mesh);

		part.children.forEach((childId) => applyPart(childId, worldTransform));
	};

	// rootTransform rotation comes from playerState (already in radians).
	model.roots.forEach((rootId) => applyPart(rootId, cloneTransform(model.rootTransform)));
}

function computePlayerAabb(model) {
	const min = ToVector3(Infinity);
	const max = ToVector3(-Infinity);

	model.parts.forEach((part) => {
		const bounds = part.mesh.worldAabb;
		if (bounds.min.x < min.x) { min.x = bounds.min.x; }
		if (bounds.min.y < min.y) { min.y = bounds.min.y; }
		if (bounds.min.z < min.z) { min.z = bounds.min.z; }
		if (bounds.max.x > max.x) { max.x = bounds.max.x; }
		if (bounds.max.y > max.y) { max.y = bounds.max.y; }
		if (bounds.max.z > max.z) { max.z = bounds.max.z; }
	});

	return { min, max };
}

function computePlayerCapsuleFromAabb(aabb) {
	const dim = SubtractVector3(aabb.max, aabb.min);
	const radius = Math.max(0.0001, Math.max(dim.x, dim.z) * 0.5);
	const halfHeight = Math.max(0, (dim.y * 0.5) - radius);

	const start = ScaleVector3(AddVector3(aabb.min, aabb.max), 0.5);
	const end = CloneVector3(start);
	start.y -= halfHeight;
	end.y += halfHeight;

	// Unit Instancing happens later.
	return {
		radius: radius,
		halfHeight: halfHeight,
		segmentStart: start,
		segmentEnd: end,
	};
}

function applyProfileAabb(target, bounds) {
	target.min.set(bounds.min);
	target.max.set(bounds.max);
}

function InitializePlayerCollisionProfile(playerState) {
	const model = playerState.model;
	applyModelPose(model);

	const fullAabb = computePlayerAabb(model);
	const totalDim = SubtractVector3(fullAabb.max, fullAabb.min);
	const footprint = Math.max(totalDim.x, totalDim.z);
	const bodyRadius = Math.max(0.0001, footprint * 0.5);
	const profileShape = totalDim.y > footprint ? "capsule" : "sphere";
	const rootPosition = playerState.transform.position;
	const bodyCenter = ScaleVector3(AddVector3(fullAabb.min, fullAabb.max), 0.5);
	const sphereRadius = Math.max(0.0001, footprint * 0.5);
	const sphereCenter = {
		x: bodyCenter.x,
		y: fullAabb.min.y + sphereRadius,
		z: bodyCenter.z,
	};
	const capsule = computePlayerCapsuleFromAabb(fullAabb);

	const profile = playerState.collision.profile;
	profile.shape = profileShape;
	applyProfileAabb(profile.modelAabb, fullAabb);
	profile.bodyCenterOffset.set(SubtractVector3(bodyCenter, rootPosition));
	profile.bodyRadius.value = bodyRadius;
	profile.bottomOffset.value = fullAabb.min.y - rootPosition.y;
	profile.sphereCenterOffset.set(SubtractVector3(sphereCenter, rootPosition));
	profile.sphereRadius.value = sphereRadius;
	profile.capsuleRadius.value = capsule.radius;
	profile.capsuleHalfHeight.value = capsule.halfHeight;
	profile.capsuleStartOffset.set(SubtractVector3(capsule.segmentStart, rootPosition));
	profile.capsuleEndOffset.set(SubtractVector3(capsule.segmentEnd, rootPosition));
}

function SyncPlayerCollisionFromState(playerState) {
	const collision = playerState.collision;
	const profile = collision.profile;
	const rootPosition = playerState.transform.position;
	const sphereCenter = AddVector3(rootPosition, profile.sphereCenterOffset);
	const sphereRadius = profile.sphereRadius.value;
	const modelAabb = computePlayerAabb(playerState.model);
	const bodyCenter = AddVector3(rootPosition, profile.bodyCenterOffset);
	const bodyRadius = profile.bodyRadius.value;

	applyProfileAabb(profile.modelAabb, modelAabb);
	collision.sphere.center.set(sphereCenter);
	collision.sphere.radius.value = sphereRadius;
	if (profile.shape === "capsule") {
		const segmentStart = AddVector3(rootPosition, profile.capsuleStartOffset);
		const segmentEnd = AddVector3(rootPosition, profile.capsuleEndOffset);
		const capsuleRadius = profile.capsuleRadius.value;
		collision.capsule.radius.value = capsuleRadius;
		collision.capsule.halfHeight.value = profile.capsuleHalfHeight.value;
		collision.capsule.segmentStart.set(segmentStart);
		collision.capsule.segmentEnd.set(segmentEnd);
		collision.physics.shape = "capsule";
		collision.physics.bounds = collision.capsule;
	}
	else {
		collision.physics.shape = "sphere";
		collision.physics.bounds = collision.sphere;
	}
	collision.shape = collision.physics.shape;

	collision.radius.value = bodyRadius;
	collision.hurtbox.bounds.center.set(bodyCenter);
	collision.hurtbox.bounds.radius.value = bodyRadius * 0.9;
	collision.hitbox.bounds.center.set(bodyCenter);
	collision.hitbox.bounds.radius.value = bodyRadius * 1.1;

	collision.aabb.min.set(modelAabb.min);
	collision.aabb.max.set(modelAabb.max);
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

	const model = {
		rootTransform: {
			position: spawnPosition.clone(),
			rotation: new UnitVector3(0, 0, 0, "radians"),
			scale: ToVector3(1),
			pivot: new UnitVector3(0, 0, 0, "cnu"),
		},
		parts: characterDefinition.model.parts.map((part, index) => buildPart(part, entityId, index)),
	};

	// Build index and parent→child links.
	const index = {};
	model.parts.forEach((part) => { index[part.id] = part; });
	model.parts.forEach((part) => {
		if (part.parentId !== "root") index[part.parentId].children.push(part.id);
	});

	// Ground-up positioning with anchor/attachment faces.
	model.parts.forEach((part) => {
		if (part.parentId === "root") part.localTransform.position.y += part.dimensions.y * 0.5;
		else {
			const parent = index[part.parentId];
			const attachOffset = getFaceCenterOffset(parent.dimensions, part.attachmentPoint);
			const anchorOffset = getFaceCenterOffset(part.dimensions, part.anchorPoint);
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
};
