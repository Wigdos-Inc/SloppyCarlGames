// Pure force calculation: gravity, buoyancy, resistance, and step-velocity composition

import { CONFIG } from "../core/config.js";
import { Log } from "../core/meta.js";
import { Clamp01 } from "./Utilities.js";
import { CloneVector3 } from "./Vector3.js";

const AIR_DRAG_COEFFICIENT = CONFIG.PHYSICS.Gravity.Strength.value / CONFIG.PHYSICS.Gravity.TerminalVelocity.Air.value;
const WATER_DRAG_COEFFICIENT = CONFIG.PHYSICS.Gravity.Strength.value / CONFIG.PHYSICS.Gravity.TerminalVelocity.Water.value;

const logFlags = { gravity: false, resistance: false, buoyancy: false };

// --- Scalar helpers (axis-agnostic, pure arithmetic, no Enabled checks) ---

const gravityScalar = (v, dt) => v - CONFIG.PHYSICS.Gravity.Strength.value * dt;
const resistanceScalar = (v, sub, dt) => v * (1 - (AIR_DRAG_COEFFICIENT + (WATER_DRAG_COEFFICIENT - AIR_DRAG_COEFFICIENT) * sub) * dt);

// buoyancy legitimately takes more inputs than the others; returns per-frame ΔV (not force).
function buoyancyScalar(position, waterLevel, submergence, dt) {
	if (submergence <= 0) return 0;
	const config = CONFIG.PHYSICS.Buoyancy;
	let gradientForce;
	if (config.GradientDepth.value === 0) gradientForce = config.Force.Max.value;
	else {
		const t = Math.min(1, (waterLevel.value - position.y) / config.GradientDepth.value);
		gradientForce = config.Force.Min.value + (config.Force.Max.value - config.Force.Min.value) * t;
	}
	return gradientForce * submergence * dt;
}

// --- Exported functions ---

/**
 * Apply gravity to a velocity vector.
 * @param {{ x: number, y: number, z: number }} velocity
 * @param {number} deltaSeconds — frame delta in seconds.
 * @returns {{ x: number, y: number, z: number }} — new vector with gravity applied to y; x/z unchanged.
 */
function ComputeGravity(velocity, deltaSeconds) {
	if (CONFIG.PHYSICS.Gravity.Enabled === false) {
		if (!logFlags.gravity) { Log("ENGINE", "Gravity disabled — ComputeGravity is a no-op", "warn", "Physics"); logFlags.gravity = true; }
		return CloneVector3(velocity);
	}
	return { x: velocity.x, y: gravityScalar(velocity.y, deltaSeconds), z: velocity.z };
}

/**
 * Apply velocity-proportional drag blended by submergence ratio.
 * @param {{ x: number, y: number, z: number }} velocity
 * @param {number} deltaSeconds
 * @param {number} submergence — fraction of capsule below waterLevel (0–1).
 * @returns {{ x: number, y: number, z: number }} — new vector with resistance applied to all axes.
 */
function ComputeResistance(velocity, deltaSeconds, submergence) {
	if (CONFIG.PHYSICS.Resistance.Enabled === false) {
		if (!logFlags.resistance) { Log("ENGINE", "Resistance disabled — ComputeResistance is a no-op", "warn", "Physics"); logFlags.resistance = true; }
		return CloneVector3(velocity);
	}
	return {
		x: resistanceScalar(velocity.x, submergence, deltaSeconds),
		y: resistanceScalar(velocity.y, submergence, deltaSeconds),
		z: resistanceScalar(velocity.z, submergence, deltaSeconds),
	};
}

/**
 * Compute buoyancy velocity change and effective force for this frame.
 * GradientDepth blends force from Force.Min (surface) to Force.Max (depth), scaled by submergence.
 * @param {{ x: number, y: number, z: number }} position — entity position.
 * @param {Unit} waterLevel — world water level Y as a Unit instance.
 * @param {number} submergence — fraction of capsule below waterLevel (0–1).
 * @param {number} deltaSeconds
 * @returns {{ velocityChange: number, buoyancyForce: number }}
 */
