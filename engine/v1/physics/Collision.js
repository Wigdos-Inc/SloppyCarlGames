// Three-layer collision system: physics / hurtbox / hitbox.
// Physics layer resolves geometry (swept detection + slide).
// Hurtbox/Hitbox layers resolve combat overlaps (static tests, no geometry resolution).

// Used by physics/Master.js; by handlers/game/Performance.js to gather each entity's candidates; by handlers/game/Enemy.js for combat.
// Used by camera/Master.js and builder/NewLevel.js for candidates and void suppression.

import { CONFIG } from "../core/config.js";
import { EPSILON } from "../core/meta.js";
import { Unit } from "../math/Utilities.js";
import {
	AddVector3,
	SubtractVector3,
	ScaleVector3,
	DotVector3,
	Vector3Sq,
	CloneVector3,
	AbsoluteVector3,
	MultiplyVector3,
	RotateByEuler,
	WORLD_NORMALS,
} from "../math/Vector3.js";
import {
	SweptAABB,
	AabbCenter,
	AabbHalfExtents,
	AabbOverlap,
	ExpandAabbY,
	PointInsideMesh,
	RayTriangleIntersect,
	SegmentQueryBox,
	TriangleInQueryBox,
	SweptSphereBounds,
	OffsetDetailedBounds,
	NarrowphaseContact,
	HorizontalApproach,
	SlideAlongContacts,
	PointAabbFaceGap,
	PointObbFaceGap,
	NearestFrontTriangle,
} from "../math/Collision.js";
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

// The entity's own cached pairs, created on first use.
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
		normal: CloneVector3(normal),
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

// Entity candidates read the entity's current bounds; world candidates carry their own.
const candidateAabb   = (candidate) => candidate.type === "entity" ? candidate.ref.collision.aabb : candidate.aabb;
const candidateBounds = (candidate) => candidate.type === "entity" ? candidate.ref.collision.detailedBounds : candidate.detailedBounds;

// Terrain keeps its flags on the mesh meta, obstacles on the record.
const surfaceFlags = (source, isTerrain) => isTerrain ? source.meta : source;

// The voids that carve terrain, or the ones that carve obstacles.
const HostVoids = (sceneGraph, isTerrain) => isTerrain ? sceneGraph.voids.terrain : sceneGraph.voids.obstacles;

