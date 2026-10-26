// Runs the camera modes: orbitCam, freeCam, chaseCam and sideCam.

// Used by camera/Master.js to run the active mode
// Used by handlers/game/Simulator.js to set orbitCam framing.
// Uses player/Master.js to aim at the player's height.

import { CONFIG, CAMERA_TUNING } from "../core/config.js";
import { EPSILON, IsPointerLocked, Log, ReleasePointerLock, RequestPointerLock } from "../core/meta.js";
import {
	AddVector3,
	AngleBetweenVector3,
	SubtractVector3,
	CrossVector3,
	CloneVector3,
	DotVector3,
	ResolveVector3Axis,
	RotateByEuler,
	RotateTowardVector3,
	ScaleVector3,
	Vector3Length,
	ToVector3,
	WORLD_NORMALS,
	LerpVector3,
} from "../math/Vector3.js";
import { AabbCenter, ApplyDeceleration, ClampVelocity, ProjectOntoPlane } from "../math/Collision.js";
import { Clamp, Clamp01, DegreesToRadians, Lerp, RadiansToDegrees, SmoothStep, Unit, UnitVector3 } from "../math/Utilities.js";
import { PlayerHeight } from "../player/Master.js";

const persistedFreeCamViews = new Map();
const freeCamRuntime = {
	view    : null,                                   // This level's { position, yaw, pitch, velocity }
	keyState: {
		KeyW      : false,
		KeyA      : false,
		KeyS      : false,
		KeyD      : false,
		ArrowLeft : false,
		ArrowUp   : false,
		ArrowDown : false,
		ArrowRight: false,
		Space     : false,
		ShiftLeft : false,
		ShiftRight: false,
	},
	settings: null,                                   // The level's camera.freeCam
	maxSpeed: null,                                   // Top speed, changed with the wheel
};

// Look input shared by every mode.
const lookInput = {
	lookDeltaX    : 0,
	lookDeltaY    : 0,
	wheelNotches  : 0,                                // Wheel notches this frame. Forward is positive.
	arrowKeyState : {
		ArrowLeft  : false,
		ArrowRight : false,
		ArrowUp    : false,
		ArrowDown  : false,
	},
};

// Camera arm shared by the rig modes.
const rig = {
	direction        : CloneVector3(WORLD_NORMALS.Forward),  // Length 1, from the pivot to the camera
	up               : CloneVector3(WORLD_NORMALS.Up),       // Direction of the screen's top, eased as the camera rolls
	pivot            : new UnitVector3(0, 0, 0, "cnu"),      // Point the arm swings around, lagging behind the target
	distance         : null,                                 // Arm length, zoomed with the wheel
	distanceRange    : null,                                 // The level's { min, default, max } arm lengths
	pitchLimit       : null,                                 // The level's { top, bottom } look limits around the resting tilt
	heightOffset     : null,                                 // The level's camera height above the target
	currentDistance  : null,
	targetDistance   : null,
	obstructionLogged: false,
	obstructionClear : 0,                                    // Seconds since the last obstruction
};

// The aimed arm handed to Master.js. One object reused every frame.
const rigFrame = { runtime: rig, scaledDistance: 0, center: null, radius: 0, holdArm: false, tangent: null };

const orbitCamRuntime = { yaw: new Unit(0, "degrees"), pitch: new Unit(0, "degrees") };

// Shared by chaseCam and sideCam.
const chaseRuntime = {
	mode       : "chaseCam",                                                     // Which of the two is running
	sinceInput : Infinity,                                                       // Seconds since the last look input
	sinceChase : 0,                                                              // Seconds of unbroken following, to ease the swing in
	returning  : false,                                                          // Swinging back behind the player after a loop
	exitFacing : null,                                                           // The player's facing when leaving the loop
	side       : new Unit(0, "radians"),                                         // Angle the camera sits off from behind the player. 0 for chaseCam
	repick     : false,                                                          // Choose the side again once looking stops
	settle     : new Unit(0, "radians"),                                         // Resting arm tilt. Lowers as the camera rolls on an incline
	flipped    : false,                                                          // Look swung the arm over or under the player
	look       : { yaw: new Unit(0, "degrees"), pitch: new Unit(0, "degrees") }, // This frame's look, before resistance
};

/* === SHARED === */

function resetLookInput() {
	lookInput.lookDeltaX = 0;
	lookInput.lookDeltaY = 0;
	lookInput.wheelNotches = 0;
	Object.keys(lookInput.arrowKeyState).forEach(key => { lookInput.arrowKeyState[key] = false; });
}

// Turn mouse sensitivity into degrees per pixel moved.
const mouseStep = () => CONFIG.Camera.Sensitivity.Mouse * 0.0024;

