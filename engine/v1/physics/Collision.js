// Three-layer collision system: physics / hurtbox / hitbox.
// Physics layer resolves geometry (swept detection + slide).
// Hurtbox/Hitbox layers resolve combat overlaps (static tests, no geometry resolution).

// Used by handlers/game/Physics.js, handlers/game/Enemy.js, handlers/game/Collectible.js.

import { CONFIG } from "../core/config.js";
import { Log, EPSILON } from "../core/meta.js";
import {
	NormalizeVector3,
	AddVector3,
	SubtractVector3,
	ScaleVector3,
	DotVector3,
} from "../math/Vector3.js";
import {
	SweptAABB,
	AABBOverlap,
	SphereSphereContact,
	SphereAABBContact,
	SphereOBBContact,
	SphereCapsuleContact,
	CapsuleAABBContact,
	CapsuleCapsuleContact,
	CapsuleOBBContact,
	SphereTriangleSoupContact,
	CapsuleTriangleSoupContact,
	InvertContact,
	SweptSphereAABB,
	SweptSphereOBB,
	NoContact,
} from "../math/Physics.js";
import { ToNumber } from "../math/Utilities.js";

/* ========================================================================
 * RESULT POOLS — grow-once, zero GC per frame.
 * ======================================================================== */

function createResultPool() {
	return { items: [], count: 0 };
}

function poolReset(pool) {
	pool.count = 0;
}

function poolPush(pool) {
	if (pool.count < pool.items.length) return pool.items[pool.count++];
	const item = { 
		target: null, 
		tEntry: 1, 
		normal: null, 
		depth: 0, 
		pushDepth: 0,
		pushNormal: null,
		type: null, 
		trigger: null, 
		attacker: null, 
		shape: null 
	};
	pool.items.push(item);
	pool.count++;
	return item;
}

const SolidResultPool = createResultPool();
const TriggerResultPool = createResultPool();
const HurtboxResultPool = createResultPool();

/**
 * Reset all collision result pools. Call once at the start of each frame.
 */
function ResetCollisionPools() {
	poolReset(SolidResultPool);
	poolReset(TriggerResultPool);
	poolReset(HurtboxResultPool);
}

/* ========================================================================
 * HELPERS
 * ======================================================================== */

function buildDetailedBoundsFromCollision(collision) {
	if (collision.physics && collision.physics.bounds) return collision.physics.bounds;
	if (collision.shape === "capsule" && collision.capsule) {
		return {
			type: "capsule",
			radius: collision.capsule.radius,
			halfHeight: collision.capsule.halfHeight,
			segmentStart: collision.capsule.segmentStart.clone(),
			segmentEnd: collision.capsule.segmentEnd.clone(),
		};
	}
	if (collision.detailedBounds) return collision.detailedBounds;
	return null;
}

function offsetDetailedBounds(bounds, offset) {
	if (!bounds) return null;
	else if (bounds.type === "capsule") {
		return {
			type: "capsule",
			radius: bounds.radius,
			halfHeight: bounds.halfHeight,
			segmentStart: bounds.segmentStart.clone().add(offset),
			segmentEnd: bounds.segmentEnd.clone().add(offset),
		};
	}
	else if (bounds.type === "obb") {
		return {
			type: "obb",
			center: bounds.center.clone().add(offset),
			halfExtents: bounds.halfExtents,
			axes: bounds.axes,
		};
	}
	else if (bounds.type === "sphere") {
		return {
			type: "sphere",
			center: bounds.center.clone().add(offset),
			radius: bounds.radius,
		};
	}
	else if (bounds.type === "aabb") {
		return {
			type: "aabb",
			min: bounds.min.clone().add(offset),
			max: bounds.max.clone().add(offset),
		};
	}
	else if (bounds.type === "compound-sphere") {
		return {
			type: "compound-sphere",
			spheres: bounds.spheres.map((sphere) => ({
				center: sphere.center.clone().add(offset),
				radius: sphere.radius,
				partId: sphere.partId,
			})),
		};
	}
	else if (bounds.type === "triangle-soup") {
		return {
			type: "triangle-soup",
			triangles: bounds.triangles.map((triangle) => ({
				a: triangle.a.clone().add(offset),
				b: triangle.b.clone().add(offset),
				c: triangle.c.clone().add(offset),
				normal: triangle.normal,
			})),
		};
	}
	else return bounds;
}

