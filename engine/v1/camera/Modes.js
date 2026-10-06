// Camera modes: orbitCam, freeCam, chaseCam and sideCam.

// Driven by camera/Master.js, which picks the active mode and places the rig.
// Each mode has initialize, prepare (before movement, returns its modeData), update (after physics) and handleInput.

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
import { ApplyDeceleration, ClampVelocity, ProjectOntoPlane } from "../math/Collision.js";
import { Clamp, Clamp01, DegreesToRadians, Lerp, RadiansToDegrees, SmoothStep, UnitVector3 } from "../math/Utilities.js";
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
	maxSpeed: null,                                   // Unit; wheel-tuned top speed
};

// Look input shared by every mode.
const lookInput = {
	lookDeltaX    : 0,
	lookDeltaY    : 0,
	wheelDelta    : 0,
	sensitivity   : 0,                                // Degrees per pixel; set at level start
	arrowKeyState : {
		ArrowLeft  : false,
		ArrowRight : false,
		ArrowUp    : false,
		ArrowDown  : false,
	},
};

// Arm shared by the rig modes, so a mode change carries it over.
const rig = {
	direction        : CloneVector3(WORLD_NORMALS.Forward),  // Unit; pivot to camera
	up               : CloneVector3(WORLD_NORMALS.Up),       // Smoothed camera up
	pivot            : new UnitVector3(0, 0, 0, "cnu"),      // Lagged orbit center
	distance         : null,                                 // Unit; arm length, wheel-zoomed within distanceRange
	distanceRange    : null,                                 // { min, default, max } Units; the level's arm lengths
	pitchLimit       : null,                                 // { top, bottom } degree Units; look tilt off the settled pitch
	heightOffset     : null,                                 // Unit; the level's camera height above the target
	currentDistance  : null,
	targetDistance   : null,
	obstructionLogged: false,
	obstructionClear : 0,                                    // Seconds since the last obstruction
};

// The aimed rig handed to Master.js; reused each frame.
const rigFrame = { runtime: rig, scaledDistance: 0, center: null, radius: 0, holdArm: false, tangent: null };

const orbitCamRuntime = {
	yaw        : 0,
	pitch      : 0,
	autoYaw    : 0,                                          // Side view's yaw, on top of the user's
	steerOffset: 0,                                          // User yaw turned during side views; never steers
	inputYaw   : 0,                                          // Degrees; the orbit yaw at a loop's engage, which input stays relative to
	sideView   : false,                                      // A loop held the side view last frame
	userTurned : false,                                      // Look input turned it this frame
};

// Shared by chaseCam and sideCam.
const chaseRuntime = {
	mode       : "chaseCam",                                 // Which of the two is running
	sinceInput : Infinity,                                   // Seconds since the last look input
	sinceChase : 0,                                          // Seconds following without a break; ramps the swing in
	returning  : false,                                      // Coming back to the trail after a loop
	frozenBasis: null,                                       // Input basis held while returning
	side       : 0,                                          // Radians the trail sits off behind your facing; 0 for chaseCam
	repick     : false,                                      // Re-pick the side once look settles
	settle     : 0,                                          // Radians the arm settles above your travel; lowers as an incline rolls it
	flipped    : false,                                      // Look carried the arm past straight up or down
};

/* === SHARED === */

function resetLookInput() {
	lookInput.sensitivity = CONFIG.Camera.Sensitivity.Mouse * 0.0024;
	lookInput.lookDeltaX = 0;
	lookInput.lookDeltaY = 0;
	lookInput.wheelDelta = 0;
	Object.keys(lookInput.arrowKeyState).forEach(key => { lookInput.arrowKeyState[key] = false; });
}

// Arrow look this frame, degrees.
const arrowStep = (deltaSeconds) => CONFIG.Camera.Sensitivity.Keyboard * 2 * deltaSeconds;

// Pointer lock, the mode's held keys, mouse look and wheel into lookInput.
function handleLookInput(eventLike, keyState) {
	switch (eventLike.type) {
		case "pointerdown": return RequestPointerLock();
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
		case "wheel": lookInput.wheelDelta += eventLike.deltaY; return true;
		default: return false;
	}
}

const handleRigInput = (eventLike) => handleLookInput(eventLike, lookInput.arrowKeyState);
const handleFreeCamInput = (eventLike) => handleLookInput(eventLike, freeCamRuntime.keyState);

