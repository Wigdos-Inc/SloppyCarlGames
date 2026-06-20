// Controls Camera State

// Receives camera instructions from Level.js and Cutscene.js
// Returns ready to use Camera State

import { CONFIG } from "../../core/config.js";
import { EPSILON, IsPointerLocked, Log, ReleasePointerLock, RequestPointerLock } from "../../core/meta.js";
import {
	AddVector3,
	SubtractVector3,
	CrossVector3,
	ResolveVector3Axis,
	ScaleVector3,
	Vector3Length,
	ToVector3,
	WORLD_NORMALS,
	LerpVector3,
} from "../../math/Vector3.js";
import { ClampVelocity, RayAABBIntersect, RayAABBDetailedBoundsIntersect, RayDetailedBoundsIntersect } from "../../math/Collision.js";
import { Lerp, Clamp, Unit, UnitVector3 } from "../../math/Utilities.js";
const pitchClampDegrees = 89;
// FreeCam must be explicitly enabled in levels and global debug mode must be on.
const freeCamEnabled = !!(CONFIG.DEBUG.ALL === true && CONFIG.DEBUG.LEVELS.FreeCam === true);

const distanceDefaults = {
	freeCamStartPosition: new UnitVector3(0, 20, 40, "cnu"),
	freeCamAcceleration: new Unit(44, "cnu"),
	freeCamMaxSpeed: new Unit(14, "cnu"),
	freeCamStartY: new Unit(20, "cnu"),
	freeCamStartZ: new Unit(40, "cnu"),
	freeCamFar: new Unit(800, "cnu"),

	defaultCamDistance: new Unit(10, "cnu"),
	defaultCamHeightOffset: new Unit(3, "cnu"),
	defaultCamCurrentDistance: new Unit(10, "cnu"),
	defaultCamTargetDistance: new Unit(10, "cnu"),
	defaultLevelMinY: new Unit(20, "cnu"),
	defaultLevelMinZ: new Unit(30, "cnu"),
	defaultLevelMinFar: new Unit(200, "cnu"),

	obstructionOffset: new Unit(0.3, "cnu"),
	obstructionMinDistance: new Unit(0.5, "cnu"),
};

const persistedFreeCamStates = new Map();
let latestCameraPosition = null;
const freeCamRuntime = {
	levelKey: null,
	keyState: {
		KeyW: false,
		KeyA: false,
		KeyS: false,
		KeyD: false,
		ArrowLeft: false,
		ArrowUp: false,
		ArrowDown: false,
		ArrowRight: false,
		Space: false,
		ShiftLeft: false,
		ShiftRight: false,
	},
	moveSensitivity: 0.12,
	tuningStep: 0,
	acceleration: distanceDefaults.freeCamAcceleration.clone(),
	dampingFactor: 0.12,
	maxSpeed: distanceDefaults.freeCamMaxSpeed.clone(),
	lookDeltaX: 0,
	lookDeltaY: 0,
	wheelDelta: 0,
};
const defaultCamRuntime = {
	active: false,
	yaw: 0,
	pitch: -15,
	currentDistance: distanceDefaults.defaultCamCurrentDistance.clone(),
	targetDistance: distanceDefaults.defaultCamTargetDistance.clone(),
	lookDeltaX: 0,
	lookDeltaY: 0,
	arrowKeyState: {
		ArrowLeft: false,
		ArrowRight: false,
		ArrowUp: false,
		ArrowDown: false,
	},
	arrowKeySpeed: 90,
	obstructionLogged: false,
	config: {
		distance: distanceDefaults.defaultCamDistance.clone(),
		sensitivity: 0.12,
		heightOffset: distanceDefaults.defaultCamHeightOffset.clone(),
		minPitch: -60,
		maxPitch: 60,
	},
};

const cacheCameraPosition = (cameraState) => latestCameraPosition = cameraState.position;

function getCurrentCameraPosition() {
	if (!latestCameraPosition) {
		Log("ENGINE", "window.camPos can only be used while in a level", "log", "Level");
		return null;
	}

	return latestCameraPosition;
}

if (CONFIG.DEBUG.ALL === true) window.camPos = getCurrentCameraPosition;

