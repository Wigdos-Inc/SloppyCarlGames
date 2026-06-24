// Creates Models for anything that should support being animated.
// Builds entity models from the ground up with automatic grounding and
// anchor/attachment-point–based part positioning.

// Called by NewBoss.js, player/Model.js, helpers/game/Level.js and helpers/Cutscene.js for Entity Models
// Uses NewObject.js for Model Parts

import { BuildObject, UpdateObjectWorldAabb } from "./NewObject.js";
import {
	AddVector3,
	CloneVector3,
	DotVector3,
	LerpVector3,
	MultiplyVector3,
	RotateByEuler,
	ScaleVector3,
	SubtractVector3,
	ToVector3,
	Vector3Sq,
	WORLD_NORMALS,
} from "../math/Vector3.js";
import { Clamp01, Unit, UnitVector3 } from "../math/Utilities.js";

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
		{ label: "right",  dir: WORLD_NORMALS.Right },
		{ label: "left",   dir: WORLD_NORMALS.Left },
		{ label: "top",    dir: WORLD_NORMALS.Up },
		{ label: "bottom", dir: WORLD_NORMALS.Down },
		{ label: "front",  dir: WORLD_NORMALS.Forward },
		{ label: "back",   dir: WORLD_NORMALS.Backward },
	];

	const remap = {};
	const claimed = new Set();

	// Rotate each canonical face normal → find the world axis it best aligns with.
	const rotatedEntries = [
		{ name: "top", rotated: RotateByEuler(WORLD_NORMALS.Up, rotation) },
		{ name: "bottom", rotated: RotateByEuler(WORLD_NORMALS.Down, rotation) },
		{ name: "front", rotated: RotateByEuler(WORLD_NORMALS.Forward, rotation) },
		{ name: "back", rotated: RotateByEuler(WORLD_NORMALS.Backward, rotation) },
		{ name: "left", rotated: RotateByEuler(WORLD_NORMALS.Left, rotation) },
		{ name: "right", rotated: RotateByEuler(WORLD_NORMALS.Right, rotation) },
	];

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
	const position = transform.position.clone();
	const rotation = transform.rotation.clone();
	const scale = transform.scale;
	const pivot = transform.pivot.clone();
	return { position, rotation, scale, pivot };
}

function cloneLocalTransform(transform) {
	const position = transform.position.clone();
	const rotation = transform.rotation.clone();
	const scale = transform.scale;
	return { position, rotation, scale };
}

function ComposeTransform(parentTransform, localTransform) {
	const localPosition = localTransform.position.clone();
	const rotatedChildPos = RotateByEuler(localPosition, parentTransform.rotation);
	return {
		position: localPosition.set(AddVector3(parentTransform.position, rotatedChildPos)),
		rotation: localTransform.rotation.clone().add(parentTransform.rotation),
		scale: MultiplyVector3(parentTransform.scale, localTransform.scale),
	};
}

const getSurfaceOrigin = (surface) => { return { x: surface.position.x, y: surface.topY, z: surface.position.z } };

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
	// Clone start/end so the cached entity definition is never mutated (reloads stay idempotent).
	const surfaceOrigin = getSurfaceOrigin(surface);
	return {
		...movement,
		start: movement.start.clone().add(surfaceOrigin),
		end  : movement.end.clone().add(surfaceOrigin),
	};
}

/* === PART BUILDING === */

