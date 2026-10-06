// Runs the camera: picks the active mode from the level's camera set each frame, then places it.

// Used by handlers/game/Level.js and Simulator.js around the player and physics updates, and by Controls.js for camera input.
// Uses camera/Sets.js to resolve the level's set and camera/Modes.js for the modes.

import { CONFIG, CAMERA_TUNING } from "../core/config.js";
import { EPSILON, Log } from "../core/meta.js";
import {
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
import { BroadphaseCollectCandidates, IsPointInSuppressingVoid } from "../physics/Collision.js";
import { Clamp, DegreesToRadians, Lerp, Unit, UnitVector3 } from "../math/Utilities.js";
import { PlayerHeight } from "../player/Master.js";
import { ResolveCameraSet } from "./Sets.js";
import { CAMERA_MODES, AimPoint, ResetCameraModes } from "./Modes.js";

// FreeCam overrides every mode only while global debug mode is on.
const freeCamOverride = !!(CONFIG.Debug.All === true && CONFIG.Debug.Levels.FreeCam === true);

const rampShapes = new Set(["ramp-simple", "ramp-complex"]);

// Loop the player is running, shared by the modes.
const loop = {
	running         : false,
	active          : false,
	turned          : 0,                               // Net radians of up turn about the axis
	startUpY        : 1,                               // Up's height where this run began
	arc             : 0,                               // Travel around the axis this run
	arcTurn         : 0,                               // Turn that arc covers
	radius          : 0,                               // arc / arcTurn
	axis            : ToVector3(0),
	center          : new UnitVector3(0, 0, 0, "cnu"),
	previousUp      : CloneVector3(WORLD_NORMALS.Up),
	previousPosition: new UnitVector3(0, 0, 0, "cnu"), // Held between curves
};

// Camera triggers: the mode they force, and which were inside or already fired.
const triggers = {
	forced : null,
	inside : new Set(),
	entered: new Set(),
	fired  : new Set(),
};

// Ground surface last checked for a ramp primitive.
const ground = { surfaceId: null, onRamp: false };

// Context handed to the active mode each step.
const frame = {
	cameraState : null,
	target      : null,
	set         : null,
	payloadMeta : null,
	loop,
	from        : null,                                // Mode being taken over from; null at level start
	leftLoop    : false,                               // A loop situation ended this frame
	speedShare  : 0,                                   // Speed along the surface over top speed, 0..1
	onRamp      : false,
	onSmallLoop : false,                               // Standing on a loop surface smaller than a large loop
	deltaSeconds: 0,
	follow      : 0,                                   // Pivot follow step this frame
	aimHeight   : 0,                                   // The level's look height, in character heights
	aimShare    : 0,                                 // Eased look height; body center in loops
};

// The set's mode for the latest situation it maps; what a trigger release returns to.
let setMode = null;
let latestCameraPosition = null;

function releaseLoop(reason) {
	if (loop.active) Log("ENGINE", `Loop released: ${reason}`, "log", "Level");
	loop.running = false;
	loop.active = false;
	loop.turned = 0;
	loop.arc = 0;
	loop.arcTurn = 0;
	loop.radius = 0;
}

// Travel leaning no more than `lean` along the axis.
const travelsAround = (velocity, axis, lean) => {
	const along = DotVector3(velocity, axis);
	return Math.abs(along) < Vector3Length(SubtractVector3(velocity, ScaleVector3(axis, along))) * Math.tan(lean.toRadians());
};

// Turn Tube loops about the centerline.
function alongTube(sceneGraph, surfaceId, position, axis) {
	const lines = sceneGraph.tubeCenterlines.get(surfaceId);
	if (lines === undefined) return true;

	let nearest = Infinity, tangent = null;
	for (const line of lines) for (let i = 0; i < line.length; i++) {
		const distance = Vector3Length(SubtractVector3(line[i], position));
		if (distance >= nearest) continue;
		nearest = distance;
		tangent = SubtractVector3(line[Math.min(i + 1, line.length - 1)], line[Math.max(i - 1, 0)]);
	}
	return Math.abs(DotVector3(ResolveVector3Axis(tangent), axis)) >= Math.SQRT1_2;
}

// Net turn of the player's up about one axis on loop surfaces decides a loop.
function trackLoop(playerState, sceneGraph) {
	const { Player, ExitLeanGrace } = CAMERA_TUNING.Loops;
	const { alignedUp, transform, physicsRuntime, underwater, grounded, velocity, character } = playerState, up = alignedUp;

	// Tube bend turns the axis; only the leftover tilt is loop travel.
	const bend = AzimuthTurnVector3(loop.previousUp, up);
	const bent = RotateByEuler(loop.previousUp, bend);
	if (loop.running) loop.axis = RotateByEuler(loop.axis, bend);

	const turn = AngleBetweenVector3(bent, up);
	const moved = SubtractVector3(transform.position, loop.previousPosition);

	// Travel around the loop's axis; a tube's bend along its length doesn't count.
	const around = loop.running ? SubtractVector3(moved, ScaleVector3(loop.axis, DotVector3(moved, loop.axis))) : moved;
	const medium = underwater ? "Water" : "Air";
	const onLoop = grounded && sceneGraph.loopSurfaces[medium].has(physicsRuntime.groundSurfaceId);

	// Why the camera lets go of the loop, if it does.
	const release = !grounded && contactGrace <= EPSILON ? "lost ground" : grounded && !onLoop 
		? "left loop surface"
		: Vector3Length(ProjectOntoPlane(velocity, alignedUp)) < 0.5 * CONFIG.Physics.Correction.MinGripSpeed[medium] * character.meta.maxSpeed 
			? "too slow to grip" : loop.radius > 0 && Vector3Length(moved) > ExitLeanGrace * loop.radius 
				? "ran straight" : null;

	// Progress: turning while travelling around; else it counts as running straight.
	let progressed = false;
	if (release) releaseLoop(release);
	else if (onLoop && turn > EPSILON) {
		const frameAxis = ResolveVector3Axis(CrossVector3(bent, up));
		if (!loop.running) {
			loop.running = true;
			loop.axis = frameAxis;
			loop.startUpY = loop.previousUp.y;
		}

		// Crests and curving back subtract.
		const along = DotVector3(SubtractVector3(up, bent), around) > 0 ? -turn : turn * DotVector3(frameAxis, loop.axis);
		if (along > 0 && loop.turned > 0) {
			loop.arc += Vector3Length(around);
			loop.arcTurn += along;
			loop.radius = loop.arc / loop.arcTurn;
		}

		// Center: settles across over half a lap, keeps pace along the axis.
		if (loop.active && along > 0) {
			const offset = SubtractVector3(AddVector3(transform.position, ScaleVector3(up, loop.radius)), loop.center);
			const axial = ScaleVector3(loop.axis, DotVector3(offset, loop.axis));
			loop.center.set(AddVector3(loop.center, AddVector3(axial, ScaleVector3(SubtractVector3(offset, axial), Math.min(1, along / Math.PI)))));
		}

		// The axis follows the last half lap.
		if (along > 0) {
			loop.axis = ResolveVector3Axis(AddVector3(ScaleVector3(loop.axis, Math.min(loop.turned, Math.PI)), ScaleVector3(frameAxis, along)));
		}
		loop.turned += along;
		progressed = along > 0 && travelsAround(playerState.velocity, loop.axis, loop.active ? Player.ExitLean : Player.EnterLean);
		if (loop.turned <= 0) releaseLoop("curved back or crested");

		// Engage: near-horizontal axis, climbing, travelling around it, along a tube's centerline.
		else if (
			!loop.active &&
			loop.turned >= Player.EnterCurve.toRadians()
			&& Math.abs(loop.axis.y) < Math.SQRT1_2 && up.y < loop.startUpY
			&& travelsAround(playerState.velocity, loop.axis, Player.EnterLean)
			&& alongTube(sceneGraph, physicsRuntime.groundSurfaceId, transform.position, loop.axis)
		) {
			// The center seeds from a radius settled over the whole engage turn.
			loop.center.set(AddVector3(transform.position, ScaleVector3(up, loop.radius)));
			loop.active = true;
			Log("ENGINE", `Loop engaged: axis=(${loop.axis.x.toFixed(2)}, ${loop.axis.y.toFixed(2)}, ${loop.axis.z.toFixed(2)})`, "log", "Level");
		}
	}
	// Between curves only the along-axis travel moves the center.
	else if (loop.active) loop.center.set(AddVector3(loop.center, ScaleVector3(loop.axis, DotVector3(SubtractVector3(transform.position, loop.center), loop.axis))));

	loop.previousUp = CloneVector3(up);
	if (progressed || !loop.running) loop.previousPosition.set(transform.position);
}

// Camera triggers act the frame they're entered; activateOnce ones fire once.
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
	[triggers.inside, triggers.entered] = [triggers.entered, triggers.inside];
}

