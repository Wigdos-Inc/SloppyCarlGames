// Stops velocity on a certain axis if collission is going to happen.

// Used by handlers/game/Physics.js to check if entity will collide with something collidable.

import { CONFIG } from "../core/config.js";
import { Log } from "../core/meta.js";
import {
	NormalizeVector3,
	SubtractVector3,
	ScaleVector3,
	DotVector3,
	AddVector3,
} from "../math/Vector3.js";
import { SweptAABB, AABBOverlap } from "../math/Physics.js";
import { ToNumber } from "../math/Utilities.js";

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function buildDetailedBoundsFromCollision(collision) {
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
	if (bounds.type === "capsule") {
		return {
			type: "capsule",
			radius: bounds.radius,
			halfHeight: bounds.halfHeight,
			segmentStart: bounds.segmentStart.add(offset),
			segmentEnd: bounds.segmentEnd.add(offset),
		};
	}
	if (bounds.type === "obb") {
		return {
			type: "obb",
			center: bounds.center.add(offset),
			halfExtents: bounds.halfExtents,
			axes: bounds.axes,
		};
	}
	return bounds;
}

function segmentSegmentDistanceSq(p1, q1, p2, q2) {
	const d1 = SubtractVector3(q1, p1);
	const d2 = SubtractVector3(q2, p2);
	const r = SubtractVector3(p1, p2);
	const a = DotVector3(d1, d1);
	const e = DotVector3(d2, d2);
	const f = DotVector3(d2, r);

	let s = 0;
	let t = 0;

	if (a <= 0.000001 && e <= 0.000001) {
		const delta = SubtractVector3(p1, p2);
		return DotVector3(delta, delta);
	}

	if (a <= 0.000001) {
		s = 0;
		t = clamp(f / e, 0, 1);
	} else {
		const c = DotVector3(d1, r);
		if (e <= 0.000001) {
			t = 0;
			s = clamp(-c / a, 0, 1);
		} else {
			const b = DotVector3(d1, d2);
			const denom = a * e - b * b;
			if (Math.abs(denom) > 0.000001) {
				s = clamp((b * f - c * e) / denom, 0, 1);
			}
			t = (b * s + f) / e;
			if (t < 0) {
				t = 0;
				s = clamp(-c / a, 0, 1);
			} else if (t > 1) {
				t = 1;
				s = clamp((b - c) / a, 0, 1);
			}
		}
	}

	const c1 = AddVector3(p1, ScaleVector3(d1, s));
	const c2 = AddVector3(p2, ScaleVector3(d2, t));
	const delta = SubtractVector3(c1, c2);
	return DotVector3(delta, delta);
}

function dotWithAxis(vector, axis) {
	return vector.x * axis.x + vector.y * axis.y + vector.z * axis.z;
}

function toObbLocal(point, obb) {
	const delta = SubtractVector3(point, obb.center);
	return {
		x: dotWithAxis(delta, obb.axes[0]),
		y: dotWithAxis(delta, obb.axes[1]),
		z: dotWithAxis(delta, obb.axes[2]),
	};
}

function segmentIntersectsAabbLocal(start, end, extents) {
	const d = SubtractVector3(end, start);
	let tMin = 0;
	let tMax = 1;
	const axes = ["x", "y", "z"];

	for (let i = 0; i < axes.length; i++) {
		const axis = axes[i];
		const startCoord = start[axis];
		const dirCoord = d[axis];
		const min = -extents[axis];
		const max = extents[axis];

		if (Math.abs(dirCoord) < 0.000001) {
			if (startCoord < min || startCoord > max) return false;
			continue;
		}

		const inv = 1 / dirCoord;
		let t1 = (min - startCoord) * inv;
		let t2 = (max - startCoord) * inv;
		if (t1 > t2) {
			const temp = t1;
			t1 = t2;
			t2 = temp;
		}

		tMin = Math.max(tMin, t1);
		tMax = Math.min(tMax, t2);
		if (tMin > tMax) {
			return false;
		}
	}

	return true;
}

function checkCapsuleCapsuleOverlap(capsuleA, capsuleB) {
	const radiusSum = capsuleA.radius + capsuleB.radius;
	const distSq = segmentSegmentDistanceSq(
		capsuleA.segmentStart,
		capsuleA.segmentEnd,
		capsuleB.segmentStart,
		capsuleB.segmentEnd
	);
	return distSq <= (radiusSum * radiusSum);
}

