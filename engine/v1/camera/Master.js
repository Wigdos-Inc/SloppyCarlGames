// Runs the camera: picks the active mode from the level's camera set each frame, then places it.

// Used by handlers/game/Level.js and Simulator.js around the player and physics updates, and by Controls.js for camera input.
// Uses camera/Sets.js to resolve the level's set and camera/Modes.js for the modes.

import { CONFIG, CAMERA_TUNING } from "../core/config.js";
import { EPSILON, Log } from "../core/meta.js";
import {
	AbsoluteVector3,
	AddVector3,
	AngleBetweenVector3,
	AzimuthTurnVector3,
	CloneVector3,
	CrossVector3,
	DotVector3,
	LerpVector3,
	ResolveVector3Axis,
	RotateByEuler,
	ScaleVector3,
	SubtractVector3,
	ToVector3,
	Vector3Length,
	WORLD_NORMALS,
} from "../math/Vector3.js";
import { ProjectOntoPlane, RayAABBIntersect, RayAABBDetailedBoundsIntersect, RayDetailedBoundsIntersect } from "../math/Collision.js";
import { BroadphaseCollectCandidates, IsPointInSuppressingVoid, HostVoids } from "../physics/Collision.js";
import { Clamp, DegreesToRadians, Lerp, Unit, UnitVector3 } from "../math/Utilities.js";
import { PlayerHeight } from "../player/Master.js";
import { ResolveCameraSet } from "./Sets.js";
import { CAMERA_MODES, AimPoint, ResetCameraModes } from "./Modes.js";

// FreeCam overrides every mode only while global debug mode is on.
const freeCamOverride = () => CONFIG.Debug.All === true && CONFIG.Debug.Levels.FreeCam === true;

// Shapes the camera treats as ramps.
const rampShapes = new Set(["ramp-simple", "ramp-complex"]);

// Mode-shared loop progress tracking.
const loop = {
	running     : false,                           // The player is tilting around a loop surface
	active      : false,                           // The camera has engaged loop framing
	turned      : new Unit(0, "radians"),          // How far the player has tilted around the loop so far
	startUpY    : 1,                               // How upright the player stood when this run began (1 is flat ground)
	arc         : new Unit(0, "cnu"),              // Distance the player has travelled around the loop this run
	arcTurn     : new Unit(0, "radians"),          // How far the player tilted over their arc
	radius      : new Unit(0, "cnu"),              // Estimated from distance travelled per tilt
	axis        : ToVector3(0),                    // Line the loop curves around, like a wheel's axle
	center      : new UnitVector3(0, 0, 0, "cnu"), // Estimated loop center
	lastUp      : CloneVector3(WORLD_NORMALS.Up),  // The player's tilt last frame
	lastPosition: new UnitVector3(0, 0, 0, "cnu"), // The player's last position that counted as loop travel
};

// Camera trigger state: the forced mode, and which triggers the player is in or has fired.
const triggers = {
	forced : null,
	inside : new Set(),
	entered: new Set(),
	fired  : new Set(),
};

// Cached ramp check for the current ground surface.
const ground = { surfaceId: null, onRamp: false };

// Context handed to the active mode each step.
const frame = {
	cameraState : null,
	target      : null,
	set         : null,
	payloadMeta : null,
	loop,
	lastMode    : null,                                // Mode before this one, or null at level start
	leftLoop    : false,                               // A loop situation ended this frame
	speedShare  : 0,                                   // Surface speed as a share of top speed (0 to 1)
	onRamp      : false,
	onSmallLoop : false,                               // Standing on a loop surface too tight to count as large
	deltaSeconds: 0,
	follow      : 0,                                   // How far the pivot catches up to the target this frame (0 to 1)
	aimHeight   : 0,                                   // The level's look height, in character heights
	aimShare    : 0,                                   // Eased look height, which eases to body center in loops
};

// Mode the set picks for the current situation. A trigger release returns to it.
let setMode = null;

// Live camera position tracking.
let latestCameraPosition = null;

// End the loop run and reset its measurements.
function releaseLoop(reason) {
	if (loop.active) Log("ENGINE", `Loop released: ${reason}`, "log", "Level");
	loop.running       = false;
	loop.active        = false;
	loop.turned.value  = 0;
	loop.arc.value     = 0;
	loop.arcTurn.value = 0;
	loop.radius.value  = 0;
}

