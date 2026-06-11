// Three-layer collision system: physics / hurtbox / hitbox.
// Physics layer resolves geometry (swept detection + slide).
// Hurtbox/Hitbox layers resolve combat overlaps (static tests, no geometry resolution).

// Used by physics/Master.js

import { CONFIG } from "../core/config.js";
import { EPSILON } from "../core/meta.js";
import {
	AddVector3,
	SubtractVector3,
	ScaleVector3,
	DotVector3,
	Vector3Sq,
	CloneVector3,
	ToVector3,
	AbsoluteVector3,
	WORLD_NORMALS,
} from "../math/Vector3.js";
import {
	SweptAABB,
	AabbOverlap,
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
	RayOBBIntersect,
	SweptSphereAABB,
	SweptSphereOBB,
	NoContact,
} from "../math/Collision.js";

// Minimum cosine of horizontal incidence for a surface contact to count as a
// wall hit (~60° from head-on). Below this the entity is grazing the surface
// rather than running into it, so no wall contact is reported. Local to this
// module, so lowerCamelCase per CASING.md — the ground-snap tolerance, by
// contrast, is shared and is supplied by the orchestrator (physics/Master.js).
const wallFacingMinApproachDot = 0.5;

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
		supportPoint: null,
		type: null, 
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

function resolveBoundsSupportPoint(bounds, normal) {
	switch (bounds.type) {
		case "obb":
			return AddVector3(bounds.center, AddVector3(
				ScaleVector3(bounds.axes[0], DotVector3(normal, bounds.axes[0]) >= 0 ? bounds.halfExtents.x : -bounds.halfExtents.x),
				AddVector3(
					ScaleVector3(bounds.axes[1], DotVector3(normal, bounds.axes[1]) >= 0 ? bounds.halfExtents.y : -bounds.halfExtents.y),
					ScaleVector3(bounds.axes[2], DotVector3(normal, bounds.axes[2]) >= 0 ? bounds.halfExtents.z : -bounds.halfExtents.z)
				)
			));
		case "aabb":
			return {
				x: normal.x >= 0 ? bounds.max.x : bounds.min.x,
				y: normal.y >= 0 ? bounds.max.y : bounds.min.y,
				z: normal.z >= 0 ? bounds.max.z : bounds.min.z,
			};
		case "sphere": return AddVector3(bounds.center, ScaleVector3(normal, bounds.radius.value));
		case "capsule":
			const endpoint = DotVector3(bounds.segmentStart, normal) >= DotVector3(bounds.segmentEnd, normal) 
				? bounds.segmentStart 
				: bounds.segmentEnd;
			return AddVector3(endpoint, ScaleVector3(normal, bounds.radius.value));
		case "compound-sphere":
			let bestSphere = bounds.spheres[0];
			let bestProjection = DotVector3(bestSphere.center, normal) + bestSphere.radius.value;
			for (let index = 1; index < bounds.spheres.length; index++) {
				const projection = DotVector3(bounds.spheres[index].center, normal) + bounds.spheres[index].radius.value;
				if (projection > bestProjection) {
					bestProjection = projection;
					bestSphere = bounds.spheres[index];
				}
			}
			return AddVector3(bestSphere.center, ScaleVector3(normal, bestSphere.radius.value));
		default: return null;
	}
}

const resolveContactSupportPoint = (bounds, contact) => contact.point ? CloneVector3(contact.point) : resolveBoundsSupportPoint(bounds, contact.normal);

function resolvePushSupportPoint(bounds, contact) {
	if (bounds.type === "triangle-soup" && contact.point) return CloneVector3(contact.point);
	const supportPoint = resolveBoundsSupportPoint(bounds, contact.normal);
	if (supportPoint) return supportPoint;
	if (contact.point) return CloneVector3(contact.point);
	return null;
}

function projectAabbPushContact(entityAabb, candidateBounds, contact) {
	if (!contact.hit) return { contact: NoContact(), supportPoint: null };

	const supportPoint = resolvePushSupportPoint(candidateBounds, contact);
	if (!supportPoint) return { contact: NoContact(), supportPoint: null };

	const normal = ScaleVector3(contact.normal, -1);
	const entitySupportPoint = {
		x: normal.x >= 0 ? entityAabb.max.x : entityAabb.min.x,
		y: normal.y >= 0 ? entityAabb.max.y : entityAabb.min.y,
		z: normal.z >= 0 ? entityAabb.max.z : entityAabb.min.z,
	};
	const depth = DotVector3(SubtractVector3(supportPoint, entitySupportPoint), contact.normal);
	if (depth <= EPSILON) return { contact: NoContact(), supportPoint };

	return {
		contact: { hit: true, normal: CloneVector3(contact.normal), depth, point: CloneVector3(supportPoint) },
		supportPoint,
	};
}