// Zoom, then mouse and arrow look onto `view`'s yaw and pitch in degrees; true on any look.
function consumeLookInput(view, minPitch, maxPitch, deltaSeconds) {
	// Wheel down lengthens the arm, within the level's range.
	if (lookInput.wheelDelta !== 0) {
		const { min, max } = rig.distanceRange;
		rig.distance.value = Clamp(rig.distance.value + Math.sign(lookInput.wheelDelta) * CONFIG.Camera.ZoomStep.value, min.value, max.value);
		lookInput.wheelDelta = 0;
	}

	// Apply mouse look.
	const mouse = lookInput.lookDeltaX !== 0 || lookInput.lookDeltaY !== 0;
	if (mouse) {
		view.yaw -= lookInput.lookDeltaX * lookInput.sensitivity;
		view.pitch = Clamp(view.pitch + lookInput.lookDeltaY * lookInput.sensitivity, minPitch, maxPitch);
		lookInput.lookDeltaX = 0;
		lookInput.lookDeltaY = 0;
	}

	// Apply arrow key rotation.
	const { ArrowLeft, ArrowRight, ArrowUp, ArrowDown } = lookInput.arrowKeyState;
	const arrowSpeed = arrowStep(deltaSeconds);
	if (ArrowLeft)  view.yaw += arrowSpeed;
	if (ArrowRight) view.yaw -= arrowSpeed;
	if (ArrowUp)    view.pitch = Clamp(view.pitch - arrowSpeed, minPitch, maxPitch);
	if (ArrowDown)  view.pitch = Clamp(view.pitch + arrowSpeed, minPitch, maxPitch);

	return mouse || ArrowLeft || ArrowRight || ArrowUp || ArrowDown;
}


// The shown model's up against the camera's: 1 upright, −1 upside down; ramps never flip.
function modelFlip({ target, onRamp }) {
	if (onRamp) return 1;
	const rotation = CONFIG.Performance.Animations === "Disabled" 
		? target.transform.rotation 
		: target.animationRuntime.modelPose.rotation;
	return DotVector3(RotateByEuler(WORLD_NORMALS.Up, rotation), rig.up);
}

// The look point: `aimShare` of the target's height up from its feet, along the camera's eased up; flips with the model.
function AimPoint(ctx) {
	return ctx.target.collision.aabb.min.clone().add(ctx.target.collision.aabb.max).scale(0.5).add(
		ScaleVector3(rig.up, PlayerHeight(ctx.target) * (ctx.aimShare - 0.5) * modelFlip(ctx))
	);
}

// Arm pitch that seats the camera the level's height above the target, `scale` of it; radians.
const settlePitch = (scale) => Math.asin(Clamp((rig.heightOffset.value * scale) / rig.distanceRange.default.value, -1, 1));

// The level's look pitch window around `settle`, degrees; a side past 90 is open, both open wraps.
function pitchWindow(settle) {
	const reach = (limit) => limit.value > 90 ? Infinity : limit.value;
	const top = reach(rig.pitchLimit.top);
	const bottom = reach(rig.pitchLimit.bottom);
	const wrap = top === Infinity && bottom === Infinity;
	return { top, bottom, wrap, min: Math.max(settle - bottom, wrap ? -Infinity : -180), max: Math.min(settle + top, wrap ? Infinity : 180) };
}

// The camera state seated on the rig: arm from the pivot, looking back along it.
function seatCamera(cameraState) {
	cameraState.position.set(AddVector3(rig.pivot, ScaleVector3(rig.direction, rig.currentDistance.value)));
	cameraState.forward = ScaleVector3(rig.direction, -1);
	cameraState.right = ResolveVector3Axis(CrossVector3(cameraState.forward, rig.up));
	cameraState.up = ResolveVector3Axis(ProjectOntoPlane(rig.up, cameraState.forward));
	cameraState.target.set(rig.pivot);
}

// Arm: seeded at level start, re-anchored from freeCam, carried between rig modes.
function takeOverRig(ctx, seed) {
	if (ctx.from === null) {
		// No player: the arm stays on the opening view.
		if (ctx.target === null) return;
		
		rig.up = CloneVector3(WORLD_NORMALS.Up);
		rig.direction = seed();
		rig.pivot.set(AimPoint(ctx));
		seatCamera(ctx.cameraState);
		return;
	}
	if (CAMERA_MODES[ctx.from].rig) return;
	rig.up = CloneVector3(WORLD_NORMALS.Up);
	rig.pivot.set(AimPoint(ctx));
	const arm = SubtractVector3(ctx.cameraState.position, rig.pivot);
	rig.direction = ResolveVector3Axis(arm);
	rig.currentDistance.value = Vector3Length(arm);
}

