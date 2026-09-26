// Handles character based movement values and applies them to inputs

// Used by player/Master.js to process movement intent each frame.
// Returns modified velocity. Does NOT modify position directly.

import { CONFIG, GROUNDING } from "../core/config.js";
import { EPSILON } from "../core/meta.js";
import {
	ResolveVector3Axis,
	AddVector3,
	SubtractVector3,
	ScaleVector3,
	CrossVector3,
	DotVector3,
	RotateByEuler,
	RotateTowardVector3,
	Vector3Length,
	ToVector3,
	WORLD_NORMALS,
} from "../math/Vector3.js";
import { ApplyAcceleration, ApplyDeceleration, ClampVelocity, ProjectOntoPlane } from "../math/Collision.js";
import { ComputeStepVelocity } from "../math/Forces.js";
import { SetPlayerAction, ConsumeJumpPress } from "./Master.js";

const jumpVelocityCache = { jumpHeight: -1, medium: "", floatiness: -1, v0: 0 };

function solveJumpLaunchVelocity(jumpHeight, medium, floatiness) {
	if (
		jumpVelocityCache.jumpHeight === jumpHeight &&
		jumpVelocityCache.medium === medium &&
		jumpVelocityCache.floatiness === floatiness
	) {
		return jumpVelocityCache.v0;
	}

	const buoyancyEnabled = medium === "water" && CONFIG.PHYSICS.Buoyancy.Enabled !== false;
	const simDt = 1 / 240;
	const simForces = {
		gravity: true,
		resistance: { submergence: medium === "water" ? 1 : 0 },
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

// Below this a projected tangent vector carries no usable heading.
const minTangent = 0.05;

// Friction floor. Engages past 75.5°, so no ordinary slope changes.
const minSupport = 0.25;

const noCoyoteActions = new Set(["Jumping", "Flying", "Swimming"]);

// Minimal rotation carrying `from` onto `to`, applied to `v`. Unlike projection, keeps the heading's angle to the fold.
function transportAcross(v, from, to) {
	const axis = CrossVector3(from, to);
	const cos = DotVector3(from, to);
	return AddVector3(AddVector3(ScaleVector3(v, cos), CrossVector3(axis, v)), ScaleVector3(axis, DotVector3(axis, v) / (1 + cos)));
}

/**
 * Steers the carried tangent by camera yaw delta and re-projects; reseeds from the camera
 * on press, on a grounding change, and on collapse.
 * @param {object} frame — `playerState.inputFrame`.
 * @param {{ x, y, z }} camFwd — camera forward flattened to XZ.
 * @param {number} cameraYaw — radians, `atan2(x, z)` convention.
 * @param {{ x, y, z }} up — surface-aligned up.
 * @returns {{ x: number, y: number, z: number }} — unit, in the surface plane.
 */
function advanceCarriedForward(frame, camFwd, cameraYaw, up, grounded) {
	// A half-turn flip of up has no unique transport; reseed instead.
	if (frame.previousHasInput && grounded === frame.previousGrounded && DotVector3(frame.previousUp, up) > EPSILON - 1) {
		const raw = cameraYaw - frame.previousCameraYaw;
		const yawDelta = Math.atan2(Math.sin(raw), Math.cos(raw));
		const carried = transportAcross(frame.carriedForward, frame.previousUp, up);
		const transported = ProjectOntoPlane(RotateByEuler(carried, { x: 0, y: yawDelta, z: 0 }), up);
		if (Vector3Length(transported) >= minTangent) return ResolveVector3Axis(transported);
	}

	// Seed: camera XZ on the surface plane, pulled uphill by incline and by how far the camera faces into it.
	const uphill = ProjectOntoPlane(WORLD_NORMALS.Up, up);
	const uphillWeight = (1 - Math.abs(up.y)) * -DotVector3(camFwd, up);
	return ResolveVector3Axis(AddVector3(ProjectOntoPlane(camFwd, up), ScaleVector3(uphill, uphillWeight)));
}

/**
 * Movement direction from the carried tangent frame.
 * @param {{ forward: number, right: number }} input — normalized -1..1 analog axes.
 * @returns {{ direction, tangentDirection }} — `direction` is the XZ shadow the flat latch checks use.
 */
function getMovementDirection(playerState, input, camFwd, cameraYaw, up) {
	const carried = advanceCarriedForward(playerState.inputFrame, camFwd, cameraYaw, up, playerState.grounded);
	playerState.inputFrame.carriedForward = carried;

	// Handedness matches Camera.js's cross(forward, up), NOT Correction.js's model basis.
	const tangentDirection = ResolveVector3Axis(AddVector3(
		ScaleVector3(carried, input.forward),
		ScaleVector3(CrossVector3(carried, up), input.right),
	));

	const shadow = { x: tangentDirection.x, y: 0, z: tangentDirection.z };
	return {
		direction: Vector3Length(shadow) < 0.001 ? ToVector3(0) : ResolveVector3Axis(shadow),
		tangentDirection,
	};
}

function getPrimaryOppositeHeld(input, horizontalVelocity, cameraForward, cameraRight) {
	if (Vector3Length(horizontalVelocity) < 0.001) return false;

	const velocityDirection = ResolveVector3Axis(horizontalVelocity);
	const forwardComponent = DotVector3(velocityDirection, cameraForward);
	const rightComponent = DotVector3(velocityDirection, cameraRight);
	
	return Math.abs(forwardComponent) >= Math.abs(rightComponent)
		? forwardComponent >= 0 ? input.forward < -0.25 : input.forward > 0.25
		: rightComponent   >= 0 ? input.right   < -0.2  : input.right   > 0.25;
}

/**
 * Rate-limit the world-space heading toward `target` within the surface plane.
 * @param {{ x, y, z }} target — unit travel direction, already in the plane of `up`.
 */
function turnFacingToward(playerState, target, maxStep) {
	const planar = ProjectOntoPlane(playerState.facing, playerState.alignedUp);

	// Facing collapsed onto the new normal — no angle left to limit against.
	if (Vector3Length(planar) < minTangent) {
		playerState.facing = target;
		return;
	}

	playerState.facing = RotateTowardVector3(ResolveVector3Axis(planar), target, maxStep);
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

	const onSlidingSurface = playerState.surfaceContact === "sliding";
	const up = playerState.alignedUp;
	// cos(incline), floored: a wall must still brake, an overhang must not accelerate.
	const support = Math.max(Math.abs(up.y), minSupport);

	// Camera basis flattened to XZ; yaw is read here so it stays available with no input.
	const camFwd   = ResolveVector3Axis({ x: cameraVectors.forward.x, y: 0, z: cameraVectors.forward.z });
	const camRight = { x: cameraVectors.right.x,   y: 0, z: cameraVectors.right.z   };
	const cameraYaw = Math.atan2(camFwd.x, camFwd.z);

	const hasInput = Math.abs(input.forward) >= 0.001 || Math.abs(input.right) >= 0.001;
	const { direction, tangentDirection } = hasInput
		? getMovementDirection(playerState, input, camFwd, cameraYaw, up)
		: { direction: ToVector3(0), tangentDirection: ToVector3(0) };

	// Resolve effective stats.
	const maxSpeed = meta.maxSpeed     * (playerState.boost.active ? playerState.boost.maxSpeedMultiplier : 1);
	const accel    = meta.acceleration * (playerState.boost.active ? playerState.boost.accelMultiplier    : 1);
	const stoppingThreshold = maxSpeed * meta.stoppingThresholdRatio;

	// Normal/tangent split — movement acts on the tangent.
	const normalVelocity = ScaleVector3(up, DotVector3(playerState.velocity, up));
	let tVel = SubtractVector3(playerState.velocity, normalVelocity);

	// XZ shadow — the latch thresholds and camera basis are flat.
	const hVel = { x: tVel.x, y: 0, z: tVel.z };
	const currentHSpeed = Vector3Length(hVel);
	const velocityDirection = currentHSpeed > 0.001 ? ResolveVector3Axis(hVel) : ToVector3(0);
	const reverseIntent = hasInput && currentHSpeed > 0.001 && DotVector3(velocityDirection, direction) < 0;
	const primaryOppositeHeld = hasInput && getPrimaryOppositeHeld(input, hVel, camFwd, camRight);
	
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
		// Uphill input damped on a slide.
		const along = DotVector3(tangentDirection, ProjectOntoPlane(WORLD_NORMALS.Down, up));
		const slideScale = onSlidingSurface && along < 0 ? 0.15 : 1;
		const effectiveAcceleration = accel * controlMultiplier * slideScale;
		if (playerState.grounded && reverseIntent) {
			tVel = ApplyDeceleration(tVel, (meta.deceleration + (effectiveAcceleration * 0.75)) * support, deltaSeconds);
			if (Vector3Length(tVel) <= stoppingThreshold || !playerState.stoppingActive) {
				tVel = ApplyAcceleration(tVel, tangentDirection, effectiveAcceleration, deltaSeconds);
			}
		}
		else tVel = ApplyAcceleration(tVel, tangentDirection, effectiveAcceleration, deltaSeconds);
	}
	else {
		// No input: deceleration scaled by surface support and air control.
		tVel = ApplyDeceleration(tVel, meta.deceleration * support * controlMultiplier, deltaSeconds);
		playerState.stoppingActive = false;
		playerState.primaryOppositeHeld = false;
	}

	// Clamp tangent speed.
	tVel = ClampVelocity(tVel, maxSpeed);

	// Reassemble; normal component preserved.
	playerState.velocity.set(AddVector3(normalVelocity, tVel));

	// === JUMP ===
	const jumpWindow = playerState.jumpWindow;
	if (ConsumeJumpPress()) jumpWindow.buffer = GROUNDING.JumpBufferSeconds;
	else jumpWindow.buffer -= deltaSeconds;

	const leftGround = playerState.inputFrame.previousGrounded && !playerState.grounded;
	if (leftGround && !noCoyoteActions.has(playerState.action)) jumpWindow.coyote = GROUNDING.CoyoteSeconds;
	else jumpWindow.coyote -= deltaSeconds;

	if (
		jumpWindow.buffer > 0 &&
		(playerState.grounded || onSlidingSurface || jumpWindow.coyote > 0) &&
		playerState.action !== "Stunned" &&
		playerState.action !== "Dead"
	) {
		jumpWindow.buffer = 0;
		jumpWindow.coyote = 0;
		// Launch along the surface normal; halved on a slide.
		const launchSpeed = solveJumpLaunchVelocity(
			meta.jumpHeight.value,
			playerState.underwater ? "water" : "air",
			playerState.underwater ? meta.waterFloatiness : meta.airFloatiness
		) * (onSlidingSurface ? 0.5 : 1);
		playerState.velocity.set(AddVector3(tVel, ScaleVector3(up, launchSpeed)));
		playerState.launched = true;
		// Player jump Y values are Unit instances—mutate their `.value`.
		playerState.jumpStartY.value = playerState.transform.position.y;
		playerState.jumpApexY.value = playerState.transform.position.y;
		SetPlayerAction("Jumping");
	}

	// === FACE MOMENTUM DIRECTION ===
	// Heading follows surface momentum.
	if (Vector3Length(tVel) > minTangent) {
		turnFacingToward(playerState, ResolveVector3Axis(tVel), meta.momentumTurnRate * deltaSeconds);
	}

	playerState.inputFrame.previousCameraYaw = cameraYaw;
	playerState.inputFrame.previousHasInput = hasInput;
	playerState.inputFrame.previousGrounded = playerState.grounded;
	playerState.inputFrame.previousUp = up;
}

/* === EXPORTS === */

export { UpdateMovement };
