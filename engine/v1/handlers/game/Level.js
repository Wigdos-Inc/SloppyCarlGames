// General Level Initialiser and state handler

// Receives level data from game, validated by core/validate.js
// Creates level world or boss arena using builder/NewLevel.js
// Builds enemies and collectibles using builder/NewEntity.js
// End of player pipeline(s) to determine position.
// Uses Render.js for rendering level state per frame.

import { BuildLevel } from "../../builder/NewLevel.js";
import { RenderLevel } from "../Render.js";
import { Cache, Log, pushToSession, SESSION_KEYS } from "../../core/meta.js";
import { CalculateCameraState, UpdateCameraState } from "../helpers/Camera.js";
import { addVector3, distanceVector3, lerpVector3, normalizeVector3, scaleVector3 } from "../../math/Vector3.js";

const levelRuntimeState = {
	payload: null,
	sceneGraph: null,
	renderOptions: {
		rootId: "engine-level-root",
	},
	lastUpdateAt: 0,
};

function toNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clonePayload(payload) {
	if (!payload || typeof payload !== "object") {
		return null;
	}
	try {
		return JSON.parse(JSON.stringify(payload));
	} catch (error) {
		void error;
		return null;
	}
}

function cacheLevelPayload(payload) {
	const cachedPayload = clonePayload(payload);
	if (!cachedPayload) {
		return null;
	}

	if (Cache && Cache.Level) {
		Cache.Level.lastPayload = cachedPayload;
		pushToSession(SESSION_KEYS.Cache, Cache);
	}

	levelRuntimeState.payload = cachedPayload;
	return cachedPayload;
}

function applyCameraState(sceneGraph) {
	if (!sceneGraph || typeof sceneGraph !== "object") {
		return sceneGraph;
	}

	if (!sceneGraph.cameraConfig || typeof sceneGraph.cameraConfig !== "object") {
		sceneGraph.cameraConfig = {};
	}

	sceneGraph.cameraConfig.state = CalculateCameraState(sceneGraph, sceneGraph.cameraConfig);
	return sceneGraph;
}

function updateEntityMovement(entity, deltaSeconds) {
	if (!entity || !entity.movement) {
		return;
	}

	const movement = entity.movement;
	const transform = entity.transform || (entity.transform = { position: { x: 0, y: 0, z: 0 } });
	const position = transform.position || (transform.position = { x: 0, y: 0, z: 0 });
	const state = entity.state || (entity.state = { movementProgress: 0, direction: 1 });

	if (movement.speed <= 0) {
		return;
	}

	const start = normalizeVector3(movement.start, { x: 0, y: 0, z: 0 });
	const end = normalizeVector3(movement.end, start);
	const distance = distanceVector3(start, end);
	if (distance <= 0.0001) {
		return;
	}

	const step = (movement.speed * deltaSeconds) / distance;
	state.movementProgress += step * (state.direction || 1);

	if (state.movementProgress >= 1 || state.movementProgress <= 0) {
		if (movement.backAndForth) {
			state.direction = state.movementProgress >= 1 ? -1 : 1;
			state.movementProgress = Math.max(0, Math.min(1, state.movementProgress));
		} else if (movement.repeat) {
			state.movementProgress = 0;
		} else {
			state.movementProgress = Math.max(0, Math.min(1, state.movementProgress));
		}
	}

	const t = Math.max(0, Math.min(1, state.movementProgress));
	const nextPosition = lerpVector3(start, end, t);
	position.x = nextPosition.x;
	position.y = nextPosition.y;
	position.z = nextPosition.z;
}

