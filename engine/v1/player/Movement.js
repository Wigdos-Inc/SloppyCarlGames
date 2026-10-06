// Handles character based movement values and applies them to inputs

// Used by player/Master.js to process movement intent each frame.
// Returns modified velocity. Does NOT modify position directly.

import { CONFIG, GROUNDING, MOVEMENT_TUNING } from "../core/config.js";
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
	TransportVector3,
	AzimuthTurnVector3,
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

	const buoyancyEnabled = medium === "water" && CONFIG.Physics.Buoyancy.Enabled !== false;
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
		simApex(mid) < jumpHeight ? lo = mid : hi = mid;
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

const noCoyoteActions = new Set(["Jumping", "Flying", "Swimming"]);

// Heading carried to the next surface; on walls it turns with the bend, staying level.
function carryAcross(forward, from, to) {
	const transported = TransportVector3(forward, from, to);

	// Level share: none on a floor or ceiling, full on a wall.
	const level = Math.min(1 - from.y * from.y, 1 - to.y * to.y);
	const bend = AzimuthTurnVector3(from, to);
	if (level <= EPSILON || bend.y === 0) return transported;

	return AddVector3(
		ScaleVector3(transported, 1 - level), 
		ScaleVector3(TransportVector3(RotateByEuler(forward, bend), RotateByEuler(from, bend), to), level)
	);
}

/**
 * Steers the carried tangent by camera yaw delta; reseeds from the camera on press, grounding change, upright, remap or collapse.
 * @param {object} frame — `playerState.inputFrame`.
 * @param {{ x, y, z }} cameraForward — camera forward; flattened to XZ only when seeding.
 * @param {number} cameraYaw — radians, `atan2(x, z)` convention.
 * @param {{ x, y, z }} up — surface-aligned up.
 * @param {boolean} remap — held keys changed after the camera handed input back.
 * @returns {{ x: number, y: number, z: number }} — unit, in the surface plane.
 */
function advanceCarriedForward(frame, cameraForward, cameraYaw, up, grounded, remap) {
	// Carry unless upright or up flipped half a turn.
	if (
		!remap && frame.previousHasInput && grounded === frame.previousGrounded && 
		up.y < 1 - EPSILON && DotVector3(frame.previousUp, up) > EPSILON - 1
	) {
		const raw = cameraYaw - frame.previousCameraYaw;
		const yawDelta = Math.atan2(Math.sin(raw), Math.cos(raw));

		// Transport keeps the heading's angle to the fold.
		const carried = carryAcross(frame.carriedForward, frame.previousUp, up);
		const transported = ProjectOntoPlane(RotateByEuler(carried, { x: 0, y: yawDelta, z: 0 }), up);
		if (Vector3Length(transported) >= minTangent) return ResolveVector3Axis(transported);
	}

	// Seed: camera XZ on the surface, pulled uphill by incline and facing.
	const camFwd = ResolveVector3Axis({ x: cameraForward.x, y: 0, z: cameraForward.z });
	return ResolveVector3Axis(AddVector3(ProjectOntoPlane(camFwd, up), ScaleVector3(
		ProjectOntoPlane(WORLD_NORMALS.Up, up), (1 - Math.abs(up.y)) * -DotVector3(camFwd, up)
	)));
}

// Camera forward on the surface plane; screen-up when the camera faces the surface.
function viewForward(basis, up) {
	const projected = ProjectOntoPlane(basis.forward, up);
	return ResolveVector3Axis(Vector3Length(projected) >= minTangent ? projected : ProjectOntoPlane(basis.up, up));
}

// The last input forward, carried onto this surface; the facing where that collapses.
function heldForward(playerState, up) {
	const frame = playerState.inputFrame;
	const carried = DotVector3(frame.previousUp, up) > EPSILON - 1 ? ProjectOntoPlane(carryAcross(frame.carriedForward, frame.previousUp, up), up) : ToVector3(0);
	return ResolveVector3Axis(Vector3Length(carried) >= minTangent ? carried : ProjectOntoPlane(playerState.facing, up));
}

