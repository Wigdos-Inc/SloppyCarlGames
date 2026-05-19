// Assembly layer: engine-shaped per-force functions that call math/Forces.js and return complete results.

import { ComputeGravity, ComputeBuoyancy, ComputeResistance, ComputeSubmergence } from "../math/Forces.js";

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
		const profile = entity.collision.profile;
		const bottom = entity.transform.position.y + profile.bottomOffset.value;
		const height = 2 * (profile.capsuleRadius.value + profile.capsuleHalfHeight.value);
		return ComputeSubmergence(bottom, height, waterLevel);
	}
	const aabb = entity.collision.aabb;
	const bottom = aabb.min.y;
	return ComputeSubmergence(bottom, aabb.max.y - bottom, waterLevel);
}

/* === EXPORTS === */

export { GetGravity, GetBuoyancy, GetResistance, GetSubmergence };