function applyEntityPhysics(entity, sceneGraph, deltaSeconds) {
	if (!entity) {
		return;
	}

	const movement = entity.movement || {};
	const world = sceneGraph && sceneGraph.world ? sceneGraph.world : {};
	const deathBarrierY = toNumber(world.deathBarrierY, -25);
	const gravityPerSecond = 9.81;

	if (!entity.velocity) {
		entity.velocity = { x: 0, y: 0, z: 0 };
	}
	if (!entity.transform) {
		entity.transform = { position: { x: 0, y: 0, z: 0 } };
	}
	if (!entity.transform.position) {
		entity.transform.position = { x: 0, y: 0, z: 0 };
	}

	if (movement.physics) {
		entity.velocity.y -= gravityPerSecond * deltaSeconds;
		entity.transform.position = addVector3(
			entity.transform.position,
			scaleVector3(entity.velocity, deltaSeconds)
		);
		if (entity.transform.position.y < deathBarrierY) {
			entity.transform.position.y = deathBarrierY;
			entity.velocity.y = 0;
		}
	}
}

function syncEntityMeshes(sceneGraph) {
	const entities = Array.isArray(sceneGraph && sceneGraph.entities) ? sceneGraph.entities : [];
	for (let index = 0; index < entities.length; index += 1) {
		const entity = entities[index];
		if (!entity || !entity.mesh) {
			continue;
		}
		if (!entity.mesh.transform) {
			entity.mesh.transform = {};
		}
		entity.mesh.transform.position = { ...entity.transform.position };
		entity.mesh.transform.rotation = { ...entity.transform.rotation };
		entity.mesh.transform.scale = { ...entity.transform.scale };
	}
}

function CreateLevel(payload, options) {
	if (!payload || typeof payload !== "object") {
		Log("ENGINE", "Level.CreateLevel aborted: invalid payload.", "warn", "Level");
		return null;
	}

	const cachedPayload = cacheLevelPayload(payload);
	if (!cachedPayload) {
		Log("ENGINE", "Level.CreateLevel aborted: payload cache failed.", "error", "Level");
		return null;
	}

	const resolvedOptions = options && typeof options === "object" ? options : {};
	levelRuntimeState.renderOptions = {
		...levelRuntimeState.renderOptions,
		...(resolvedOptions.renderOptions || {}),
	};

	const sceneGraph = BuildLevel(cachedPayload);
	applyCameraState(sceneGraph);

	levelRuntimeState.sceneGraph = sceneGraph;
	levelRuntimeState.lastUpdateAt = performance.now();

	RenderLevel(sceneGraph, levelRuntimeState.renderOptions);

	if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
		window.dispatchEvent(
			new CustomEvent("ENGINE_LEVEL_READY", {
				detail: {
					levelId: cachedPayload.id || null,
					title: cachedPayload.title || null,
				},
			})
		);
	}

	Log("ENGINE", `Level created: ${cachedPayload.id || "unknown"}`, "log", "Level");
	return sceneGraph;
}

function Update(deltaMilliseconds) {
	if (!levelRuntimeState.sceneGraph) {
		return null;
	}

	const now = performance.now();
	const computedDelta = levelRuntimeState.lastUpdateAt > 0
		? now - levelRuntimeState.lastUpdateAt
		: 16.67;
	levelRuntimeState.lastUpdateAt = now;

	const deltaMs = typeof deltaMilliseconds === "number" ? deltaMilliseconds : computedDelta;
	const deltaSeconds = Math.max(0, deltaMs) / 1000;
	const sceneGraph = levelRuntimeState.sceneGraph;
	const entities = Array.isArray(sceneGraph.entities) ? sceneGraph.entities : [];

	for (let index = 0; index < entities.length; index += 1) {
		const entity = entities[index];
		if (!entity) {
			continue;
		}
		updateEntityMovement(entity, deltaSeconds);
		applyEntityPhysics(entity, sceneGraph, deltaSeconds);
	}

	sceneGraph.cameraConfig.state = UpdateCameraState(
		sceneGraph.cameraConfig.state,
		sceneGraph,
		sceneGraph.cameraConfig
	);

	syncEntityMeshes(sceneGraph);
	RenderLevel(sceneGraph, levelRuntimeState.renderOptions);

	return sceneGraph;
}

function GetActiveLevel() {
	return levelRuntimeState.sceneGraph;
}

function LoadLevel(payload, options) {
	return CreateLevel(payload, options);
}

export { CreateLevel, Update, GetActiveLevel, LoadLevel };