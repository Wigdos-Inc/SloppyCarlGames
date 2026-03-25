// Controls Camera State

// Receives camera instructions from Level.js and Cutscene.js
// Returns ready to use Camera State

// Module uses World Units instead of CNU for testing.

import { CONFIG } from "../../core/config.js";
import { IsPointerLocked, Log, RequestPointerLock } from "../../core/meta.js";
import {
	AddVector3,
	SubtractVector3,
	CrossVector3,
	NormalizeUnitVector3,
	NormalizeVector3,
	ScaleVector3,
	Vector3Length,
} from "../../math/Vector3.js";
import { RayAABBIntersect } from "../../math/Physics.js";
import { Lerp, ToNumber, Clamp, Unit, UnitVector3 } from "../../math/Utilities.js";

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
	acceleration: worldDistanceDefaults.freeCamAcceleration,
	dampingFactor: 0.12,
	maxSpeed: worldDistanceDefaults.freeCamMaxSpeed,
	lookDeltaX: 0,
	lookDeltaY: 0,
	wheelDelta: 0,
};
const defaultCamRuntime = {
	active: false,
	yaw: 0,
	pitch: -15,
	currentDistance: worldDistanceDefaults.defaultCamCurrentDistance,
	targetDistance: worldDistanceDefaults.defaultCamTargetDistance,
	lookDeltaX: 0,
	lookDeltaY: 0,
	obstructionLogged: false,
	config: {
		distance: worldDistanceDefaults.defaultCamDistance,
		sensitivity: 0.12,
		heightOffset: worldDistanceDefaults.defaultCamHeightOffset,
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
	return NormalizeUnitVector3({
		x: Math.cos(pitch) * Math.cos(yaw),
		y: Math.sin(pitch),
		z: Math.cos(pitch) * Math.sin(yaw),
	});
}

function createCameraState(seed) {
	const source = seed;
	const position = worldDistanceDefaults.freeCamStartPosition;
	position.set(source.position);
	const yaw = ToNumber(source.yaw, -90);
	const pitch = Clamp(ToNumber(source.pitch, -18), -pitchClampDegrees, pitchClampDegrees);
	const forward = createForwardFromAngles(yaw, pitch);
	const right = NormalizeUnitVector3(CrossVector3(forward, worldUp));
	const up = NormalizeUnitVector3(CrossVector3(right, forward));
	const velocity = new UnitVector3(0, 0, 0, "worldunit");
	velocity.set(source.velocity);
	const target = new UnitVector3(
		position.x + forward.x, 
		position.y + forward.y, 
		position.z + forward.z, 
		"worldunit"
	);

	return {
		position: position,
		yaw: yaw,
		pitch: pitch,
		forward: forward,
		right: right,
		up: up,
		speed: new Unit(ToNumber(source.speed, freeCamRuntime.maxSpeed.value), "worldunit"),
		velocity: velocity,
		mode: "freecam",
		target: target,
		fov: ToNumber(source.fov, 60),
		near: new Unit(ToNumber(source.near, 0.1), "worldunit"),
		far: new Unit(ToNumber(source.far, worldDistanceDefaults.freeCamFar.value), "worldunit"),
	};
}

function updateOrientationVectors(cameraState) {
	cameraState.forward = createForwardFromAngles(cameraState.yaw, cameraState.pitch);
	cameraState.right = NormalizeUnitVector3(CrossVector3(cameraState.forward, worldUp));
	cameraState.up = NormalizeUnitVector3(CrossVector3(cameraState.right, cameraState.forward));
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
	const position = new UnitVector3(0, 0, 0, "worldunit");
	position.set(cameraConfig.levelOpening.startPosition.toWorldUnit());

	return {
		mode: "level",
		position: position,
		target: center,
		up: { x: 0, y: 1, z: 0 },
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
	return state;
}

function CalculateCameraState(sceneGraph, cameraConfig) {
	return createStationaryCameraState(sceneGraph, cameraConfig);
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
	if (!IsPointerLocked()) {
		return true;
	}
	document.exitPointerLock();
	Log("ENGINE", "FreeCam pointer lock released.", "log", "Level");
	return true;
}

function resolveFreeCamState(sceneGraph) {
	if (sceneGraph.cameraConfig.state.mode === "freecam") {
		return sceneGraph.cameraConfig.state;
	}

	if (freeCamRuntime.levelKey) {
		const persisted = persistedFreeCamStates.get(freeCamRuntime.levelKey);
		if (persisted && persisted.mode === "freecam") {
			return persisted;
		}
	}

	return null;
}

function applyLookInput(cameraState, movementX, movementY) {
	if (!cameraState) {
		return;
	}
	cameraState.yaw += movementX * freeCamRuntime.moveSensitivity;
	cameraState.pitch = Clamp(
		cameraState.pitch - movementY * freeCamRuntime.moveSensitivity,
		-pitchClampDegrees,
		pitchClampDegrees
	);
	updateOrientationVectors(cameraState);
}

function HandleFreeCamInput(eventLike, sceneGraph) {
	if (!freeCamEnabled || !eventLike || typeof eventLike !== "object") {
		return false;
	}

	const eventType = eventLike.type || null;
	const eventCode = eventLike.code || null;

	if (eventType === "pointerdown") {
		if (RequestPointerLock()) {
			Log("ENGINE", "FreeCam pointer lock requested.", "log", "Level");
		}
		return true;
	}

	if (eventType === "wheel") {
		freeCamRuntime.wheelDelta += ToNumber(eventLike.deltaY, 0);
		return true;
	}

	if (eventType === "keydown") {
		if (eventCode === "Escape") {
			releasePointerLock();
			return true;
		}
		if (eventCode in freeCamRuntime.keyState) {
			freeCamRuntime.keyState[eventCode] = true;
			return true;
		}
		return false;
	}

	if (eventType === "keyup") {
		if (eventCode in freeCamRuntime.keyState) {
			freeCamRuntime.keyState[eventCode] = false;
			return true;
		}
		return false;
	}

	if (eventType === "mousemove") {
		if (!IsPointerLocked()) {
			return false;
		}
		freeCamRuntime.lookDeltaX += ToNumber(eventLike.movementX, 0);
		freeCamRuntime.lookDeltaY += ToNumber(eventLike.movementY, 0);
		return true;
	}

	return false;
}

function getMoveDirectionFromKeys(cameraState) {
	let direction = { x: 0, y: 0, z: 0 };
	if (freeCamRuntime.keyState.KeyW || freeCamRuntime.keyState.ArrowUp) {
		direction = AddVector3(direction, cameraState.forward);
	}
	if (freeCamRuntime.keyState.KeyS || freeCamRuntime.keyState.ArrowDown) {
		direction = AddVector3(direction, ScaleVector3(cameraState.forward, -1));
	}
	if (freeCamRuntime.keyState.KeyD || freeCamRuntime.keyState.ArrowRight) {
		direction = AddVector3(direction, cameraState.right);
	}
	if (freeCamRuntime.keyState.KeyA || freeCamRuntime.keyState.ArrowLeft) {
		direction = AddVector3(direction, ScaleVector3(cameraState.right, -1));
	}
	if (freeCamRuntime.keyState.Space) {
		direction = AddVector3(direction, worldUp);
	}
	if (freeCamRuntime.keyState.ShiftLeft || freeCamRuntime.keyState.ShiftRight) {
		direction = AddVector3(direction, ScaleVector3(worldUp, -1));
	}

	const length = Vector3Length(direction);
	if (length <= 0.000001) {
		return { x: 0, y: 0, z: 0 };
	}

	return NormalizeUnitVector3(direction);
}

function updateFreeCamState(cameraState, deltaSeconds) {
	const dt = Math.max(0, ToNumber(deltaSeconds, 0.016));

	if (freeCamRuntime.lookDeltaX !== 0 || freeCamRuntime.lookDeltaY !== 0) {
		applyLookInput(cameraState, freeCamRuntime.lookDeltaX, freeCamRuntime.lookDeltaY);
	}

	if (freeCamRuntime.wheelDelta !== 0) {
		const direction = freeCamRuntime.wheelDelta < 0 ? 1 : -1;
		applyTuningStep(freeCamRuntime.tuningStep + direction);
	}

	updateOrientationVectors(cameraState);

	const inputDirection = getMoveDirectionFromKeys(cameraState);
	const hasInput = Vector3Length(inputDirection) > 0.000001;

	if (hasInput) {
		cameraState.velocity.set(
			AddVector3(
				cameraState.velocity,
				ScaleVector3(inputDirection, freeCamRuntime.acceleration.value * dt)
			)
		);
	} 
	else cameraState.velocity.scale(Math.pow(freeCamRuntime.dampingFactor, dt * 60));

	const speed = Vector3Length(cameraState.velocity);
	if (speed > freeCamRuntime.maxSpeed.value) cameraState.velocity.scale(freeCamRuntime.maxSpeed.value);

	cameraState.position.add(ScaleVector3(cameraState.velocity, dt));
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
	defaultCamRuntime.config.sensitivity = ToNumber(cameraConfig.sensitivity, ToNumber(cameraConfig.speed, 0.12));
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

	if (eventType === "pointerdown") {
		if (RequestPointerLock()) Log("ENGINE", "DefaultCam pointer lock requested.", "log", "Level");
		return true;
	}

	if (eventType === "keydown" && eventCode === "Escape") {
		releasePointerLock();
		return true;
	}

	if (eventType === "mousemove") {
		if (!IsPointerLocked()) {
			return false;
		}
		defaultCamRuntime.lookDeltaX += ToNumber(eventLike.movementX, 0);
		defaultCamRuntime.lookDeltaY += ToNumber(eventLike.movementY, 0);
		return true;
	}

	return false;
}

function checkCameraObstruction(playerHeadPos, desiredCamPos, sceneGraph) {
	const ray = SubtractVector3(desiredCamPos, playerHeadPos);
	const rayLen = Vector3Length(ray);
	if (rayLen < 0.01) {
		return { obstructed: false, clippedDistance: rayLen };
	}

	const rayDir = NormalizeUnitVector3(ray);
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
		const bounds = obs.bounds || obs.mesh.worldAabb;
		const scaled = {
			min: bounds.min.toWorldUnit(),
			max: bounds.max.toWorldUnit(),
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
	const dt = Math.max(0, ToNumber(deltaSeconds, 0.016));
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
	} else {
		defaultCamRuntime.targetDistance.value = desiredDistance;
		if (defaultCamRuntime.obstructionLogged) {
			defaultCamRuntime.obstructionLogged = false;
		}
	}

	// Smooth distance interpolation.
	const lerpSpeed = obstructed ? 100 : 4;
	defaultCamRuntime.currentDistance.value = Lerp(
		defaultCamRuntime.currentDistance.value,
		defaultCamRuntime.targetDistance.value,
		Math.min(1, lerpSpeed * dt)
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
		x: Lerp(cameraState.position.x, finalPos.x, Math.min(1, posLerpSpeed * dt)),
		y: Lerp(cameraState.position.y, finalPos.y, Math.min(1, posLerpSpeed * dt)),
		z: Lerp(cameraState.position.z, finalPos.z, Math.min(1, posLerpSpeed * dt)),
	};

	// Compute forward/right/up from camera position looking at target.
	const forward = NormalizeUnitVector3(SubtractVector3(targetPoint, smoothedPos));
	const right = NormalizeUnitVector3(CrossVector3(forward, worldUp));
	const up = NormalizeUnitVector3(CrossVector3(right, forward));

	cameraState.position.set(smoothedPos);
	cameraState.forward = forward;
	cameraState.right = right;
	cameraState.up = up;
	cameraState.target.set(targetPoint);
	cameraState.mode = "defaultcam";

	return cameraState;
}

function GetCameraVectors() {
	if (!latestCameraPosition) {
		return { forward: { x: 0, y: 0, z: -1 }, right: { x: 1, y: 0, z: 0 } };
	}
	// Return the cached forward/right from the latest camera state.
	return {
		forward: latestCameraForward || { x: 0, y: 0, z: -1 },
		right: latestCameraRight || { x: 1, y: 0, z: 0 },
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
		return existing;
	}

	const base = resolveDefaultLevelCamera(sceneGraph, cameraConfig);
	const forward = NormalizeUnitVector3({
		x: base.target.x - base.position.x,
		y: base.target.y - base.position.y,
		z: base.target.z - base.position.z,
	});
	const yaw = (Math.atan2(forward.z, forward.x) * 180) / Math.PI;
	const pitch = (Math.asin(Clamp(forward.y, -1, 1)) * 180) / Math.PI;

	const created = createCameraState({
		position: base.position,
		yaw: yaw,
		pitch: pitch,
		fov: base.fov,
		near: base.near.value,
		far: base.far.value,
	});
	cacheCameraPosition(created);
	persistedFreeCamStates.set(levelKey, created);
	return created;
}

function UpdateCameraState(currentState, sceneGraph, cameraConfig, deltaSeconds, playerState) {
	if (!freeCamEnabled) {
		// DefaultCam mode: follow the player.
		const baseState = currentState || resolveDefaultLevelCamera(sceneGraph, cameraConfig);
		baseState.mode = "defaultcam";

		const nextState = updateDefaultCamState(baseState, playerState, sceneGraph, deltaSeconds);
		cacheCameraPosition(nextState);
		cacheCameraVectors(nextState);
		return nextState;
	}

	const resolvedState = resolveFreeCamState(sceneGraph)
		|| (currentState && currentState.mode === "freecam" ? currentState : null)
		|| InitializeCameraState(sceneGraph, cameraConfig, sceneGraph.meta);

	const nextState = updateFreeCamState(resolvedState, deltaSeconds);
	cacheCameraPosition(nextState);
	cacheCameraVectors(nextState);
	return nextState;
}

export { InitializeCameraState, UpdateCameraState, HandleFreeCamInput, HandleDefaultCamInput, CalculateCameraState, GetCameraVectors };