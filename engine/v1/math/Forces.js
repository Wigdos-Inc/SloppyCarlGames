// Pure force calculation: gravity, buoyancy, resistance, and step-velocity composition

import { CONFIG } from "../core/config.js";
import { Log } from "../core/meta.js";
import { Clamp01 } from "./Utilities.js";
import { CloneVector3 } from "./Vector3.js";

const airDragCoefficient   = () => CONFIG.Physics.Gravity.Strength / CONFIG.Physics.Gravity.TerminalVelocity.Air;
const waterDragCoefficient = () => CONFIG.Physics.Gravity.Strength / CONFIG.Physics.Gravity.TerminalVelocity.Water;

const logFlags = { gravity: false, resistance: false, buoyancy: false };

// --- Scalar helpers (axis-agnostic, pure arithmetic, no Enabled checks) ---

const gravityScalar = (v, dt) => v - CONFIG.Physics.Gravity.Strength * dt;
const resistanceScalar = (v, sub, dt) => v * (1 - (airDragCoefficient() + (waterDragCoefficient() - airDragCoefficient()) * sub) * dt);

// buoyancy legitimately takes more inputs than the others; returns per-frame ΔV (not force).
function buoyancyScalar(position, waterLevel, submergence, dt) {
	if (submergence <= 0) return 0;

	const { GradientDepth, Force } = CONFIG.Physics.Buoyancy;
	let gradientForce;
	if (GradientDepth === 0) gradientForce = Force.Max;
	else gradientForce = Force.Min + (Force.Max - Force.Min) * Math.min(1, (waterLevel - position.y) / GradientDepth);
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
	if (CONFIG.Physics.Gravity.Enabled === false) {
		if (!logFlags.gravity) { 
			Log("ENGINE", "Gravity disabled — ComputeGravity is a no-op", "warn", "Level"); 
			logFlags.gravity = true; 
		}
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
	if (CONFIG.Physics.Resistance.Enabled === false) {
		if (!logFlags.resistance) { 
			Log("ENGINE", "Resistance disabled — ComputeResistance is a no-op", "warn", "Level"); 
			logFlags.resistance = true; 
		}
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
 * @param {number | null} waterLevel — world water level Y in CNU, or null if no water.
 * @param {number} submergence — fraction of capsule below waterLevel (0–1).
 * @param {number} deltaSeconds
 * @returns {{ velocityChange: number, buoyancyForce: number }}
 */
function ComputeBuoyancy(position, waterLevel, submergence, deltaSeconds) {
	const { Force, Enabled, GradientDepth } = CONFIG.Physics.Buoyancy;
	if (Enabled === false || submergence <= 0) {
		if (!logFlags.buoyancy) { 
			Log("ENGINE", "Buoyancy disabled or entity is not submerged — ComputeBuoyancy is a no-op", "warn", "Level"); 
			logFlags.buoyancy = true; 
		}
		return { velocityChange: 0, buoyancyForce: 0 };
	}
	
	const gradientForce = GradientDepth === 0
		? Force.Max
		: Force.Min + (Force.Max - Force.Min) * Math.min(1, (waterLevel - position.y) / GradientDepth);
	return { velocityChange: buoyancyScalar(position, waterLevel, submergence, deltaSeconds), buoyancyForce: gradientForce * submergence };
}

/**
 * Composable step-velocity computer. Two entry points:
 *   scalar — one velocity component, configurable forces, optional floatiness.
 *   sim — all three axes in one call; standard force axes (gravity/buoyancy → y, resistance → all).
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
	scalar(v, forces, dt, vertical) {
		const lastV = v;
		if (forces.gravity) {
			if (CONFIG.Physics.Gravity.Enabled !== false) v = gravityScalar(v, dt);
			else if (!logFlags.gravity) {
				Log("ENGINE", "Gravity disabled in CONFIG — scalar gravity skipped", "warn", "Level");
				logFlags.gravity = true;
			}
		}
		if (forces.buoyancy) {
			if (CONFIG.Physics.Buoyancy.Enabled !== false) {
				v += buoyancyScalar(forces.buoyancy.position, forces.buoyancy.waterLevel, forces.buoyancy.submergence, dt);
			}
			else if (!logFlags.buoyancy) {
				Log("ENGINE", "Buoyancy disabled in CONFIG — scalar buoyancy skipped", "warn", "Level");
				logFlags.buoyancy = true;
			}
		}
		if (forces.resistance) {
			if (CONFIG.Physics.Resistance.Enabled !== false) v = resistanceScalar(v, forces.resistance.submergence, dt);
			else if (!logFlags.resistance) {
				Log("ENGINE", "Resistance disabled in CONFIG — scalar resistance skipped", "warn", "Level");
				logFlags.resistance = true;
			}
		}
		return vertical.flag ? lastV + (v - lastV) / vertical.floatiness : v;
	},

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
 * @param {number | null} waterLevel — world water level Y in CNU, or null if no water.
 * @returns {number} — fraction of volume below waterLevel (0–1).
 */
const ComputeSubmergence = (bottom, height, waterLevel) => waterLevel === null ? 0 : Clamp01((waterLevel - bottom) / height);

/* === EXPORTS === */

export { ComputeGravity, ComputeResistance, ComputeBuoyancy, ComputeStepVelocity, ComputeSubmergence };
