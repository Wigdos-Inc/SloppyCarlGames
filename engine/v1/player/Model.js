// Creates and Track Player Model

// Received JSON payload (character id) from game, validated by core/validate.js
// Uses characters.json for character model details
// Uses builder/NewEntity.js to create model
// Used by Master.js to pass on model data

import { BuildObject, UpdateObjectWorldAabb } from "../builder/NewObject.js";
import { NormalizeVector3, AddVector3, RotateByEuler, MultiplyVector3 } from "../math/Vector3.js";
import { ToNumber, UnitVector3 } from "../math/Utilities.js";
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
function cloneTransform(transform, fallback, rotationInRadians) {
	const source = transform && typeof transform === "object" ? transform : {};
	const fb = fallback && typeof fallback === "object" ? fallback : {};
	const positionRaw = NormalizeVector3(source.position, fb.position || { x: 0, y: 0, z: 0 });
	const rotationRaw = NormalizeVector3(source.rotation, fb.rotation || { x: 0, y: 0, z: 0 });
	const position = new UnitVector3(positionRaw.x, positionRaw.y, positionRaw.z, "cnu");
	const rotation = new UnitVector3(
		rotationRaw.x,
		rotationRaw.y,
		rotationRaw.z,
		rotationInRadians ? "radians" : "degrees"
	);
	if (!rotationInRadians) {
		rotation.toRadians(true);
	}
	const scale = NormalizeVector3(source.scale, fb.scale || { x: 1, y: 1, z: 1 });
	const pivotRaw = NormalizeVector3(source.pivot, fb.pivot || { x: 0, y: 0, z: 0 });
	const pivot = new UnitVector3(pivotRaw.x, pivotRaw.y, pivotRaw.z, "cnu");
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
	// Both inputs are already in radians (outputs of cloneTransform / prior compose).
	const parent = cloneTransform(parentTransform, null, true);
	const local = cloneTransform(localTransform, null, true);
	const rotatedChildPos = RotateByEuler(local.position, parent.rotation);
	return {
		position: new UnitVector3(
			parent.position.x + rotatedChildPos.x,
			parent.position.y + rotatedChildPos.y,
			parent.position.z + rotatedChildPos.z,
			"cnu"
		),
		rotation: new UnitVector3(
			parent.rotation.x + local.rotation.x,
			parent.rotation.y + local.rotation.y,
			parent.rotation.z + local.rotation.z,
			"radians"
		),
		scale: MultiplyVector3(parent.scale, local.scale),
		pivot: local.pivot,
	};
}