// Turn keyboard sensitivity into degrees for this frame.
const arrowStep = (deltaSeconds) => CONFIG.Camera.Sensitivity.Keyboard * 2 * deltaSeconds;

function handleLookInput(eventLike, keyState) {
	switch (eventLike.type) {
		case "pointerdown": return IsPointerLocked() ? false : RequestPointerLock();
		case "keydown":
			if (eventLike.code === "Escape") { 
				ReleasePointerLock(); 
				return true; 
			}
			if (!(eventLike.code in keyState)) return false;
			keyState[eventLike.code] = true;
			return true;
		case "keyup":
			if (!(eventLike.code in keyState)) return false;
			keyState[eventLike.code] = false;
			return true;
		case "mousemove":
			if (!IsPointerLocked()) return false;
			lookInput.lookDeltaX += eventLike.movementX;
			lookInput.lookDeltaY += eventLike.movementY;
			return true;
		case "wheel": lookInput.wheelNotches -= Math.sign(eventLike.deltaY); return true;
		default: return false;
	}
}

const handleRigInput = (eventLike) => handleLookInput(eventLike, lookInput.arrowKeyState);
const handleFreeCamInput = (eventLike) => handleLookInput(eventLike, freeCamRuntime.keyState);

// Apply zoom and look input to a view, and report whether the player looked.
function consumeLookInput(view, minPitch, maxPitch, deltaSeconds) {
	const low  = minPitch.toDegrees();
	const high = maxPitch.toDegrees();

	// Zoom the arm a step per wheel notch, within the level's range.
	if (lookInput.wheelNotches !== 0) {
		const { min, max } = rig.distanceRange;
		rig.distance.value = Clamp(rig.distance.value - lookInput.wheelNotches * CONFIG.Camera.ZoomStep, min.value, max.value);
		lookInput.wheelNotches = 0;
	}

	// Apply mouse look.
	const { yaw, pitch } = view;
	const mouse = lookInput.lookDeltaX !== 0 || lookInput.lookDeltaY !== 0;
	if (mouse) {
		yaw.value -= lookInput.lookDeltaX * mouseStep();
		pitch.value = Clamp(pitch.value + lookInput.lookDeltaY * mouseStep(), low, high);
		lookInput.lookDeltaX = 0;
		lookInput.lookDeltaY = 0;
	}

	// Apply arrow key rotation.
	const { ArrowLeft, ArrowRight, ArrowUp, ArrowDown } = lookInput.arrowKeyState;
	const arrowSpeed = arrowStep(deltaSeconds);
	if (ArrowLeft)  yaw.value += arrowSpeed;
	if (ArrowRight) yaw.value -= arrowSpeed;
	if (ArrowUp)    pitch.value = Clamp(pitch.value - arrowSpeed, low, high);
	if (ArrowDown)  pitch.value = Clamp(pitch.value + arrowSpeed, low, high);

	return mouse || ArrowLeft || ArrowRight || ArrowUp || ArrowDown;
}

// Measure how upright the shown model is to the camera (1 = upright. −1 = upside down).
function modelFlip({ target, onRamp }) {
	if (onRamp) return 1;
	const rotation = CONFIG.Performance.Animations === "Disabled" 
		? target.transform.rotation 
		: target.animationRuntime.modelPose.rotation;
	return DotVector3(RotateByEuler(WORLD_NORMALS.Up, rotation), rig.up);
}

// Find the spot on the player's body the camera looks at.
function AimPoint(ctx) {
	return ctx.target.collision.aabb.min.clone().set(AabbCenter(ctx.target.collision.aabb)).add(
		ScaleVector3(rig.up, PlayerHeight(ctx.target).value * (ctx.aimShare - 0.5) * modelFlip(ctx))
	);
}

// Find the arm tilt that lifts the camera to the level's height above the player.
const settlePitch = (scale) => new Unit(Math.asin(Clamp((rig.heightOffset.value * scale) / rig.distanceRange.default.value, -1, 1)), "radians");

// Build the level's vertical camera angle limits around a resting tilt.
function pitchWindow(settle) {
	const reach = (limit) => limit.toDegrees() > 90 ? Infinity : limit.toDegrees();
	const top    = reach(rig.pitchLimit.top);
	const bottom = reach(rig.pitchLimit.bottom);

	// With no limit either way, let the look turn all the way over.
	const wrap = top === Infinity && bottom === Infinity;
	const center = settle.toDegrees();
	return {
		top   : new Unit(top, "degrees"),
		bottom: new Unit(bottom, "degrees"),
		min   : new Unit(Math.max(center - bottom, wrap ? -Infinity : -180), "degrees"),
		max   : new Unit(Math.min(center + top, wrap ? Infinity : 180), "degrees"),
		wrap,
	};
}

