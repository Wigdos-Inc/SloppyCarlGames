// Corrects velocity, position, rotation, etc to prevent weird clipping or misalignment.

// Used by handlers/game/Physics.js

import { CONFIG } from "../core/config.js";
import { Log, EPSILON } from "../core/meta.js";
import {
	DotVector3,
	SubtractVector3,
	ScaleVector3,
	ResolveVector3Axis,
	CloneVector3,
} from "../math/Vector3.js";
import { Clamp } from "../math/Utilities.js";

const worldUp = { x: 0, y: 1, z: 0 };

function hasMeaningfulDelta(currentValue, nextValue) {
	return Math.abs(nextValue - currentValue) > EPSILON;
}

function hasMeaningfulVectorDelta(currentVector, nextVector) {
	return (
		hasMeaningfulDelta(currentVector.x, nextVector.x) ||
		hasMeaningfulDelta(currentVector.y, nextVector.y) ||
		hasMeaningfulDelta(currentVector.z, nextVector.z)
	);
}

function resetSurfaceState(playerState) {
	const changedGrounded = playerState.grounded;
	const changedOrientation =
		hasMeaningfulVectorDelta(playerState.surfaceNormal, worldUp) ||
		hasMeaningfulVectorDelta(playerState.alignedUp, worldUp);

	playerState.grounded = false;
	playerState.surfaceNormal = { x: 0, y: 1, z: 0 };
	playerState.alignedUp = { x: 0, y: 1, z: 0 };

	return {
		changedGrounded: changedGrounded,
		changedOrientation: changedOrientation,
		changedPosition: false,
		changedVelocity: false,
		anyChanged: changedGrounded || changedOrientation,
	};
}

const CORRECTION_DISABLED = Object.freeze({
	changedGrounded: false,
	changedOrientation: false,
	changedPosition: false,
	changedVelocity: false,
	anyChanged: false,
});

function applySurfaceNormal(playerState, normal) {
	applySurfaceNormal(playerState, normal);
}

/**
 * Loop-time slope correction for Sonic-style running.
 * Updates grounded state, surface orientation state, and slope-projected velocity.
 * Position snap is handled separately after the collision/correction loop stabilizes.
 *
 * @param {object} playerState — full mutable player state.
 * @param {{ hit: boolean, normal: { x, y, z } }} groundContact — from collision resolution.
 */
function ApplySurfaceCorrection(playerState, groundContact) {
	const config = CONFIG.PHYSICS.Correction;
	if (config.Enabled === false) return CORRECTION_DISABLED;

	if (!groundContact.hit) return resetSurfaceState(playerState);
	if (groundContact.type !== "terrain" && groundContact.type !== "obstacle") return resetSurfaceState(playerState);

	const normal = ResolveVector3Axis(groundContact.normal);
	const previousNormal = ResolveVector3Axis(playerState.surfaceNormal);
	const normalDot = Clamp(DotVector3(previousNormal, normal), -1, 1);
	const deltaAngleDegrees = (Math.acos(normalDot) * 180) / Math.PI;

	if (deltaAngleDegrees > config.MaxDeltaDegrees) return resetSurfaceState(playerState);

	const changedGrounded = !playerState.grounded;
	const changedOrientation =
		hasMeaningfulVectorDelta(playerState.surfaceNormal, normal) ||
		hasMeaningfulVectorDelta(playerState.alignedUp, normal);
	let changedVelocity = false;

	applySurfaceNormal(playerState, normal);

	// Correct vertical velocity: remove downward component upon ground contact.
	if (playerState.velocity.y < 0) {
		playerState.velocity.y = 0;
		changedVelocity = true;
	}

	// Project forward velocity onto the surface plane to preserve movement speed on slopes.
	// This creates the illusion of flat-speed movement regardless of incline.
	const vel = playerState.velocity;
	const horizontalSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

	if (horizontalSpeed > 0.01 && Math.abs(normal.y) < 0.999) {
		// Compute forward direction from horizontal velocity.
		const forwardDir = ResolveVector3Axis({ x: vel.x, y: 0, z: vel.z });

		// Project forward onto the surface plane.
		const dot = DotVector3(forwardDir, normal);
		const projected = ResolveVector3Axis(SubtractVector3(forwardDir, ScaleVector3(normal, dot)));

		// Scale projected direction to maintain original horizontal speed.
		vel.set(ScaleVector3(projected, horizontalSpeed));
		
		// Adjust vertical velocity to follow slope naturally.
		changedVelocity = changedVelocity ||
			hasMeaningfulDelta(playerState.velocity.x, vel.x) ||
			hasMeaningfulDelta(playerState.velocity.y, vel.y) ||
			hasMeaningfulDelta(playerState.velocity.z, vel.z);
	}

	if (changedOrientation || changedVelocity) {
		Log(
			"ENGINE",
			`
				Slope correction applied: 
				grounded=${playerState.grounded} 
				normal=(${normal.x.toFixed(2)}, ${normal.y.toFixed(2)}, ${normal.z.toFixed(2)}) 
				orientationChanged=${changedOrientation} velocityChanged=${changedVelocity}
			`,
			"log",
			"Level"
		);
	}

	const anyChanged = changedGrounded || changedOrientation || changedVelocity;

	return {
		changedGrounded: changedGrounded,
		changedOrientation: changedOrientation,
		changedPosition: false,
		changedVelocity: changedVelocity,
		anyChanged: anyChanged,
	};
}

