// Adapts velocity underwater to make vertical movement more realistic

// Used by handlers/game/Physics.js

import { CONFIG } from "../core/config.js";

function toNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const BUOYANCY_FORCE = 12;
const MAX_SINK_SPEED = 6;

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
	const config = CONFIG && CONFIG.PHYSICS && CONFIG.PHYSICS.Buoyancy ? CONFIG.PHYSICS.Buoyancy : {};
	if (config.Enabled === false) {
		return velocity;
	}

	const posY = toNumber(position && position.y, 0);
	const level = toNumber(waterLevel, -9999);

	if (posY >= level) {
		return velocity;
	}

	const dt = toNumber(deltaSeconds, 0);
	const submersionDepth = Math.min(3, level - posY);
	const submersionRatio = Math.min(1, submersionDepth / 3);
	const buoyancyStrength = BUOYANCY_FORCE * submersionRatio;

	let newY = velocity.y + buoyancyStrength * dt;

	// Cap downward speed when submerged.
	if (newY < -MAX_SINK_SPEED) {
		newY = -MAX_SINK_SPEED;
	}

	return {
		x: velocity.x,
		y: newY,
		z: velocity.z,
	};
}

/* === EXPORTS === */

export { ApplyBuoyancy };