// Set up the arm when a rig mode starts.
function takeOverRig(ctx, seed) {
	// Seed the arm at level start.
	if (ctx.lastMode === null) {
		if (ctx.target === null) return;

		rig.up = CloneVector3(WORLD_NORMALS.Up);
		rig.direction = seed();
		rig.pivot.set(AimPoint(ctx));

		// Place the camera at the end of the arm, looking back at the pivot.
		const cameraState = ctx.cameraState;
		cameraState.position.set(AddVector3(rig.pivot, ScaleVector3(rig.direction, rig.currentDistance.value)));
		cameraState.forward = ScaleVector3(rig.direction, -1);
		cameraState.right = ResolveVector3Axis(CrossVector3(cameraState.forward, rig.up));
		cameraState.up = ResolveVector3Axis(ProjectOntoPlane(rig.up, cameraState.forward));
		cameraState.target.set(rig.pivot);

		return;
	}

	if (CAMERA_MODES[ctx.lastMode].rig) return;

	// Rebuild the arm from where freeCam left the camera.
	rig.up = CloneVector3(WORLD_NORMALS.Up);
	rig.pivot.set(AimPoint(ctx));
	const arm = SubtractVector3(ctx.cameraState.position, rig.pivot);
	rig.direction = ResolveVector3Axis(arm);
	rig.currentDistance.value = Vector3Length(arm);
}

// Ease the camera's roll to match the ground, or back to level.
function rollToward(target, deltaSeconds) {
	rig.up = RotateTowardVector3(rig.up, target, 
		AngleBetweenVector3(rig.up, target) * (1 - Math.exp(-4 * CAMERA_TUNING.Body.RollStrength * deltaSeconds))
	);
}

// Find which way the arm points, ignoring the verticality.
function armHeading(cameraState, up) {
	const projected = ProjectOntoPlane(rig.direction, up);
	return ResolveVector3Axis(Vector3Length(projected) > EPSILON ? projected : CrossVector3(cameraState.right, up));
}

const armPitch = (up) => new Unit(Math.asin(Clamp(DotVector3(rig.direction, up), -1, 1)), "radians");

// Build an arm direction from a heading, turn and tilt.
function armAt(heading, yaw, pitch, up) {
	const yawRad   = yaw.toRadians();
	const pitchRad = pitch.toRadians();
	const turned   = AddVector3(ScaleVector3(heading, Math.cos(yawRad)), ScaleVector3(CrossVector3(up, heading), Math.sin(yawRad)));
	return AddVector3(ScaleVector3(turned, Math.cos(pitchRad)), ScaleVector3(up, Math.sin(pitchRad)));
}

// Build the camera's facing and screen top as if it sat directly behind the player.
function armBasis(cameraState, side) {
	const forward = ScaleVector3(armAt(armHeading(cameraState, rig.up), new Unit(-side.toRadians(), "radians"), armPitch(rig.up), rig.up), -1);
	return { forward, up: ResolveVector3Axis(ProjectOntoPlane(rig.up, forward)) };
}

// Fill in the aimed arm for Master.js to place.
function aimedRig(scaledDistance, center, radius, holdArm, tangent) {
	rigFrame.scaledDistance = scaledDistance;
	rigFrame.center = center;
	rigFrame.radius = radius;
	rigFrame.holdArm = holdArm;
	rigFrame.tangent = tangent;
	return rigFrame;
}

// Pick the end of the loop's axis on the same side as a direction.
const loopSide = (direction, loop) => ScaleVector3(loop.axis, Math.sign(DotVector3(direction, loop.axis)) || 1);

// Keep a direction close enough to the loop's axis for the camera to clear its walls.
function insideLoopCone(direction, loop, scaledDistance) {
	return RotateTowardVector3(
		loopSide(direction, loop), direction, 
		Math.asin(Clamp((loop.radius.value - CAMERA_TUNING.Body.Radius.value) / scaledDistance, 0, 1))
	);
}

/* === FREE CAM === */

// Point the camera from the free view's position and angles.
function updateOrientationVectors(cameraState, view) {
	const yaw = view.yaw.toRadians();
	const pitch = view.pitch.toRadians();
	cameraState.forward = ResolveVector3Axis({ x: Math.cos(pitch) * Math.cos(yaw), y: Math.sin(pitch), z: Math.cos(pitch) * Math.sin(yaw) });

	// Base right on the turn alone, so looking up can pass over the top.
	cameraState.right = ResolveVector3Axis({ x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) });
	cameraState.up = ResolveVector3Axis(CrossVector3(cameraState.right, cameraState.forward));
	cameraState.position.set(view.position);
	cameraState.target.set(AddVector3(view.position, cameraState.forward));
}

