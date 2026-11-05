// Three-layer collision system: physics / hurtbox / hitbox.
// Physics layer resolves geometry (swept detection + slide).
// Hurtbox/Hitbox layers resolve combat overlaps (static tests, no geometry resolution).

// Used by physics/Master.js; by handlers/game/Performance.js to gather each entity's candidates; by handlers/game/Enemy.js for combat.
// Used by camera/Master.js and builder/subProcesses/Chunks.js for candidates and void suppression.

import { CONFIG } from "../core/config.js";
import { EPSILON } from "../core/meta.js";
import { Clamp, Unit } from "../math/Utilities.js";
import {
	AddVector3,
	SubtractVector3,
	ScaleVector3,
	DotVector3,
	Vector3Sq,
	CloneVector3,
	AbsoluteVector3,
	MultiplyVector3,
	ClampVector3,
	RotateByEuler,
	TransportVector3,
	WORLD_NORMALS,
} from "../math/Vector3.js";
import {
	SweptAABB,
	AabbOverlap,
	PointInsideGrid,
	RayTriangleIntersect,
	SegmentQueryBox,
	TriangleGridCandidates,
	TriangleInQueryBox,
	SweptSphereBounds,
	NarrowphaseContact,
} from "../math/Collision.js";
import { AabbCenter, AabbHalfExtents, ClosestPointOnTriangle, OffsetDetailedBounds } from "../math/Geometry.js";
import { ClassifySurface } from "./Correction.js";

// Min approach cosine for a wall hit (~60° from head-on); below = graze, no wall contact.
const wallFacingMinApproachDot = 0.5;

// Tiny sphere radius used for ground-support point void narrowphase tests.
const groundProbeRadius = new Unit(0.001, "cnu");

// Extra height on void bounds, so a ground point sitting exactly on a void's bottom still counts.
const voidBoundaryEpsilon = new Unit(0.001, "cnu");

// Depth (CNU) a contact point is pushed back into the host to sample the material it touched.
// Note: Same depth as NewVoid.js's aperture probe.
const contactMaterialProbe = new Unit(0.05, "cnu");

// A ground probe that found nothing underfoot.
const NO_GROUND_CONTACT = Object.freeze({ hit: false, surfaceId: null });

// Impacts for a move that hit no floor, or no wall.
const noFloorImpact = Object.freeze({ hit: false, normal: WORLD_NORMALS.Up, type: null, supportY: -1, tEntry: 1 });
const noWallImpact  = Object.freeze({ hit: false, normal: WORLD_NORMALS.Forward, type: null, tEntry: 1, approach: 0 });

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
		pushDepth: 0,
		type: null,
		sourceType: null,
		trigger: null,
		attacker: null,
	};
	pool.items.push(item);
	pool.count++;
	return item;
}

const solidResultPool = createResultPool(), triggerResultPool = createResultPool(), hurtboxResultPool = createResultPool();

// Every physics detection returns the same two pools.
const detectionResult = Object.freeze({ solids: solidResultPool, triggers: triggerResultPool });

// Each entity's cached contacts, keyed by the entity so they go away with it.
const activeCollisionPairCache = new WeakMap();

// Reset all collision result pools before each detection pass.
function resetCollisionPools() {
	poolReset(solidResultPool);
	poolReset(triggerResultPool);
	poolReset(hurtboxResultPool);
}

const buildActivePairKey = (candidate) => `${candidate.type}|${candidate.pairId}`;

// Get the entity's cached pairs, creating them on first use.
function entityPairs(entity) {
	if (!activeCollisionPairCache.has(entity)) activeCollisionPairCache.set(entity, new Map());
	return activeCollisionPairCache.get(entity);
}

const removeActiveCollisionPair = (entity, candidate) => entityPairs(entity).delete(buildActivePairKey(candidate));

function cacheActiveCollisionPair(entity, candidate, normal, depth) {
	const abs = AbsoluteVector3(normal);
	const dominantAxis = (abs.y >= abs.x && abs.y >= abs.z) ? "y" :  (abs.x >= abs.z) ? "x" : "z";

	entityPairs(entity).set(buildActivePairKey(candidate), {
		dominantAxis,
		positionAxisValue: entity.transform.position[dominantAxis],
		rotationAxisValue: entity.transform.rotation[dominantAxis],
		normal           : CloneVector3(normal),
		depth,
	});
}

