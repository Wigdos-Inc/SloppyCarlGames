// Creates Models for anything that should support being animated.
// Builds entity models from the ground up with automatic grounding and
// anchor/attachment-point–based part positioning.

// Called by NewBoss.js, player/Model.js, helpers/game/Level.js and helpers/Cutscene.js for Entity Models
// Uses NewObject.js for Model Parts

import { BuildObject, UpdateObjectWorldAabb } from "./NewObject.js";
import { AddVector3, LerpVector3, MultiplyVector3, RotateByEuler } from "../math/Vector3.js";
import { ToNumber, Unit, UnitVector3 } from "../math/Utilities.js";

/* === FACE / ANCHOR UTILITIES === */

const VALID_FACES = ["front", "back", "left", "right", "top", "bottom", "center"];

function normalizeFace(value, fallback) {
	if (typeof value === "string") {
		const lower = value.trim().toLowerCase();
		if (VALID_FACES.includes(lower)) return lower;
	}
	return fallback;
}

// Canonical face normal directions (unit vectors for each face).
const FACE_NORMALS = {
	top:    { x:  0, y:  1, z:  0 },
	bottom: { x:  0, y: -1, z:  0 },
	front:  { x:  0, y:  0, z:  1 },
	back:   { x:  0, y:  0, z: -1 },
	left:   { x: -1, y:  0, z:  0 },
	right:  { x:  1, y:  0, z:  0 },
};

/**
 * Get the center position offset for a given face of a box with the given dimensions.
 * Returns {x,y,z} offset from the box center.
 */
function getFaceCenterOffset(dimensions, faceType) {
	switch (faceType) {
		case "top":    return { x: 0, y:  dimensions.y * 0.5, z: 0 };
		case "bottom": return { x: 0, y: -dimensions.y * 0.5, z: 0 };
		case "front":  return { x: 0, y: 0, z:  dimensions.z * 0.5 };
		case "back":   return { x: 0, y: 0, z: -dimensions.z * 0.5 };
		case "left":   return { x: -dimensions.x * 0.5, y: 0, z: 0 };
		case "right":  return { x:  dimensions.x * 0.5, y: 0, z: 0 };
		case "center":
		default:       return { x: 0, y: 0, z: 0 };
	}
}

/**
 * After applying a rotation to a part, the logical face labels may no longer match
 * their original axes. This function rotates each canonical face normal by the given
 * euler rotation (radians), then reassigns face labels based on which world-axis
 * direction each rotated normal most closely aligns with.
 * Returns an object mapping original face names to new face names.
 */
function remapFacesAfterRotation(rotation) {
	const isNearZero = Math.abs(rotation.x) < 1e-6 && Math.abs(rotation.y) < 1e-6 && Math.abs(rotation.z) < 1e-6;
	if (isNearZero) {
		return { top: "top", bottom: "bottom", front: "front", back: "back", left: "left", right: "right" };
	}

	// World-axis directions and the face label they correspond to.
	const worldAxes = [
		{ label: "right",  dir: { x:  1, y:  0, z:  0 } },
		{ label: "left",   dir: { x: -1, y:  0, z:  0 } },
		{ label: "top",    dir: { x:  0, y:  1, z:  0 } },
		{ label: "bottom", dir: { x:  0, y: -1, z:  0 } },
		{ label: "front",  dir: { x:  0, y:  0, z:  1 } },
		{ label: "back",   dir: { x:  0, y:  0, z: -1 } },
	];

	const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
	const remap = {};
	const faceNames = Object.keys(FACE_NORMALS);
	const claimed = new Set();

	// Rotate each canonical face normal → find the world axis it best aligns with.
	const rotatedEntries = faceNames.map((name) => {
		const rotated = RotateByEuler(FACE_NORMALS[name], rotation);
		return { name, rotated };
	});

	// Sort by best alignment (highest dot product first) to prevent ties from producing duplicates.
	const assignments = [];
	for (const entry of rotatedEntries) {
		let bestDot = -Infinity;
		let bestLabel = "top";
		for (const axis of worldAxes) {
			const d = dot(entry.rotated, axis.dir);
			if (d > bestDot) {
				bestDot = d;
				bestLabel = axis.label;
			}
		}
		assignments.push({ name: entry.name, bestLabel, bestDot });
	}

	// Greedy assignment: highest alignment first.
	assignments.sort((a, b) => b.bestDot - a.bestDot);
	for (const a of assignments) {
		if (!claimed.has(a.bestLabel)) {
			remap[a.name] = a.bestLabel;
			claimed.add(a.bestLabel);
		} else {
			// Fallback: assign first unclaimed axis by dot product.
			let fallbackLabel = a.name;
			let fallbackDot = -Infinity;
			for (const axis of worldAxes) {
				if (!claimed.has(axis.label)) {
					const d = a.bestDot; // approximate
					if (d > fallbackDot) {
						fallbackDot = d;
						fallbackLabel = axis.label;
					}
				}
			}
			remap[a.name] = fallbackLabel;
			claimed.add(fallbackLabel);
		}
	}

	return remap;
}

