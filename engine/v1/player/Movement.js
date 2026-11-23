// Turns the player's input into velocity, leaving position to physics

// Used by player/Master.js to move the player each frame.

import { CONFIG, GROUNDING, MOVEMENT_TUNING } from "../core/config.js";
import { EPSILON, SendEvent } from "../core/meta.js";
import {
	AbsoluteVector3,
	CloneVector3,
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
	ProjectOntoPlane,
	ClampVelocity,
	WORLD_NORMALS,
} from "../math/Vector3.js";
import { ComputeDeceleration, ComputeStepVelocity } from "../math/Forces.js";
import { Unit } from "../math/Utilities.js";
import { SetPlayerAction, ConsumeJumpPress } from "./Master.js";

// Last solved launch speed, reused while its inputs match.
const jumpVelocityCache = { jumpHeight: -1, medium: "", floatiness: -1, v0: 0 };

// Find the launch speed that peaks at the jump height by simulating the climb.
function solveJumpSpeed(jumpHeight, medium, floatiness) {
	if (
		jumpVelocityCache.jumpHeight === jumpHeight &&
		jumpVelocityCache.medium === medium &&
		jumpVelocityCache.floatiness === floatiness
	) {
		return jumpVelocityCache.v0;
	}

	const simDt   = 1 / 240;
	const buoyant = medium === "Water" && CONFIG.Physics.Buoyancy.Enabled !== false;
	const simForces = {
		gravity: true,
		resistance: { submergence: medium === "Water" ? 1 : 0 },
		...(buoyant ? { buoyancy: { position: { y: 0 }, waterLevel: 0, submergence: 1 } } : {}),
	};

	const simApex = (v0) => {
		let vy = v0;
		let y  = 0;
		for (let step = 0; step < 10000; step++) {
			vy = ComputeStepVelocity.scalar(vy, simForces, simDt, { flag: true, floatiness });
			if (vy <= 0) break;
			y += vy * simDt;
		}
		return y;
	};

	// Binary search the launch speed that reaches the jump height.
	let lo = 0, hi = jumpHeight * 10 + 10;
	for (let i = 0; i < 64; i++) {
		const mid = (lo + hi) * 0.5;
		simApex(mid) < jumpHeight ? lo = mid : hi = mid;
	}

	const v0 = (lo + hi) * 0.5;
	jumpVelocityCache.jumpHeight = jumpHeight;
	jumpVelocityCache.medium     = medium;
	jumpVelocityCache.floatiness = floatiness;
	jumpVelocityCache.v0         = v0;
	return v0;
}

// Below this a projected tangent vector carries no usable heading.
const minTangent = 0.05;

// Actions that leave the ground without granting coyote time.
const noCoyoteActions = new Set(["Jumping", "Flying", "Swimming"]);

// Carry a heading onto the next surface, turning it with the bend on walls to keep it level.
function carryAcross(forward, from, to) {
	const transported = TransportVector3(forward, from, to);

	// Level share: none on a floor or ceiling, full on a wall.
	const level = Math.min(1 - from.y * from.y, 1 - to.y * to.y);
	const bend  = AzimuthTurnVector3(from, to);
	if (level <= EPSILON || bend.y === 0) return transported;

	return AddVector3(
		ScaleVector3(transported, 1 - level), 
		ScaleVector3(TransportVector3(RotateByEuler(forward, bend), RotateByEuler(from, bend), to), level)
	);
}

// Steer the carried forward by the camera's turn, reseeding it from the camera when carrying breaks.
function advanceCarriedForward(frame, cameraForward, cameraYaw, up, grounded, remap) {
	// Carry unless upright or up flipped half a turn.
	if (
		!remap && frame.hadInput && grounded === frame.wasGrounded && 
		up.y < 1 - EPSILON && DotVector3(frame.lastUp, up) > EPSILON - 1
	) {
		const raw = cameraYaw.toRadians() - frame.lastCameraYaw.toRadians();

		// Turn the carried heading by the camera's yaw change on the new surface.
		const transported = ProjectOntoPlane(RotateByEuler(
			carryAcross(frame.carriedForward, frame.lastUp, up),
			{ x: 0, y: Math.atan2(Math.sin(raw), Math.cos(raw)), z: 0 }
		), up);
		if (Vector3Length(transported) >= minTangent) return ResolveVector3Axis(transported);
	}

	// Otherwise seed from the camera's flat forward, pulled uphill the more it faces into a slope.
	const camFwd = ResolveVector3Axis({ x: cameraForward.x, y: 0, z: cameraForward.z });
	return ResolveVector3Axis(AddVector3(ProjectOntoPlane(camFwd, up), ScaleVector3(
		ProjectOntoPlane(WORLD_NORMALS.Up, up), (1 - Math.abs(up.y)) * -DotVector3(camFwd, up)
	)));
}