function checkCapsuleObbOverlap(capsule, obb) {
	const localStart = toObbLocal(capsule.segmentStart, obb);
	const localEnd = toObbLocal(capsule.segmentEnd, obb);
	const expanded = {
		x: obb.halfExtents.x + capsule.radius,
		y: obb.halfExtents.y + capsule.radius,
		z: obb.halfExtents.z + capsule.radius,
	};
	return segmentIntersectsAabbLocal(localStart, localEnd, expanded);
}

function checkDetailedBoundsOverlap(boundsA, boundsB) {
	if (!boundsA || !boundsB) return true;
	if (boundsA.type === "capsule" && boundsB.type === "capsule") {
		return checkCapsuleCapsuleOverlap(boundsA, boundsB);
	}
	if (boundsA.type === "capsule" && boundsB.type === "obb") {
		return checkCapsuleObbOverlap(boundsA, boundsB);
	}
	if (boundsA.type === "obb" && boundsB.type === "capsule") {
		return checkCapsuleObbOverlap(boundsB, boundsA);
	}
	return true;
}

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
		min: {
			x: aabb.min.x - padding,
			y: aabb.min.y - padding,
			z: aabb.min.z - padding,
		},
		max: {
			x: aabb.max.x + padding,
			y: aabb.max.y + padding,
			z: aabb.max.z + padding,
		},
	};
}

function buildEntityAabbAtPosition(entityAabb, position) {
	if (!entityAabb || !entityAabb.min || !entityAabb.max) return null;
	const halfExtents = getHalfExtents(entityAabb);
	const centerOffset = getAabbCenter(entityAabb).subtract(position);
	const centerPos = position.clone().add(centerOffset);
	return {
		min: centerPos.subtract(halfExtents),
		max: centerPos.add(halfExtents),
	};
}

function getAabbCenter(aabb) {
	if (!aabb || !aabb.min || !aabb.max) return { x: 0, y: 0, z: 0 };
	return aabb.min.clone().add(aabb.max).scale(0.5);
}

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
	return checkDetailedBoundsOverlap(boundsA, boundsB);
}

function checkSweptAabbPair(position, displacement, entityAabb, targetAabb) {
	if (!entityAabb || !targetAabb) {
		return { hit: false, tEntry: 1, tExit: 0, normal: { x: 0, y: 0, z: 0 } };
	}
	const halfExtents = getHalfExtents(entityAabb);
	const centerOffset = getAabbCenter(entityAabb).subtract(position);
	const centerPos = position.clone().add(centerOffset);
	return SweptAABB(centerPos, displacement, halfExtents, targetAabb);
}

function collectCollidables(sceneGraph, simRadiusAabb) {
	const candidates = [];
	const withinSimRadius = (aabb) => {
		if (!simRadiusAabb) return true;
		return AABBOverlap(simRadiusAabb, aabb);
	};

	// Terrain (always solid, filtered by sim radius AABB).
	const terrain = Array.isArray(sceneGraph.terrain) ? sceneGraph.terrain : [];
	for (let i = 0; i < terrain.length; i++) {
		const mesh = terrain[i];
		if (!mesh || !mesh.worldAabb) { continue; }
		if (!withinSimRadius(mesh.worldAabb)) {
			continue;
		}
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
		if (!obs) { continue; }
		const bounds = obs.bounds || (obs.mesh && obs.mesh.worldAabb) || null;
		if (!bounds) { continue; }
		if (!withinSimRadius(bounds)) {
			continue;
		}
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
		if (!trig || !trig.worldAabb) { continue; }
		if (!withinSimRadius(trig.worldAabb)) {
			continue;
		}
		candidates.push({
			id: trig.id || "trigger",
			aabb: trig.worldAabb,
			isTrigger: true,
			type: "trigger",
			trigger: trig.meta && trig.meta.trigger ? trig.meta.trigger : (trig.trigger || null),
			ref: trig,
		});
	}

	return candidates;
}

/**
 * Detect collisions using swept AABB for a moving entity.
 * @param {{ position, velocity, collision: { aabb, radius? } }} entity
 * @param {{ x, y, z }} scaledVelocity — velocity * deltaSeconds (displacement this frame)
 * @param {object} sceneGraph
 * @returns {{ solids: Array, triggers: Array }}
 */