// Travel `angle` radians off around the lock toward its axis; `sign` picks the way around.
const lockedDirection = (loop, sign, angle) => AddVector3(ScaleVector3(loop.around, sign * Math.cos(angle)), ScaleVector3(loop.along, Math.sin(angle)));

// The lock's way around and angle to its axis, from `heading`.
function holdHeading(frame, loop, heading) {
	frame.lockSign = Math.sign(DotVector3(heading, loop.around)) || 1;
	frame.lockAngle = Math.atan2(DotVector3(heading, loop.along), Math.abs(DotVector3(heading, loop.around)));
}

// Lock angle from the velocity, else the press as seen from the camera, else the facing.
function lockLoop(playerState, input, loop, tVel, up, view) {
	const frame = playerState.inputFrame;
	const pressed = AddVector3(ScaleVector3(CrossVector3(view, up), input.right), ScaleVector3(ProjectOntoPlane(view, up), input.forward));
	frame.locked = true;
	frame.lockThrottle = 1;
	holdHeading(frame, loop, Vector3Length(tVel) > minTangent ? tVel : Vector3Length(pressed) > EPSILON ? pressed : ProjectOntoPlane(playerState.facing, up));
}

/**
 * Movement direction from the input forward, carried or from the view.
 * @param {{ forward: number, right: number }} input — normalized -1..1 analog axes.
 * @returns {{ forward, right, direction }} — the input basis and the steered direction, all in the surface plane.
 */
function getMovementDirection(playerState, input, forward, up) {
	playerState.inputFrame.carriedForward = forward;

	// Note: Matches the camera's left/right, not Correction.js's model.
	const right = CrossVector3(forward, up);
	return { forward, right, direction: ResolveVector3Axis(AddVector3(
		ScaleVector3(forward, input.forward), 
		ScaleVector3(right, input.right)
	)) };
}