function createForwardFromAngles(yawDegrees, pitchDegrees) {
	const yaw = (yawDegrees * Math.PI) / 180;
	const pitch = (pitchDegrees * Math.PI) / 180;
	return ResolveVector3Axis({
		x: Math.cos(pitch) * Math.cos(yaw),
		y: Math.sin(pitch),
		z: Math.cos(pitch) * Math.sin(yaw),
	});
}

function createCameraState(source) {
	const pitch = Clamp(source.pitch, -pitchClampDegrees, pitchClampDegrees);
	const forward = createForwardFromAngles(source.yaw, pitch);
	const right = ResolveVector3Axis(CrossVector3(forward, WORLD_NORMALS.Up));

	return {
		position: source.position,
		yaw: source.yaw,
		pitch, forward, right,
		up: ResolveVector3Axis(CrossVector3(right, forward)),
		speed: freeCamRuntime.maxSpeed,
		velocity: new UnitVector3(0, 0, 0, "cnu"),
		mode: "freecam",
		target: source.position.clone().add(forward),
		fov: source.fov,
		near: source.near,
		far: source.far,
	};
}

function updateOrientationVectors(cameraState) {
	cameraState.forward = createForwardFromAngles(cameraState.yaw, cameraState.pitch);
	cameraState.right = ResolveVector3Axis(CrossVector3(cameraState.forward, WORLD_NORMALS.Up));
	cameraState.up = ResolveVector3Axis(CrossVector3(cameraState.right, cameraState.forward));
	cameraState.target.set(AddVector3(cameraState.position, cameraState.forward));
}

function resolveDefaultLevelCamera(sceneGraph, cameraConfig) {
	const wLength = sceneGraph.world.length.value;
	const wHeight = sceneGraph.world.height.value;
	const wWidth = sceneGraph.world.width.value;
	const target = new UnitVector3(
		wLength * 0.5,
		Math.max(0, wHeight * 0.35),
		wWidth * 0.5,
		"cnu"
	);
	const position = cameraConfig.levelOpening.startPosition.clone();
	const forward = ResolveVector3Axis(SubtractVector3(target, position));
	const right = ResolveVector3Axis(CrossVector3(forward, WORLD_NORMALS.Up));
	const up = ResolveVector3Axis(CrossVector3(right, forward));

	return {
		mode: "level",
		position, target, forward, right, up,
		fov: CONFIG.CAMERA.Fov,
		near: new Unit(0.1, "cnu"),
		far: new Unit(Math.max(distanceDefaults.defaultLevelMinFar.value, wLength + wWidth + wHeight), "cnu"),
	};
}


function applyTuningStep(step) {
	freeCamRuntime.tuningStep = Clamp(step, -6, 16);
	freeCamRuntime.maxSpeed.value = Clamp(14 + freeCamRuntime.tuningStep * 2.5, 3, 80);
	freeCamRuntime.acceleration.value = Clamp(44 + freeCamRuntime.tuningStep * 10, 10, 300);
	freeCamRuntime.dampingFactor = Clamp(0.08 + freeCamRuntime.tuningStep * 0.02, 0.05, 0.92);

	Log(
		"ENGINE",
		`FreeCam speed tuned: maxSpeed=${freeCamRuntime.maxSpeed.value.toFixed(1)}, acceleration=${freeCamRuntime.acceleration.value.toFixed(1)}, damping=${freeCamRuntime.dampingFactor.toFixed(2)}`,
		"log",
		"Level"
	);
}

function applyLookInput(cameraState, movementX, movementY) {
	cameraState.yaw += movementX * freeCamRuntime.moveSensitivity;
	cameraState.pitch = Clamp(
		cameraState.pitch - movementY * freeCamRuntime.moveSensitivity,
		-pitchClampDegrees,
		pitchClampDegrees
	);
	updateOrientationVectors(cameraState);
}

function HandleFreeCamInput(eventLike) {
	if (!freeCamEnabled) return false;

	switch (eventLike.type) {
		case "pointerdown": if (RequestPointerLock()) Log("ENGINE", "FreeCam pointer lock requested.", "log", "Level"); return true;
		case "wheel"      : freeCamRuntime.wheelDelta += eventLike.deltaY; return true;
		case "keydown"    :
			if (eventLike.code === "Escape") {
				ReleasePointerLock();
				return true;
			}
			if (eventLike.code in freeCamRuntime.keyState) {
				freeCamRuntime.keyState[eventLike.code] = true;
				return true;
			}
			return false;
		case "keyup":
			if (eventLike.code in freeCamRuntime.keyState) {
				freeCamRuntime.keyState[eventLike.code] = false;
				return true;
			}
			return false;
		case "mousemove":
			if (!IsPointerLocked()) return false;
			freeCamRuntime.lookDeltaX += eventLike.movementX;
			freeCamRuntime.lookDeltaY += eventLike.movementY;
			return true;
		default: return false;
	}
}

