// Handles character based movement values and applies them to inputs

// Used by player/Master.js to process movement intent each frame.
// Returns modified velocity. Does NOT modify position directly.

import { CONFIG } from "../core/config.js";
import { Log, SendEvent } from "../core/meta.js";
import {
	CloneVector3,
	ResolveVector3Axis,
	AddVector3,
	ScaleVector3,
	DotVector3,
	Vector3Length,
	ToVector3,
} from "../math/Vector3.js";
import { ApplyAcceleration, ApplyDeceleration, ClampVelocity } from "../math/Collision.js";
import { ComputeStepVelocity } from "../math/Forces.js";

const jumpVelocityCache = { jumpHeight: -1, medium: "", floatiness: -1, v0: 0 };

function solveJumpLaunchVelocity(jumpHeight, medium, floatiness) {
	if (
		jumpVelocityCache.jumpHeight === jumpHeight &&
		jumpVelocityCache.medium === medium &&
		jumpVelocityCache.floatiness === floatiness
	) return jumpVelocityCache.v0;

	const buoyancyEnabled = medium === "water" && CONFIG.PHYSICS.Buoyancy.Enabled !== false;
	const simDt = 1 / 240;
	const simSubmergence = medium === "water" ? 1 : 0;
	const simForces = {
		gravity: true,
		resistance: { submergence: simSubmergence },
		...(buoyancyEnabled ? { buoyancy: { position: { y: 0 }, waterLevel: { value: 0 }, submergence: 1 } } : {}),
	};

	const simApex = (v0) => {
		let vy = v0;
		let y = 0;
		for (let step = 0; step < 10000; step++) {
			vy = ComputeStepVelocity.scalar(vy, simForces, simDt, { flag: true, floatiness });
			if (vy <= 0) break;
			y += vy * simDt;
		}
		return y;
	};

	let lo = 0;
	let hi = jumpHeight * 10 + 10;
	for (let iter = 0; iter < 64; iter++) {
		const mid = (lo + hi) * 0.5;
		if (simApex(mid) < jumpHeight) lo = mid;
		else hi = mid;
	}

	const v0 = (lo + hi) * 0.5;
	jumpVelocityCache.jumpHeight = jumpHeight;
	jumpVelocityCache.medium = medium;
	jumpVelocityCache.floatiness = floatiness;
	jumpVelocityCache.v0 = v0;
	return v0;
}

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
	const maxSpeed = meta.maxSpeed * (playerState.boost.active ? playerState.boost.maxSpeedMultiplier : 1);
	const accel = meta.acceleration * (playerState.boost.active ? playerState.boost.accelMultiplier : 1);
	const decel = meta.deceleration;
	const stoppingThreshold = maxSpeed * meta.stoppingThresholdRatio;

	// Separate horizontal and vertical velocity for movement calculations.
	let hVel = playerState.velocity.clone(); hVel.y = 0;
	const currentHSpeed = Vector3Length(hVel);
	const velocityDirection = currentHSpeed > 0.001 ? ResolveVector3Axis(hVel) : ToVector3(0);
	const reverseIntent = hasInput && currentHSpeed > 0.001 && DotVector3(velocityDirection, direction) < 0;
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
			hVel = ApplyDeceleration(hVel, decel + (effectiveAcceleration * 0.75), deltaSeconds);

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
		playerState.velocity.y = solveJumpLaunchVelocity(
			meta.jumpHeight.value, 
			playerState.underwater ? "water" : "air", 
			playerState.underwater ? meta.waterFloatiness : meta.airFloatiness
		);
		playerState.grounded = false;
		
		// Player jump Y values are Unit instances—mutate their `.value`.
		playerState.jumpApexY.value = playerState.transform.position.y;
		playerState.previousState = playerState.state;
		playerState.state = "Jumping";
		Log("ENGINE", `Player state: ${playerState.previousState} → Jumping`, "log", "Player");
		if (playerState.customEvents.stateChange && CONFIG.CUSTOM_EVENTS.Entities.stateChange) {
			SendEvent("PLAYER_STATE_CHANGE", {
				id      : playerState.id,
				type    : playerState.type,
				position: CloneVector3(playerState.transform.position),
				velocity: CloneVector3(playerState.velocity),
				from    : playerState.previousState,
				to      : "Jumping",
			});
		}
	}

	// === FACE MOMENTUM DIRECTION ===
	// Yaw follows horizontal momentum so turn orientation feels fluid.
	if (Vector3Length(hVel) > 0.05) {
		playerState.transform.rotation.y = moveAngleToward(
			playerState.transform.rotation.y, 
			Math.atan2(hVel.x, hVel.z), 
			meta.momentumTurnRate * deltaSeconds
		);
	}
}

/* === EXPORTS === */

export { UpdateMovement };
