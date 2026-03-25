// General Level Initialiser and state handler

// Receives level data from game, validated by core/validate.js
// Creates level world or boss arena using builder/NewLevel.js
// Builds enemies and collectibles using builder/NewEntity.js
// End of player pipeline(s) to determine position.
// Uses Render.js for rendering level state per frame.

import { BuildLevel, RefreshSceneBoundingBoxes } from "../../builder/NewLevel.js";
import { RenderLevel } from "../Render.js";
import { Cache, IsPointerLocked, Log, PushToSession, SendEvent, SESSION_KEYS } from "../../core/meta.js";
import { CONFIG } from "../../core/config.js";
import { InitializeCameraState, UpdateCameraState, GetCameraVectors } from "./Camera.js";
import { DistanceVector3, LerpVector3 } from "../../math/Vector3.js";
import { UpdateEntityModelFromTransform } from "../../builder/NewEntity.js";
import { UpdateInputEventTypes } from "../Controls.js";
import { ValidateLevelPayload } from "../../core/validate.js";
import { InitializePlayer, UpdatePlayer, ResolvePlayerState, GetPlayerState } from "../../player/Master.js";
import { UpdatePlayerModelFromState } from "../../player/Model.js";
import { ApplyPhysicsPipeline, ApplyEntityPhysics } from "./Physics.js";
import { HandleEnemyCollisions } from "./Enemy.js";
import { HandleCollectiblePickups } from "./Collectible.js";
import { GetSimDistanceValue } from "../../physics/Collision.js";
import { InitializeTextureAnimation, UpdateTextureAnimation } from "./Texture.js";

const levelRuntimeState = {
	payload: null,
	sceneGraph: null,
	renderOptions: {
		rootId: "engine-level-root",
	},
};

const levelLoop = {
	active: false,
	paused: false,
	animationFrameId: null,
	lastFrameTime: 0,
	accumulator: 0,
	fixedTimeStep: 1000 / 60,
	maxFrameTime: 250,
};

const frameRate = CONFIG.PERFORMANCE.FrameRate;

function cacheLevelPayload(payload) {
	Cache.Level.lastPayload = payload;
	PushToSession(SESSION_KEYS.Cache, Cache);

	levelRuntimeState.payload = payload;
	return payload;
}

function buildIncomingPayloadSummary(payload) {
	const terrainObjects = payload.terrain;
	const terrainTriggers = payload.terrain.triggers.length;
	const obstacles = payload.obstacles.length;
	const entities = payload.entities.length;
	const blueprints = payload.entityBlueprints;
	const count = (key) => blueprints[key].length;

	return [
		"Engine received level payload:",
		`- levelId: ${payload.meta.levelId}`,
		`- stageId: ${payload.meta.stageId}`,
		`- world: ${payload.world.length}x${payload.world.width}x${payload.world.height}`,
		`- terrainObjects: ${terrainObjects}`,
		`- terrainTriggers: ${terrainTriggers}`,
		`- obstacles: ${obstacles}`,
		`- entities(overrides): ${entities}`,
		`- blueprintCounts: enemies=${count("enemies")}, npcs=${count("npcs")}, collectibles=${count("collectibles")}, projectiles=${count("projectiles")}`,
	].join("\n");
}

function shouldRefreshBoundingBoxes() {
	if (CONFIG.DEBUG.ALL !== true) {
		return false;
	}

	const bounding = CONFIG.DEBUG.LEVELS.BoundingBox;
	return (
		bounding.Terrain === true ||
		bounding.Scatter === true ||
		bounding.Entity === true ||
		bounding.EntityPart === true ||
		bounding.Obstacle === true ||
		bounding.Player === true ||
		bounding.PlayerPart === true ||
		bounding.Boss === true ||
		bounding.BossPart === true ||
		bounding.Grid.Visible === true
	);
}

