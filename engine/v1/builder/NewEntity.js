// Creates Models for anything that should support being animated.
// Builds entity models from the ground up with automatic grounding and
// anchor/attachment-point–based part positioning.

// Called by NewBoss.js, player/Model.js, helpers/game/Level.js and helpers/Cutscene.js for Entity Models
// Uses NewObject.js for Model Parts

import { BuildObject, UpdateObjectWorldAabb } from "./NewObject.js";
import { AddVector3, LerpVector3, MultiplyVector3, RotateByEuler, ScaleVector3, SubtractVector3 } from "../math/Vector3.js";
import { ToNumber, Unit, UnitVector3 } from "../math/Utilities.js";

// Canonical face normal directions (unit vectors for each face).
const faceNormals = {
	top   : { x:  0, y:  1, z:  0 },
	bottom: { x:  0, y: -1, z:  0 },
	front : { x:  0, y:  0, z:  1 },
	back  : { x:  0, y:  0, z: -1 },
	left  : { x: -1, y:  0, z:  0 },
	right : { x:  1, y:  0, z:  0 },
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
	const faceNames = Object.keys(faceNormals);
	const claimed = new Set();

	// Rotate each canonical face normal → find the world axis it best aligns with.
	const rotatedEntries = faceNames.map((name) => {
		const rotated = RotateByEuler(faceNormals[name], rotation);
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
	const resolvedFace = faceMap[faceType] ? faceMap[faceType] : faceType;
	return getFaceCenterOffset(dimensions, resolvedFace);
}

/* === TRANSFORM UTILITIES === */

function cloneRootTransform(transform) {
	const source = transform;
	const position = source.position.clone();
	const rotation = source.rotation.clone();
	const scale = source.scale;
	const pivot = source.pivot.clone();
	return { position, rotation, scale, pivot };
}

function cloneLocalTransform(transform) {
	const source = transform;
	const position = source.position.clone();
	const rotation = source.rotation.clone();
	const scale = source.scale;
	return { position, rotation, scale };
}

function composeTransform(parentTransform, localTransform) {
	const localPosition = localTransform.position.clone();
	const localRotation = localTransform.rotation.clone();
	const rotatedChildPos = RotateByEuler(localPosition, parentTransform.rotation);
	return {
		position: localPosition.set(AddVector3(parentTransform.position, rotatedChildPos)),
		rotation: localRotation.add(parentTransform.rotation),
		scale: MultiplyVector3(parentTransform.scale, localTransform.scale),
	};
}

function getSurfaceOrigin(surface) {
	const surfacePos = surface.position;
	return { x: surfacePos.x, y: surface.topY, z: surfacePos.z };
}

function resolveInitialMovementProgress(movement, currentPosition) {
	const start = movement.start;
	const end = movement.end;
	const dx = end.x - start.x;
	const dy = end.y - start.y;
	const dz = end.z - start.z;
	const lengthSq = (dx * dx) + (dy * dy) + (dz * dz);
	if (lengthSq <= 1e-8) {
		return 0;
	}

	const px = currentPosition.x - start.x;
	const py = currentPosition.y - start.y;
	const pz = currentPosition.z - start.z;
	const projection = ((px * dx) + (py * dy) + (pz * dz)) / lengthSq;
	return Math.max(0, Math.min(1, projection));
}

/* === MOVEMENT === */

function normalizeMovement(movement, surface) {
	// Movement start/end are local to the spawn surface — resolve to world space.
	// Y uses surfaceTopY (top of the surface) instead of surfacePos.y (center of the surface).
	const surfaceOrigin = getSurfaceOrigin(surface);
	movement.start.add(surfaceOrigin);
	movement.end.add(surfaceOrigin);

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
			parts: Array.isArray(overrides.model.parts)
				? overrides.model.parts
				: Array.isArray(base.model.parts)
					? base.model.parts
					: [],
		},
	};
}

/* === PART BUILDING === */