function resolveAabbDetailedPushContact(entityAabb, candidateBounds, contact) {
	if (candidateBounds.type !== "triangle-soup") {
		const pushContact = narrowphaseContact({
			type: "aabb",
			min: entityAabb.min,
			max: entityAabb.max,
		}, candidateBounds);
		if (pushContact.hit) return { contact: pushContact, supportPoint: resolvePushSupportPoint(candidateBounds, pushContact) };
	}

	return projectAabbPushContact(entityAabb, candidateBounds, contact);
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
	const typeA = boundsA.type;
	const typeB = boundsB.type;

	const invertContact = (contact) => {
		if (!contact.hit) return contact;
		return { hit: true, normal: ScaleVector3(contact.normal, -1), depth: contact.depth, point: contact.point };
	}

	switch (typeA.substring(0, 2) + typeB.substring(0, 2)) {
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
		case "aaaa": return aabbAabbContact(boundsA, boundsB);
		case "aaob": return AabbObbContact(boundsA, boundsB);
		case "obaa": return invertContact(AabbObbContact(boundsB, boundsA));

		case "spco": return iterateCompoundSpheres(boundsB, s => SphereSphereContact(boundsA.center, boundsA.radius, s.center, s.radius));
		case "cosp": return iterateCompoundSpheres(boundsA, s => invertContact(SphereSphereContact(boundsB.center, boundsB.radius, s.center, s.radius)));
		case "caco": return iterateCompoundSpheres(boundsB, s => invertContact(SphereCapsuleContact(s.center, s.radius, boundsA)));
		case "coca": return iterateCompoundSpheres(boundsA, s => SphereCapsuleContact(s.center, s.radius, boundsB));
	}
	
	if (typeA === "compound-sphere") return iterateCompoundSpheres(boundsA, s => narrowphaseContact({ type: "sphere", center: s.center, radius: s.radius }, boundsB));
	if (typeB === "compound-sphere") return iterateCompoundSpheres(boundsB, s => narrowphaseContact(boundsA, { type: "sphere", center: s.center, radius: s.radius }));

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

function GetSimDistanceValue() {
	if (CONFIG.PERFORMANCE.SimDistance === "Low")    { return 35; }
	if (CONFIG.PERFORMANCE.SimDistance === "Medium") { return 60; }
	return 100;
}

const getHalfExtents = (aabb) => aabb.max.clone().subtract(aabb.min).scale(0.5);

function expandAabb(aabb, padding) {
	return {
		min: aabb.min.clone().subtract(ToVector3(padding)),
		max: aabb.max.clone().add(ToVector3(padding)),
	};
}

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
function BroadphaseCollectCandidates(sceneGraph, simRadiusAabb) {
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
		if (!withinSimRadius(obs.bounds)) return;
		candidates.push({
			id            : obs.id,
			pairId        : obs.id,
			aabb          : obs.bounds,
			detailedBounds: obs.detailedBounds,
			isTrigger     : false,
			type          : "obstacle",
			ref           : obs,
		});
	});

	// Triggers.
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

	// Physics-enabled entities (for N-body physics).
	sceneGraph.entities.forEach(ent => {
		if (ent.type === "player" || !ent.collision.detailedBounds) return;
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

	return candidates;
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

function fillSolidResult(candidate, swept, contact, candidateBounds) {
	const item        = poolPush(solidResultPool);
	item.target       = candidate;
	item.tEntry       = swept.tEntry;
	item.normal       = contact.normal;
	item.depth        = contact.depth;
	item.pushDepth    = 0;
	item.pushNormal   = contact.normal;
	item.point        = contact.point;
	item.supportPoint = resolveContactSupportPoint(candidateBounds, contact);
	item.type         = candidate.type;
	return item;
}

function createEmptyGroundContact() {
	return {
		hit: false,
		normal: CloneVector3(WORLD_NORMALS.Up),
		type: null,
		supportPoint: null,
		supportY: -1,
		tEntry: 1,
	};
}

function buildGroundContact(collision, supportY) {
	return {
		hit: true,
		normal: CloneVector3(collision.pushNormal),
		type: collision.type,
		supportPoint: CloneVector3(collision.supportPoint),
		supportY: supportY,
		tEntry: collision.tEntry,
	};
}

function createEmptyWallContact() {
	return {
		hit: false,
		normal: CloneVector3(WORLD_NORMALS.Forward),
		tEntry: 1,
		approach: 0,
	};
}

function buildWallContact(collision, approach) {
	return {
		hit: true,
		normal: CloneVector3(collision.normal),
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
	if (CONFIG.PHYSICS.Collision.Enabled === false) {
		ResetCollisionPools();
		return { solids: solidResultPool, triggers: triggerResultPool };
	}

	const vel = displacement;
	const candidates = BroadphaseCollectCandidates(sceneGraph, entity.collision.simRadiusAabb);

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
			const cachedPair = entity.type === "player" ? null : readReusableActiveCollisionPair(entity, candidate);
			if (entity.type === "player") {
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

				fillSolidResult(candidate, swept, contact, candidate.detailedBounds).shape = entity.collision.physics.bounds.type;
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

			fillSolidResult(candidate, swept, contact, candidate.detailedBounds);
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
	if (CONFIG.PHYSICS.Collision.Enabled === false) {
		ResetCollisionPools();
		return { solids: solidResultPool, triggers: triggerResultPool };
	}

	ResetCollisionPools();

	for (const candidate of BroadphaseCollectCandidates(sceneGraph, entity.collision.simRadiusAabb)) {
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

		const cachedPair = entity.type === "player" || candidate.detailedBounds.type === "triangle-soup"
			? null
			: readReusableActiveCollisionPair(entity, candidate);
		const contact = cachedPair 
			? buildContactFromCachedPair(cachedPair) 
			: narrowphaseContact(entity.collision.physics.bounds, candidate.detailedBounds);
		
		if (!contact.hit) {
			removeActiveCollisionPair(entity, candidate);
			continue;
		}
		const push = resolveAabbDetailedPushContact(entity.collision.aabb, candidate.detailedBounds, contact);
		if (entity.type !== "player") cacheActiveCollisionPair(entity, candidate, contact.normal, contact.depth);

		const item = poolPush(solidResultPool);
		item.target = candidate;
		item.tEntry = 0;
		item.normal = contact.normal;
		item.depth = contact.depth;
		item.pushDepth = push.contact.depth;
		item.pushNormal = push.contact.hit ? push.contact.normal : contact.normal;
		item.point = contact.point;
		item.supportPoint = push.supportPoint || resolveContactSupportPoint(candidate.detailedBounds, contact);
		item.type = candidate.type;
		item.shape = entity.collision.physics.bounds.type;
	}

	return { solids: solidResultPool, triggers: triggerResultPool };
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
 * @param {number} simRadius — activity radius for filtering.
 * @param {{ x, y, z }} cameraPos — camera position for distance gating.
 * @returns {{ items: Array, count: number }}
 */
function DetectCombatOverlaps(playerState, entities, simRadius, cameraPos) {
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
		if (entity === playerState || entity.type === "collectible") continue;

		// SimDistance gate.
		if (Vector3Sq(SubtractVector3(cameraPos, entity.transform.position)) > simRadius * simRadius) continue;

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
 * @returns {{ resolvedVelocity, resolvedDisplacement, groundContact, wallContact, changedPosition, changedVelocity, anyChanged }}
 */
function ResolveCollisions(velocity, displacement, solids) {
	let vel = CloneVector3(velocity);
	let disp = CloneVector3(displacement);
	let groundContact = createEmptyGroundContact();
	let wallContact = createEmptyWallContact();
	let changedPosition = false;
	let changedVelocity = false;

	if (solids.count === 0) {
		return {
			resolvedVelocity: vel,
			resolvedDisplacement: disp,
			groundContact,
			wallContact,
			changedPosition: false,
			changedVelocity: false,
			anyChanged: false,
		};
	}

	for (let i = 0; i < solids.count; i++) { 
		const collision = solids.items[i];
		const isSurfaceCandidate = collision.type === "terrain" || collision.type === "obstacle";
		const wallApproach = isSurfaceCandidate ? resolveWallApproachStrength(velocity, collision.normal) : 0;

		if (isSurfaceCandidate && collision.pushNormal.y > 0.5) {
			if (
				!groundContact.hit || collision.pushNormal.y > groundContact.supportY ||
				(collision.pushNormal.y === groundContact.supportY && collision.tEntry < groundContact.tEntry)
			) {
				groundContact = buildGroundContact(collision, collision.pushNormal.y);
			}
		}

		if (isSurfaceCandidate && wallApproach >= wallFacingMinApproachDot) {
			if (
				!wallContact.hit || wallApproach > wallContact.approach ||
				(wallApproach === wallContact.approach && collision.tEntry < wallContact.tEntry)
			) {
				wallContact = buildWallContact(collision, wallApproach);
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
		groundContact, wallContact, changedPosition, changedVelocity, anyChanged,
	};
}

/* ========================================================================
 * GROUND PROBE
 * ======================================================================== */

/**
 * Downward point probe from the capsule cylinder bottom.
 * Checks for flat-topped geometry directly below within capsule + snap range.
 * This is the sole authority on player grounding state and snap target.
 * Penetration pushout is unaffected — the capsule narrowphase handles that separately.
 *
 * @param {object} entity — player entity with collision.profile.capsuleStartOffset.
 * @param {object} sceneGraph
 * @returns {{ hit: boolean, normal?: object, type?: string, supportPoint?: object }}
 */
function ProbeGroundContact(entity, sceneGraph, groundSnapTolerance) {
	if (CONFIG.PHYSICS.Collision.Enabled === false) return { hit: false };

	const probe = entity.transform.position.clone().add(entity.collision.profile.capsuleStartOffset);
	const maxDist = entity.collision.profile.capsuleRadius.value + groundSnapTolerance;

	let bestT = Infinity;
	let bestNormal = null;
	let type = null;

	// Downward ray vs axis-aligned box: entry t = vertical distance from probe to top face.
	const tryAABB = (bounds, meshType) => {
		if (probe.x < bounds.min.x || probe.x > bounds.max.x) return;
		if (probe.z < bounds.min.z || probe.z > bounds.max.z) return;
		const t = probe.y - bounds.max.y;
		if (t < 0 || t > maxDist) return;
		if (t < bestT) { bestT = t; bestNormal = WORLD_NORMALS.Up; type = meshType; }
	};

	// Downward ray (0,-1,0) vs oriented box via slab test in OBB local space.
	// Returns the entry face normal, which must be upward-facing to count as ground.
	const tryOBB = (obb, meshType) => {
		const hit = RayOBBIntersect(probe, WORLD_NORMALS.Down, obb, maxDist);
		if (!hit.hit || hit.normal.y <= 0) return;
		if (hit.t < bestT) {
			bestT = hit.t;
			bestNormal = hit.normal;
			type = meshType;
		}
	};

	for (const mesh of sceneGraph.terrain) {
		if      (!AabbOverlap(entity.collision.simRadiusAabb, mesh.worldAabb)) continue;
		if      (mesh.detailedBounds.type === "aabb")                          tryAABB(mesh.detailedBounds, "terrain");
		else if (mesh.detailedBounds.type === "obb")                           tryOBB(mesh.detailedBounds, "terrain");
	}

	for (const obs of sceneGraph.obstacles) {
		if      (!AabbOverlap(entity.collision.simRadiusAabb, obs.bounds))  continue;
		if      (obs.detailedBounds.type === "aabb")                        tryAABB(obs.detailedBounds, "obstacle");
		else if (obs.detailedBounds.type === "obb")                         tryOBB(obs.detailedBounds , "obstacle");
	}

	if (type === null) return { hit: false };

	return {
		hit: true,
		normal: bestNormal === WORLD_NORMALS.Up ? CloneVector3(WORLD_NORMALS.Up) : bestNormal,
		type,
		supportPoint: { x: probe.x, y: probe.y - bestT, z: probe.z },
	};
}

/* === EXPORTS === */

export {
	DetectPhysicsCollisions,
	DetectCurrentPhysicsOverlaps,
	DetectCombatOverlaps,
	ResolveCollisions,
	ResetCollisionPools,
	ProbeGroundContact,
	NarrowphaseTest,
	GetSimDistanceValue,
	CheckEntityAabbOverlap,
	CheckEntityTrueOverlap,
};