// Should probably be moved to other contact helper functions in math/Physics.js
function AabbAabbContact(boundsA, boundsB) {
	if (!AABBOverlap(boundsA, boundsB)) return NoContact();
	const centerA = getAabbCenter(boundsA);
	const centerB = getAabbCenter(boundsB);
	const overlaps = [
		{
			depth: centerA.x <= centerB.x ? boundsA.max.x - boundsB.min.x : boundsB.max.x - boundsA.min.x,
			normal: centerA.x <= centerB.x ? { x: -1, y: 0, z: 0 } : { x: 1, y: 0, z: 0 },
		},
		{
			depth: centerA.y <= centerB.y ? boundsA.max.y - boundsB.min.y : boundsB.max.y - boundsA.min.y,
			normal: centerA.y <= centerB.y ? { x: 0, y: -1, z: 0 } : { x: 0, y: 1, z: 0 },
		},
		{
			depth: centerA.z <= centerB.z ? boundsA.max.z - boundsB.min.z : boundsB.max.z - boundsA.min.z,
			normal: centerA.z <= centerB.z ? { x: 0, y: 0, z: -1 } : { x: 0, y: 0, z: 1 },
		},
	];

	let best = overlaps[0];
	for (let index = 1; index < overlaps.length; index++) {
		if (overlaps[index].depth < best.depth) best = overlaps[index];
	}

	return { hit: true, normal: best.normal, depth: best.depth };
}

function chooseDeepestContact(best, candidate) {
	if (!candidate.hit) return best;
	if (!best.hit || candidate.depth > best.depth) return candidate;
	return best;
}

function NarrowphaseContact(boundsA, boundsB) {
	const typeA = boundsA.type;
	const typeB = boundsB.type;

	if (typeA === "sphere" && typeB === "sphere") return SphereSphereContact(boundsA.center, boundsA.radius, boundsB.center, boundsB.radius);
	if (typeA === "sphere" && typeB === "aabb") return SphereAABBContact(boundsA.center, boundsA.radius, boundsB);
	if (typeA === "aabb" && typeB === "sphere") return InvertContact(SphereAABBContact(boundsB.center, boundsB.radius, boundsA));
	if (typeA === "sphere" && typeB === "obb") return SphereOBBContact(boundsA.center, boundsA.radius, boundsB);
	if (typeA === "obb" && typeB === "sphere") return InvertContact(SphereOBBContact(boundsB.center, boundsB.radius, boundsA));
	if (typeA === "sphere" && typeB === "capsule") return SphereCapsuleContact(boundsA.center, boundsA.radius, boundsB);
	if (typeA === "capsule" && typeB === "sphere") return InvertContact(SphereCapsuleContact(boundsB.center, boundsB.radius, boundsA));
	if (typeA === "capsule" && typeB === "aabb") return CapsuleAABBContact(boundsA, boundsB);
	if (typeA === "aabb" && typeB === "capsule") return InvertContact(CapsuleAABBContact(boundsB, boundsA));
	if (typeA === "capsule" && typeB === "capsule") return CapsuleCapsuleContact(boundsA, boundsB);
	if (typeA === "capsule" && typeB === "obb") return CapsuleOBBContact(boundsA, boundsB);
	if (typeA === "obb" && typeB === "capsule") return InvertContact(CapsuleOBBContact(boundsB, boundsA));
	if (typeA === "sphere" && typeB === "triangle-soup") return SphereTriangleSoupContact(boundsA.center, boundsA.radius, boundsB);
	if (typeA === "triangle-soup" && typeB === "sphere") return InvertContact(SphereTriangleSoupContact(boundsB.center, boundsB.radius, boundsA));
	if (typeA === "capsule" && typeB === "triangle-soup") return CapsuleTriangleSoupContact(boundsA, boundsB);
	if (typeA === "triangle-soup" && typeB === "capsule") return InvertContact(CapsuleTriangleSoupContact(boundsB, boundsA));
	if (typeA === "aabb" && typeB === "aabb") return AabbAabbContact(boundsA, boundsB);

	if (typeA === "sphere" && typeB === "compound-sphere") {
		let best = NoContact();
		for (let index = 0; index < boundsB.spheres.length; index += 1) {
			best = chooseDeepestContact(
				best, SphereSphereContact(
					boundsA.center, 
					boundsA.radius, boundsB.spheres[index].center, 
					boundsB.spheres[index].radius
				)
			);
		}
		return best;
	}
	if (typeA === "compound-sphere" && typeB === "sphere") {
		let best = NoContact();
		for (let index = 0; index < boundsA.spheres.length; index += 1) {
			best = chooseDeepestContact(
				best, InvertContact(SphereSphereContact(
					boundsB.center, 
					boundsB.radius, 
					boundsA.spheres[index].center, 
					boundsA.spheres[index].radius
				))
			);
		}
		return best;
	}
	if (typeA === "capsule" && typeB === "compound-sphere") {
		let best = NoContact();
		for (let index = 0; index < boundsB.spheres.length; index += 1) {
			best = chooseDeepestContact(
				best, InvertContact(SphereCapsuleContact(
					boundsB.spheres[index].center, 
					boundsB.spheres[index].radius, 
					boundsA
				))
			);
		}
		return best;
	}
	if (typeA === "compound-sphere" && typeB === "capsule") {
		let best = NoContact();
		for (let index = 0; index < boundsA.spheres.length; index += 1) {
			best = chooseDeepestContact(
				best, SphereCapsuleContact(
					boundsA.spheres[index].center, 
					boundsA.spheres[index].radius, 
					boundsB
				)
			);
		}
		return best;
	}

	if (typeA === "compound-sphere") {
		let best = NoContact();
		for (let index = 0; index < boundsA.spheres.length; index += 1) {
			best = chooseDeepestContact(
				best, NarrowphaseContact({ 
						type: "sphere", 
						center: boundsA.spheres[index].center, 
						radius: boundsA.spheres[index].radius 
					}, boundsB
				)
			);
		}
		return best;
	}
	if (typeB === "compound-sphere") {
		let best = NoContact();
		for (let index = 0; index < boundsB.spheres.length; index += 1) {
			best = chooseDeepestContact(
				best, NarrowphaseContact(boundsA, { 
					type: "sphere", 
					center: boundsB.spheres[index].center, 
					radius: boundsB.spheres[index].radius 
				})
			);
		}
		return best;
	}

	if ((typeA === "aabb" && typeB === "obb") || (typeA === "obb" && typeB === "aabb")) {
		return { hit: true, normal: { x: 0, y: 1, z: 0 }, depth: 0 };
	}

	return NoContact();
}

