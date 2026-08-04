// General Level Initialiser and state handler

// Receives level data from game, validated by core/validate.js
// Creates level world or boss arena using builder/NewLevel.js
// Builds enemies and collectibles using builder/NewEntity.js
// End of player pipeline(s) to determine position.
// Uses Render.js for rendering level state per frame.

import { BuildLevel, RefreshSceneBoundingBoxes } from "../../builder/NewLevel.js";
import { RenderLevel, RemoveRoot, ClearLevelRenderer } from "../Render.js";
import { Cache, Log, PushToSession, RequestPointerLock, SendEvent, SESSION_KEYS, ENTITY_TYPES, ReleasePointerLock } from "../../core/meta.js";
import { CONFIG } from "../../core/config.js";
import { InitializeCameraState, UpdateCameraState, GetCameraVectors } from "./Camera.js";
import { Vector3Distance, LerpVector3, CloneVector3, RotateByEuler } from "../../math/Vector3.js";
import { BuildEntity, UpdateEntityModelFromTransform } from "../../builder/NewEntity.js";
import { GenerateParticles } from "../../builder/NewParticles.js";
import { BuildObstacles } from "../../builder/NewObstacle.js";
import { BuildTerrain } from "../../builder/NewTerrain.js";
import { BuildObject } from "../../builder/NewObject.js";
import { UpdateInputEventTypes } from "../Controls.js";
import { ValidateLevelPayload, ValidateRuntime } from "../../core/validate.js";
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
import { IsBeyondSimDistance } from "../../physics/Collision.js";
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
	ReleasePointerLock()
	levelLoop.paused = true;
	SendEvent("LEVEL_PAUSED", {});
}

function ResumeLevelLoop() {
	if (!levelLoop.paused) return;
	RequestPointerLock();
	levelLoop.paused = false;
	SendEvent("LEVEL_RESUMED", {});
}

const ToggleLevelLoopPause = () => levelLoop.paused ? ResumeLevelLoop() : PauseLevelLoop();

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
			`Debug Grid Enabled — scale: ${CONFIG.DEBUG.LEVELS.BoundingBox.Grid.Scale.value} units`,
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

// Every scene-side particle spawn resolves the same three scene fields; only the viewer gate differs.
const generateForScene = (request, viewerPosition, sceneGraph) => GenerateParticles(
	request, viewerPosition, sceneGraph.world.textureScale, sceneGraph.visualResources.textureRegistry, sceneGraph.partGeometryCache
);

// Drives every group's lifetime and emits the siblings a seeding group asks for.
// Reverse-index because seeding appends: new entries wait for the next frame.
function updateParticles(sceneGraph, deltaMilliseconds, deltaSeconds) {
	const seedRequests = [];
	const targets = resolveGeneratorTargets(sceneGraph);

	for (let i = sceneGraph.entities.length - 1; i >= 0; i--) {
		const group = sceneGraph.entities[i].particle;
		if (group === null) continue;
		// Mode test: a burst has no target to ride.
		if (group.targetKey !== null) group.follow(targets);
		group.advance(deltaMilliseconds, deltaSeconds);

		// Splice-safe: `i` counts down, and seeding drains after the loop.
		if (group.finished) {
			sceneGraph.entities.splice(i, 1);
			continue;
		}
		if (group.seedDue(deltaMilliseconds)) seedRequests.push(group.request);
	}

	// Siblings reuse the level-built group's geometry key and texture id, so a plain push is complete.
	seedRequests.forEach((request) => {
		const { groups } = generateForScene(request, sceneGraph.cameraConfig.state.position, sceneGraph);
		sceneGraph.entities.push(...groups);
	});
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
		updateParticles(sceneGraph, deltaMilliseconds, deltaSeconds);
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
		// "none" particles are integrated by the tick instead, ahead of any distance math.
		if (entity.particle !== null && entity.particle.physicsMode === "none") return;
		if (entity.type === "player") return;
		if (IsBeyondSimDistance(sceneGraph.cameraConfig.state.position, entity.transform.position)) return;
		updateEntityMovement(entity, deltaSeconds);
		ApplyPhysicsPipeline(entity, sceneGraph, deltaSeconds);
	});

	// === PARTICLES ===
	// After the entity pass so "full" groups are already displaced, before runFrameTail publishes.
	updateParticles(sceneGraph, deltaMilliseconds, deltaSeconds);

	// === CAMERA ===
	sceneGraph.cameraConfig.state = UpdateCameraState(
		sceneGraph.cameraConfig.state, sceneGraph, sceneGraph.cameraConfig, deltaSeconds, playerState
	);

	// === ANIMATION (visual-only display transforms; player only this pass) ===
	// Runs after true poses are settled and before render reads displayTransform.
	if (playerState.active) ResolveEntityAnimation(playerState, deltaSeconds);

	runFrameTail(sceneGraph, deltaMilliseconds);
}

