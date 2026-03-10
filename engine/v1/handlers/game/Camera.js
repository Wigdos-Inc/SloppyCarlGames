// Controls Camera State

// Receives camera instructions from Level.js and Cutscene.js
// Returns ready to use Camera State

import { CONFIG } from "../../core/config.js";
import { CNU_SCALE, IsPointerLocked, Log, RequestPointerLock } from "../../core/meta.js";
import {
	AddVector3,
	SubtractVector3,
	CrossVector3,
	NormalizeUnitVector3,
	NormalizeVector3,
	scaleVector3,
	vector3Length,
} from "../../math/Vector3.js";
import { RayAABBIntersect } from "../../math/Physics.js";
import { CNUtoWorldUnit, Lerp, Unit, UnitVector3 } from "../../math/Utilities.js";

const worldUp = { x: 0, y: 1, z: 0 };
const pitchClampDegrees = 89;
const freeCamEnabled = Boolean(CONFIG && CONFIG.DEBUG && CONFIG.DEBUG.LEVELS && CONFIG.DEBUG.LEVELS.FreeCam === true);

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
	acceleration: new Unit(44, "cnu").toWorldUnit(),
	dampingFactor: 0.12,
	maxSpeed: new Unit(14, "cnu").toWorldUnit(),
	lookDeltaX: 0,
	lookDeltaY: 0,
	wheelDelta: 0,
};
const defaultCamRuntime = {
	active: false,
	yaw: 0,
	pitch: -15,
	currentDistance: new Unit(10, "cnu").toWorldUnit(),
	targetDistance: new Unit(10, "cnu").toWorldUnit(),
	lookDeltaX: 0,
	lookDeltaY: 0,
	config: {
		distance: new Unit(10, "cnu").toWorldUnit(),
		sensitivity: 0.12,
		heightOffset: new Unit(3, "cnu").toWorldUnit(),
		minPitch: -60,
		maxPitch: 60,
	},
};

function cacheCameraPosition(cameraState) {
	if (
		cameraState
		&& cameraState.position
		&& typeof cameraState.position.x === "number"
		&& typeof cameraState.position.y === "number"
		&& typeof cameraState.position.z === "number"
	) {
		latestCameraPosition = {
			worldUnit: {
				x: cameraState.position.x,
				y: cameraState.position.y,
				z: cameraState.position.z,
			},
			cnu: {
				x: cameraState.position.x / CNU_SCALE,
				y: cameraState.position.y / CNU_SCALE,
				z: cameraState.position.z / CNU_SCALE,
			},
		};
		return;
	}

	latestCameraPosition = null;
}

function getCurrentCameraPosition() {
	if (!latestCameraPosition) {
		console.warn("window.camPos can only be used while in a level.");
		return null;
	}

	return latestCameraPosition;
}

if (typeof window !== "undefined") {
	window.camPos = getCurrentCameraPosition;
}

function toNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

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
	const source = seed && typeof seed === "object" ? seed : {};
	const position = NormalizeVector3(source.position, { x: 0, y: new Unit(20, "cnu").toWorldUnit(), z: new Unit(40, "cnu").toWorldUnit() });
	const yaw = toNumber(source.yaw, -90);
	const pitch = clamp(toNumber(source.pitch, -18), -pitchClampDegrees, pitchClampDegrees);
	const forward = createForwardFromAngles(yaw, pitch);
	const right = NormalizeUnitVector3(CrossVector3(forward, worldUp));
	const up = NormalizeUnitVector3(CrossVector3(right, forward));

	return {
		position: position,
		yaw: yaw,
		pitch: pitch,
		forward: forward,
		right: right,
		up: up,
		speed: toNumber(source.speed, freeCamRuntime.maxSpeed),
		velocity: NormalizeVector3(source.velocity, { x: 0, y: 0, z: 0 }),
		mode: "freecam",
		target: AddVector3(position, forward),
		fov: toNumber(source.fov, 60),
		near: toNumber(source.near, 0.1),
		far: toNumber(source.far, new Unit(800, "cnu").toWorldUnit()),
	};
}