// True when the point is farther than reach outside the box on x or z.
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

	// Terrain and obstacles authored with collisionShape "none" have no bounds and are skipped.
	sceneGraph.terrain.forEach(mesh => {
		if (mesh.detailedBounds === null || !withinSimRadius(mesh.worldAabb)) return;
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
		if (obs.detailedBounds === null || !withinSimRadius(obs.worldAabb)) return;
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
	// sourceType is the category they resolve under, matching the ground probe.
	function collectVoidWalls(entries, sourceType) {
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
	}
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

	// Other solid entities; particles are skipped so an emitter can't block its own burst.
	if (includeEntities) {
		sceneGraph.entities.forEach(ent => {
			if (ent.type === "player" || ent.type === "particle" || !ent.collision.detailedBounds) return;
			if (!withinSimRadius(ent.collision.aabb)) return;
			candidates.push({ id: ent.id, pairId: ent.id, isTrigger: false, type: "entity", ref: ent });
		});
	}

	return candidates;
}

// The body is tested where bodyAabb and bodyBounds place it; a void cancels a contact only where the material behind it was carved away.
function isVoidCancelled(candidate, sceneGraph, bodyAabb, bodyBounds, contact) {
	if (candidate.type !== "terrain" && candidate.type !== "obstacle") return false;

	const isTerrain = candidate.type === "terrain";
	const flags = surfaceFlags(candidate.ref, isTerrain);
	if (flags.mode === "invisible") return false;
	if (flags.nullable === false)   return false;

	for (const ns of HostVoids(sceneGraph, isTerrain)) {
		if (ns.relations[candidate.ref.id]?.suppressed !== true) continue;
		if (!AabbOverlap(bodyAabb, ExpandAabbY(ns.worldAabb, voidBoundaryEpsilon.value), true)) continue;

		// Center inside the cavity cancels the host outright.
		if (PointInsideMesh(AabbCenter(bodyAabb), ns.solidTriangles)) return true;

		// Probe sits contactMaterialProbe inside the host, behind the contact point.
		if (contact.point) {
			if (PointInsideMesh(AddVector3(contact.point, ScaleVector3(contact.normal, -contactMaterialProbe.value)), ns.solidTriangles)) return true;
			continue;
		}

		if (ns.detailedBounds && NarrowphaseContact(bodyBounds, ns.detailedBounds).hit) return true;
	}

	return false;
}

function IsPointInSuppressingVoid(supportPt, candidateId, voids) {
	for (const ns of voids) {
		if (ns.relations[candidateId]?.suppressed !== true) continue;
		if (!AabbOverlap({ min: supportPt, max: supportPt }, ExpandAabbY(ns.worldAabb, voidBoundaryEpsilon.value))) continue;
		if (NarrowphaseContact({ type: "sphere", center: supportPt, radius: groundProbeRadius }, ns.detailedBounds).hit) return true;
		if (PointInsideMesh(supportPt, ns.solidTriangles)) return true;
	}
	return false;
}

/* ========================================================================
 * RESULT HELPERS
 * ======================================================================== */

// pushDepth is how far the contact pushes the body back out; swept hits push none.
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
	const isPlayer = entity.type === "player";

	// Determine swept mode from entity physics shape.
	const useSphereSwept = entity.collision.physics.shape === "sphere";

	// For sphere swept: get radius from physics bounds.
	let sphereCenter = null, sphereRadius = 0;
	if (useSphereSwept) {
		sphereCenter = entity.collision.physics.bounds.center;
		sphereRadius = entity.collision.physics.bounds.radius.value;
	}

	// Trace the body's path when moving fast, to prevent phasing through triangle-soup surfaces.
	const bodyHalf = AabbHalfExtents(entity.collision.aabb);
	const reach = Math.min(bodyHalf.x, bodyHalf.y, bodyHalf.z);
	const moveLength = Math.sqrt(Vector3Sq(displacement));
	const bodyCenter = AabbCenter(entity.collision.aabb);
	const traceDirection = moveLength > reach ? ScaleVector3(displacement, 1 / moveLength) : null;
	const tracePath = SegmentQueryBox(bodyCenter, AddVector3(bodyCenter, displacement), 0);

	// The body moved through the whole displacement, placed once on first need.
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
		const swept = useSphereSwept
			? SweptSphereBounds(sphereCenter, displacement, sphereRadius, detailedBounds, aabb)
			: SweptAABB(bodyCenter, displacement, bodyHalf, aabb);

		// Stops the body short of the first surface its path would pass through.
		if (traceDirection !== null && detailedBounds.type === "triangle-soup" && AabbOverlap(tracePath, aabb)) {
			let crossing = null;
			for (const triangle of detailedBounds.triangles) {
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
			// The player's contact is taken at the end of the move, else at the swept entry.
			if (isPlayer) {
				const end = bodyAtEnd();
				let contact = NarrowphaseContact(end.bounds, detailedBounds);
				if (!contact.hit) contact = NarrowphaseContact(OffsetDetailedBounds(entity.collision.physics.bounds, ScaleVector3(displacement, swept.tEntry)), detailedBounds);
				if (contact.hit && !isVoidCancelled(candidate, sceneGraph, end.aabb, end.bounds, contact)) fillSolidResult(candidate, swept.tEntry, contact, 0);
				continue;
			}

			// Other entities reuse this candidate's cached contact until they move along its push axis.
			const cachedPair = readReusableActiveCollisionPair(entity, candidate);
			const contact = cachedPair
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
		const key = solidSlice[i];
		const keyT = key.tEntry;
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
	const isPlayer = entity.type === "player";
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
		const cachedPair = isPlayer || detailedBounds.type === "triangle-soup"
			? null
			: readReusableActiveCollisionPair(entity, candidate);
		const contact = cachedPair
			? buildContactFromCachedPair(cachedPair)
			: NarrowphaseContact(entity.collision.physics.bounds, detailedBounds);

		if (!contact.hit || isVoidCancelled(candidate, sceneGraph, entity.collision.aabb, entity.collision.physics.bounds, contact)) {
			removeActiveCollisionPair(entity, candidate);
			continue;
		}
		if (!isPlayer) cacheActiveCollisionPair(entity, candidate, contact.normal, contact.depth);

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
		if (!entity.performance.physics) continue;

		// Broadphase: player AABB vs entity AABB.
		if (!AabbOverlap(playerState.collision.aabb, entity.collision.aabb)) continue;

		// Player hitbox active → player attacks entity.
		if (
			playerState.hitboxActive && Hitbox && playerState.collision.hitbox && entity.collision.hurtbox &&
			NarrowphaseContact(playerState.collision.hitbox.bounds, entity.collision.hurtbox.bounds).hit
		) {
			const item = poolPush(hurtboxResultPool);
			item.attacker = playerState;
			item.target = entity;
			item.type = "player-attacks";
		}

		// Entity hitbox active → entity attacks player.
		if (
			entity.hitboxActive && Hurtbox && entity.collision.hitbox && playerState.collision.hurtbox &&
			NarrowphaseContact(entity.collision.hitbox.bounds, playerState.collision.hurtbox.bounds).hit
		) {
			const item = poolPush(hurtboxResultPool);
			item.attacker = entity;
			item.target = playerState;
			item.type = "entity-attacks";
		}
	}

	return hurtboxResultPool;
}

/* ========================================================================
 * COLLISION RESOLUTION
 * ======================================================================== */

/**
 * Resolve solid collisions by sliding velocity along collision normals, and name the floor and wall they hit.
 * @param {{ x, y, z }} velocity — per-second velocity.
 * @param {{ x, y, z }} displacement — velocity * dt.
 * @param {{ items, count }} solids — sorted collision results.
 * @param {{ normal, minCos }|null} fold — kept footing's surface and walkable fold limit; null slides plainly.
 * @returns {{ resolvedVelocity, resolvedDisplacement, floorImpact, wallImpact, collisionKey, changedPosition, changedVelocity, anyChanged }}
 */
function ResolveCollisions(velocity, displacement, solids, fold) {
	// Nothing hit: velocity and displacement pass through unchanged.
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
		const collision = solids.items[i];
		// A voidWall resolves under its source category
		const surfaceType = collision.sourceType || collision.type;
		const isSurfaceCandidate = surfaceType === "terrain" || surfaceType === "obstacle";
		const wallApproach = isSurfaceCandidate ? HorizontalApproach(velocity, collision.normal) : 0;

		if (isSurfaceCandidate && collision.normal.y > 0.5) {
			if (
				!floorImpact.hit || collision.normal.y > floorImpact.supportY ||
				(collision.normal.y === floorImpact.supportY && collision.tEntry < floorImpact.tEntry)
			) {
				floorImpact = { hit: true, normal: CloneVector3(collision.normal), type: surfaceType, supportY: collision.normal.y, tEntry: collision.tEntry };
			}
		}

		if (isSurfaceCandidate && wallApproach >= wallFacingMinApproachDot) {
			if (
				!wallImpact.hit || wallApproach > wallImpact.approach ||
				(wallApproach === wallImpact.approach && collision.tEntry < wallImpact.tEntry)
			) {
				wallImpact = { hit: true, normal: CloneVector3(collision.normal), type: surfaceType, tEntry: collision.tEntry, approach: wallApproach };
			}
		}
	}

	const slide = SlideAlongContacts(velocity, displacement, solids, fold);

	return {
		resolvedVelocity    : slide.velocity,
		resolvedDisplacement: slide.displacement,
		floorImpact, wallImpact,
		collisionKey   : floorImpact.hit && wallImpact.hit ? "floor+wall" : floorImpact.hit ? "floor" : wallImpact.hit ? "wall" : "solid",
		changedPosition: slide.changedPosition,
		changedVelocity: slide.changedVelocity,
		anyChanged     : slide.changedPosition || slide.changedVelocity,
	};
}