// Eases the rig's up toward `target`.
function rollToward(target, deltaSeconds) {
	const step = AngleBetweenVector3(rig.up, target) * (1 - Math.exp(-4 * CAMERA_TUNING.Body.RollStrength * deltaSeconds));
	rig.up = RotateTowardVector3(rig.up, target, step);
}

// The arm's heading around `up`; the camera's back when the arm lies along up.
function armHeading(cameraState, up) {
	const projected = ProjectOntoPlane(rig.direction, up);
	return ResolveVector3Axis(Vector3Length(projected) > EPSILON ? projected : CrossVector3(cameraState.right, up));
}

// The arm's pitch against `up`, radians.
const armPitch = (up) => Math.asin(Clamp(DotVector3(rig.direction, up), -1, 1));

// The arm `yaw` around `up` from `heading`, at `pitch` against up; radians.
function armAt(heading, yaw, pitch, up) {
	const turned = AddVector3(ScaleVector3(heading, Math.cos(yaw)), ScaleVector3(CrossVector3(up, heading), Math.sin(yaw)));
	return AddVector3(ScaleVector3(turned, Math.cos(pitch)), ScaleVector3(up, Math.sin(pitch)));
}

// The view the arm gives, turned back by `side`: forward back along it, up square to the rig's.
function armBasis(cameraState, side) {
	const forward = ScaleVector3(armAt(armHeading(cameraState, rig.up), -side, armPitch(rig.up), rig.up), -1);
	return { forward, up: ResolveVector3Axis(ProjectOntoPlane(rig.up, forward)) };
}

// The rig frame for Master.js to place; `tangent` is the arm's way up along its pitch arc.
function aimedRig(scaledDistance, center, radius, holdArm, tangent) {
	rigFrame.scaledDistance = scaledDistance;
	rigFrame.center = center;
	rigFrame.radius = radius;
	rigFrame.holdArm = holdArm;
	rigFrame.tangent = tangent;
	return rigFrame;
}

const wrapDegrees = (angle) => angle - 360 * Math.round(angle / 360);

// The end of the loop's axis nearest `direction`.
const loopSide = (direction, loop) => ScaleVector3(loop.axis, Math.sign(DotVector3(direction, loop.axis)) || 1);

// Cone around the nearer axis end, clear of the loop's walls.
function insideLoopCone(direction, loop, scaledDistance) {
	return RotateTowardVector3(
		loopSide(direction, loop), direction, 
		Math.asin(Clamp((loop.radius - CAMERA_TUNING.Body.Radius.value) / scaledDistance, 0, 1))
	);
}

/* === FREE CAM === */

// Writes the free view onto the camera state; right follows yaw alone, so pitch passes over the top.
function updateOrientationVectors(cameraState, view) {
	const yaw = DegreesToRadians(view.yaw);
	const pitch = DegreesToRadians(view.pitch);
	cameraState.forward = ResolveVector3Axis({ x: Math.cos(pitch) * Math.cos(yaw), y: Math.sin(pitch), z: Math.cos(pitch) * Math.sin(yaw) });
	cameraState.right = ResolveVector3Axis({ x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) });
	cameraState.up = ResolveVector3Axis(CrossVector3(cameraState.right, cameraState.forward));
	cameraState.position.set(view.position);
	cameraState.target.set(AddVector3(view.position, cameraState.forward));
}

function getMoveDirectionFromKeys(cameraState) {
	let direction = ToVector3(0);
	const keyState = freeCamRuntime.keyState;
	if (keyState.KeyW) direction = AddVector3(direction, cameraState.forward);
	if (keyState.KeyS) direction = AddVector3(direction, ScaleVector3(cameraState.forward, -1));
	if (keyState.KeyD) direction = AddVector3(direction, cameraState.right);
	if (keyState.KeyA) direction = AddVector3(direction, ScaleVector3(cameraState.right, -1));
	if (keyState.Space) direction = AddVector3(direction, cameraState.up);
	if (keyState.ShiftLeft || keyState.ShiftRight) direction = AddVector3(direction, ScaleVector3(cameraState.up, -1));

	return Vector3Length(direction) <= EPSILON ? ToVector3(0) : ResolveVector3Axis(direction);
}