/* ========================================================================
 * NARROWPHASE DISPATCH
 * ======================================================================== */

/**
 * Shape-gated narrowphase test. Returns true if boundsA overlaps boundsB.
 */
function NarrowphaseTest(boundsA, boundsB) {
	return NarrowphaseContact(boundsA, boundsB).hit;
}

/* ========================================================================
 * BROADPHASE
 * ======================================================================== */

function GetSimDistanceValue() {
	const raw = CONFIG.PERFORMANCE.SimDistance;
	if (raw === "Low") { return 35; }
	if (raw === "Medium") { return 60; }
	return 100;
}

function getHalfExtents(aabb) {
	if (!aabb || !aabb.min || !aabb.max) return { x: 0.5, y: 0.5, z: 0.5 };
	return aabb.max.clone().subtract(aabb.min).scale(0.5);
}

function expandAabb(aabb, padding) {
	if (!aabb || !aabb.min || !aabb.max) return null;
	return {
		min: aabb.min.clone().subtract({ x: padding, y: padding, z: padding }),
		max: aabb.max.clone().add({ x: padding, y: padding, z: padding }),
	};
}

function buildEntityAabbAtPosition(entityAabb, position) {
	if (!entityAabb || !entityAabb.min || !entityAabb.max) return null;
	const halfExtents = getHalfExtents(entityAabb);
	const centerOffset = getAabbCenter(entityAabb).subtract(position);
	const centerPos = position.clone().add(centerOffset);
	return {
		min: centerPos.clone().subtract(halfExtents),
		max: centerPos.clone().add(halfExtents),
	};
}

function getAabbCenter(aabb) {
	if (!aabb || !aabb.min || !aabb.max) return { x: 0, y: 0, z: 0 };
	return aabb.min.clone().add(aabb.max).scale(0.5);
}

/**
 * Broadphase: collect all collidable scene objects within sim radius.
 */