// Check whether the movement goes around the axis instead of along it (within an angle limit).
function travelsAround(velocity, axis, lean) {
	const along = DotVector3(velocity, axis);
	return Math.abs(along) < Vector3Length(SubtractVector3(velocity, ScaleVector3(axis, along))) * Math.tan(lean.toRadians());
}

// Check whether a tube runs along the axis (non-tubes always pass).
function alongTube(sceneGraph, surfaceId, position, axis) {
	const lines = sceneGraph.tubeCenterlines.get(surfaceId);
	if (lines === undefined) return true;

	// Find which way the tube runs at the closest point of its centerline.
	let closest = Infinity, tangent = null;
	for (const line of lines) for (let i = 0; i < line.length; i++) {
		const distance = Vector3Length(SubtractVector3(line[i], position));
		if (distance >= closest) continue;
		closest = distance;
		tangent = SubtractVector3(line[Math.min(i + 1, line.length - 1)], line[Math.max(i - 1, 0)]);
	}

	// Within 45° counts.
	return Math.abs(DotVector3(ResolveVector3Axis(tangent), axis)) >= Math.SQRT1_2;
}

// Track the player's progress around a loop each frame.
function trackLoop(playerState, sceneGraph) {
	const { Player, ExitLeanGrace } = CAMERA_TUNING.Loops;
	const { alignedUp, transform, physicsRuntime, underwater, grounded, contactGrace, velocity, character } = playerState;

	// Turn the axis with heading changes, keeping only the leftover tilt.
	const bend = AzimuthTurnVector3(loop.lastUp, alignedUp);
	const bent = RotateByEuler(loop.lastUp, bend);
	if (loop.running) loop.axis = RotateByEuler(loop.axis, bend);

	const turn = AngleBetweenVector3(bent, alignedUp);
	const moved = SubtractVector3(transform.position, loop.lastPosition);

	// Movement around the loop axis, ignoring movement along it.
	const around = loop.running ? SubtractVector3(moved, ScaleVector3(loop.axis, DotVector3(moved, loop.axis))) : moved;
	const medium = underwater ? "Water" : "Air";
	const onLoop = grounded && sceneGraph.loopSurfaces[medium].has(physicsRuntime.groundSurfaceId);

	// Pick a reason to release the loop, or null to keep it.
	const release = !grounded && contactGrace <= EPSILON ? "lost ground" : grounded && !onLoop 
		? "left loop surface"
		: Vector3Length(ProjectOntoPlane(velocity, alignedUp)) < 0.5 * CONFIG.Physics.Correction.MinGripSpeed[medium] * character.meta.maxSpeed.value
			? "too slow to grip" : loop.radius.value > 0 && Vector3Length(moved) > ExitLeanGrace * loop.radius.value
				? "ran straight" : null;

	// Track whether this frame made loop progress.
	let progressed = false;
	if (release) releaseLoop(release);
	else if (onLoop && turn > EPSILON) {
		const frameAxis = ResolveVector3Axis(CrossVector3(bent, alignedUp));
		if (!loop.running) {
			loop.running = true;
			loop.axis = frameAxis;
			loop.startUpY = loop.lastUp.y;
		}

		// Count cresting or curving back against the loop's turn.
		const along = DotVector3(SubtractVector3(alignedUp, bent), around) > 0 ? -turn : turn * DotVector3(frameAxis, loop.axis);

		// Estimate the radius from distance travelled per angle turned.
		if (along > 0 && loop.turned.value > 0) {
			loop.arc.value += Vector3Length(around);
			loop.arcTurn.value += along;
			loop.radius.value = loop.arc.value / loop.arcTurn.value;
		}

		// Move the center along the axis with the player, and ease it across over half a lap.
		if (loop.active && along > 0) {
			const offset = SubtractVector3(AddVector3(transform.position, ScaleVector3(alignedUp, loop.radius.value)), loop.center);
			const axial = ScaleVector3(loop.axis, DotVector3(offset, loop.axis));
			loop.center.set(AddVector3(loop.center, AddVector3(axial, ScaleVector3(SubtractVector3(offset, axial), Math.min(1, along / Math.PI)))));
		}

		// Blend the axis toward this frame's turn, weighted over the last half lap.
		if (along > 0) {
			loop.axis = ResolveVector3Axis(AddVector3(ScaleVector3(loop.axis, Math.min(loop.turned.value, Math.PI)), ScaleVector3(frameAxis, along)));
		}
		loop.turned.value += along;
		progressed = along > 0 && travelsAround(playerState.velocity, loop.axis, loop.active ? Player.ExitLean : Player.EnterLean);
		if (loop.turned.value <= 0) releaseLoop("curved back or crested");
		else if (
			!loop.active &&
			loop.turned.value >= Player.EnterCurve.toRadians()
			&& Math.abs(loop.axis.y) < Math.SQRT1_2 && alignedUp.y < loop.startUpY
			&& travelsAround(playerState.velocity, loop.axis, Player.EnterLean)
			&& alongTube(sceneGraph, physicsRuntime.groundSurfaceId, transform.position, loop.axis)
		) {
			// Engage once the player has turned far enough around a loop.
			loop.center.set(AddVector3(transform.position, ScaleVector3(alignedUp, loop.radius.value)));
			loop.active = true;
			Log("ENGINE", `Loop engaged: axis=(${loop.axis.x.toFixed(2)}, ${loop.axis.y.toFixed(2)}, ${loop.axis.z.toFixed(2)})`, "log", "Level");
		}
	}
	else if (loop.active) {
		// Between curves, slide the center along the axis to keep up with the player.
		loop.center.set(AddVector3(loop.center, ScaleVector3(loop.axis, DotVector3(SubtractVector3(transform.position, loop.center), loop.axis))));
	}

	loop.lastUp = CloneVector3(alignedUp);
	if (progressed || !loop.running) loop.lastPosition.set(transform.position);
}

