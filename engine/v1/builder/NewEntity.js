// Creates Models for anything that should support being animated.
// Builds entity models from the ground up with automatic grounding and
// anchor/attachment-point–based part positioning.

// Called by NewBoss.js, player/Model.js, helpers/game/Level.js and helpers/Cutscene.js for Entity Models
// Uses NewObject.js for Model Parts

import { BuildObject, UpdateObjectWorldAabb } from "./NewObject.js";
import { 
	AddVector3, 
	DotVector3, 
	LerpVector3, 
	MultiplyVector3, 
	RotateByEuler, 
	ScaleVector3, 
	SubtractVector3, 
	ToVector3, 
	Vector3Sq 
} from "../math/Vector3.js";
import { Clamp01, Unit, UnitVector3 } from "../math/Utilities.js";

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
		case "center": return ToVector3(0);
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

	const remap = {};
	const claimed = new Set();

	// Rotate each canonical face normal → find the world axis it best aligns with.
	const rotatedEntries = Object.keys(faceNormals).map((name) => {
		return { name, rotated: RotateByEuler(faceNormals[name], rotation) };
	});

	// Sort by best alignment (highest dot product first) to prevent ties from producing duplicates.
	const assignments = [];
	for (const entry of rotatedEntries) {
		let bestDot = -Infinity;
		let bestLabel = "top";
		for (const axis of worldAxes) {
			const d = DotVector3(entry.rotated, axis.dir);
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
		} 
		else {
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
	const rotatedChildPos = RotateByEuler(localPosition, parentTransform.rotation);
	return {
		position: localPosition.set(AddVector3(parentTransform.position, rotatedChildPos)),
		rotation: localTransform.rotation.clone().add(parentTransform.rotation),
		scale: MultiplyVector3(parentTransform.scale, localTransform.scale),
	};
}

function getSurfaceOrigin(surface) {
	return { x: surface.position.x, y: surface.topY, z: surface.position.z };
}

function resolveInitialMovementProgress(movement, currentPosition) {
	const d = SubtractVector3(movement.end, movement.start);
	const lengthSq = Vector3Sq(d);
	if (lengthSq <= 1e-8) return 0;

	const p = SubtractVector3(currentPosition, movement.start);
	const projection = DotVector3(p, d) / lengthSq;
	return Clamp01(projection);
}

/* === MOVEMENT === */

function normalizeMovement(movement, surface) {
	// Movement start/end are local to the spawn surface — resolve to world space.
	// Y uses surfaceTopY (top of the surface) instead of surfacePos.y (center of the surface).
	const surfaceOrigin = getSurfaceOrigin(surface);
	movement.start.add(surfaceOrigin);
	movement.end.add(surfaceOrigin);
	return movement;
}

/* === PART BUILDING === */

function buildPart(partDefinition) {
	const source = partDefinition;

	const mesh = BuildObject(
		{
			id              : source.id,
			shape           : source.shape,
			complexity      : source.complexity,
			dimensions      : source.dimensions,
			position        : new UnitVector3(0, 0, 0, "cnu"),
			rotation        : new UnitVector3(0, 0, 0, "radians"),
			scale           : ToVector3(1),
			pivot           : source.pivot,
			primitiveOptions: source.primitiveOptions,
			texture         : source.texture,
			detail          : source.detail,
			role            : "entity-part",
			collisionShape  : "none",
			parentId        : source.parentId,
		}
	);

	const resolvedParentId = source.parentId;
	return {
		id             : mesh.id,
		label          : source.label || null,
		parentId       : resolvedParentId,
		anchorPoint    : source.anchorPoint,
		attachmentPoint: source.attachmentPoint,
		children: [],
		localTransform: {
			position: source.localPosition,
			rotation: source.localRotation,
			scale   : source.localScale,
		},
		defaultLocalTransform: {
			position: source.localPosition,
			rotation: source.localRotation,
			scale   : source.localScale,
		},
		dimensions: source.dimensions,
		// World-space built position/rotation/scale — computed by the pipeline, used for mesh output.
		builtPosition  : new UnitVector3(0, 0, 0, "cnu"),
		builtRotation  : new UnitVector3(0, 0, 0, "radians"),
		builtScale     : ToVector3(0),
		builtDimensions: source.dimensions.clone(),
		faceMap        : null,
		mesh,
	};
}

/* === MODEL BUILDING === */

function buildModel(entityDefinition, surfaceMap) {
	const sourceModel = entityDefinition.model;

	// --- Step 1: Resolve rootTransform from data ---
	const rtSource   = sourceModel.rootTransform;
	const rtPosition = rtSource.position;
	const rtRotation = rtSource.rotation;
	const rtScale    = rtSource.scale;

	// Build all parts (each part wraps its own values in Unit/UnitVector3).
	const parts = sourceModel.parts.map((part) => buildPart(part));

	// Build index and parent-child links.
	const index = {};
	parts.forEach((part) => { 
		index[part.id] = part; 
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

		// Face remapping after rotation.
		rootPart.faceMap = remapFacesAfterRotation(rootPart.localTransform.rotation);

		// Combined scale for dimensions computation.
		const combinedScale = MultiplyVector3(rtScale, rootPart.localTransform.scale);

		// Grounding: half-height of scaled part so bottom face sits at Y=0 in model-local space.
		const scaledHalfHeight = rootPart.dimensions.y * combinedScale.y * 0.5;

		// Set localTransform.position: grounding + localPosition (model-local, relative to rootTransform).
		rootPart.localTransform.position.y += scaledHalfHeight;

		// Store builtDimensions (scaled) for child attachment offset computation.
		rootPart.builtDimensions.set(MultiplyVector3(rootPart.dimensions, combinedScale));
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
	const min = ToVector3(Infinity);
	const max = ToVector3(-Infinity);

	model.parts.forEach((part) => {
		const mesh = part.mesh;
		const bounds = mesh.worldAabb;

		if (bounds.min.x < min.x) min.x = bounds.min.x;
		if (bounds.min.y < min.y) min.y = bounds.min.y;
		if (bounds.min.z < min.z) min.z = bounds.min.z;
		if (bounds.max.x > max.x) max.x = bounds.max.x;
		if (bounds.max.y > max.y) max.y = bounds.max.y;
		if (bounds.max.z > max.z) max.z = bounds.max.z;
	});

	return {
		min: new UnitVector3(min.x, min.y, min.z, "cnu"),
		max: new UnitVector3(max.x, max.y, max.z, "cnu"),
	};
}

function computeExpandedAabb(aabb, padding) {
	return {
		min: aabb.min.clone().subtract(ToVector3(padding.value)),
		max: aabb.max.clone().add(ToVector3(padding.value)),
	};
}

function computeCapsuleFromAabb(aabb) {
	const dim = SubtractVector3(aabb.max, aabb.min);
	const radius = Math.max(0.0001, Math.max(dim.x, dim.z) * 0.5);
	const halfHeight = Math.max(0, (dim.y * 0.5) - radius);

	const start = aabb.min.clone().add(aabb.max).scale(0.5);
	const end = start.clone();
	start.y -= halfHeight; 
	end.y += halfHeight;

	return {
		type: "capsule",
		radius: new Unit(radius, "cnu"),
		halfHeight: new Unit(halfHeight, "cnu"),
		segmentStart: start,
		segmentEnd: end,
	};
}

function computeSphereFromAabb(aabb) {
	const half = aabb.max.clone().subtract(aabb.min).scale(0.5);
	const radius = Math.sqrt(Vector3Sq(half));
	return {
		type: "sphere",
		center: aabb.min.clone().add(aabb.max).scale(0.5),
		radius: new Unit(Math.max(0.0001, radius), "cnu"),
	};
}

function computeCompoundSpheresFromModel(model) {
	const spheres = [];
	model.parts.forEach((part) => {
		const sphere = computeSphereFromAabb(part.mesh.worldAabb);
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
	switch (bounds.type) {
		case "sphere":
			const sphereRadius = bounds.radius.clone(); sphereRadius.value *= scaleFactor;
			return {
				type: "sphere",
				center: bounds.center.clone(),
				radius: sphereRadius,
			};
		case "aabb":
			const center = ScaleVector3(AddVector3(bounds.min, bounds.max), 0.5);
			const half = ScaleVector3(SubtractVector3(bounds.max, bounds.min), 0.5 * scaleFactor);
			return {
				type: "aabb",
				min: bounds.min.clone().set(SubtractVector3(center, half)),
				max: bounds.max.clone().set(AddVector3(center, half)),
			};
		case "capsule":
			const capsuleRadius = bounds.radius.clone(); capsuleRadius.value *= scaleFactor;
			const capsuleHalfHeight = bounds.halfHeight.clone(); capsuleHalfHeight.value *= scaleFactor;
			return {
				type: "capsule",
				radius: capsuleRadius,
				halfHeight: capsuleHalfHeight,
				segmentStart: bounds.segmentStart.clone(),
				segmentEnd: bounds.segmentEnd.clone(),
			};
		case "compound-sphere":
			return {
				type: "compound-sphere",
				spheres: bounds.spheres.map((s) => ({
					center: s.center.clone(),
					radius: (() => {
						const radius = s.radius.clone(); radius.value *= scaleFactor;
						return radius;
					})(),
					partId: s.partId,
				})),
			};
		case "obb":
			return {
				type: "obb",
				center: bounds.center.clone(),
				halfExtents: bounds.halfExtents.clone().scale(scaleFactor),
				axes: bounds.axes,
			};
	}
}

/**
 * Build the bounds object for a given shape type from entity AABB/model.
 */
function buildBoundsForShape(shape, aabb, model) {
	switch (shape) {
		case "sphere"         : return computeSphereFromAabb(aabb);
		case "aabb"           : return { type: "aabb", min: aabb.min, max: aabb.max };
		case "capsule"        : return computeCapsuleFromAabb(aabb);
		case "obb"            : return computeObbFromAabb(aabb);
		case "compound-sphere": return computeCompoundSpheresFromModel(model);
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
function computeDetailedBoundsForEntity(entityType, aabb, model, collisionOverride) {

	// Physics collider bounds.
	const physicsShape = collisionOverride.physics;
	const physicsBounds = buildBoundsForShape(physicsShape, aabb, model);

	// Hurtbox bounds (null = immune to damage).
	let hurtbox = null;
	if (collisionOverride.hurtbox !== null) {
		const hurtboxShape = collisionOverride.hurtbox;
		const baseBounds = buildBoundsForShape(hurtboxShape, aabb, model);

		// Player hurtbox is 0.9× radius; boss compound hurtbox is 1.05× radii.
		switch(entityType) {
			case "player": hurtbox = { shape: hurtboxShape, bounds: computeScaledBounds(baseBounds, 0.9) };  break;
			case "boss"  : hurtbox = { shape: hurtboxShape, bounds: computeScaledBounds(baseBounds, 1.05) }; break;
			default      : hurtbox = { shape: hurtboxShape, bounds: baseBounds };                            break;
		}
	}

	// Hitbox bounds (null = can't deal damage).
	let hitbox = null;
	if (collisionOverride.hitbox !== null) {
		const hitboxShape = collisionOverride.hitbox;
		const baseBounds = buildBoundsForShape(hitboxShape, aabb, model);
		// Player hitbox is 1.1× radius.
		if (entityType === "player") hitbox = { shape: hitboxShape, bounds: computeScaledBounds(baseBounds, 1.1) };
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

	// Resolve spawn surface for movement localization.
	const movement = normalizeMovement(definition.movement, surfaceMap[definition.model.spawnSurfaceId]);
	const model = buildModel(definition, surfaceMap);
	const rootTrans = model.rootTransform;
	const initialMovementProgress = resolveInitialMovementProgress(movement, rootTrans.position);

	if (movement.speed.value > 0) {
		rootTrans.position.set(LerpVector3(movement.start, movement.end, initialMovementProgress));
		applyModelPose(model);
	}

	const aabb = computeEntityAabb(model);
	const detailed = computeDetailedBoundsForEntity(definition.type, aabb, model, definition.collisionOverride);
	const simRadiusPadding = new Unit(8, "cnu");

	return {
		id: definition.id,
		type: definition.type,
		hp: definition.hp,
		attacks: definition.attacks,
		hardcoded: definition.hardcoded,
		platform: definition.platform,
		collisionOverride: definition.collisionOverride,
		movement: movement,
		transform: {
			position: rootTrans.position,
			rotation: rootTrans.rotation,
			scale: rootTrans.scale,
		},
		velocity: definition.velocity,
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
		animations: definition.animations,
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

function refreshEntityDerivedState(entity) {
	applyModelPose(entity.model);
	entity.collision.aabb = computeEntityAabb(entity.model);
	entity.collision.simRadiusAabb = computeExpandedAabb(
		entity.collision.aabb,
		entity.collision.simRadiusPadding
	);
	const detailed = computeDetailedBoundsForEntity(
		entity.type,
		entity.collision.aabb,
		entity.model,
		entity.collisionOverride
	);
	entity.collision.shape = detailed.collisionShape;
	entity.collision.detailedBounds = detailed.detailedBounds;
	entity.collision.physics = detailed.physics;
	entity.collision.hurtbox = detailed.hurtbox;
	entity.collision.hitbox = detailed.hitbox;
}

function UpdateEntityModelFromTransform(entity) {
	entity.model.rootTransform.position.set(entity.transform.position);
	entity.model.rootTransform.rotation.set(entity.transform.rotation);
	entity.model.rootTransform.scale = entity.transform.scale;

	refreshEntityDerivedState(entity);
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

	refreshEntityDerivedState(entity);
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