function getMoveDirectionFromKeys(cameraState) {
	let direction = ToVector3(0);
	const keyState = freeCamRuntime.keyState;
	if (keyState.KeyW) direction = AddVector3(direction, cameraState.forward);
	if (keyState.KeyS) direction = AddVector3(direction, ScaleVector3(cameraState.forward, -1));
	if (keyState.KeyD) direction = AddVector3(direction, cameraState.right);
	if (keyState.KeyA) direction = AddVector3(direction, ScaleVector3(cameraState.right, -1));
	if (keyState.Space) direction = AddVector3(direction, WORLD_NORMALS.Up);
	if (keyState.ShiftLeft || keyState.ShiftRight) direction = AddVector3(direction, ScaleVector3(WORLD_NORMALS.Up, -1));

	if (Vector3Length(direction) <= EPSILON) return ToVector3(0);
	return ResolveVector3Axis(direction);
}

function updateFreeCamState(cameraState, deltaSeconds) {
	if (freeCamRuntime.lookDeltaX !== 0 || freeCamRuntime.lookDeltaY !== 0) {
		applyLookInput(cameraState, freeCamRuntime.lookDeltaX, freeCamRuntime.lookDeltaY);
	}

	// Apply arrow key rotation.
	const ks = freeCamRuntime.keyState;
	const arrowSpeed = 90 * deltaSeconds;
	if (ks.ArrowLeft)  cameraState.yaw -= arrowSpeed;
	if (ks.ArrowRight) cameraState.yaw += arrowSpeed;
	if (ks.ArrowUp)    cameraState.pitch = Clamp(cameraState.pitch + arrowSpeed, -pitchClampDegrees, pitchClampDegrees);
	if (ks.ArrowDown)  cameraState.pitch = Clamp(cameraState.pitch - arrowSpeed, -pitchClampDegrees, pitchClampDegrees);

	if (freeCamRuntime.wheelDelta !== 0) {
		applyTuningStep(freeCamRuntime.tuningStep + (freeCamRuntime.wheelDelta < 0 ? 1 : -1));
	}

	updateOrientationVectors(cameraState);

	const inputDirection = getMoveDirectionFromKeys(cameraState);
	if (Vector3Length(inputDirection) > EPSILON) {
		cameraState.velocity.set(
			AddVector3(cameraState.velocity, ScaleVector3(inputDirection, freeCamRuntime.acceleration.value * deltaSeconds))
		);
	}
	else cameraState.velocity.scale(Math.pow(freeCamRuntime.dampingFactor, deltaSeconds * 60));

	if (Vector3Length(cameraState.velocity) > freeCamRuntime.maxSpeed.value) {
		cameraState.velocity.set(ClampVelocity(cameraState.velocity, freeCamRuntime.maxSpeed.value));
	}

	cameraState.position.add(ScaleVector3(cameraState.velocity, deltaSeconds));
	cameraState.speed.value = freeCamRuntime.maxSpeed.value;
	updateOrientationVectors(cameraState);

	freeCamRuntime.lookDeltaX = 0;
	freeCamRuntime.lookDeltaY = 0;
	freeCamRuntime.wheelDelta = 0;

	persistedFreeCamStates.set(freeCamRuntime.levelKey, cameraState);
	return cameraState;
}

/* === DEFAULT CAM (Third-Person Follow) === */

