// Builds entities and keeps their models and collision bounds in step with their transforms.

// Used by NewLevel.js, NewParticles.js, handlers/game/Level.js and player/Model.js to build entities.
// Used by many modules to reset the entity model.
// Used by player/Master.js to reset the player's movement input memory.
// Used by handlers/game/Animation.js to compose part transforms.
// Uses NewObject.js to build model parts.
// Uses NewTemplate.js to resolve blueprint sources.

import { BuildObject, UpdateObjectWorldAabb } from "./NewObject.js";
import { ResolveEntitySource } from "./NewTemplate.js";
import {
	AddVector3,
	CloneVector3,
	CompareVector3,
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
import { ComposeEulerRotations } from "../math/Matrix.js";
import { AabbCenter, AabbHalfExtents, CapsuleFromAabb, ObbFromAabb, PointsAabb, SphereFromAabb } from "../math/Collision.js";
import { Clamp01, CloneTransform, Unit, UnitVector3 } from "../math/Utilities.js";
import { Log } from "../core/meta.js";

// Default/Fallback model-pose turn rate. Per second.
const defaultModelTurnRate = new Unit(450, "degrees").toRadians(true);

// Get the offset from a box's center to the center of one of its faces.
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

/* === TRANSFORM UTILITIES === */

// Check whether the model is already posed at this transform.
function poseMatchesTransform(model, transform) {
	return CompareVector3(model.posedTransform.position, transform.position) &&
		CompareVector3(model.posedTransform.rotation, transform.rotation) &&
		CompareVector3(model.posedTransform.scale, transform.scale);
}

// Check whether only the position changed. Then the pose can be shifted instead of rebuilt.
function poseOrientationMatches(model, transform) {
	return CompareVector3(model.posedTransform.rotation, transform.rotation) &&
		CompareVector3(model.posedTransform.scale, transform.scale);
}

function ComposeTransform(parentTransform, localTransform) {
	const localPosition = localTransform.position.clone();
	const rotatedChildPos = RotateByEuler(localPosition, parentTransform.rotation);
	return {
		position: localPosition.set(AddVector3(parentTransform.position, rotatedChildPos)),
		rotation: localTransform.rotation.clone().set(ComposeEulerRotations(parentTransform.rotation, localTransform.rotation)),
		scale   : MultiplyVector3(parentTransform.scale, localTransform.scale),
	};
}

const getSurfaceOrigin = (surface) => { return { x: surface.position.x, y: surface.topY, z: surface.position.z } };


/* === MOVEMENT === */

function resolveInitialMovementProgress(movement, currentPosition) {
	const d = SubtractVector3(movement.end, movement.start);
	const lengthSq = Vector3Sq(d);
	if (lengthSq <= 1e-8) return 0;

	const p = SubtractVector3(currentPosition, movement.start);
	const projection = DotVector3(p, d) / lengthSq;
	return Clamp01(projection);
}

// Move start and end from surface-local to world space, measured from the surface's top.
function normalizeMovement(movement, surface) {
	const surfaceOrigin = getSurfaceOrigin(surface);
	return {
		...movement,
		start: movement.start.clone().add(surfaceOrigin),
		end  : movement.end.clone().add(surfaceOrigin),
	};
}

/* === PART BUILDING === */

function buildPart(source, textureScale, faceTextureStore, geometryCache, geometryCacheKeyPrefix) {
	const { id, shape, complexity, dimensions, pivot, primitiveOptions, texture, detail, parentId, particle } = source;
	const { mesh } = BuildObject(
		{
			id, shape, complexity, dimensions,
			position        : new UnitVector3(0, 0, 0, "cnu"),
			rotation        : new UnitVector3(0, 0, 0, "radians"),
			scale           : ToVector3(1),
			pivot, primitiveOptions, texture, detail,
			role            : "entity-part",
			collisionShape  : "none",
			parentId, particle, textureScale, faceTextureStore, geometryCache,
			geometryCacheKey: `${geometryCacheKeyPrefix}::${source.id}`,
		}
	);

	const { anchorPoint, attachmentPoint, addsToBounds } = source
	return {
		id             : mesh.id,
		label          : source.label || null,
		parentId, anchorPoint, attachmentPoint, addsToBounds, children: [],
		localTransform: {
			position: source.localPosition.clone(),
			rotation: source.localRotation.clone(),
			scale   : CloneVector3(source.localScale),
		},
		dimensions: source.dimensions.clone(),
		builtDimensions: source.dimensions.clone(),
		mesh,
	};
}

/* === MODEL BUILDING === */

function buildModel(entityDefinition, surfaceMap, textureScale, faceTextureStore, geometryCache) {
	const rtScale = entityDefinition.model.rootTransform.scale;

	// Share cached part geometry between entities of the same blueprint. Then build all parts.
	const geometryCacheKeyPrefix = entityDefinition.blueprintId !== null 
		? entityDefinition.blueprintId 
		: entityDefinition.id;
	const parts = entityDefinition.model.parts.map((part) => 
		buildPart(part, textureScale, faceTextureStore, geometryCache, geometryCacheKeyPrefix)
	);

	// Index every part before linking children, letting parts be listed in any order.
	const index = {};
	parts.forEach((part) => index[part.id] = part);
	parts.forEach((part) => { 
		if (part.parentId !== "root") index[part.parentId].children.push(part.id) 
		});

	// Collect the root parts.
	const rootPartIds = parts.filter((p) => p.parentId === "root").map((p) => p.id);

	// Place each root part relative to the model's origin.
	for (const rootPartId of rootPartIds) {
		const rootPart = index[rootPartId];

		// Store the scaled size for placing children on this part.
		const combinedScale = MultiplyVector3(rtScale, rootPart.localTransform.scale);
		rootPart.localTransform.position.y += rootPart.dimensions.y * combinedScale.y * 0.5;
		rootPart.builtDimensions.set(MultiplyVector3(rootPart.dimensions, combinedScale));
	}

	// Place every other part on its parent, working down from the roots.
	const processQueue = [];
	for (const rootPartId of rootPartIds) for (const childId of index[rootPartId].children) processQueue.push(childId);

	const processed = new Set(rootPartIds);
	while (processQueue.length > 0) {
		const partId = processQueue.shift();
		if (processed.has(partId)) continue;
		processed.add(partId);

		const part = index[partId];
		const combinedScale = MultiplyVector3(rtScale, part.localTransform.scale);

		// Find the attachment point on the parent and the part's own anchor point (scaled & rotated).
		const attachOffset = getFaceCenterOffset(index[part.parentId].builtDimensions, part.attachmentPoint);
		const scaledAnchorOffset = MultiplyVector3(getFaceCenterOffset(part.dimensions, part.anchorPoint), combinedScale);
		const rotatedAnchorOffset = RotateByEuler(scaledAnchorOffset, part.localTransform.rotation);

		// Position the part's anchor against the parent's attachment point.
		part.localTransform.position.add(SubtractVector3(attachOffset, rotatedAnchorOffset));

		// Store the scaled size for placing children on this part.
		part.builtDimensions.set(MultiplyVector3(part.dimensions, combinedScale));

		// Enqueue children.
		for (const childId of part.children) processQueue.push(childId);
	}

	// Resolve spawn surface.
	const surfaceOrigin = getSurfaceOrigin(surfaceMap[entityDefinition.model.spawnSurfaceId]);

	// Assemble & pose the model, placing its root on the spawn surface.
	const model = {
		rootTransform: {
			position: entityDefinition.model.rootTransform.position.clone().add(surfaceOrigin),
			rotation: entityDefinition.model.rootTransform.rotation,
			scale: rtScale,
			pivot: entityDefinition.model.rootTransform.pivot,
		},
		spawnSurfaceId: entityDefinition.model.spawnSurfaceId,
		surfacePosition: surfaceOrigin,
		parts, index,
		roots: rootPartIds,
	};
	applyModelPose(model);

	// Ground the model by its collision box (no collidable parts = use full box instead).
	const colliding = collidingParts(model);
	model.rootTransform.position.y += model.rootTransform.position.y - computeEntityAabb(colliding.length > 0 ? colliding : parts).min.y;

	// Snapshot default pose for future reference.
	model.defaultPose = {
		rootTransform: CloneTransform(model.rootTransform),
		parts: parts.map((part) => ({
			id: part.id,
			localTransform: CloneTransform(part.localTransform),
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

		// Use a rough box for visual-only parts to skip fitting every vertex.
		UpdateObjectWorldAabb(part.mesh, part.addsToBounds === false);

		part.children.forEach((childId) => applyPart(childId, worldTransform));
	};

	model.posedTransform = CloneTransform(model.rootTransform);
	model.roots.forEach((rootId) => applyPart(rootId, model.posedTransform));
}

/* === AABB === */

// Collect parts with collision bounds.
const collidingParts = (model) => model.parts.filter((part) => part.addsToBounds !== false);

// Fit a box around the given parts' world boxes.
function computeEntityAabb(parts) {
	const { min, max } = PointsAabb(parts.flatMap((part) => [part.mesh.worldAabb.min, part.mesh.worldAabb.max]));
	return {
		min: parts[0].mesh.worldAabb.min.clone().set(min),
		max: parts[0].mesh.worldAabb.max.clone().set(max)
	};
}

function computeExpandedAabb(aabb, padding) {
	return {
		min: aabb.min.clone().subtract(ToVector3(padding.value)),
		max: aabb.max.clone().add(ToVector3(padding.value)),
	};
}

// Compute a rotation's sines and cosines once, for reuse across many points.
function computeRotationTrig(rotation) {
	return {
		cx: Math.cos(rotation.x), sx: Math.sin(rotation.x),
		cy: Math.cos(rotation.y), sy: Math.sin(rotation.y),
		cz: Math.cos(rotation.z), sz: Math.sin(rotation.z),
	};
}

// Rotate a point (Z, then X, then Y), using precomputed sines and cosines.
function rotateWithTrig(point, trig) {
	const p1x = point.x * trig.cz - point.y * trig.sz;
	const p1y = point.x * trig.sz + point.y * trig.cz;

	const p2y = p1y * trig.cx - point.z * trig.sx;
	const p2z = p1y * trig.sx + point.z * trig.cx;

	return {
		x: p1x * trig.cy + p2z * trig.sy,
		y: p2y,
		z: -p1x * trig.sy + p2z * trig.cy,
	};
}

// Scale then rotate a local offset, in the same order as CreateModelMatrix.
const transformOffset = (point, scale, trig) => rotateWithTrig(MultiplyVector3(point, scale), trig);

// Copy a Unit with its value scaled.
const scaleUnit = (u, f) => u.clone().math((u, f) => u * f, f);

// Fit a world box around a local box after scaling, rotating and moving it.
function placeAabbEnclosure(aabb, position, scale, trig) {
	const corners = Array.from({ length: 8 }, (_, corner) => ({
		x: (corner & 1) === 0 ? aabb.min.x : aabb.max.x,
		y: (corner & 2) === 0 ? aabb.min.y : aabb.max.y,
		z: (corner & 4) === 0 ? aabb.min.z : aabb.max.z,
	}));
	const placed = PointsAabb(corners, ToVector3(Infinity), ToVector3(-Infinity), (corner) => transformOffset(corner, scale, trig));
	return { 
		min: aabb.min.clone().set(placed.min).add(position), 
		max: aabb.max.clone().set(placed.max).add(position) 
	};
}

function computeCompoundSpheresFromModel(model) {
	const spheres = [];
	model.parts.forEach((part) => {
		if (part.addsToBounds === false) return;

		const sphere = SphereFromAabb(part.mesh.worldAabb, true);
		spheres.push({
			center: sphere.center,
			radius: sphere.radius,
			partId: part.id,
		});
	});
	return { type: "compound-sphere", spheres };
}

function computeScaledBounds(bounds, scaleFactor) {
	switch (bounds.type) {
		case "sphere":
			return {
				type  : "sphere",
				center: bounds.center.clone(),
				radius: scaleUnit(bounds.radius, scaleFactor),
			};
		case "aabb":
			const center = AabbCenter(bounds);
			const half = ScaleVector3(AabbHalfExtents(bounds), scaleFactor);
			return {
				type: "aabb",
				min : bounds.min.clone().set(SubtractVector3(center, half)),
				max : bounds.max.clone().set(AddVector3(center, half)),
			};
		case "capsule":
			return {
				type        : "capsule",
				radius      : scaleUnit(bounds.radius, scaleFactor),
				halfHeight  : scaleUnit(bounds.halfHeight, scaleFactor),
				segmentStart: bounds.segmentStart.clone(),
				segmentEnd  : bounds.segmentEnd.clone(),
			};
		case "compound-sphere":
			return {
				type: "compound-sphere",
				spheres: bounds.spheres.map((s) => ({
					center: s.center.clone(),
					radius: scaleUnit(s.radius, scaleFactor),
					partId: s.partId,
				})),
			};
		case "obb":
			return {
				type       : "obb",
				center     : bounds.center.clone(),
				halfExtents: bounds.halfExtents.clone().scale(scaleFactor),
				axes       : bounds.axes,
			};
	}
}

function resolvePhysicsShape(shape, aabb) {
	if (shape !== "auto") return shape;
	const dim = SubtractVector3(aabb.max, aabb.min);
	return dim.y > Math.max(dim.x, dim.z) ? "capsule" : "sphere";
}

// Build bounds of the given shape from the entity's box or model.
function buildBoundsForShape(shape, aabb, model) {
	switch (shape) {
		case "sphere"         : return SphereFromAabb(aabb, true);
		case "aabb"           : return { type: "aabb", min: aabb.min, max: aabb.max };
		case "capsule"        : return CapsuleFromAabb(aabb);
		case "obb"            : return ObbFromAabb(aabb);
		case "compound-sphere": return computeCompoundSpheresFromModel(model);
	}
}

// Place rest-pose bounds in world space. Compound spheres are rebuilt from the posed model instead.
function placeBoundsForShape(bounds, transform, model, trig) {
	const { type, center, radius, segmentStart, segmentEnd, halfExtents, halfHeight, axes } = bounds;
	const { position, scale } = transform;
	const widest = Math.max(scale.x, scale.y, scale.z);

	switch (type) {
		case "sphere":
			return {
				type  : "sphere",
				center: center.clone().set(AddVector3(transformOffset(center, scale, trig), position)),
				radius: scaleUnit(radius, widest),
			};
		case "aabb":
			return { type: "aabb", ...placeAabbEnclosure(bounds, position, scale, trig) };
		case "capsule":
			return {
				type        : "capsule",
				radius      : scaleUnit(radius, widest),
				halfHeight  : scaleUnit(halfHeight, scale.y),
				segmentStart: segmentStart.clone().set(AddVector3(transformOffset(segmentStart, scale, trig), position)),
				segmentEnd  : segmentEnd.clone().set(AddVector3(transformOffset(segmentEnd, scale, trig), position)),
			};
		case "obb":
			return {
				type       : "obb",
				center     : center.clone().set(AddVector3(transformOffset(center, scale, trig), position)),
				halfExtents: halfExtents.clone().set(MultiplyVector3(halfExtents, scale)),
				axes       : axes.map((axis) => rotateWithTrig(axis, trig)),
			};
		case "compound-sphere": return computeCompoundSpheresFromModel(model);
	}
}

// Build an entity's physics, hurtbox and hitbox bounds.
function computeDetailedBoundsForEntity(entityType, aabb, model, collisionOverride) {

	// Hurtbox bounds (null = immune to damage).
	let hurtbox = null;
	if (collisionOverride.hurtbox !== null) {
		const shape  = collisionOverride.hurtbox;
		const bounds = buildBoundsForShape(shape, aabb, model);

		// Shrink the player's hurtbox to 0.9× and grow a boss's to 1.05×.
		switch(entityType) {
			case "player": hurtbox = { shape, bounds: computeScaledBounds(bounds, 0.90) }; break;
			case "boss"  : hurtbox = { shape, bounds: computeScaledBounds(bounds, 1.05) }; break;
			default      : hurtbox = { shape, bounds };                                    break;
		}
	}

	// Hitbox bounds (null = can't deal damage).
	let hitbox = null;
	if (collisionOverride.hitbox !== null) {
		const shape  = collisionOverride.hitbox;
		const bounds = buildBoundsForShape(shape, aabb, model);

		// Grow the player's hitbox to 1.1×.
		hitbox = entityType === "player" ? { shape, bounds: computeScaledBounds(bounds, 1.1) } : { shape, bounds };
	}


	// Resolve "auto" to a sphere or capsule.
	const shape  = resolvePhysicsShape(collisionOverride.physics, aabb);
	const bounds = buildBoundsForShape(shape, aabb, model);
	return { physics: { shape, bounds }, hurtbox, hitbox };
}

// Measure the full box and every collider at rest, with the model posed at the origin.
function captureRestBounds(definition, model) {
	const rt = model.rootTransform;
	const saved = CloneTransform(rt);

	rt.position.set(ToVector3(0));
	rt.rotation.set(ToVector3(0));
	rt.scale = ToVector3(1);
	applyModelPose(model);

	// Box the colliding parts, reusing the full box when every part collides.
	const full      = computeEntityAabb(model.parts);
	const colliding = collidingParts(model);
	const aabb      = colliding.length === model.parts.length ? full : colliding.length > 0 ? computeEntityAabb(colliding) : null;
	const collision = aabb === null ? null : {
		aabb,
		groundCapsule: CapsuleFromAabb(aabb),
		...computeDetailedBoundsForEntity(definition.type, aabb, model, definition.collisionOverride),
	};

	rt.position.set(saved.position);
	rt.rotation.set(saved.rotation);
	rt.scale = saved.scale;
	applyModelPose(model);

	return { full, collision };
}

/* === PUBLIC API === */

// Create fresh movement input memory for an entity.
function NewInputFrame() {
	return {
		carriedForward: CloneVector3(WORLD_NORMALS.Forward),
		lastCameraYaw : new Unit(0, "radians"),
		hadInput      : false,
		wasGrounded   : false,
		lastUp        : CloneVector3(WORLD_NORMALS.Up),
		lastKeys      : { forward: 0, right: 0 },
		lastControl   : "free",
		remapPending  : false,
		holding       : false,
		locked        : false,
		lockAngle     : new Unit(0, "radians"),
		lockSign      : 1,
		lockThrottle  : 0,
	}
};

function BuildEntity(definition, surfaceMap, textureScale, faceTextureStore, geometryCache) {
	definition = ResolveEntitySource(definition);

	// Place the movement path relative to the spawn surface.
	const movement  = normalizeMovement(definition.movement, surfaceMap[definition.model.spawnSurfaceId]);
	const { model } = buildModel(definition, surfaceMap, textureScale, faceTextureStore, geometryCache);
	const rootTrans = model.rootTransform;
	const initialMovementProgress = resolveInitialMovementProgress(movement, rootTrans.position);

	if (movement.speed.value > 0) {
		rootTrans.position.set(LerpVector3(movement.start, movement.end, initialMovementProgress));
	}

	const rest = captureRestBounds(definition, model);
	model.restFullAabb = rest.full;

	// Turn off collision and surface correction when no part collides.
	if (rest.collision === null) {
		if (movement.physics.correction) Log("ENGINE", `Entity ${definition.id} has no colliding parts. Turning off its correction.`, "warn", "Level");
		movement.physics = { ...movement.physics, correction: false, collision: false };
	}

	// Flag entities whose sprites show through walls. Occlusion culling never hides them.
	const showsThroughWalls = model.parts.some(({ mesh }) => mesh.sprite !== null && mesh.sprite.occludedRange !== null);

	const { id, type, hp, attacks, hardcoded, platform, collisionOverride, customEvents, velocity, animations } = definition;
	const { position, rotation, scale } = rootTrans;
	const entity = {
		id, type, hp, attacks, hardcoded, platform, collisionOverride, customEvents, movement,
		transform: { position, rotation, scale },
		velocity,
		submergence    : 0,
		underwater     : false,
		buoyancyForce  : 0,
		action         : "Idle",
		grounded       : false,
		launched       : false,
		contactGrace   : 0,
		gripDemand     : 0,
		gravityScale   : 1,
		dragFree       : false,
		staticFriction : 0,
		surfaceContact : "none",
		surfaceNormal  : CloneVector3(WORLD_NORMALS.Up),
		alignedUp      : CloneVector3(WORLD_NORMALS.Up),
		referenceNormal: CloneVector3(WORLD_NORMALS.Up),
		modelTurnRate  : { 
			air  : defaultModelTurnRate.clone(), 
			water: defaultModelTurnRate.clone() 
		},
		facing    : RotateByEuler(WORLD_NORMALS.Forward, rootTrans.rotation),
		inputFrame: NewInputFrame(),
		model,
		mesh     : model.parts[0].mesh,
		collision: rest.collision === null ? null : {
			rest            : rest.collision,
			simRadiusPadding: new Unit(8, "cnu"),
			aabb            : null,
			simRadiusAabb   : null,
			physics         : null,
			hurtbox         : null,
			hitbox          : null,
		},
		fullAabb    : null,
		hitboxActive: rest.collision !== null && rest.collision.hitbox !== null,
		performance : { physics: true, rendering: true, animatedTexture: true, collision: false },
		animations,
		particle: null,
		showsThroughWalls,
		state   : {
			movementProgress: initialMovementProgress,
			direction       : 1,
			lastJumpMs      : 0,
			activeAnimation : "idle",
		},
		physicsRuntime: {
			lastPosition            : rootTrans.position.clone(),
			lastRotation            : rootTrans.rotation.clone(),
			hasUnresolvedPenetration: false,
			cachePrimed             : false,
			lastPhysicsCollisionKey : "",
			groundSurfaceId         : null,
		},
	};

	assignEntityBounds(entity);
	return { entity };
}

// Place the different bounds layers at the entity's transform.
function assignEntityBounds(entity) {
	const { collision, model, transform } = entity;
	const trig = computeRotationTrig(transform.rotation);

	entity.fullAabb = placeAabbEnclosure(model.restFullAabb, transform.position, transform.scale, trig);
	if (collision === null) return;

	const { aabb, physics, hurtbox, hitbox } = collision.rest;

	// Reuse the full box when it's also the collision box.
	collision.aabb = aabb === model.restFullAabb ? entity.fullAabb : placeAabbEnclosure(aabb, transform.position, transform.scale, trig);

	collision.simRadiusAabb = computeExpandedAabb(collision.aabb, collision.simRadiusPadding);
	collision.physics = { shape: physics.shape, bounds: placeBoundsForShape(physics.bounds, transform, model, trig) };
	collision.hurtbox = hurtbox === null
		? null
		: { shape: hurtbox.shape, bounds: placeBoundsForShape(hurtbox.bounds, transform, model, trig) };
	collision.hitbox  = hitbox  === null
		? null
		: { shape: hitbox.shape,  bounds: placeBoundsForShape(hitbox.bounds, transform, model, trig) };
}

function refreshEntityDerivedState(entity) {
	applyModelPose(entity.model);
	assignEntityBounds(entity);
}

// Shift every posed part by delta. Only valid while rotation and scale are unchanged.
function translateEntityDerivedState(entity, delta) {
	entity.model.parts.forEach((part) => {
		part.mesh.transform.position.add(delta);
		part.mesh.worldAabb.min.add(delta);
		part.mesh.worldAabb.max.add(delta);
	});
	entity.model.posedTransform.position.add(delta);
	assignEntityBounds(entity);
}

function UpdateEntityModelFromTransform(entity) {
	if (poseMatchesTransform(entity.model, entity.transform)) return;

	// Note: rootTransform shares position and rotation with entity.transform. Only scale needs copying.
	entity.model.rootTransform.scale = entity.transform.scale;

	if (poseOrientationMatches(entity.model, entity.transform)) {
		translateEntityDerivedState(entity, SubtractVector3(entity.transform.position, entity.model.posedTransform.position));
		return;
	}
	refreshEntityDerivedState(entity);
}

function ResetEntityToDefaultPose(entity) {
	// Write into the existing vectors so other references to them stay valid.
	const defaultRoot = entity.model.defaultPose.rootTransform;
	const targetRoot = entity.model.rootTransform;

	targetRoot.position.set(defaultRoot.position);
	targetRoot.rotation.set(defaultRoot.rotation);
	targetRoot.scale = defaultRoot.scale;
	targetRoot.pivot.set(defaultRoot.pivot);

	entity.model.defaultPose.parts.forEach((posePart) => {
		const part = entity.model.index[posePart.id];
		const src  = posePart.localTransform;
		part.localTransform.position.set(src.position);
		part.localTransform.rotation.set(src.rotation);
		part.localTransform.scale = src.scale;
	});

	refreshEntityDerivedState(entity);
}

export {
	NewInputFrame,
	BuildEntity,
	UpdateEntityModelFromTransform,
	ResetEntityToDefaultPose,
	ComposeTransform,
};