/* ========================================================================
 * GROUND PROBE
 * ======================================================================== */

/**
 * Ground probe from the capsule cylinder bottom: the nearest point on each surface in reach, not yet classified.
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

	// Tests each terrain and obstacle candidate gathered for this step.
	for (const candidate of entity.performance.collision) {
		const isTerrain = candidate.type === "terrain";
		if (!isTerrain && candidate.type !== "obstacle") continue;

		const bounds = candidate.detailedBounds;
		let hit = null;
		if      (bounds.type === "aabb") hit = PointAabbFaceGap(probe, bounds, maxDist);
		else if (bounds.type === "obb")  hit = PointObbFaceGap(probe, bounds, maxDist);
		else if (bounds.type === "triangle-soup") {
			if (outsideReachXZ(probe, candidate.aabb, maxDist)) continue;
			hit = NearestFrontTriangle(probe, bounds, maxDist);
		}
		if (hit === null) continue;

		const flags = surfaceFlags(candidate.ref, isTerrain);
		if (flags.nullable !== false && IsPointInSuppressingVoid(hit.point, candidate.ref.id, HostVoids(sceneGraph, isTerrain))) continue;
		hits.push({ t: hit.t, normal: hit.normal, surfaceId: candidate.ref.id, sticky: flags.sticky });
	}

	// Keeps a lining soup's nearest front-facing triangle as a hit.
	function pushSoupHit(soup, surfaceId, sticky) {
		const hit = NearestFrontTriangle(probe, soup, maxDist);
		if (hit) hits.push({ t: hit.t, normal: hit.normal, surfaceId, sticky });
	}

	// Void-wall lining, both soups.
	// A lining is its own surface: it carries the void's id and stickiness, not its host's.
	function probeVoidWalls(entries, isTerrain) {
		for (const entry of entries) {
			const sticky = surfaceFlags(entry, isTerrain).sticky;
			for (const id in entry.relations) {
				for (const voidWall of entry.relations[id].voidWallMeshes) {
					if (outsideReachXZ(probe, voidWall.worldAabb, maxDist)) continue;
					pushSoupHit(voidWall.floorBounds, entry.id, sticky);
					pushSoupHit(voidWall.wallBounds, entry.id, sticky);
				}
			}
		}
	}
	probeVoidWalls(sceneGraph.voids.terrain, true);
	probeVoidWalls(sceneGraph.voids.obstacles, false);

	return { radius, hits };
}

// Surface class of a hit; the player's grip depends on its speed along the surface, while sticky hits and other entities always grip.
function groundHitContact(entity, hit, frameStart) {
	const tangent    = SubtractVector3(entity.velocity, ScaleVector3(hit.normal, DotVector3(entity.velocity, hit.normal)));
	const speedRatio = entity.type === "player" && !hit.sticky ? Math.sqrt(Vector3Sq(tangent)) / entity.character.meta.maxSpeed.value : Infinity;
	return ClassifySurface(frameStart.referenceNormal, hit.normal, entity.surfaceContact, entity.underwater, speedRatio, entity.gripDemand);
}

// Whether a hit beats the one chosen so far: walkable over sliding, then nearest; the coupled surface only breaks ties.
function outranks(hit, contact, chosen, chosenContact, coupledId) {
	if (contact !== chosenContact)            return contact === "walkable";
	if (Math.abs(hit.t - chosen.t) > EPSILON) return hit.t < chosen.t;
	return hit.surfaceId === coupledId;
}

/**
 * Classifies the probe's hits on the entity's current state and picks the ground among them.
 * This is the sole authority on player grounding state, surface class and snap target.
 * Penetration pushout is unaffected — the capsule narrowphase handles that separately.
 *
 * @param {object} entity
 * @param {{ radius: number, hits: Array }} probe — from GatherGroundHits.
 * @param {{ referenceNormal: { x, y, z } }} frameStart — last walked surface, frozen for this frame.
 * @returns {{ hit: boolean, normal?: object, contact?: string, restDelta?: number, surfaceId: string | null }}
 */
function PickGroundContact(entity, probe, frameStart) {
	// Picks the best-ranked hit; walls never ground.
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
		normal: chosen.normal,
		contact: chosenContact,
		restDelta: probe.radius - chosen.t,
		surfaceId: chosen.surfaceId,
	};
}

/* === EXPORTS === */

export {
	BroadphaseCollectCandidates,
	IsPointInSuppressingVoid,
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