// Project the camera's forward onto the surface, using screen-up when the camera faces it.
function viewForward(basis, up) {
	const projected = ProjectOntoPlane(basis.forward, up);
	return ResolveVector3Axis(Vector3Length(projected) >= minTangent ? projected : ProjectOntoPlane(basis.up, up));
}

// Carry the last input forward onto this surface, falling back to the facing.
function heldForward(playerState, up) {
	const frame     = playerState.inputFrame;
	const carryable = DotVector3(frame.lastUp, up) > EPSILON - 1;
	const carried   = carryable ? ProjectOntoPlane(carryAcross(frame.carriedForward, frame.lastUp, up), up) : ToVector3(0);
	return ResolveVector3Axis(Vector3Length(carried) >= minTangent ? carried : ProjectOntoPlane(playerState.facing, up));
}

// Point travel `angle` from the loop's way around toward its axis, on the side `sign` picks.
function lockedDirection(loop, sign, angle) {
	const radians = angle.toRadians();
	return AddVector3(ScaleVector3(loop.around, sign * Math.cos(radians)), ScaleVector3(loop.along, Math.sin(radians)));
}

// Store the heading's side and angle to the loop axis on the lock.
function holdHeading(frame, loop, heading) {
	frame.lockSign = Math.sign(DotVector3(heading, loop.around)) || 1;
	frame.lockAngle.value = Math.atan2(DotVector3(heading, loop.along), Math.abs(DotVector3(heading, loop.around)));
}

// Lock onto the loop, taking the angle from the velocity, else the press, else the facing.
function lockLoop(playerState, input, loop, tVel, up, view) {
	const frame = playerState.inputFrame;
	const pressed = AddVector3(ScaleVector3(CrossVector3(view, up), input.right), ScaleVector3(ProjectOntoPlane(view, up), input.forward));
	frame.locked = true;
	frame.lockThrottle = 1;
	const heading = Vector3Length(tVel) > minTangent ? tVel : Vector3Length(pressed) > EPSILON ? pressed : ProjectOntoPlane(playerState.facing, up);
	holdHeading(frame, loop, heading);
}

// Build the input basis on the surface and steer the movement direction from it.
function getMovementDirection(playerState, input, forward, up) {
	playerState.inputFrame.carriedForward = forward;

	// Note: Matches the camera's left/right, not Correction.js's model.
	const right = CrossVector3(forward, up);
	return { forward, right, direction: ResolveVector3Axis(AddVector3(
		ScaleVector3(forward, input.forward), 
		ScaleVector3(right, input.right)
	)) };
}

// Check whether the player is holding against the direction they're mostly moving in, enough to brake.
function oppositeHeld(input, velocityDirection, basis) {
	const forwardComponent = DotVector3(velocityDirection, basis.forward);
	const rightComponent = DotVector3(velocityDirection, basis.right);

	const opposite = MOVEMENT_TUNING.OppositeInput;
	return Math.abs(forwardComponent) >= Math.abs(rightComponent)
		? forwardComponent >= 0 ? input.forward < -opposite.Forward : input.forward > opposite.Forward
		: rightComponent   >= 0 ? input.right   < -opposite.Left    : input.right   > opposite.Right;
}

// Turn the facing toward the target by at most this frame's limit.
function turnFacingToward(playerState, target, maxStep) {
	const planar = ProjectOntoPlane(playerState.facing, playerState.physics.correction.alignedUp);

	// Facing collapsed onto the new normal — no angle left to limit against.
	if (Vector3Length(planar) < minTangent) {
		playerState.facing = target;
		return;
	}

	playerState.facing = RotateTowardVector3(ResolveVector3Axis(planar), target, maxStep.toRadians());
}

// Speed a velocity up along a direction for one step.
const applyAcceleration = (vel, dir, acc, dt) => AddVector3(vel, ScaleVector3(dir, acc * dt));