function initializeDefaultCamConfig(cameraConfig) {
	defaultCamRuntime.config.distance.value = cameraConfig.distance.value;
	defaultCamRuntime.config.sensitivity = cameraConfig.sensitivity;
	defaultCamRuntime.config.heightOffset.value = cameraConfig.heightOffset.value;
	defaultCamRuntime.currentDistance.value = defaultCamRuntime.config.distance.value;
	defaultCamRuntime.targetDistance.value = defaultCamRuntime.config.distance.value;
	defaultCamRuntime.yaw = 0;
	defaultCamRuntime.pitch = -15;
	defaultCamRuntime.lookDeltaX = 0;
	defaultCamRuntime.lookDeltaY = 0;
	Object.keys(defaultCamRuntime.arrowKeyState).forEach(key => { defaultCamRuntime.arrowKeyState[key] = false; });
	defaultCamRuntime.active = true;

	Log(
		"ENGINE",
		`DefaultCam initialized: distance=${defaultCamRuntime.config.distance.value}, heightOffset=${defaultCamRuntime.config.heightOffset.value}, sensitivity=${defaultCamRuntime.config.sensitivity}`,
		"log",
		"Level"
	);
}

function HandleDefaultCamInput(eventLike) {
	switch (eventLike.type) {
		case "pointerdown": if (RequestPointerLock()) Log("ENGINE", "DefaultCam pointer lock requested.", "log", "Level"); return true;
		case "keydown":
			if (eventLike.code === "Escape") { ReleasePointerLock(); return true; }
			if (eventLike.code in defaultCamRuntime.arrowKeyState) {
				defaultCamRuntime.arrowKeyState[eventLike.code] = true;
				return true;
			}
			return false;
		case "keyup":
			if (eventLike.code in defaultCamRuntime.arrowKeyState) {
				defaultCamRuntime.arrowKeyState[eventLike.code] = false;
				return true;
			}
			return false;
		case "mousemove":
			if (!IsPointerLocked()) return false;
			defaultCamRuntime.lookDeltaX += eventLike.movementX;
			defaultCamRuntime.lookDeltaY += eventLike.movementY;
			return true;
		default: return false;
	}
}

function checkCameraObstruction(playerHeadPos, desiredCamPos, sceneGraph) {
	const ray = SubtractVector3(desiredCamPos, playerHeadPos);
	const rayLen = Vector3Length(ray);
	if (rayLen < 0.01) return { obstructed: false, clippedDistance: rayLen };

	let closestT = rayLen;
	let obstructed = false;
	const testCandidate = (aabb, detailedBounds) => {
		const hit = RayAABBDetailedBoundsIntersect(playerHeadPos, ResolveVector3Axis(ray), aabb, detailedBounds, closestT);
		if (!hit.hit || hit.t <= 0 || hit.t >= closestT) return;

		closestT = hit.t;
		obstructed = true;
	};

	// Broadphase is AABB-only; obstruction only counts after detailed-bounds narrowphase.
	for (const mesh of sceneGraph.terrain)  testCandidate(mesh.worldAabb, mesh.detailedBounds);
	for (const obs of sceneGraph.obstacles) testCandidate(obs.worldAabb, obs.detailedBounds);
	// Void walls: origin may be inside the AABB, so we bypass RayAABBDetailedBoundsIntersect
	// (which caps the narrowphase at the AABB exit t, causing triangles exactly at the AABB
	// boundary to be rejected by floating-point). Use RayAABBIntersect as broadphase only,
	// then call RayDetailedBoundsIntersect directly with closestT as the limit.
	const voidDir = ResolveVector3Axis(ray);
	const testVoidBounds = (worldAabb, bounds) => {
		if (!RayAABBIntersect(playerHeadPos, voidDir, worldAabb).hit) return;
		const hit = RayDetailedBoundsIntersect(bounds, playerHeadPos, voidDir, closestT);
		if (!hit.hit || hit.t <= 0 || hit.t >= closestT) return;
		closestT = hit.t;
		obstructed = true;
	};
	const testVoidWalls = (entries) => {
		for (const entry of entries) for (const id in entry.relations) {
			for (const voidWall of entry.relations[id].voidWallMeshes) {
				testVoidBounds(voidWall.worldAabb, voidWall.wallBounds);
				if (voidWall.floorBounds.triangles.length > 0) testVoidBounds(voidWall.worldAabb, voidWall.floorBounds);
			}
		}
	};
	testVoidWalls(sceneGraph.voids.terrain);
	testVoidWalls(sceneGraph.voids.obstacles);

	if (obstructed) {
		closestT = Math.max(
			distanceDefaults.obstructionMinDistance.value,
			closestT - distanceDefaults.obstructionOffset.value
		);
	}

	return { obstructed, clippedDistance: closestT };
}