function BroadphaseCollectCandidates(sceneGraph, simRadiusAabb) {
	const candidates = [];
	const withinSimRadius = (aabb) => {
		if (!simRadiusAabb) return true;
		return AABBOverlap(simRadiusAabb, aabb);
	};

	// Terrain (always solid).
	const terrain = sceneGraph.terrain;
	for (let i = 0; i < terrain.length; i++) {
		const mesh = terrain[i];
		if (!mesh || !mesh.worldAabb) continue;
		if (!withinSimRadius(mesh.worldAabb)) continue;
		candidates.push({
			id: mesh.id || "terrain",
			aabb: mesh.worldAabb,
			detailedBounds: mesh.detailedBounds,
			isTrigger: false,
			type: "terrain",
			ref: mesh,
		});
	}

	// Obstacles.
	const obstacles = Array.isArray(sceneGraph.obstacles) ? sceneGraph.obstacles : [];
	for (let i = 0; i < obstacles.length; i++) {
		const obs = obstacles[i];
		if (!obs) continue;
		const bounds = obs.bounds || (obs.mesh && obs.mesh.worldAabb) || null;
		if (!bounds) continue;
		if (!withinSimRadius(bounds)) continue;
		candidates.push({
			id: obs.id || "obstacle",
			aabb: bounds,
			detailedBounds: obs.detailedBounds || (obs.mesh ? obs.mesh.detailedBounds : null),
			isTrigger: false,
			type: "obstacle",
			ref: obs,
		});
	}

	// Triggers.
	const triggers = Array.isArray(sceneGraph.triggers) ? sceneGraph.triggers : [];
	for (let i = 0; i < triggers.length; i++) {
		const trig = triggers[i];
		if (!trig || !trig.worldAabb) continue;
		if (!withinSimRadius(trig.worldAabb)) continue;
		candidates.push({
			id: trig.id || "trigger",
			aabb: trig.worldAabb,
			isTrigger: true,
			type: "trigger",
			trigger: trig.meta && trig.meta.trigger ? trig.meta.trigger : (trig.trigger || null),
			ref: trig,
		});
	}

	// Physics-enabled entities (for N-body physics).
	const entities = sceneGraph.entities;
	for (let i = 0; i < entities.length; i++) {
		const ent = entities[i];
		if (!ent || !ent.collision || !ent.collision.aabb) continue;
		if (!ent.movement || !ent.movement.physics) continue;
		if (!withinSimRadius(ent.collision.aabb)) continue;
		candidates.push({
			id: ent.id || "entity",
			aabb: ent.collision.aabb,
			detailedBounds: ent.collision.detailedBounds,
			isTrigger: false,
			type: "entity",
			ref: ent,
		});
	}

	return candidates;
}

/* ========================================================================
 * ENTITY OVERLAP HELPERS (backward compat)
 * ======================================================================== */

function CheckEntityAabbOverlap(entityA, entityB) {
	const aabbA = entityA && entityA.collision ? entityA.collision.aabb : null;
	const aabbB = entityB && entityB.collision ? entityB.collision.aabb : null;
	if (!aabbA || !aabbB) return false;
	return AABBOverlap(aabbA, aabbB);
}

function CheckEntityTrueOverlap(entityA, entityB) {
	if (!CheckEntityAabbOverlap(entityA, entityB)) return false;
	const boundsA = buildDetailedBoundsFromCollision(entityA.collision);
	const boundsB = buildDetailedBoundsFromCollision(entityB.collision);
	return NarrowphaseTest(boundsA, boundsB);
}

/* ========================================================================
 * SWEPT HELPERS
 * ======================================================================== */

function checkSweptAabbPair(position, displacement, entityAabb, targetAabb) {
	if (!entityAabb || !targetAabb) {
		return { hit: false, tEntry: 1, tExit: 0, normal: { x: 0, y: 0, z: 0 } };
	}
	const halfExtents = getHalfExtents(entityAabb);
	const centerOffset = getAabbCenter(entityAabb).subtract(position);
	const centerPos = position.clone().add(centerOffset);
	return SweptAABB(centerPos, displacement, halfExtents, targetAabb);
}

function checkSweptSpherePair(position, displacement, radius, targetAabb) {
	if (!targetAabb) {
		return { hit: false, t: Infinity, normal: { x: 0, y: 0, z: 0 } };
	}
	const result = SweptSphereAABB(position, displacement, radius, targetAabb);
	// Normalize to same shape as SweptAABB output.
	return { hit: result.hit, tEntry: result.t, normal: result.normal };
}