function buildPart(partDefinition, entityId, index) {
	const source = partDefinition && typeof partDefinition === "object" ? partDefinition : {};
	const rawLocalPosition = NormalizeVector3(source.localPosition, { x: 0, y: 0, z: 0 });
	const rawLocalRotation = NormalizeVector3(source.localRotation, { x: 0, y: 0, z: 0 });
	const rawDimensions = NormalizeVector3(source.dimensions, { x: 1, y: 1, z: 1 });
	const dimensions = new UnitVector3(rawDimensions.x, rawDimensions.y, rawDimensions.z, "cnu");
	const localTransform = {
		position: new UnitVector3(rawLocalPosition.x, rawLocalPosition.y, rawLocalPosition.z, "cnu"),
		rotation: new UnitVector3(rawLocalRotation.x, rawLocalRotation.y, rawLocalRotation.z, "degrees").toRadians(true),
		scale: NormalizeVector3(source.localScale, { x: 1, y: 1, z: 1 }),
		pivot: new UnitVector3(
			ToNumber(source.pivot && source.pivot.x, 0),
			ToNumber(source.pivot && source.pivot.y, 0),
			ToNumber(source.pivot && source.pivot.z, 0),
			"cnu"
		),
	};

	const mesh = BuildObject(
		{
			id: source.id || `${entityId}-part-${index}`,
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
			parentId: source.parentId || null,
		},
		{ role: "entity-part" }
	);

	return {
		id: mesh.id,
		label: source.label || null,
		parentId: source.parentId || null,
		anchorPoint: source.anchorPoint || "center",
		attachmentPoint: source.attachmentPoint || null,
		children: [],
		dimensions: dimensions,
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
		part.mesh.transform.position.set(worldTransform.position);
		part.mesh.transform.rotation.set(worldTransform.rotation);
		part.mesh.transform.scale = worldTransform.scale;
		part.mesh.transform.pivot.set(worldTransform.pivot);
		UpdateObjectWorldAabb(part.mesh);

		part.children.forEach((childId) => applyPart(childId, worldTransform));
	};

	// rootTransform rotation comes from playerState (already in radians).
	const rootTransform = cloneTransform(model.rootTransform, null, true);
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
	const modelDef = characterDefinition.model;
	const entityId = characterDefinition.id || "player";
	const pos = NormalizeVector3(spawnPosition, { x: 0, y: 0, z: 0 });
	const defRootTransform = modelDef.rootTransform && typeof modelDef.rootTransform === "object" ? modelDef.rootTransform : {};

	const model = {
		rootTransform: {
			position: new UnitVector3(pos.x, pos.y, pos.z, "cnu"),
			rotation: new UnitVector3(0, 0, 0, "radians"),
			scale: NormalizeVector3(defRootTransform.scale, { x: 1, y: 1, z: 1 }),
			pivot: new UnitVector3(0, 0, 0, "cnu"),
		},
		parts: modelDef.parts.map((part, index) => buildPart(part, entityId, index)),
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
		if (part.parentId === "root") {
			// Root part: anchor at bottom, offset up by half height.
			const halfY = part.dimensions.y * 0.5;
			part.localTransform.position.set({
				x: part.localTransform.position.x,
				y: halfY + part.localTransform.position.y,
				z: part.localTransform.position.z,
			});
		} else if (part.parentId && index[part.parentId]) {
			const parent = index[part.parentId];
			const attachOffset = getFaceCenterOffset(parent.dimensions, part.attachmentPoint || "top");
			const anchorOffset = getFaceCenterOffset(part.dimensions, part.anchorPoint || "center");
			part.localTransform.position.set({
				x: attachOffset.x - anchorOffset.x + part.localTransform.position.x,
				y: attachOffset.y - anchorOffset.y + part.localTransform.position.y,
				z: attachOffset.z - anchorOffset.z + part.localTransform.position.z,
			});
		}
	});

	// Snapshot default transforms AFTER ground-up positioning.
	model.defaultPose = {
		rootTransform: cloneTransform(model.rootTransform, null, true),
		parts: model.parts.map((part) => ({ id: part.id, localTransform: cloneTransform(part.localTransform, null, true) })),
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
	playerState.model.rootTransform.scale = NormalizeVector3(
		playerState.transform.scale,
		{ x: 1, y: 1, z: 1 }
	);

	applyModelPose(playerState.model);

	// Update collision AABB from model.
	playerState.collision = playerState.collision || {};
	const aabb = computePlayerAabb(playerState.model);
	playerState.collision.aabb.min.set(aabb.min);
	playerState.collision.aabb.max.set(aabb.max);
	playerState.collision.simRadiusPadding = ToNumber(playerState.collision.simRadiusPadding, 24);
	const expanded = computeExpandedAabb(
		playerState.collision.aabb,
		playerState.collision.simRadiusPadding
	);
	if (expanded) {
		playerState.collision.simRadiusAabb.min.set(expanded.min);
		playerState.collision.simRadiusAabb.max.set(expanded.max);
	}

	// Update mesh reference for rendering.
	playerState.mesh = playerState.model.parts && playerState.model.parts[0]
		? playerState.model.parts[0].mesh
		: null;
}

/* === EXPORTS === */

export { BuildPlayerModel, UpdatePlayerModelFromState, applyModelPose, computePlayerAabb };
