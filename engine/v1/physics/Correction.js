// Corrects velocity, position, rotation, etc to prevent weird clipping or misalignment.

// Used by handlers/game/Physics.js

import { CONFIG } from "../core/config.js";
import {
	NormalizeVector3,
	DotVector3,
	SubtractVector3,
	ScaleVector3,
	NormalizeUnitVector3,
} from "../math/Vector3.js";
import { Clamp, ToNumber } from "../math/Utilities.js";

const DEFAULT_MAX_SURFACE_DELTA_DEGREES = 35;
const DEFAULT_GROUND_SNAP_TOLERANCE = 0.12;

/**
 * Post-collision surface alignment for Sonic-style slope running.
 * Aligns the player "up" vector to the surface normal,
 * corrects vertical position for foot contact,
 * and projects forward velocity onto the surface plane.
 *
 * @param {object} playerState — full mutable player state.
 * @param {{ hit: boolean, normal: { x, y, z } }} groundContact — from collision resolution.
 * @param {number} deltaSeconds
 */
function ApplySurfaceAlignment(playerState, groundContact, deltaSeconds) {
	const config = CONFIG.PHYSICS.Correction;
	if (config.Enabled === false) {
		return;
	}

	if (!playerState) {
		return;
	}

	if (!groundContact || !groundContact.hit) {
		playerState.grounded = false;
		return;
	}

	const contactType = typeof groundContact.type === "string" ? groundContact.type : "";
	const validGroundType = contactType === "terrain" || contactType === "obstacle";
	if (!validGroundType) {
		playerState.grounded = false;
		return;
	}

	const normal = NormalizeUnitVector3(NormalizeVector3(groundContact.normal, { x: 0, y: 1, z: 0 }));
	const previousNormal = NormalizeUnitVector3(
		NormalizeVector3(playerState.surfaceNormal, { x: 0, y: 1, z: 0 })
	);
	const maxSurfaceDeltaDegrees = ToNumber(
		config.MaxSurfaceDeltaDegrees,
		DEFAULT_MAX_SURFACE_DELTA_DEGREES
	);
	const normalDot = Clamp(DotVector3(previousNormal, normal), -1, 1);
	const deltaAngleDegrees = (Math.acos(normalDot) * 180) / Math.PI;

	if (deltaAngleDegrees > maxSurfaceDeltaDegrees) {
		playerState.grounded = false;
		return;
	}

	playerState.grounded = true;
	playerState.surfaceNormal = { x: normal.x, y: normal.y, z: normal.z };

	// Snap tiny residual hover gaps to the contacted surface top.
	// Swept resolution can leave a small separation when grounded.
	if (
		playerState.transform &&
		playerState.transform.position &&
		playerState.collision &&
		playerState.collision.aabb &&
		groundContact.targetAabb &&
		normal.y > 0.5
	) {
		const entityAabb = playerState.collision.aabb;
		const currentPosY = ToNumber(playerState.transform.position.y, 0);
		const centerY = (ToNumber(entityAabb.min.y, 0) + ToNumber(entityAabb.max.y, 0)) * 0.5;
		const halfY = (ToNumber(entityAabb.max.y, 0) - ToNumber(entityAabb.min.y, 0)) * 0.5;
		const bottomOffsetFromTransform = (centerY - currentPosY) - halfY;
		const desiredPosY = ToNumber(groundContact.targetAabb.max.y, currentPosY) - bottomOffsetFromTransform;
		const deltaY = desiredPosY - currentPosY;
		const snapTolerance = ToNumber(config.GroundSnapTolerance, DEFAULT_GROUND_SNAP_TOLERANCE);

		if (Math.abs(deltaY) <= snapTolerance) {
			playerState.transform.position.y = desiredPosY;
		}
	}

	// Correct vertical velocity: remove downward component upon ground contact.
	if (playerState.velocity.y < 0) {
		playerState.velocity.y = 0;
	}

	// Project forward velocity onto the surface plane to preserve movement speed on slopes.
	// This creates the illusion of flat-speed movement regardless of incline.
	const vel = playerState.velocity;
	const horizontalSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

	if (horizontalSpeed > 0.01 && Math.abs(normal.y) < 0.999) {
		// Compute forward direction from horizontal velocity.
		const forwardDir = NormalizeUnitVector3({ x: vel.x, y: 0, z: vel.z });

		// Project forward onto the surface plane.
		const dot = DotVector3(forwardDir, normal);
		const projected = NormalizeUnitVector3(SubtractVector3(forwardDir, ScaleVector3(normal, dot)));

		// Scale projected direction to maintain original horizontal speed.
		playerState.velocity.x = projected.x * horizontalSpeed;
		playerState.velocity.z = projected.z * horizontalSpeed;

		// Adjust vertical velocity to follow slope naturally.
		playerState.velocity.y = projected.y * horizontalSpeed;
	}

	// Align player rotation to surface.
	// Store the target up-vector; animation systems will interpolate toward it.
	playerState.alignedUp = { x: normal.x, y: normal.y, z: normal.z };
}

/**
 * Compute rotation values to orient an entity's up-vector toward a target normal.
 * Returns pitch (X) and roll (Z) in radians. Yaw is not affected.
 * @param {{ x, y, z }} surfaceNormal
 * @returns {{ pitch: number, roll: number }}
 */
function ComputeAlignmentAngles(surfaceNormal) {
	const n = NormalizeUnitVector3(NormalizeVector3(surfaceNormal, { x: 0, y: 1, z: 0 }));
	return {
		pitch: Math.asin(-n.z),
		roll: Math.asin(n.x),
	};
}

/* === EXPORTS === */

export { ApplySurfaceAlignment, ComputeAlignmentAngles };
