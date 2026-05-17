// Applies Air/Water Resistance to velocity every frame

// Used by handlers/game/Physics.js

import { CONFIG } from "../core/config.js";
import { ScaleVector3 } from "../math/Vector3.js";

const AIR_DRAG_COEFFICIENT = CONFIG.PHYSICS.Gravity.Strength.value / CONFIG.PHYSICS.Gravity.TerminalVelocity.Air.value;
const WATER_DRAG_COEFFICIENT = CONFIG.PHYSICS.Gravity.Strength.value / CONFIG.PHYSICS.Gravity.TerminalVelocity.Water.value;

/**
 * Apply velocity-proportional drag blended by submergence ratio.
 * drag force = -velocity * k per axis, where k interpolates between
 * AIR_DRAG_COEFFICIENT (submergence 0) and WATER_DRAG_COEFFICIENT (submergence 1).
 * @param {{ x: number, y: number, z: number }} velocity
 * @param {number} deltaSeconds
 * @param {number} submergence — fraction of capsule below waterLevel (0–1)
 * @returns {{ x: number, y: number, z: number }}
 */
function ApplyResistance(velocity, deltaSeconds, submergence) {
	if (CONFIG.PHYSICS.Resistance.Enabled === false) return velocity;

	const k = AIR_DRAG_COEFFICIENT + (WATER_DRAG_COEFFICIENT - AIR_DRAG_COEFFICIENT) * submergence;

	return ScaleVector3(velocity, 1 - k * deltaSeconds);
}

/* === EXPORTS === */

export { ApplyResistance, AIR_DRAG_COEFFICIENT, WATER_DRAG_COEFFICIENT };