function buildPart(source, textureScale, faceTextureStore, geometryCache, geometryCacheKeyPrefix) {
	const { mesh } = BuildObject(
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
			textureScale, faceTextureStore, geometryCache,
			geometryCacheKey: `${geometryCacheKeyPrefix}::${source.id}`,
		}
	);

	return {
		id             : mesh.id,
		label          : source.label || null,
		parentId       : source.parentId,
		anchorPoint    : source.anchorPoint,
		attachmentPoint: source.attachmentPoint,
		addsToBounds   : source.addsToBounds,
		children: [],
		localTransform: {
			position: source.localPosition.clone(),
			rotation: source.localRotation.clone(),
			scale   : CloneVector3(source.localScale),
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

function buildModel(entityDefinition, surfaceMap, textureScale, faceTextureStore, geometryCache) {
	// --- Step 1: Resolve rootTransform from data ---
	const rtScale = entityDefinition.model.rootTransform.scale;
	const geometryCacheKeyPrefix = entityDefinition.blueprintId !== null ? entityDefinition.blueprintId : entityDefinition.id;

	// Build all parts (each part wraps its own values in Unit/UnitVector3).
	const parts = entityDefinition.model.parts.map((part) => buildPart(part, textureScale, faceTextureStore, geometryCache, geometryCacheKeyPrefix));

	// Build index and parent-child links.
	const index = {};
	parts.forEach((part) => { 
		index[part.id] = part; 
		if (part.parentId !== "root") index[part.parentId].children.push(part.id);
	});

	// Identify root parts and non-root parts.
	const rootPartIds = parts.filter((p) => p.parentId === "root").map((p) => p.id);

	// Resolve spawn surface.
	const spawnSurfaceId = entityDefinition.model.spawnSurfaceId;
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

		// Set localTransform.position: grounding + localPosition (model-local, relative to rootTransform).
		rootPart.localTransform.position.y += rootPart.dimensions.y * combinedScale.y * 0.5;

		// Store builtDimensions (scaled) for child attachment offset computation.
		rootPart.builtDimensions.set(MultiplyVector3(rootPart.dimensions, combinedScale));
	}

	const processQueue = [];
	for (const rootPartId of rootPartIds) {
		for (const childId of index[rootPartId].children) processQueue.push(childId);
	}

	const processed = new Set(rootPartIds);
	while (processQueue.length > 0) {
		const partId = processQueue.shift();
		if (processed.has(partId)) continue;
		processed.add(partId);

		const part = index[partId];

		// Combined scale.
		const combinedScale = MultiplyVector3(rtScale, part.localTransform.scale);

		// Parent's attachment point offset (in parent's scaled dimensions).
		const attachOffset = getFaceCenterOffset(index[part.parentId].builtDimensions, part.attachmentPoint);

		// Part's anchor point offset (in part's unscaled dimensions), then scaled.
		const scaledAnchorOffset = MultiplyVector3(getFaceCenterOffset(part.dimensions, part.anchorPoint), combinedScale);
		const rotatedAnchorOffset = RotateByEuler(scaledAnchorOffset, part.localTransform.rotation);

		// Position: attachment offset on parent - rotated anchor offset on part + localPosition.
		part.localTransform.position.add(SubtractVector3(attachOffset, rotatedAnchorOffset));

		// Store builtDimensions (scaled) for child attachment offset computation.
		part.builtDimensions.set(MultiplyVector3(part.dimensions, combinedScale));
		part.faceMap = remapFacesAfterRotation(part.localTransform.rotation);

		// Enqueue children.
		for (const childId of part.children) processQueue.push(childId);
	}

	// --- Model assembled with world-space rootTransform ---
	// Factor 1 (spawn surface position) + Factor 2 (rootTransform.position) = world position.

	const model = {
		rootTransform: {
			position: entityDefinition.model.rootTransform.position.clone().add(surfaceOrigin),
			rotation: entityDefinition.model.rootTransform.rotation,
			scale: rtScale,
			pivot: entityDefinition.model.rootTransform.pivot,
		},
		spawnSurfaceId,
		surfacePosition: surfaceOrigin,
		parts, index,
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

	return { model };
}

/* === RUNTIME POSE APPLICATION === */

function applyModelPose(model) {
	const applyPart = (partId, parentTransform) => {
		const part = model.index[partId];

		const worldTransform = ComposeTransform(parentTransform, part.localTransform);
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
		if (part.addsToBounds === false) return;
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
	return {
		type: "sphere",
		center: aabb.min.clone().add(aabb.max).scale(0.5),
		radius: new Unit(Math.max(0.0001, Math.sqrt(Vector3Sq(aabb.max.clone().subtract(aabb.min).scale(0.5)))), "cnu"),
	};
}

function computeCompoundSpheresFromModel(model) {
	const spheres = [];
	model.parts.forEach((part) => {
		if (part.addsToBounds === false) return;
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
						const radius = s.radius.clone(); 
						radius.value *= scaleFactor;
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
			WORLD_NORMALS.Right,
			WORLD_NORMALS.Up,
			WORLD_NORMALS.Forward,
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
	const physicsBounds = buildBoundsForShape(collisionOverride.physics, aabb, model);

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
		collisionShape: collisionOverride.physics,
		detailedBounds: physicsBounds,
		physics: { shape: collisionOverride.physics, bounds: physicsBounds },
		hurtbox: hurtbox,
		hitbox: hitbox,
	};
}

/* === PUBLIC API === */

/**
 * Build an entity from a merged definition.
 * @param {object} definition — merged blueprint + level overrides.
 * @param {object} surfaceMap — { [surfaceId]: { position, dimensions, scale, topY } }
 * @param {number} textureScale — world texture scale (px per CNU) for per-face generated textures.
 * @param {object} faceTextureStore — content-signature-keyed store the per-face bake dedups against
 *   (a build-scoped accumulator at level build, the live textureRegistry at runtime spawn).
 * @param {Map} geometryCache — (blueprintId::partId)-keyed store of frozen part geometry templates,
 *   shared by reference across all same-blueprint instances (level-scoped, persists for runtime spawns).
 */
function BuildEntity(definition, surfaceMap, textureScale, faceTextureStore, geometryCache) {

	// Resolve spawn surface for movement localization.
	const movement = normalizeMovement(definition.movement, surfaceMap[definition.model.spawnSurfaceId]);
	const { model } = buildModel(definition, surfaceMap, textureScale, faceTextureStore, geometryCache);
	const rootTrans = model.rootTransform;
	const initialMovementProgress = resolveInitialMovementProgress(movement, rootTrans.position);

	if (movement.speed.value > 0) {
		rootTrans.position.set(LerpVector3(movement.start, movement.end, initialMovementProgress));
		applyModelPose(model);
	}

	const aabb = computeEntityAabb(model);
	const detailed = computeDetailedBoundsForEntity(definition.type, aabb, model, definition.collisionOverride);
	const simRadiusPadding = new Unit(8, "cnu");

	const entity = {
		id: definition.id,
		type: definition.type,
		hp: definition.hp,
		attacks: definition.attacks,
		hardcoded: definition.hardcoded,
		platform: definition.platform,
		collisionOverride: definition.collisionOverride,
		customEvents: definition.customEvents,
		movement: movement,
		transform: {
			position: rootTrans.position,
			rotation: rootTrans.rotation,
			scale: rootTrans.scale,
		},
		velocity: definition.velocity,
		submergence: 0,
		underwater: false,
		buoyancyForce: 0,
		model,
		mesh: model.parts[0].mesh,
		collision: {
			aabb, simRadiusPadding,
			simRadiusAabb : computeExpandedAabb(aabb, simRadiusPadding),
			shape         : detailed.collisionShape,
			detailedBounds: detailed.detailedBounds,
			physics       : detailed.physics,
			hurtbox       : detailed.hurtbox,
			hitbox        : detailed.hitbox,
		},
		hitboxActive: detailed.hitbox !== null,
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
			lastPhysicsCollisionKey: "",
		},
	};

	return { entity };
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

	entity.model.defaultPose.parts.forEach((posePart) => {
		const part = entity.model.index[posePart.id];
		const src = posePart.localTransform;
		part.localTransform.position.set(src.position);
		part.localTransform.rotation.set(src.rotation);
		part.localTransform.scale = src.scale;
	});

	refreshEntityDerivedState(entity);
}

const SampleMovementPoint = (entity, normalizedTime) => LerpVector3(entity.movement.start, entity.movement.end, normalizedTime);

export {
	BuildEntity,
	UpdateEntityModelFromTransform,
	ResetEntityToDefaultPose,
	SampleMovementPoint,
	ComposeTransform,
};