/**
 * Get face center offset using a face remap.
 * The logical faceType is remapped through the faceMap before computing the offset.
 */
function getRemappedFaceOffset(dimensions, faceType, faceMap) {
	const resolvedFace = faceMap && faceMap[faceType] ? faceMap[faceType] : faceType;
	return getFaceCenterOffset(dimensions, resolvedFace);
}

/* === TRANSFORM UTILITIES === */

function cloneTransform(transform, fallback) {
	const source = transform || fallback;
	const position = source.position.clone();
	const rotation = source.rotation.clone();
	const scale = source.scale;
	const pivot = source.pivot.clone();
	return { position, rotation, scale, pivot };
}

function composeTransform(parentTransform, localTransform) {
	const rotatedChildPos = RotateByEuler(localTransform.position, parentTransform.rotation);
	return {
		position: localTransform.position.set(AddVector3(parentTransform.position, rotatedChildPos)),
		rotation: localTransform.rotation.set(AddVector3(parentTransform.rotation, localTransform.rotation)),
		scale: MultiplyVector3(parentTransform.scale, localTransform.scale),
	};
}

/* === MOVEMENT === */

function normalizeMovement(movement, surface) {
	// Movement start/end are local to the spawn surface — resolve to world space.
	// Y uses surfaceTopY (top of the surface) instead of surfacePos.y (center of the surface).
	const surfacePos = surface.position;
	movement.start.set(AddVector3({ x: surfacePos.x, y: surface.topY, z: surfacePos.z }, movement.start));
	movement.end.set(AddVector3({ x: surfacePos.x, y: surface.topY, z: surfacePos.z }, movement.end));

	return {
		start: movement.start,
		end: movement.end,
		repeat: movement.repeat !== false,
		backAndForth: movement.backAndForth !== false,
		speed: movement.speed,
		jump: movement.jump,
		jumpInterval: Math.max(0, ToNumber(movement.jumpInterval, 0)),
		jumpOnSight: movement.jumpOnSight === true,
		disappear: movement.disappear === true,
		chase: movement.chase === true,
		physics: movement.physics === true,
	};
}

/* === BLUEPRINT MERGE === */

function mergeEntityBlueprint(baseBlueprint, levelOverrides) {
	const base = baseBlueprint;
	const overrides = levelOverrides;

	return {
		...base,
		...overrides,
		attacks: Array.isArray(overrides.attacks)
			? overrides.attacks
			: Array.isArray(base.attacks)
				? base.attacks
				: [],
		model: {
			...base.model,
			...overrides.model,
			parts: Array.isArray(overrides.model && overrides.model.parts)
				? overrides.model.parts
				: Array.isArray(base.model && base.model.parts)
					? base.model.parts
					: [],
		},
	};
}

/* === PART BUILDING === */

