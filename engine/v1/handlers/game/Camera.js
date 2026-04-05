// Controls Camera State

// Receives camera instructions from Level.js and Cutscene.js
// Returns ready to use Camera State

// Module uses World Units instead of CNU for testing.

import { CONFIG } from "../../core/config.js";
import { EPSILON, IsPointerLocked, Log, RequestPointerLock } from "../../core/meta.js";
import {
	AddVector3,
	SubtractVector3,
	CrossVector3,
	ResolveVector3Axis,
	ScaleVector3,
	Vector3Length,
	ToVector3,
} from "../../math/Vector3.js";
import { ClampVelocity, RayAABBIntersect } from "../../math/Physics.js";
import { Lerp, Clamp, Unit, UnitVector3 } from "../../math/Utilities.js";

const worldUp = { x: 0, y: 1, z: 0 };
const pitchClampDegrees = 89;
// FreeCam must be explicitly enabled in levels and global debug mode must be on.
const freeCamEnabled = !!(CONFIG.DEBUG.ALL === true && CONFIG.DEBUG.LEVELS.FreeCam === true);

const worldDistanceDefaults = {
	freeCamStartPosition: new UnitVector3(0, 20, 40, "worldunit"),
	freeCamAcceleration: new Unit(44, "worldunit"),
	freeCamMaxSpeed: new Unit(14, "worldunit"),
	freeCamStartY: new Unit(20, "worldunit"),
	freeCamStartZ: new Unit(40, "worldunit"),
	freeCamFar: new Unit(800, "worldunit"),

	defaultCamDistance: new Unit(10, "worldunit"),
	defaultCamHeightOffset: new Unit(3, "worldunit"),
	defaultCamCurrentDistance: new Unit(10, "worldunit"),
	defaultCamTargetDistance: new Unit(10, "worldunit"),
	defaultLevelMinY: new Unit(20, "worldunit"),
	defaultLevelMinZ: new Unit(30, "worldunit"),
	defaultLevelMinFar: new Unit(200, "worldunit"),

	obstructionOffset: new Unit(0.3, "worldunit"),
	obstructionMinDistance: new Unit(0.5, "worldunit"),
};

const persistedFreeCamStates = new Map();
let latestCameraPosition = null;
const freeCamRuntime = {
	active: false,
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
	acceleration: worldDistanceDefaults.freeCamAcceleration.clone(),
	dampingFactor: 0.12,
	maxSpeed: worldDistanceDefaults.freeCamMaxSpeed.clone(),
	lookDeltaX: 0,
	lookDeltaY: 0,
	wheelDelta: 0,
};
const defaultCamRuntime = {
	active: false,
	yaw: 0,
	pitch: -15,
	currentDistance: worldDistanceDefaults.defaultCamCurrentDistance.clone(),
	targetDistance: worldDistanceDefaults.defaultCamTargetDistance.clone(),
	lookDeltaX: 0,
	lookDeltaY: 0,
	obstructionLogged: false,
	config: {
		distance: worldDistanceDefaults.defaultCamDistance.clone(),
		sensitivity: 0.12,
		heightOffset: worldDistanceDefaults.defaultCamHeightOffset.clone(),
		minPitch: -60,
		maxPitch: 60,
	},
};

function cacheCameraPosition(cameraState) {
	latestCameraPosition = cameraState.position;
}