const GetActiveLevel = () => levelRuntimeState.sceneGraph;

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
		map[obstacle.id] = {
			position  : obstacle.parts[0].transform.position,
			dimensions: obstacle.parts[0].dimensions,
			scale     : obstacle.parts[0].transform.scale,
			topY      : obstacle.parts[0].transform.position.y,
		};
	});
	return map;
}

// Every entity type other than terrain and obstacle lives in the entities array.
const generatorCollections = {
	terrain : (sceneGraph) => sceneGraph.terrain,
	obstacle: (sceneGraph) => sceneGraph.obstacles,
	entity  : (sceneGraph) => sceneGraph.entities,
};

const generatorCollectionOf = (type) => (type === "terrain" || type === "obstacle" ? type : "entity");

function indexById(collection) {
	const index = new Map();
	collection.forEach((candidate) => index.set(candidate.id, candidate));
	return index;
}

// A null partId anchors to the object's own transform; a named part that is gone resolves to undefined.
function targetTransform(owner, partId, collection) {
	if (collection === "terrain") return owner.transform;
	if (collection === "obstacle") return partId === null ? owner.parts[0].transform : owner.parts.find((part) => part.id === partId)?.transform;
	return partId === null ? owner.transform : owner.model.parts.find((part) => part.id === partId)?.mesh.transform;
}

// One shared build per frame, so it cannot desync; null when no group follows anything.
// Values are live transform references — the map is discarded at the end of the frame.
function resolveGeneratorTargets(sceneGraph) {
	const wanted = new Map();
	sceneGraph.entities.forEach((entity) => {
		const group = entity.particle;
		if (group === null || group.targetKey === null) return;
		wanted.set(group.targetKey, group.target);
	});
	if (wanted.size === 0) return null;

	const indexes = {};
	const targets = {};
	wanted.forEach((target, key) => {
		const collection = generatorCollectionOf(target.type);
		// Memoization gate: each wanted collection is walked once per frame, whatever the group count.
		if (indexes[collection] === undefined) indexes[collection] = indexById(generatorCollections[collection](sceneGraph));

		const owner = indexes[collection].get(target.id);
		// A dead object leaves its key undefined, which is what orphans the group that follows it.
		targets[key] = owner === undefined ? undefined : targetTransform(owner, target.partId, collection);
	});
	return targets;
}

// Flattens the three collections' differing shapes for core/ validators. undefined = no such id.
function findSceneTarget(sceneGraph, id, partId) {
	const entity = sceneGraph.entities.find((candidate) => candidate.id === id);
	if (entity !== undefined) return { type: entity.type, transform: targetTransform(entity, partId, "entity") };

	const obstacle = sceneGraph.obstacles.find((candidate) => candidate.id === id);
	if (obstacle !== undefined) return { type: "obstacle", transform: targetTransform(obstacle, partId, "obstacle") };

	const mesh = sceneGraph.terrain.find((candidate) => candidate.id === id);
	return mesh === undefined ? undefined : { type: "terrain", transform: mesh.transform };
}

function finalizeSpawn(result, objectType, sceneGraph) {
	(Array.isArray(result) ? result : [result]).forEach((mesh) => AddToVisualResources(mesh, objectType, sceneGraph));
	AddTextureAnimationEntries(sceneGraph);
	if (shouldRefreshBoundingBoxes()) RefreshSceneBoundingBoxes(sceneGraph);
	return result;
}