/**
 * Update player velocity based on input, character stats, and movement context.
 * @param {object} playerState — full mutable player state.
 * @param {object} input — { forward, right, jump }
 * @param {object} modeData — `cameraState.modeData`; `control` picks how input executes: "carried", "free" or "loopLock".
 * @param {number} deltaSeconds
 */
function UpdateMovement(playerState, input, modeData, deltaSeconds) {
	const meta = playerState.character.meta;

	// Air control modifier.
	let controlMultiplier = 1;
	if (!playerState.physics.grounded) controlMultiplier = playerState.physics.medium === "Water" ? meta.underwaterAirControl : meta.airControl;

	const onSlidingSurface = playerState.physics.correction.surfaceContact === "sliding";
	const up = playerState.physics.correction.alignedUp;

	// Floor the surface support to keep walls braking and overhangs from speeding up.
	const support = Math.max(Math.abs(up.y), MOVEMENT_TUNING.MinSupport);

	// Unpowered deceleration, scaled by surface support and air control.
	const friction = meta.deceleration.value * support * controlMultiplier;

	// Slow coasting while grounded.
	const coastFriction = playerState.physics.grounded ? friction : 0;

	// Resolve effective stats.
	const maxSpeed = meta.maxSpeed.value;
	const accel    = meta.acceleration.value;
	const stoppingThreshold = maxSpeed * meta.stoppingThresholdRatio;

	// Uphill input damped on a slide.
	const downhill = ProjectOntoPlane(WORLD_NORMALS.Down, up);
	const inputAcceleration = (direction) => {
		const uphill = onSlidingSurface && DotVector3(direction, downhill) < 0;
		return accel * controlMultiplier * (uphill ? MOVEMENT_TUNING.SlideUphillScale : 1);
	};

	// Normal/tangent split — movement acts on the tangent.
	const normalVelocity = ScaleVector3(up, DotVector3(playerState.velocity, up));
	let tVel = SubtractVector3(playerState.velocity, normalVelocity);
	const currentSpeed = Vector3Length(tVel);

	const hasInput = Math.abs(input.forward) >= 0.001 || Math.abs(input.right) >= 0.001;
	const carried  = modeData.control === "carried", inLoop = modeData.control === "loopLock";
	const frame    = playerState.inputFrame;
	const enteredLoop = inLoop && frame.lastControl !== "loopLock";

	// Held keys keep their meaning until they change.
	const keysChanged = Math.sign(input.forward) !== frame.lastKeys.forward || Math.sign(input.right) !== frame.lastKeys.right;

	// Remap pending after a lock.
	if (carried) frame.remapPending = frame.remapPending || frame.lastControl === "loopLock";
	const remap = carried && frame.remapPending && keysChanged;
	if (remap) frame.remapPending = false;

	// No turn on carried control's first frame.
	if (carried && frame.lastControl !== "carried") frame.lastCameraYaw.value = modeData.yaw.toRadians();

	// Keep held keys going into a lock. A fresh press locks inside a loop and frees outside it.
	const loop = inLoop
		? { around: ResolveVector3Axis(CrossVector3(modeData.axis, up)), along: ResolveVector3Axis(ProjectOntoPlane(modeData.axis, up)) }
		: null;
	if (enteredLoop) frame.holding = hasInput && !frame.locked;
	if (keysChanged) frame.holding = false;
	if (inLoop && (keysChanged || (enteredLoop && frame.locked))) lockLoop(playerState, input, loop, tVel, up, modeData.view);
	else if (keysChanged || (!inLoop && !(input.right !== 0 && frame.lockThrottle > 0))) frame.locked = false;

	if (frame.locked) {
		// Past the lock, its direction carries on until a fresh press.
		const direction = inLoop ? lockedDirection(loop, frame.lockSign, frame.lockAngle) : heldForward(playerState, up);
		frame.carriedForward = direction;
		if (inLoop && input.right !== 0 && Vector3Length(tVel) > minTangent) {
			frame.lockThrottle = Math.sign(DotVector3(ScaleVector3(CrossVector3(modeData.view, up), input.right), tVel));
		}
		if (input.right !== 0 && frame.lockThrottle > 0) tVel = applyAcceleration(tVel, direction, inputAcceleration(direction), deltaSeconds);
		else if (input.right !== 0) {
			const brake = (meta.deceleration.value + inputAcceleration(direction) * MOVEMENT_TUNING.ReversalBrakeScale) * support;
			tVel = ComputeDeceleration(tVel, brake, deltaSeconds);
		}
		else if (!inLoop) tVel = ComputeDeceleration(tVel, coastFriction, deltaSeconds);

		// W steers away from the camera, S toward it; the lock holds the new angle.
		if (inLoop && input.forward !== 0) {
			const side = CrossVector3(direction, up);
			const lateral = ScaleVector3(side, Math.sign(input.forward * DotVector3(side, modeData.view)) || 1);
			tVel = applyAcceleration(tVel, lateral, inputAcceleration(lateral), deltaSeconds);
			if (Vector3Length(tVel) > minTangent) holdHeading(frame, loop, tVel);
		}

		// Velocity held at the lock's angle, keeping its speed and way around.
		if (inLoop) {
			const way = Math.sign(DotVector3(tVel, loop.around)) || frame.lockSign;
			tVel = ScaleVector3(lockedDirection(loop, way, frame.lockAngle), Vector3Length(tVel));
		}
		playerState.movement.braking.active = false;
		playerState.movement.braking.input  = false;
	}
	else {
		const inputForward = !hasInput ? null : frame.holding ? heldForward(playerState, up) : carried 
				? advanceCarriedForward(frame, modeData.basis.forward, modeData.yaw, up, playerState.physics.grounded, remap)
				: viewForward(modeData.basis, up);
		const basis = hasInput ? getMovementDirection(playerState, input, inputForward, up) : null;

		// Detect the player pressing against their direction of travel to brake.
		const velocityDirection = currentSpeed > 0.001 ? ResolveVector3Axis(tVel) : ToVector3(0);
		const canReverse        = hasInput && currentSpeed > 0.001;

		// Carve on acceleration alone when backing with a turn, without braking.
		const tangentDirection    = hasInput ? basis.direction : ToVector3(0);
		const carving             = input.forward < 0 && input.right !== 0;
		const reverseIntent       = canReverse && !carving && DotVector3(velocityDirection, tangentDirection) < 0;
		const primaryOppositeHeld = canReverse && oppositeHeld(input, velocityDirection, basis);

		playerState.movement.braking.active =
			(playerState.physics.grounded && reverseIntent && primaryOppositeHeld && currentSpeed > stoppingThreshold) ||
			(
				!carving &&
				playerState.movement.braking.active &&
				playerState.physics.grounded &&
				hasInput &&
				primaryOppositeHeld &&
				currentSpeed > 0.15 &&
				DotVector3(velocityDirection, tangentDirection) < 0.25
			);
		playerState.movement.braking.input = primaryOppositeHeld;

		if (hasInput) {
			const effectiveAcceleration = inputAcceleration(tangentDirection);
			if (playerState.physics.grounded && reverseIntent) {
				const brake = (meta.deceleration.value + (effectiveAcceleration * MOVEMENT_TUNING.ReversalBrakeScale)) * support;
				tVel = ComputeDeceleration(tVel, brake, deltaSeconds);
				if (Vector3Length(tVel) <= stoppingThreshold || !playerState.movement.braking.active) {
					tVel = applyAcceleration(tVel, tangentDirection, effectiveAcceleration, deltaSeconds);
				}
			}
			else tVel = applyAcceleration(tVel, tangentDirection, effectiveAcceleration, deltaSeconds);
		}
		else {
			tVel = ComputeDeceleration(tVel, coastFriction, deltaSeconds);
			playerState.movement.braking.active = false;
			playerState.movement.braking.input  = false;
		}
	}

	// Coasting a lock weakens gravity and drops drag. Letting go of a rising jump ramps gravity up, then back down.
	const { ReleaseGravity, ReleaseRampMs } = MOVEMENT_TUNING;
	const slopes = playerState.physics.slopes;
	slopes.isInLoop   = inLoop;
	slopes.isCoasting = inLoop && frame.locked && input.right === 0;
	const rampStep = (ReleaseGravity - 1) * deltaSeconds * 1000 / ReleaseRampMs;
	const rampedGravity = playerState.physics.launched && playerState.action !== "Stunned" && playerState.velocity.y > 0 && !input.jump
		? Math.min(ReleaseGravity, Math.max(slopes.gravityScale, 1) + rampStep)
		: Math.max(1, slopes.gravityScale - rampStep);
	slopes.gravityScale = slopes.isCoasting ? modeData.coastGravityScale : playerState.physics.grounded ? 1 : rampedGravity;

	// Idle on walkable footing, friction holds the slope's pull.
	slopes.staticFriction = !hasInput && !inLoop && playerState.physics.correction.surfaceContact === "walkable" ? friction : 0;

	// Clamp tangent speed.
	tVel = ClampVelocity(tVel, maxSpeed);

	// Reassemble; normal component preserved.
	playerState.velocity.set(AddVector3(normalVelocity, tVel));

	// === JUMP ===
	const jump = playerState.movement.jump;

	// A running jump ends on the first surface it touches once the launch is spent.
	if (jump.airTime > 0) {
		if (playerState.physics.correction.surfaceContact !== "none" && !playerState.physics.launched) EndJump(playerState);
		else {
			jump.airTime += deltaSeconds;
			jump.apexY.math(Math.max, playerState.transform.position.y);
		}
	}

	const jumpWindow = jump.window;
	jumpWindow.buffer = ConsumeJumpPress() ? GROUNDING.JumpBufferMs / 1000 : Math.max(0, jumpWindow.buffer - deltaSeconds);

	if (playerState.inputFrame.wasGrounded && !playerState.physics.grounded && !noCoyoteActions.has(playerState.action)) {
		jumpWindow.coyote = GROUNDING.CoyoteMs / 1000;
	}
	else jumpWindow.coyote = Math.max(0, jumpWindow.coyote - deltaSeconds);

	if (
		jumpWindow.buffer > 0 &&
		(playerState.physics.grounded || onSlidingSurface || jumpWindow.coyote > 0) &&
		playerState.action !== "Stunned" && playerState.action !== "Dead"
	) {
		jumpWindow.buffer = 0;
		jumpWindow.coyote = 0;

		// Launch along the surface normal, at half speed on a slide.
		const launchSpeed = solveJumpSpeed(
			meta.jumpHeight.value,
			playerState.physics.medium,
			playerState.physics.medium === "Water" ? meta.waterFloatiness : meta.airFloatiness
		) * (onSlidingSurface ? 0.5 : 1);
		playerState.velocity.set(AddVector3(tVel, ScaleVector3(up, launchSpeed)));
		playerState.physics.launched = true;

		// Hold the takeoff point in distance until the landing, and count this step as the first in the air.
		jump.startY.value = playerState.transform.position.y;
		jump.apexY.value  = playerState.transform.position.y;
		jump.distance.set(playerState.transform.position);
		jump.airTime = deltaSeconds;
		sendJumpEvent(playerState, "PLAYER_JUMP_START", { startY: jump.startY.value });
		SetPlayerAction("Jumping");
	}

	// Heading follows surface momentum.
	if (Vector3Length(tVel) > minTangent) {
		turnFacingToward(playerState, ResolveVector3Axis(tVel), new Unit(meta.momentumTurnRate.toRadians() * deltaSeconds, "radians"));
	}

	if (carried) frame.lastCameraYaw.value = modeData.yaw.toRadians();
	frame.hadInput         = hasInput;
	frame.wasGrounded      = playerState.physics.grounded;
	frame.lastUp           = up;
	frame.lastControl      = modeData.control;
	frame.lastKeys.forward = Math.sign(input.forward);
	frame.lastKeys.right   = Math.sign(input.right);
}

/* === JUMP EVENTS === */

// Tell the game a jump started or ended.
function sendJumpEvent(playerState, name, detail) {
	if (!playerState.customEvents.jump || !CONFIG.CustomEvents.Entities.Jump) return;
	SendEvent(name, {
		id      : playerState.id,
		type    : playerState.type,
		position: CloneVector3(playerState.transform.position),
		velocity: CloneVector3(playerState.velocity),
		...detail,
	});
}

// End the running jump and report its takeoff-to-landing gap to the game.
function EndJump(playerState) {
	const jump = playerState.movement.jump;

	// Skip when no jump is running.
	if (jump.airTime === 0) return;

	const position = playerState.transform.position;
	jump.distance.set(AbsoluteVector3(SubtractVector3(jump.distance, position)));
	sendJumpEvent(playerState, "PLAYER_JUMP_END", {
		startY  : jump.startY.value,
		apexY   : jump.apexY.value,
		endY    : position.y,
		distance: CloneVector3(jump.distance),
		airTime : jump.airTime,
	});
	jump.airTime = 0;
}

/* === EXPORTS === */

export { UpdateMovement, EndJump };
