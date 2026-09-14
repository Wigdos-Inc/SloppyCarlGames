// Three-layer collision system: physics / hurtbox / hitbox.
// Physics layer resolves geometry (swept detection + slide).
// Hurtbox/Hitbox layers resolve combat overlaps (static tests, no geometry resolution).

// Used by physics/Master.js

import { CONFIG, PERFORMANCE_SCALING } from "../core/config.js";
import { EPSILON } from "../core/meta.js";
import { Clamp, Squared, Unit } from "../math/Utilities.js";
import {
	AddVector3,
	SubtractVector3,
	ScaleVector3,
	DotVector3,
	Vector3Sq,
	Vector3Distance,
	CloneVector3,
	AbsoluteVector3,
	ClampVector3,
	MultiplyVector3,
	RotateByEuler,
	WORLD_NORMALS,
	DivideVector3,
	ToVector3,
} from "../math/Vector3.js";
import {
	SweptAABB,
	AabbOverlap,
	StrictAabbOverlap,
	SphereSphereContact,
	SphereAABBContact,
	SphereOBBContact,
	AabbObbContact,
	SphereCapsuleContact,
	CapsuleAABBContact,
	CapsuleCapsuleContact,
	CapsuleOBBContact,
	SphereTriangleSoupContact,
	CapsuleTriangleSoupContact,
	SphereVoidWallContact,
	CapsuleVoidWallContact,
	AabbTriangleSoupContact,
	AabbVoidWallContact,
	ClosestPointOnTriangle,
	PointInsideMesh,
	SweptSphereAABB,
	SweptSphereOBB,
	NoContact,
} from "../math/Collision.js";
import { ClassifySurface } from "./Correction.js";

// Min approach cosine for a wall hit (~60° from head-on); below = graze, no wall contact.
const wallFacingMinApproachDot = 0.5;

// Tiny sphere radius used for ground-support point void narrowphase tests.
// Instanced once at module scope per UNIT_INSTANCING.md.
const groundProbeRadius = new Unit(0.001, "cnu");

// Vertical-only tolerance (CNU) for void boundary overlap tests. Absorbs the
// float-precision error from OBB ray-casts landing on a coincident boundary plane
// (support point at y == void.min.y). Applied to the y axis only — x/z stay exact.
const voidBoundaryEpsilon = new Unit(0.001, "cnu");

// Depth (CNU) a contact point is pushed back into the host to sample the material it touched.
// Same depth as NewVoid.js's aperture probe.
const contactMaterialProbe = new Unit(0.05, "cnu");

/* ========================================================================
 * RESULT POOLS — grow-once, zero GC per frame.
 * ======================================================================== */

const createResultPool = () => { return { items: [], count: 0 } };
const poolReset = (pool) => pool.count = 0;

function poolPush(pool) {
	if (pool.count < pool.items.length) return pool.items[pool.count++];
	const item = { 
		target: null, 
		tEntry: 1, 
		normal: null, 
		depth: 0, 
		pushDepth: 0,
		pushNormal: null,
		point: null,
		type: null,
		sourceType: null,
		trigger: null,
		attacker: null, 
		shape: null 
	};
	pool.items.push(item);
	pool.count++;
	return item;
}

const solidResultPool = createResultPool();
const triggerResultPool = createResultPool();
const hurtboxResultPool = createResultPool();
const activeCollisionPairCache = new Map();

/**
 * Reset all collision result pools. Call once at the start of each frame.
 */
function ResetCollisionPools() {
	poolReset(solidResultPool);
	poolReset(triggerResultPool);
	poolReset(hurtboxResultPool);
}

const buildActivePairKey = (entity, candidate) => `${entity.id}|${candidate.type}|${candidate.pairId}`;

function getAxisScalar(vector, axis) {
	for (const key in vector) if (axis === key) return vector[key];
}

const removeActiveCollisionPair = (entity, candidate) => activeCollisionPairCache.delete(buildActivePairKey(entity, candidate));

function cacheActiveCollisionPair(entity, candidate, normal, depth) {
	const abs = AbsoluteVector3(normal);
	const dominantAxis = (abs.y >= abs.x && abs.y >= abs.z) ? "y" :  (abs.x >= abs.z) ? "x" : "z";
	
	activeCollisionPairCache.set(buildActivePairKey(entity, candidate), {
		entityA: entity,
		entityB: candidate.ref,
		dominantAxis,
		positionAxisValue: getAxisScalar(entity.transform.position, dominantAxis),
		rotationAxisValue: getAxisScalar(entity.transform.rotation, dominantAxis),
		normal: CloneVector3(normal),
		depth,
	});
}

function readReusableActiveCollisionPair(entity, candidate) {
	const entry = activeCollisionPairCache.get(buildActivePairKey(entity, candidate));
	if (!entry) return null;

	const positionDelta = Math.abs(getAxisScalar(entity.transform.position, entry.dominantAxis) - entry.positionAxisValue);
	const rotationDelta = Math.abs(getAxisScalar(entity.transform.rotation, entry.dominantAxis) - entry.rotationAxisValue);
	if (positionDelta <= EPSILON && rotationDelta <= EPSILON) return entry;

	activeCollisionPairCache.delete(buildActivePairKey(entity, candidate));
	return null;
}

function buildContactFromCachedPair(entry) {
	return {
		hit: true,
		normal: CloneVector3(entry.normal),
		depth: entry.depth,
		point: null,
	};
}

/* ========================================================================
 * HELPERS
 * ======================================================================== */