function checkSweptSphereCandidatePair(position, displacement, radius, candidate) {
	const detailedBounds = candidate.detailedBounds;
	if (detailedBounds && detailedBounds.type === "obb") {
		const result = SweptSphereOBB(position, displacement, radius, detailedBounds);
		return { hit: result.hit, tEntry: result.t, normal: result.normal };
	}
	return checkSweptSpherePair(position, displacement, radius, candidate.aabb);
}

function buildCandidateBounds(candidate) {
	return candidate.detailedBounds || candidate.aabb;
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
		return { solids: SolidResultPool, triggers: TriggerResultPool };
	}

	const pos = entity.transform.position;
	const vel = displacement;
	const entityAabb = entity.collision.aabb;

	const simRadiusAabb = entity.collision.simRadiusAabb || expandAabb(entityAabb, entity.collision.simRadiusPadding || 8);
	const candidates = BroadphaseCollectCandidates(sceneGraph, simRadiusAabb);
	const entityFrameAabb = buildEntityAabbAtPosition(entityAabb, pos);
	const entityEndAabb = buildEntityAabbAtPosition(entityAabb, pos.clone().add(vel));
	const entityDetailedBounds = buildDetailedBoundsFromCollision(entity.collision);

	// Determine swept mode from entity physics shape.
	const physicsShape = entity.collision.physics ? entity.collision.physics.shape : entity.collision.shape;
	const useSphereSwept = physicsShape === "sphere";

	// For sphere swept: get radius from physics bounds.
	let sphereCenter = null;
	let sphereRadius = 0;
	if (useSphereSwept && entity.collision.physics && entity.collision.physics.bounds) {
		const pb = entity.collision.physics.bounds;
		sphereCenter = pb.center;
		sphereRadius = pb.radius.value;
	}

	ResetCollisionPools();

	for (let i = 0; i < candidates.length; i++) {
		const candidate = candidates[i];

		// Skip self.
		if (candidate.type === "entity" && candidate.ref === entity) continue;

		if (candidate.isTrigger) {
			if (AABBOverlap(entityFrameAabb, candidate.aabb)) {
				const item = poolPush(TriggerResultPool);
				item.target = candidate;
				item.type = "trigger";
			}
			continue;
		}

		// Swept test.
		let swept;
		if (useSphereSwept && sphereCenter) {
			swept = checkSweptSphereCandidatePair(sphereCenter, vel, sphereRadius, candidate);
		} 
		else swept = checkSweptAabbPair(pos, vel, entityAabb, candidate.aabb);

		if (swept.hit && swept.tEntry >= 0 && swept.tEntry <= 1) {
			const candidateBounds = buildCandidateBounds(candidate);
			if (entity.type === "player") {
				const entryOffset = ScaleVector3(vel, swept.tEntry);
				const endBounds = offsetDetailedBounds(entityDetailedBounds, vel);
				let contact = NarrowphaseContact(endBounds, candidateBounds);
				if (!contact.hit) {
					const entryBounds = offsetDetailedBounds(entityDetailedBounds, entryOffset);
					contact = NarrowphaseContact(entryBounds, candidateBounds);
				}
				if (!contact.hit) continue;

				const item = poolPush(SolidResultPool);
				item.target = candidate;
				item.tEntry = swept.tEntry;
				item.normal = contact.normal;
				item.depth = contact.depth;
				item.pushDepth = 0;
				item.pushNormal = null;
				item.type = candidate.type;
				item.shape = entityDetailedBounds.type;
				continue;
			}

			// Non-player narrowphase remains boolean-gated.
			const entityDetailed = offsetDetailedBounds(
				entityDetailedBounds,
				ScaleVector3(vel, swept.tEntry)
			);
			if (!NarrowphaseTest(entityDetailed, candidateBounds)) continue;

			const item = poolPush(SolidResultPool);
			item.target = candidate;
			item.tEntry = swept.tEntry;
			item.normal = swept.normal;
			item.depth = 0;
			item.pushDepth = 0;
			item.pushNormal = null;
			item.type = candidate.type;
		}
	}

	// Sort solids by time of entry (closest first).
	const solidSlice = SolidResultPool.items;
	const solidCount = SolidResultPool.count;
	for (let i = 1; i < solidCount; i++) {
		const key = solidSlice[i];
		const keyT = key.tEntry;
		let j = i - 1;
		while (j >= 0 && solidSlice[j].tEntry > keyT) {
			solidSlice[j + 1] = solidSlice[j];
			j--;
		}
		solidSlice[j + 1] = key;
	}

	return { solids: SolidResultPool, triggers: TriggerResultPool };
}