// Level start resumes this level's free view; a mode change starts it from the current camera.
function initializeFreeCam(ctx) {
	Object.keys(freeCamRuntime.keyState).forEach(key => { freeCamRuntime.keyState[key] = false; });
	lookInput.lookDeltaX = 0;
	lookInput.lookDeltaY = 0;
	lookInput.wheelDelta = 0;

	// Keyed per level, and per stage when staged.
	const levelKey = ctx.payloadMeta.stageId ? `${ctx.payloadMeta.levelId}:${ctx.payloadMeta.stageId}` : ctx.payloadMeta.levelId;

	if (ctx.from !== null || !persistedFreeCamViews.has(levelKey)) {
		const forward = ctx.cameraState.forward;
		persistedFreeCamViews.set(levelKey, {
			position: ctx.cameraState.position.clone(),
			yaw     : RadiansToDegrees(Math.atan2(forward.z, forward.x)),
			pitch   : RadiansToDegrees(Math.asin(Clamp(forward.y, -1, 1))),
			velocity: new UnitVector3(0, 0, 0, "cnu"),
		});
	}
	freeCamRuntime.view = persistedFreeCamViews.get(levelKey);
	updateOrientationVectors(ctx.cameraState, freeCamRuntime.view);
}

// Steering yaw in radians, atan2(x, z).
function prepareFreeCam(ctx) {
	const forward = ctx.cameraState.forward;
	return { control: "carried", basis: { forward }, yaw: Math.atan2(forward.x, forward.z), held: false };
}

function updateFreeCam(ctx) {
	const view = freeCamRuntime.view;
	const settings = freeCamRuntime.settings;

	// Mouse and arrow look, unclamped; pitch rises with ArrowUp, and yaw turns with the screen while upside down.
	const turn = Math.cos(DegreesToRadians(view.pitch)) < 0 ? -1 : 1;
	view.yaw += turn * lookInput.lookDeltaX * lookInput.sensitivity;
	view.pitch -= lookInput.lookDeltaY * lookInput.sensitivity;
	const arrowSpeed = arrowStep(ctx.deltaSeconds);
	if (freeCamRuntime.keyState.ArrowLeft)  view.yaw += turn * arrowSpeed;
	if (freeCamRuntime.keyState.ArrowRight) view.yaw -= turn * arrowSpeed;
	if (freeCamRuntime.keyState.ArrowUp)    view.pitch += arrowSpeed;
	if (freeCamRuntime.keyState.ArrowDown)  view.pitch -= arrowSpeed;

	// Wheel up raises the top speed, within the level's range.
	if (lookInput.wheelDelta !== 0) {
		freeCamRuntime.maxSpeed.value = Clamp(
			freeCamRuntime.maxSpeed.value + (lookInput.wheelDelta < 0 ? 1 : -1) * settings.speedStep.value, 
			settings.speed.min.value, settings.speed.max.value
		);
		Log("ENGINE", `FreeCam top speed: ${freeCamRuntime.maxSpeed.value.toFixed(1)}`, "log", "Level");
	}

	updateOrientationVectors(ctx.cameraState, view);

	// Accelerates toward the held keys; brakes at the same rate without them.
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
	lookInput.wheelDelta = 0;
}

/* === ORBIT CAM (Third-Person Follow) === */

function orbitDirection() {
	const yawRad = DegreesToRadians(orbitCamRuntime.yaw + orbitCamRuntime.autoYaw);
	const pitchRad = DegreesToRadians(orbitCamRuntime.pitch);
	return { x: Math.cos(pitchRad) * Math.sin(yawRad), y: Math.sin(pitchRad), z: Math.cos(pitchRad) * Math.cos(yawRad) };
};

// The orbit arc's way up at its pitch, about the rig's up; points down past the top.
function orbitTangent() {
	const yawRad = DegreesToRadians(orbitCamRuntime.yaw + orbitCamRuntime.autoYaw);
	const pitchRad = DegreesToRadians(orbitCamRuntime.pitch);
	return AddVector3(
		ScaleVector3(rig.up, Math.cos(pitchRad)), 
		ScaleVector3({ x: Math.sin(yawRad), y: 0, z: Math.cos(yawRad) }, -Math.sin(pitchRad))
	);
}

function initializeOrbitCam(ctx) {
	orbitCamRuntime.autoYaw = 0;
	orbitCamRuntime.steerOffset = 0;
	orbitCamRuntime.sideView = false;
	orbitCamRuntime.userTurned = false;
	orbitCamRuntime.yaw = 0;
	orbitCamRuntime.pitch = RadiansToDegrees(settlePitch(1));
	takeOverRig(ctx, orbitDirection);
	// Mid-level, the orbit angles come from the arm.
	if (ctx.from !== null) {
		orbitCamRuntime.yaw = RadiansToDegrees(Math.atan2(rig.direction.x, rig.direction.z));
		orbitCamRuntime.pitch = RadiansToDegrees(Math.asin(Clamp(rig.direction.y, -1, 1)));
	}

	Log("ENGINE", `OrbitCam initialized: distance=${rig.distance.value}, heightOffset=${rig.heightOffset.value}, sensitivity=${lookInput.sensitivity}`, "log", "Level");
}