function offsetDetailedBounds(bounds, offset) {
	switch (bounds.type) {
		case "capsule":
			return {
				type: "capsule",
				radius: bounds.radius,
				halfHeight: bounds.halfHeight,
				segmentStart: bounds.segmentStart.clone().add(offset),
				segmentEnd: bounds.segmentEnd.clone().add(offset),
			};	
		case "obb": 
			return {
				type: "obb",
				center: bounds.center.clone().add(offset),
				halfExtents: bounds.halfExtents,
				axes: bounds.axes,
			};
		case "sphere":
			return {
				type: "sphere",
				center: bounds.center.clone().add(offset),
				radius: bounds.radius,
			};
		case "aabb":
			return {
				type: "aabb",
				min: bounds.min.clone().add(offset),
				max: bounds.max.clone().add(offset),
			};
		case "compound-sphere":
			return {
				type: "compound-sphere",
				spheres: bounds.spheres.map((sphere) => ({
					center: sphere.center.clone().add(offset),
					radius: sphere.radius,
					partId: sphere.partId,
				})),
			};
		default: return bounds;
	}
}

// Should probably be moved to other contact helper functions in math/Collision.js
function aabbAabbContact(boundsA, boundsB) {
	if (!AabbOverlap(boundsA, boundsB)) return NoContact();
	const centerA = getAabbCenter(boundsA);
	const centerB = getAabbCenter(boundsB);
	const overlaps = [
		{
			depth: centerA.x <= centerB.x ? boundsA.max.x - boundsB.min.x : boundsB.max.x - boundsA.min.x,
			normal: centerA.x <= centerB.x ? WORLD_NORMALS.Left : WORLD_NORMALS.Right,
		},
		{
			depth: centerA.y <= centerB.y ? boundsA.max.y - boundsB.min.y : boundsB.max.y - boundsA.min.y,
			normal: centerA.y <= centerB.y ? WORLD_NORMALS.Down : WORLD_NORMALS.Up,
		},
		{
			depth: centerA.z <= centerB.z ? boundsA.max.z - boundsB.min.z : boundsB.max.z - boundsA.min.z,
			normal: centerA.z <= centerB.z ? WORLD_NORMALS.Backward : WORLD_NORMALS.Forward,
		},
	];

	let best = overlaps[0];
	for (const overlap of overlaps) if (overlap.depth < best.depth) best = overlap;

	return { hit: true, normal: CloneVector3(best.normal), depth: best.depth };
}

function chooseDeepestContact(best, candidate) {
	if (!candidate.hit) return best;
	if (!best.hit || candidate.depth > best.depth) return candidate;
	return best;
}

function iterateCompoundSpheres(compound, contactFn) {
	let best = NoContact();
	compound.spheres.forEach(sphere => best = chooseDeepestContact(best, contactFn(sphere)));
	return best;
}

function narrowphaseContact(boundsA, boundsB) {
	const invertContact = (contact) => {
		if (!contact.hit) return contact;
		return { hit: true, normal: ScaleVector3(contact.normal, -1), depth: contact.depth, point: contact.point };
	}

	switch (boundsA.type.substring(0, 2) + boundsB.type.substring(0, 2)) {
		case "spsp": return SphereSphereContact(boundsA.center, boundsA.radius, boundsB.center, boundsB.radius);
		case "spaa": return SphereAABBContact(boundsA.center, boundsA.radius, boundsB);
		case "aasp": return invertContact(SphereAABBContact(boundsB.center, boundsB.radius, boundsA));
		case "spob": return SphereOBBContact(boundsA.center, boundsA.radius, boundsB);
		case "obsp": return invertContact(SphereOBBContact(boundsB.center, boundsB.radius, boundsA));
		case "spca": return SphereCapsuleContact(boundsA.center, boundsA.radius, boundsB);
		case "casp": return invertContact(SphereCapsuleContact(boundsB.center, boundsB.radius, boundsA));
		case "caaa": return CapsuleAABBContact(boundsA, boundsB);
		case "aaca": return invertContact(CapsuleAABBContact(boundsB, boundsA));
		case "caca": return CapsuleCapsuleContact(boundsA, boundsB);
		case "caob": return CapsuleOBBContact(boundsA, boundsB);
		case "obca": return invertContact(CapsuleOBBContact(boundsB, boundsA));
		case "sptr": return SphereTriangleSoupContact(boundsA.center, boundsA.radius, boundsB);
		case "trsp": return invertContact(SphereTriangleSoupContact(boundsB.center, boundsB.radius, boundsA));
		case "catr": return CapsuleTriangleSoupContact(boundsA, boundsB);
		case "trca": return invertContact(CapsuleTriangleSoupContact(boundsB, boundsA));
		case "spvo": return SphereVoidWallContact(boundsA.center, boundsA.radius, boundsB);
		case "vosp": return invertContact(SphereVoidWallContact(boundsB.center, boundsB.radius, boundsA));
		case "cavo": return CapsuleVoidWallContact(boundsA, boundsB);
		case "voca": return invertContact(CapsuleVoidWallContact(boundsB, boundsA));
		case "aatr": return AabbTriangleSoupContact(boundsA, boundsB);
		case "traa": return invertContact(AabbTriangleSoupContact(boundsB, boundsA));
		case "aavo": return AabbVoidWallContact(boundsA, boundsB);
		case "voaa": return invertContact(AabbVoidWallContact(boundsB, boundsA));
		case "aaaa": return aabbAabbContact(boundsA, boundsB);
		case "aaob": return AabbObbContact(boundsA, boundsB);
		case "obaa": return invertContact(AabbObbContact(boundsB, boundsA));

		case "spco": return iterateCompoundSpheres(boundsB, s => SphereSphereContact(boundsA.center, boundsA.radius, s.center, s.radius));
		case "cosp": return iterateCompoundSpheres(boundsA, s => invertContact(SphereSphereContact(boundsB.center, boundsB.radius, s.center, s.radius)));
		case "caco": return iterateCompoundSpheres(boundsB, s => invertContact(SphereCapsuleContact(s.center, s.radius, boundsA)));
		case "coca": return iterateCompoundSpheres(boundsA, s => SphereCapsuleContact(s.center, s.radius, boundsB));
	}
	
	if (boundsA.type === "compound-sphere") return iterateCompoundSpheres(boundsA, s => narrowphaseContact({ type: "sphere", center: s.center, radius: s.radius }, boundsB));
	if (boundsB.type === "compound-sphere") return iterateCompoundSpheres(boundsB, s => narrowphaseContact(boundsA, { type: "sphere", center: s.center, radius: s.radius }));

	return NoContact();
}

