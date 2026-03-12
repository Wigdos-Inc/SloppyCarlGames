// Applies gravity to vertical velocity

// Used by handlers/game/Physics.js

import { CONFIG } from "../core/config.js";

function toNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getGravityConfig() {
	return CONFIG.PHYSICS.Gravity;
}

/**
 * Apply gravity to a velocity vector.
 * @param {{ x: number, y: number, z: number }} velocity — current velocity (mutated copy returned).
 * @param {number} deltaSeconds — frame delta in seconds.
 * @param {{ strengthOverride?: number }} [options] — optional overrides.
 * @returns {{ x: number, y: number, z: number }} — updated velocity.
 */
function ApplyGravity(velocity, deltaSeconds, options) {
	const config = getGravityConfig();
	if (config.Enabled === false) {
		return velocity;
	}

	const dt = toNumber(deltaSeconds, 0);
	const opts = options && typeof options === "object" ? options : {};
	const strength = toNumber(opts.strengthOverride, toNumber(config.Strength, 25));

	return {
		x: velocity.x,
		y: velocity.y - strength * dt,
		z: velocity.z,
	};
}

/* === EXPORTS === */

export { ApplyGravity };