// Apply camera triggers when the player enters them.
function readCameraTriggers(playerState) {
	triggers.entered.clear();
	for (const item of playerState.activeTriggers) {
		if (item.trigger.type !== "camera") continue;

		const id = item.target.id;

		triggers.entered.add(id);
		if (triggers.inside.has(id) || triggers.fired.has(id)) continue;
		if (item.trigger.activateOnce) triggers.fired.add(id);

		const mode = item.trigger.payload.mode;
		triggers.forced = mode === "release" ? null : mode;
		Log("ENGINE", `Camera trigger ${id}: ${mode}`, "log", "Level");
	}

	// Keep this frame's triggers as the ones the player is inside.
	[triggers.inside, triggers.entered] = [triggers.entered, triggers.inside];
}

// Check terrain by its shape, and obstacles by all of their parts.
function isRampSurface(sceneGraph, surfaceId) {
	const mesh = sceneGraph.terrain.find((entry) => entry.id === surfaceId);
	if (mesh !== undefined) return rampShapes.has(mesh.shape);

	const obstacle = sceneGraph.obstacles.find((entry) => entry.id === surfaceId);
	return obstacle !== undefined && obstacle.parts.every((part) => rampShapes.has(part.shape));
}

// Measure speed along the surface as a share of top speed.
const surfaceSpeedShare = (playerState) => {
	return Clamp(Vector3Length(ProjectOntoPlane(playerState.velocity, playerState.alignedUp)) / playerState.character.meta.maxSpeed.value, 0, 1);
}