function getMoveDirectionFromKeys(cameraState) {
	let direction = ToVector3(0);
	const keyState = freeCamRuntime.keyState;
	if (keyState.KeyW)  direction = AddVector3(direction, cameraState.forward);
	if (keyState.KeyS)  direction = AddVector3(direction, ScaleVector3(cameraState.forward, -1));
	if (keyState.KeyD)  direction = AddVector3(direction, cameraState.right);
	if (keyState.KeyA)  direction = AddVector3(direction, ScaleVector3(cameraState.right, -1));
	if (keyState.Space) direction = AddVector3(direction, cameraState.up);
	if (keyState.ShiftLeft || keyState.ShiftRight) direction = AddVector3(direction, ScaleVector3(cameraState.up, -1));

	return Vector3Length(direction) <= EPSILON ? ToVector3(0) : ResolveVector3Axis(direction);
}

// Resume this level's free view, or start one from the current camera.
function initializeFreeCam(ctx) {
	Object.keys(freeCamRuntime.keyState).forEach(key => { freeCamRuntime.keyState[key] = false; });
	lookInput.lookDeltaX = 0;
	lookInput.lookDeltaY = 0;
	lookInput.wheelNotches = 0;

	// Save views per level, and per stage when the level has stages.
	const levelKey = ctx.payloadMeta.stageId ? `${ctx.payloadMeta.levelId}:${ctx.payloadMeta.stageId}` : ctx.payloadMeta.levelId;

	// Start a new view on a mode change or a first visit.
	if (ctx.lastMode !== null || !persistedFreeCamViews.has(levelKey)) {
		const forward = ctx.cameraState.forward;
		persistedFreeCamViews.set(levelKey, {
			position: ctx.cameraState.position.clone(),
			yaw     : new Unit(RadiansToDegrees(Math.atan2(forward.z, forward.x)), "degrees"),
			pitch   : new Unit(RadiansToDegrees(Math.asin(Clamp(forward.y, -1, 1))), "degrees"),
			velocity: new UnitVector3(0, 0, 0, "cnu"),    // Per second
		});
	}
	freeCamRuntime.view = persistedFreeCamViews.get(levelKey);
	updateOrientationVectors(ctx.cameraState, freeCamRuntime.view);
}

// Hand movement the camera's heading to steer by.
function prepareFreeCam(ctx) {
	const forward = ctx.cameraState.forward;
	return { control: "carried", basis: { forward }, yaw: new Unit(Math.atan2(forward.x, forward.z), "radians") };
}

function updateFreeCam(ctx) {
	const view = freeCamRuntime.view;
	const settings = freeCamRuntime.settings;

	// Apply mouse and arrow look without limits.
	const turn = Math.cos(view.pitch.toRadians()) < 0 ? -1 : 1;
	view.yaw.value   += turn * lookInput.lookDeltaX * mouseStep();
	view.pitch.value -= lookInput.lookDeltaY * mouseStep();

	const arrowSpeed = arrowStep(ctx.deltaSeconds);
	if (freeCamRuntime.keyState.ArrowLeft)  view.yaw.value   += turn * arrowSpeed;
	if (freeCamRuntime.keyState.ArrowRight) view.yaw.value   -= turn * arrowSpeed;
	if (freeCamRuntime.keyState.ArrowUp)    view.pitch.value += arrowSpeed;
	if (freeCamRuntime.keyState.ArrowDown)  view.pitch.value -= arrowSpeed;

	// Change the top speed a step per wheel notch, within the level's range.
	if (lookInput.wheelNotches !== 0) {
		freeCamRuntime.maxSpeed.value = Clamp(
			freeCamRuntime.maxSpeed.value + lookInput.wheelNotches * settings.speedStep.value,
			settings.speed.min.value, settings.speed.max.value
		);
		Log("ENGINE", `FreeCam top speed: ${freeCamRuntime.maxSpeed.value.toFixed(1)}`, "log", "Level");
	}

	updateOrientationVectors(ctx.cameraState, view);

	// Speed up toward the held keys, or brake at the same rate without them.
	const inputDirection = getMoveDirectionFromKeys(ctx.cameraState);
	Vector3Length(inputDirection) > EPSILON
		? view.velocity.add(ScaleVector3(inputDirection, settings.acceleration.value * ctx.deltaSeconds))
		: view.velocity.set(ApplyDeceleration(view.velocity, settings.acceleration.value, ctx.deltaSeconds));

	if (Vector3Length(view.velocity) > freeCamRuntime.maxSpeed.value) {
		view.velocity.set(ClampVelocity(view.velocity, freeCamRuntime.maxSpeed.value));
	}

	view.position.add(ScaleVector3(view.velocity, ctx.deltaSeconds));
	updateOrientationVectors(ctx.cameraState, view);

	lookInput.lookDeltaX = 0;
	lookInput.lookDeltaY = 0;
	lookInput.wheelNotches = 0;
}