// Ramp primitives: terrain meshes by shape, obstacles when every part is one.
function isRampSurface(sceneGraph, surfaceId) {
	const mesh = sceneGraph.terrain.find((entry) => entry.id === surfaceId);
	if (mesh !== undefined) return rampShapes.has(mesh.shape);

	const obstacle = sceneGraph.obstacles.find((entry) => entry.id === surfaceId);
	return obstacle !== undefined && obstacle.parts.every((part) => rampShapes.has(part.shape));
}

// Speed along the surface, as a share of top speed.
const surfaceSpeedShare = (playerState) => Clamp(Vector3Length(ProjectOntoPlane(playerState.velocity, playerState.alignedUp)) / playerState.character.meta.maxSpeed, 0, 1);

// Loop, then slope, then speed; a tight loop the player strays from counts as large.
function detectSituation(playerState, sceneGraph) {
	const surfaceId = playerState.physicsRuntime.groundSurfaceId;
	if (surfaceId !== ground.surfaceId) {
		ground.surfaceId = surfaceId;
		ground.onRamp = isRampSurface(sceneGraph, surfaceId);
	}
	frame.onRamp = ground.onRamp;

	trackLoop(playerState, sceneGraph);
	const largeLoopRadius = CAMERA_TUNING.Modes.Triggers.LargeLoopScale * PlayerHeight(playerState);

	// A tube's bend counts as a slope, not a loop.
	const tilt = ResolveVector3Axis(CrossVector3(WORLD_NORMALS.Up, playerState.alignedUp));
	frame.onSmallLoop = (sceneGraph.loopSurfaces[playerState.underwater ? "Water" : "Air"].get(surfaceId) ?? Infinity) < largeLoopRadius
		&& alongTube(sceneGraph, surfaceId, playerState.transform.position, tilt);
	if (loop.active) {
		return (
			loop.radius > 0 && 
			loop.radius < largeLoopRadius && 
			Vector3Length(SubtractVector3(playerState.transform.position, loop.center)) <= 2 * loop.radius
		) ? "smallLoop" : "largeLoop";
	}
	const maxDelta = CONFIG.Physics.Correction.MaxAngleDelta[playerState.underwater ? "Water" : "Air"].Ground;
	if (playerState.grounded && AngleBetweenVector3(playerState.alignedUp, WORLD_NORMALS.Up) > DegreesToRadians(maxDelta)) return "slope";
	return frame.speedShare >= CAMERA_TUNING.Modes.Triggers.FastSpeedFraction ? "fastMovement" : "slowMovement";
}

