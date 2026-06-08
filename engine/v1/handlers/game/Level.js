// General Level Initialiser and state handler

// Receives level data from game, validated by core/validate.js
// Creates level world or boss arena using builder/NewLevel.js
// Builds enemies and collectibles using builder/NewEntity.js
// End of player pipeline(s) to determine position.
// Uses Render.js for rendering level state per frame.

import { BuildLevel, RefreshSceneBoundingBoxes } from "../../builder/NewLevel.js";
import { RenderLevel, RemoveRoot, ClearLevelRenderer } from "../Render.js";
import { Cache, Log, PushToSession, RequestPointerLock, SendEvent, SESSION_KEYS, ENTITY_TYPES } from "../../core/meta.js";
import { CONFIG } from "../../core/config.js";
import { InitializeCameraState, UpdateCameraState, GetCameraVectors } from "./Camera.js";
import { Vector3Distance, LerpVector3, CloneVector3 } from "../../math/Vector3.js";
import { BuildEntity, UpdateEntityModelFromTransform } from "../../builder/NewEntity.js";
import { BuildObstacles } from "../../builder/NewObstacle.js";
import { BuildObject } from "../../builder/NewObject.js";
import { UpdateInputEventTypes } from "../Controls.js";
import { ValidateLevelPayload } from "../../core/validate.js";
import {
	InitializePlayer,
	UpdatePlayer,
	ResolvePlayerState,
	GetPlayerState,
} from "../../player/Master.js";
import { ApplyPhysicsPipeline } from "../../physics/Master.js";
import { HandleEnemyCollisions } from "./Enemy.js";
import { HandleCollectiblePickups } from "./Collectible.js";
import { ResolveEntityAnimation } from "./Animation.js";
import { GetSimDistanceValue } from "../../physics/Collision.js";
import { InitializeTextureAnimation, UpdateTextureAnimation, AddTextureAnimationEntries } from "./Texture.js";
import { PrepareLevelVisualResources, AddToVisualResources } from "../../builder/NewTexture.js";
import { Clamp01 } from "../../math/Utilities.js";
import { IsSimulatorActive, UpdateSimulator } from "./Simulator.js";