function buildPart(partDefinition, entityId, index) {
	const source = partDefinition;

	const mesh = BuildObject(
		{
			id: source.id || `${entityId}-part-${index}`,
			shape: source.shape,
			complexity: source.complexity,
			dimensions: source.dimensions,
			position: new UnitVector3(0, 0, 0, "cnu"),
			rotation: new UnitVector3(0, 0, 0, "radians"),
			scale: { x: 1, y: 1, z: 1 },
			pivot: source.pivot,
			primitiveOptions: source.primitiveOptions,
			texture: source.texture,
			detail: source.detail,
			role: "entity-part",
			parentId: source.parentId || null,
		},
		{ role: "entity-part" }
	);

	const resolvedParentId = source.parentId || null;
	const anchorPoint = normalizeFace(source.anchorPoint, resolvedParentId === "root" ? "bottom" : "center");
	const attachmentPoint = normalizeFace(source.attachmentPoint, "top");

	return {
		id: mesh.id,
		label: source.label || null,
		parentId: resolvedParentId,
		anchorPoint: anchorPoint,
		attachmentPoint: attachmentPoint,
		children: [],
		// Source values preserved for animation (localTransform used at pose-time).
		localTransform: {
			position: source.localPosition,
			rotation: source.localRotation,
			scale: source.localScale,
		},
		defaultLocalTransform: {
			position: source.localPosition,
			rotation: source.localRotation,
			scale: source.localScale,
		},
		dimensions: source.dimensions,
		// World-space built position/rotation/scale — computed by the pipeline, used for mesh output.
		builtPosition: new UnitVector3(0, 0, 0, "CNU"),
		builtRotation: new UnitVector3(0, 0, 0, "radians"),
		builtScale: { x: 0, y: 0, z: 0 },
		builtDimensions: source.dimensions.clone(),
		faceMap: null,
		mesh: mesh,
	};
}

/* === MODEL BUILDING === */

function buildModel(entityDefinition, surfaceMap) {
	const sourceModel = entityDefinition.model;
	const entityId = entityDefinition.id;

	// --- Step 1: Resolve rootTransform from data ---
	const rtSource = entityDefinition.rootTransform || sourceModel.rootTransform;
	const rtPosition = rtSource.position;
	const rtRotation = rtSource.rotation;
	const rtScale = rtSource.scale;

	// Build all parts (each part wraps its own values in Unit/UnitVector3).
	const parts = sourceModel.parts.map((part, index) => buildPart(part, entityId, index));

	// Build index and parent-child links.
	const index = {};
	parts.forEach((part) => { index[part.id] = part; });
	parts.forEach((part) => {
		if (part.parentId && part.parentId !== "root" && index[part.parentId]) {
			index[part.parentId].children.push(part.id);
		}
	});

	// Identify root parts and non-root parts.
	const rootPartIds = parts.filter((p) => p.parentId === "root").map((p) => p.id);

	// Resolve spawn surface.
	const spawnSurfaceId = sourceModel.spawnSurfaceId || entityDefinition.spawnSurfaceId;
	const surface = surfaceMap[spawnSurfaceId];
	const surfaceTopY = surface.topY;
	const surfacePosition = surface.position;

	// --- Process root parts: build localTransform in model-local space ---
	// Root part localTransform.position is relative to rootTransform (the group origin).
	// Factor 4 (grounding): Y = scaledHalfHeight so bottom face sits at rootTransform.position.y
	// Factor 3 (localPosition): added on top of grounding
	// Factor 6 (scale offset): accounted for in scaledHalfHeight
	for (const rootPartId of rootPartIds) {
		const rootPart = index[rootPartId];

		const dims = rootPart.dimensions;
		const localRot = rootPart.localTransform.rotation;
		const localPos = rootPart.localTransform.position;
		const localScale = rootPart.localTransform.scale;

		// Face remapping after rotation.
		rootPart.faceMap = remapFacesAfterRotation(localRot);

		// Combined scale for dimensions computation.
		const combinedScale = {
			x: rtScale.x * localScale.x,
			y: rtScale.y * localScale.y,
			z: rtScale.z * localScale.z,
		};

		// Grounding: half-height of scaled part so bottom face sits at Y=0 in model-local space.
		const scaledHalfHeight = dims.y * combinedScale.y * 0.5;

		// Set localTransform.position: grounding + localPosition (model-local, relative to rootTransform).
		rootPart.localTransform.position.set({
			x: localPos.x,
			y: scaledHalfHeight + localPos.y,
			z: localPos.z,
		});

		// localTransform.rotation and localTransform.scale stay as-is from buildPart.

		// Store builtDimensions (scaled) for child attachment offset computation.
		rootPart.builtDimensions.set({
			x: dims.x * combinedScale.x,
			y: dims.y * combinedScale.y,
			z: dims.z * combinedScale.z,
		});
	}

	const processQueue = [];
	for (const rootPartId of rootPartIds) {
		const rootPart = index[rootPartId];
		for (const childId of rootPart.children) {
			processQueue.push(childId);
		}
	}

	const processed = new Set(rootPartIds);
	while (processQueue.length > 0) {
		const partId = processQueue.shift();
		if (processed.has(partId)) continue;
		processed.add(partId);

		const part = index[partId];

		const parentPart = index[part.parentId];

		const partDims = part.dimensions;
		const localPos = part.localTransform.position;
		const localScale = part.localTransform.scale;

		// Combined scale.
		const combinedScale = MultiplyVector3(rtScale, localScale);

		// Parent's attachment point offset (in parent's scaled dimensions).
		const attachOffset = getFaceCenterOffset(parentPart.builtDimensions, part.attachmentPoint);

		// Part's anchor point offset (in part's unscaled dimensions), then scaled.
		const anchorOffset = getFaceCenterOffset(partDims, part.anchorPoint);
		const scaledAnchorOffset = {
			x: anchorOffset.x * combinedScale.x,
			y: anchorOffset.y * combinedScale.y,
			z: anchorOffset.z * combinedScale.z,
		};

		// Position: attachment offset on parent - scaled anchor offset on part + localPosition.
		part.localTransform.position.set({
			x: attachOffset.x - scaledAnchorOffset.x + localPos.x,
			y: attachOffset.y - scaledAnchorOffset.y + localPos.y,
			z: attachOffset.z - scaledAnchorOffset.z + localPos.z,
		});

		// localTransform.rotation and localTransform.scale stay as-is from buildPart.

		// Store builtDimensions (scaled) for child attachment offset computation.
		part.builtDimensions.set({
			x: partDims.x * combinedScale.x,
			y: partDims.y * combinedScale.y,
			z: partDims.z * combinedScale.z,
		});
		part.faceMap = remapFacesAfterRotation(part.localTransform.rotation);

		// Enqueue children.
		for (const childId of part.children) {
			processQueue.push(childId);
		}
	}

	// --- Assemble model with world-space rootTransform ---
	// Factor 1 (spawn surface position) + Factor 2 (rootTransform.position) = world position.
	const rootPosition = rtPosition.clone();
	rootPosition.set(AddVector3(surfacePosition, rtPosition));

	const model = {
		rootTransform: {
			position: rootPosition,
			rotation: rtRotation,
			scale: rtScale,
		},
		spawnSurfaceId: spawnSurfaceId,
		surfacePosition: surfacePosition,
		parts: parts,
		index: index,
		roots: rootPartIds,
	};

	// Apply initial pose to set mesh transforms (like player Model.js).
	applyModelPose(model);

	// Snapshot default pose for ResetEntityToDefaultPose.
	model.defaultPose = {
		rootTransform: cloneTransform(model.rootTransform, null),
		parts: parts.map((part) => ({
			id: part.id,
			localTransform: cloneTransform(part.localTransform, null),
		})),
	};

	return model;
}