/* === ORBIT CAM (Third-Person Follow) === */

function orbitDirection() {
	const yawRad   = orbitCamRuntime.yaw.toRadians();
	const pitchRad = orbitCamRuntime.pitch.toRadians();
	return { x: Math.cos(pitchRad) * Math.sin(yawRad), y: Math.sin(pitchRad), z: Math.cos(pitchRad) * Math.cos(yawRad) };
}

// Find which way the camera moves as the orbit rises over the player.
function orbitTangent() {
	const yawRad   = orbitCamRuntime.yaw.toRadians();
	const pitchRad = orbitCamRuntime.pitch.toRadians();
	return AddVector3(
		ScaleVector3(rig.up, Math.cos(pitchRad)),
		ScaleVector3({ x: Math.sin(yawRad), y: 0, z: Math.cos(yawRad) }, -Math.sin(pitchRad))
	);
}

function initializeOrbitCam(ctx) {
	const { yaw, pitch } = orbitCamRuntime;
	yaw.value = 0;
	pitch.value = settlePitch(1).toDegrees();

	// Start behind the player at level start.
	takeOverRig(ctx, () => {
		yaw.value = RadiansToDegrees(Math.atan2(-ctx.target.facing.x, -ctx.target.facing.z));
		return orbitDirection();
	});

	// Take the orbit angles from the arm on a mode change.
	if (ctx.lastMode !== null) {
		yaw.value   = RadiansToDegrees(Math.atan2(rig.direction.x, rig.direction.z));
		pitch.value = RadiansToDegrees(Math.asin(Clamp(rig.direction.y, -1, 1)));
	}

	Log(
		"ENGINE", 
		`
			OrbitCam initialized: 
			- Distance=${rig.distance.value} 
			- HeightOffset=${rig.heightOffset.value}
			- Yaw=${yaw.value.toFixed(0)}
			- Sensitivity=${mouseStep()}
		`, 
		"log", 
		"Level"
	);
}

// Apply look input within the level's limits, then hand movement its steering.
function prepareOrbitCam(ctx) {
	const { min, max, wrap } = pitchWindow(settlePitch(1));
	consumeLookInput(orbitCamRuntime, min, max, ctx.deltaSeconds);

	// Keep the pitch between -180° and 180° when it can turn all the way around.
	if (wrap) orbitCamRuntime.pitch.value -= 360 * Math.round(orbitCamRuntime.pitch.value / 360);

	// Steer by the way the camera faces.
	return { 
		control: "carried", 
		basis: { forward: ctx.cameraState.forward }, 
		yaw: new Unit(orbitCamRuntime.yaw.toRadians() + Math.PI, "radians") 
	};
}

// Ease the arm onto the orbit and roll the camera upright.
function updateOrbitCam(ctx) {
	rig.direction       = ResolveVector3Axis(
		LerpVector3(ResolveVector3Axis(SubtractVector3(ctx.cameraState.position, rig.pivot)), orbitDirection(), ctx.follow)
	);
	rollToward(WORLD_NORMALS.Up, ctx.deltaSeconds);

	return aimedRig(rig.distance.value, null, CAMERA_TUNING.Body.Radius.value, false, orbitTangent());
}

/* === CHASE CAM & SIDE CAM (Follow behind or beside the player) === */

// The faster the player moves, the narrower the camera angle limit becomes.
function chaseFreedom(s) {
	return {
		...pitchWindow(chaseRuntime.settle),
		yaw: new Unit(Lerp(Math.PI, CAMERA_TUNING.Modes.Chase.MaxNarrowedYaw.toRadians(), s), "radians"),
	};
}

// Slow look as it nears its limit.
function stiffen(delta, offset, limit, share) {
	const look = delta.toRadians(), away = offset.toRadians();
	const resisted = Math.sign(look) === Math.sign(away)
		? look * (1 - share * Math.pow(Math.min(1, Math.abs(away) / limit.toRadians()), CAMERA_TUNING.Modes.Chase.LookResistance))
		: look;
	return new Unit(resisted, "radians");
}

// Measure the arm's tilt.
function chasePitch(up) {
	const pitch = armPitch(up);
	if (chaseRuntime.flipped) pitch.value = (Math.sign(pitch.value) || 1) * Math.PI - pitch.value;
	return pitch;
}

// Find which way the arm points.
function chaseHeading(cameraState, up) {
	const heading = armHeading(cameraState, up);
	return chaseRuntime.flipped ? ScaleVector3(heading, -1) : heading;
}