const levelRuntimeState = {
	sceneGraph: null,
	renderOptions: { rootId: "engine-level-root" },
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


function cacheLevelPayload(payload) {
	Cache.Level.lastPayload = payload;
	PushToSession(SESSION_KEYS.Cache, Cache);
	return payload;
}

function buildIncomingPayloadSummary(payload) {
	const count = (key) => payload.entityBlueprints[key].length;
	return [
		"Engine received level payload:",
		`- levelId: ${payload.meta.levelId}`,
		`- stageId: ${payload.meta.stageId}`,
		`- world: ${payload.world.length.value}x${payload.world.width.value}x${payload.world.height.value}`,
		`- terrainObjects: ${payload.terrain}`,
		`- terrainTriggers: ${payload.terrain.triggers.length}`,
		`- obstacles: ${payload.obstacles.length}`,
		`- entities(overrides): ${payload.entities.length}`,
		`- blueprintCounts: enemies=${count("enemies")}, npcs=${count("npcs")}, collectibles=${count("collectibles")}, projectiles=${count("projectiles")}`,
	].join("\n");
}

function shouldRefreshBoundingBoxes() {
	if (CONFIG.DEBUG.ALL !== true) return false;
	return (
		CONFIG.DEBUG.LEVELS.BoundingBox.Terrain === true ||
		CONFIG.DEBUG.LEVELS.BoundingBox.Scatter === true ||
		CONFIG.DEBUG.LEVELS.BoundingBox.Entity === true ||
		CONFIG.DEBUG.LEVELS.BoundingBox.EntityPart === true ||
		CONFIG.DEBUG.LEVELS.BoundingBox.Obstacle === true ||
		CONFIG.DEBUG.LEVELS.BoundingBox.Player === true ||
		CONFIG.DEBUG.LEVELS.BoundingBox.PlayerPart === true ||
		CONFIG.DEBUG.LEVELS.BoundingBox.Boss === true ||
		CONFIG.DEBUG.LEVELS.BoundingBox.BossPart === true ||
		CONFIG.DEBUG.LEVELS.BoundingBox.Grid.Visible === true
	);
}

function updateEntityMovement(entity, deltaSeconds) {
	if (entity.movement.speed.value <= 0) return;

	const distance = Vector3Distance(entity.movement.start, entity.movement.end);
	if (distance <= 0.0001) return;

	let moveProg = entity.state.movementProgress;
	moveProg += ((entity.movement.speed.value * deltaSeconds) / distance) * entity.state.direction;
	if (moveProg >= 1 || moveProg <= 0) {
		if (entity.movement.backAndForth) {
			entity.state.direction = moveProg >= 1 ? -1 : 1;
			moveProg = Clamp01(moveProg);
		}
		else if (entity.movement.repeat) moveProg = 0;
		else moveProg = Clamp01(moveProg);
	}

	entity.state.movementProgress = moveProg;
	entity.transform.position.set(LerpVector3(entity.movement.start, entity.movement.end, Clamp01(moveProg)));
}

function syncEntityMeshes(sceneGraph) {
	sceneGraph.entities.forEach(entity => {
		if (entity.type === "player") return;

		if (entity.model) {
			UpdateEntityModelFromTransform(entity);
			entity.mesh = entity.model.parts[0].mesh;
			return;
		}

		entity.mesh.transform.position = entity.transform.position.clone();
		entity.mesh.transform.rotation = entity.transform.rotation.clone();
		entity.mesh.transform.scale = CloneVector3(entity.transform.scale);
	});
}

function onPointerLockChange() {
	if (!levelLoop.active) return;
	if (document.pointerLockElement) ResumeLevelLoop();
	else PauseLevelLoop();
}

function StartLevelLoop() {
	if (levelLoop.active) return;

	levelLoop.active = true;
	levelLoop.paused = false;
	levelLoop.lastFrameTime = performance.now();
	levelLoop.accumulator = 0;
	levelLoop.fixedTimeStep = 1000 / CONFIG.PERFORMANCE.FrameRate;
	document.addEventListener("pointerlockchange", onPointerLockChange);

	const frame = () => {
		if (!levelLoop.active) return;

		const now = performance.now();
		let frameTime = now - levelLoop.lastFrameTime;
		levelLoop.lastFrameTime = now;

		if (frameTime > levelLoop.maxFrameTime) frameTime = levelLoop.maxFrameTime;
		if (!levelLoop.paused) levelLoop.accumulator += frameTime;

		while (levelLoop.accumulator >= levelLoop.fixedTimeStep && !levelLoop.paused) {
			Update(levelLoop.fixedTimeStep);
			levelLoop.accumulator -= levelLoop.fixedTimeStep;
		}

		if (!levelLoop.paused) RenderLevel(levelRuntimeState.sceneGraph, levelRuntimeState.renderOptions);

		levelLoop.animationFrameId = requestAnimationFrame(frame);
	};

	levelLoop.animationFrameId = requestAnimationFrame(frame);
}

function StopLevelLoop() {
	if (levelLoop.active) {
		Log("ENGINE", "Level loop stopped.", "log", "Level");
		SendEvent("LEVEL_STOPPED", {});
	}
	levelLoop.active = false;
	document.removeEventListener("pointerlockchange", onPointerLockChange);

	if (levelLoop.animationFrameId !== null) {
		cancelAnimationFrame(levelLoop.animationFrameId);
		levelLoop.animationFrameId = null;
	}
}

function ClearLevel(clearCache = true) {
	StopLevelLoop();
	ClearLevelRenderer(levelRuntimeState.renderOptions.rootId);
	RemoveRoot(levelRuntimeState.renderOptions.rootId);
	levelRuntimeState.sceneGraph = null;
	if (clearCache) {
		Cache.Level.lastPayload = null;
		PushToSession(SESSION_KEYS.Cache, Cache);
	}
	Log("ENGINE", "Level cleared.", "log", "Level");
}

function PauseLevelLoop() {
	if (levelLoop.paused) return;
	levelLoop.paused = true;
	SendEvent("LEVEL_PAUSED", {});
}

function ResumeLevelLoop() {
	if (!levelLoop.paused) return;
	levelLoop.paused = false;
	SendEvent("LEVEL_RESUMED", {});
}

function ToggleLevelLoopPause() {
	if (levelLoop.paused) ResumeLevelLoop();
	else PauseLevelLoop();
}

async function CreateLevel(payload, options, simulatorOverride = false) {

	// === VALIDATION & NORMALIZATION PIPELINE ===

	const rawPayload = structuredClone(payload);
	payload = await ValidateLevelPayload(payload);
	if (!payload) {
		Log("ENGINE", "Level.CreateLevel aborted: invalid payload.", "error", "Level");
		return null;
	}

	// Update Input Events Engine Listens for
	UpdateInputEventTypes({ payloadType: "level", payload });

	// Cache raw (pre-normalization) payload so Exit() can restore without re-validation failing on Unit objects.
	if (!simulatorOverride) cacheLevelPayload(rawPayload);

	// Delete Menu UI Cache (if not simulator)
	if (!simulatorOverride) {
		Cache.UI.lastPayload = null;
		Cache.UI.screenID = null;
		PushToSession(SESSION_KEYS.Cache, Cache);
	}

	Log("ENGINE", buildIncomingPayloadSummary(payload), "log", "Level");

	levelRuntimeState.renderOptions = {
		...levelRuntimeState.renderOptions,
		...(options.renderOptions ?? {}),
	};

	if (levelLoop.active) {
		StopLevelLoop();
		Log("ENGINE", "Previous level loop stopped before new level creation.", "log", "Level");
		Log("ENGINE", "Please end levels naturally before starting new ones.", "warn", "Level");
	}

	const sceneGraph = await BuildLevel(payload);
	Log("ENGINE", `Level sceneGraph created: ${payload.id}`, "log", "Level");

	// Initialize player if payload defines one.
	if (sceneGraph.playerConfig) {
		await InitializePlayer(sceneGraph.playerConfig, sceneGraph);
		Log("ENGINE", `Player initialized: character=${sceneGraph.playerConfig.character}`, "log", "Level");
	}

	await PrepareLevelVisualResources(sceneGraph);

	sceneGraph.cameraConfig.state = InitializeCameraState(
		sceneGraph,
		sceneGraph.cameraConfig,
		payload.meta,
		sceneGraph.playerConfig ? GetPlayerState() : null
	);

	InitializeTextureAnimation(sceneGraph);

	levelRuntimeState.sceneGraph = sceneGraph;
	if (shouldRefreshBoundingBoxes()) RefreshSceneBoundingBoxes(sceneGraph);

	if (CONFIG.DEBUG.ALL && CONFIG.DEBUG.LEVELS.BoundingBox.Grid.Visible) {
		Log(
			"ENGINE",
			`Debug Grid Enabled — scale: ${CONFIG.DEBUG.LEVELS.BoundingBox.Grid.Scale} units`,
			"log",
			"Level"
		);
	}

	RenderLevel(sceneGraph, levelRuntimeState.renderOptions);
	Log("ENGINE", "Level render initialized.", "log", "Level");

	StartLevelLoop();
	RequestPointerLock();
	Log("ENGINE", "Level loop started.", "log", "Level");

	SendEvent("LEVEL_READY", {
		levelId: payload.id,
		title: payload.title,
	});

	if (CONFIG.CUSTOM_EVENTS.Entities.spawn) {
		const localSendEvent = (definition, title) => {
			if (definition.customEvents.spawn) SendEvent(title, {
				id      : definition.id,
				type    : definition.type,
				position: CloneVector3(definition.transform.position),
				velocity: CloneVector3(definition.velocity)
			});
		}
		localSendEvent(GetPlayerState(), "PLAYER_SPAWN");
		sceneGraph.entities.forEach(entity => localSendEvent(entity, "ENTITY_SPAWN"));
	}

	return sceneGraph;
}

function runFrameTail(sceneGraph, deltaMilliseconds) {
	UpdateTextureAnimation(sceneGraph, deltaMilliseconds);
	syncEntityMeshes(sceneGraph);
	if (shouldRefreshBoundingBoxes()) RefreshSceneBoundingBoxes(sceneGraph);
}

function Update(deltaMilliseconds) {
	const deltaSeconds = Math.max(0, deltaMilliseconds) / 1000;
	const sceneGraph = levelRuntimeState.sceneGraph;

	if (IsSimulatorActive()) {
		UpdateSimulator(deltaMilliseconds, sceneGraph);
		runFrameTail(sceneGraph, deltaMilliseconds);
		return;
	}

	// === PLAYER PIPELINE ===
	const playerState = GetPlayerState();
	if (playerState.active) {
		UpdatePlayer(deltaSeconds, GetCameraVectors());                 // 1. Input → Movement & Abilities
		ApplyPhysicsPipeline(playerState, sceneGraph, deltaSeconds);    // 2. Forces, Collision, Correction.
		HandleEnemyCollisions(playerState, sceneGraph, deltaSeconds);   // 3. Combat Collisions (damage / attack)
		HandleCollectiblePickups(playerState, sceneGraph);              // 4. Collectible Pickups
		ResolvePlayerState();                                           // 5. Resolve State (Idle, Running, Jumping, etc.)
	}

	// === NON-PLAYER ENTITY UPDATE ===
	sceneGraph.entities.forEach(entity => {
		if (entity.type === "player") return;
		if (Vector3Distance(sceneGraph.cameraConfig.state.position, entity.transform.position) > GetSimDistanceValue()) return;
		updateEntityMovement(entity, deltaSeconds);
		ApplyPhysicsPipeline(entity, sceneGraph, deltaSeconds);
	});

	// === CAMERA ===
	sceneGraph.cameraConfig.state = UpdateCameraState(
		sceneGraph.cameraConfig.state, sceneGraph, sceneGraph.cameraConfig, deltaSeconds, playerState
	);

	// === ANIMATION (visual-only display transforms; player only this pass) ===
	// Runs after true poses are settled and before render reads displayTransform.
	if (playerState.active) ResolveEntityAnimation(playerState, deltaSeconds);

	runFrameTail(sceneGraph, deltaMilliseconds);
}

function GetActiveLevel() {
	return levelRuntimeState.sceneGraph;
}

/* === SCENE MUTATION === */

function buildSceneSurfaceMap(terrain, obstacles) {
	const map = {};
	terrain.forEach((mesh) => {
		map[mesh.id] = {
			position  : mesh.transform.position,
			dimensions: mesh.dimensions,
			scale     : mesh.transform.scale,
			topY      : mesh.transform.position.y + (mesh.dimensions.y * mesh.transform.scale.y * 0.5),
		};
	});
	obstacles.forEach((obstacle) => {
		const mesh = obstacle.parts[0];
		map[obstacle.id] = {
			position  : mesh.transform.position,
			dimensions: mesh.dimensions,
			scale     : mesh.transform.scale,
			topY      : mesh.transform.position.y,
		};
	});
	return map;
}

function SpawnIntoScene(definition, objectType, sceneGraph) {
	if (ENTITY_TYPES.includes(objectType)) {
		const surfaceMap = buildSceneSurfaceMap(sceneGraph.terrain, sceneGraph.obstacles);
		const built = BuildEntity(definition, surfaceMap);
		sceneGraph.entities.push(built);
		AddToVisualResources(built, objectType, sceneGraph);
		AddTextureAnimationEntries(sceneGraph);
		if (shouldRefreshBoundingBoxes()) RefreshSceneBoundingBoxes(sceneGraph);
		return built;
	}

	if (objectType === "obstacle") {
		const built = BuildObstacles([definition], {})[0];
		sceneGraph.obstacles.push(built);
		AddToVisualResources(built, objectType, sceneGraph);
		AddTextureAnimationEntries(sceneGraph);
		if (shouldRefreshBoundingBoxes()) RefreshSceneBoundingBoxes(sceneGraph);
		return built;
	}

	const built = BuildObject(definition);
	sceneGraph.terrain.push(built);
	AddToVisualResources(built, objectType, sceneGraph);
	AddTextureAnimationEntries(sceneGraph);
	if (shouldRefreshBoundingBoxes()) RefreshSceneBoundingBoxes(sceneGraph);
	return built;
}

function DespawnFromScene(target, objectType, sceneGraph) {
	let array;
	if (ENTITY_TYPES.includes(objectType)) array = sceneGraph.entities;
	else if (objectType === "obstacle") array = sceneGraph.obstacles;
	else array = sceneGraph.terrain;

	const index = array.indexOf(target);
	if (index >= 0) array.splice(index, 1);
	if (shouldRefreshBoundingBoxes()) RefreshSceneBoundingBoxes(sceneGraph);
	return target;
}


export {
	CreateLevel, ClearLevel, Update, GetActiveLevel,
	StartLevelLoop, StopLevelLoop, PauseLevelLoop, ResumeLevelLoop, ToggleLevelLoopPause,
	SpawnIntoScene, DespawnFromScene,
};