/* ========================================================================
 * NARROWPHASE DISPATCH
 * ======================================================================== */

/**
 * Shape-gated narrowphase test. Returns true if boundsA overlaps boundsB.
 */
const NarrowphaseTest = (bA, bB) => narrowphaseContact(bA, bB).hit;

/* ========================================================================
 * BROADPHASE
 * ======================================================================== */

const GetSimDistanceValue = () => PERFORMANCE_SCALING.SimDistance.Tiers[CONFIG.PERFORMANCE.SimDistance];

// A null viewer opts out of the gate entirely (payloads may carry no player).
const IsBeyondSimDistance = (viewerPos, tgtPos) => viewerPos !== null && Vector3Distance(viewerPos, tgtPos) > GetSimDistanceValue().value;

const getHalfExtents = (aabb) => aabb.max.clone().subtract(aabb.min).scale(0.5);

function buildEntityAabbAtPosition(entityAabb, position) {
	const halfExtents = getHalfExtents(entityAabb);
	const centerPos = position.clone().add(getAabbCenter(entityAabb).subtract(position));
	return {
		min: centerPos.clone().subtract(halfExtents),
		max: centerPos.clone().add(halfExtents),
	};
}

const getAabbCenter = (aabb) => aabb.min.clone().add(aabb.max).scale(0.5);

/**
 * Broadphase: collect all collidable scene objects within sim radius.
 */
function BroadphaseCollectCandidates(sceneGraph, simRadiusAabb, includeTriggers, includeEntities) {
	const candidates = [];
	const withinSimRadius = (aabb) => AabbOverlap(simRadiusAabb, aabb);

	// Terrain (always solid).
	sceneGraph.terrain.forEach(mesh => {
		if (!withinSimRadius(mesh.worldAabb)) return;
		candidates.push({
			id: mesh.id,
			pairId: mesh.id,
			aabb: mesh.worldAabb,
			detailedBounds: mesh.detailedBounds,
			isTrigger: false,
			type: "terrain",
			ref: mesh,
		});
	});

	// Obstacles.
	sceneGraph.obstacles.forEach(obs => {
		if (!withinSimRadius(obs.worldAabb)) return;
		candidates.push({
			id            : obs.id,
			pairId        : obs.id,
			aabb          : obs.worldAabb,
			detailedBounds: obs.detailedBounds,
			isTrigger     : false,
			type          : "obstacle",
			ref           : obs,
		});
	});

	// Floor and wall faces enter as separate candidates.
	// sourceType is the category they resolve under, matching ProbeGroundContact.
	const collectVoidWalls = (entries, sourceType) => {
		for (const entry of entries) for (const id in entry.relations) {
			for (const voidWall of entry.relations[id].voidWallMeshes) {
				if (!withinSimRadius(voidWall.worldAabb)) continue;
				candidates.push({
					id            : voidWall.id,
					pairId        : voidWall.id,
					aabb          : voidWall.worldAabb,
					detailedBounds: voidWall.wallBounds,
					isTrigger     : false,
					type          : "voidWall",
					sourceType    : sourceType,
					ref           : voidWall,
				});
				if (voidWall.floorBounds.triangles.length > 0) {
					candidates.push({
						id            : `${voidWall.id}-floor`,
						pairId        : `${voidWall.id}-floor`,
						aabb          : voidWall.worldAabb,
						detailedBounds: voidWall.floorBounds,
						isTrigger     : false,
						type          : "voidWall",
						sourceType    : sourceType,
						ref           : voidWall,
					});
				}
			}
		}
	};
	collectVoidWalls(sceneGraph.voids.terrain, "terrain");
	collectVoidWalls(sceneGraph.voids.obstacles, "obstacle");

	// Triggers (only ever consumed by the player).
	if (includeTriggers) {
		sceneGraph.triggers.forEach(trig => {
			if (!withinSimRadius(trig.worldAabb)) return;
			candidates.push({
				id       : trig.id,
				pairId   : trig.id,
				aabb     : trig.worldAabb,
				isTrigger: true,
				type     : "trigger",
				trigger  : trig.meta.trigger,
				ref      : trig,
			});
		});
	}

	// Physics-enabled entities (for N-body physics). Particles neither obstruct nor are obstructed:
	// a burst spawns at its emitter's origin, so the emitter would strip its own launch velocity.
	if (includeEntities) {
		sceneGraph.entities.forEach(ent => {
			if (ent.type === "player" || ent.type === "particle" || !ent.collision.detailedBounds) return;
			if (!withinSimRadius(ent.collision.aabb)) return;
			candidates.push({
				id: ent.id,
				pairId: ent.id,
				aabb: ent.collision.aabb,
				detailedBounds: ent.collision.detailedBounds,
				isTrigger: false,
				type: "entity",
				ref: ent,
			});
		});
	}

	return candidates;
}

// Returns a copy of an AABB expanded by epsilon on the y axis only (x/z untouched).
function expandAabbY(aabb, epsilon) {
	return {
		min: { x: aabb.min.x, y: aabb.min.y - epsilon, z: aabb.min.z },
		max: { x: aabb.max.x, y: aabb.max.y + epsilon, z: aabb.max.z },
	};
}