function DetectCurrentPhysicsOverlaps(entity, sceneGraph) {
	if (CONFIG.PHYSICS.Collision.Enabled === false) {
		ResetCollisionPools();
		return { solids: SolidResultPool, triggers: TriggerResultPool };
	}

	const entityAabb = entity.collision.aabb;
	const simRadiusAabb = entity.collision.simRadiusAabb || expandAabb(entityAabb, entity.collision.simRadiusPadding);
	const candidates = BroadphaseCollectCandidates(sceneGraph, simRadiusAabb);
	const entityDetailedBounds = buildDetailedBoundsFromCollision(entity.collision);

	ResetCollisionPools();

	for (let index = 0; index < candidates.length; index++) {
		const candidate = candidates[index];
		if (candidate.type === "entity" && candidate.ref === entity) continue;

		if (candidate.isTrigger) {
			if (AABBOverlap(entityAabb, candidate.aabb)) {
				const triggerItem = poolPush(TriggerResultPool);
				triggerItem.target = candidate;
				triggerItem.type = "trigger";
			}
			continue;
		}

		if (!AABBOverlap(entityAabb, candidate.aabb)) continue;

		const candidateBounds = buildCandidateBounds(candidate);
		const contact = NarrowphaseContact(entityDetailedBounds, candidateBounds);
		if (!contact.hit) continue;

		const aabbContact = AabbAabbContact(entityAabb, candidate.aabb);
		const item = poolPush(SolidResultPool);
		item.target = candidate;
		item.tEntry = 0;
		item.normal = contact.normal;
		item.depth = contact.depth;
		item.pushDepth = aabbContact.depth;
		item.pushNormal = aabbContact.normal;
		item.type = candidate.type;
		item.shape = entityDetailedBounds.type;
	}

	return { solids: SolidResultPool, triggers: TriggerResultPool };
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
		poolReset(HurtboxResultPool);
		return HurtboxResultPool;
	}

	poolReset(HurtboxResultPool);

	for (let i = 0; i < entities.length; i++) {
		const entity = entities[i];
		if (entity === playerState) continue;
		if (entity.type === "collectible") continue;
		if (!entity.collision) continue;

		// SimDistance gate.
		const d = cameraPos.clone().subtract(entity.transform.position);
		if ((d.x * d.x + d.y * d.y + d.z * d.z) > simRadius * simRadius) continue;

		// Broadphase: player AABB vs entity AABB.
		if (!AABBOverlap(playerState.collision.aabb, entity.collision.aabb)) continue;

		// Player hitbox active → player attacks entity.
		if (playerState.hitboxActive && CONFIG.PHYSICS.Collision.Hitbox !== false) {
			const playerHitbox = playerState.collision.hitbox;
			const entityHurtbox = entity.collision.hurtbox;
			if (playerHitbox && entityHurtbox) {
				if (NarrowphaseTest(playerHitbox.bounds, entityHurtbox.bounds)) {
					const item = poolPush(HurtboxResultPool);
					item.attacker = playerState;
					item.target = entity;
					item.type = "player-attacks";
				}
			}
		}

		// Entity hitbox active → entity attacks player.
		if (entity.hitboxActive !== false && CONFIG.PHYSICS.Collision.Hurtbox !== false) {
			const entityHitbox = entity.collision.hitbox;
			const playerHurtbox = playerState.collision.hurtbox;
			if (entityHitbox && playerHurtbox) {
				if (NarrowphaseTest(entityHitbox.bounds, playerHurtbox.bounds)) {
					const item = poolPush(HurtboxResultPool);
					item.attacker = entity;
					item.target = playerState;
					item.type = "entity-attacks";
				}
			}
		}
	}

	return HurtboxResultPool;
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
 * @returns {{ resolvedVelocity, resolvedDisplacement, groundContact, changedPosition, changedVelocity, anyChanged }}
 */