function getPrimaryOppositeHeld(input, velocityDirection, basis) {
	const forwardComponent = DotVector3(velocityDirection, basis.forward);
	const rightComponent = DotVector3(velocityDirection, basis.right);
	
	const opposite = MOVEMENT_TUNING.OppositeInput;
	return Math.abs(forwardComponent) >= Math.abs(rightComponent)
		? forwardComponent >= 0 ? input.forward < -opposite.Forward : input.forward > opposite.Forward
		: rightComponent   >= 0 ? input.right   < -opposite.Left    : input.right   > opposite.Right;
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
 * @param {object} modeData — `cameraState.modeData`; `control` picks how input executes: "carried", "free" or "loopLock".
 * @param {number} deltaSeconds
 */
function UpdateMovement(playerState, input, modeData, deltaSeconds) {
	const meta = playerState.character.meta;

	// Air control modifier.
	let controlMultiplier = 1;
	if (!playerState.grounded) controlMultiplier = playerState.underwater ? meta.underwaterAirControl : meta.airControl;

	const onSlidingSurface = playerState.surfaceContact === "sliding";
	const up = playerState.alignedUp;
	// cos(incline), floored: a wall must still brake, an overhang must not accelerate.
	const support = Math.max(Math.abs(up.y), MOVEMENT_TUNING.MinSupport);
	// Unpowered deceleration, scaled by surface support and air control.
	const friction = meta.deceleration * support * controlMultiplier;

	// Resolve effective stats.
	const maxSpeed = meta.maxSpeed     * (playerState.boost.active ? playerState.boost.maxSpeedMultiplier : 1);
	const accel    = meta.acceleration * (playerState.boost.active ? playerState.boost.accelMultiplier    : 1);
	const stoppingThreshold = maxSpeed * meta.stoppingThresholdRatio;
	// Uphill input damped on a slide.
	const inputAcceleration = (direction) => accel * controlMultiplier * (onSlidingSurface && DotVector3(direction, ProjectOntoPlane(WORLD_NORMALS.Down, up)) < 0 ? MOVEMENT_TUNING.SlideUphillScale : 1);

	// Normal/tangent split — movement acts on the tangent.
	const normalVelocity = ScaleVector3(up, DotVector3(playerState.velocity, up));
	let tVel = SubtractVector3(playerState.velocity, normalVelocity);
	const currentSpeed = Vector3Length(tVel);

	const hasInput = Math.abs(input.forward) >= 0.001 || Math.abs(input.right) >= 0.001;
	const control = modeData.control;
	const carried = control === "carried";
	const inLoop = control === "loopLock";
	const frame = playerState.inputFrame;
	const enteredLoop = inLoop && frame.previousControl !== "loopLock";
	// Held keys keep their meaning until they change.
	const keysChanged = Math.sign(input.forward) !== frame.previousKeys.forward || Math.sign(input.right) !== frame.previousKeys.right;
	// Remap pending after a camera hold or a lock.
	if (carried) frame.remapPending = !modeData.held && (frame.remapPending || frame.previousHeld || frame.previousControl === "loopLock");
	const remap = carried && frame.remapPending && keysChanged;
	if (remap) frame.remapPending = false;
	// No turn on carried control's first frame.
	if (carried && frame.previousControl !== "carried") frame.previousCameraYaw = modeData.yaw;

	// Held keys carry into a lock; a fresh press locks inside, frees outside.
	const loop = inLoop ? { around: ResolveVector3Axis(CrossVector3(modeData.axis, up)), along: ResolveVector3Axis(ProjectOntoPlane(modeData.axis, up)) } : null;
	if (enteredLoop) frame.holding = hasInput && !frame.locked;
	if (keysChanged) frame.holding = false;
	if (inLoop && (keysChanged || (enteredLoop && frame.locked))) lockLoop(playerState, input, loop, tVel, up, modeData.view);
	else if (keysChanged) frame.locked = false;

	if (frame.locked) {
		// Past the lock, its direction carries on until a fresh press.
		const direction = inLoop ? lockedDirection(loop, frame.lockSign, frame.lockAngle) : heldForward(playerState, up);
		frame.carriedForward = direction;
		if (inLoop && input.right !== 0 && Vector3Length(tVel) > minTangent) frame.lockThrottle = Math.sign(DotVector3(ScaleVector3(CrossVector3(modeData.view, up), input.right), tVel));
		if (input.right !== 0 && frame.lockThrottle > 0) tVel = ApplyAcceleration(tVel, direction, inputAcceleration(direction), deltaSeconds);
		// Against travel brakes as a reversal does.
		else if (input.right !== 0) tVel = ApplyDeceleration(tVel, (meta.deceleration + inputAcceleration(direction) * MOVEMENT_TUNING.ReversalBrakeScale) * support, deltaSeconds);
		else if (!inLoop) tVel = ApplyDeceleration(tVel, friction, deltaSeconds);
		// W steers away from the camera, S toward it; the lock holds the new angle.
		if (inLoop && input.forward !== 0) {
			const side = CrossVector3(direction, up);
			const lateral = ScaleVector3(side, Math.sign(input.forward * DotVector3(side, modeData.view)) || 1);
			tVel = ApplyAcceleration(tVel, lateral, inputAcceleration(lateral), deltaSeconds);
			if (Vector3Length(tVel) > minTangent) holdHeading(frame, loop, tVel);
		}
		// Velocity held at the lock's angle, keeping its speed and way around.
		if (inLoop) tVel = ScaleVector3(lockedDirection(loop, Math.sign(DotVector3(tVel, loop.around)) || frame.lockSign, frame.lockAngle), Vector3Length(tVel));
		playerState.stoppingActive = false;
		playerState.primaryOppositeHeld = false;
	}
	else {
		const inputForward = !hasInput ? null : frame.holding ? heldForward(playerState, up) : carried 
				? advanceCarriedForward(frame, modeData.basis.forward, modeData.yaw, up, playerState.grounded, remap)
				: viewForward(modeData.basis, up);
		const basis = hasInput ? getMovementDirection(playerState, input, inputForward, up) : null;

		// Detects the player pressing against their direction of travel to brake.
		const velocityDirection = currentSpeed > 0.001 ? ResolveVector3Axis(tVel) : ToVector3(0);
		const canReverse = hasInput && currentSpeed > 0.001;
		
		// Back with a turn carves on acceleration alone; no braking.
		const tangentDirection = hasInput ? basis.direction : ToVector3(0);
		const carving = input.forward < 0 && input.right !== 0;
		const reverseIntent = canReverse && !carving && DotVector3(velocityDirection, tangentDirection) < 0;
		const primaryOppositeHeld = canReverse && getPrimaryOppositeHeld(input, velocityDirection, basis);

		playerState.stoppingActive =
			(playerState.grounded && reverseIntent && primaryOppositeHeld && currentSpeed > stoppingThreshold) ||
			(
				!carving &&
				playerState.stoppingActive &&
				playerState.grounded &&
				hasInput &&
				primaryOppositeHeld &&
				currentSpeed > 0.15 &&
				DotVector3(velocityDirection, tangentDirection) < 0.25
			);
		playerState.primaryOppositeHeld = primaryOppositeHeld;

		if (hasInput) {
			const effectiveAcceleration = inputAcceleration(tangentDirection);
			if (playerState.grounded && reverseIntent) {
				tVel = ApplyDeceleration(tVel, (meta.deceleration + (effectiveAcceleration * MOVEMENT_TUNING.ReversalBrakeScale)) * support, deltaSeconds);
				if (Vector3Length(tVel) <= stoppingThreshold || !playerState.stoppingActive) {
					tVel = ApplyAcceleration(tVel, tangentDirection, effectiveAcceleration, deltaSeconds);
				}
			}
			else tVel = ApplyAcceleration(tVel, tangentDirection, effectiveAcceleration, deltaSeconds);
		}
		else {
			tVel = ApplyDeceleration(tVel, friction, deltaSeconds);
			playerState.stoppingActive = false;
			playerState.primaryOppositeHeld = false;
		}
	}

	// Coasting a lock weakens gravity and drops drag.
	const coasting = inLoop && frame.locked && input.right === 0;
	playerState.gravityScale = coasting ? modeData.coastGravityScale : 1;
	playerState.dragFree = coasting;
	// Idle on walkable footing, friction holds the slope's pull.
	playerState.staticFriction = !hasInput && !inLoop && playerState.surfaceContact === "walkable" ? friction : 0;

	// Clamp tangent speed.
	tVel = ClampVelocity(tVel, maxSpeed);

	// Reassemble; normal component preserved.
	playerState.velocity.set(AddVector3(normalVelocity, tVel));

	// === JUMP ===
	const jumpWindow = playerState.jumpWindow;
	if (ConsumeJumpPress()) jumpWindow.buffer = GROUNDING.JumpBufferMs / 1000;
	else jumpWindow.buffer -= deltaSeconds;

	const leftGround = playerState.inputFrame.previousGrounded && !playerState.grounded;
	if (leftGround && !noCoyoteActions.has(playerState.action)) jumpWindow.coyote = GROUNDING.CoyoteMs / 1000;
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

	if (carried) frame.previousCameraYaw = modeData.yaw;
	frame.previousHasInput = hasInput;
	frame.previousGrounded = playerState.grounded;
	frame.previousUp = up;
	frame.previousHeld = carried && modeData.held;
	frame.previousControl = control;
	frame.previousKeys.forward = Math.sign(input.forward);
	frame.previousKeys.right = Math.sign(input.right);
}

/* === EXPORTS === */

export { UpdateMovement };
