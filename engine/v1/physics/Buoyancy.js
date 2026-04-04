// Adapts velocity underwater to make vertical movement more realistic

// Used by handlers/game/Physics.js

import { CONFIG } from "../core/config.js";

/**
 * Apply buoyancy to velocity when entity is submerged.
 * Provides upward force that partially counters gravity and caps sink speed.
 * @param {{ x: number, y: number, z: number }} velocity
 * @param {{ x: number, y: number, z: number }} position — entity position
 * @param {number} waterLevel — world water level Y
 * @param {number} deltaSeconds
 * @returns {{ x: number, y: number, z: number }}
 */
function ApplyBuoyancy(velocity, position, waterLevel, deltaSeconds) {
	if (CONFIG.PHYSICS.Buoyancy.Enabled === false) return velocity;

	if (position.y >= waterLevel) return velocity;

	const submersionDepth = Math.min(3, waterLevel - position.y);
	const submersionRatio = Math.min(1, submersionDepth / 3);
	const buoyancyStrength = CONFIG.PHYSICS.Buoyancy.Force * submersionRatio;

	let newY = velocity.y + buoyancyStrength * deltaSeconds;

	// Cap downward speed when submerged.
	if (newY < -CONFIG.PHYSICS.Buoyancy.SinkSpeed) newY = -CONFIG.PHYSICS.Buoyancy.SinkSpeed;

	return {
		x: velocity.x,
		y: newY,
		z: velocity.z,
	};
}

/* === EXPORTS === */

export { ApplyBuoyancy };