// Pick the camera situation: loop first, then slope, then speed.
function detectSituation(playerState, sceneGraph) {
	const surfaceId = playerState.physicsRuntime.groundSurfaceId;
	if (surfaceId !== ground.surfaceId) {
		ground.surfaceId = surfaceId;
		ground.onRamp = isRampSurface(sceneGraph, surfaceId);
	}
	frame.onRamp = ground.onRamp;

	trackLoop(playerState, sceneGraph);
	const largeLoopRadius = CAMERA_TUNING.Modes.Triggers.LargeLoopScale * PlayerHeight(playerState).value;

	// Check for a small loop surface, ignoring tubes that bend instead of loop.
	const tilt = ResolveVector3Axis(CrossVector3(WORLD_NORMALS.Up, playerState.alignedUp));
	const surfaceLoopRadius = sceneGraph.loopSurfaces[playerState.underwater ? "Water" : "Air"].get(surfaceId);
	frame.onSmallLoop = surfaceLoopRadius !== undefined && 
		surfaceLoopRadius.value < largeLoopRadius &&
		alongTube(sceneGraph, surfaceId, playerState.transform.position, tilt);

	// During a loop, treat a small loop as large once the player strays from it.
	if (loop.active) {
		const radius = loop.radius.value;
		return (
			radius > 0 &&
			radius < largeLoopRadius &&
			Vector3Length(SubtractVector3(playerState.transform.position, loop.center)) <= 2 * radius
		) ? "smallLoop" : "largeLoop";
	}

	// Pick slope on steep ground, otherwise pick by speed.
	const maxDelta = DegreesToRadians(CONFIG.Physics.Correction.MaxAngleDelta[playerState.underwater ? "Water" : "Air"].Ground);
	return playerState.grounded && AngleBetweenVector3(playerState.alignedUp, WORLD_NORMALS.Up) > maxDelta
		? "slope"
		: frame.speedShare >= CAMERA_TUNING.Modes.Triggers.FastSpeedFraction ? "fastMovement" : "slowMovement";
}

// Switch modes, starting the new one from the current camera.
function activateMode(mode) {
	frame.lastMode = frame.cameraState.activeMode;
	CAMERA_MODES[mode].initialize(frame);
	frame.cameraState.activeMode = mode;
	Log("ENGINE", `Camera mode activated: ${mode} (${frame.cameraState.situation})`, "log", "Level");
}

function GetCameraPosition() {
	return latestCameraPosition === null 
		? Log("ENGINE", "GetCameraPosition can only be used while in a level", "error", "Level") 
		: latestCameraPosition;
}

// Aim the starting camera from the level opening at the world's center.
function resolveDefaultLevelCamera(sceneGraph) {
	const { length, height, width } = sceneGraph.world;
	const target   = new UnitVector3(length.value * 0.5, height.value * 0.5, width.value * 0.5, "cnu");
	const position = sceneGraph.cameraConfig.levelOpening.startPosition.clone();
	const forward  = ResolveVector3Axis(SubtractVector3(target, position));
	const right    = ResolveVector3Axis(CrossVector3(forward, WORLD_NORMALS.Up));
	const up       = ResolveVector3Axis(CrossVector3(right, forward));

	return {
		position, target, forward, right, up,
		near: new Unit(0.1, "cnu"),
		far : new Unit(length.value + width.value + height.value, "cnu"),
	};
}

// Find the nearest obstruction along the camera arm.
function checkCameraObstruction(origin, desiredCamPos, sceneGraph, radius, bodyAabb) {
	const ray    = SubtractVector3(desiredCamPos, origin);
	const rayLen = Vector3Length(ray);
	if (rayLen < 0.01) return { obstructed: false, clippedDistance: rayLen };

	let closestT = rayLen, obstructed = false;

	// Surround the center ray with four offset rays.
	const dir     = ResolveVector3Axis(ray);
	const side    = ResolveVector3Axis(CrossVector3(dir, Math.abs(dir.y) < 0.9 ? WORLD_NORMALS.Up : WORLD_NORMALS.Right));
	const lift    = CrossVector3(side, dir);
	const origins = [origin];
	if (radius > 0) [side, lift].forEach((axis) => origins.push(AddVector3(origin, ScaleVector3(axis, radius)), AddVector3(origin, ScaleVector3(axis, -radius))));

	const boomAabb = {
		min: origin.clone().min(desiredCamPos).subtract(ToVector3(radius)),
		max: origin.clone().max(desiredCamPos).add(ToVector3(radius)),
	};
	const candidates = BroadphaseCollectCandidates(sceneGraph, boomAabb, false, false);

	for (const rayOrigin of origins) for (const candidate of candidates) {
		let hit;
		if (candidate.type === "voidWall") {
			// Check whether the ray's start reaches the box.
			if (!RayAABBIntersect(rayOrigin, dir, candidate.aabb).hit) continue;
			hit = RayDetailedBoundsIntersect(candidate.detailedBounds, rayOrigin, dir, closestT);
		} 
		else {
			hit = RayAABBDetailedBoundsIntersect(rayOrigin, dir, candidate.aabb, candidate.detailedBounds, closestT);
		}

		// Skip misses, hits from inside a shape, or anything past the closest hit so far.
		if (!hit.hit || hit.inside || hit.t <= 0 || hit.t >= closestT) continue;

		// Skip hits on parts of a surface that a void has cut away.
		if (candidate.type !== "voidWall") {
			if (IsPointInSuppressingVoid(
				AddVector3(rayOrigin, ScaleVector3(dir, hit.t)), 
				candidate.id, 
				HostVoids(sceneGraph, candidate.type === "terrain")
			)) {
				continue;
			}
		}

		closestT = hit.t;
		obstructed = true;
	}

	if (obstructed) {
		// Pull the camera in front of the hit, but never inside the target's body.
		const cameraRadius = CAMERA_TUNING.Body.Radius.value;
		const bodyReach = DotVector3(AbsoluteVector3(dir), SubtractVector3(bodyAabb.max, bodyAabb.min)) * 0.5;
		closestT = Math.max(cameraRadius + bodyReach, closestT - cameraRadius);
	}

	return { obstructed, clippedDistance: closestT };
}