// Returns a copy of an AABB translated by an offset vector on all axes.
function offsetAabb(aabb, offset) {
	return {
		min: aabb.min.clone().add(offset),
		max: aabb.max.clone().add(offset),
	};
}

// motionOffset tests the end-of-frame position; a void cancels a contact only where the material behind it was carved away.
function isVoidCancelled(entity, candidate, sceneGraph, motionOffset, contact) {
	if (candidate.type !== "terrain" && candidate.type !== "obstacle") return false;

	const isTerrain  = candidate.type === "terrain";
	if ((isTerrain ? candidate.ref.meta.mode : candidate.ref.mode) === "invisible") return false;
	if ((isTerrain ? candidate.ref.meta.nullable : candidate.ref.nullable) === false) return false;

	for (const ns of (isTerrain ? sceneGraph.voids.terrain : sceneGraph.voids.obstacles)) {
		if (ns.relations[candidate.ref.id]?.suppressed !== true) continue;
		const entityAabb = motionOffset ? offsetAabb(entity.collision.aabb, motionOffset) : entity.collision.aabb;
		if (!StrictAabbOverlap(entityAabb, expandAabbY(ns.worldAabb, voidBoundaryEpsilon.value))) continue;
		// Centre inside the cavity cancels the host outright.
		if (PointInsideMesh(getAabbCenter(entityAabb), ns.solidTriangles)) return true;

		if (contact && contact.point) {
			// Probe sits contactMaterialProbe inside the host, behind the contact point.
			if (PointInsideMesh(AddVector3(contact.point, ScaleVector3(contact.normal, -contactMaterialProbe.value)), ns.solidTriangles)) return true;
			continue;
		}

		const entityBounds = motionOffset ? offsetDetailedBounds(entity.collision.physics.bounds, motionOffset) : entity.collision.physics.bounds;
		if (ns.detailedBounds && NarrowphaseTest(entityBounds, ns.detailedBounds)) return true;
	}

	return false;
}

function IsPointInSuppressingVoid(supportPt, candidateId, voids) {
	for (const ns of voids) {
		if (ns.relations[candidateId]?.suppressed !== true) continue;
		if (!AabbOverlap({ min: supportPt, max: supportPt }, expandAabbY(ns.worldAabb, voidBoundaryEpsilon.value))) continue;
		if (NarrowphaseTest({ type: "sphere", center: supportPt, radius: groundProbeRadius }, ns.detailedBounds)) return true;
		if (PointInsideMesh(supportPt, ns.solidTriangles)) return true;
	}
	return false;
}

/* ========================================================================
 * ENTITY OVERLAP HELPERS (backward compat)
 * ======================================================================== */

const CheckEntityAabbOverlap = (eA, eB) => AabbOverlap(eA.collision.aabb, eB.collision.aabb);

function CheckEntityTrueOverlap(entityA, entityB) {
	return !CheckEntityAabbOverlap(entityA, entityB) ? false : NarrowphaseTest(entityA.collision.physics.bounds, entityB.collision.physics.bounds);
}

/* ========================================================================
 * SWEPT HELPERS
 * ======================================================================== */

function checkSweptAabbPair(position, displacement, entityAabb, targetAabb) {
	return SweptAABB(position.clone().add(getAabbCenter(entityAabb).subtract(position)), displacement, getHalfExtents(entityAabb), targetAabb);
}

function checkSweptSpherePair(position, displacement, radius, targetAabb) {
	const result = SweptSphereAABB(position, displacement, radius, targetAabb);
	return { hit: result.hit, tEntry: result.t, normal: result.normal };
}

function checkSweptSphereCandidatePair(position, displacement, radius, candidate) {
	if (candidate.detailedBounds.type === "obb") {
		const result = SweptSphereOBB(position, displacement, radius, candidate.detailedBounds);
		return { hit: result.hit, tEntry: result.t, normal: result.normal };
	}
	return checkSweptSpherePair(position, displacement, radius, candidate.aabb);
}

function fillSolidResult(candidate, swept, contact) {
	const item      = poolPush(solidResultPool);
	item.target     = candidate;
	item.tEntry     = swept.tEntry;
	item.normal     = contact.normal;
	item.depth      = contact.depth;
	item.pushDepth  = 0;
	item.pushNormal = contact.normal;
	item.point      = contact.point;
	item.type       = candidate.type;
	item.sourceType = candidate.sourceType || null;
	return item;
}

function createEmptyFloorImpact() {
	return {
		hit: false,
		normal: CloneVector3(WORLD_NORMALS.Up),
		type: null,
		supportY: -1,
		tEntry: 1,
	};
}

function buildFloorImpact(collision, supportY, surfaceType) {
	return {
		hit: true,
		normal: CloneVector3(collision.pushNormal),
		type: surfaceType,
		supportY: supportY,
		tEntry: collision.tEntry,
	};
}

function createEmptyWallImpact() {
	return {
		hit: false,
		normal: CloneVector3(WORLD_NORMALS.Forward),
		type: null,
		tEntry: 1,
		approach: 0,
	};
}

function buildWallImpact(collision, approach, surfaceType) {
	return {
		hit: true,
		normal: CloneVector3(collision.normal),
		type: surfaceType,
		tEntry: collision.tEntry,
		approach,
	};
}

function resolveWallApproachStrength(velocity, normal) {
	const horizontalVelocity = { x: velocity.x, y: 0, z: velocity.z };
	const horizontalNormal = { x: normal.x, y: 0, z: normal.z };
	const velocityLengthSq = Vector3Sq(horizontalVelocity);
	const normalLengthSq = Vector3Sq(horizontalNormal);
	if (velocityLengthSq <= EPSILON || normalLengthSq <= EPSILON) return 0;
	return -DotVector3(horizontalVelocity, horizontalNormal) / Math.sqrt(velocityLengthSq * normalLengthSq);
}