// The new mode starts from the current camera.
function activateMode(mode) {
	frame.from = frame.cameraState.activeMode;
	CAMERA_MODES[mode].initialize(frame);
	frame.cameraState.activeMode = mode;
	Log("ENGINE", `Camera mode activated: ${mode} (${frame.cameraState.situation})`, "log", "Level");
}

function GetCameraPosition() {
	return latestCameraPosition === null 
		? Log("ENGINE", "GetCameraPosition can only be used while in a level", "error", "Level") 
		: latestCameraPosition;
}

function resolveDefaultLevelCamera(sceneGraph) {
	const world = sceneGraph.world;
	const target = new UnitVector3(world.length.value * 0.5, world.height.value * 0.5, world.width.value * 0.5, "cnu");
	const position = sceneGraph.cameraConfig.levelOpening.startPosition.clone();
	const forward = ResolveVector3Axis(SubtractVector3(target, position));
	const right = ResolveVector3Axis(CrossVector3(forward, WORLD_NORMALS.Up));
	const up = ResolveVector3Axis(CrossVector3(right, forward));

	return {
		position, target, forward, right, up,
		fov: CONFIG.Camera.Fov,
		near: new Unit(0.1, "cnu"),
		far: new Unit(world.length.value + world.width.value + world.height.value, "cnu"),
	};
}