// Look input; a loop's side view holds the input basis as the camera was at engage.
function prepareOrbitCam(ctx) {
	const loop = ctx.loop;
	const pitches = pitchWindow(RadiansToDegrees(settlePitch(1)));
	if (loop.active && !orbitCamRuntime.sideView) orbitCamRuntime.inputYaw = orbitCamRuntime.yaw + orbitCamRuntime.autoYaw;
	orbitCamRuntime.sideView = loop.active;

	const yawBeforeInput = orbitCamRuntime.yaw;
	consumeLookInput(orbitCamRuntime, pitches.min, pitches.max, ctx.deltaSeconds);
	if (pitches.wrap) orbitCamRuntime.pitch = wrapDegrees(orbitCamRuntime.pitch);

	// Camera turns during a side view never steer.
	orbitCamRuntime.userTurned = orbitCamRuntime.yaw !== yawBeforeInput;
	if (loop.active) orbitCamRuntime.steerOffset += orbitCamRuntime.yaw - yawBeforeInput;

	// Steering yaw in radians, atan2(x, z), minus the side view's swing and turns made during it.
	const inputYaw = DegreesToRadians(orbitCamRuntime.inputYaw);
	return {
		control: "carried",
		basis  : { forward: loop.active ? { x: -Math.sin(inputYaw), y: 0, z: -Math.cos(inputYaw) } : ctx.cameraState.forward },
		yaw    : DegreesToRadians(orbitCamRuntime.yaw - orbitCamRuntime.steerOffset) + Math.PI,
		held   : loop.active,
	};
}

// Aims the arm; tight loops orbit the loop's center with the look on the player.
function updateOrbitCam(ctx) {
	const loop = ctx.loop;

	// Side-on: whenever the user isn't turning the camera, it eases back to the nearer end of the axis.
	if (loop.active && !orbitCamRuntime.userTurned && Math.abs(loop.axis.y) < Math.SQRT1_2) {
		const toAxis = wrapDegrees(RadiansToDegrees(Math.atan2(loop.axis.x, loop.axis.z)) - orbitCamRuntime.yaw - orbitCamRuntime.autoYaw);
		const toSide = Math.abs(toAxis) <= 90 ? toAxis : wrapDegrees(toAxis + 180);
		orbitCamRuntime.autoYaw += Math.sign(toSide) * Math.min(CAMERA_TUNING.Modes.Orbit.SideSwingSpeed.value * ctx.deltaSeconds, Math.abs(toSide) * ctx.follow);
	}

	const centered = ctx.cameraState.situation === "smallLoop";
	const spherical = orbitDirection();
	const aim = centered ? insideLoopCone(spherical, loop, rig.distance.value) : spherical;

	// Eased from where the camera sits; rotation never shortens the arm.
	const previousDirection = ResolveVector3Axis(SubtractVector3(ctx.cameraState.position, rig.pivot));
	rig.direction = ResolveVector3Axis(LerpVector3(previousDirection, aim, ctx.follow));
	rollToward(WORLD_NORMALS.Up, ctx.deltaSeconds);

	// Check only the center ray for obstructions; the cone keeps clear of the loop walls.
	return aimedRig(rig.distance.value, centered ? loop.center : null, centered ? 0 : CAMERA_TUNING.Body.Radius.value, false, orbitTangent());
}

/* === CHASE CAM & SIDE CAM (Trail your facing, behind or to the side; freedom narrows with speed) === */

// Look yaw allowed off the trail at speed share `s`, and the level's pitch window around the settle; radians.
function chaseFreedom(s) {
	const pitches = pitchWindow(RadiansToDegrees(chaseRuntime.settle));
	return {
		yaw     : Lerp(Math.PI, CAMERA_TUNING.Modes.Chase.MaxNarrowedYaw.toRadians(), s),
		minPitch: DegreesToRadians(pitches.min),
		maxPitch: DegreesToRadians(pitches.max),
		top     : DegreesToRadians(pitches.top),
		bottom  : DegreesToRadians(pitches.bottom),
		wrap    : pitches.wrap,
	};
}