function updateOrientationVectors(cameraState) {
	cameraState.forward = createForwardFromAngles(cameraState.yaw, cameraState.pitch);
	cameraState.right = NormalizeUnitVector3(CrossVector3(cameraState.forward, worldUp));
	cameraState.up = NormalizeUnitVector3(CrossVector3(cameraState.right, cameraState.forward));
	cameraState.target = AddVector3(cameraState.position, cameraState.forward);
}

function resolveDefaultLevelCamera(sceneGraph, cameraConfig) {
	const world = sceneGraph && sceneGraph.world ? sceneGraph.world : {};
	const levelOpening = cameraConfig && cameraConfig.levelOpening ? cameraConfig.levelOpening : {};
	const wLength = world.length && typeof world.length.toWorldUnit === "function"
		? world.length.toWorldUnit()
		: CNUtoWorldUnit(world.length ? world.length.value || world.length : 100);
	const wHeight = world.height && typeof world.height.toWorldUnit === "function"
		? world.height.toWorldUnit()
		: CNUtoWorldUnit(world.height ? world.height.value || world.height : 40);
	const wWidth = world.width && typeof world.width.toWorldUnit === "function"
		? world.width.toWorldUnit()
		: CNUtoWorldUnit(world.width ? world.width.value || world.width : 100);
	const center = {
		x: wLength * 0.5,
		y: Math.max(0, wHeight * 0.35),
		z: wWidth * 0.5,
	};
	const startRaw = levelOpening.startPosition ? levelOpening.startPosition : null;
	const position = startRaw
		? {
			x: typeof startRaw.toWorldUnit === "function" ? startRaw.toWorldUnit().x : CNUtoWorldUnit(startRaw.x),
			y: typeof startRaw.toWorldUnit === "function" ? startRaw.toWorldUnit().y : CNUtoWorldUnit(startRaw.y),
			z: typeof startRaw.toWorldUnit === "function" ? startRaw.toWorldUnit().z : CNUtoWorldUnit(startRaw.z),
		}
		: {
			x: center.x,
			y: Math.max(new Unit(20, "cnu").toWorldUnit(), wHeight * 1.15),
			z: center.z + Math.max(new Unit(30, "cnu").toWorldUnit(), wWidth * 0.7),
		};
	return {
		mode: "level",
		position: position,
		target: center,
		up: { x: 0, y: 1, z: 0 },
		fov: 60,
		near: 0.1,
		far: Math.max(new Unit(200, "cnu").toWorldUnit(), wLength + wWidth + wHeight),
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
	freeCamRuntime.tuningStep = clamp(step, -6, 16);
	freeCamRuntime.maxSpeed = new Unit(clamp(14 + freeCamRuntime.tuningStep * 2.5, 3, 80), "cnu").toWorldUnit();
	freeCamRuntime.acceleration = new Unit(clamp(44 + freeCamRuntime.tuningStep * 10, 10, 300), "cnu").toWorldUnit();
	freeCamRuntime.dampingFactor = clamp(0.08 + freeCamRuntime.tuningStep * 0.02, 0.05, 0.92);

	if (CONFIG && CONFIG.DEBUG && CONFIG.DEBUG.ALL === true) {
		Log(
			"ENGINE",
			`FreeCam speed tuned: maxSpeed=${freeCamRuntime.maxSpeed.toFixed(1)}, acceleration=${freeCamRuntime.acceleration.toFixed(1)}, damping=${freeCamRuntime.dampingFactor.toFixed(2)}`,
			"log",
			"Level"
		);
	}
}

function releasePointerLock() {
	if (typeof document === "undefined" || typeof document.exitPointerLock !== "function") {
		return false;
	}
	if (!IsPointerLocked()) {
		return true;
	}
	document.exitPointerLock();
	Log("ENGINE", "FreeCam pointer lock released.", "log", "Level");
	return true;
}

function resolveFreeCamState(sceneGraph) {
	if (sceneGraph && sceneGraph.cameraConfig && sceneGraph.cameraConfig.state && sceneGraph.cameraConfig.state.mode === "freecam") {
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
	cameraState.pitch = clamp(
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
		freeCamRuntime.wheelDelta += toNumber(eventLike.deltaY, 0);
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
		freeCamRuntime.lookDeltaX += toNumber(eventLike.movementX, 0);
		freeCamRuntime.lookDeltaY += toNumber(eventLike.movementY, 0);
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
		direction = AddVector3(direction, scaleVector3(cameraState.forward, -1));
	}
	if (freeCamRuntime.keyState.KeyD || freeCamRuntime.keyState.ArrowRight) {
		direction = AddVector3(direction, cameraState.right);
	}
	if (freeCamRuntime.keyState.KeyA || freeCamRuntime.keyState.ArrowLeft) {
		direction = AddVector3(direction, scaleVector3(cameraState.right, -1));
	}
	if (freeCamRuntime.keyState.Space) {
		direction = AddVector3(direction, worldUp);
	}
	if (freeCamRuntime.keyState.ShiftLeft || freeCamRuntime.keyState.ShiftRight) {
		direction = AddVector3(direction, scaleVector3(worldUp, -1));
	}

	const length = vector3Length(direction);
	if (length <= 0.000001) {
		return { x: 0, y: 0, z: 0 };
	}

	return NormalizeUnitVector3(direction);
}

function updateFreeCamState(cameraState, deltaSeconds) {
	const dt = Math.max(0, toNumber(deltaSeconds, 0.016));

	if (freeCamRuntime.lookDeltaX !== 0 || freeCamRuntime.lookDeltaY !== 0) {
		applyLookInput(cameraState, freeCamRuntime.lookDeltaX, freeCamRuntime.lookDeltaY);
	}

	if (freeCamRuntime.wheelDelta !== 0) {
		const direction = freeCamRuntime.wheelDelta < 0 ? 1 : -1;
		applyTuningStep(freeCamRuntime.tuningStep + direction);
	}

	updateOrientationVectors(cameraState);

	const inputDirection = getMoveDirectionFromKeys(cameraState);
	const hasInput = vector3Length(inputDirection) > 0.000001;

	if (hasInput) {
		cameraState.velocity = AddVector3(
			cameraState.velocity,
			scaleVector3(inputDirection, freeCamRuntime.acceleration * dt)
		);
	} else {
		const damping = Math.pow(freeCamRuntime.dampingFactor, dt * 60);
		cameraState.velocity = scaleVector3(cameraState.velocity, damping);
	}

	const speed = vector3Length(cameraState.velocity);
	if (speed > freeCamRuntime.maxSpeed) {
		cameraState.velocity = scaleVector3(NormalizeUnitVector3(cameraState.velocity), freeCamRuntime.maxSpeed);
	}

	cameraState.position = AddVector3(cameraState.position, scaleVector3(cameraState.velocity, dt));
	cameraState.speed = freeCamRuntime.maxSpeed;
	updateOrientationVectors(cameraState);

	freeCamRuntime.lookDeltaX = 0;
	freeCamRuntime.lookDeltaY = 0;
	freeCamRuntime.wheelDelta = 0;

	if (freeCamRuntime.levelKey) {
		persistedFreeCamStates.set(freeCamRuntime.levelKey, { ...cameraState, velocity: { ...cameraState.velocity } });
	}

	return cameraState;
}

/* === DEFAULT CAM (Third-Person Follow) === */

function initializeDefaultCamConfig(cameraConfig) {
	const cam = cameraConfig && typeof cameraConfig === "object" ? cameraConfig : {};
	const camPayload = cam.camera && typeof cam.camera === "object" ? cam.camera : cam;

	const rawDistance = camPayload.distance && typeof camPayload.distance === "object" && typeof camPayload.distance.value === "number"
		? camPayload.distance.value
		: toNumber(camPayload.distance, 10);
	const rawHeightOffset = camPayload.heightOffset && typeof camPayload.heightOffset === "object" && typeof camPayload.heightOffset.value === "number"
		? camPayload.heightOffset.value
		: toNumber(camPayload.heightOffset, 3);

	defaultCamRuntime.config.distance = typeof camPayload.distance?.toWorldUnit === "function"
		? camPayload.distance.toWorldUnit()
		: new Unit(rawDistance, "cnu").toWorldUnit();
	defaultCamRuntime.config.sensitivity = toNumber(camPayload.sensitivity, toNumber(camPayload.speed, 0.12));
	defaultCamRuntime.config.heightOffset = typeof camPayload.heightOffset?.toWorldUnit === "function"
		? camPayload.heightOffset.toWorldUnit()
		: new Unit(rawHeightOffset, "cnu").toWorldUnit();
	defaultCamRuntime.currentDistance = defaultCamRuntime.config.distance;
	defaultCamRuntime.targetDistance = defaultCamRuntime.config.distance;
	defaultCamRuntime.yaw = 0;
	defaultCamRuntime.pitch = -15;
	defaultCamRuntime.lookDeltaX = 0;
	defaultCamRuntime.lookDeltaY = 0;
	defaultCamRuntime.active = true;

	Log("ENGINE", `DefaultCam initialized: distance=${defaultCamRuntime.config.distance}, heightOffset=${defaultCamRuntime.config.heightOffset}, sensitivity=${defaultCamRuntime.config.sensitivity}`, "log", "Level");
}

function HandleDefaultCamInput(eventLike) {
	if (!defaultCamRuntime.active || !eventLike || typeof eventLike !== "object") {
		return false;
	}

	const eventType = eventLike.type || null;
	const eventCode = eventLike.code || null;

	if (eventType === "pointerdown") {
		if (RequestPointerLock()) {
			Log("ENGINE", "DefaultCam pointer lock requested.", "log", "Level");
		}
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
		defaultCamRuntime.lookDeltaX += toNumber(eventLike.movementX, 0);
		defaultCamRuntime.lookDeltaY += toNumber(eventLike.movementY, 0);
		return true;
	}

	return false;
}

function checkCameraObstruction(playerHeadPos, desiredCamPos, sceneGraph) {
	const ray = SubtractVector3(desiredCamPos, playerHeadPos);
	const rayLen = vector3Length(ray);
	if (rayLen < 0.01) {
		return { obstructed: false, clippedDistance: rayLen };
	}

	const rayDir = NormalizeUnitVector3(ray);
	let closestT = rayLen;
	let obstructed = false;

	// Check terrain (AABBs are in CNU, convert to world-units for ray test).
	const terrain = Array.isArray(sceneGraph && sceneGraph.terrain) ? sceneGraph.terrain : [];
	for (let i = 0; i < terrain.length; i++) {
		const mesh = terrain[i];
		if (!mesh || !mesh.worldAabb) { continue; }
		const aabb = mesh.worldAabb;
		const scaled = {
			min: typeof aabb.min.toWorldUnit === "function" ? aabb.min.toWorldUnit() : { x: CNUtoWorldUnit(aabb.min.x), y: CNUtoWorldUnit(aabb.min.y), z: CNUtoWorldUnit(aabb.min.z) },
			max: typeof aabb.max.toWorldUnit === "function" ? aabb.max.toWorldUnit() : { x: CNUtoWorldUnit(aabb.max.x), y: CNUtoWorldUnit(aabb.max.y), z: CNUtoWorldUnit(aabb.max.z) },
		};
		const hit = RayAABBIntersect(playerHeadPos, rayDir, scaled);
		if (hit.hit && hit.t > 0 && hit.t < closestT) {
			closestT = hit.t;
			obstructed = true;
		}
	}

	// Check obstacles (AABBs are in CNU, convert to world-units for ray test).
	const obstacles = Array.isArray(sceneGraph && sceneGraph.obstacles) ? sceneGraph.obstacles : [];
	for (let i = 0; i < obstacles.length; i++) {
		const obs = obstacles[i];
		if (!obs) { continue; }
		const bounds = obs.bounds || (obs.mesh && obs.mesh.worldAabb) || null;
		if (!bounds) { continue; }
		const scaled = {
			min: typeof bounds.min.toWorldUnit === "function" ? bounds.min.toWorldUnit() : { x: CNUtoWorldUnit(bounds.min.x), y: CNUtoWorldUnit(bounds.min.y), z: CNUtoWorldUnit(bounds.min.z) },
			max: typeof bounds.max.toWorldUnit === "function" ? bounds.max.toWorldUnit() : { x: CNUtoWorldUnit(bounds.max.x), y: CNUtoWorldUnit(bounds.max.y), z: CNUtoWorldUnit(bounds.max.z) },
		};
		const hit = RayAABBIntersect(playerHeadPos, rayDir, scaled);
		if (hit.hit && hit.t > 0 && hit.t < closestT) {
			closestT = hit.t;
			obstructed = true;
		}
	}

	// Ignore scatter objects entirely.

	if (obstructed) {
		const offset = new Unit(0.3, "cnu").toWorldUnit();
		closestT = Math.max(new Unit(0.5, "cnu").toWorldUnit(), closestT - offset);

		if (CONFIG && CONFIG.DEBUG && CONFIG.DEBUG.ALL === true && CONFIG.DEBUG.LOGGING && CONFIG.DEBUG.LOGGING.Channel && CONFIG.DEBUG.LOGGING.Channel.Level) {
			Log("ENGINE", `DefaultCam obstruction detected at t=${closestT.toFixed(2)}`, "log", "Level");
		}
	}

	return { obstructed, clippedDistance: closestT };
}

function updateDefaultCamState(cameraState, playerState, sceneGraph, deltaSeconds) {
	const dt = Math.max(0, toNumber(deltaSeconds, 0.016));
	const cfg = defaultCamRuntime.config;

	// Apply mouse look.
	if (defaultCamRuntime.lookDeltaX !== 0 || defaultCamRuntime.lookDeltaY !== 0) {
		defaultCamRuntime.yaw -= defaultCamRuntime.lookDeltaX * cfg.sensitivity;
		defaultCamRuntime.pitch = clamp(
			defaultCamRuntime.pitch + defaultCamRuntime.lookDeltaY * cfg.sensitivity,
			cfg.minPitch,
			cfg.maxPitch
		);
		defaultCamRuntime.lookDeltaX = 0;
		defaultCamRuntime.lookDeltaY = 0;
	}

	// Player position (CNU → world-units).
	const playerPos = playerState && playerState.transform && playerState.transform.position
		? (typeof playerState.transform.position.toWorldUnit === "function"
			? playerState.transform.position.toWorldUnit()
			: {
				x: CNUtoWorldUnit(playerState.transform.position.x),
				y: CNUtoWorldUnit(playerState.transform.position.y),
				z: CNUtoWorldUnit(playerState.transform.position.z),
			})
		: { x: 0, y: 0, z: 0 };

	// Camera target: player position + height offset.
	const targetPoint = {
		x: playerPos.x,
		y: playerPos.y + cfg.heightOffset,
		z: playerPos.z,
	};

	// Compute desired camera position using spherical coordinates.
	const yawRad = (defaultCamRuntime.yaw * Math.PI) / 180;
	const pitchRad = (defaultCamRuntime.pitch * Math.PI) / 180;
	const desiredDistance = cfg.distance;

	const desiredPos = {
		x: playerPos.x + desiredDistance * Math.cos(pitchRad) * Math.sin(yawRad),
		y: playerPos.y + cfg.heightOffset + desiredDistance * Math.sin(pitchRad),
		z: playerPos.z + desiredDistance * Math.cos(pitchRad) * Math.cos(yawRad),
	};

	// Camera obstruction detection.
	const playerHeadPos = { x: playerPos.x, y: playerPos.y + cfg.heightOffset, z: playerPos.z };
	const { obstructed, clippedDistance } = checkCameraObstruction(playerHeadPos, desiredPos, sceneGraph);

	if (obstructed) {
		defaultCamRuntime.targetDistance = clippedDistance;
	} else {
		defaultCamRuntime.targetDistance = desiredDistance;
	}

	// Smooth distance interpolation.
	const lerpSpeed = obstructed ? 12 : 4;
	defaultCamRuntime.currentDistance = Lerp(
		defaultCamRuntime.currentDistance,
		defaultCamRuntime.targetDistance,
		Math.min(1, lerpSpeed * dt)
	);

	// Final camera position at current distance.
	const finalPos = {
		x: playerPos.x + defaultCamRuntime.currentDistance * Math.cos(pitchRad) * Math.sin(yawRad),
		y: playerPos.y + cfg.heightOffset + defaultCamRuntime.currentDistance * Math.sin(pitchRad),
		z: playerPos.z + defaultCamRuntime.currentDistance * Math.cos(pitchRad) * Math.cos(yawRad),
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

	cameraState.position = smoothedPos;
	cameraState.forward = forward;
	cameraState.right = right;
	cameraState.up = up;
	cameraState.target = targetPoint;
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
	if (cameraState && cameraState.forward) {
		latestCameraForward = { ...cameraState.forward };
	}
	if (cameraState && cameraState.right) {
		latestCameraRight = { ...cameraState.right };
	}
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
			velocity: { x: 0, y: 0, z: 0 },
		};
		cacheCameraPosition(state);
		cacheCameraVectors(state);
		Log("ENGINE", "DefaultCam mode activated.", "log", "Level");
		return state;
	}

	const levelId = payloadMeta && payloadMeta.levelId ? payloadMeta.levelId : "unknown-level";
	const stageId = payloadMeta && payloadMeta.stageId ? payloadMeta.stageId : "unknown-stage";
	const levelKey = `${levelId}:${stageId}`;

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
	const pitch = (Math.asin(clamp(forward.y, -1, 1)) * 180) / Math.PI;

	const created = createCameraState({
		position: base.position,
		yaw: yaw,
		pitch: pitch,
		fov: base.fov,
		near: base.near,
		far: base.far,
	});
	cacheCameraPosition(created);
	persistedFreeCamStates.set(levelKey, created);
	return created;
}

function UpdateCameraState(currentState, sceneGraph, cameraConfig, deltaSeconds, playerState) {
	if (!freeCamEnabled) {
		// DefaultCam mode: follow the player.
		const baseState = currentState || resolveDefaultLevelCamera(sceneGraph, cameraConfig);
		if (!baseState.velocity) { baseState.velocity = { x: 0, y: 0, z: 0 }; }
		baseState.mode = "defaultcam";

		const nextState = updateDefaultCamState(baseState, playerState, sceneGraph, deltaSeconds);
		cacheCameraPosition(nextState);
		cacheCameraVectors(nextState);
		return nextState;
	}

	const resolvedState = resolveFreeCamState(sceneGraph)
		|| (currentState && currentState.mode === "freecam" ? currentState : null)
		|| InitializeCameraState(sceneGraph, cameraConfig, sceneGraph && sceneGraph.meta ? sceneGraph.meta : null);

	const nextState = updateFreeCamState(resolvedState, deltaSeconds);
	cacheCameraPosition(nextState);
	cacheCameraVectors(nextState);
	return nextState;
}

export { InitializeCameraState, UpdateCameraState, HandleFreeCamInput, HandleDefaultCamInput, CalculateCameraState, GetCameraVectors };