function getCurrentCameraPosition() {
	if (!latestCameraPosition) {
		console.warn("window.camPos can only be used while in a level.");
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
	const right = ResolveVector3Axis(CrossVector3(forward, worldUp));

	return {
		position: source.position,
		yaw: source.yaw,
		pitch: pitch,
		forward: forward,
		right: right,
		up: ResolveVector3Axis(CrossVector3(right, forward)),
		speed: freeCamRuntime.maxSpeed,
		velocity: new UnitVector3(0, 0, 0, "worldunit"),
		mode: "freecam",
		target: source.position.clone().add(forward),
		fov: source.fov,
		near: source.near,
		far: source.far,
	};
}

function updateOrientationVectors(cameraState) {
	cameraState.forward = createForwardFromAngles(cameraState.yaw, cameraState.pitch);
	cameraState.right = ResolveVector3Axis(CrossVector3(cameraState.forward, worldUp));
	cameraState.up = ResolveVector3Axis(CrossVector3(cameraState.right, cameraState.forward));
	cameraState.target.set(AddVector3(cameraState.position, cameraState.forward));
}

function resolveDefaultLevelCamera(sceneGraph, cameraConfig) {
	const world = sceneGraph.world;
	const wLength = world.length.toWorldUnit();
	const wHeight = world.height.toWorldUnit();
	const wWidth = world.width.toWorldUnit();
	const center = new UnitVector3(
		wLength * 0.5,
		Math.max(0, wHeight * 0.35),
		wWidth * 0.5,
		"worldunit"
	);
	const position = cameraConfig.levelOpening.startPosition.toWorldUnit(true);
	const forward = ResolveVector3Axis(SubtractVector3(center, position));
	const right = ResolveVector3Axis(CrossVector3(forward, worldUp));
	const up = ResolveVector3Axis(CrossVector3(right, forward));

	return {
		mode: "level",
		position: position,
		target: center,
		forward: forward,
		right: right,
		up: up,
		fov: 60,
		near: new Unit(0.1, "worldunit"),
		far: new Unit(Math.max(worldDistanceDefaults.defaultLevelMinFar.value, wLength + wWidth + wHeight), "worldunit"),
	};
}

function createStationaryCameraState(sceneGraph, cameraConfig) {
	const base = resolveDefaultLevelCamera(sceneGraph, cameraConfig);
	const state = {
		...base,
		mode: "stationary",
	};
	cacheCameraPosition(state);
	cacheCameraVectors(state);
	return state;
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

function releasePointerLock() {
	if (!IsPointerLocked()) return true;
	document.exitPointerLock();
	Log("ENGINE", "FreeCam pointer lock released.", "log", "Level");
	return true;
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

	const eventCode = eventLike.code;

	switch (eventLike.type) {
		case "pointerdown":
			if (RequestPointerLock()) Log("ENGINE", "FreeCam pointer lock requested.", "log", "Level");
			return true;
		case "wheel":
			freeCamRuntime.wheelDelta += eventLike.deltaY;
			return true;
		case "keydown":
			if (eventCode === "Escape") {
				releasePointerLock();
				return true;
			}
			if (eventCode in freeCamRuntime.keyState) {
				freeCamRuntime.keyState[eventCode] = true;
				return true;
			}
			return false;
		case "keyup":
			if (eventCode in freeCamRuntime.keyState) {
				freeCamRuntime.keyState[eventCode] = false;
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
	if (keyState.KeyW || keyState.ArrowUp) direction = AddVector3(direction, cameraState.forward);
	if (keyState.KeyS || keyState.ArrowDown) direction = AddVector3(direction, ScaleVector3(cameraState.forward, -1));
	if (keyState.KeyD || keyState.ArrowRight) direction = AddVector3(direction, cameraState.right);
	if (keyState.KeyA || keyState.ArrowLeft) direction = AddVector3(direction, ScaleVector3(cameraState.right, -1));
	if (keyState.Space) direction = AddVector3(direction, worldUp);
	if (keyState.ShiftLeft || keyState.ShiftRight) direction = AddVector3(direction, ScaleVector3(worldUp, -1));

	if (Vector3Length(direction) <= EPSILON) return ToVector3(0);

	return ResolveVector3Axis(direction);
}

function updateFreeCamState(cameraState, deltaSeconds) {
	if (freeCamRuntime.lookDeltaX !== 0 || freeCamRuntime.lookDeltaY !== 0) {
		applyLookInput(cameraState, freeCamRuntime.lookDeltaX, freeCamRuntime.lookDeltaY);
	}

	if (freeCamRuntime.wheelDelta !== 0) {
		const direction = freeCamRuntime.wheelDelta < 0 ? 1 : -1;
		applyTuningStep(freeCamRuntime.tuningStep + direction);
	}

	updateOrientationVectors(cameraState);

	const inputDirection = getMoveDirectionFromKeys(cameraState);
	const hasInput = Vector3Length(inputDirection) > EPSILON;

	if (hasInput) {
		cameraState.velocity.set(
			AddVector3(
				cameraState.velocity,
				ScaleVector3(inputDirection, freeCamRuntime.acceleration.value * deltaSeconds)
			)
		);
	} 
	else cameraState.velocity.scale(Math.pow(freeCamRuntime.dampingFactor, deltaSeconds * 60));

	const speed = Vector3Length(cameraState.velocity);
	if (speed > freeCamRuntime.maxSpeed.value) {
		cameraState.velocity.set(ClampVelocity(cameraState.velocity, freeCamRuntime.maxSpeed.value));
	}

	cameraState.position.add(ScaleVector3(cameraState.velocity, deltaSeconds));
	cameraState.speed.value = freeCamRuntime.maxSpeed.value;
	updateOrientationVectors(cameraState);

	freeCamRuntime.lookDeltaX = 0;
	freeCamRuntime.lookDeltaY = 0;
	freeCamRuntime.wheelDelta = 0;

	if (freeCamRuntime.levelKey) persistedFreeCamStates.set(freeCamRuntime.levelKey, cameraState);
	return cameraState;
}

/* === DEFAULT CAM (Third-Person Follow) === */

function initializeDefaultCamConfig(cameraConfig) {
	defaultCamRuntime.config.distance.value = cameraConfig.distance.toWorldUnit();
	defaultCamRuntime.config.sensitivity = cameraConfig.sensitivity;
	defaultCamRuntime.config.heightOffset.value = cameraConfig.heightOffset.toWorldUnit();
	defaultCamRuntime.currentDistance.value = defaultCamRuntime.config.distance.value;
	defaultCamRuntime.targetDistance.value = defaultCamRuntime.config.distance.value;
	defaultCamRuntime.yaw = 0;
	defaultCamRuntime.pitch = -15;
	defaultCamRuntime.lookDeltaX = 0;
	defaultCamRuntime.lookDeltaY = 0;
	defaultCamRuntime.active = true;

	Log("ENGINE", `DefaultCam initialized: distance=${defaultCamRuntime.config.distance.value}, heightOffset=${defaultCamRuntime.config.heightOffset.value}, sensitivity=${defaultCamRuntime.config.sensitivity}`, "log", "Level");
}

function HandleDefaultCamInput(eventLike) {
	const eventType = eventLike.type;
	const eventCode = eventLike.code;

	switch (eventLike.type) {
		case "pointerdown":
			if (RequestPointerLock()) Log("ENGINE", "DefaultCam pointer lock requested.", "log", "Level");
			return true;
		case "keydown":
			if (eventCode === "Escape") {
				releasePointerLock();
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

	const rayDir = ResolveVector3Axis(ray);
	let closestT = rayLen;
	let obstructed = false;

	// Check terrain (AABBs are CNU UnitVector3 instances, convert to world-units for ray test).
	const terrain = sceneGraph.terrain;
	for (let i = 0; i < terrain.length; i++) {
		const mesh = terrain[i];
		const aabb = mesh.worldAabb;
		const scaled = {
			min: aabb.min.toWorldUnit(),
			max: aabb.max.toWorldUnit(),
		};
		const hit = RayAABBIntersect(playerHeadPos, rayDir, scaled);
		if (hit.hit && hit.t > 0 && hit.t < closestT) {
			closestT = hit.t;
			obstructed = true;
		}
	}

	// Check obstacles (AABBs are CNU UnitVector3 instances, convert to world-units for ray test).
	const obstacles = sceneGraph.obstacles;
	for (let i = 0; i < obstacles.length; i++) {
		const obs = obstacles[i];
		const scaled = {
			min: obs.bounds.min.toWorldUnit(),
			max: obs.bounds.max.toWorldUnit(),
		};
		const hit = RayAABBIntersect(playerHeadPos, rayDir, scaled);
		if (hit.hit && hit.t > 0 && hit.t < closestT) {
			closestT = hit.t;
			obstructed = true;
		}
	}

	// Ignore scatter objects entirely.

	if (obstructed) {
		const offset = worldDistanceDefaults.obstructionOffset.value;
		closestT = Math.max(worldDistanceDefaults.obstructionMinDistance.value, closestT - offset);
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

	// Player position (already a CNU UnitVector3 — convert to worldunit values at point of use).
	const playerPos = playerState.transform.position.toWorldUnit();

	// Camera target: player position + height offset.
	const targetPoint = {
		x: playerPos.x,
		y: playerPos.y + cfg.heightOffset.value,
		z: playerPos.z,
	};

	// Compute desired camera position using spherical coordinates.
	const yawRad = (defaultCamRuntime.yaw * Math.PI) / 180;
	const pitchRad = (defaultCamRuntime.pitch * Math.PI) / 180;
	const desiredDistance = cfg.distance.value;

	const desiredPos = {
		x: playerPos.x + desiredDistance * Math.cos(pitchRad) * Math.sin(yawRad),
		y: playerPos.y + cfg.heightOffset.value + desiredDistance * Math.sin(pitchRad),
		z: playerPos.z + desiredDistance * Math.cos(pitchRad) * Math.cos(yawRad),
	};

	// Camera obstruction detection.
	const playerHeadPos = { x: playerPos.x, y: playerPos.y + cfg.heightOffset.value, z: playerPos.z };
	const { obstructed, clippedDistance } = checkCameraObstruction(playerHeadPos, desiredPos, sceneGraph);

	if (obstructed) {
		defaultCamRuntime.targetDistance.value = clippedDistance;
		if (!defaultCamRuntime.obstructionLogged) {
			Log("ENGINE", `DefaultCam obstruction detected at t=${clippedDistance.toFixed(2)}`, "log", "Level");
			defaultCamRuntime.obstructionLogged = true;
		}
	} 
	else {
		defaultCamRuntime.targetDistance.value = desiredDistance;
		if (defaultCamRuntime.obstructionLogged) defaultCamRuntime.obstructionLogged = false;
	}

	// Smooth distance interpolation.
	const lerpSpeed = obstructed ? 100 : 4;
	defaultCamRuntime.currentDistance.value = Lerp(
		defaultCamRuntime.currentDistance.value,
		defaultCamRuntime.targetDistance.value,
		Math.min(1, lerpSpeed * deltaSeconds)
	);

	// Final camera position at current distance.
	const finalPos = {
		x: playerPos.x + defaultCamRuntime.currentDistance.value * Math.cos(pitchRad) * Math.sin(yawRad),
		y: playerPos.y + cfg.heightOffset.value + defaultCamRuntime.currentDistance.value * Math.sin(pitchRad),
		z: playerPos.z + defaultCamRuntime.currentDistance.value * Math.cos(pitchRad) * Math.cos(yawRad),
	};

	// Smooth camera position (responsiveness > cinematic float).
	const posLerpSpeed = 15;
	const smoothedPos = {
		x: Lerp(cameraState.position.x, finalPos.x, Math.min(1, posLerpSpeed * deltaSeconds)),
		y: Lerp(cameraState.position.y, finalPos.y, Math.min(1, posLerpSpeed * deltaSeconds)),
		z: Lerp(cameraState.position.z, finalPos.z, Math.min(1, posLerpSpeed * deltaSeconds)),
	};

	// Compute forward/right/up from camera position looking at target.
	const forward = ResolveVector3Axis(SubtractVector3(targetPoint, smoothedPos));
	const right = ResolveVector3Axis(CrossVector3(forward, worldUp));

	cameraState.position.set(smoothedPos);
	cameraState.forward = forward;
	cameraState.right = right;
	cameraState.up = ResolveVector3Axis(CrossVector3(right, forward));
	cameraState.target.set(targetPoint);
	cameraState.mode = "defaultcam";

	return cameraState;
}

function GetCameraVectors() {
	return {
		forward: latestCameraForward,
		right: latestCameraRight,
	};
}

let latestCameraForward = null;
let latestCameraRight = null;

function cacheCameraVectors(cameraState) {
	latestCameraForward = { ...cameraState.forward };
	latestCameraRight = { ...cameraState.right };
}

function InitializeCameraState(sceneGraph, cameraConfig, payloadMeta) {
	if (!freeCamEnabled) {
		freeCamRuntime.active = false;
		freeCamRuntime.levelKey = null;
		Object.keys(freeCamRuntime.keyState).forEach((key) => {
			freeCamRuntime.keyState[key] = false;
		});
		freeCamRuntime.lookDeltaX = 0;
		freeCamRuntime.lookDeltaY = 0;
		freeCamRuntime.wheelDelta = 0;

		// Initialize DefaultCam (third-person follow).
		initializeDefaultCamConfig(cameraConfig);

		const base = resolveDefaultLevelCamera(sceneGraph, cameraConfig);
		const state = {
			...base,
			mode: "defaultcam",
		};
		cacheCameraPosition(state);
		cacheCameraVectors(state);
		Log("ENGINE", "DefaultCam mode activated.", "log", "Level");
		return state;
	}

	// Check if game uses stages at all and store key
	const levelKey = payloadMeta.stageId 
		? `${payloadMeta.levelId}:${payloadMeta.stageId}`
		: payloadMeta.levelId;

	freeCamRuntime.active = true;
	freeCamRuntime.levelKey = levelKey;

	const existing = persistedFreeCamStates.get(levelKey);
	if (existing) {
		cacheCameraPosition(existing);
		cacheCameraVectors(existing);
		return existing;
	}

	const base = resolveDefaultLevelCamera(sceneGraph, cameraConfig);
	const forward = ResolveVector3Axis(SubtractVector3(base.target, base.position));
	const yaw = (Math.atan2(forward.z, forward.x) * 180) / Math.PI;
	const pitch = (Math.asin(Clamp(forward.y, -1, 1)) * 180) / Math.PI;

	const created = createCameraState({
		position: base.position,
		yaw: yaw,
		pitch: pitch,
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
	if (!freeCamEnabled) {
		// DefaultCam mode: follow the player.
		currentState.mode = "defaultcam";

		const nextState = updateDefaultCamState(currentState, playerState, sceneGraph, deltaSeconds);
		cacheCameraPosition(nextState);
		cacheCameraVectors(nextState);
		return nextState;
	}

	const nextState = updateFreeCamState(currentState, deltaSeconds);
	cacheCameraPosition(nextState);
	cacheCameraVectors(nextState);
	return nextState;
}

export { InitializeCameraState, UpdateCameraState, HandleFreeCamInput, HandleDefaultCamInput, GetCameraVectors };