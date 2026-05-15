// Applies Air/Water Resistance to velocity every frame

// Used by handlers/game/Physics.js

import { CONFIG } from "../core/config.js";
import { EPSILON } from "../core/meta.js";

/**
 * Apply medium-based drag to a velocity vector.
 * Drag is authored as CNU/s of opposing deceleration applied per-axis per tick,
 * clamped so it never reverses direction of travel.
 * @param {{ x: number, y: number, z: number }} velocity
 * @param {number} deltaSeconds
 * @param {"air"|"water"} medium
 * @returns {{ x: number, y: number, z: number }}
 */
function ApplyResistance(velocity, deltaSeconds, medium) {
	const config = CONFIG.PHYSICS.Resistance;
	if (config.Enabled === false) return velocity;

	const drag = (medium === "water" ? config.WaterDrag : config.AirDrag).value;
	const decel = drag * deltaSeconds;

	const applyAxis = (v) => {
		if (Math.abs(v) < EPSILON) return 0;
		return v > 0 ? Math.max(0, v - decel) : Math.min(0, v + decel);
	};

	return {
		x: applyAxis(velocity.x),
		y: applyAxis(velocity.y),
		z: applyAxis(velocity.z),
	};
}

/* === EXPORTS === */

export { ApplyResistance };