// Look away, resisted by `share` as `offset` nears `limit`; turning back stays free.
function stiffen (delta, offset, limit, share) {
	return Math.sign(delta) === Math.sign(offset)
		? delta * (1 - share * Math.pow(Math.min(1, Math.abs(offset) / limit), CAMERA_TUNING.Modes.Chase.LookResistance)) 
		: delta;
}

// The arm's pitch against `up`, carried past ±90° once look takes it over; radians.
function chasePitch(up) {
	const pitch = armPitch(up);
	return chaseRuntime.flipped ? (Math.sign(pitch) || 1) * Math.PI - pitch : pitch;
}

// The heading look and follow turn from; behind the arm once look takes it over.
function chaseHeading(cameraState, up) {
	const heading = armHeading(cameraState, up);
	return chaseRuntime.flipped ? ScaleVector3(heading, -1) : heading;
}

// Turn carrying `heading` onto the trail: `side` radians off behind `facing`, about `up`.
function gapToTrail(heading, facing, up, side) {
	const trail = armAt(ScaleVector3(ResolveVector3Axis(facing), -1), side, 0, up);
	return Math.atan2(DotVector3(CrossVector3(heading, trail), up), DotVector3(heading, trail));
}

// sideCam trails the side of your facing nearest the arm; chaseCam trails behind.
function pickSide(heading, facing, up) {
	chaseRuntime.repick = false;
	chaseRuntime.side = chaseRuntime.mode === "sideCam" ? -(Math.sign(gapToTrail(heading, facing, up, 0)) || 1) * DegreesToRadians(90) : 0;
}

function initializeChase(ctx, mode) {
	chaseRuntime.mode = mode;
	chaseRuntime.sinceInput = Infinity;
	chaseRuntime.sinceChase = 0;
	chaseRuntime.returning = false;
	chaseRuntime.frozenBasis = null;
	chaseRuntime.side = 0;
	chaseRuntime.repick = false;
	chaseRuntime.settle = settlePitch(1);
	chaseRuntime.flipped = false;

	// Level start: on the trail, upright.
	takeOverRig(ctx, () => {
		const up = WORLD_NORMALS.Up;
		const facing = ProjectOntoPlane(ctx.target.facing, up);
		pickSide(armHeading(ctx.cameraState, up), facing, up);
		return armAt(ScaleVector3(ResolveVector3Axis(facing), -1), chaseRuntime.side, chaseRuntime.settle, up);
	});
	if (ctx.from !== null) pickSide(armHeading(ctx.cameraState, rig.up), ProjectOntoPlane(ctx.target.facing, rig.up), rig.up);

	Log("ENGINE", `${mode} initialized: distance=${rig.distance.value}, heightOffset=${rig.heightOffset.value}, side=${RadiansToDegrees(chaseRuntime.side).toFixed(0)}, sensitivity=${lookInput.sensitivity}`, "log", "Level");
}

// Look within the speed's freedom; then the input basis, or a loopControls lock.
function prepareChase(ctx) {
	if (ctx.leftLoop) {
		// Frozen from behind the facing, on its surface.
		const surfaceUp = ctx.target.alignedUp;
		chaseRuntime.returning = true;
		chaseRuntime.frozenBasis = { forward: ResolveVector3Axis(ProjectOntoPlane(ctx.target.facing, surfaceUp)), up: surfaceUp };
	}

	const loop = ctx.loop;
	const addons = ctx.set.addons[chaseRuntime.mode];

	// loopCam framing looks freely; its cone bounds the arm.
	const share = loop.active && addons.includes("loopCam") ? 0 : ctx.speedShare;
	const freedom = chaseFreedom(share);
	const startPitch = chasePitch(rig.up);
	const view = { yaw: 0, pitch: RadiansToDegrees(startPitch) };
	if (consumeLookInput(view, Math.min(RadiansToDegrees(freedom.minPitch), view.pitch), Math.max(RadiansToDegrees(freedom.maxPitch), view.pitch), ctx.deltaSeconds)) {
		chaseRuntime.sinceInput = 0;
		chaseRuntime.repick = true;

		// Look cancels a return.
		chaseRuntime.returning = false;
		chaseRuntime.frozenBasis = null;
		const heading = chaseHeading(ctx.cameraState, rig.up);
		const facing = ProjectOntoPlane(ctx.target.facing, rig.up);
		let yaw = DegreesToRadians(view.yaw);

		// Stiffens toward the speed's freedom; past it, look only turns back toward the trail.
		if (freedom.yaw < Math.PI && Vector3Length(facing) > EPSILON) {
			const gap = gapToTrail(heading, facing, rig.up, chaseRuntime.side);
			yaw = stiffen(yaw, -gap, freedom.yaw, 1);
			const allowed = Math.max(freedom.yaw, Math.abs(gap));
			yaw = gap - Clamp(gap - yaw, -allowed, allowed);
		}

		// Pitch stiffens toward the level's limits, more with speed.
		const offset = startPitch - chaseRuntime.settle;
		let pitch = startPitch + stiffen(DegreesToRadians(view.pitch) - startPitch, offset, offset > 0 ? freedom.top : freedom.bottom, share);
		if (freedom.wrap) pitch -= 2 * Math.PI * Math.round(pitch / (2 * Math.PI));
		chaseRuntime.flipped = Math.abs(pitch) > Math.PI / 2;
		rig.direction = armAt(heading, yaw, pitch, rig.up);
	}
	else chaseRuntime.sinceInput += ctx.deltaSeconds;

	// sideCam's keys map as if from behind you.
	const basis = chaseRuntime.returning ? chaseRuntime.frozenBasis : armBasis(ctx.cameraState, chaseRuntime.side);
	if (!addons.includes("loopControls") || !(loop.active || ctx.cameraState.situation === "slope")) return { control: "free", basis };
	
	// Locked to the loop's axis, or the slope's fall line.
	return {
		control          : "loopLock",
		axis             : loop.active ? loop.axis : ResolveVector3Axis(ProjectOntoPlane(WORLD_NORMALS.Down, ctx.target.alignedUp)),
		view             : ctx.cameraState.forward,
		coastGravityScale: CAMERA_TUNING.Loops.CoastGravity,
		basis,
	};
}

