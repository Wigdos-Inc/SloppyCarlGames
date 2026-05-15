// Applies Air/Water Resistance to velocity every frame

// Used by handlers/game/Physics.js

import { CONFIG } from "../core/config.js";

const AIR_DRAG_COEFFICIENT = CONFIG.PHYSICS.Gravity.Strength.value / CONFIG.PHYSICS.Gravity.TerminalVelocity.Air.value;
const WATER_DRAG_COEFFICIENT = CONFIG.PHYSICS.Gravity.Strength.value / CONFIG.PHYSICS.Gravity.TerminalVelocity.Water.value;

/**
 * Apply medium-based velocity-proportional drag to a velocity vector.
 * drag force = -velocity * dragCoefficient per axis.
 * @param {{ x: number, y: number, z: number }} velocity
 * @param {number} deltaSeconds
 * @param {"air"|"water"} medium
 * @returns {{ x: number, y: number, z: number }}
 */
function ApplyResistance(velocity, deltaSeconds, medium) {
	if (CONFIG.PHYSICS.Resistance.Enabled === false) return velocity;

	const scale = 1 - (medium === "water" ? WATER_DRAG_COEFFICIENT : AIR_DRAG_COEFFICIENT) * deltaSeconds;

	return {
		x: velocity.x * scale,
		y: velocity.y * scale,
		z: velocity.z * scale,
	};
}

/* === EXPORTS === */

export { ApplyResistance, AIR_DRAG_COEFFICIENT, WATER_DRAG_COEFFICIENT };
