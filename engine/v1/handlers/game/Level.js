// General Level Initialiser and state handler

// Receives level data from game, validated by core/validate.js
// Creates level world or boss arena using builder/NewLevel.js
// Builds enemies and collectibles using builder/NewEntity.js
// End of player pipeline(s) to determine position.
// Uses Render.js for rendering level state per frame.

import { BuildLevel, RefreshSceneBoundingBoxes } from "../../builder/NewLevel.js";
import { RenderLevel } from "../Render.js";
import { Cache, Log, pushToSession, SESSION_KEYS } from "../../core/meta.js";
import { InitializeCameraState, UpdateCameraState } from "./Camera.js";
import { addVector3, distanceVector3, lerpVector3, normalizeVector3, scaleVector3 } from "../../math/Vector3.js";
import { UpdateEntityModelFromTransform } from "../../builder/NewEntity.js";

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

function buildIncomingPayloadSummary(payload) {
	const source = payload && typeof payload === "object" ? payload : {};
	const terrainObjects = source.terrain && Array.isArray(source.terrain.objects) ? source.terrain.objects.length : 0;
	const terrainTriggers = source.terrain && Array.isArray(source.terrain.triggers) ? source.terrain.triggers.length : 0;
	const obstacles = Array.isArray(source.obstacles) ? source.obstacles.length : 0;
	const entities = Array.isArray(source.entities) ? source.entities.length : 0;
	const blueprints = source.entityBlueprints && typeof source.entityBlueprints === "object" ? source.entityBlueprints : {};
	const count = (key) => (Array.isArray(blueprints[key]) ? blueprints[key].length : 0);

	return [
		"Engine received level payload:",
		`- levelId: ${source.meta && source.meta.levelId ? source.meta.levelId : source.id || "unknown"}`,
		`- stageId: ${source.meta && source.meta.stageId ? source.meta.stageId : source.id || "unknown"}`,
		`- world: ${source.world ? `${source.world.length || 0}x${source.world.width || 0}x${source.world.height || 0}` : "missing"}`,
		`- terrainObjects: ${terrainObjects}`,
		`- terrainTriggers: ${terrainTriggers}`,
		`- obstacles: ${obstacles}`,
		`- entities(overrides): ${entities}`,
		`- blueprintCounts: enemies=${count("enemies")}, npcs=${count("npcs")}, collectibles=${count("collectibles")}, projectiles=${count("projectiles")}`,
	].join("\n");
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
		if (!entity) {
			continue;
		}

		if (entity.model) {
			UpdateEntityModelFromTransform(entity);
			entity.mesh = entity.model.parts && entity.model.parts[0] ? entity.model.parts[0].mesh : null;
			continue;
		}

		if (!entity.mesh) {
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

async function CreateLevel(payload, options) {
	if (!payload || typeof payload !== "object") {
		Log("ENGINE", "Level.CreateLevel aborted: invalid payload.", "warn", "Level");
		return null;
	}

	const cachedPayload = cacheLevelPayload(payload);
	if (!cachedPayload) {
		Log("ENGINE", "Level.CreateLevel aborted: payload cache failed.", "error", "Level");
		return null;
	}

	Log("ENGINE", buildIncomingPayloadSummary(cachedPayload), "log", "Level");

	const resolvedOptions = options && typeof options === "object" ? options : {};
	levelRuntimeState.renderOptions = {
		...levelRuntimeState.renderOptions,
		...(resolvedOptions.renderOptions || {}),
	};

	if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
		window.dispatchEvent(
			new CustomEvent("ENGINE_LEVEL_PAYLOAD_PROCESSED", {
				detail: { payload: cachedPayload },
			})
		);
	}

	const sceneGraph = await BuildLevel(cachedPayload);
	if (!sceneGraph.cameraConfig || typeof sceneGraph.cameraConfig !== "object") {
		sceneGraph.cameraConfig = {};
	}
	sceneGraph.cameraConfig.state = InitializeCameraState(
		sceneGraph,
		sceneGraph.cameraConfig,
		cachedPayload.meta || null
	);

	levelRuntimeState.sceneGraph = sceneGraph;
	levelRuntimeState.lastUpdateAt = performance.now();
	RefreshSceneBoundingBoxes(sceneGraph);

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
	Log("ENGINE", "Level generation finished and render initialized.", "log", "Level");
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
		sceneGraph.cameraConfig,
		deltaSeconds
	);

	syncEntityMeshes(sceneGraph);
	RefreshSceneBoundingBoxes(sceneGraph);
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