/* === RUNTIME POSE APPLICATION === */

function applyModelPose(model) {
	const byId = model.index;
	const applyPart = (partId, parentTransform) => {
		const part = byId[partId];

		const worldTransform = composeTransform(parentTransform, part.localTransform);
		part.mesh.transform.position.set(worldTransform.position);
		part.mesh.transform.rotation.set(worldTransform.rotation);
		part.mesh.transform.scale = worldTransform.scale;
		part.mesh.worldAabb = UpdateObjectWorldAabb(part.mesh);

		part.children.forEach((childId) => applyPart(childId, worldTransform));
	};

	const rootTransform = cloneTransform(model.rootTransform, null);
	model.roots.forEach((rootId) => applyPart(rootId, rootTransform));
}

/* === AABB === */

function computeEntityAabb(model) {
	let minX = Infinity;
	let minY = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let maxZ = -Infinity;

	model.parts.forEach((part) => {
		const mesh = part.mesh;
		const bounds = mesh.worldAabb;

		if (bounds.min.x < minX) minX = bounds.min.x;
		if (bounds.min.y < minY) minY = bounds.min.y;
		if (bounds.min.z < minZ) minZ = bounds.min.z;
		if (bounds.max.x > maxX) maxX = bounds.max.x;
		if (bounds.max.y > maxY) maxY = bounds.max.y;
		if (bounds.max.z > maxZ) maxZ = bounds.max.z;
	});

	return {
		min: new UnitVector3(minX, minY, minZ, "CNU"),
		max: new UnitVector3(maxX, maxY, maxZ, "CNU"),
	};
}