// Measure how far the arm must turn to reach its follow position.
function gapToTrail(heading, facing, up, side) {
	const trail = armAt(ScaleVector3(ResolveVector3Axis(facing), -1), side, new Unit(0, "radians"), up);
	return new Unit(Math.atan2(DotVector3(CrossVector3(heading, trail), up), DotVector3(heading, trail)), "radians");
}

// Put sideCam on whichever side of the player the arm is closest to, and chaseCam behind.
function pickSide(heading, facing, up) {
	chaseRuntime.repick = false;
	chaseRuntime.side.value = chaseRuntime.mode === "sideCam" ? -(Math.sign(gapToTrail(heading, facing, up, new Unit(0, "radians")).value) || 1) * DegreesToRadians(90) : 0;
}

function initializeChase(ctx, mode) {
	chaseRuntime.mode       = mode;
	chaseRuntime.sinceInput = Infinity;
	chaseRuntime.sinceChase = 0;
	chaseRuntime.returning  = false;
	chaseRuntime.side.value = 0;
	chaseRuntime.repick     = false;
	chaseRuntime.settle     = settlePitch(1);
	chaseRuntime.flipped    = false;

	// Start upright at the follow position at level start.
	takeOverRig(ctx, () => {
		const up = WORLD_NORMALS.Up;
		const facing = ProjectOntoPlane(ctx.target.facing, up);
		pickSide(armHeading(ctx.cameraState, up), facing, up);
		return armAt(ScaleVector3(ResolveVector3Axis(facing), -1), chaseRuntime.side, chaseRuntime.settle, up);
	});

	// Pick the side from where the arm already is on a mode change.
	if (ctx.lastMode !== null) pickSide(armHeading(ctx.cameraState, rig.up), ProjectOntoPlane(ctx.target.facing, rig.up), rig.up);

	Log(
		"ENGINE", 
		`
			${mode} initialized: distance=${rig.distance.value}
			- HeightOffset=${rig.heightOffset.value}
			- Side=${chaseRuntime.side.toDegrees().toFixed(0)}
			- Sensitivity=${mouseStep()}
		`, 
		"log", 
		"Level"
	);
}

// Apply look input, then hand movement its controls.
function prepareChase(ctx) {
	// Swing back behind the player after leaving a loop.
	if (ctx.leftLoop) {
		chaseRuntime.returning = true;
		chaseRuntime.exitFacing = CloneVector3(ctx.target.facing);
	}

	const loop   = ctx.loop;
	const addons = ctx.set.addons[chaseRuntime.mode];

	// Let look roam freely while loopCam frames a loop.
	const share = loop.active && addons.includes("loopCam") ? 0 : ctx.speedShare;
	const freedom = chaseFreedom(share);
	const startPitch = chasePitch(rig.up);
	const view = chaseRuntime.look;

	view.yaw.value = 0;
	view.pitch.value = startPitch.toDegrees();

	// Widen the limits to the current tilt so look never snaps the arm.
	const low  = new Unit(Math.min(freedom.min.toDegrees(), view.pitch.value), "degrees");
	const high = new Unit(Math.max(freedom.max.toDegrees(), view.pitch.value), "degrees");
	if (consumeLookInput(view, low, high, ctx.deltaSeconds)) {
		chaseRuntime.sinceInput = 0;
		chaseRuntime.repick = true;

		// Cancel the swing back when the player looks.
		chaseRuntime.returning = false;
		const heading = chaseHeading(ctx.cameraState, rig.up);
		const facing = ProjectOntoPlane(ctx.target.facing, rig.up);
		let yaw = view.yaw.toRadians();

		// Resist side look near its limit, and past it allow only turning back.
		const reach = freedom.yaw.toRadians();
		if (reach < Math.PI && Vector3Length(facing) > EPSILON) {
			const gap = gapToTrail(heading, facing, rig.up, chaseRuntime.side).toRadians();
			yaw = stiffen(view.yaw, new Unit(-gap, "radians"), freedom.yaw, 1).toRadians();
			const allowed = Math.max(reach, Math.abs(gap));
			yaw = gap - Clamp(gap - yaw, -allowed, allowed);
		}

		// Resist up and down look near the level's limits, more at speed.
		const offset    = new Unit(startPitch.toRadians() - chaseRuntime.settle.toRadians(), "radians");
		const lookPitch = new Unit(view.pitch.toRadians() - startPitch.toRadians(), "radians");
		let pitch = startPitch.toRadians() + stiffen(lookPitch, offset, offset.value > 0 ? freedom.top : freedom.bottom, share).toRadians();

		if (freedom.wrap) pitch -= 2 * Math.PI * Math.round(pitch / (2 * Math.PI));
		chaseRuntime.flipped = Math.abs(pitch) > Math.PI * 0.5;
		rig.direction = armAt(heading, new Unit(yaw, "radians"), new Unit(pitch, "radians"), rig.up);
	}
	else chaseRuntime.sinceInput += ctx.deltaSeconds;

	// Map sideCam's controls as if the camera were behind the player.
	const basis = armBasis(ctx.cameraState, chaseRuntime.side);
	if (!addons.includes("loopControls") || !(loop.active || ctx.cameraState.situation === "slope")) return { control: "free", basis };
	
	// Lock controls to the loop's axis, or straight down the slope.
	return {
		control          : "loopLock",
		axis             : loop.active ? loop.axis : ResolveVector3Axis(ProjectOntoPlane(WORLD_NORMALS.Down, ctx.target.alignedUp)),
		view             : ctx.cameraState.forward,
		coastGravityScale: CAMERA_TUNING.Loops.CoastGravity,
		basis,
	};
}

