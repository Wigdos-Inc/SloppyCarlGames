// Corrects velocity, position, rotation, etc to prevent weird clipping or misalignment.

// Used by physics/Master.js

import { CONFIG } from "../core/config.js";
import { Log, EPSILON } from "../core/meta.js";
import { DotVector3, MultiplyVector3, RotateByEuler, ScaleVector3, SubtractVector3, ResolveVector3Axis, CloneVector3, WORLD_NORMALS } from "../math/Vector3.js";
import { Clamp } from "../math/Utilities.js";

const hasMeaningfulDelta = (currentValue, nextValue) => Math.abs(nextValue - currentValue) > EPSILON;

function hasMeaningfulVectorDelta(currentVector, nextVector) {
	return (
		hasMeaningfulDelta(currentVector.x, nextVector.x) ||
		hasMeaningfulDelta(currentVector.y, nextVector.y) ||
		hasMeaningfulDelta(currentVector.z, nextVector.z)
	);
}

function resetSurfaceState(playerState) {
	const changedOrientation =
		hasMeaningfulVectorDelta(playerState.surfaceNormal, WORLD_NORMALS.Up) ||
		hasMeaningfulVectorDelta(playerState.alignedUp, WORLD_NORMALS.Up);

	const changedGrounded = playerState.grounded;
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

const CORRECTION_DISABLED = Object.freeze({
	changedGrounded: false,
	changedOrientation: false,
	changedPosition: false,
	changedVelocity: false,
	anyChanged: false,
});

const shouldSkipJumpGrounding = (playerState) => playerState.action === "Jumping" && playerState.velocity.y > EPSILON;

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
 * @param {{ surfaceNormal: { x, y, z } }} frameStart — orientation before this frame's corrections.
 */
function ApplySurfaceCorrection(playerState, groundContact, frameStart) {
	if (CONFIG.PHYSICS.Correction.Enabled === false) return CORRECTION_DISABLED;
	if (shouldSkipJumpGrounding(playerState)) return resetSurfaceState(playerState);

	if (!groundContact.hit) return resetSurfaceState(playerState);
	if (groundContact.type !== "terrain" && groundContact.type !== "obstacle") return resetSurfaceState(playerState);

	const normal = ResolveVector3Axis(groundContact.normal);
	// One allowance per frame, from the frame's starting orientation.
	const previousNormal = ResolveVector3Axis(frameStart.surfaceNormal);
	if ((Math.acos(Clamp(DotVector3(previousNormal, normal), -1, 1)) * 180) / Math.PI > CONFIG.PHYSICS.Correction.MaxDeltaDegrees) return resetSurfaceState(playerState);

	const changedGrounded = !playerState.grounded;
	let changedOrientation = false;
	let changedVelocity = false;

	const vel = playerState.velocity;
	const intoSurface = DotVector3(normal, vel);

	if (intoSurface < 0) {
		// Removes only the into-surface component.
		const newVelocity = SubtractVector3(vel, ScaleVector3(normal, intoSurface));

		changedVelocity =
			hasMeaningfulDelta(vel.x, newVelocity.x) ||
			hasMeaningfulDelta(vel.y, newVelocity.y) ||
			hasMeaningfulDelta(vel.z, newVelocity.z);

		vel.set(newVelocity);
	}

	if (((Math.acos(Clamp(normal.y, -1, 1)) * 180) / Math.PI) < CONFIG.PHYSICS.Correction.MinDeltaDegrees) {
		// Near-flat surface: commit grounded state and real normal for angle tracking,
		// but force alignedUp to worldUp so edge-contact noise never tilts the player.
		changedOrientation = hasMeaningfulVectorDelta(playerState.alignedUp, WORLD_NORMALS.Up);
		playerState.grounded = true;
		playerState.surfaceNormal = CloneVector3(normal);
		playerState.alignedUp = CloneVector3(WORLD_NORMALS.Up);
	} 
	else {
		// Real slope: align to the surface.
		changedOrientation = hasMeaningfulVectorDelta(playerState.alignedUp, normal);
		applySurfaceNormal(playerState, normal);

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

function ApplyGroundSnap(playerState, groundContact, groundSnapTolerance) {
	if (CONFIG.PHYSICS.Correction.Enabled === false || !playerState.grounded)  return CORRECTION_DISABLED;
	if (groundContact.type !== "terrain" && groundContact.type !== "obstacle") return CORRECTION_DISABLED;
	if (ResolveVector3Axis(groundContact.normal).y <= 0.5) return CORRECTION_DISABLED;

	// Vertical offset that seats the capsule.
	const deltaY = groundContact.restDeltaY;
	if (Math.abs(deltaY) > groundSnapTolerance) return CORRECTION_DISABLED;

	const changedPosition = Math.abs(deltaY) > EPSILON;
	if (changedPosition) {
		playerState.transform.position.y += deltaY;
		Log("ENGINE", `Ground snap: deltaY=${deltaY.toFixed(4)}`, "log", "Level");
	}

	return {
		changedGrounded: false, changedOrientation: false, changedPosition, changedVelocity: false, 
		anyChanged: changedPosition,
	};
}

function ApplyPlayerSurfaceOrientation(playerState) {
	const rotation = playerState.transform.rotation;
	const angles = computeAlignmentAngles(playerState.alignedUp, rotation.y);
	const changedOrientation =
		hasMeaningfulDelta(rotation.x, angles.pitch) ||
		hasMeaningfulDelta(rotation.z, angles.roll);

	if (changedOrientation === false) return { changedOrientation, anyChanged: false };

	// Pivot about the contact cap, not the transform origin.
	const anchor = MultiplyVector3(playerState.collision.rest.groundCapsule.segmentStart, playerState.transform.scale);
	const before = RotateByEuler(anchor, rotation);

	rotation.x = angles.pitch;
	rotation.z = angles.roll;

	playerState.transform.position.add(SubtractVector3(before, RotateByEuler(anchor, rotation)));

	return { changedOrientation, anyChanged: changedOrientation };
}

/**
 * Compute rotation values to orient an entity's up-vector toward a target normal.
 * Returns pitch (X) and roll (Z) in radians, solved in the entity's yawed frame.
 * Matches CreateModelMatrix's Ry·Rx·Rz composition. Yaw is not affected.
 * @param {{ x, y, z }} surfaceNormal
 * @param {number} yaw — the entity's Y rotation in radians.
 * @returns {{ pitch: number, roll: number }}
 */
function computeAlignmentAngles(surfaceNormal, yaw) {
	const n = ResolveVector3Axis(surfaceNormal);
	const cosYaw = Math.cos(yaw);
	const sinYaw = Math.sin(yaw);
	const localX = (n.x * cosYaw) - (n.z * sinYaw);
	const localZ = (n.x * sinYaw) + (n.z * cosYaw);
	return { pitch: Math.atan2(localZ, n.y), roll: Math.asin(Clamp(-localX, -1, 1)) };
}

/* === EXPORTS === */

export { ApplySurfaceCorrection, ApplyGroundSnap, ApplyPlayerSurfaceOrientation, CORRECTION_DISABLED };