// Snap the arm in on obstruction, and ease it back out once clear.
function settleArmDistance(runtime, { obstructed, clippedDistance }, scaledDistance, deltaSeconds) {
	const walls = CAMERA_TUNING.Walls;
	if (obstructed) {
		runtime.obstructionClear = 0;
		runtime.targetDistance.value = clippedDistance;
		if (!runtime.obstructionLogged) {
			Log("ENGINE", `Camera obstruction detected at t=${clippedDistance.toFixed(2)}`, "log", "Level");
			runtime.obstructionLogged = true;
		}
	}
	else {
		// Wait out a short hold before zooming back out.
		runtime.obstructionClear += deltaSeconds;
		runtime.targetDistance.value = runtime.obstructionClear >= walls.ReturnDelayMs / 1000
			? scaledDistance
			: Math.min(runtime.currentDistance.value, scaledDistance);
		runtime.obstructionLogged = false;
	}

	// Smooth distance interpolation.
	const rate = obstructed ? 100 * walls.ZoomStrength : 4 * walls.ReturnStrength;
	runtime.currentDistance.math(Lerp, runtime.targetDistance.value, Math.min(1, rate * deltaSeconds));
}

// Place the camera on a mode's rig: aim, wall check, pivot lag, then view vectors.
function placeOnRig({ runtime, scaledDistance, center: rigCenter, radius, holdArm, tangent }, sceneGraph, simulating) {
	const { cameraState, target, deltaSeconds, follow } = frame;
	const { direction, up } = runtime;

	// Aim straight at the Simulator target, which has no body.
	const targetPoint = simulating ? target.transform.position.clone() : AimPoint(frame);

	const center = rigCenter ?? targetPoint;
	const desiredPos = center.clone().add(ScaleVector3(direction, scaledDistance));

	// Skip the wall check in the Simulator, where the target sits inside its own bounds.
	settleArmDistance(runtime, simulating
		? { obstructed: false, clippedDistance: scaledDistance }
		: checkCameraObstruction(center, desiredPos, sceneGraph, radius, target.collision.aabb),
	scaledDistance, deltaSeconds);

	// Lag the pivot behind the target to stretch the arm with speed.
	runtime.pivot.set(LerpVector3(runtime.pivot, center, follow));

	// Keep held arms from stretching with vertical lag.
	let reach = runtime.currentDistance.value;
	if (holdArm) {
		const lag       = SubtractVector3(center, runtime.pivot);
		const level     = ProjectOntoPlane(lag, up);
		const flatLag   = Vector3Length(level) > EPSILON ? ScaleVector3(ResolveVector3Axis(level), Vector3Length(lag)) : level;
		const flatReach = Vector3Length(SubtractVector3(ScaleVector3(direction, reach), flatLag));
		const along     = DotVector3(lag, direction);
		reach = along + Math.sqrt(Math.max(0, flatReach ** 2 - DotVector3(lag, lag) + along ** 2));
	}
	cameraState.position.set(AddVector3(runtime.pivot, ScaleVector3(direction, reach)));

	// Build the view from the arm, flipping up past the top of its arc.
	const look          = ResolveVector3Axis(SubtractVector3(targetPoint, cameraState.position));
	const viewUp        = DotVector3(ProjectOntoPlane(up, look), tangent) < 0 ? ScaleVector3(up, -1) : up;
	cameraState.forward = ScaleVector3(direction, -1);
	cameraState.right   = ResolveVector3Axis(CrossVector3(cameraState.forward, viewUp));
	cameraState.up      = ResolveVector3Axis(ProjectOntoPlane(viewUp, look));
	cameraState.target.set(targetPoint);
}

