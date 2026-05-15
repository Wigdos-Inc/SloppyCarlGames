// Applies buoyancy upward force when entity is submerged

// Used by handlers/game/Physics.js

import { CONFIG } from "../core/config.js";

/**
 * Apply buoyancy to velocity when entity is submerged.
 * Upward force is linearly interpolated between Force.Min (at surface) and
 * Force.Max (at GradientDepth and deeper). Terminal velocity underwater is
 * enforced by the physics pipeline, not here.
 * @param {{ x: number, y: number, z: number }} velocity
 * @param {{ x: number, y: number, z: number }} position — entity position
 * @param {Unit} waterLevel — world water level Y as a Unit instance
 * @param {number} deltaSeconds
 * @returns {{ x: number, y: number, z: number }}
 */
function ApplyBuoyancy(velocity, position, waterLevel, deltaSeconds) {
	if (CONFIG.PHYSICS.Buoyancy.Enabled === false) return velocity;

	if (position.y >= waterLevel.value) return velocity;

	const config = CONFIG.PHYSICS.Buoyancy;
	const depth = waterLevel.value - position.y;

	let force;
	if (config.GradientDepth.value === 0) {
		force = config.Force.Max.value;
	} else {
		const t = Math.min(1, depth / config.GradientDepth.value);
		force = config.Force.Min.value + (config.Force.Max.value - config.Force.Min.value) * t;
	}

	return {
		x: velocity.x,
		y: velocity.y + force * deltaSeconds,
		z: velocity.z,
	};
}

/* === EXPORTS === */

export { ApplyBuoyancy };