function computeExpandedAabb(aabb, padding) {
	if (!aabb || !aabb.min || !aabb.max) {
		return null;
	}
	const pad = Math.max(0, ToNumber(padding, 8));
	return {
		min: new UnitVector3(aabb.min.x - pad, aabb.min.y - pad, aabb.min.z - pad, "CNU"),
		max: new UnitVector3(aabb.max.x + pad, aabb.max.y + pad, aabb.max.z + pad, "CNU"),
	};
}

/* === PUBLIC API === */

/**
 * Build an entity from a merged definition.
 * @param {object} definition — merged blueprint + level overrides.
 * @param {object} [surfaceMap] — { [surfaceId]: { position, dimensions, scale, topY } }
 */
function BuildEntity(definition, surfaceMap) {
	const merged = mergeEntityBlueprint(definition.baseBlueprint, definition);

	// Resolve spawn surface for movement localization.
	const spawnSurfaceId = merged.model.spawnSurfaceId || merged.spawnSurfaceId;
	const surface = surfaceMap[spawnSurfaceId];
	const movement = normalizeMovement(merged.movement, surface);
	const model = buildModel(merged, surfaceMap);
	const aabb = computeEntityAabb(model);
	const simRadiusPadding = ToNumber(merged.simRadiusPadding, 8);
	const rootTrans = model.rootTransform;

	return {
		id: merged.id,
		type: merged.type,
		hp: Math.max(0, ToNumber(merged.hp, 1)),
		attacks: merged.attacks,
		hardcoded: merged.hardcoded,
		platform: merged.platform,
		movement: movement,
		transform: {
			position: rootTrans.position,
			rotation: rootTrans.rotation,
			scale: rootTrans.scale,
		},
		velocity: merged.velocity,
		model: model,
		mesh: model.parts[0].mesh,
		collision: {
			aabb: aabb,
			simRadiusPadding: simRadiusPadding,
			simRadiusAabb: computeExpandedAabb(aabb, simRadiusPadding),
		},
		animations: merged.animations,
		state: {
			movementProgress: 0,
			direction: 1,
			lastJumpMs: 0,
			activeAnimation: "idle",
		},
	};
}

function UpdateEntityModelFromTransform(entity) {
	entity.model.rootTransform.position.set(entity.transform.position);
	entity.model.rootTransform.rotation.set(entity.transform.rotation);
	entity.model.rootTransform.scale = entity.transform.scale;

	applyModelPose(entity.model);
	entity.collision.aabb = computeEntityAabb(entity.model);
	entity.collision.simRadiusPadding = ToNumber(entity.collision.simRadiusPadding, 8);
	entity.collision.simRadiusAabb = computeExpandedAabb(
		entity.collision.aabb,
		entity.collision.simRadiusPadding
	);
}

function ResetEntityToDefaultPose(entity) {
	// Mutate existing instances to preserve object identity (avoid breaking references).
	const defaultRoot = entity.model.defaultPose.rootTransform;
	const targetRoot = entity.model.rootTransform;

	targetRoot.position.set(defaultRoot.position);
	targetRoot.rotation.set(defaultRoot.rotation);
	targetRoot.scale = defaultRoot.scale;
	targetRoot.pivot.set(defaultRoot.pivot);

	const byId = entity.model.index;
	entity.model.defaultPose.parts.forEach((posePart) => {
		const part = byId[posePart.id];
		const src = posePart.localTransform;
		part.localTransform.position.set(src.position);
		part.localTransform.rotation.set(src.rotation);
		part.localTransform.scale = src.scale;
	});

	applyModelPose(entity.model);
	entity.collision.aabb = computeEntityAabb(entity.model);
	entity.collision.simRadiusPadding = ToNumber(entity.collision.simRadiusPadding, 8);
	entity.collision.simRadiusAabb = computeExpandedAabb(
		entity.collision.aabb,
		entity.collision.simRadiusPadding
	);
}

function SampleMovementPoint(entity, normalizedTime) {
	const start = entity.movement.start;
	const end = entity.movement.end;
	return LerpVector3(start, end, normalizedTime);
}

export {
	BuildEntity,
	UpdateEntityModelFromTransform,
	ResetEntityToDefaultPose,
	SampleMovementPoint,
};