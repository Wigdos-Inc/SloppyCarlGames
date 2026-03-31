// Applies Air/Water Resistance to velocity every frame

// Used by handlers/game/Physics.js

import { CONFIG } from "../core/config.js";
import { ToNumber } from "../math/Utilities.js";

const AIR_DRAG = 0.02;
const WATER_DRAG = 0.05;

/**
 * Apply medium-based drag to a velocity vector.
 * Air drag affects only horizontal axes (XZ), water drag affects all axes.
 * @param {{ x: number, y: number, z: number }} velocity
 * @param {number} deltaSeconds
 * @param {"air"|"water"} medium
 * @returns {{ x: number, y: number, z: number }}
 */
function ApplyResistance(velocity, deltaSeconds, medium) {
	const resistanceConfig = CONFIG.PHYSICS.Resistance;
	if (resistanceConfig.Enabled === false) return velocity;

	const dt = ToNumber(deltaSeconds, 0);
	const isWater = medium === "water";
	const coefficient = isWater ? resistanceConfig.WaterDrag : resistanceConfig.AirDrag;
	const factor = Math.max(0, 1 - coefficient * dt * 60);

	if (isWater) return velocity.scale(factor);

	// Air: only horizontal drag, preserve vertical velocity.
	return {
		x: velocity.x * factor,
		y: velocity.y,
		z: velocity.z * factor,
	};
}

/* === EXPORTS === */

export { ApplyResistance };