function ComputeBuoyancy(position, waterLevel, submergence, deltaSeconds) {
	if (CONFIG.PHYSICS.Buoyancy.Enabled === false || submergence <= 0) {
		if (!logFlags.buoyancy) { 
			Log("ENGINE", "Buoyancy disabled or no submergence — ComputeBuoyancy is a no-op", "warn", "Physics"); 
			logFlags.buoyancy = true; 
		}
		return { velocityChange: 0, buoyancyForce: 0 };
	}
	const config = CONFIG.PHYSICS.Buoyancy;
	const gradientForce = config.GradientDepth === 0
		? config.Force.Max.value
		: config.Force.Min.value + (config.Force.Max.value - config.Force.Min.value) * Math.min(1, (waterLevel.value - position.y) / config.GradientDepth.value);
	return { velocityChange: buoyancyScalar(position, waterLevel, submergence, deltaSeconds), buoyancyForce: gradientForce * submergence };
}

/**
 * Composable step-velocity computer. Two entry points:
 *   scalar — one velocity component, configurable forces, optional floatiness.
 *   vector — all three axes in one call; standard force axes (gravity/buoyancy → y, resistance → all).
 *
 * forces shape for scalar:
 *   { gravity?: true, buoyancy?: { position, waterLevel, submergence }, resistance?: { submergence } }
 *   Presence of a key = apply that force. gravity has no payload (reads CONFIG).
 *
 * vertical shape (last param on both methods):
 *   { flag: boolean, floatiness: number }
 *   flag true = apply floatiness smoothing after forces.
 */
const ComputeStepVelocity = {
	/**
	 * @param {number} v — current velocity component.
	 * @param {{ gravity?: true, buoyancy?: object, resistance?: object }} forces
	 * @param {number} dt
	 * @param {{ flag: boolean, floatiness: number }} vertical
	 * @returns {number}
	 */
	scalar(v, forces, dt, vertical) {
		const vBefore = v;
		if (forces.gravity) {
			if (CONFIG.PHYSICS.Gravity.Enabled === false) {
				if (!logFlags.gravity) { 
					Log("ENGINE", "Gravity disabled — scalar gravity skipped", "warn", "Physics"); 
					logFlags.gravity = true; 
				}
			} 
			else v = gravityScalar(v, dt);
		}
		if (forces.buoyancy) {
			if (CONFIG.PHYSICS.Buoyancy.Enabled === false) {
				if (!logFlags.buoyancy) { 
					Log("ENGINE", "Buoyancy disabled — scalar buoyancy skipped", "warn", "Physics"); 
					logFlags.buoyancy = true; 
				}
			} 
			else v += buoyancyScalar(forces.buoyancy.position, forces.buoyancy.waterLevel, forces.buoyancy.submergence, dt);
		}
		if (forces.resistance) {
			if (CONFIG.PHYSICS.Resistance.Enabled === false) {
				if (!logFlags.resistance) { 
					Log("ENGINE", "Resistance disabled — scalar resistance skipped", "warn", "Physics"); 
					logFlags.resistance = true; 
				}
			} 
			else v = resistanceScalar(v, forces.resistance.submergence, dt);
		}
		if (vertical.flag) return vBefore + (v - vBefore) / vertical.floatiness;
		return v;
	},

	/**
	 * @param {{ x: number, y: number, z: number }} velocity
	 * @param {number} submergence — fraction of capsule below waterLevel (0–1).
	 * @param {{ x: number, y: number, z: number }} position
	 * @param {Unit} waterLevel
	 * @param {number} deltaSeconds
	 * @param {{ flag: boolean, floatiness: number }} vertical
	 * @returns {{ x: number, y: number, z: number }}
	 */
	sim(velocity, submergence, position, waterLevel, deltaSeconds, vertical) {
		return {
			x: this.scalar(velocity.x, { resistance: { submergence } }, deltaSeconds, { flag: false }),
			y: this.scalar(
				velocity.y, 
				{ gravity: true, buoyancy: { position, waterLevel, submergence }, resistance: { submergence } }, 
				deltaSeconds, 
				vertical
			),
			z: this.scalar(velocity.z, { resistance: { submergence } }, deltaSeconds, { flag: false }),
		};
	},
};

/**
 * Compute the 0–1 submergence ratio of a volume in water.
 * @param {number} bottom — world-space Y of the volume's lowest point.
 * @param {number} height — total height of the volume.
 * @param {Unit | null} waterLevel — world water level, or null if no water.
 * @returns {number} — fraction of volume below waterLevel (0–1).
 */
const ComputeSubmergence = (bottom, height, waterLevel) => waterLevel === null ? 0 : Clamp01((waterLevel.value - bottom) / height);

/* === EXPORTS === */

export { ComputeGravity, ComputeResistance, ComputeBuoyancy, ComputeStepVelocity, ComputeSubmergence };