const GetEntityPhysicsFlags = (e) => e.type === "player" ? e.character.physics : e.movement.physics;

/* ========================================================================
 * LAYER 1: PHYSICS COLLISION DETECTION
 * ======================================================================== */

/**
 * Detect physics collisions for a moving entity against world geometry and
 * other physics-enabled entities.
 *
 * @param {object} entity — entity with transform, collision, type.
 * @param {{ x, y, z }} displacement — velocity * dt for this frame.
 * @param {object} sceneGraph
 * @returns {{ solids: {items, count}, triggers: {items, count} }}
 */
function DetectPhysicsCollisions(entity, displacement, sceneGraph) {
	const isPlayer = entity.type === "player";
	if (CONFIG.PHYSICS.Collision.Enabled === false || !GetEntityPhysicsFlags(entity).collision) {
		ResetCollisionPools();
		return { solids: solidResultPool, triggers: triggerResultPool };
	}

	const vel = displacement;
	const candidates = BroadphaseCollectCandidates(sceneGraph, entity.collision.simRadiusAabb, isPlayer, entity.type !== "particle");

	// Determine swept mode from entity physics shape.
	const useSphereSwept = entity.collision.physics.shape === "sphere";

	// For sphere swept: get radius from physics bounds.
	let sphereCenter = null;
	let sphereRadius = 0;
	if (useSphereSwept) {
		sphereCenter = entity.collision.physics.bounds.center;
		sphereRadius = entity.collision.physics.bounds.radius.value;
	}

	ResetCollisionPools();

	for (const candidate of candidates) {
		// Skip self.
		if (candidate.type === "entity" && candidate.ref === entity) continue;

		if (candidate.isTrigger) {
			if (AabbOverlap(buildEntityAabbAtPosition(entity.collision.aabb, entity.transform.position), candidate.aabb)) {
				const item = poolPush(triggerResultPool);
				item.target = candidate;
				item.trigger = candidate.trigger;
				item.type = "trigger";
			}
			continue;
		}

		// Swept test.
		let swept;
		if (useSphereSwept) swept = checkSweptSphereCandidatePair(sphereCenter, vel, sphereRadius, candidate);
		else swept = checkSweptAabbPair(entity.transform.position, vel, entity.collision.aabb, candidate.aabb);

		if (swept.hit && swept.tEntry >= 0 && swept.tEntry <= 1) {
			const cachedPair = isPlayer ? null : readReusableActiveCollisionPair(entity, candidate);
			if (isPlayer) {
				let contact = cachedPair ? buildContactFromCachedPair(cachedPair) : NoContact();
				if (!cachedPair) {
					contact = narrowphaseContact(offsetDetailedBounds(entity.collision.physics.bounds, vel), candidate.detailedBounds);
					if (!contact.hit) {
						const entryBounds = offsetDetailedBounds(entity.collision.physics.bounds, ScaleVector3(vel, swept.tEntry));
						contact = narrowphaseContact(entryBounds, candidate.detailedBounds);
					}
					if (!contact.hit) {
						removeActiveCollisionPair(entity, candidate);
						continue;
					}
				}

				if (isVoidCancelled(entity, candidate, sceneGraph, vel, contact)) {
					removeActiveCollisionPair(entity, candidate);
					continue;
				}

				fillSolidResult(candidate, swept, contact).shape = entity.collision.physics.bounds.type;
				continue;
			}

			// Non-player narrowphase remains boolean-gated.
			let contact = cachedPair ? buildContactFromCachedPair(cachedPair) : NoContact();
			if (!cachedPair) {
				const entityDetailed = offsetDetailedBounds(entity.collision.physics.bounds, ScaleVector3(vel, swept.tEntry));
				contact = narrowphaseContact(entityDetailed, candidate.detailedBounds);
				if (!contact.hit) {
					removeActiveCollisionPair(entity, candidate);
					continue;
				}
				cacheActiveCollisionPair(entity, candidate, contact.normal, contact.depth);
			}

			if (isVoidCancelled(entity, candidate, sceneGraph, vel, contact)) {
				removeActiveCollisionPair(entity, candidate);
				continue;
			}

			fillSolidResult(candidate, swept, contact);
		}
	}

	// Sort solids by time of entry (closest first).
	const solidSlice = solidResultPool.items;
	for (let i = 1; i < solidResultPool.count; i++) {
		const key = solidSlice[i];
		const keyT = key.tEntry;
		let j = i - 1;
		while (j >= 0 && solidSlice[j].tEntry > keyT) {
			solidSlice[j + 1] = solidSlice[j];
			j--;
		}
		solidSlice[j + 1] = key;
	}

	return { solids: solidResultPool, triggers: triggerResultPool };
}

