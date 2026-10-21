// Creates Models for anything that should support being animated.
// Builds entity models from the ground up with automatic grounding and
// anchor/attachment-point–based part positioning.

// Called by NewBoss.js, player/Model.js, helpers/game/Level.js and helpers/Cutscene.js for Entity Models
// Uses NewObject.js for Model Parts

import { BuildObject, UpdateObjectWorldAabb, ComputeWorldAabbFromBounds } from "./NewObject.js";
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
import { BestMatchOf, Clamp01, Unit, UnitVector3 } from "../math/Utilities.js";

// Default model-pose turn rate, radians/second. Characters scale it by their control values.
const defaultModelTurnRate = 8;

// Returns the {x,y,z} offset from the box center to the center of the given face.
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

// After a rotation, relabels each face by the world axis its normal lands nearest. Returns { original: new }.
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
		const alignment = (axis) => DotVector3(entry.rotated, axis.dir);
		const bestAxis = BestMatchOf(worldAxes, (axis, best) => alignment(axis) > alignment(best), worldAxes[0]);
		assignments.push({ name: entry.name, bestLabel: bestAxis.label, bestDot: alignment(bestAxis) });
	}

	// Greedy assignment: highest alignment first.
	assignments.sort((a, b) => b.bestDot - a.bestDot);
	for (const a of assignments) {
		if (!claimed.has(a.bestLabel)) {
			remap[a.name] = a.bestLabel;
			claimed.add(a.bestLabel);
		} 
		else {
			// Fallback: assign first unclaimed axis by dot product (approximate).
			let fallbackLabel = a.name;
			let fallbackDot = -Infinity;
			for (const axis of worldAxes) {
				if (!claimed.has(axis.label)) {
					const d = a.bestDot;
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

// model.posedTransform records what the mesh hierarchy currently reflects; equal means the re-pose is a no-op.
const poseMatchesTransform = (model, transform) => {
	return CompareVector3(model.posedTransform.position, transform.position) &&
	CompareVector3(model.posedTransform.rotation, transform.rotation) &&
	CompareVector3(model.posedTransform.scale, transform.scale);
}

// Orientation held means the pose only shifted, so it can be translated instead of recomposed.
const poseOrientationMatches = (model, transform) => {
	return CompareVector3(model.posedTransform.rotation, transform.rotation) && CompareVector3(model.posedTransform.scale, transform.scale);
}

function ComposeTransform(parentTransform, localTransform) {
	const localPosition = localTransform.position.clone();
	const rotatedChildPos = RotateByEuler(localPosition, parentTransform.rotation);
	return {
		position: localPosition.set(AddVector3(parentTransform.position, rotatedChildPos)),
		rotation: localTransform.rotation.clone().set(ComposeEulerRotations(parentTransform.rotation, localTransform.rotation)),
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
	// Resolve surface-local start/end to world space; Y anchors to surfaceTopY.
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
			particle        : source.particle,
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
		dimensions: source.dimensions.clone(),
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
	const geometryCacheKeyPrefix = entityDefinition.blueprintId !== null 
		? entityDefinition.blueprintId 
		: entityDefinition.id;

	// Build all parts (each part wraps its own values in Unit/UnitVector3).
	const parts = entityDefinition.model.parts.map((part) => 
		buildPart(part, textureScale, faceTextureStore, geometryCache, geometryCacheKeyPrefix)
	);

	// Build index and parent-child links in two passes so part order is unconstrained
	const index = {};
	parts.forEach((part) => { index[part.id] = part; });
	parts.forEach((part) => { if (part.parentId !== "root") index[part.parentId].children.push(part.id) });

	// Identify root parts and non-root parts.
	const rootPartIds = parts.filter((p) => p.parentId === "root").map((p) => p.id);

	// Resolve spawn surface.
	const surfaceOrigin = getSurfaceOrigin(surfaceMap[entityDefinition.model.spawnSurfaceId]);

	// --- Root parts: build localTransform relative to rootTransform (model-local) ---
	// Y = scaledHalfHeight (bottom at rootTransform.y, floor grounded after pose) + localPosition.
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
	for (const rootPartId of rootPartIds) for (const childId of index[rootPartId].children) processQueue.push(childId);

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
		spawnSurfaceId: entityDefinition.model.spawnSurfaceId,
		surfacePosition: surfaceOrigin,
		parts, index,
		roots: rootPartIds,
	};

	// Apply initial pose to set mesh transforms (like player Model.js).
	applyModelPose(model);

	// Seat the whole model's AABB floor on the plane (per-root grounding ignores parts below the root).
	model.rootTransform.position.y += model.rootTransform.position.y - computeEntityAabb(model).min.y;
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

		// Visual-only parts use a rough box instead of every vertex to reduce unecessary computations.
		part.mesh.worldAabb = part.addsToBounds === false
			? ComputeWorldAabbFromBounds(part.mesh.geometry.bounds, part.mesh.transform)
			: UpdateObjectWorldAabb(part.mesh);

		part.children.forEach((childId) => applyPart(childId, worldTransform));
	};

	const rootTransform = cloneRootTransform(model.rootTransform);
	model.roots.forEach((rootId) => applyPart(rootId, rootTransform));

	// cloneRootTransform copies position and rotation, aliases scale. Scale is cloned here.
	model.posedTransform = {
		position: rootTransform.position,
		rotation: rootTransform.rotation,
		scale   : CloneVector3(rootTransform.scale),
	};
}

/* === AABB === */

function computeEntityAabb(model) {
	const corners  = model.parts.flatMap((part) => part.addsToBounds === false ? [] : [part.mesh.worldAabb.min, part.mesh.worldAabb.max]);
	const { min, max } = PointsAabb(corners);
	const rootAabb = model.parts[0].mesh.worldAabb;
	return { min: rootAabb.min.clone().set(min), max: rootAabb.max.clone().set(max) };
}

function computeExpandedAabb(aabb, padding) {
	return {
		min: aabb.min.clone().subtract(ToVector3(padding.value)),
		max: aabb.max.clone().add(ToVector3(padding.value)),
	};
}

// sin/cos for one rotation, computed once.
function computeRotationTrig(rotation) {
	return {
		cx: Math.cos(rotation.x), sx: Math.sin(rotation.x),
		cy: Math.cos(rotation.y), sy: Math.sin(rotation.y),
		cz: Math.cos(rotation.z), sz: Math.sin(rotation.z),
	};
}

// RotateByEuler's composition (Z, X, Y) on precomputed trig.
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

// Local offset through scale then rotation — CreateModelMatrix's R·S order.
const transformOffset = (point, scale, trig) => rotateWithTrig(MultiplyVector3(point, scale), trig);

// A scaled clone of a Unit, preserving its type.
const scaleUnit = (u, f) => new Unit(u.value * f, u.type);

// World enclosure of a local box scaled and rotated by the transform.
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
	return { type: "compound-sphere", spheres: spheres };
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
			const center = AabbCenter(bounds);
			const half = ScaleVector3(AabbHalfExtents(bounds), scaleFactor);
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

function resolvePhysicsShape(shape, aabb) {
	if (shape !== "auto") return shape;
	const dim = SubtractVector3(aabb.max, aabb.min);
	return dim.y > Math.max(dim.x, dim.z) ? "capsule" : "sphere";
}

// Builds the bounds for a shape type from the entity AABB or model.
function buildBoundsForShape(shape, aabb, model) {
	switch (shape) {
		case "sphere"         : return SphereFromAabb(aabb, true);
		case "aabb"           : return { type: "aabb", min: aabb.min, max: aabb.max };
		case "capsule"        : return CapsuleFromAabb(aabb);
		case "obb"            : return ObbFromAabb(aabb);
		case "compound-sphere": return computeCompoundSpheresFromModel(model);
	}
}

// Places frozen rest-pose bounds into world space. Compound-sphere is rebuilt from the posed model instead.
function placeBoundsForShape(bounds, transform, model, trig) {
	const { type, center, radius, segmentStart, segmentEnd, halfExtents, halfHeight, axes } = bounds;
	const { position, scale } = transform;
	const widest = Math.max(scale.x, scale.y, scale.z);

	switch (type) {
		case "sphere":
			return {
				type: "sphere",
				center: center.clone().set(AddVector3(transformOffset(center, scale, trig), position)),
				radius: scaleUnit(radius, widest),
			};
		case "aabb":
			return { type: "aabb", ...placeAabbEnclosure(bounds, position, scale, trig) };
		case "capsule":
			return {
				type: "capsule",
				radius: scaleUnit(radius, widest),
				halfHeight: scaleUnit(halfHeight, scale.y),
				segmentStart: segmentStart.clone().set(AddVector3(transformOffset(segmentStart, scale, trig), position)),
				segmentEnd: segmentEnd.clone().set(AddVector3(transformOffset(segmentEnd, scale, trig), position)),
			};
		case "obb":
			return {
				type: "obb",
				center: center.clone().set(AddVector3(transformOffset(center, scale, trig), position)),
				halfExtents: halfExtents.clone().set(MultiplyVector3(halfExtents, scale)),
				axes: axes.map((axis) => rotateWithTrig(axis, trig)),
			};
		case "compound-sphere": return computeCompoundSpheresFromModel(model);
	}
}

// Builds the physics, hurtbox and hitbox bounds for an entity. detailedBounds is the physics bounds.
function computeDetailedBoundsForEntity(entityType, aabb, model, collisionOverride) {

	// "auto" resolves to a concrete shape here.
	const physicsShape = resolvePhysicsShape(collisionOverride.physics, aabb);
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
		hurtbox, hitbox,
	};
}

// Freezes every collider in local space, measured with the model posed at the origin, then restored.
function captureRestCollision(definition, model) {
	const rootTransform = model.rootTransform;
	const position = rootTransform.position.clone();
	const rotation = rootTransform.rotation.clone();
	const scale = rootTransform.scale;

	rootTransform.position.set(ToVector3(0));
	rootTransform.rotation.set(ToVector3(0));
	rootTransform.scale = ToVector3(1);
	applyModelPose(model);

	const aabb = computeEntityAabb(model);
	const detailed = computeDetailedBoundsForEntity(definition.type, aabb, model, definition.collisionOverride);

	rootTransform.position.set(position);
	rootTransform.rotation.set(rotation);
	rootTransform.scale = scale;
	applyModelPose(model);

	return {
		aabb,
		shape        : detailed.collisionShape,
		physics      : detailed.physics,
		hurtbox      : detailed.hurtbox,
		hitbox       : detailed.hitbox,
		groundCapsule: CapsuleFromAabb(aabb),
	};
}

/* === PUBLIC API === */

// Fresh movement input memory, read by player/Movement.js.
const NewInputFrame = () => ({
	carriedForward   : CloneVector3(WORLD_NORMALS.Forward),
	previousCameraYaw: 0,
	previousHasInput : false,
	previousGrounded : false,
	previousUp       : CloneVector3(WORLD_NORMALS.Up),
	previousHeld     : false,
	previousKeys     : { forward: 0, right: 0 },
	previousControl  : "free",
	remapPending     : false,
	holding          : false,
	locked           : false,
	lockAngle        : 0,
	lockSign         : 1,
	lockThrottle     : 0,
});

/**
 * Build an entity from a merged definition.
 * @param {object} definition — merged blueprint + level overrides.
 * @param {object} surfaceMap — { [surfaceId]: { position, dimensions, scale, topY } }
 * @param {number} textureScale — world texture scale (px per CNU) for per-face generated textures.
 * @param {object} faceTextureStore — content-signature-keyed store the per-face bake dedups against
 *   (a build-scoped accumulator at level build, the live textureRegistry at runtime spawn).
 * @param {Map} geometryCache — (blueprintId::partId)-keyed store of frozen part geometry templates,
 *   shared by reference across all same-blueprint instances (level-scoped, persists for runtime spawns); null builds uncached.
 */
function BuildEntity(definition, surfaceMap, textureScale, faceTextureStore, geometryCache) {
	definition = ResolveEntitySource(definition);

	// Resolve spawn surface for movement localization.
	const movement = normalizeMovement(definition.movement, surfaceMap[definition.model.spawnSurfaceId]);
	const { model } = buildModel(definition, surfaceMap, textureScale, faceTextureStore, geometryCache);
	const rootTrans = model.rootTransform;
	const initialMovementProgress = resolveInitialMovementProgress(movement, rootTrans.position);

	if (movement.speed.value > 0) {
		rootTrans.position.set(LerpVector3(movement.start, movement.end, initialMovementProgress));
		applyModelPose(model);
	}

	const rest = captureRestCollision(definition, model);
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
		action: "Idle",
		grounded: false,
		launched: false,
		contactGrace: 0,
		gripDemand: 0,
		gravityScale: 1,
		dragFree: false,
		staticFriction: 0,
		surfaceContact: "none",
		surfaceNormal: CloneVector3(WORLD_NORMALS.Up),
		alignedUp: CloneVector3(WORLD_NORMALS.Up),
		referenceNormal: CloneVector3(WORLD_NORMALS.Up),
		modelTurnRate: { air: defaultModelTurnRate, water: defaultModelTurnRate },
		facing: RotateByEuler(WORLD_NORMALS.Forward, rootTrans.rotation),
		inputFrame: NewInputFrame(),
		model,
		mesh: model.parts[0].mesh,
		collision: {
			rest, simRadiusPadding,
			aabb          : null,
			simRadiusAabb : null,
			shape         : null,
			detailedBounds: null,
			physics       : null,
			hurtbox       : null,
			hitbox        : null,
		},
		hitboxActive: rest.hitbox !== null,
		performance: { physics: true, rendering: true, animatedTexture: true, collision: false },
		animations: definition.animations,
		particle: null,
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
			groundSurfaceId: null,
		},
	};

	assignCollisionBounds(entity);
	return { entity };
}

