// Handles character based movement values and applies them to inputs

// Used by player/Master.js to process movement intent each frame.
// Returns modified velocity. Does NOT modify position directly.

import {
	NormalizeVector3,
	NormalizeUnitVector3,
	AddVector3,
	SubtractVector3,
	ScaleVector3,
	CrossVector3,
	DotVector3,
	Vector3Length,
} from "../math/Vector3.js";
import { ApplyAcceleration, ApplyDeceleration, ClampVelocity, ProjectOntoPlane } from "../math/Physics.js";
import { ToNumber } from "../math/Utilities.js";

/**
 * Compute a camera-relative movement direction on the XZ plane (or surface plane).
 * @param {{ forward: number, right: number }} input — normalized -1..1 analog axes.
 * @param {{ forward: { x, y, z }, right: { x, y, z } }} cameraVectors
 * @param {{ x, y, z }} surfaceNormal — current ground normal for surface-projected movement.
 * @returns {{ direction: { x, y, z }, hasInput: boolean }}
 */
function getMovementDirection(input, cameraVectors, surfaceNormal) {
	const fwd = ToNumber(input && input.forward, 0);
	const rgt = ToNumber(input && input.right, 0);

	if (Math.abs(fwd) < 0.001 && Math.abs(rgt) < 0.001) {
		return { direction: { x: 0, y: 0, z: 0 }, hasInput: false };
	}

	// Project camera vectors onto XZ plane so movement is always horizontal-relative.
	const camFwd = cameraVectors && cameraVectors.forward
		? NormalizeUnitVector3({ x: cameraVectors.forward.x, y: 0, z: cameraVectors.forward.z })
		: { x: 0, y: 0, z: -1 };
	const camRight = cameraVectors && cameraVectors.right
		? NormalizeUnitVector3({ x: cameraVectors.right.x, y: 0, z: cameraVectors.right.z })
		: { x: 1, y: 0, z: 0 };

	let dir = AddVector3(
		ScaleVector3(camFwd, fwd),
		ScaleVector3(camRight, rgt)
	);

	const len = Vector3Length(dir);
	if (len < 0.001) {
		return { direction: { x: 0, y: 0, z: 0 }, hasInput: false };
	}

	dir = NormalizeUnitVector3(dir);
	return { direction: dir, hasInput: true };
}

/**
 * Update player velocity based on input, character stats, and movement context.
 * Does NOT modify position. Position is applied later after physics.
 *
 * @param {object} playerState — full mutable player state.
 * @param {object} input — { forward, right, jump, boost }
 * @param {{ forward, right }} cameraVectors — projected camera orientation.
 * @param {number} deltaSeconds
 */
function UpdateMovement(playerState, input, cameraVectors, deltaSeconds) {
	const dt = ToNumber(deltaSeconds, 0);
	const char = playerState.character;
	const meta = char && char.meta ? char.meta : {};

	// Resolve effective stats (may be modified by boost).
	const boostActive = playerState.boost && playerState.boost.active;
	const maxSpeed = ToNumber(meta.maxSpeed, 18) * (boostActive ? ToNumber(playerState.boost.maxSpeedMultiplier, 1) : 1);
	const accel = ToNumber(meta.acceleration, 45) * (boostActive ? ToNumber(playerState.boost.accelMultiplier, 1) : 1);
	const decel = ToNumber(meta.deceleration, 30);
	const jumpForce = ToNumber(meta.jumpForce, 14);

	// Air control modifier.
	let controlMultiplier = 1;
	if (!playerState.grounded) {
		controlMultiplier = playerState.underwater
			? ToNumber(meta.underwaterAirControl, 0.7)
			: ToNumber(meta.airControl, 0.4);
	}

	const surfaceNormal = NormalizeVector3(playerState.surfaceNormal, { x: 0, y: 1, z: 0 });
	const { direction, hasInput } = getMovementDirection(input, cameraVectors, surfaceNormal);

	// Separate horizontal and vertical velocity for movement calculations.
	let hVel = { x: playerState.velocity.x, y: 0, z: playerState.velocity.z };
	let vVel = playerState.velocity.y;

	if (hasInput) {
		// Accelerate in the desired direction.
		hVel = ApplyAcceleration(hVel, direction, accel * controlMultiplier, dt);

		// Preserve momentum uphill: when grounded and moving, ensure horizontal
		// speed is not reduced by slope physics. The illusion: speed feels flat.
		// This is handled by not allowing horizontal speed to drop below current
		// magnitude when the player is actively providing input and grounded.
		const currentHSpeed = Vector3Length({ x: playerState.velocity.x, y: 0, z: playerState.velocity.z });
		const newHSpeed = Vector3Length(hVel);
		if (playerState.grounded && newHSpeed < currentHSpeed && currentHSpeed <= maxSpeed) {
			// Maintain the speed magnitude, just update direction.
			const blendDir = NormalizeUnitVector3(hVel);
			if (Vector3Length(blendDir) > 0.001) {
				hVel = ScaleVector3(blendDir, Math.max(newHSpeed, currentHSpeed));
			}
		}
	} else {
		// No input: apply deceleration.
		hVel = ApplyDeceleration(hVel, decel, dt);
	}

	// Clamp horizontal speed.
	hVel = ClampVelocity(hVel, maxSpeed);

	// Reassemble velocity.
	playerState.velocity.x = hVel.x;
	playerState.velocity.z = hVel.z;
	// Vertical velocity is preserved (physics handles gravity).

	// === JUMP ===
	if (input && input.jump && playerState.grounded && playerState.state !== "Stunned" && playerState.state !== "Dead") {
		playerState.velocity.y = jumpForce;
		playerState.grounded = false;
		const jumpStartY = ToNumber(playerState.transform.position.y, 0);
		// Player jump Y values are Unit instances—mutate their `.value`.
		playerState.jumpStartY.value = jumpStartY;
		playerState.jumpApexY.value = jumpStartY;
		playerState.previousState = playerState.state;
		playerState.state = "Jumping";
	}

	// === FACE MOVEMENT DIRECTION ===
	// Rotate player yaw toward movement direction (no camera-lock on model).
	if (hasInput) {
		const targetYaw = Math.atan2(direction.x, direction.z);
		playerState.transform.rotation.y = targetYaw;
	}
}

/* === EXPORTS === */

export { UpdateMovement };