// Center ray plus four offset rays around the arm; nearest hit wins, never inside the target's body.
function checkCameraObstruction(origin, desiredCamPos, sceneGraph, radius, bodyAabb) {
	const ray = SubtractVector3(desiredCamPos, origin);
	const rayLen = Vector3Length(ray);
	if (rayLen < 0.01) return { obstructed: false, clippedDistance: rayLen };

	let closestT = rayLen;
	let obstructed = false;
	const dir = ResolveVector3Axis(ray);
	const side = ResolveVector3Axis(CrossVector3(dir, Math.abs(dir.y) < 0.9 ? WORLD_NORMALS.Up : WORLD_NORMALS.Right));
	const lift = CrossVector3(side, dir);
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
			// The ray's start can be inside the box, so only check that it reaches it.
			if (!RayAABBIntersect(rayOrigin, dir, candidate.aabb).hit) continue;
			hit = RayDetailedBoundsIntersect(candidate.detailedBounds, rayOrigin, dir, closestT);
		} else {
			hit = RayAABBDetailedBoundsIntersect(rayOrigin, dir, candidate.aabb, candidate.detailedBounds, closestT);
		}
		// Skip misses, hits from inside a shape, and anything past the closest hit so far.
		if (!hit.hit || hit.inside || hit.t <= 0 || hit.t >= closestT) continue;

		// Host surface carved away by a void is not a real obstruction.
		if (candidate.type !== "voidWall") {
			const voids = candidate.type === "terrain" ? sceneGraph.voids.terrain : sceneGraph.voids.obstacles;
			if (IsPointInSuppressingVoid(AddVector3(rayOrigin, ScaleVector3(dir, hit.t)), candidate.id, voids)) continue;
		}

		closestT = hit.t;
		obstructed = true;
	}

	if (obstructed) {
		// Closest reach: the camera's body clear of the target's extent along the arm.
		const cameraRadius = CAMERA_TUNING.Body.Radius.value;
		const { min, max } = bodyAabb;
		const bodyReach = 0.5 * (Math.abs(dir.x) * (max.x - min.x) + Math.abs(dir.y) * (max.y - min.y) + Math.abs(dir.z) * (max.z - min.z));
		closestT = Math.max(cameraRadius + bodyReach, closestT - cameraRadius);
	}

	return { obstructed, clippedDistance: closestT };
}

// Obstruction snaps the arm in; clear, it eases back out after the hold.
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
		// Zoom-out waits out the hold; zoom-in is immediate.
		runtime.obstructionClear += deltaSeconds;
		runtime.targetDistance.value = runtime.obstructionClear >= walls.ReturnDelayMs / 1000
			? scaledDistance
			: Math.min(runtime.currentDistance.value, scaledDistance);
		runtime.obstructionLogged = false;
	}

	// Smooth distance interpolation.
	const rate = obstructed ? 100 * walls.ZoomStrength : 4 * walls.ReturnStrength;
	runtime.currentDistance.value = Lerp(runtime.currentDistance.value, runtime.targetDistance.value, Math.min(1, rate * deltaSeconds));
}