function readReusableActiveCollisionPair(entity, candidate) {
	const pairs = entityPairs(entity);
	const entry = pairs.get(buildActivePairKey(candidate));
	if (!entry) return null;

	const positionDelta = Math.abs(entity.transform.position[entry.dominantAxis] - entry.positionAxisValue);
	const rotationDelta = Math.abs(entity.transform.rotation[entry.dominantAxis] - entry.rotationAxisValue);
	if (positionDelta <= EPSILON && rotationDelta <= EPSILON) return entry;

	pairs.delete(buildActivePairKey(candidate));
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
 * CANDIDATES
 * ======================================================================== */

// Read an entity candidate's current bounds. World candidates carry their own.
const candidateAabb   = (candidate) => candidate.type === "entity" ? candidate.ref.collision.aabb : candidate.aabb;
const candidateBounds = (candidate) => candidate.type === "entity" ? candidate.ref.collision.physics.bounds : candidate.detailedBounds;

// Terrain keeps its flags on the mesh meta, obstacles on the record.
const surfaceFlags = (source, isTerrain) => isTerrain ? source.meta : source;

// The voids that carve terrain, or the ones that carve obstacles.
const HostVoids = (sceneGraph, isTerrain) => isTerrain ? sceneGraph.voids.terrain : sceneGraph.voids.obstacles;

// Check whether a point is farther than reach outside the box on x or z.
function outsideReachXZ(point, aabb, reach) {
	return point.x < aabb.min.x - reach || point.x > aabb.max.x + reach || point.z < aabb.min.z - reach || point.z > aabb.max.z + reach;
}

/* ========================================================================
 * BROADPHASE
 * ======================================================================== */

/**
 * Broadphase: collect all collidable scene objects within sim radius.
 */
function BroadphaseCollectCandidates(sceneGraph, simRadiusAabb, includeTriggers, includeEntities) {
	const candidates = [];
	const withinSimRadius = (aabb) => AabbOverlap(simRadiusAabb, aabb);

	// Add a terrain/obstacle mesh as a solid candidate.
	function pushSolid({ ref, type, rank, seq }) {
		const { id, worldAabb: aabb, detailedBounds } = ref;
		candidates.push({ id, pairId: id, aabb, detailedBounds, isTrigger: false, type, ref, rank, seq });
	}

	// Add a void lining's wall, then its floor.
	function pushLining({ voidWall, sourceType, rank, seq }) {
		if (voidWall.wallBounds !== null) {
			const { id, worldAabb: aabb, wallBounds: detailedBounds } = voidWall;
			candidates.push({ id, pairId: id, aabb, detailedBounds, isTrigger: false, type: "voidWall", sourceType, ref: voidWall, rank, seq });
		}
		if (voidWall.floorBounds !== null) {
			candidates.push({
				id            : `${voidWall.id}-floor`,
				pairId        : `${voidWall.id}-floor`,
				aabb          : voidWall.worldAabb,
				detailedBounds: voidWall.floorBounds,
				isTrigger     : false,
				type          : "voidWall",
				sourceType, 
				ref           : voidWall, 
				rank,
				seq           : seq + 1,
			});
		}
	}

	// Collect the terrain, obstacles and void linings within the sim radius.
	for (const chunk of sceneGraph.chunks) {
		if (!withinSimRadius(chunk.worldAabb)) continue;
		for (const member of chunk.members) {
			if (!withinSimRadius(member.aabb)) continue;

			// collisionShape "none" means no bounds and are skipped.
			if (member.ref.detailedBounds !== null && withinSimRadius(member.ref.worldAabb)) pushSolid(member);

			for (const lining of member.linings) if (withinSimRadius(lining.voidWall.worldAabb)) pushLining(lining);
		}
	}

	// Restore the authored orde.
	candidates.sort((a, b) => a.rank - b.rank || a.seq - b.seq);

	// Triggers (player exclusive).
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

	// Add solid entities. Skip particles and entities without collision.
	if (includeEntities) {
		sceneGraph.entities.forEach(ent => {
			if (ent.type === "player" || ent.type === "particle" || ent.collision === null || !ent.collision.physics.bounds) return;
			if (!withinSimRadius(ent.collision.aabb)) return;
			candidates.push({ id: ent.id, pairId: ent.id, isTrigger: false, type: "entity", ref: ent });
		});
	}

	return candidates;
}

// Copy a box, grown by epsilon on the y axis only.
function expandAabbY(aabb, epsilon) {
	return {
		min: { x: aabb.min.x, y: aabb.min.y - epsilon, z: aabb.min.z },
		max: { x: aabb.max.x, y: aabb.max.y + epsilon, z: aabb.max.z },
	};
}

// Check whether a void carved away the material behind a body's contact.
function isVoidCancelled(candidate, sceneGraph, bodyAabb, bodyBounds, contact) {
	if (candidate.type !== "terrain" && candidate.type !== "obstacle") return false;

	const isTerrain = candidate.type === "terrain";
	const flags = surfaceFlags(candidate.ref, isTerrain);
	if (flags.mode === "invisible") return false;
	if (flags.nullable === false)   return false;

	for (const ns of HostVoids(sceneGraph, isTerrain)) {
		if (ns.relations[candidate.ref.id]?.suppressed !== true) continue;
		if (!AabbOverlap(bodyAabb, expandAabbY(ns.worldAabb, voidBoundaryEpsilon.value), true)) continue;

		// Center inside the cavity cancels the host outright.
		if (PointInsideGrid(AabbCenter(bodyAabb), ns.solidGrid)) return true;

		// Probe sits contactMaterialProbe inside the host, behind the contact point.
		if (contact.point) {
			if (PointInsideGrid(AddVector3(contact.point, ScaleVector3(contact.normal, -contactMaterialProbe.value)), ns.solidGrid)) return true;
			continue;
		}

		if (ns.detailedBounds && NarrowphaseContact(bodyBounds, ns.detailedBounds).hit) return true;
	}

	return false;
}

function IsCutByVoid(supportPt, candidateId, voids) {
	for (const ns of voids) {
		if (ns.relations[candidateId]?.suppressed !== true) continue;
		if (!AabbOverlap({ min: supportPt, max: supportPt }, expandAabbY(ns.worldAabb, voidBoundaryEpsilon.value))) continue;
		if (NarrowphaseContact({ type: "sphere", center: supportPt, radius: groundProbeRadius }, ns.detailedBounds).hit) return true;
		if (PointInsideGrid(supportPt, ns.solidGrid)) return true;
	}
	return false;
}

/* ========================================================================
 * RESULT HELPERS
 * ======================================================================== */

// Fill a pooled solid result. pushDepth is how far to push the body back out, and swept hits use 0.
function fillSolidResult(candidate, tEntry, contact, pushDepth) {
	const item      = poolPush(solidResultPool);
	item.tEntry     = tEntry;
	item.normal     = contact.normal;
	item.pushDepth  = pushDepth;
	item.type       = candidate.type;
	item.sourceType = candidate.sourceType || null;
}

function collectTrigger(candidate) {
	const item   = poolPush(triggerResultPool);
	item.target  = candidate;
	item.trigger = candidate.trigger;
	item.type    = "trigger";
}

const GetEntityPhysicsFlags = (e) => e.type === "player" ? e.character.physics : e.movement.physics;

/* ========================================================================
 * LAYER 1: PHYSICS COLLISION DETECTION
 * ======================================================================== */

/**
 * Detect physics collisions for a moving entity against the candidates gathered for it this step.
 *
 * @param {object} entity — entity with transform, collision, type, and its candidates in performance.collision.
 * @param {{ x, y, z }} displacement — velocity * dt for this frame.
 * @param {object} sceneGraph
 * @returns {{ solids: {items, count}, triggers: {items, count} }}
 */
function DetectPhysicsCollisions(entity, displacement, sceneGraph) {
	// For sphere swept: get radius from physics bounds.
	let sphereCenter = null, sphereRadius = 0;
	if (entity.collision.physics.shape === "sphere") {
		sphereCenter = entity.collision.physics.bounds.center;
		sphereRadius = entity.collision.physics.bounds.radius.value;
	}

	// Trace the body's path when moving fast, to prevent phasing through triangle-soup surfaces.
	const bodyHalf       = AabbHalfExtents(entity.collision.aabb);
	const reach          = Math.min(bodyHalf.x, bodyHalf.y, bodyHalf.z);
	const moveLength     = Math.sqrt(Vector3Sq(displacement));
	const bodyCenter     = AabbCenter(entity.collision.aabb);
	const traceDirection = moveLength > reach ? ScaleVector3(displacement, 1 / moveLength) : null;
	const tracePath      = SegmentQueryBox(bodyCenter, AddVector3(bodyCenter, displacement), 0);

	// Place the body at the end of the move, once, on first use.
	let endBody = null;
	function bodyAtEnd() {
		if (endBody === null) {
			endBody = {
				aabb  : { min: AddVector3(entity.collision.aabb.min, displacement), max: AddVector3(entity.collision.aabb.max, displacement) },
				bounds: OffsetDetailedBounds(entity.collision.physics.bounds, displacement),
			};
		}
		return endBody;
	}

	resetCollisionPools();

	for (const candidate of entity.performance.collision) {
		// Skip self.
		if (candidate.type === "entity" && candidate.ref === entity) continue;

		if (candidate.isTrigger) {
			if (AabbOverlap(entity.collision.aabb, candidate.aabb)) collectTrigger(candidate);
			continue;
		}

		const aabb = candidateAabb(candidate);
		const detailedBounds = candidateBounds(candidate);

		// Swept test.
		const swept = entity.collision.physics.shape === "sphere"
			? SweptSphereBounds(sphereCenter, displacement, sphereRadius, detailedBounds, aabb)
			: SweptAABB(bodyCenter, displacement, bodyHalf, aabb);

		// Stop the body short of the first surface its path would pass through.
		if (traceDirection !== null && detailedBounds.type === "triangle-soup" && AabbOverlap(tracePath, aabb)) {
			let crossing = null;
			for (const index of TriangleGridCandidates(detailedBounds.grid, tracePath)) {
				const triangle = detailedBounds.triangles[index];
				if (DotVector3(triangle.normal, traceDirection) >= 0 || !TriangleInQueryBox(triangle, tracePath)) continue;
				const ray = RayTriangleIntersect(bodyCenter, traceDirection, triangle, crossing === null ? moveLength : crossing.t);
				if (ray.hit) crossing = { t: ray.t, normal: CloneVector3(triangle.normal) };
			}
			if (crossing !== null) {
				const point = AddVector3(bodyCenter, ScaleVector3(traceDirection, crossing.t));
				const contact = { hit: true, normal: crossing.normal, depth: 0, point };
				const end = bodyAtEnd();
				if (!isVoidCancelled(candidate, sceneGraph, end.aabb, end.bounds, contact)) {
					fillSolidResult(candidate, Math.max(0, crossing.t - reach) / moveLength, contact, 0);
					continue;
				}
			}
		}

		if (swept.hit && swept.tEntry >= 0 && swept.tEntry <= 1) {
			// Take the player's contact at the end of the move, else at the swept entry.
			if (entity.type === "player") {
				const end   = bodyAtEnd();
				let contact = NarrowphaseContact(end.bounds, detailedBounds);
				if (!contact.hit) contact = NarrowphaseContact(OffsetDetailedBounds(entity.collision.physics.bounds, ScaleVector3(displacement, swept.tEntry)), detailedBounds);
				if (contact.hit && !isVoidCancelled(candidate, sceneGraph, end.aabb, end.bounds, contact)) fillSolidResult(candidate, swept.tEntry, contact, 0);
				continue;
			}

			// Reuse the cached contact for other entities until they move along its push axis.
			const cachedPair = readReusableActiveCollisionPair(entity, candidate);
			const contact    = cachedPair
				? buildContactFromCachedPair(cachedPair)
				: NarrowphaseContact(OffsetDetailedBounds(entity.collision.physics.bounds, ScaleVector3(displacement, swept.tEntry)), detailedBounds);
			if (!contact.hit) {
				removeActiveCollisionPair(entity, candidate);
				continue;
			}
			if (!cachedPair) cacheActiveCollisionPair(entity, candidate, contact.normal, contact.depth);

			const end = bodyAtEnd();
			if (isVoidCancelled(candidate, sceneGraph, end.aabb, end.bounds, contact)) {
				removeActiveCollisionPair(entity, candidate);
				continue;
			}

			fillSolidResult(candidate, swept.tEntry, contact, 0);
		}
	}

	// Sort solids by time of entry (closest first).
	const solidSlice = solidResultPool.items;
	for (let i = 1; i < solidResultPool.count; i++) {
		const key = solidSlice[i], keyT = key.tEntry;
		let j = i - 1;
		while (j >= 0 && solidSlice[j].tEntry > keyT) {
			solidSlice[j + 1] = solidSlice[j];
			j--;
		}
		solidSlice[j + 1] = key;
	}

	return detectionResult;
}

function DetectCurrentPhysicsOverlaps(entity, sceneGraph) {
	resetCollisionPools();

	for (const candidate of entity.performance.collision) {
		if (candidate.type === "entity" && candidate.ref === entity) continue;

		if (candidate.isTrigger) {
			if (AabbOverlap(entity.collision.aabb, candidate.aabb)) collectTrigger(candidate);
			continue;
		}

		const aabb = candidateAabb(candidate);
		if (!AabbOverlap(entity.collision.aabb, aabb)) continue;

		const detailedBounds = candidateBounds(candidate);
		const cachedPair = entity.type === "player" || detailedBounds.type === "triangle-soup"
			? null
			: readReusableActiveCollisionPair(entity, candidate);
		const contact = cachedPair
			? buildContactFromCachedPair(cachedPair)
			: NarrowphaseContact(entity.collision.physics.bounds, detailedBounds);

		if (!contact.hit || isVoidCancelled(candidate, sceneGraph, entity.collision.aabb, entity.collision.physics.bounds, contact)) {
			removeActiveCollisionPair(entity, candidate);
			continue;
		}
		if (!entity.type === "player") cacheActiveCollisionPair(entity, candidate, contact.normal, contact.depth);

		// Push out by whichever is shallower: the collider overlap or the box overlap.
		const axis     = AbsoluteVector3(contact.normal);
		const boxDepth = DotVector3(AabbHalfExtents(entity.collision.aabb), axis) + DotVector3(AabbHalfExtents(aabb), axis)
			- Math.abs(DotVector3(SubtractVector3(AabbCenter(aabb), AabbCenter(entity.collision.aabb)), contact.normal));
		fillSolidResult(candidate, 0, contact, Math.min(contact.depth, boxDepth));
	}

	return detectionResult;
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
	const { Enabled, Hurtbox, Hitbox } = CONFIG.Physics.Collision;
	poolReset(hurtboxResultPool);
	if (Enabled === false || (Hurtbox === false && Hitbox === false)) return hurtboxResultPool;

	for (const entity of entities) {
		if (entity === playerState || entity.type === "collectible" || entity.type === "particle") continue;
		if (!entity.performance.physics || entity.collision === null) continue;

		// Broadphase: player AABB vs entity AABB.
		if (!AabbOverlap(playerState.collision.aabb, entity.collision.aabb)) continue;

		// Player hitbox active → player attacks entity.
		if (
			playerState.hitboxActive && Hitbox && playerState.collision.hitbox && entity.collision.hurtbox &&
			NarrowphaseContact(playerState.collision.hitbox.bounds, entity.collision.hurtbox.bounds).hit
		) {
			const item = poolPush(hurtboxResultPool);
			item.attacker = playerState;
			item.target   = entity;
			item.type     = "player-attacks";
		}

		// Entity hitbox active → entity attacks player.
		if (
			entity.hitboxActive && Hurtbox && entity.collision.hitbox && playerState.collision.hurtbox &&
			NarrowphaseContact(entity.collision.hitbox.bounds, playerState.collision.hurtbox.bounds).hit
		) {
			const item    = poolPush(hurtboxResultPool);
			item.attacker = entity;
			item.target   = playerState;
			item.type     = "entity-attacks";
		}
	}

	return hurtboxResultPool;
}

/* ========================================================================
 * COLLISION RESOLUTION
 * ======================================================================== */

// Measure how head-on a velocity meets a wall, across the ground. 1 is straight in, 0 is along it or straight up or down.
function horizontalApproach(velocity, normal) {
	const horizontalVelocity = { x: velocity.x, y: 0, z: velocity.z };
	const horizontalNormal   = { x: normal.x, y: 0, z: normal.z };
	const velocityLengthSq   = Vector3Sq(horizontalVelocity);
	const normalLengthSq     = Vector3Sq(horizontalNormal);
	if (velocityLengthSq <= EPSILON || normalLengthSq <= EPSILON) return 0;
	return -DotVector3(horizontalVelocity, horizontalNormal) / Math.sqrt(velocityLengthSq * normalLengthSq);
}

/**
 * Push out of and slide along each contact in order.
 * @param {{ x, y, z }} velocity — per-second velocity.
 * @param {{ x, y, z }} displacement — velocity * dt.
 * @param {{ items, count }} contacts — sorted collision results.
 * @param {{ normal, minCos }|null} fold — kept footing's surface and walkable fold limit. Null slides plainly.
 * @returns {{ velocity, displacement, changedPosition, changedVelocity }}
 */
function slideAlongContacts(velocity, displacement, contacts, fold) {
	let vel     = CloneVector3(velocity);
	let footing = fold === null ? null : fold.normal;
	let disp    = CloneVector3(displacement);
	let changedPosition = false, changedVelocity = false;

	for (let i = 0; i < contacts.count; i++) {
		const { pushDepth, normal, tEntry } = contacts.items[i];
		if (pushDepth > 0) {
			disp = AddVector3(disp, ScaleVector3(normal, pushDepth));
			changedPosition = changedPosition || pushDepth > EPSILON;
		}

		// Slide along the hit surface. Across a walkable fold, first turn velocity onto the new surface at the same speed.
		let velDotN = DotVector3(vel, normal);
		if (velDotN < -EPSILON && footing !== null && DotVector3(footing, normal) >= fold.minCos) {
			vel = TransportVector3(vel, footing, normal);
			footing         = normal;
			velDotN         = DotVector3(vel, normal);
			changedVelocity = true;
		}
		if (velDotN < 0) {
			vel = SubtractVector3(vel, ScaleVector3(normal, velDotN));
			changedVelocity = changedVelocity || Math.abs(velDotN) > EPSILON;
		}

		// Move swept hits to the impact point, then clip only the travel left. Overlap hits were already pushed out above.
		if (pushDepth <= EPSILON && tEntry > 0) {
			const entryDisplacement   = ScaleVector3(disp, tEntry);
			let remainingDisplacement = SubtractVector3(disp, entryDisplacement);
			const remainingDotN       = DotVector3(remainingDisplacement, normal);
			if (remainingDotN < 0) {
				remainingDisplacement = SubtractVector3(remainingDisplacement, ScaleVector3(normal, remainingDotN));
				changedPosition       = changedPosition || Math.abs(remainingDotN) > EPSILON;
			}
			disp = AddVector3(entryDisplacement, remainingDisplacement);
		}
		else {
			const dispDotN = DotVector3(disp, normal);
			if (dispDotN < 0) {
				disp            = SubtractVector3(disp, ScaleVector3(normal, dispDotN));
				changedPosition = changedPosition || Math.abs(dispDotN) > EPSILON;
			}
		}
	}

	return { velocity: vel, displacement: disp, changedPosition, changedVelocity };
}

function ResolveCollisions(velocity, displacement, solids, fold) {
	// Note: velocity and displacement pass through unchanged when nothing hit.
	if (solids.count === 0) {
		return {
			resolvedVelocity    : velocity,
			resolvedDisplacement: displacement,
			floorImpact         : noFloorImpact,
			wallImpact          : noWallImpact,
			collisionKey        : "",
			changedPosition     : false,
			changedVelocity     : false,
			anyChanged          : false,
		};
	}

	let floorImpact = noFloorImpact, wallImpact = noWallImpact;

	for (let i = 0; i < solids.count; i++) {
		const { sourceType, type, normal, tEntry } = solids.items[i];

		// A voidWall resolves under its source category
		const surfaceType        = sourceType || type;
		const isSurfaceCandidate = surfaceType === "terrain" || surfaceType === "obstacle";
		const wallApproach       = isSurfaceCandidate ? horizontalApproach(velocity, normal) : 0;

		if (isSurfaceCandidate && normal.y > 0.5) {
			if (
				!floorImpact.hit || normal.y > floorImpact.supportY ||
				(normal.y === floorImpact.supportY && tEntry < floorImpact.tEntry)
			) {
				floorImpact = { hit: true, normal: CloneVector3(normal), type: surfaceType, supportY: normal.y, tEntry };
			}
		}

		if (isSurfaceCandidate && wallApproach >= wallFacingMinApproachDot) {
			if (
				!wallImpact.hit || wallApproach > wallImpact.approach ||
				(wallApproach === wallImpact.approach && tEntry < wallImpact.tEntry)
			) {
				wallImpact = { hit: true, normal: CloneVector3(normal), type: surfaceType, tEntry, approach: wallApproach };
			}
		}
	}

	const { 
		velocity: resolvedVelocity, displacement: resolvedDisplacement, 
		changedPosition, changedVelocity 
	} = slideAlongContacts(velocity, displacement, solids, fold);

	return {
		resolvedVelocity, resolvedDisplacement, floorImpact, wallImpact,
		collisionKey: floorImpact.hit && wallImpact.hit ? "floor+wall" : floorImpact.hit ? "floor" : wallImpact.hit ? "wall" : "solid",
		changedPosition, changedVelocity,
		anyChanged  : changedPosition || changedVelocity,
	};
}

/* ========================================================================
 * GROUND PROBE
 * ======================================================================== */

// Note: Boxes ground only through the face right below a point. Inside a box or past its edge, nothing is underfoot.

// Find the box face under a point and the gap down to it.
function pointAabbFaceGap(point, aabb, maxDist) {
	const closest = ClampVector3(point, aabb.min, aabb.max);
	const offset  = SubtractVector3(point, closest);
	if ((offset.x !== 0) + (offset.y !== 0) + (offset.z !== 0) !== 1) return null;

	const t = Math.abs(offset.x + offset.y + offset.z);

	// Give up when the face is out of reach.
	if (t > maxDist) return null;

	return { t, normal: { x: Math.sign(offset.x), y: Math.sign(offset.y), z: Math.sign(offset.z) }, point: closest };
}

// Find the face under a point the same way for a rotated box.
function pointObbFaceGap(point, obb, maxDist) {
	let closest = CloneVector3(obb.center);
	let faceAxis = 0, faceSign = 1, t = 0, outsideAxes = 0;
	const offset = SubtractVector3(point, obb.center);
	for (let axis = 0; axis < 3; axis++) {
		const extent = obb.halfExtents[("xyz"[axis])];
		const along = DotVector3(offset, obb.axes[axis]);

		closest = AddVector3(closest, ScaleVector3(obb.axes[axis], Clamp(along, -extent, extent)));

		if (Math.abs(along) <= extent) continue;
		outsideAxes++;
		faceAxis = axis;
		faceSign = along >= 0 ? 1 : -1;
		t        = Math.abs(along) - extent;
	}

	return (outsideAxes !== 1 || t > maxDist) ? null : { t, normal: ScaleVector3(obb.axes[faceAxis], faceSign), point: closest };
}

// Find how far a point sits in front of a triangle, as an offset from the triangle's closest point.
function reachesTriangle(from, triangle) {
	const offset = SubtractVector3(from, ClosestPointOnTriangle(from, triangle.a, triangle.b, triangle.c));
	return DotVector3(offset, triangle.normal) < 0 ? null : offset;
}

// Find the closest triangle within reach that faces the point.
function nearestFrontTriangle(point, soup, maxDist) {
	const reach = SegmentQueryBox(point, point, maxDist);
	let soupDistanceSq = maxDist ** 2, soupTriangle = null, soupOffset = null;
	for (const index of TriangleGridCandidates(soup.grid, reach)) {
		const triangle = soup.triangles[index];

		// Skip triangles whose box doesn't touch the reach around the point.
		if (!TriangleInQueryBox(triangle, reach)) continue;

		const offset = reachesTriangle(point, triangle);
		if (offset === null) continue;

		const distanceSq = Vector3Sq(offset);
		if (distanceSq >= soupDistanceSq) continue;

		soupDistanceSq = distanceSq;
		soupTriangle   = triangle;
		soupOffset     = offset;
	}

	// Give up when no triangle in reach faces the point.
	if (soupTriangle === null) return null;

	return {
		t     : Math.sqrt(soupDistanceSq),
		normal: CloneVector3(soupTriangle.normal),
		point : SubtractVector3(point, soupOffset),
	};
}

/**
 * Probe for ground from the bottom of the capsule's cylinder, finding the nearest point on each surface in reach before classifying them.
 *
 * @param {object} entity — the probe capsule is its frozen rest capsule, placed and rotated.
 * @param {object} sceneGraph
 * @param {number} groundSnapTolerance — how far below the capsule the probe still finds ground.
 * @returns {{ radius: number, hits: Array<{ t: number, normal: object, surfaceId: string, sticky: boolean }> }}
 */
function GatherGroundHits(entity, sceneGraph, groundSnapTolerance) {
	// Rest-pose capsule, placed scale-then-rotation like every other collider.
	const groundCapsule = entity.collision.rest.groundCapsule;
	const scale         = entity.transform.scale;
	const radius        = groundCapsule.radius.value * Math.max(scale.x, scale.y, scale.z);
	const capOffset     = MultiplyVector3(groundCapsule.segmentStart, scale);
	const probe         = AddVector3(RotateByEuler(capOffset, entity.transform.rotation), entity.transform.position);
	const maxDist       = radius + groundSnapTolerance;
	const hits = [];

	// Test each terrain and obstacle candidate gathered for this step.
	for (const candidate of entity.performance.collision) {
		const isTerrain = candidate.type === "terrain";
		if (!isTerrain && candidate.type !== "obstacle") continue;

		const bounds = candidate.detailedBounds;
		let hit = null;
		switch (bounds.type) {
			case "aabb": hit = pointAabbFaceGap(probe, bounds, maxDist); break;
			case "obb" : hit = pointObbFaceGap(probe, bounds, maxDist);  break;
			case "triangle-soup": 
				if (outsideReachXZ(probe, candidate.aabb, maxDist)) continue;
				hit = nearestFrontTriangle(probe, bounds, maxDist); break;
		}
		if (hit === null) continue;

		const flags = surfaceFlags(candidate.ref, isTerrain);
		if (flags.nullable !== false && IsCutByVoid(hit.point, candidate.ref.id, HostVoids(sceneGraph, isTerrain))) continue;
		hits.push({ t: hit.t, normal: hit.normal, surfaceId: candidate.ref.id, sticky: flags.sticky });
	}

	// Keep a lining soup's nearest front-facing triangle as a hit.
	function pushSoupHit(soup, surfaceId, sticky) {
		const hit = nearestFrontTriangle(probe, soup, maxDist);
		if (hit) hits.push({ t: hit.t, normal: hit.normal, surfaceId, sticky });
	}

	// Probe each void-wall lining's soups, as the void's own surface with its id and stickiness.
	function probeVoidWalls(entries, isTerrain) {
		for (const entry of entries) {
			const sticky = surfaceFlags(entry, isTerrain).sticky;
			for (const id in entry.relations) {
				for (const voidWall of entry.relations[id].voidWallMeshes) {
					if (outsideReachXZ(probe, voidWall.worldAabb, maxDist)) continue;
					if (voidWall.floorBounds !== null) pushSoupHit(voidWall.floorBounds, entry.id, sticky);
					if (voidWall.wallBounds  !== null) pushSoupHit(voidWall.wallBounds,  entry.id, sticky);
				}
			}
		}
	}
	probeVoidWalls(sceneGraph.voids.terrain, true);
	probeVoidWalls(sceneGraph.voids.obstacles, false);

	return { radius, hits };
}

// Classify a ground hit. The player grips by its speed along the surface, while sticky hits and other entities always grip.
function groundHitContact(entity, hit, frameStart) {
	const tangent    = SubtractVector3(entity.velocity, ScaleVector3(hit.normal, DotVector3(entity.velocity, hit.normal)));
	const speedRatio = entity.type === "player" && !hit.sticky ? Math.sqrt(Vector3Sq(tangent)) / entity.character.meta.maxSpeed.value : Infinity;
	return ClassifySurface(frameStart.referenceNormal, hit.normal, entity.surfaceContact, entity.medium, speedRatio, entity.gripDemand);
}

// Check whether a hit beats the one chosen so far: walkable over sliding, then nearest, with the coupled surface breaking ties.
function outranks(hit, contact, chosen, chosenContact, coupledId) {
	return contact !== chosenContact ? contact === "walkable" : Math.abs(hit.t - chosen.t) > EPSILON ? hit.t < chosen.t : hit.surfaceId === coupledId;
}

/**
 * Classify the probe's hits on the entity's current state and pick the ground among them.
 * This is the sole authority on player grounding state, surface class and snap target.
 * Penetration pushout is unaffected — the capsule narrowphase handles that separately.
 *
 * @param {object} entity
 * @param {{ radius: number, hits: Array }} probe — from GatherGroundHits.
 * @param {{ referenceNormal: { x, y, z } }} frameStart — last walked surface, frozen for this frame.
 * @returns {{ hit: boolean, normal?: object, contact?: string, restDelta?: number, surfaceId: string | null }}
 */
function PickGroundContact(entity, probe, frameStart) {
	// Pick the best-ranked hit. Walls never ground.
	let chosen = null, chosenContact = null;
	for (const hit of probe.hits) {
		const contact = groundHitContact(entity, hit, frameStart);
		if (contact === "wall") continue;
		if (chosen !== null && !outranks(hit, contact, chosen, chosenContact, entity.physicsRuntime.groundSurfaceId)) continue;
		chosen = hit;
		chosenContact = contact;
	}

	if (chosen === null) return NO_GROUND_CONTACT;

	// Cap center rests radius from the surface, along the normal.
	return {
		hit: true,
		normal   : chosen.normal,
		contact  : chosenContact,
		restDelta: probe.radius - chosen.t,
		surfaceId: chosen.surfaceId,
	};
}

/* === EXPORTS === */

export {
	BroadphaseCollectCandidates,
	IsCutByVoid,
	HostVoids,
	DetectPhysicsCollisions,
	DetectCurrentPhysicsOverlaps,
	DetectCombatOverlaps,
	ResolveCollisions,
	GatherGroundHits,
	PickGroundContact,
	GetEntityPhysicsFlags,
	NO_GROUND_CONTACT,
};