function SpawnIntoScene(definition, objectType, sceneGraph) {
	// Reuse texture registry when applicable
	const faceTextureStore = sceneGraph.visualResources.textureRegistry;

	if (ENTITY_TYPES.includes(objectType)) {
		// Reuse the level-scoped geometry cache
		const { entity: built } = BuildEntity(
			definition,
			buildSceneSurfaceMap(sceneGraph.terrain, sceneGraph.obstacles),
			sceneGraph.world.textureScale,
			faceTextureStore,
			sceneGraph.partGeometryCache
		);
		sceneGraph.entities.push(built);
		return finalizeSpawn(built, objectType, sceneGraph);
	}

	if (objectType === "obstacle") {
		const { built: builtArray } = BuildObstacles([definition], { textureScale: sceneGraph.world.textureScale, faceTextureStore });
		const built = builtArray[0];
		sceneGraph.obstacles.push(built);
		return finalizeSpawn(built, objectType, sceneGraph);
	}

	if (objectType === "terrain") {
		const { terrain } = BuildTerrain([definition], sceneGraph.world, faceTextureStore);
		terrain.forEach((mesh) => sceneGraph.terrain.push(mesh));
		return finalizeSpawn(terrain, objectType, sceneGraph);
	}

	const { mesh: built } = BuildObject({ ...definition, textureScale: sceneGraph.world.textureScale, faceTextureStore });
	sceneGraph.terrain.push(built);
	return finalizeSpawn(built, objectType, sceneGraph);
}

function DespawnFromScene(target, objectType, sceneGraph) {
	let array;
	if (ENTITY_TYPES.includes(objectType)) array = sceneGraph.entities;
	else if (objectType === "obstacle") array = sceneGraph.obstacles;
	else array = sceneGraph.terrain;

	(Array.isArray(target) ? target : [target]).forEach((element) => {
		const index = array.indexOf(element);
		if (index >= 0) array.splice(index, 1);
	});
	if (shouldRefreshBoundingBoxes()) RefreshSceneBoundingBoxes(sceneGraph);
	return target;
}

// Game-facing particle request. Fire-and-forget: nothing is returned, everything is logged.
// Push-only: a game's event handler re-enters this mid-forEach, which skips appends but not splices.
function SpawnParticles(request, generator) {
	const sceneGraph = GetActiveLevel();
	if (sceneGraph === null) {
		Log("ENGINE", "Level.SpawnParticles: no active level.", "error", "Level");
		return;
	}
	if (IsSimulatorActive()) {
		Log("ENGINE", "Level.SpawnParticles: simulator mode never ticks particles.", "error", "Level");
		return;
	}

	const resolveTarget = (id, partId) => findSceneTarget(sceneGraph, id, partId);
	const normalized = ValidateRuntime.Particles(request, generator, resolveTarget);
	if (normalized === null) return;

	// Validation already proved the target resolves; re-checking it here would be a defensive guard.
	if (normalized.mode === "generator") {
		const { transform } = resolveTarget(normalized.target.id, normalized.target.partId);
		normalized.offset   = normalized.position;
		normalized.position = transform.position.clone().add(RotateByEuler(normalized.offset, transform.rotation));
	}

	const { groups } = generateForScene(normalized, sceneGraph.cameraConfig.state.position, sceneGraph);
	if (groups.length === 0) {
		Log("ENGINE", `Level.SpawnParticles: '${normalized.templateId}' produced no groups (gated by performance or sim distance).`, "warn", "Level");
		return;
	}

	// "entity", not "particle": ENTITY_TYPES has none, and the fallback branch assumes terrain.
	sceneGraph.entities.push(...groups);
	finalizeSpawn(groups, "entity", sceneGraph);
	Log("ENGINE", `Particles spawned: id=${normalized.templateId}, mode=${normalized.mode}, groups=${groups.length}`, "log", "Level");
}

// Generators for a runtime-spawned object. Requests arrive built; the caller owns their overrides.
function SpawnParticleRequests(requests, sceneGraph) {
	requests.forEach((request) => {
		// The Simulator previews at any range, so no viewer gate.
		const { groups } = generateForScene(request, null, sceneGraph);
		sceneGraph.entities.push(...groups);
		finalizeSpawn(groups, "entity", sceneGraph);
	});
}


export {
	CreateLevel, ClearLevel, Update, GetActiveLevel,
	StartLevelLoop, StopLevelLoop, PauseLevelLoop, ResumeLevelLoop, ToggleLevelLoopPause,
	SpawnIntoScene, DespawnFromScene, SpawnParticles, SpawnParticleRequests,
};