// Places an aimed rig: target, obstruction, pivot lag, view. No collision while simulating (target inside its own bounds).
function placeOnRig({ runtime, scaledDistance, center: rigCenter, radius, holdArm, tangent }, sceneGraph, simulating) {
	const { cameraState, target, deltaSeconds, follow } = frame;
	const { direction, up } = runtime;
	// The Simulator's target has no body; it aims its own point.
	const targetPoint = simulating ? target.transform.position.clone() : AimPoint(frame);

	const center = rigCenter ?? targetPoint;
	const desiredPos = center.clone().add(ScaleVector3(direction, scaledDistance));
	settleArmDistance(runtime, simulating
		? { obstructed: false, clippedDistance: scaledDistance }
		: checkCameraObstruction(center, desiredPos, sceneGraph, radius, target.collision.aabb),
	scaledDistance, deltaSeconds);

	// Smooth follow (responsiveness > cinematic float): the pivot lags for velocity stretch.
	runtime.pivot.set(LerpVector3(runtime.pivot, center, follow));
	// Held arms: the lag's flat-ground distance.
	let reach = runtime.currentDistance.value;
	if (holdArm) {
		const lag = SubtractVector3(center, runtime.pivot);
		const level = ProjectOntoPlane(lag, up);
		const flatLag = Vector3Length(level) > EPSILON ? ScaleVector3(ResolveVector3Axis(level), Vector3Length(lag)) : level;
		const flatReach = Vector3Length(SubtractVector3(ScaleVector3(direction, reach), flatLag));
		const along = DotVector3(lag, direction);
		reach = along + Math.sqrt(Math.max(0, flatReach * flatReach - DotVector3(lag, lag) + along * along));
	}
	cameraState.position.set(AddVector3(runtime.pivot, ScaleVector3(direction, reach)));

	// View from the arm; up flips past the arc's top.
	const look = ResolveVector3Axis(SubtractVector3(targetPoint, cameraState.position));
	const viewUp = DotVector3(ProjectOntoPlane(up, look), tangent) < 0 ? ScaleVector3(up, -1) : up;
	cameraState.forward = ScaleVector3(direction, -1);
	cameraState.right = ResolveVector3Axis(CrossVector3(cameraState.forward, viewUp));
	cameraState.up = ResolveVector3Axis(ProjectOntoPlane(viewUp, look));
	cameraState.target.set(targetPoint);
}

/**
 * Builds the level's camera state and starts the set's slowMovement mode.
 * @param {object | null} target — the player state, or null for a level without one.
 * @param {boolean} simulating — the Simulator runs plain orbitCam, whatever the set.
 */
function InitializeCameraState(sceneGraph, payloadMeta, target, simulating) {
	releaseLoop("camera reset");
	loop.previousUp = CloneVector3(target === null ? WORLD_NORMALS.Up : target.alignedUp);
	triggers.forced = null;
	triggers.inside.clear();
	triggers.fired.clear();
	ground.surfaceId = null;
	ground.onRamp = false;

	const cameraConfig = sceneGraph.cameraConfig;
	const levelBase = resolveDefaultLevelCamera(sceneGraph);
	const cameraState = { ...levelBase, activeSet: null, activeMode: null, situation: "slowMovement", looping: false, modeData: null };
	frame.set = ResolveCameraSet(cameraConfig);
	frame.payloadMeta = payloadMeta;
	frame.cameraState = cameraState;
	frame.target = target;
	frame.leftLoop = false;
	frame.speedShare = 0;
	frame.onRamp = false;
	frame.aimHeight = cameraConfig.aimHeight;
	frame.aimShare = cameraConfig.aimHeight;
	cameraState.activeSet = frame.set.name;
	setMode = frame.set.situations.slowMovement;

	ResetCameraModes(cameraConfig, levelBase);
	activateMode(freeCamOverride ? "freeCam" : simulating ? "orbitCam" : setMode);
	latestCameraPosition = cameraState.position;
	return cameraState;
}

/**
 * Before movement: camera triggers, situation, set → mode, look input; writes `cameraState.modeData` for Movement.
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
	const mode = freeCamOverride ? "freeCam" : simulating ? "orbitCam" : triggers.forced !== null ? triggers.forced : setMode;
	if (mode !== cameraState.activeMode) activateMode(mode);
	cameraState.modeData = CAMERA_MODES[mode].prepare(frame);
}

/**
 * After physics: the mode's aim, then pivot lag, obstruction and the view vectors Render reads.
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

const HandleCameraInput = (event) => CAMERA_MODES[frame.cameraState.activeMode].handleInput(event);

export { InitializeCameraState, PrepareCamera, UpdateCamera, HandleCameraInput, GetCameraPosition };
