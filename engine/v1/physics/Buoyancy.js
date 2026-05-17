// Applies buoyancy upward force when entity is submerged

// Used by handlers/game/Physics.js

import { CONFIG } from "../core/config.js";

/**
 * Compute the buoyancy ΔV for this frame and record the effective force on playerState.
 * GradientDepth blends force from Force.Min (at surface) to Force.Max (at depth),
 * then submergence ratio (0–1) scales the result. The effective per-second upward
 * acceleration (gradientForce * submergence) is stashed on playerState.buoyancyForce
 * for use by the correction pipeline. Terminal velocity is enforced by the physics
 * pipeline, not here.
 * @param {{ x: number, y: number, z: number }} position — entity position
 * @param {Unit} waterLevel — world water level Y as a Unit instance
 * @param {number} submergence — fraction of capsule below waterLevel (0–1)
 * @param {number} deltaSeconds
 * @param {object} playerState — mutable player state; buoyancyForce is written here
 * @returns {number} upward velocity delta for this frame
 */
function ComputeBuoyancyDeltaV(position, waterLevel, submergence, deltaSeconds, playerState) {
	if (CONFIG.PHYSICS.Buoyancy.Enabled === false || submergence <= 0) return 0;

	const config = CONFIG.PHYSICS.Buoyancy;

	let gradientForce;
	if (config.GradientDepth.value === 0) gradientForce = config.Force.Max.value;
	else {
		const t = Math.min(1, waterLevel.value - position.y / config.GradientDepth.value);
		gradientForce = config.Force.Min.value + (config.Force.Max.value - config.Force.Min.value) * t;
	}

	const effectiveForce = gradientForce * submergence;
	playerState.buoyancyForce = effectiveForce;
	return effectiveForce * deltaSeconds;
}

/* === EXPORTS === */

export { ComputeBuoyancyDeltaV };
