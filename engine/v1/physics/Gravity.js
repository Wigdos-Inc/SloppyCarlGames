// Applies gravity to vertical velocity

// Used by handlers/game/Physics.js

import { CONFIG } from "../core/config.js";

/**
 * Apply gravity to a velocity vector.
 * @param {{ x: number, y: number, z: number }} velocity — current velocity (mutated copy returned).
 * @param {number} deltaSeconds — frame delta in seconds.
 * @returns {{ x: number, y: number, z: number }} — updated velocity.
 */
function ApplyGravity(velocity, deltaSeconds) {
	const config = CONFIG.PHYSICS.Gravity;
	if (config.Enabled === false) return velocity;

	velocity.y -= config.Strength.value * deltaSeconds;
	return velocity;
}

/* === EXPORTS === */

export { ApplyGravity };