// Follow the player with the arm, or frame the loop with loopCam.
function updateChase(ctx) {
	const { Gravity, Correction } = CONFIG.Physics;
	const { Look, Loops, Modes, Body } = CAMERA_TUNING;

	const loop = ctx.loop, target = ctx.target, up = rig.up;
	const addons = ctx.set.addons[chaseRuntime.mode];
	const settled = chaseRuntime.sinceInput >= Look.ReturnDelayMs / 1000;

	// Frame the whole loop from along its axis, upright.
	if (loop.active && addons.includes("loopCam")) {
		chaseRuntime.sinceChase = 0;
		chaseRuntime.repick = true;
		chaseRuntime.flipped = false;
		rollToward(WORLD_NORMALS.Up, ctx.deltaSeconds);

		// Zoom out with speed, measured at the loop's bottom so the zoom stays steady.
		const { waterFloatiness, airFloatiness, maxSpeed } = target.character.meta;

		const floatiness  = target.underwater ? waterFloatiness : airFloatiness;
		const fall        = (Gravity.Strength * target.gravityScale - target.buoyancyForce) / floatiness;
		const height      = target.transform.position.y - (loop.center.y - loop.radius.value);
		const bottomSpeed = Math.sqrt(
			Math.max(0, Vector3Length(ProjectOntoPlane(target.velocity, target.alignedUp)) ** 2 + 2 * fall * height)
		);

		const ceilingGrip    = Correction.MinGripSpeed[target.underwater ? "Water" : "Air"];
		const fitDistance    = (Loops.TightFraming * loop.radius.value) / Math.sin(DegreesToRadians(CONFIG.Camera.Fov) * 0.5);
		const speedZoom      = 1 + (Loops.SpeedZoom - 1) * Clamp01((bottomSpeed / maxSpeed.value - ceilingGrip) / (1 - ceilingGrip));
		const scaledDistance = fitDistance * speedZoom;

		// Ease back onto the loop's axis once looking stops, otherwise keep the arm clear of the walls.
		const aim = settled ? loopSide(rig.direction, loop) : insideLoopCone(rig.direction, loop, scaledDistance);
		rig.direction = ResolveVector3Axis(LerpVector3(rig.direction, aim, ctx.follow));
		
		// Check only the center ray for obstructions, since the arm already clears the walls.
		return aimedRig(scaledDistance, loop.center, 0, false, rig.up);
	}

	// Roll with the ground in large loops and on inclines.
	const inclined = target.grounded && AngleBetweenVector3(target.alignedUp, WORLD_NORMALS.Up) > DegreesToRadians(Correction.FlatSnapDegrees);
	const rolls = ctx.cameraState.looping 
		? !addons.includes("noLoopRoll")
		: inclined && !ctx.onSmallLoop && !addons.includes("noSlopeRoll") && !(ctx.onRamp && addons.includes("noRampRoll"));
	rollToward(rolls ? target.alignedUp : WORLD_NORMALS.Up, ctx.deltaSeconds);

	// Lower the camera as it rolls, and drop it below an upside-down model, once looking stops.
	if (settled) chaseRuntime.settle = settlePitch((ctx.cameraState.looping ? 1 : Math.max(0, Math.cos(AngleBetweenVector3(up, WORLD_NORMALS.Up)))) * modelFlip(ctx));

	// Follow while moving or swinging back from a loop, a short delay after the player stops looking.
	const facing = ProjectOntoPlane(chaseRuntime.returning ? chaseRuntime.exitFacing : target.facing, up);
	const facingKnown = Vector3Length(facing) > EPSILON;
	const following = facingKnown && (ctx.speedShare > EPSILON || chaseRuntime.returning) && settled;
	chaseRuntime.sinceChase = following ? chaseRuntime.sinceChase + ctx.deltaSeconds : 0;

	if (facingKnown) {
		const heading = chaseHeading(ctx.cameraState, up);
		if (chaseRuntime.repick && settled) pickSide(heading, facing, up);
		const trail = 1 - Math.exp(-ctx.deltaSeconds * Modes.Chase.TrailStrength / (250 / 1000));

		// Follow harder with speed, easing in after the player looks.
		const strength = chaseRuntime.returning ? 1 : Math.pow(ctx.speedShare, 0.5);
		const step     = following ? trail * SmoothStep(0, Modes.Chase.FollowRampMs / 1000, chaseRuntime.sinceChase) * strength : 0;

		// Turn and tilt separately, so a half turn swings around instead of over the top.
		const gap       = gapToTrail(heading, facing, up, chaseRuntime.side).toRadians();
		const lastPitch = chasePitch(up).toRadians();
		let turn        = gap * step;
		let pitch       = lastPitch + (chaseRuntime.settle.toRadians() - lastPitch) * step;

		// Ease look back within the limits for this speed.
		const freedom = chaseFreedom(ctx.speedShare);
		const reach   = freedom.yaw.toRadians();
		const left    = gap - turn;

		if (Math.abs(left) > reach) turn += Math.sign(left) * (Math.abs(left) - reach) * trail;
		pitch += (Clamp(pitch, freedom.min.toRadians(), freedom.max.toRadians()) - pitch) * trail;
		chaseRuntime.flipped = Math.abs(pitch) > Math.PI * 0.5;
		rig.direction = armAt(heading, new Unit(turn, "radians"), new Unit(pitch, "radians"), up);
		if (chaseRuntime.returning && Math.abs(gap - turn) < DegreesToRadians(5)) chaseRuntime.returning = false;
	}

	// Hand over the arm, zoomed out in large loops, with the way it moves when rising over the player.
	return aimedRig(
		rig.distance.value * (ctx.cameraState.situation === "largeLoop" ? Loops.LargeLoopZoom : 1), 
		null, Body.Radius.value, 
		true, armAt(chaseHeading(ctx.cameraState, up), new Unit(0, "radians"), new Unit(chasePitch(up).toRadians() + Math.PI * 0.5, "radians"), up)
	);
}