// Rolls, trails your facing and narrows to the speed's freedom; loopCam frames loops instead.
function updateChase(ctx) {
	const { Gravity, Correction } = CONFIG.Physics;
	const { Look, Loops, Modes, Body } = CAMERA_TUNING;

	const loop = ctx.loop;
	const target = ctx.target;
	const addons = ctx.set.addons[chaseRuntime.mode];
	const settled = chaseRuntime.sinceInput >= Look.ReturnDelayMs / 1000;
	const up = rig.up;

	// loopCam: upright, eased onto the loop's axis, fitted to it; the side re-picks after.
	if (loop.active && addons.includes("loopCam")) {
		chaseRuntime.sinceChase = 0;
		chaseRuntime.repick = true;
		chaseRuntime.flipped = false;
		rollToward(WORLD_NORMALS.Up, ctx.deltaSeconds);

		// Zooms out with speed, from the ceiling's grip speed up to top speed. Speed is read at the loop's bottom so it doesn't swing.
		const { waterFloatiness, airFloatiness, maxSpeed } = target.character.meta;

		const floatiness = target.underwater ? waterFloatiness : airFloatiness;
		const fall = (Gravity.Strength.value * target.gravityScale - target.buoyancyForce) / floatiness;
		const height = target.transform.position.y - (loop.center.y - loop.radius);
		const bottomSpeed = Math.sqrt(
			Math.max(0, Vector3Length(ProjectOntoPlane(target.velocity, target.alignedUp)) ** 2 + 2 * fall * height)
		);

		const ceilingGrip = Correction.MinGripSpeed[target.underwater ? "Water" : "Air"];
		const fitDistance = (Loops.TightFraming * loop.radius) / Math.sin(DegreesToRadians(ctx.cameraState.fov) / 2);
		const speedZoom = 1 + (Loops.SpeedZoom - 1) * Clamp01((bottomSpeed / maxSpeed - ceilingGrip) / (1 - ceilingGrip));
		const scaledDistance = fitDistance * speedZoom;
		
		const aim = settled ? loopSide(rig.direction, loop) : insideLoopCone(rig.direction, loop, scaledDistance);
		rig.direction = ResolveVector3Axis(LerpVector3(rig.direction, aim, ctx.follow));
		
		// Check only the center ray for obstructions; the cone keeps clear of the loop walls.
		return aimedRig(scaledDistance, loop.center, 0, false, rig.up);
	}

	// Rolls with the surface in loops and on any real incline but a small loop's, unless an addon excludes it.
	const inclined = target.grounded && AngleBetweenVector3(target.alignedUp, WORLD_NORMALS.Up) > DegreesToRadians(Correction.FlatSnapDegrees);
	const rolls = ctx.cameraState.looping 
		? !addons.includes("noLoopRoll")
		: inclined && !ctx.onSmallLoop && !addons.includes("noSlopeRoll") && !(ctx.onRamp && addons.includes("noRampRoll"));
	rollToward(rolls ? target.alignedUp : WORLD_NORMALS.Up, ctx.deltaSeconds);
	// Height lowers with an incline's roll and flips below an upside-down model; held while you look.
	if (settled) chaseRuntime.settle = settlePitch((ctx.cameraState.looping ? 1 : Math.max(0, Math.cos(AngleBetweenVector3(up, WORLD_NORMALS.Up)))) * modelFlip(ctx));

	// Follows while you move, or returning from a loop at any speed, once the look delay has passed.
	const facing = ProjectOntoPlane(target.facing, up);
	const facingKnown = Vector3Length(facing) > EPSILON;
	const following = facingKnown && (ctx.speedShare > EPSILON || chaseRuntime.returning) && settled;
	chaseRuntime.sinceChase = following ? chaseRuntime.sinceChase + ctx.deltaSeconds : 0;

	if (facingKnown) {
		const heading = chaseHeading(ctx.cameraState, up);
		if (chaseRuntime.repick && settled) pickSide(heading, facing, up);
		const trail = 1 - Math.exp(-ctx.deltaSeconds * Modes.Chase.TrailStrength / (250 / 1000));

		// Trails the facing, scaled by speed; ramps in over FollowRampMs after a look.
		const strength = chaseRuntime.returning ? 1 : Math.pow(ctx.speedShare, 0.5);
		const step = following ? trail * SmoothStep(0, Modes.Chase.FollowRampMs / 1000, chaseRuntime.sinceChase) * strength : 0;

		// Around and up apart, so a half turn orbits onto the trail instead of passing overhead.
		const gap = gapToTrail(heading, facing, up, chaseRuntime.side);
		const pitch = chasePitch(up);
		let turn = gap * step;
		let nextPitch = pitch + (chaseRuntime.settle - pitch) * step;
		
		// Look past the speed's freedom eases back in.
		const freedom = chaseFreedom(ctx.speedShare);
		const left = gap - turn;
		
		if (Math.abs(left) > freedom.yaw) turn += Math.sign(left) * (Math.abs(left) - freedom.yaw) * trail;
		nextPitch += (Clamp(nextPitch, freedom.minPitch, freedom.maxPitch) - nextPitch) * trail;
		chaseRuntime.flipped = Math.abs(nextPitch) > Math.PI / 2;
		rig.direction = armAt(heading, turn, nextPitch, up);
		if (chaseRuntime.returning && Math.abs(gap - turn) < DegreesToRadians(5)) chaseRuntime.returning = false;
	}

	// The arm's way up along its pitch arc; points down past the top.
	return aimedRig(
		rig.distance.value * (ctx.cameraState.situation === "largeLoop" ? Loops.LargeLoopZoom : 1), 
		null, Body.Radius.value, 
		true, armAt(chaseHeading(ctx.cameraState, up), 0, chasePitch(up) + Math.PI / 2, up)
	);
}