function updateEntityMovement(entity, deltaSeconds) {
	const movement = entity.movement;
	const transform = entity.transform;
	const position = transform.position;
	const state = entity.state;

	if (movement.speed.value <= 0) return;

	const start = movement.start;
	const end = movement.end;
	const distance = DistanceVector3(start, end);
	if (distance <= 0.0001) {
		return;
	}

	const step = (movement.speed.value * deltaSeconds) / distance;
	state.movementProgress += step * state.direction;

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
	position.set(LerpVector3(start, end, t));
}

function syncEntityMeshes(sceneGraph) {
	for (let index = 0; index < sceneGraph.entities.length; index += 1) {
		const entity = sceneGraph.entities[index];

		if (entity.model) {
			UpdateEntityModelFromTransform(entity);
			entity.mesh = entity.model.parts[0].mesh;
			continue;
		}

		entity.mesh.transform.position = { ...entity.transform.position };
		entity.mesh.transform.rotation = { ...entity.transform.rotation };
		entity.mesh.transform.scale = { ...entity.transform.scale };
	}
}

function StartLevelLoop() {
	if (levelLoop.active) return;

	levelLoop.active = true;
	levelLoop.paused = false;
	levelLoop.lastFrameTime = performance.now();
	levelLoop.accumulator = 0;
	levelLoop.fixedTimeStep = 1000 / frameRate;

	const frame = () => {
		if (!levelLoop.active) return;

		const now = performance.now();
		let frameTime = now - levelLoop.lastFrameTime;
		levelLoop.lastFrameTime = now;

		if (frameTime > levelLoop.maxFrameTime) frameTime = levelLoop.maxFrameTime;
		levelLoop.accumulator += frameTime;

		while (levelLoop.accumulator >= levelLoop.fixedTimeStep && !levelLoop.paused) {
			if (IsPointerLocked()) Update(levelLoop.fixedTimeStep);
			levelLoop.accumulator -= levelLoop.fixedTimeStep;
		}

		if (!levelLoop.paused) {
			RenderLevel(levelRuntimeState.sceneGraph, levelRuntimeState.renderOptions);
		}

		levelLoop.animationFrameId = requestAnimationFrame(frame);
	};

	levelLoop.animationFrameId = requestAnimationFrame(frame);
}

function StopLevelLoop() {
	if (levelLoop.active) Log("ENGINE", "Level loop stopped.", "log", "Level");

	levelLoop.active = false;

	if (levelLoop.animationFrameId !== null) {
		cancelAnimationFrame(levelLoop.animationFrameId);
		levelLoop.animationFrameId = null;
	}
}

function PauseLevelLoop() {
	levelLoop.paused = true;
}

function ResumeLevelLoop() {
	levelLoop.paused = false;
}