/**
 * Builds the level's camera state and starts the set's slowMovement mode.
 * @param {object | null} target — the player state, or null for a level without one.
 * @param {boolean} simulating — the Simulator runs plain orbitCam, whatever the set.
 */
function InitializeCameraState(sceneGraph, payloadMeta, target, simulating) {
	releaseLoop("camera reset");
	loop.lastUp = CloneVector3(target === null ? WORLD_NORMALS.Up : target.alignedUp);
	triggers.forced = null;
	triggers.inside.clear();
	triggers.fired.clear();
	ground.surfaceId = null;
	ground.onRamp = false;

	const levelBase = resolveDefaultLevelCamera(sceneGraph);
	const cameraState = { ...levelBase, activeSet: null, activeMode: null, situation: "slowMovement", looping: false, modeData: null };
	frame.set = ResolveCameraSet(sceneGraph.cameraConfig);
	frame.payloadMeta = payloadMeta;
	frame.cameraState = cameraState;
	frame.target = target;
	frame.leftLoop = false;
	frame.speedShare = 0;
	frame.onRamp = false;
	frame.aimHeight = sceneGraph.cameraConfig.aimHeight;
	frame.aimShare = sceneGraph.cameraConfig.aimHeight;
	cameraState.activeSet = frame.set.name;
	setMode = frame.set.situations.slowMovement;

	ResetCameraModes(sceneGraph.cameraConfig, levelBase);
	activateMode(freeCamOverride() ? "freeCam" : simulating ? "orbitCam" : setMode);
	latestCameraPosition = cameraState.position;
	return cameraState;
}

/**
 * Before movement: read triggers, detect the situation, pick the mode and read look input. Writes `cameraState.modeData` for Movement.
 * @param {object} target — the player state, or the Simulator's follow target while simulating.
 */
function PrepareCamera(sceneGraph, deltaSeconds, target, simulating) {
	const cameraState = frame.cameraState;
	const wasLooping = cameraState.looping;
	frame.target = target;
	frame.deltaSeconds = deltaSeconds;
	if (!simulating) {
		readCameraTriggers(target);
		frame.speedShare = surfaceSpeedShare(target);
		cameraState.situation = detectSituation(target, sceneGraph);
		cameraState.looping = cameraState.situation === "smallLoop" || cameraState.situation === "largeLoop";
	}
	frame.leftLoop = wasLooping && !cameraState.looping;

	// A custom set leaves unmapped situations on the running mode.
	if (cameraState.situation in frame.set.situations) setMode = frame.set.situations[cameraState.situation];
	const mode = freeCamOverride() ? "freeCam" : simulating ? "orbitCam" : triggers.forced !== null ? triggers.forced : setMode;
	if (mode !== cameraState.activeMode) activateMode(mode);
	cameraState.modeData = CAMERA_MODES[mode].prepare(frame);
}

/**
 * After physics: run the mode's aim, then place the camera for Render.
 * @param {object} target — the player state, or the Simulator's follow target while simulating.
 */
function UpdateCamera(sceneGraph, deltaSeconds, target, simulating) {
	frame.target = target;
	frame.deltaSeconds = deltaSeconds;
	frame.follow = Math.min(1, 15 * CAMERA_TUNING.Body.LagStrength * deltaSeconds);
	if (!simulating) frame.speedShare = surfaceSpeedShare(target);
	
	frame.aimShare = Lerp(frame.aimShare, frame.cameraState.looping ? 0.5 : frame.aimHeight, frame.follow);

	const mode = CAMERA_MODES[frame.cameraState.activeMode];
	const rig = mode.update(frame);
	if (mode.rig) placeOnRig(rig, sceneGraph, simulating);
}

// Pass camera input to the active mode.
const HandleCameraInput =(event) => CAMERA_MODES[frame.cameraState.activeMode].handleInput(event);

export { InitializeCameraState, PrepareCamera, UpdateCamera, HandleCameraInput, GetCameraPosition };