function ApplyGroundSnap(playerState, groundContact) {
	const config = CONFIG.PHYSICS.Correction;
	if (config.Enabled === false) return CORRECTION_DISABLED;

	if (!groundContact.hit) return resetSurfaceState(playerState);
	if (groundContact.type !== "terrain" && groundContact.type !== "obstacle") return resetSurfaceState(playerState);

	const normal = ResolveVector3Axis(groundContact.normal);
	let changedPosition = false;
	let deltaY = 0;

	if (normal.y > 0.5) {
		const collisionProfile = playerState.collision.profile;
		const desiredPosY = groundContact.supportPoint.y - collisionProfile.bottomOffset.value;
		deltaY = desiredPosY - playerState.transform.position.y;

		if (Math.abs(deltaY) <= config.GroundSnapTolerance) {
			changedPosition = Math.abs(deltaY) > EPSILON;
			playerState.transform.position.y = desiredPosY;
		}
	}

	const changedGrounded = !playerState.grounded;
	const changedOrientation =
		hasMeaningfulVectorDelta(playerState.surfaceNormal, normal) ||
		hasMeaningfulVectorDelta(playerState.alignedUp, normal);

	applySurfaceNormal(playerState, normal);

	if (changedPosition) {
		Log(
			"ENGINE",
			`Ground snap applied: deltaY=${deltaY.toFixed(4)} grounded=${playerState.grounded}`,
			"log",
			"Level"
		);
	}

	const anyChanged = changedGrounded || changedOrientation || changedPosition;

	return {
		changedGrounded: changedGrounded,
		changedOrientation: changedOrientation,
		changedPosition: changedPosition,
		changedVelocity: false,
		anyChanged: anyChanged,
	};
}

function ApplyPlayerSurfaceOrientation(playerState) {
	const angles = ComputeAlignmentAngles(playerState.alignedUp);
	const rotation = playerState.transform.rotation;
	const changedOrientation =
		hasMeaningfulDelta(rotation.x, angles.pitch) ||
		hasMeaningfulDelta(rotation.z, angles.roll);

	rotation.x = angles.pitch;
	rotation.z = angles.roll;

	return { changedOrientation: changedOrientation, anyChanged: changedOrientation };
}

/**
 * Compute rotation values to orient an entity's up-vector toward a target normal.
 * Returns pitch (X) and roll (Z) in radians. Yaw is not affected.
 * @param {{ x, y, z }} surfaceNormal
 * @returns {{ pitch: number, roll: number }}
 */
function ComputeAlignmentAngles(surfaceNormal) {
	const n = ResolveVector3Axis(surfaceNormal);
	return {
		pitch: Math.asin(-n.z),
		roll: Math.asin(n.x),
	};
}

/* === EXPORTS === */

export {
	ApplySurfaceCorrection,
	ApplyGroundSnap,
	ApplyPlayerSurfaceOrientation,
	ComputeAlignmentAngles,
};
