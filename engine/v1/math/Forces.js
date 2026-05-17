// Pure force calculation: gravity, buoyancy, resistance, and vertical velocity step

import { CONFIG } from "../core/config.js";
import { ScaleVector3 } from "./Vector3.js";

const AIR_DRAG_COEFFICIENT = CONFIG.PHYSICS.Gravity.Strength.value / CONFIG.PHYSICS.Gravity.TerminalVelocity.Air.value;
const WATER_DRAG_COEFFICIENT = CONFIG.PHYSICS.Gravity.Strength.value / CONFIG.PHYSICS.Gravity.TerminalVelocity.Water.value;

/**
 * Apply gravity to a velocity vector.
 * @param {{ x: number, y: number, z: number }} velocity — current velocity (mutated copy returned).
 * @param {number} deltaSeconds — frame delta in seconds.
 * @returns {{ x: number, y: number, z: number }} — updated velocity.
 */
function ApplyGravity(velocity, deltaSeconds) {
	const config = CONFIG.PHYSICS.Gravity;
	if (config.Enabled === false) return velocity;

	velocity.y -= config.Strength.value * deltaSeconds;
	return velocity;
}

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

/**
 * Compute the buoyancy ΔV for this frame and return the effective force for the caller to record.
 * GradientDepth blends force from Force.Min (at surface) to Force.Max (at depth),
 * then submergence ratio (0–1) scales the result. The effective per-second upward
 * acceleration (gradientForce * submergence) is returned as buoyancyForce so the caller
 * can write it to player state for use by the correction pipeline. Terminal velocity is
 * enforced by the physics pipeline, not here.
 * @param {{ x: number, y: number, z: number }} position — entity position
 * @param {Unit} waterLevel — world water level Y as a Unit instance
 * @param {number} submergence — fraction of capsule below waterLevel (0–1)
 * @param {number} deltaSeconds
 * @returns {{ deltaV: number, buoyancyForce: number }}
 */
function ComputeBuoyancyDeltaV(position, waterLevel, submergence, deltaSeconds) {
	if (CONFIG.PHYSICS.Buoyancy.Enabled === false || submergence <= 0) return { deltaV: 0, buoyancyForce: 0 };

	const config = CONFIG.PHYSICS.Buoyancy;

	let gradientForce;
	if (config.GradientDepth.value === 0) gradientForce = config.Force.Max.value;
	else {
		const t = Math.min(1, waterLevel.value - position.y / config.GradientDepth.value);
		gradientForce = config.Force.Min.value + (config.Force.Max.value - config.Force.Min.value) * t;
	}

	const effectiveForce = gradientForce * submergence;
	return { deltaV: effectiveForce * deltaSeconds, buoyancyForce: effectiveForce };
}

/**
 * One frame of the composed vertical force step, shared by ApplyPhysicsPipeline (runtime)
 * and the jump solver in Movement.js. Order: gravity → buoyancy → resistance → floatiness.
 * @param {number} vy
 * @param {number} gravity — CONFIG.PHYSICS.Gravity.Strength.value
 * @param {number} k — drag coefficient for this medium/frame
 * @param {number} buoyancyDeltaV — upward ΔV this frame (0 if not submerged / disabled)
 * @param {number} floatiness — active airFloatiness or waterFloatiness (> 0, authored)
 * @param {number} dt
 * @returns {number}
 */
function StepVerticalVelocity(vy, gravity, k, buoyancyDeltaV, floatiness, dt) {
	const vyBefore = vy;
	vy -= gravity * dt;
	vy += buoyancyDeltaV;
	vy *= (1 - k * dt);
	return vyBefore + (vy - vyBefore) / floatiness;
}

/* === EXPORTS === */

export { ApplyGravity, ComputeBuoyancyDeltaV, ApplyResistance, AIR_DRAG_COEFFICIENT, WATER_DRAG_COEFFICIENT, StepVerticalVelocity };