/* === MODES === */

// Each mode's steps. prepare runs before movement, and update after physics.
const CAMERA_MODES = {
	orbitCam: { rig: true,  initialize: initializeOrbitCam,                        prepare: prepareOrbitCam, update: updateOrbitCam, handleInput: handleRigInput     },
	freeCam : { rig: false, initialize: initializeFreeCam,                         prepare: prepareFreeCam,  update: updateFreeCam,  handleInput: handleFreeCamInput },
	chaseCam: { rig: true,  initialize: (ctx) => initializeChase(ctx, "chaseCam"), prepare: prepareChase,    update: updateChase,    handleInput: handleRigInput     },
	sideCam : { rig: true,  initialize: (ctx) => initializeChase(ctx, "sideCam"),  prepare: prepareChase,    update: updateChase,    handleInput: handleRigInput     },
};

// Reset every mode for a new level, with the arm on the opening view.
function ResetCameraModes(cameraConfig, levelBase) {
	resetLookInput();
	
	const distance = cameraConfig.distance;
	rig.distanceRange = { min: distance.min.clone(), default: distance.default.clone(), max: distance.max.clone() };
	rig.distance = distance.default.clone();
	rig.pitchLimit = cameraConfig.pitchLimit;
	rig.heightOffset = cameraConfig.heightOffset.clone();
	rig.currentDistance = distance.default.clone();
	rig.targetDistance = distance.default.clone();
	freeCamRuntime.settings = cameraConfig.freeCam;
	freeCamRuntime.maxSpeed = cameraConfig.freeCam.speed.default.clone();
	rig.obstructionLogged = false;
	rig.obstructionClear = 0;
	rig.up = CloneVector3(WORLD_NORMALS.Up);
	rig.pivot.set(levelBase.target);
	rig.direction = ResolveVector3Axis(SubtractVector3(levelBase.position, levelBase.target));
}

// Set the Simulator's framing, scaling the zoom range to match.
function SetOrbitCamFraming({ distance, heightOffset }) {
	const scale = distance / rig.distanceRange.default.value;
	rig.distanceRange.min.value *= scale;
	rig.distanceRange.max.value *= scale;
	rig.distanceRange.default.value = distance;
	rig.distance.value = distance;
	rig.heightOffset.value = heightOffset;
	rig.currentDistance.value = distance;
	rig.targetDistance.value = distance;
	orbitCamRuntime.pitch.value = settlePitch(1).toDegrees();
}

/* === EXPORTS === */

export { CAMERA_MODES, AimPoint, ResetCameraModes, SetOrbitCamFraming };