function ResolveCollisions(velocity, displacement, solids) {
	let vel = NormalizeVector3(velocity);
	let disp = NormalizeVector3(displacement);
	let groundContact = { hit: false, normal: { x: 0, y: 1, z: 0 }, supportY: -1 };
	let changedPosition = false;
	let changedVelocity = false;

	// Support both pool objects and plain arrays.
	const items = solids && solids.items ? solids.items : solids;
	const count = solids && typeof solids.count === "number" ? solids.count : (Array.isArray(items) ? items.length : 0);

	if (count === 0) {
		return {
			resolvedVelocity: vel,
			resolvedDisplacement: disp,
			groundContact: groundContact,
			changedPosition: false,
			changedVelocity: false,
			anyChanged: false,
		};
	}

	for (let i = 0; i < count; i++) {
		const collision = items[i];
		const n = NormalizeVector3(collision.normal);
		const pushNormal = NormalizeVector3(collision.pushNormal || collision.normal);
		const isTerrainGround = collision.type === "terrain" && n.y > 0.5;
		const isObstacleGround = collision.type === "obstacle" && pushNormal.y > 0.5;
		const isGroundCandidate = isTerrainGround || isObstacleGround;
		const groundNormal = isObstacleGround ? pushNormal : n;
		const groundSupportY = isObstacleGround ? pushNormal.y : n.y;

		if (isGroundCandidate) {
			if (
				!groundContact.hit ||
				groundSupportY > ToNumber(groundContact.supportY, -1) ||
				(
					groundSupportY === ToNumber(groundContact.supportY, -1) &&
					collision.tEntry < ToNumber(groundContact.tEntry, 1)
				)
			) {
				groundContact = {
					hit: true,
					normal: { ...groundNormal },
					type: collision.type,
					targetId: collision && collision.target ? collision.target.id : null,
					targetAabb: collision && collision.target && collision.target.aabb ? collision.target.aabb : null,
					supportY: groundSupportY,
					tEntry: collision.tEntry,
				};
			}
		}

		const pushDepth = collision.pushDepth;
		if (pushDepth > 0) {
			disp = AddVector3(disp, ScaleVector3(pushNormal, pushDepth));
			changedPosition = changedPosition || pushDepth > EPSILON;
		}

		// Slide: remove velocity component along collision normal.
		const velDotN = DotVector3(vel, n);
		if (velDotN < 0) {
			vel = SubtractVector3(vel, ScaleVector3(n, velDotN));
			changedVelocity = changedVelocity || Math.abs(velDotN) > EPSILON;
		}

		// Adjust displacement similarly.
		const dispDotN = DotVector3(disp, n);
		if (dispDotN < 0) {
			disp = SubtractVector3(disp, ScaleVector3(n, dispDotN));
			changedPosition = changedPosition || Math.abs(dispDotN) > EPSILON;
		}

		LogCollision(collision);
	}

	const anyChanged = changedPosition || changedVelocity;

	return {
		resolvedVelocity: vel,
		resolvedDisplacement: disp,
		groundContact: groundContact,
		changedPosition: changedPosition,
		changedVelocity: changedVelocity,
		anyChanged: anyChanged,
	};
}

/* ========================================================================
 * LOGGING
 * ======================================================================== */

let lastLoggedCollisionKeyA = "";
let lastLoggedCollisionKeyB = "";

function LogCollision(collision) {
	const targetId = collision.target.id;
	const n = collision.normal;
	const key = `${collision.type}:${targetId}`;
	if (key === lastLoggedCollisionKeyA || key === lastLoggedCollisionKeyB) return;
	lastLoggedCollisionKeyB = lastLoggedCollisionKeyA;
	lastLoggedCollisionKeyA = key;

	Log(
		"ENGINE",
		`
			Collision: ${collision.type} with "${targetId}" | 
			normal=(${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}) 
			depth=${collision.depth.toFixed(4)} 
			pushDepth=${collision.pushDepth.toFixed(4)} 
			t=${collision.tEntry.toFixed(4)}
		`,
		"log",
		"Level"
	);
}

/* === EXPORTS === */

export {
	DetectPhysicsCollisions,
	DetectCurrentPhysicsOverlaps,
	DetectCombatOverlaps,
	ResolveCollisions,
	ResetCollisionPools,
	NarrowphaseTest,
	GetSimDistanceValue,
	CheckEntityAabbOverlap,
	CheckEntityTrueOverlap,
};
