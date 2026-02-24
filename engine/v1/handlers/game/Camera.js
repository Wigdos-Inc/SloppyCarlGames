// Controls Camera State

// Receives camera instructions from Level.js and Cutscene.js
// Returns ready to use Camera State

import { CONFIG } from "../../core/config.js";
import { IsPointerLocked, Log, RequestPointerLock } from "../../core/meta.js";
import {
	addVector3,
	crossVector3,
	normalizeUnitVector3,
	normalizeVector3,
	scaleVector3,
	vector3Length,
} from "../../math/Vector3.js";

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
	acceleration: 44,
	dampingFactor: 0.12,
	maxSpeed: 14,
	lookDeltaX: 0,
	lookDeltaY: 0,
	wheelDelta: 0,
};
const playerCamRuntime = {}

function cacheCameraPosition(cameraState) {
	if (
		cameraState
		&& cameraState.position
		&& typeof cameraState.position.x === "number"
		&& typeof cameraState.position.y === "number"
		&& typeof cameraState.position.z === "number"
	) {
		latestCameraPosition = {
			x: cameraState.position.x,
			y: cameraState.position.y,
			z: cameraState.position.z,
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

	return {
		x: latestCameraPosition.x,
		y: latestCameraPosition.y,
		z: latestCameraPosition.z,
	};
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
	return normalizeUnitVector3({
		x: Math.cos(pitch) * Math.cos(yaw),
		y: Math.sin(pitch),
		z: Math.cos(pitch) * Math.sin(yaw),
	});
}

function createCameraState(seed) {
	const source = seed && typeof seed === "object" ? seed : {};
	const position = normalizeVector3(source.position, { x: 0, y: 20, z: 40 });
	const yaw = toNumber(source.yaw, -90);
	const pitch = clamp(toNumber(source.pitch, -18), -pitchClampDegrees, pitchClampDegrees);
	const forward = createForwardFromAngles(yaw, pitch);
	const right = normalizeUnitVector3(crossVector3(forward, worldUp));
	const up = normalizeUnitVector3(crossVector3(right, forward));

	return {
		position: position,
		yaw: yaw,
		pitch: pitch,
		forward: forward,
		right: right,
		up: up,
		speed: toNumber(source.speed, freeCamRuntime.maxSpeed),
		velocity: normalizeVector3(source.velocity, { x: 0, y: 0, z: 0 }),
		mode: "freecam",
		target: addVector3(position, forward),
		fov: toNumber(source.fov, 60),
		near: toNumber(source.near, 0.1),
		far: toNumber(source.far, 800),
	};
}

function updateOrientationVectors(cameraState) {
	cameraState.forward = createForwardFromAngles(cameraState.yaw, cameraState.pitch);
	cameraState.right = normalizeUnitVector3(crossVector3(cameraState.forward, worldUp));
	cameraState.up = normalizeUnitVector3(crossVector3(cameraState.right, cameraState.forward));
	cameraState.target = addVector3(cameraState.position, cameraState.forward);
}

function resolveDefaultLevelCamera(sceneGraph, cameraConfig) {
	const world = sceneGraph && sceneGraph.world ? sceneGraph.world : {};
	const levelOpening = cameraConfig && cameraConfig.levelOpening ? cameraConfig.levelOpening : {};
	const center = {
		x: toNumber(world.length, 100) * 0.5,
		y: Math.max(0, toNumber(world.height, 40) * 0.35),
		z: toNumber(world.width, 100) * 0.5,
	};
	const position = normalizeVector3(levelOpening.startPosition, {
		x: center.x,
		y: Math.max(20, toNumber(world.height, 40) * 1.15),
		z: center.z + Math.max(30, toNumber(world.width, 100) * 0.7),
	});
	return {
		mode: "level",
		position: position,
		target: center,
		up: { x: 0, y: 1, z: 0 },
		fov: 60,
		near: 0.1,
		far: Math.max(200, toNumber(world.length, 100) + toNumber(world.width, 100) + toNumber(world.height, 40)),
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
	freeCamRuntime.maxSpeed = clamp(14 + freeCamRuntime.tuningStep * 2.5, 3, 80);
	freeCamRuntime.acceleration = clamp(44 + freeCamRuntime.tuningStep * 10, 10, 300);
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
		direction = addVector3(direction, cameraState.forward);
	}
	if (freeCamRuntime.keyState.KeyS || freeCamRuntime.keyState.ArrowDown) {
		direction = addVector3(direction, scaleVector3(cameraState.forward, -1));
	}
	if (freeCamRuntime.keyState.KeyD || freeCamRuntime.keyState.ArrowRight) {
		direction = addVector3(direction, cameraState.right);
	}
	if (freeCamRuntime.keyState.KeyA || freeCamRuntime.keyState.ArrowLeft) {
		direction = addVector3(direction, scaleVector3(cameraState.right, -1));
	}
	if (freeCamRuntime.keyState.Space) {
		direction = addVector3(direction, worldUp);
	}
	if (freeCamRuntime.keyState.ShiftLeft || freeCamRuntime.keyState.ShiftRight) {
		direction = addVector3(direction, scaleVector3(worldUp, -1));
	}

	const length = vector3Length(direction);
	if (length <= 0.000001) {
		return { x: 0, y: 0, z: 0 };
	}

	return normalizeUnitVector3(direction);
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
		cameraState.velocity = addVector3(
			cameraState.velocity,
			scaleVector3(inputDirection, freeCamRuntime.acceleration * dt)
		);
	} else {
		const damping = Math.pow(freeCamRuntime.dampingFactor, dt * 60);
		cameraState.velocity = scaleVector3(cameraState.velocity, damping);
	}

	const speed = vector3Length(cameraState.velocity);
	if (speed > freeCamRuntime.maxSpeed) {
		cameraState.velocity = scaleVector3(normalizeUnitVector3(cameraState.velocity), freeCamRuntime.maxSpeed);
	}

	cameraState.position = addVector3(cameraState.position, scaleVector3(cameraState.velocity, dt));
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
		const levelCameraState = resolveDefaultLevelCamera(sceneGraph, cameraConfig);
		cacheCameraPosition(levelCameraState);
		return levelCameraState;
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
	const forward = normalizeUnitVector3({
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

function UpdateCameraState(currentState, sceneGraph, cameraConfig, deltaSeconds) {
	if (!freeCamEnabled) {
		const resolvedLevelState = currentState && (currentState.mode === "level" || currentState.mode === "stationary")
			? currentState
			: resolveDefaultLevelCamera(sceneGraph, cameraConfig);
		cacheCameraPosition(resolvedLevelState);
		return resolvedLevelState;
	}

	const resolvedState = resolveFreeCamState(sceneGraph)
		|| (currentState && currentState.mode === "freecam" ? currentState : null)
		|| InitializeCameraState(sceneGraph, cameraConfig, sceneGraph && sceneGraph.meta ? sceneGraph.meta : null);

	const nextState = updateFreeCamState(resolvedState, deltaSeconds);
	cacheCameraPosition(nextState);
	return nextState;
}

export { InitializeCameraState, UpdateCameraState, HandleFreeCamInput, CalculateCameraState };