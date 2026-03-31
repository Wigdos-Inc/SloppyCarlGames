// Applies gravity to vertical velocity

// Used by handlers/game/Physics.js

import { CONFIG } from "../core/config.js";
import { ToNumber } from "../math/Utilities.js";

/**
 * Apply gravity to a velocity vector.
 * @param {{ x: number, y: number, z: number }} velocity — current velocity (mutated copy returned).
 * @param {number} deltaSeconds — frame delta in seconds.
 * @param {{ strengthOverride?: number }} [options] — optional overrides.
 * @returns {{ x: number, y: number, z: number }} — updated velocity.
 */
function ApplyGravity(velocity, deltaSeconds, options) {
	const config = CONFIG.PHYSICS.Gravity;
	if (config.Enabled === false) return velocity;

	const dt = ToNumber(deltaSeconds, 0);
	const opts = options && typeof options === "object" ? options : {};
	const strength = ToNumber(opts.strengthOverride, ToNumber(config.Strength, 25));

	velocity.y -= strength * dt;
	return velocity;
}

/* === EXPORTS === */

export { ApplyGravity };
