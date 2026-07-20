// Assembly layer: engine-shaped per-force functions that call math/Forces.js and return complete results.

import { ComputeGravity, ComputeBuoyancy, ComputeResistance, ComputeSubmergence } from "../math/Forces.js";
import { SubtractVector3 } from "../math/Vector3.js";

function GetGravity(entityState, physicsState) {
	return ComputeGravity(entityState.velocity, physicsState.deltaSeconds);
}

function GetBuoyancy(entityState, physicsState) {
	return ComputeBuoyancy(
		entityState.transform.position,
		physicsState.waterLevel,
		physicsState.submergence,
		physicsState.deltaSeconds
	);
}

function GetResistance(entityState, physicsState) {
	return ComputeResistance(entityState.velocity, physicsState.deltaSeconds, physicsState.submergence);
}

function GetSubmergence(entity, waterLevel) {
	if (entity.type === "player") {
		const d = SubtractVector3(entity.collision.aabb.max, entity.collision.aabb.min);
		return ComputeSubmergence(entity.collision.aabb.min.y, Math.max(d.x, d.y, d.z), waterLevel);
	}
	return ComputeSubmergence( entity.collision.aabb.min.y, entity.collision.aabb.max.y -  entity.collision.aabb.min.y, waterLevel);
}

/* === EXPORTS === */

export { GetGravity, GetBuoyancy, GetResistance, GetSubmergence };
