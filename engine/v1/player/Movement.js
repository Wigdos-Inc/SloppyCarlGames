// Handles character based movement values and applies them to inputs

// Used by player/Master.js to process movement intent each frame.
// Returns modified velocity. Does NOT modify position directly.

import {
	ResolveVector3Axis,
	AddVector3,
	ScaleVector3,
	DotVector3,
	Vector3Length,
	ToVector3,
} from "../math/Vector3.js";
import { ApplyAcceleration, ApplyDeceleration, ClampVelocity } from "../math/Physics.js";

/**
 * Compute a camera-relative movement direction on the XZ plane (or surface plane).
 * @param {{ forward: number, right: number }} input — normalized -1..1 analog axes.
 * @param {{ forward: { x, y, z }, right: { x, y, z } }} cameraVectors
 * @param {{ x, y, z }} surfaceNormal — current ground normal for surface-projected movement.
 * @returns {{ direction: { x, y, z }, hasInput: boolean }}
 */
function getMovementDirection(input, cameraVectors) {
	if (Math.abs(input.forward) < 0.001 && Math.abs(input.right) < 0.001) {
		return { direction: ToVector3(0), hasInput: false };
	}

	// Project camera vectors onto XZ plane so movement is always horizontal-relative.
	const camFwd = { x: cameraVectors.forward.x, y: 0, z: cameraVectors.forward.z };
	const camRight = { x: cameraVectors.right.x, y: 0, z: cameraVectors.right.z };

	let dir = AddVector3(ScaleVector3(camFwd, input.forward), ScaleVector3(camRight, input.right));

	const len = Vector3Length(dir);
	if (len < 0.001) {
		return {
			direction: ToVector3(0),
			hasInput: false,
			cameraForward: camFwd,
			cameraRight: camRight,
		};
	}

	dir = ResolveVector3Axis(dir);
	return { direction: dir, hasInput: true, cameraForward: camFwd, cameraRight: camRight };
}

function getPrimaryOppositeHeld(input, horizontalVelocity, cameraForward, cameraRight) {
	const speed = Vector3Length(horizontalVelocity);
	if (speed < 0.001) return false;

	const velocityDirection = ResolveVector3Axis(horizontalVelocity);
	const forwardComponent = DotVector3(velocityDirection, cameraForward);
	const rightComponent = DotVector3(velocityDirection, cameraRight);
	
	if (Math.abs(forwardComponent) >= Math.abs(rightComponent)) {
		if (forwardComponent >= 0) return input.forward < -0.25;
		else return input.forward > 0.25;
	}

	if (rightComponent >= 0) return input.right < -0.25;
	else return input.right > 0.25;
}

function moveAngleToward(currentAngle, targetAngle, maxStep) {
	const delta = Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle));
	if (Math.abs(delta) <= maxStep) return targetAngle;
	else return currentAngle + Math.sign(delta) * maxStep;
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
	const meta = playerState.character.meta;

	// Air control modifier.
	let controlMultiplier = 1;
	if (!playerState.grounded) {
		controlMultiplier = playerState.underwater
			? meta.underwaterAirControl
			: meta.airControl;
	}

	const { direction, hasInput, cameraForward, cameraRight } = getMovementDirection(input, cameraVectors);

	// Resolve effective stats (may be modified by boost).
	const boostActive = playerState.boost.active;
	const maxSpeed = meta.maxSpeed * (boostActive ? playerState.boost.maxSpeedMultiplier : 1);
	const accel = meta.acceleration * (boostActive ? playerState.boost.accelMultiplier : 1);
	const decel = meta.deceleration;
	const stoppingThreshold = maxSpeed * meta.stoppingThresholdRatio;

	// Separate horizontal and vertical velocity for movement calculations.
	let hVel = playerState.velocity.clone(); hVel.y = 0;
	const currentHSpeed = Vector3Length(hVel);
	const hasHorizontalVelocity = currentHSpeed > 0.001;
	const velocityDirection = hasHorizontalVelocity ? ResolveVector3Axis(hVel) : ToVector3(0);
	const reverseIntent = hasInput && hasHorizontalVelocity && DotVector3(velocityDirection, direction) < 0;
	const primaryOppositeHeld = hasInput && getPrimaryOppositeHeld(input, hVel, cameraForward, cameraRight);
	
	playerState.stoppingActive = 
		(playerState.grounded && reverseIntent && primaryOppositeHeld && currentHSpeed > stoppingThreshold) ||
		(
			playerState.stoppingActive &&
			playerState.grounded &&
			hasInput &&
			primaryOppositeHeld &&
			currentHSpeed > 0.15 &&
			DotVector3(velocityDirection, direction) < 0.25
		);
	playerState.primaryOppositeHeld = primaryOppositeHeld;

	if (hasInput) {
		const effectiveAcceleration = accel * controlMultiplier;
		if (playerState.grounded && reverseIntent) {
			const brakingStrength = decel + (effectiveAcceleration * 0.75);
			hVel = ApplyDeceleration(hVel, brakingStrength, deltaSeconds);

			const postBrakeSpeed = Vector3Length(hVel);
			if (postBrakeSpeed <= stoppingThreshold || !playerState.stoppingActive) {
				hVel = ApplyAcceleration(hVel, direction, effectiveAcceleration, deltaSeconds);
			}
		} 
		else hVel = ApplyAcceleration(hVel, direction, effectiveAcceleration, deltaSeconds);
	} 
	else {
		// No input: apply deceleration.
		hVel = ApplyDeceleration(hVel, decel, deltaSeconds);
		playerState.stoppingActive = false;
		playerState.primaryOppositeHeld = false;
	}

	// Clamp horizontal speed.
	hVel = ClampVelocity(hVel, maxSpeed);

	// Reassemble velocity.
	playerState.velocity.x = hVel.x;
	playerState.velocity.z = hVel.z;
	// Vertical velocity is preserved (physics handles gravity).

	// === JUMP ===
	if (
		input.jump && 
		playerState.grounded && 
		playerState.state !== "Stunned" && 
		playerState.state !== "Dead"
	) {
		playerState.velocity.y = meta.jumpForce;
		playerState.grounded = false;
		const jumpStartY = playerState.transform.position.y;
		// Player jump Y values are Unit instances—mutate their `.value`.
		playerState.jumpStartY.value = jumpStartY;
		playerState.jumpApexY.value = jumpStartY;
		playerState.previousState = playerState.state;
		playerState.state = "Jumping";
	}

	// === FACE MOMENTUM DIRECTION ===
	// Yaw follows horizontal momentum so turn orientation feels fluid.
	const horizontalSpeed = Vector3Length(hVel);
	if (horizontalSpeed > 0.05) {
		playerState.transform.rotation.y = moveAngleToward(
			playerState.transform.rotation.y, 
			Math.atan2(hVel.x, hVel.z), 
			meta.momentumTurnRate * deltaSeconds
		);
	}
}

/* === EXPORTS === */

export { UpdateMovement };