/* === MODES === */

// Rig modes aim an arm that Master.js places; free places itself.
const CAMERA_MODES = {
	orbitCam: { rig: true,  initialize: initializeOrbitCam,                        prepare: prepareOrbitCam, update: updateOrbitCam, handleInput: handleRigInput     },
	freeCam : { rig: false, initialize: initializeFreeCam,                         prepare: prepareFreeCam,  update: updateFreeCam,  handleInput: handleFreeCamInput },
	chaseCam: { rig: true,  initialize: (ctx) => initializeChase(ctx, "chaseCam"), prepare: prepareChase,    update: updateChase,    handleInput: handleRigInput     },
	sideCam : { rig: true,  initialize: (ctx) => initializeChase(ctx, "sideCam"),  prepare: prepareChase,    update: updateChase,    handleInput: handleRigInput     },
};

// Level start: fresh look input, the level's framing and freeCam speed, and the arm on the opening view.
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

// Simulator framing; the zoom range scales with it.
function SetOrbitCamFraming({ distance, heightOffset }) {
	const scale = distance / rig.distanceRange.default.value;
	rig.distanceRange.min.value *= scale;
	rig.distanceRange.max.value *= scale;
	rig.distanceRange.default.value = distance;
	rig.distance.value = distance;
	rig.heightOffset.value = heightOffset;
	rig.currentDistance.value = distance;
	rig.targetDistance.value = distance;
	orbitCamRuntime.pitch = RadiansToDegrees(settlePitch(1));
}

/* === EXPORTS === */

export { CAMERA_MODES, AimPoint, ResetCameraModes, SetOrbitCamFraming };