function updateDefaultCamState(cameraState, playerState, sceneGraph, deltaSeconds) {
	const cfg = defaultCamRuntime.config;

	// Apply mouse look.
	if (defaultCamRuntime.lookDeltaX !== 0 || defaultCamRuntime.lookDeltaY !== 0) {
		defaultCamRuntime.yaw -= defaultCamRuntime.lookDeltaX * cfg.sensitivity;
		defaultCamRuntime.pitch = Clamp(
			defaultCamRuntime.pitch + defaultCamRuntime.lookDeltaY * cfg.sensitivity,
			cfg.minPitch,
			cfg.maxPitch
		);
		defaultCamRuntime.lookDeltaX = 0;
		defaultCamRuntime.lookDeltaY = 0;
	}

	// Apply arrow key rotation.
	const arrowKeys = defaultCamRuntime.arrowKeyState;
	const arrowSpeed = defaultCamRuntime.arrowKeySpeed * deltaSeconds;
	if (arrowKeys.ArrowLeft)  defaultCamRuntime.yaw -= arrowSpeed;
	if (arrowKeys.ArrowRight) defaultCamRuntime.yaw += arrowSpeed;
	if (arrowKeys.ArrowUp)    defaultCamRuntime.pitch = Clamp(defaultCamRuntime.pitch + arrowSpeed, cfg.minPitch, cfg.maxPitch);
	if (arrowKeys.ArrowDown)  defaultCamRuntime.pitch = Clamp(defaultCamRuntime.pitch - arrowSpeed, cfg.minPitch, cfg.maxPitch);

	// Player position is a CNU UnitVector3 — access components directly.
	const playerPos = playerState.transform.position;

	// Camera target: player position + height offset.
	const targetPoint = {
		x: playerPos.x,
		y: playerPos.y + cfg.heightOffset.value,
		z: playerPos.z,
	};

	// Compute desired camera position using spherical coordinates.
	const yawRad = (defaultCamRuntime.yaw * Math.PI) / 180;
	const pitchRad = (defaultCamRuntime.pitch * Math.PI) / 180;

	const desiredPos = {
		x: playerPos.x + cfg.distance.value * Math.cos(pitchRad) * Math.sin(yawRad),
		y: playerPos.y + cfg.heightOffset.value + cfg.distance.value * Math.sin(pitchRad),
		z: playerPos.z + cfg.distance.value * Math.cos(pitchRad) * Math.cos(yawRad),
	};

	// Camera obstruction detection.
	const { obstructed, clippedDistance } = checkCameraObstruction(targetPoint, desiredPos, sceneGraph);

	if (obstructed) {
		defaultCamRuntime.targetDistance.value = clippedDistance;
		if (!defaultCamRuntime.obstructionLogged) {
			Log("ENGINE", `DefaultCam obstruction detected at t=${clippedDistance.toFixed(2)}`, "log", "Level");
			defaultCamRuntime.obstructionLogged = true;
		}
	}
	else {
		defaultCamRuntime.targetDistance.value = cfg.distance.value;
		if (defaultCamRuntime.obstructionLogged) defaultCamRuntime.obstructionLogged = false;
	}

	// Smooth distance interpolation.
	defaultCamRuntime.currentDistance.value = Lerp(
		defaultCamRuntime.currentDistance.value,
		defaultCamRuntime.targetDistance.value,
		Math.min(1, (obstructed ? 100 : 4) * deltaSeconds)
	);

	// Final camera position at current distance.
	const finalPos = {
		x: playerPos.x + defaultCamRuntime.currentDistance.value * Math.cos(pitchRad) * Math.sin(yawRad),
		y: playerPos.y + cfg.heightOffset.value + defaultCamRuntime.currentDistance.value * Math.sin(pitchRad),
		z: playerPos.z + defaultCamRuntime.currentDistance.value * Math.cos(pitchRad) * Math.cos(yawRad),
	};

	// Smooth camera position (responsiveness > cinematic float).
	const smoothedPos = LerpVector3(cameraState.position, finalPos, Math.min(1, 15 * deltaSeconds));

	// Compute forward/right/up from camera position looking at target.
	const forward = ResolveVector3Axis(SubtractVector3(targetPoint, smoothedPos));
	const right = ResolveVector3Axis(CrossVector3(forward, WORLD_NORMALS.Up));

	cameraState.position.set(smoothedPos);
	cameraState.forward = forward;
	cameraState.right = right;
	cameraState.up = ResolveVector3Axis(CrossVector3(right, forward));
	cameraState.target.set(targetPoint);
	cameraState.mode = "defaultcam";

	return cameraState;
}

