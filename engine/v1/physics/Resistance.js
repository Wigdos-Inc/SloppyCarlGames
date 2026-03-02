// Applies Air/Water Resistance to velocity every frame

// Used by handlers/game/Physics.js

import { CONFIG } from "../core/config.js";

function toNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const AIR_DRAG = 0.02;
const WATER_DRAG = 0.12;

/**
 * Apply medium-based drag to a velocity vector.
 * Air drag affects only horizontal axes (XZ), water drag affects all axes.
 * @param {{ x: number, y: number, z: number }} velocity
 * @param {number} deltaSeconds
 * @param {"air"|"water"} medium
 * @returns {{ x: number, y: number, z: number }}
 */
function ApplyResistance(velocity, deltaSeconds, medium) {
	const config = CONFIG && CONFIG.PHYSICS && CONFIG.PHYSICS.Resistance ? CONFIG.PHYSICS.Resistance : {};
	if (config.Enabled === false) {
		return velocity;
	}

	const dt = toNumber(deltaSeconds, 0);
	const isWater = medium === "water";
	const coefficient = isWater ? WATER_DRAG : AIR_DRAG;
	const factor = Math.max(0, 1 - coefficient * dt * 60);

	if (isWater) {
		return {
			x: velocity.x * factor,
			y: velocity.y * factor,
			z: velocity.z * factor,
		};
	}

	// Air: only horizontal drag, preserve vertical velocity.
	return {
		x: velocity.x * factor,
		y: velocity.y,
		z: velocity.z * factor,
	};
}

/* === EXPORTS === */

export { ApplyResistance };