function DetectCurrentPhysicsOverlaps(entity, sceneGraph) {
	const isPlayer = entity.type === "player";
	if (CONFIG.PHYSICS.Collision.Enabled === false || !GetEntityPhysicsFlags(entity).collision) {
		ResetCollisionPools();
		return { solids: solidResultPool, triggers: triggerResultPool, candidates: [] };
	}

	ResetCollisionPools();

	const candidates = BroadphaseCollectCandidates(sceneGraph, entity.collision.simRadiusAabb, isPlayer, entity.type !== "particle");
	for (const candidate of candidates) {
		if (candidate.type === "entity" && candidate.ref === entity) continue;

		if (candidate.isTrigger) {
			if (AabbOverlap(entity.collision.aabb, candidate.aabb)) {
				const triggerItem = poolPush(triggerResultPool);
				triggerItem.target = candidate;
				triggerItem.trigger = candidate.trigger;
				triggerItem.type = "trigger";
			}
			continue;
		}

		if (!AabbOverlap(entity.collision.aabb, candidate.aabb)) continue;

		const cachedPair = isPlayer || candidate.detailedBounds.type === "triangle-soup"
			? null
			: readReusableActiveCollisionPair(entity, candidate);
		const contact = cachedPair 
			? buildContactFromCachedPair(cachedPair) 
			: narrowphaseContact(entity.collision.physics.bounds, candidate.detailedBounds);
		
		if (!contact.hit) {
			removeActiveCollisionPair(entity, candidate);
			continue;
		}
		if (isVoidCancelled(entity, candidate, sceneGraph, null, contact)) {
			removeActiveCollisionPair(entity, candidate);
			continue;
		}
		if (!isPlayer) cacheActiveCollisionPair(entity, candidate, contact.normal, contact.depth);

		// pushNormal/pushDepth mirror the detected contact.
		const item = poolPush(solidResultPool);
		item.target = candidate;
		item.tEntry = 0;
		item.normal = contact.normal;
		item.depth = contact.depth;
		item.pushDepth = contact.depth;
		item.pushNormal = contact.normal;
		item.point = contact.point;
		item.type = candidate.type;
		item.sourceType = candidate.sourceType || null;
		item.shape = entity.collision.physics.bounds.type;
	}

	return { solids: solidResultPool, triggers: triggerResultPool, candidates };
}

/* ========================================================================
 * LAYER 2 & 3: COMBAT OVERLAP DETECTION (Hurtbox / Hitbox)
 * ======================================================================== */

/**
 * Detect all combat overlaps in one pass: active hitboxes vs hurtboxes.
 * Returns pooled results: { items, count } where each item is { attacker, target }.
 *
 * @param {object} playerState — player entity (checked as both attacker and target).
 * @param {Array} entities — all entities in the scene.
 * @returns {{ items: Array, count: number }}
 */
function DetectCombatOverlaps(playerState, entities) {
	if (
		CONFIG.PHYSICS.Collision.Enabled === false || 
		(
			CONFIG.PHYSICS.Collision.Hurtbox === false && 
			CONFIG.PHYSICS.Collision.Hitbox === false
		)
	) {
		poolReset(hurtboxResultPool);
		return hurtboxResultPool;
	}

	poolReset(hurtboxResultPool);

	for (const entity of entities) {
		if (entity === playerState || entity.type === "collectible" || entity.type === "particle") continue;

		if (!entity.performance.physics) continue;

		// Broadphase: player AABB vs entity AABB.
		if (!AabbOverlap(playerState.collision.aabb, entity.collision.aabb)) continue;

		// Player hitbox active → player attacks entity.
		if (playerState.hitboxActive && CONFIG.PHYSICS.Collision.Hitbox) {
			if (playerState.collision.hitbox && entity.collision.hurtbox) {
				if (NarrowphaseTest(playerState.collision.hitbox.bounds, entity.collision.hurtbox.bounds)) {
					const item = poolPush(hurtboxResultPool);
					item.attacker = playerState;
					item.target = entity;
					item.type = "player-attacks";
				}
			}
		}

		// Entity hitbox active → entity attacks player.
		if (entity.hitboxActive && CONFIG.PHYSICS.Collision.Hurtbox) {
			if (entity.collision.hitbox && playerState.collision.hurtbox) {
				if (NarrowphaseTest(entity.collision.hitbox.bounds, playerState.collision.hurtbox.bounds)) {
					const item = poolPush(hurtboxResultPool);
					item.attacker = entity;
					item.target = playerState;
					item.type = "entity-attacks";
				}
			}
		}
	}

	return hurtboxResultPool;
}

/* ========================================================================
 * COLLISION RESOLUTION
 * ======================================================================== */

/**
 * Resolve solid collisions by sliding velocity along collision normals.
 * Accepts either pooled results { items, count } or plain arrays.
 * @param {{ x, y, z }} velocity — per-second velocity.
 * @param {{ x, y, z }} displacement — velocity * dt.
 * @param {{ items, count }|Array} solids — sorted collision results.
 * @returns {{ resolvedVelocity, resolvedDisplacement, floorImpact, wallImpact, changedPosition, changedVelocity, anyChanged }}
 */
