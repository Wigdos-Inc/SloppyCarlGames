// Controls camera state for gameplay and cutscenes.

import { normalizeVector3 } from "../../math/Vector3.js";

function toNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function createStationaryCameraState(sceneGraph, cameraConfig) {
	const world = sceneGraph && sceneGraph.world ? sceneGraph.world : {};
	const levelOpening = cameraConfig && cameraConfig.levelOpening ? cameraConfig.levelOpening : {};

	const center = {
		x: toNumber(world.length, 100) * 0.5,
		y: Math.max(0, toNumber(world.height, 40) * 0.35),
		z: toNumber(world.width, 100) * 0.5,
	};

	const startPosition = normalizeVector3(levelOpening.startPosition, {
		x: center.x,
		y: Math.max(20, toNumber(world.height, 40) * 1.15),
		z: center.z + Math.max(30, toNumber(world.width, 100) * 0.7),
	});

	return {
		mode: "stationary",
		position: startPosition,
		target: center,
		up: { x: 0, y: 1, z: 0 },
		fov: 60,
		near: 0.1,
		far: Math.max(200, toNumber(world.length, 100) + toNumber(world.width, 100) + toNumber(world.height, 40)),
	};
}

function CalculateCameraState(sceneGraph, cameraConfig) {
	return createStationaryCameraState(sceneGraph, cameraConfig);
}

function UpdateCameraState(currentState, sceneGraph, cameraConfig) {
	if (!currentState || currentState.mode !== "stationary") {
		return createStationaryCameraState(sceneGraph, cameraConfig);
	}

	return {
		...currentState,
		mode: "stationary",
	};
}

export { CalculateCameraState, UpdateCameraState };