function DetectCollisions(entity, scaledVelocity, sceneGraph) {
	if (CONFIG.PHYSICS.Collision.Enabled === false) {
		return { solids: [], triggers: [] };
	}

	const pos = NormalizeVector3(entity && entity.transform ? entity.transform.position : null);
	const vel = NormalizeVector3(scaledVelocity);
	const entityAabb = entity && entity.collision ? entity.collision.aabb : null;
	if (!entityAabb) {
		return { solids: [], triggers: [] };
	}

	const simRadiusAabb = entity && entity.collision && entity.collision.simRadiusAabb
		? entity.collision.simRadiusAabb
		: expandAabb(entityAabb, entity && entity.collision ? entity.collision.simRadiusPadding : 8);
	const candidates = collectCollidables(sceneGraph, simRadiusAabb);
	const entityFrameAabb = buildEntityAabbAtPosition(entityAabb, pos);

	const solids = [];
	const triggers = [];

	for (let i = 0; i < candidates.length; i++) {
		const candidate = candidates[i];

		if (candidate.isTrigger) {
			if (AABBOverlap(entityFrameAabb, candidate.aabb)) {
				triggers.push({
					target: candidate,
					type: "trigger",
				});
			}
			continue;
		}

		const swept = checkSweptAabbPair(pos, vel, entityAabb, candidate.aabb);
		if (swept.hit) {
			const entityDetailed = offsetDetailedBounds(
				buildDetailedBoundsFromCollision(entity.collision),
				ScaleVector3(vel, swept.tEntry)
			);
			if (!checkDetailedBoundsOverlap(entityDetailed, candidate.detailedBounds)) continue;

			solids.push({
				target: candidate,
				tEntry: swept.tEntry,
				normal: swept.normal,
				type: candidate.type,
			});
		}
	}

	// Sort solids by time of entry (closest first).
	solids.sort((a, b) => a.tEntry - b.tEntry);

	return { solids, triggers };
}

/**
 * Resolve solid collisions by sliding velocity along collision normals.
 * Processes collisions in order and adjusts remaining velocity each step.
 * @param {{ x, y, z }} velocity — per-second velocity (not scaled by dt).
 * @param {{ x, y, z }} displacement — velocity * dt (for this frame).
 * @param {Array} solids — sorted collision results from DetectCollisions.
 * @returns {{ resolvedVelocity, resolvedDisplacement, groundContact }}
 */
function ResolveCollisions(velocity, displacement, solids) {
	let vel = NormalizeVector3(velocity);
	let disp = NormalizeVector3(displacement);
	let groundContact = { hit: false, normal: { x: 0, y: 1, z: 0 } };

	if (!Array.isArray(solids) || solids.length === 0) {
		return { resolvedVelocity: vel, resolvedDisplacement: disp, groundContact };
	}

	for (let i = 0; i < solids.length; i++) {
		const collision = solids[i];
		const n = NormalizeVector3(collision.normal);
		const hitTime = Math.max(0, Math.min(1, ToNumber(collision.tEntry, 0)));
		const isGroundCandidate =
			(collision.type === "terrain" || collision.type === "obstacle");

		if (isGroundCandidate) {
			if (!groundContact.hit || n.y > groundContact.normal.y || (n.y === groundContact.normal.y && collision.tEntry < ToNumber(groundContact.tEntry, 1))) {
				groundContact = {
					hit: true,
					normal: { ...n },
					type: collision.type,
					targetId: collision && collision.target ? collision.target.id : null,
					targetAabb: collision && collision.target && collision.target.aabb ? collision.target.aabb : null,
					tEntry: collision.tEntry,
				};
			}
		}

		// Slide: remove velocity component along collision normal.
		const velDotN = DotVector3(vel, n);
		if (velDotN < 0) {
			vel = SubtractVector3(vel, ScaleVector3(n, velDotN));
		}

		// Adjust displacement similarly.
		const dispDotN = DotVector3(disp, n);
		if (dispDotN < 0) {
			disp = SubtractVector3(disp, ScaleVector3(n, dispDotN));
		}

		LogCollision(collision);
	}

	return { resolvedVelocity: vel, resolvedDisplacement: disp, groundContact };
}

let lastLoggedCollisionKey = "";

function LogCollision(collision) {
	const targetId = collision && collision.target ? collision.target.id : "unknown";
	const n = collision && collision.normal ? collision.normal : { x: 0, y: 0, z: 0 };

	// Deduplicate: skip logging the same collision target on consecutive frames.
	const key = `${collision.type || "solid"}:${targetId}:${n.x.toFixed(1)},${n.y.toFixed(1)},${n.z.toFixed(1)}`;
	if (key === lastLoggedCollisionKey) { return; }
	lastLoggedCollisionKey = key;

	Log(
		"ENGINE",
		`Collision: ${collision.type || "solid"} with "${targetId}" | normal=(${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}) t=${ToNumber(collision.tEntry, 0).toFixed(4)}`,
		"log",
		"Level"
	);
}

/* === EXPORTS === */

export {
	DetectCollisions,
	ResolveCollisions,
	GetSimDistanceValue,
	CheckEntityAabbOverlap,
	CheckEntityTrueOverlap,
};