function ResolveCollisions(velocity, displacement, solids) {
	let vel = CloneVector3(velocity);
	let disp = CloneVector3(displacement);
	let floorImpact = createEmptyFloorImpact();
	let wallImpact = createEmptyWallImpact();
	let changedPosition = false;
	let changedVelocity = false;

	if (solids.count === 0) {
		return {
			resolvedVelocity: vel,
			resolvedDisplacement: disp,
			floorImpact,
			wallImpact,
			changedPosition: false,
			changedVelocity: false,
			anyChanged: false,
		};
	}

	for (let i = 0; i < solids.count; i++) { 
		const collision = solids.items[i];
		// A voidWall resolves under its source category
		const surfaceType = collision.sourceType || collision.type;
		const isSurfaceCandidate = surfaceType === "terrain" || surfaceType === "obstacle";
		const wallApproach = isSurfaceCandidate ? resolveWallApproachStrength(velocity, collision.normal) : 0;

		if (isSurfaceCandidate && collision.pushNormal.y > 0.5) {
			if (
				!floorImpact.hit || collision.pushNormal.y > floorImpact.supportY ||
				(collision.pushNormal.y === floorImpact.supportY && collision.tEntry < floorImpact.tEntry)
			) {
				floorImpact = buildFloorImpact(collision, collision.pushNormal.y, surfaceType);
			}
		}

		if (isSurfaceCandidate && wallApproach >= wallFacingMinApproachDot) {
			if (
				!wallImpact.hit || wallApproach > wallImpact.approach ||
				(wallApproach === wallImpact.approach && collision.tEntry < wallImpact.tEntry)
			) {
				wallImpact = buildWallImpact(collision, wallApproach, surfaceType);
			}
		}

		if (collision.pushDepth > 0) {
			disp = AddVector3(disp, ScaleVector3(collision.pushNormal, collision.pushDepth));
			changedPosition = changedPosition || collision.pushDepth > EPSILON;
		}

		// Slide: remove velocity component along collision normal.
		const velDotN = DotVector3(vel, collision.normal);
		if (velDotN < 0) {
			vel = SubtractVector3(vel, ScaleVector3(collision.normal, velDotN));
			changedVelocity = changedVelocity || Math.abs(velDotN) > EPSILON;
		}

		// Swept contacts should move to the impact point first, then only clip the
		// remaining into-surface travel. Overlap recovery keeps the existing push-out path.
		if (collision.pushDepth <= EPSILON && collision.tEntry > 0) {
			const entryDisplacement = ScaleVector3(disp, collision.tEntry);
			let remainingDisplacement = SubtractVector3(disp, entryDisplacement);
			const remainingDotN = DotVector3(remainingDisplacement, collision.normal);
			if (remainingDotN < 0) {
				remainingDisplacement = SubtractVector3(remainingDisplacement, ScaleVector3(collision.normal, remainingDotN));
				changedPosition = changedPosition || Math.abs(remainingDotN) > EPSILON;
			}
			disp = AddVector3(entryDisplacement, remainingDisplacement);
		}
		else {
			const dispDotN = DotVector3(disp, collision.normal);
			if (dispDotN < 0) {
				disp = SubtractVector3(disp, ScaleVector3(collision.normal, dispDotN));
				changedPosition = changedPosition || Math.abs(dispDotN) > EPSILON;
			}
		}

	}

	const anyChanged = changedPosition || changedVelocity;

	return {
		resolvedVelocity: vel,
		resolvedDisplacement: disp,
		floorImpact, wallImpact, changedPosition, changedVelocity, anyChanged,
	};
}

/* ========================================================================
 * GROUND PROBE
 * ======================================================================== */

/**
 * Ground probe from the capsule cylinder bottom: nearest point on each candidate collider,
 * classified on arrival and ranked class-first.
 * This is the sole authority on player grounding state, surface class and snap target.
 * Penetration pushout is unaffected — the capsule narrowphase handles that separately.
 *
 * @param {object} entity — player entity; the probe capsule is its frozen rest capsule, placed and rotated.
 * @param {object} sceneGraph
 * @param {{ referenceNormal: { x, y, z } }} frameStart — last walked surface, frozen for this frame.
 * @returns {{ hit: boolean, normal?: object, contact?: string, restDelta?: number, surfaceId: string | null }}
 */
