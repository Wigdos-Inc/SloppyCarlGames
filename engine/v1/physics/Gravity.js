// Applies gravity to vertical velocity

// Used by handlers/game/Physics.js

import { CONFIG } from "../core/config.js";

/**
 * Apply gravity to a velocity vector.
 * @param {{ x: number, y: number, z: number }} velocity — current velocity (mutated copy returned).
 * @param {number} deltaSeconds — frame delta in seconds.
 * @param {{ strengthOverride?: number }} [options] — optional overrides.
 * @returns {{ x: number, y: number, z: number }} — updated velocity.
 */
function ApplyGravity(velocity, deltaSeconds, options = {}) {
	const config = CONFIG.PHYSICS.Gravity;
	if (config.Enabled === false) return velocity;

	velocity.y -= (options.strengthOverride ?? config.Strength) * deltaSeconds;
	return velocity;
}

/* === EXPORTS === */

export { ApplyGravity };
