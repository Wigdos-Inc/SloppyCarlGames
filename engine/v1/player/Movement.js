// Handles character based movement values and applies them to inputs

// Used by player/Master.js to process movement intent each frame.
// Returns modified velocity. Does NOT modify position directly.

import {
	NormalizeVector3,
	NormalizeUnitVector3,
	AddVector3,
	ScaleVector3,
	DotVector3,
	Vector3Length,
} from "../math/Vector3.js";
import { ApplyAcceleration, ApplyDeceleration, ClampVelocity } from "../math/Physics.js";
import { ToNumber } from "../math/Utilities.js";

/**
 * Compute a camera-relative movement direction on the XZ plane (or surface plane).
 * @param {{ forward: number, right: number }} input — normalized -1..1 analog axes.
 * @param {{ forward: { x, y, z }, right: { x, y, z } }} cameraVectors
 * @param {{ x, y, z }} surfaceNormal — current ground normal for surface-projected movement.
 * @returns {{ direction: { x, y, z }, hasInput: boolean }}
 */
function getMovementDirection(input, cameraVectors) {
	const fwd = ToNumber(input.forward, 0);
	const rgt = ToNumber(input.right, 0);

	if (Math.abs(fwd) < 0.001 && Math.abs(rgt) < 0.001) {
		return { direction: { x: 0, y: 0, z: 0 }, hasInput: false };
	}

	// Project camera vectors onto XZ plane so movement is always horizontal-relative.
	const camFwd = { x: cameraVectors.forward.x, y: 0, z: cameraVectors.forward.z };
	const camRight = { x: cameraVectors.right.x, y: 0, z: cameraVectors.right.z };

	let dir = AddVector3(ScaleVector3(camFwd, fwd), ScaleVector3(camRight, rgt));

	const len = Vector3Length(dir);
	if (len < 0.001) {
		return {
			direction: { x: 0, y: 0, z: 0 },
			hasInput: false,
			cameraForward: camFwd,
			cameraRight: camRight,
		};
	}

	dir = NormalizeUnitVector3(dir);
	return { direction: dir, hasInput: true, cameraForward: camFwd, cameraRight: camRight };
}

function getPrimaryOppositeHeld(input, horizontalVelocity, cameraForward, cameraRight) {
	const speed = Vector3Length(horizontalVelocity);
	if (speed < 0.001) return false;

	const velocityDirection = NormalizeUnitVector3(horizontalVelocity);
	const forwardComponent = DotVector3(velocityDirection, cameraForward);
	const rightComponent = DotVector3(velocityDirection, cameraRight);
	const forwardInput = ToNumber(input.forward, 0);
	const rightInput = ToNumber(input.right, 0);

	if (Math.abs(forwardComponent) >= Math.abs(rightComponent)) {
		if (forwardComponent >= 0) return forwardInput < -0.25;
		return forwardInput > 0.25;
	}

	if (rightComponent >= 0) return rightInput < -0.25;
	return rightInput > 0.25;
}

function moveAngleToward(currentAngle, targetAngle, maxStep) {
	const delta = Math.atan2(
		Math.sin(targetAngle - currentAngle),
		Math.cos(targetAngle - currentAngle)
	);
	if (Math.abs(delta) <= maxStep) return targetAngle;
	return currentAngle + Math.sign(delta) * maxStep;
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
	const meta = char.meta;

	// Resolve effective stats (may be modified by boost).
	const boostActive = playerState.boost.active;
	const maxSpeed = ToNumber(meta.maxSpeed, 18) * (boostActive ? ToNumber(playerState.boost.maxSpeedMultiplier, 1) : 1);
	const accel = ToNumber(meta.acceleration, 45) * (boostActive ? ToNumber(playerState.boost.accelMultiplier, 1) : 1);
	const decel = ToNumber(meta.deceleration, 30);
	const jumpForce = ToNumber(meta.jumpForce, 14);
	const stoppingThresholdRatio = ToNumber(meta.stoppingThresholdRatio, 0.35);
	const stoppingThreshold = maxSpeed * stoppingThresholdRatio;

	// Air control modifier.
	let controlMultiplier = 1;
	if (!playerState.grounded) {
		controlMultiplier = playerState.underwater
			? meta.underwaterAirControl
			: meta.airControl;
	}

	const {
		direction,
		hasInput,
		cameraForward,
		cameraRight,
	} = getMovementDirection(input, cameraVectors);

	// Separate horizontal and vertical velocity for movement calculations.
	let hVel = { x: playerState.velocity.x, y: 0, z: playerState.velocity.z };
	const currentHSpeed = Vector3Length(hVel);
	const hasHorizontalVelocity = currentHSpeed > 0.001;
	const velocityDirection = hasHorizontalVelocity ? NormalizeUnitVector3(hVel) : { x: 0, y: 0, z: 0 };
	const reverseIntent = hasInput && hasHorizontalVelocity && DotVector3(velocityDirection, direction) < 0;
	const primaryOppositeHeld = hasInput && getPrimaryOppositeHeld(input, hVel, cameraForward, cameraRight);
	const stopEnter = playerState.grounded && reverseIntent && primaryOppositeHeld && currentHSpeed > stoppingThreshold;
	const stopStay =
		playerState.stoppingActive &&
		playerState.grounded &&
		hasInput &&
		primaryOppositeHeld &&
		currentHSpeed > 0.15 &&
		DotVector3(velocityDirection, direction) < 0.25;

	playerState.stoppingActive = stopEnter || stopStay;
	playerState.primaryOppositeHeld = primaryOppositeHeld;

	if (hasInput) {
		const effectiveAcceleration = accel * controlMultiplier;
		if (playerState.grounded && reverseIntent) {
			const brakingStrength = decel + (effectiveAcceleration * 0.75);
			hVel = ApplyDeceleration(hVel, brakingStrength, dt);

			const postBrakeSpeed = Vector3Length(hVel);
			if (postBrakeSpeed <= stoppingThreshold || !playerState.stoppingActive) {
				hVel = ApplyAcceleration(hVel, direction, effectiveAcceleration, dt);
			}
		} else {
			hVel = ApplyAcceleration(hVel, direction, effectiveAcceleration, dt);
		}
	} else {
		// No input: apply deceleration.
		hVel = ApplyDeceleration(hVel, decel, dt);
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
		playerState.velocity.y = jumpForce;
		playerState.grounded = false;
		const jumpStartY = ToNumber(playerState.transform.position.y, 0);
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
		const targetYaw = Math.atan2(hVel.x, hVel.z);
		const turnRate = ToNumber(meta.momentumTurnRate, 14);
		const maxStep = turnRate * dt;
		const currentYaw = playerState.transform.rotation.y;
		playerState.transform.rotation.y = moveAngleToward(currentYaw, targetYaw, maxStep);
	}
}

/* === EXPORTS === */

export { UpdateMovement };