function buildPart(partDefinition) {
	const source = partDefinition;

	const mesh = BuildObject(
		{
			id: source.id,
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
			collisionShape: "none",
			parentId: source.parentId,
		},
		{ role: "entity-part" }
	);

	const resolvedParentId = source.parentId;
	return {
		id: mesh.id,
		label: source.label || null,
		parentId: resolvedParentId,
		anchorPoint: source.anchorPoint,
		attachmentPoint: source.attachmentPoint,
		children: [],
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
		if (part.parentId !== "root") index[part.parentId].children.push(part.id);
	});

	// Identify root parts and non-root parts.
	const rootPartIds = parts.filter((p) => p.parentId === "root").map((p) => p.id);

	// Resolve spawn surface.
	const spawnSurfaceId = sourceModel.spawnSurfaceId;
	const surface = surfaceMap[spawnSurfaceId];
	const surfaceOrigin = getSurfaceOrigin(surface);

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
		const combinedScale = MultiplyVector3(rtScale, localScale);

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
		rootPart.builtDimensions.set(MultiplyVector3(dims, combinedScale));
	}

	const processQueue = [];
	for (const rootPartId of rootPartIds) {
		const rootPart = index[rootPartId];
		for (const childId of rootPart.children) processQueue.push(childId);
	}

	const processed = new Set(rootPartIds);
	while (processQueue.length > 0) {
		const partId = processQueue.shift();
		if (processed.has(partId)) continue;
		processed.add(partId);

		const part = index[partId];

		const parentPart = index[part.parentId];

		const partDims = part.dimensions;
		const localScale = part.localTransform.scale;

		// Combined scale.
		const combinedScale = MultiplyVector3(rtScale, localScale);

		// Parent's attachment point offset (in parent's scaled dimensions).
		const attachOffset = getFaceCenterOffset(parentPart.builtDimensions, part.attachmentPoint);

		// Part's anchor point offset (in part's unscaled dimensions), then scaled.
		const anchorOffset = getFaceCenterOffset(partDims, part.anchorPoint);
		const scaledAnchorOffset = MultiplyVector3(anchorOffset, combinedScale);

		// Position: attachment offset on parent - scaled anchor offset on part + localPosition.
		part.localTransform.position.add(SubtractVector3(attachOffset, scaledAnchorOffset));

		// Store builtDimensions (scaled) for child attachment offset computation.
		part.builtDimensions.set(MultiplyVector3(partDims, combinedScale));
		part.faceMap = remapFacesAfterRotation(part.localTransform.rotation);

		// Enqueue children.
		for (const childId of part.children) processQueue.push(childId);
	}

	// --- Assemble model with world-space rootTransform ---
	// Factor 1 (spawn surface position) + Factor 2 (rootTransform.position) = world position.
	const rootPosition = rtPosition.clone().add(surfaceOrigin);

	const model = {
		rootTransform: {
			position: rootPosition,
			rotation: rtRotation,
			scale: rtScale,
			pivot: rtSource.pivot,
		},
		spawnSurfaceId: spawnSurfaceId,
		surfacePosition: surfaceOrigin,
		parts: parts,
		index: index,
		roots: rootPartIds,
	};

	// Apply initial pose to set mesh transforms (like player Model.js).
	applyModelPose(model);

	// Snapshot default pose for ResetEntityToDefaultPose.
	model.defaultPose = {
		rootTransform: cloneRootTransform(model.rootTransform),
		parts: parts.map((part) => ({
			id: part.id,
			localTransform: cloneLocalTransform(part.localTransform),
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

	const rootTransform = cloneRootTransform(model.rootTransform);
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
		min: new UnitVector3(minX, minY, minZ, "cnu"),
		max: new UnitVector3(maxX, maxY, maxZ, "cnu"),
	};
}

function computeExpandedAabb(aabb, padding) {
	return {
		min: new UnitVector3(aabb.min.x - padding, aabb.min.y - padding, aabb.min.z - padding, "cnu"),
		max: new UnitVector3(aabb.max.x + padding, aabb.max.y + padding, aabb.max.z + padding, "cnu"),
	};
}

function resolveEntityCollisionShape(entityType) {
	// Deterministic type → shape lookup.
	switch (entityType) {
		case "player": return "sphere";
		case "enemy": return "aabb";
		case "enemy-large":
		case "enemy-irregular":
			return "sphere";
		case "boss": return "compound-sphere";
		case "projectile": return "sphere";
		case "collectible": return "aabb";
		case "npc": return "capsule";
		default: return "sphere";
	}
}

/**
 * Resolve per-layer shapes for physics / hurtbox / hitbox.
 * Returns { physics, hurtbox, hitbox } shape strings.
 */
function resolveEntityLayerShapes(entityType) {
	const physics = resolveEntityCollisionShape(entityType);
	switch (entityType) {
		case "player": return { physics, hurtbox: "sphere", hitbox: "sphere" };
		case "enemy": return { physics, hurtbox: "aabb", hitbox: "aabb" };
		case "enemy-large":
		case "enemy-irregular":
			return { physics, hurtbox: "sphere", hitbox: "sphere" };
		case "boss": return { physics, hurtbox: "compound-sphere", hitbox: "compound-sphere" };
		case "projectile": return { physics, hurtbox: "sphere", hitbox: null };
		case "collectible": return { physics, hurtbox: "aabb", hitbox: null };
		case "npc": return { physics, hurtbox: null, hitbox: null };
		default: return { physics, hurtbox: physics, hitbox: null };
	}
}

function computeCapsuleFromAabb(aabb, overrides = {}) {
	const width = aabb.max.x - aabb.min.x;
	const height = aabb.max.y - aabb.min.y;
	const depth = aabb.max.z - aabb.min.z;
	const autoRadius = Math.max(width, depth) * 0.5;
	const radius = Math.max(0.0001, ToNumber(overrides.radius, autoRadius));
	const autoHalfHeight = Math.max(0, (height * 0.5) - radius);
	const halfHeight = Math.max(0, ToNumber(overrides.halfHeight, autoHalfHeight));
	const centerX = (aabb.min.x + aabb.max.x) * 0.5;
	const centerY = (aabb.min.y + aabb.max.y) * 0.5;
	const centerZ = (aabb.min.z + aabb.max.z) * 0.5;

	return {
		type: "capsule",
		radius: new Unit(radius, "cnu"),
		halfHeight: new Unit(halfHeight),
		segmentStart: new UnitVector3(centerX, centerY - halfHeight, centerZ, "cnu"),
		segmentEnd: new UnitVector3(centerX, centerY + halfHeight, centerZ, "cnu"),
	};
}

function computeSphereFromAabb(aabb) {
	const half = aabb.max.clone().subtract(aabb.min).scale(0.5);
	const radius = Math.sqrt(half.x * half.x + half.y * half.y + half.z * half.z);
	return {
		type: "sphere",
		center: aabb.min.clone().add(aabb.max).scale(0.5),
		radius: new Unit(Math.max(0.0001, radius), "cnu"),
	};
}

function computeCompoundSpheresFromModel(model, overrides) {
	const spheres = [];
	model.parts.forEach((part) => {
		const sphere = computeSphereFromAabb(part.mesh.worldAabb);
		const partOverride = overrides && overrides[part.id];
		if (partOverride) {
			if (partOverride.radiusScale) sphere.radius.value *= partOverride.radiusScale;
			if (partOverride.centerOffset) sphere.center.add(partOverride.centerOffset);
		}
		spheres.push({
			center: sphere.center,
			radius: sphere.radius,
			partId: part.id,
		});
	});
	return {
		type: "compound-sphere",
		spheres: spheres,
	};
}

function computeScaledBounds(bounds, scaleFactor) {
	if (bounds.type === "sphere") {
		return {
			type: "sphere",
			center: bounds.center.clone(),
			radius: new Unit(bounds.radius.value * scaleFactor, bounds.radius.unit),
		};
	}
	else if (bounds.type === "aabb") {
		const center = ScaleVector3(AddVector3(bounds.min, bounds.max), 0.5);
		const half = ScaleVector3(SubtractVector3(bounds.max, bounds.min), 0.5 * scaleFactor);
		return {
			type: "aabb",
			min: bounds.min.clone().set(SubtractVector3(center, half)),
			max: bounds.max.clone().set(AddVector3(center, half)),
		};
	}
	else if (bounds.type === "capsule") {
		return {
			type: "capsule",
			radius: new Unit(bounds.radius.value * scaleFactor, bounds.radius.unit),
			halfHeight: new Unit(bounds.halfHeight.value * scaleFactor, bounds.halfHeight.unit),
			segmentStart: bounds.segmentStart.clone(),
			segmentEnd: bounds.segmentEnd.clone(),
		};
	}
	else if (bounds.type === "compound-sphere") {
		return {
			type: "compound-sphere",
			spheres: bounds.spheres.map((s) => ({
				center: s.center.clone(),
				radius: new Unit(s.radius.value * scaleFactor, s.radius.unit),
				partId: s.partId,
			})),
		};
	}
	// OBB: scale half-extents.
	else if (bounds.type === "obb") {
		return {
			type: "obb",
			center: bounds.center.clone(),
			halfExtents: bounds.halfExtents.clone().scale(scaleFactor),
			axes: bounds.axes,
		};
	}
	return bounds;
}

/**
 * Build the bounds object for a given shape type from entity AABB/model.
 */
function buildBoundsForShape(shape, aabb, model, overrides) {
	switch (shape) {
		case "sphere": return computeSphereFromAabb(aabb);
		case "aabb": return { type: "aabb", min: aabb.min, max: aabb.max };
		case "capsule": return computeCapsuleFromAabb(aabb, overrides);
		case "obb": return computeObbFromAabb(aabb);
		case "compound-sphere": return computeCompoundSpheresFromModel(model, overrides);
		default: return computeSphereFromAabb(aabb);
	}
}

function computeObbFromAabb(aabb) {
	return {
		type: "obb",
		center: aabb.min.clone().add(aabb.max).scale(0.5),
		halfExtents: aabb.max.clone().subtract(aabb.min).scale(0.5),
		axes: [
			{ x: 1, y: 0, z: 0 },
			{ x: 0, y: 1, z: 0 },
			{ x: 0, y: 0, z: 1 },
		],
	};
}

/**
 * Compute three-layer collision data for an entity.
 * Returns { physics, hurtbox, hitbox, collisionShape, detailedBounds } where
 * detailedBounds is the physics bounds (backward compat).
 */
function computeDetailedBoundsForEntity(entityType, aabb, model, overrides) {
	const layers = resolveEntityLayerShapes(entityType);
	const collisionOverride = overrides.collisionOverride;
	const capsuleOverride = overrides.collisionCapsule;

	// Physics collider bounds.
	const physicsShape = (collisionOverride && collisionOverride.physics) || layers.physics;
	const physicsBounds = buildBoundsForShape(physicsShape, aabb, model, capsuleOverride);

	// Hurtbox bounds (null = immune to damage).
	let hurtbox = null;
	if (layers.hurtbox) {
		const hurtboxShape = (collisionOverride && collisionOverride.hurtbox) || layers.hurtbox;
		const baseBounds = buildBoundsForShape(hurtboxShape, aabb, model, capsuleOverride);

		// Player hurtbox is 0.9× radius; boss compound hurtbox is 1.05× radii.
		switch(entityType) {
			case "player": hurtbox = { shape: hurtboxShape, bounds: computeScaledBounds(baseBounds, 0.9) };  break;
			case "boss"  : hurtbox = { shape: hurtboxShape, bounds: computeScaledBounds(baseBounds, 1.05) }; break;
			default      : hurtbox = { shape: hurtboxShape, bounds: baseBounds };                            break;
		}
	}

	// Hitbox bounds (null = can't deal damage).
	let hitbox = null;
	if (layers.hitbox) {
		const hitboxShape = (collisionOverride && collisionOverride.hitbox) || layers.hitbox;
		const baseBounds = buildBoundsForShape(hitboxShape, aabb, model, capsuleOverride);
		// Player hitbox is 1.1× radius.
		if (entityType === "player") {
			hitbox = { shape: hitboxShape, bounds: computeScaledBounds(baseBounds, 1.1) };
		} 
		else hitbox = { shape: hitboxShape, bounds: baseBounds };
	}

	return {
		collisionShape: physicsShape,
		detailedBounds: physicsBounds,
		physics: { shape: physicsShape, bounds: physicsBounds },
		hurtbox: hurtbox,
		hitbox: hitbox,
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
	const simRadiusPadding = ToNumber(merged.simRadiusPadding, 8);
	const rootTrans = model.rootTransform;
	const initialMovementProgress = resolveInitialMovementProgress(movement, rootTrans.position);

	if (movement.speed.value > 0) {
		rootTrans.position.set(LerpVector3(movement.start, movement.end, initialMovementProgress));
		applyModelPose(model);
	}

	const aabb = computeEntityAabb(model);
	const detailed = computeDetailedBoundsForEntity(merged.type, aabb, model, {
		collisionCapsule: merged.collisionCapsule,
		collisionOverride: merged.collisionOverride,
	});

	return {
		id: merged.id,
		type: merged.type,
		hp: Math.max(0, ToNumber(merged.hp, 1)),
		attacks: merged.attacks,
		hardcoded: merged.hardcoded,
		platform: merged.platform,
		collisionCapsule: merged.collisionCapsule,
		collisionOverride: merged.collisionOverride,
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
			shape: detailed.collisionShape,
			detailedBounds: detailed.detailedBounds,
			physics: detailed.physics,
			hurtbox: detailed.hurtbox,
			hitbox: detailed.hitbox,
		},
		hitboxActive: false,
		animations: merged.animations,
		state: {
			movementProgress: initialMovementProgress,
			direction: 1,
			lastJumpMs: 0,
			activeAnimation: "idle",
		},
		physicsRuntime: {
			previousPosition: rootTrans.position.clone(),
			previousRotation: rootTrans.rotation.clone(),
			hasUnresolvedPenetration: false,
			cachePrimed: false,
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
	const detailed = computeDetailedBoundsForEntity(entity.type, entity.collision.aabb, entity.model, {
		collisionCapsule: entity.collisionCapsule,
		collisionOverride: entity.collisionOverride,
	});
	entity.collision.shape = detailed.collisionShape;
	entity.collision.detailedBounds = detailed.detailedBounds;
	entity.collision.physics = detailed.physics;
	entity.collision.hurtbox = detailed.hurtbox;
	entity.collision.hitbox = detailed.hitbox;
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
	const detailed = computeDetailedBoundsForEntity(entity.type, entity.collision.aabb, entity.model, {
		collisionCapsule: entity.collisionCapsule,
		collisionOverride: entity.collisionOverride,
	});
	entity.collision.shape = detailed.collisionShape;
	entity.collision.detailedBounds = detailed.detailedBounds;
	entity.collision.physics = detailed.physics;
	entity.collision.hurtbox = detailed.hurtbox;
	entity.collision.hitbox = detailed.hitbox;
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