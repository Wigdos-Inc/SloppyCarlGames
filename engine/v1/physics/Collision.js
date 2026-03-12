// Stops velocity on a certain axis if collission is going to happen.

// Used by handlers/game/Physics.js to check if entity will collide with something collidable.

import { CONFIG } from "../core/config.js";
import { Log } from "../core/meta.js";
import {
	NormalizeVector3,
	SubtractVector3,
	ScaleVector3,
	DotVector3,
} from "../math/Vector3.js";
import { SweptAABB, AABBOverlap } from "../math/Physics.js";
import { ToNumber } from "../math/Utilities.js";

function GetSimDistanceValue() {
	const raw = CONFIG && CONFIG.PERFORMANCE ? CONFIG.PERFORMANCE.SimDistance : "High";
	if (raw === "Low") { return 35; }
	if (raw === "Medium") { return 60; }
	return 100;
}

function getHalfExtents(aabb) {
	if (!aabb || !aabb.min || !aabb.max) {
		return { x: 0.5, y: 0.5, z: 0.5 };
	}
	return {
		x: (aabb.max.x - aabb.min.x) * 0.5,
		y: (aabb.max.y - aabb.min.y) * 0.5,
		z: (aabb.max.z - aabb.min.z) * 0.5,
	};
}

function ExpandAabb(aabb, padding) {
	if (!aabb || !aabb.min || !aabb.max) {
		return null;
	}
	const pad = Math.max(0, ToNumber(padding, 0));
	return {
		min: {
			x: aabb.min.x - pad,
			y: aabb.min.y - pad,
			z: aabb.min.z - pad,
		},
		max: {
			x: aabb.max.x + pad,
			y: aabb.max.y + pad,
			z: aabb.max.z + pad,
		},
	};
}

function BuildEntityAabbAtPosition(entityAabb, position) {
	if (!entityAabb || !entityAabb.min || !entityAabb.max) {
		return null;
	}
	const halfExtents = getHalfExtents(entityAabb);
	const pos = NormalizeVector3(position);
	const aabbCenter = getAabbCenter(entityAabb);
	const centerOffset = {
		x: aabbCenter.x - pos.x,
		y: aabbCenter.y - pos.y,
		z: aabbCenter.z - pos.z,
	};
	const centerPos = {
		x: pos.x + centerOffset.x,
		y: pos.y + centerOffset.y,
		z: pos.z + centerOffset.z,
	};
	return {
		min: {
			x: centerPos.x - halfExtents.x,
			y: centerPos.y - halfExtents.y,
			z: centerPos.z - halfExtents.z,
		},
		max: {
			x: centerPos.x + halfExtents.x,
			y: centerPos.y + halfExtents.y,
			z: centerPos.z + halfExtents.z,
		},
	};
}

function getAabbCenter(aabb) {
	if (!aabb || !aabb.min || !aabb.max) {
		return { x: 0, y: 0, z: 0 };
	}
	return {
		x: (aabb.min.x + aabb.max.x) * 0.5,
		y: (aabb.min.y + aabb.max.y) * 0.5,
		z: (aabb.min.z + aabb.max.z) * 0.5,
	};
}

function computeOverlapNormal(entityAabb, targetAabb) {
	if (!entityAabb || !targetAabb) {
		return { x: 0, y: 1, z: 0 };
	}

	const overlapX = Math.min(entityAabb.max.x, targetAabb.max.x) - Math.max(entityAabb.min.x, targetAabb.min.x);
	const overlapY = Math.min(entityAabb.max.y, targetAabb.max.y) - Math.max(entityAabb.min.y, targetAabb.min.y);
	const overlapZ = Math.min(entityAabb.max.z, targetAabb.max.z) - Math.max(entityAabb.min.z, targetAabb.min.z);

	if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) {
		return { x: 0, y: 1, z: 0 };
	}

	const entityCenter = getAabbCenter(entityAabb);
	const targetCenter = getAabbCenter(targetAabb);
	const delta = {
		x: entityCenter.x - targetCenter.x,
		y: entityCenter.y - targetCenter.y,
		z: entityCenter.z - targetCenter.z,
	};

	if (overlapY <= overlapX && overlapY <= overlapZ) {
		return { x: 0, y: delta.y >= 0 ? 1 : -1, z: 0 };
	}
	if (overlapX <= overlapZ) {
		return { x: delta.x >= 0 ? 1 : -1, y: 0, z: 0 };
	}
	return { x: 0, y: 0, z: delta.z >= 0 ? 1 : -1 };
}

function CheckAabbOverlapPair(aabbA, aabbB) {
	return AABBOverlap(aabbA, aabbB);
}

function CheckEntityAabbOverlap(entityA, entityB) {
	const aabbA = entityA && entityA.collision ? entityA.collision.aabb : null;
	const aabbB = entityB && entityB.collision ? entityB.collision.aabb : null;
	if (!aabbA || !aabbB) {
		return false;
	}
	return CheckAabbOverlapPair(aabbA, aabbB);
}

function CheckSweptAabbPair(position, displacement, entityAabb, targetAabb) {
	if (!entityAabb || !targetAabb) {
		return { hit: false, tEntry: 1, tExit: 0, normal: { x: 0, y: 0, z: 0 } };
	}
	const pos = NormalizeVector3(position);
	const vel = NormalizeVector3(displacement);
	const halfExtents = getHalfExtents(entityAabb);
	const aabbCenter = getAabbCenter(entityAabb);
	const centerOffset = {
		x: aabbCenter.x - pos.x,
		y: aabbCenter.y - pos.y,
		z: aabbCenter.z - pos.z,
	};
	const centerPos = {
		x: pos.x + centerOffset.x,
		y: pos.y + centerOffset.y,
		z: pos.z + centerOffset.z,
	};
	return SweptAABB(centerPos, vel, halfExtents, targetAabb);
}

function collectCollidables(sceneGraph, simRadiusAabb) {
	const candidates = [];
	const withinSimRadius = (aabb) => {
		if (!simRadiusAabb) {
			return true;
		}
		return CheckAabbOverlapPair(simRadiusAabb, aabb);
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
	const config = CONFIG && CONFIG.PHYSICS && CONFIG.PHYSICS.Collision ? CONFIG.PHYSICS.Collision : {};
	if (config.Enabled === false) {
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
		: ExpandAabb(entityAabb, entity && entity.collision ? entity.collision.simRadiusPadding : 8);
	const candidates = collectCollidables(sceneGraph, simRadiusAabb);
	const entityFrameAabb = BuildEntityAabbAtPosition(entityAabb, pos);

	const solids = [];
	const triggers = [];

	for (let i = 0; i < candidates.length; i++) {
		const candidate = candidates[i];

		if (candidate.isTrigger) {
			if (CheckAabbOverlapPair(entityFrameAabb, candidate.aabb)) {
				triggers.push({
					target: candidate,
					type: "trigger",
				});
			}
			continue;
		}

		const swept = CheckSweptAabbPair(pos, vel, entityAabb, candidate.aabb);
		if (swept.hit) {
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
	if (!CONFIG || !CONFIG.DEBUG || CONFIG.DEBUG.ALL !== true) { return; }
	if (!CONFIG.DEBUG.LOGGING || !CONFIG.DEBUG.LOGGING.Channel || CONFIG.DEBUG.LOGGING.Channel.Level !== true) { return; }

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
	collectCollidables,
	GetSimDistanceValue,
	getHalfExtents,
	ExpandAabb,
	BuildEntityAabbAtPosition,
	CheckAabbOverlapPair,
	CheckEntityAabbOverlap,
	CheckSweptAabbPair,
};