async function CreateLevel(payload, options) {

	// === VALIDATION & NORMALIZATION PIPELINE ===

	payload = ValidateLevelPayload(payload);
	if (!payload) {
		Log("ENGINE", "Level.CreateLevel aborted: invalid payload.", "error", "Level");
		return null;
	}

	// Update Input Events Engine Listens for
	UpdateInputEventTypes({ payloadType: "level", payload: payload });

	const cachedPayload = cacheLevelPayload(payload);
	if (!cachedPayload) {
		Log("ENGINE", "Level.CreateLevel aborted: payload cache failed.", "error", "Level");
		return null;
	}

	Log("ENGINE", buildIncomingPayloadSummary(cachedPayload), "log", "Level");

	levelRuntimeState.renderOptions = {
		...levelRuntimeState.renderOptions,
		...(options.renderOptions ?? {}),
	};

	if (levelLoop.active) {
		StopLevelLoop();
		Log("ENGINE", "Previous level loop stopped before new level creation.", "log", "Level");
		Log("ENGINE", "Please end levels naturally before starting new ones.", "warn", "Level");
	}

	const sceneGraph = await BuildLevel(cachedPayload);

	// Initialize player if payload defines one.
	if (sceneGraph.playerConfig) {
		InitializePlayer(sceneGraph.playerConfig, sceneGraph);
		Log("ENGINE", `Player initialized: character=${sceneGraph.playerConfig.character}`, "log", "Level");
	}

	sceneGraph.cameraConfig.state = InitializeCameraState(
		sceneGraph,
		sceneGraph.cameraConfig,
		cachedPayload.meta
	);

	InitializeTextureAnimation(sceneGraph);

	levelRuntimeState.sceneGraph = sceneGraph;
	if (shouldRefreshBoundingBoxes()) {
		RefreshSceneBoundingBoxes(sceneGraph);
	}

	if (CONFIG.DEBUG.ALL && CONFIG.DEBUG.LEVELS.BoundingBox.Grid.Visible) {
		Log(
			"ENGINE", 
			`Debug Grid Enabled \u2014 scale: ${CONFIG.DEBUG.LEVELS.BoundingBox.Grid.Scale} units`, 
			"log", 
			"Level"
		);
	}

	RenderLevel(sceneGraph, levelRuntimeState.renderOptions);
	StartLevelLoop();
	Log("ENGINE", "Level loop started.", "log", "Level");

	SendEvent("LEVEL_READY", {
		levelId: cachedPayload.id,
		title: cachedPayload.title,
	});

	Log("ENGINE", `Level created: ${cachedPayload.id}`, "log", "Level");
	Log("ENGINE", "Level generation finished and render initialized.", "log", "Level");
	return sceneGraph;
}

function Update(deltaMilliseconds) {
	const deltaMs = deltaMilliseconds;
	const deltaSeconds = Math.max(0, deltaMs) / 1000;
	const sceneGraph = levelRuntimeState.sceneGraph;
	const entities = sceneGraph.entities;

	// === PLAYER PIPELINE ===
	const playerState = GetPlayerState();
	if (playerState.active) {
		const cameraVectors = GetCameraVectors();

		// 1. Input → Movement & Abilities
		UpdatePlayer(deltaSeconds, sceneGraph, cameraVectors);

		// 2. Physics pipeline (gravity, resistance, buoyancy, collision, correction)
		ApplyPhysicsPipeline(playerState, sceneGraph, deltaSeconds);

		// 3. Enemy collisions (damage / attack)
		HandleEnemyCollisions(playerState, sceneGraph, deltaSeconds);

		// 4. Collectible pickups
		HandleCollectiblePickups(playerState, sceneGraph);

		// 5. Resolve FSM state (Idle, Running, Jumping, etc.)
		ResolvePlayerState();

		// 6. Sync player model from state
		UpdatePlayerModelFromState(playerState);
	}

	// === NON-PLAYER ENTITY UPDATE ===
	const simDistance = GetSimDistanceValue();
	const cameraPosition = sceneGraph.cameraConfig.state.position;

	for (let index = 0; index < entities.length; index += 1) {
		const entity = entities[index];
		if (entity.type === "player") continue;
		if (DistanceVector3(cameraPosition, entity.transform.position) > simDistance) continue;
		updateEntityMovement(entity, deltaSeconds);
		ApplyEntityPhysics(entity, sceneGraph, deltaSeconds);
	}

	// === CAMERA ===
	sceneGraph.cameraConfig.state = UpdateCameraState(
		sceneGraph.cameraConfig.state,
		sceneGraph,
		sceneGraph.cameraConfig,
		deltaSeconds,
		playerState
	);

	// === TEXTURE ANIMATIONS ===
	UpdateTextureAnimation(sceneGraph, deltaMs);

	syncEntityMeshes(sceneGraph);
	if (shouldRefreshBoundingBoxes()) RefreshSceneBoundingBoxes(sceneGraph);
}

function GetActiveLevel() {
	return levelRuntimeState.sceneGraph;
}

export { 
	CreateLevel, 
	Update, 
	GetActiveLevel, 
	StartLevelLoop, 
	StopLevelLoop, 
	PauseLevelLoop, 
	ResumeLevelLoop 
};