// Every collision layer: the frozen rest shape, placed by the transform.
function assignCollisionBounds(entity) {
	const rest = entity.collision.rest;
	const transform = entity.transform;
	const trig = computeRotationTrig(transform.rotation);

	entity.collision.aabb = placeAabbEnclosure(rest.aabb, transform.position, transform.scale, trig);
	entity.collision.simRadiusAabb = computeExpandedAabb(entity.collision.aabb, entity.collision.simRadiusPadding);
	entity.collision.shape = rest.shape;
	entity.collision.physics = { shape: rest.physics.shape, bounds: placeBoundsForShape(rest.physics.bounds, transform, entity.model, trig) };
	entity.collision.detailedBounds = entity.collision.physics.bounds;
	entity.collision.hurtbox = rest.hurtbox === null ? null : { shape: rest.hurtbox.shape, bounds: placeBoundsForShape(rest.hurtbox.bounds, transform, entity.model, trig) };
	entity.collision.hitbox = rest.hitbox === null ? null : { shape: rest.hitbox.shape, bounds: placeBoundsForShape(rest.hitbox.bounds, transform, entity.model, trig) };
}

function refreshEntityDerivedState(entity) {
	applyModelPose(entity.model);
	assignCollisionBounds(entity);
}

// Shifts the posed hierarchy by delta. Exact while orientation holds, since every part moves together.
function translateEntityDerivedState(entity, delta) {
	entity.model.parts.forEach((part) => {
		part.mesh.transform.position.add(delta);
		part.mesh.worldAabb.min.add(delta);
		part.mesh.worldAabb.max.add(delta);
	});
	entity.model.posedTransform.position.add(delta);
	assignCollisionBounds(entity);
}

function UpdateEntityModelFromTransform(entity) {
	if (poseMatchesTransform(entity.model, entity.transform)) return;

	// rootTransform shares entity.transform's position/rotation objects; only scale is ever re-pointed.
	entity.model.rootTransform.scale = entity.transform.scale;

	if (poseOrientationMatches(entity.model, entity.transform)) {
		translateEntityDerivedState(entity, SubtractVector3(entity.transform.position, entity.model.posedTransform.position));
		return;
	}
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
	NewInputFrame,
	BuildEntity,
	UpdateEntityModelFromTransform,
	ResetEntityToDefaultPose,
	SampleMovementPoint,
	ComposeTransform,
};