const GetCameraVectors = () => { return { forward: latestCameraForward, right: latestCameraRight } };

let latestCameraForward = null;
let latestCameraRight = null;

function cacheCameraVectors(cameraState) {
	latestCameraForward = { ...cameraState.forward };
	latestCameraRight = { ...cameraState.right };
}

function computeInitialDefaultCamPosition(playerState, levelBase) {
	const cfg = defaultCamRuntime.config;
	const playerPos = playerState.transform.position;
	const yawRad = (defaultCamRuntime.yaw * Math.PI) / 180;
	const pitchRad = (defaultCamRuntime.pitch * Math.PI) / 180;

	const position = new UnitVector3(
		playerPos.x + cfg.distance.value * Math.cos(pitchRad) * Math.sin(yawRad),
		playerPos.y + cfg.heightOffset.value + cfg.distance.value * Math.sin(pitchRad),
		playerPos.z + cfg.distance.value * Math.cos(pitchRad) * Math.cos(yawRad),
		"cnu"
	);
	const target = new UnitVector3(
		playerPos.x,
		playerPos.y + cfg.heightOffset.value,
		playerPos.z,
		"cnu"
	);
	const forward = ResolveVector3Axis(SubtractVector3(target, position));
	const right = ResolveVector3Axis(CrossVector3(forward, WORLD_NORMALS.Up));

	return {
		position, target, forward, right,
		up: ResolveVector3Axis(CrossVector3(right, forward)),
		mode: "defaultcam",
		fov: levelBase.fov,
		near: levelBase.near,
		far: levelBase.far,
	};
}

function InitializeCameraState(sceneGraph, cameraConfig, payloadMeta, playerState) {
	if (!freeCamEnabled) {
		freeCamRuntime.levelKey = null;
		Object.keys(freeCamRuntime.keyState).forEach(key => { freeCamRuntime.keyState[key] = false; });
		freeCamRuntime.lookDeltaX = 0;
		freeCamRuntime.lookDeltaY = 0;
		freeCamRuntime.wheelDelta = 0;

		// Initialize DefaultCam (third-person follow).
		initializeDefaultCamConfig(cameraConfig);

		const levelBase = resolveDefaultLevelCamera(sceneGraph, cameraConfig);
		const state = playerState
			? computeInitialDefaultCamPosition(playerState, levelBase)
			: { ...levelBase, mode: "defaultcam" };
		cacheCameraPosition(state);
		cacheCameraVectors(state);
		Log("ENGINE", "DefaultCam mode activated.", "log", "Level");
		return state;
	}

	// Check if game uses stages at all and store key
	const levelKey = payloadMeta.stageId
		? `${payloadMeta.levelId}:${payloadMeta.stageId}`
		: payloadMeta.levelId;

	freeCamRuntime.levelKey = levelKey;

	const existing = persistedFreeCamStates.get(levelKey);
	if (existing) {
		cacheCameraPosition(existing);
		cacheCameraVectors(existing);
		return existing;
	}

	const base = resolveDefaultLevelCamera(sceneGraph, cameraConfig);
	const forward = ResolveVector3Axis(SubtractVector3(base.target, base.position));

	const created = createCameraState({
		position: base.position,
		yaw: (Math.atan2(forward.z, forward.x) * 180) / Math.PI,
		pitch: (Math.asin(Clamp(forward.y, -1, 1)) * 180) / Math.PI,
		fov: base.fov,
		near: base.near,
		far: base.far,
	});
	cacheCameraPosition(created);
	cacheCameraVectors(created);
	persistedFreeCamStates.set(levelKey, created);
	return created;
}

function UpdateCameraState(currentState, sceneGraph, cameraConfig, deltaSeconds, playerState) {
	const nextState = freeCamEnabled
		? updateFreeCamState(currentState, deltaSeconds)
		: updateDefaultCamState(currentState, playerState, sceneGraph, deltaSeconds);
	cacheCameraPosition(nextState);
	cacheCameraVectors(nextState);
	return nextState;
}

export { InitializeCameraState, UpdateCameraState, HandleFreeCamInput, HandleDefaultCamInput, GetCameraVectors };
