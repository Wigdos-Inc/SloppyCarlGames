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
	Vector3Sq,
	WORLD_NORMALS,
} from "../math/Vector3.js";
import { Clamp } from "../math/Utilities.js";

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
		hasMeaningfulVectorDelta(playerState.surfaceNormal, WORLD_NORMALS.Up) ||
		hasMeaningfulVectorDelta(playerState.alignedUp, WORLD_NORMALS.Up);

	playerState.grounded = false;
	playerState.surfaceNormal = CloneVector3(WORLD_NORMALS.Up);
	playerState.alignedUp = CloneVector3(WORLD_NORMALS.Up);

	return {
		changedGrounded, changedOrientation,
		changedPosition: false,
		changedVelocity: false,
		anyChanged: changedGrounded || changedOrientation,
	};
}

const correctionDisabled = Object.freeze({
	changedGrounded: false,
	changedOrientation: false,
	changedPosition: false,
	changedVelocity: false,
	anyChanged: false,
});

function applySurfaceNormal(playerState, normal) {
	playerState.grounded = true;
	playerState.surfaceNormal = CloneVector3(normal);
	playerState.alignedUp = CloneVector3(normal);
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
	if (config.Enabled === false) return correctionDisabled;

	if (!groundContact.hit) return resetSurfaceState(playerState);
	if (groundContact.type !== "terrain" && groundContact.type !== "obstacle") return resetSurfaceState(playerState);

	const normal = ResolveVector3Axis(groundContact.normal);
	const previousNormal = ResolveVector3Axis(playerState.surfaceNormal);
	const deltaAngleDegrees = (Math.acos(Clamp(DotVector3(previousNormal, normal), -1, 1)) * 180) / Math.PI;
	if (deltaAngleDegrees > config.MaxDeltaDegrees) return resetSurfaceState(playerState);

	const changedGrounded = !playerState.grounded;
	let changedOrientation = false;
	let changedVelocity = false;

	if (((Math.acos(Clamp(normal.y, -1, 1)) * 180) / Math.PI) < config.MinDeltaDegrees) {
		// Near-flat surface: commit grounded state and real normal for angle tracking,
		// but force alignedUp to worldUp so edge-contact noise never tilts the player.
		changedOrientation = hasMeaningfulVectorDelta(playerState.alignedUp, WORLD_NORMALS.Up);
		playerState.grounded = true;
		playerState.surfaceNormal = CloneVector3(normal);
		playerState.alignedUp = CloneVector3(WORLD_NORMALS.Up);

		if (changedGrounded && playerState.velocity.y < 0) {
			playerState.velocity.y = 0;
			changedVelocity = true;
		}
	} else {
		// Real slope: align to surface and project velocity onto slope plane.
		changedOrientation = hasMeaningfulVectorDelta(playerState.alignedUp, normal);
		applySurfaceNormal(playerState, normal);

		if (changedGrounded && playerState.velocity.y < 0) {
			playerState.velocity.y = 0;
			changedVelocity = true;
		}

		// Project forward velocity onto the surface plane to preserve movement speed on slopes.
		// This creates the illusion of flat-speed movement regardless of incline.
		const vel = playerState.velocity;

		if (Math.sqrt(vel.x * vel.x + vel.z * vel.z) > 0.01 && Math.abs(normal.y) < 0.999) {
			const forwardDir = ResolveVector3Axis({ x: vel.x, y: 0, z: vel.z });
			const projected = ResolveVector3Axis(SubtractVector3(forwardDir, ScaleVector3(normal, DotVector3(forwardDir, normal))));
			const newVelocity = ScaleVector3(projected, Math.sqrt(Vector3Sq(vel)));

			changedVelocity = changedVelocity ||
				hasMeaningfulDelta(vel.x, newVelocity.x) ||
				hasMeaningfulDelta(vel.y, newVelocity.y) ||
				hasMeaningfulDelta(vel.z, newVelocity.z);

			vel.set(newVelocity);
		}

		if (changedOrientation || changedVelocity) {
			Log(
				"ENGINE",
				`Slope correction applied: normal=(${normal.x.toFixed(2)}, ${normal.y.toFixed(2)}, ${normal.z.toFixed(2)}) orientationChanged=${changedOrientation} velocityChanged=${changedVelocity}`,
				"log",
				"Level"
			);
		}
	}

	const anyChanged = changedGrounded || changedOrientation || changedVelocity;
	return { changedGrounded, changedOrientation, changedPosition: false, changedVelocity, anyChanged };
}

function ApplyGroundSnap(playerState, groundContact) {
	const config = CONFIG.PHYSICS.Correction;
	if (!config.Enabled || !groundContact.hit || (groundContact.type !== "terrain" && groundContact.type !== "obstacle")) {
		return correctionDisabled;
	}

	const normal = ResolveVector3Axis(groundContact.normal);
	if (normal.y <= 0.5) return correctionDisabled;

	const desiredPosY = groundContact.supportPoint.y - playerState.collision.profile.bottomOffset.value;
	const deltaY = desiredPosY - playerState.transform.position.y;

	if (Math.abs(deltaY) > config.GroundSnapTolerance) return correctionDisabled;

	const changedPosition = Math.abs(deltaY) > EPSILON;
	if (changedPosition) {
		playerState.transform.position.y = desiredPosY;
		Log("ENGINE", `Ground snap: deltaY=${deltaY.toFixed(4)}`, "log", "Level");
	}

	return {
		changedGrounded: false,
		changedOrientation: false,
		changedPosition,
		changedVelocity: false,
		anyChanged: changedPosition,
	};
}

function ApplyPlayerSurfaceOrientation(playerState) {
	const angles = computeAlignmentAngles(playerState.alignedUp);
	const changedOrientation =
		hasMeaningfulDelta(playerState.transform.rotation.x, angles.pitch) ||
		hasMeaningfulDelta(playerState.transform.rotation.z, angles.roll);

	playerState.transform.rotation.x = angles.pitch;
	playerState.transform.rotation.z = angles.roll;

	return { changedOrientation, anyChanged: changedOrientation };
}

/**
 * Compute rotation values to orient an entity's up-vector toward a target normal.
 * Returns pitch (X) and roll (Z) in radians. Yaw is not affected.
 * @param {{ x, y, z }} surfaceNormal
 * @returns {{ pitch: number, roll: number }}
 */
function computeAlignmentAngles(surfaceNormal) {
	const n = ResolveVector3Axis(surfaceNormal);
	return { pitch: Math.asin(-n.z), roll: Math.asin(n.x) };
}

/* === EXPORTS === */

export {
	ApplySurfaceCorrection,
	ApplyGroundSnap,
	ApplyPlayerSurfaceOrientation,
};
