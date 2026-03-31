// Corrects velocity, position, rotation, etc to prevent weird clipping or misalignment.

// Used by handlers/game/Physics.js

import { CONFIG } from "../core/config.js";
import { Log, EPSILON } from "../core/meta.js";
import {
	NormalizeVector3,
	DotVector3,
	SubtractVector3,
	ScaleVector3,
	ResolveVector3Axis,
	CloneVector3,
} from "../math/Vector3.js";
import { Clamp, ToNumber } from "../math/Utilities.js";

const worldUp = { x: 0, y: 1, z: 0 };

function hasMeaningfulDelta(currentValue, nextValue) {
	return Math.abs(nextValue - currentValue) > EPSILON;
}

function hasMeaningfulVectorDelta(currentVector, nextVector) {
	return (
		hasMeaningfulDelta(currentVector.x, nextVector.x, EPSILON) ||
		hasMeaningfulDelta(currentVector.y, nextVector.y, EPSILON) ||
		hasMeaningfulDelta(currentVector.z, nextVector.z, EPSILON)
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
	if (config.Enabled === false) {
		return {
			changedGrounded: false,
			changedOrientation: false,
			changedPosition: false,
			changedVelocity: false,
			anyChanged: false,
		};
	}

	if (!groundContact.hit) return resetSurfaceState(playerState);
	if (groundContact.type !== "terrain" && groundContact.type !== "obstacle") return resetSurfaceState(playerState);

	const normal = ResolveVector3Axis(NormalizeVector3(groundContact.normal, worldUp));
	const previousNormal = ResolveVector3Axis(NormalizeVector3(playerState.surfaceNormal, worldUp));
	const normalDot = Clamp(DotVector3(previousNormal, normal), -1, 1);
	const deltaAngleDegrees = (Math.acos(normalDot) * 180) / Math.PI;

	if (deltaAngleDegrees > config.MaxDeltaDegrees) return resetSurfaceState(playerState);

	const changedGrounded = !playerState.grounded;
	const changedOrientation =
		hasMeaningfulVectorDelta(playerState.surfaceNormal, normal, EPSILON) ||
		hasMeaningfulVectorDelta(playerState.alignedUp, normal, EPSILON);
	let changedVelocity = false;

	playerState.grounded = true;
	playerState.surfaceNormal = CloneVector3(normal);
	playerState.alignedUp = CloneVector3(normal);

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
			hasMeaningfulDelta(playerState.velocity.x, vel.x, EPSILON) ||
			hasMeaningfulDelta(playerState.velocity.y, vel.y, EPSILON) ||
			hasMeaningfulDelta(playerState.velocity.z, vel.z, EPSILON);
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
	if (config.Enabled === false) {
		return {
			changedGrounded: false,
			changedOrientation: false,
			changedPosition: false,
			changedVelocity: false,
			anyChanged: false,
		};
	}

	if (!groundContact.hit) return resetSurfaceState(playerState);
	if (groundContact.type !== "terrain" && groundContact.type !== "obstacle") return resetSurfaceState(playerState);

	const normal = ResolveVector3Axis(NormalizeVector3(groundContact.normal, worldUp));
	let changedPosition = false;
	let deltaY = 0;

	if (groundContact.targetAabb && normal.y > 0.5) {
		const collisionProfile = playerState.collision.profile;
		const currentPosY = playerState.transform.position.y;
		const bottomOffsetFromTransform = ToNumber(collisionProfile.bottomOffset.value, 0);
		const desiredPosY = ToNumber(groundContact.targetAabb.max.y, currentPosY) - bottomOffsetFromTransform;
		deltaY = desiredPosY - currentPosY;

		if (Math.abs(deltaY) <= config.GroundSnapTolerance) {
			changedPosition = Math.abs(deltaY) > EPSILON;
			playerState.transform.position.y = desiredPosY;
		}
	}

	const changedGrounded = !playerState.grounded;
	const changedOrientation =
		hasMeaningfulVectorDelta(playerState.surfaceNormal, normal, EPSILON) ||
		hasMeaningfulVectorDelta(playerState.alignedUp, normal, EPSILON);

	playerState.grounded = true;
	playerState.surfaceNormal = CloneVector3(normal);
	playerState.alignedUp = CloneVector3(normal);

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
		hasMeaningfulDelta(rotation.x, angles.pitch, EPSILON) ||
		hasMeaningfulDelta(rotation.z, angles.roll, EPSILON);

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
	const n = ResolveVector3Axis(NormalizeVector3(surfaceNormal, worldUp));
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