function ProbeGroundContact(entity, sceneGraph, groundSnapTolerance, candidates, frameStart) {
	if (CONFIG.PHYSICS.Collision.Enabled === false) return { hit: false };

	// Rest-pose capsule, placed scale-then-rotation like every other collider.
	const groundCapsule = entity.collision.rest.groundCapsule;
	const scale = entity.transform.scale;
	const radius = groundCapsule.radius.value * Math.max(scale.x, scale.y, scale.z);
	const capOffset = MultiplyVector3(groundCapsule.segmentStart, scale);
	const probe = AddVector3(RotateByEuler(capOffset, entity.transform.rotation), entity.transform.position);
	const maxDist = radius + groundSnapTolerance;

	// Coupled surface: held until it stops grounding.
	const coupledId = entity.physicsRuntime.groundSurfaceId;
	const hits = [];

	// Nearest point on the axis-aligned box; normal is the contact direction, box to probe.
	const tryAABB = (from, bounds) => {
		const closest = ClampVector3(from, bounds.min, bounds.max);
		const offset = SubtractVector3(from, closest);
		const distanceSq = Vector3Sq(offset);
		// Embedded, or out of reach.
		if (distanceSq === 0 || distanceSq > Squared(maxDist)) return null;

		const t = Math.sqrt(distanceSq);
		return { t, normal: DivideVector3(offset, ToVector3(t)), point: closest };
	};

	// Nearest point on the oriented box — face interior, edge or corner.
	const tryOBB = (from, obb) => {
		const closest = obb.center.clone();
		let faceAxis = 0;
		let faceSign = 1;
		let worstExcess = -Infinity;
		for (let axis = 0; axis < 3; axis++) {
			const edge = obb.axes[axis];
			const extent = axis === 0 ? obb.halfExtents.x : axis === 1 ? obb.halfExtents.y : obb.halfExtents.z;
			const along = ((from.x - obb.center.x) * edge.x) + ((from.y - obb.center.y) * edge.y) + ((from.z - obb.center.z) * edge.z);
			closest.add(ScaleVector3(edge, Clamp(along, -extent, extent)));

			const excess = Math.abs(along) - extent;
			if (excess <= worstExcess) continue;
			worstExcess = excess;
			faceAxis = axis;
			faceSign = along >= 0 ? 1 : -1;
		}

		// Inside the solid: embedded, not resting.
		if (worstExcess < 0) return null;

		const offset = SubtractVector3(from, closest);
		const distanceSq = Vector3Sq(offset);
		if (distanceSq > Squared(maxDist)) return null;

		// Contact direction — box to probe.
		const distance = Math.sqrt(distanceSq);
		const normal = distance > EPSILON
			? DivideVector3(offset, ToVector3(distance))
			: ScaleVector3(obb.axes[faceAxis], faceSign);
		return { t: distance, normal, point: closest };
	};

	// Offset to the nearest point; null when behind the face.
	const reachesTriangle = (from, triangle) => {
		const offset = SubtractVector3(from, ClosestPointOnTriangle(from, triangle.a, triangle.b, triangle.c));
		return DotVector3(offset, triangle.normal) < 0 ? null : offset;
	};

	// Triangle closest to the probe by true distance.
	const trySoup = (from, soup) => {
		let soupDistanceSq = Squared(maxDist);
		let soupTriangle = null;
		let soupOffset = null;
		for (const triangle of soup.triangles) {
			if (from.x < Math.min(triangle.a.x, triangle.b.x, triangle.c.x) - maxDist || from.x > Math.max(triangle.a.x, triangle.b.x, triangle.c.x) + maxDist) continue;
			if (from.z < Math.min(triangle.a.z, triangle.b.z, triangle.c.z) - maxDist || from.z > Math.max(triangle.a.z, triangle.b.z, triangle.c.z) + maxDist) continue;
			if (from.y < Math.min(triangle.a.y, triangle.b.y, triangle.c.y) - maxDist || from.y > Math.max(triangle.a.y, triangle.b.y, triangle.c.y) + maxDist) continue;

			const offset = reachesTriangle(from, triangle);
			if (offset === null) continue;
			const distanceSq = Vector3Sq(offset);
			if (distanceSq >= soupDistanceSq) continue;
			soupDistanceSq = distanceSq;
			soupTriangle = triangle;
			soupOffset = offset;
		}
		if (soupTriangle === null) return null;

		return {
			t: Math.sqrt(soupDistanceSq),
			normal: CloneVector3(soupTriangle.normal),
			point: SubtractVector3(from, soupOffset),
		};
	};


	// Walls never ground.
	const pushHit = (t, normal, surfaceId) => {
		const contact = ClassifySurface(frameStart.referenceNormal, normal, entity.surfaceContact, entity.underwater);
		if (contact !== "wall") hits.push({ t, normal, contact, surfaceId });
	};

	// Candidates are already simRadius-filtered by the broadphase, so no overlap test is repeated here.
	for (const candidate of candidates) {
		const isTerrain = candidate.type === "terrain";
		if (!isTerrain && candidate.type !== "obstacle") continue;
		let t, normal, point;
		if (candidate.detailedBounds.type === "aabb") {
			const hit = tryAABB(probe, candidate.detailedBounds);
			if (!hit) continue; t = hit.t; normal = hit.normal; point = hit.point;
		}
		else if (candidate.detailedBounds.type === "obb") {
			const hit = tryOBB(probe, candidate.detailedBounds);
			if (!hit) continue; t = hit.t; normal = hit.normal; point = hit.point;
		}
		else if (candidate.detailedBounds.type === "triangle-soup") {
			if (probe.x < candidate.aabb.min.x - maxDist || probe.x > candidate.aabb.max.x + maxDist) continue;
			if (probe.z < candidate.aabb.min.z - maxDist || probe.z > candidate.aabb.max.z + maxDist) continue;
			const hit = trySoup(probe, candidate.detailedBounds);
			if (!hit) continue; t = hit.t; normal = hit.normal; point = hit.point;
		}
		else continue;
		const source = candidate.ref;
		const nullable = isTerrain ? source.meta.nullable : source.nullable;
		const voids = isTerrain ? sceneGraph.voids.terrain : sceneGraph.voids.obstacles;
		if (nullable !== false && IsPointInSuppressingVoid(point, source.id, voids)) continue;
		pushHit(t, normal, source.id);
	}

	// Void-wall lining, both soups.
	const probeVoidWalls = (entries) => {
		const pushSoupHit = (soup, surfaceId) => {
			const hit = trySoup(probe, soup);
			if (hit) pushHit(hit.t, hit.normal, surfaceId);
		};
		for (const entry of entries) {
			for (const id in entry.relations) {
				for (const voidWall of entry.relations[id].voidWallMeshes) {
					if (probe.x < voidWall.worldAabb.min.x - maxDist || probe.x > voidWall.worldAabb.max.x + maxDist) continue;
					if (probe.z < voidWall.worldAabb.min.z - maxDist || probe.z > voidWall.worldAabb.max.z + maxDist) continue;
					pushSoupHit(voidWall.floorBounds, id);
					pushSoupHit(voidWall.wallBounds, id);
				}
			}
		}
	};
	probeVoidWalls(sceneGraph.voids.terrain);
	probeVoidWalls(sceneGraph.voids.obstacles);

	// Class first: walkable over sliding, then the coupled surface, then nearest.
	let chosen = null;
	for (const hit of hits) {
		if (chosen === null) { chosen = hit; continue; }
		if (hit.contact !== chosen.contact) { if (hit.contact === "walkable") chosen = hit; continue; }
		const hitCoupled = hit.surfaceId === coupledId;
		if (hitCoupled !== (chosen.surfaceId === coupledId)) { if (hitCoupled) chosen = hit; continue; }
		if (hit.t < chosen.t) chosen = hit;
	}

	if (chosen === null) return { hit: false, surfaceId: null };

	// Cap centre rests radius from the surface, along the normal.
	return {
		hit: true,
		normal: chosen.normal,
		contact: chosen.contact,
		restDelta: radius - chosen.t,
		surfaceId: chosen.surfaceId,
	};
}

/* === EXPORTS === */

export {
	BroadphaseCollectCandidates,
	IsPointInSuppressingVoid,
	DetectPhysicsCollisions,
	DetectCurrentPhysicsOverlaps,
	DetectCombatOverlaps,
	ResolveCollisions,
	ResetCollisionPools,
	ProbeGroundContact,
	NarrowphaseTest,
	GetSimDistanceValue,
	IsBeyondSimDistance,
	CheckEntityAabbOverlap,
	CheckEntityTrueOverlap,
	GetEntityPhysicsFlags,
};
