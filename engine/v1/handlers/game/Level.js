// Runs a level from build to clear, updating its scene each frame.

// Used by core/ini.js to run the game's levels.
// Used by handlers/Controls.js to read and pause the level.
// Used by handlers/game/Simulator.js to build, spawn into and clear its scene.
// Uses core/validate.js to check the game's level and particle data.
// Uses builder/NewLevel.js to build the level world.
// Uses builder/NewEntity.js, NewObstacle.js, NewTerrain.js and NewObject.js for runtime spawning.
// Uses builder/NewParticles.js for particle requests and reseeding.
// Uses builder/NewTexture.js to prepare textures for the level and what spawns into it.
// Uses builder/subProcesses/Occlusion.js to build blockers for spawned terrain.
// Uses builder/subProcesses/Chunks.js to add and remove the collision chunks.
// Uses builder/templates/Instance.js to drop the level's game templates when it clears.
// Uses camera/Master.js, player/Master.js and physics/Master.js to run their systems each frame.
// Uses handlers/Render.js to draw the level each frame.
// Uses handlers/UI.js to show the frame counter.
// Uses handlers/game/Performance.js to prepare reusable data each frame.
// Uses handlers/game/Enemy.js and Collectible.js to handle what the player touches.
// Uses handlers/game/Animation.js and Texture.js to run animations.

import { BuildLevel, RefreshDebugBoundingBoxes } from "../../builder/NewLevel.js";
import { ClearGameTemplates } from "../../builder/templates/Instance.js";
import { RenderLevel, RemoveRoot, ClearLevelRenderer, SetElementText } from "../Render.js";
import { CreateUI } from "../UI.js";
import { Cache, Log, PushToSession, RequestPointerLock, SendEvent, SESSION_KEYS, ENTITY_TYPES, ReleasePointerLock, IsPointerLocked } from "../../core/meta.js";
import { CONFIG, PERFORMANCE_SCALING } from "../../core/config.js";
import { InitializeCameraState, PrepareCamera, UpdateCamera } from "../../camera/Master.js";
import { Vector3Distance, LerpVector3, CloneVector3 } from "../../math/Vector3.js";
import { BuildEntity, UpdateEntityModel } from "../../builder/NewEntity.js";
import { GenerateParticles, GeneratorPlacement } from "../../builder/NewParticles.js";
import { BuildObstacles } from "../../builder/NewObstacle.js";
import { BuildTerrain } from "../../builder/NewTerrain.js";
import { BuildOccluders } from "../../builder/subProcesses/Occlusion.js";
import { AddChunk, RemoveChunkMember } from "../../builder/subProcesses/Chunks.js";
import { BuildObject } from "../../builder/NewObject.js";
import { UpdateInputEventTypes } from "../Controls.js";
import { ValidateLevelPayload, ValidateRuntime } from "../../core/validate.js";
import { InitializePlayer, UpdatePlayer, ResolvePlayerState, GetPlayerState } from "../../player/Master.js";
import { ApplyPhysicsPipeline } from "../../physics/Master.js";
import { HandleEnemyCollisions } from "./Enemy.js";
import { HandleCollectiblePickups } from "./Collectible.js";
import { EnsureAnimationRuntime, ResolveEntityAnimation } from "./Animation.js";
import { UpdatePerformanceFlags, UpdateCollisionCandidates, MeasureRefreshRate } from "./Performance.js";
import { InitializeTextureAnimation, UpdateTextureAnimation, SyncTextureAnimation } from "./Texture.js";
import { PrepareLevelVisualResources, AddToVisualResources } from "../../builder/NewTexture.js";
import { Clamp01 } from "../../math/Utilities.js";
import { IsSimulatorActive, UpdateSimulator } from "./Simulator.js";

const levelRuntimeState = {
	sceneGraph   : null,
	renderOptions: { rootId: "engine-level-root" },
};

const levelLoop = {
	active          : false,
	paused          : false,
	animationFrameId: null,
	lastFrameTime   : 0,
	accumulator     : 0,
	fixedTimeStep   : 1000 / 60,
	uncapped        : false,
	cappedStreak    : 0,
	recentFrames    : [],
	counterShown    : false,
	counterRenders  : 0,
	counterStart    : 0,
};

// Consecutive capped frames before the warning escalates to an error.
const sustainedCapFrames = 10;

const frameCounterRootId = "engine-frame-counter";


function cacheLevelPayload(payload) {
	Cache.Level.lastPayload = payload;
	PushToSession(SESSION_KEYS.Cache, Cache);
	return payload;
}

function buildIncomingPayloadSummary(payload) {
	const count = (key) => payload.entityBlueprints[key].length;
	return [
		"Engine received level payload:",
		`- LevelId: ${payload.meta.levelId}`,
		`- StageId: ${payload.meta.stageId}`,
		`- World: ${payload.world.dimensions.x}x${payload.world.dimensions.z}x${payload.world.dimensions.y}`,
		`- TerrainObjects: ${payload.terrain.objects.length}`,
		`- TerrainTriggers: ${payload.terrain.triggers.length}`,
		`- Obstacles: ${payload.obstacles.length}`,
		`- Entities(overrides): ${payload.entities.length}`,
		`
			- BlueprintCounts: 
				- Enemies: ${count("enemies")}
				- Npcs: ${count("npcs")}
				- Collectibles: ${count("collectibles")}
				- Projectiles: ${count("projectiles")}
			`,
	].join("\n");
}

function shouldRefreshBoundingBoxes() {
	return CONFIG.Debug.All !== true 
		? false 
		: CONFIG.Debug.Levels.BoundingBox.Grid.Visible === true || Object.values(CONFIG.Debug.Levels.DetailedBounds).some(Boolean)
			? true
			: Object.entries(CONFIG.Debug.Levels.BoundingBox).some(([type, enabled]) => type !== "Grid" && enabled === true);
}

function updateEntityMovement(entity, deltaSeconds) {
	if (entity.movement.speed.value <= 0) return;

	const distance = Vector3Distance(entity.movement.start, entity.movement.end);
	if (distance <= 0.0001) return;

	let moveProg = entity.pathfinding.movementProgress;
	moveProg += ((entity.movement.speed.value * deltaSeconds) / distance) * entity.pathfinding.direction;
	if (moveProg >= 1 || moveProg <= 0) {
		if (entity.movement.backAndForth) {
			entity.pathfinding.direction = moveProg >= 1 ? -1 : 1;
			moveProg = Clamp01(moveProg);
		}
		else if (entity.movement.repeat) moveProg = 0;
		else moveProg = Clamp01(moveProg);
	}

	entity.pathfinding.movementProgress = moveProg;
	entity.transform.position.set(LerpVector3(entity.movement.start, entity.movement.end, Clamp01(moveProg)));
}

// Re-poses only entities whose transform moved this frame; the rest short-circuit inside the builder.
function syncEntityMeshes(sceneGraph) {
	sceneGraph.entities.forEach(entity => {
		if (entity.type === "player") return;
		UpdateEntityModel(entity);
	});
}

function showFrameCounter() {
	CreateUI({
		screenId: "FrameCounter",
		rootId: frameCounterRootId,
		stylesheet: null,
		rootStyles: {
			position: "fixed", top: "12px", right: "12px", zIndex: "10", pointerEvents: "none",
			background: "rgba(0,0,0,0.55)", color: "#e8eaf0", padding: "4px 10px", borderRadius: "6px",
			fontFamily: "monospace", fontSize: "13px",
		},
		elements: [{ type: "div", id: "frame-counter-text", text: "FPS: —", attributes: {}, styles: {}, events: {}, on: {}, children: [] }],
	});
}

// Shows rendered frames per second, refreshed twice a second; follows the FrameCounter switch live.
function updateFrameCounter(now) {
	const elapsed = now - levelLoop.counterStart;
	if (elapsed < 500) return;

	if (CONFIG.Performance.FrameCounter !== levelLoop.counterShown) {
		if (CONFIG.Performance.FrameCounter) showFrameCounter();
		else RemoveRoot(frameCounterRootId);
		levelLoop.counterShown = CONFIG.Performance.FrameCounter;
	}
	if (levelLoop.counterShown) SetElementText("frame-counter-text", `FPS: ${Math.round(levelLoop.counterRenders * 1000 / elapsed)}`);

	levelLoop.counterRenders = 0;
	levelLoop.counterStart = now;
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
	levelLoop.cappedStreak = 0;
	levelLoop.recentFrames = [];
	levelLoop.uncapped = CONFIG.Performance.FrameRate === Infinity;
	levelLoop.fixedTimeStep = 1000 / (levelLoop.uncapped ? PERFORMANCE_SCALING.Loop.UncappedSimRate : CONFIG.Performance.FrameRate);
	levelLoop.counterRenders = 0;
	levelLoop.counterStart = levelLoop.lastFrameTime;
	document.addEventListener("pointerlockchange", onPointerLockChange);

	const frame = () => {
		if (!levelLoop.active) return;

		const now = performance.now();
		const frameTime = now - levelLoop.lastFrameTime;
		levelLoop.lastFrameTime = now;

		if (!levelLoop.paused) {
			// Prevent stutter by advancing further if it's just short of the next browser step.
			const recent = levelLoop.recentFrames;
			recent.push(frameTime);
			if (recent.length > 4) recent.shift();

			const average = recent.reduce((sum, time) => sum + time, 0) / recent.length;
			const ratio   = average / levelLoop.fixedTimeStep;
			const snapped = ratio >= 1
				? Math.round(ratio) * levelLoop.fixedTimeStep
				: levelLoop.fixedTimeStep / Math.round(1 / ratio);
			levelLoop.accumulator += !levelLoop.uncapped && Math.abs(average - snapped) < 1 ? snapped : frameTime;

			const maxSubsteps = PERFORMANCE_SCALING.Loop.MaxSubsteps;
			let steps = 0;
			while (levelLoop.accumulator >= levelLoop.fixedTimeStep && steps < maxSubsteps) {
				Update(levelLoop.fixedTimeStep);
				levelLoop.accumulator -= levelLoop.fixedTimeStep;
				steps++;
			}

			if (levelLoop.accumulator >= levelLoop.fixedTimeStep) {
				// Drops leftover time debt instead of carrying it to the next frame.
				levelLoop.accumulator = levelLoop.fixedTimeStep;
				levelLoop.cappedStreak++;
				if (levelLoop.cappedStreak === 1) {
					Log("ENGINE", `Frame hit the ${maxSubsteps}-substep cap. Simulation debt dropped.`, "warn", "Level");
				}
				else if (levelLoop.cappedStreak === sustainedCapFrames) {
					Log(
						"ENGINE", 
						`Substep cap sustained ${sustainedCapFrames} frames. Simulation is running behind real time.`, 
						"error", 
						"Level"
					);
				}
			}
			else levelLoop.cappedStreak = 0;

			// Only render per-tick, unless uncapped
			if (steps > 0 || levelLoop.uncapped) {
				RenderLevel(levelRuntimeState.sceneGraph, levelRuntimeState.renderOptions);
				levelLoop.counterRenders++;
			}
		}

		updateFrameCounter(now);
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
	if (levelLoop.counterShown) RemoveRoot(frameCounterRootId);

	levelLoop.counterShown = false;

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
	ClearGameTemplates();
	if (clearCache) {
		Cache.Level.lastPayload = null;
		PushToSession(SESSION_KEYS.Cache, Cache);
	}
	Log("ENGINE", "Level cleared.", "log", "Level");
}

function PauseLevelLoop() {
	if (levelLoop.paused || IsSimulatorActive()) return;

	ReleasePointerLock()
	levelLoop.paused = true;
	SendEvent("LEVEL_PAUSED", {});
}

function ResumeLevelLoop(triggeredByEscape = false) {
	if (!levelLoop.paused || IsSimulatorActive()) return;
	if (!triggeredByEscape) RequestPointerLock();

	levelLoop.paused = false;
	UpdateInputEventTypes({ payloadType: "level" });
	SendEvent("LEVEL_RESUMED", {});

	// Escape-denied (or otherwise missed) lock requests are picked up on the next user input instead.
	function fallbackPointerLock() {
		if (!IsPointerLocked()) RequestPointerLock();
		document.removeEventListener("pointerdown", fallbackPointerLock);
		document.removeEventListener("keydown", fallbackPointerLock);
	}
	document.addEventListener("pointerdown", fallbackPointerLock);
	document.addEventListener("keydown", fallbackPointerLock);
}

const ToggleLevelLoopPause = (triggeredByEscape = false) => levelLoop.paused ? ResumeLevelLoop(triggeredByEscape) : PauseLevelLoop();

async function CreateLevel(payload, options, simulatorOverride = false) {
	// Clear if a level was still running.
	if (levelRuntimeState.sceneGraph !== null) {
		ClearLevel(false);
		Log("ENGINE", "Previous level cleared before new level creation.", "log", "Level");
		Log("ENGINE", "Please end levels naturally before starting new ones.", "warn", "Level");
	}

	const rawPayload = structuredClone(payload);
	payload = await ValidateLevelPayload(payload);
	if (!payload) {
		Log("ENGINE", "Level.CreateLevel aborted: invalid payload.", "error", "Level");
		return null;
	}

	// Update Input Events Engine Listens for
	UpdateInputEventTypes({ payloadType: "level", payload });

	// Cache the raw payload so Exit() can restore it without re-validating Unit objects.
	if (!simulatorOverride) cacheLevelPayload(rawPayload);

	// Delete Menu UI Cache (if not simulator)
	if (!simulatorOverride) {
		Cache.UI.lastPayload = null;
		Cache.UI.screenID    = null;
		PushToSession(SESSION_KEYS.Cache, Cache);
	}

	Log("ENGINE", buildIncomingPayloadSummary(payload), "log", "Level");

	levelRuntimeState.renderOptions = {
		...levelRuntimeState.renderOptions,
		...(options.renderOptions ?? {}),
	};

	// Measured before the build, while nothing else is drawing.
	await MeasureRefreshRate();
	const sceneGraph = await BuildLevel(payload);
	Log("ENGINE", `Level sceneGraph created: ${payload.id}`, "log", "Level");

	// Initialize player if payload defines one.
	if (sceneGraph.playerConfig) {
		InitializePlayer(sceneGraph.playerConfig, sceneGraph);
		EnsureAnimationRuntime(GetPlayerState());
		Log("ENGINE", `Player initialized: character=${sceneGraph.playerConfig.character}`, "log", "Level");
	}

	await PrepareLevelVisualResources(sceneGraph);

	sceneGraph.cameraConfig.state = InitializeCameraState(
		sceneGraph, payload.meta, sceneGraph.playerConfig ? GetPlayerState() : null, IsSimulatorActive()
	);

	InitializeTextureAnimation(sceneGraph);

	levelRuntimeState.sceneGraph = sceneGraph;
	if (shouldRefreshBoundingBoxes()) RefreshDebugBoundingBoxes(sceneGraph);

	if (CONFIG.Debug.All && CONFIG.Debug.Levels.BoundingBox.Grid.Visible) {
		Log(
			"ENGINE",
			`Debug Grid Enabled — scale: ${CONFIG.Debug.Levels.BoundingBox.Grid.Size} units`,
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

	if (CONFIG.CustomEvents.Entities.Spawn) {
		const localSendEvent = (definition, title) => {
			if (definition.customEvents.spawn) SendEvent(title, {
				id      : definition.id,
				type    : definition.type,
				position: CloneVector3(definition.transform.position),
				velocity: CloneVector3(definition.velocity)
			});
		};
		localSendEvent(GetPlayerState(), "PLAYER_SPAWN");
		sceneGraph.entities.forEach(entity => localSendEvent(entity, "ENTITY_SPAWN"));
	}

	return sceneGraph;
}

// Generate a request's particles with the scene's texture scale and registry.
function generateForScene(request, sceneGraph) {
	return GenerateParticles(request, sceneGraph.world.textureScale, sceneGraph.visualResources.textureRegistry);
}

// Tell the game a particle request's last group ended.
function sendParticlesEnded(request) {
	if (!request.customEvents.ended || !CONFIG.CustomEvents.Particles.Ended) return;
	SendEvent("PARTICLES_ENDED", {
		templateId: request.templateId,
		mode      : request.emitter.mode,
		target    : request.target === null ? null : { ...request.target },
		position  : CloneVector3(request.position),
	});
}

// Drives every group's lifetime and emits the siblings a seeding group asks for.
function updateParticles(sceneGraph, deltaMs, deltaSeconds) {
	const seedRequests = [];
	const targets = resolveGeneratorTargets(sceneGraph);

	// Note: Loops backwards so finished groups can be removed mid-loop.
	for (let i = sceneGraph.entities.length - 1; i >= 0; i--) {
		const group = sceneGraph.entities[i].particle;
		if (group === null) continue;

		// Frozen beyond draw distance.
		if (!sceneGraph.entities[i].performance.physics) continue;

		// Mode test: a burst has no target to ride.
		if (group.targetKey !== null) group.follow(targets);
		group.advance(deltaMs, deltaSeconds);

		// Remove finished groups. The request ends with its last one.
		if (group.lifecycle.finished) {
			sceneGraph.entities.splice(i, 1);
			group.request.emitter.groups -= 1;
			if (group.request.emitter.groups === 0) sendParticlesEnded(group.request);
			continue;
		}
		if (group.seedDue(deltaMs)) seedRequests.push(group.request);
	}

	// Push siblings straight in; they reuse the level-built group's geometry key and texture id.
	seedRequests.forEach((request) => {
		const groups = generateForScene(request, sceneGraph).groups;
		sceneGraph.entities.push(...groups);
	});
}

function runFrameTail(sceneGraph, deltaMs) {
	UpdateTextureAnimation(sceneGraph, deltaMs);
	syncEntityMeshes(sceneGraph);
	if (shouldRefreshBoundingBoxes()) RefreshDebugBoundingBoxes(sceneGraph);
}

function Update(deltaMs) {
	const deltaSeconds = Math.max(0, deltaMs) / 1000;
	const sceneGraph = levelRuntimeState.sceneGraph;

	UpdatePerformanceFlags(sceneGraph);

	if (IsSimulatorActive()) {
		UpdateSimulator(deltaSeconds, sceneGraph);
		updateParticles(sceneGraph, deltaMs, deltaSeconds);
		runFrameTail(sceneGraph, deltaMs);
		return;
	}

	// Each entity's collidables, gathered once for the whole step.
	sceneGraph.entities.forEach((entity) => UpdateCollisionCandidates(entity, sceneGraph));

	// === PLAYER PIPELINE ===
	const playerState = GetPlayerState();
	PrepareCamera(sceneGraph, deltaSeconds, playerState, false);        // 0. Camera situation, mode & look input
	UpdatePlayer(deltaSeconds, sceneGraph.cameraConfig.state.modeData);    // 1. Input → Movement & Abilities
	ApplyPhysicsPipeline(playerState, sceneGraph, deltaSeconds);           // 2. Forces, Collision, Correction.
	HandleEnemyCollisions(playerState, sceneGraph, deltaSeconds);          // 3. Combat Collisions (damage / attack)
	HandleCollectiblePickups(playerState, sceneGraph);                     // 4. Collectible Pickups
	ResolvePlayerState();                                                  // 5. Resolve State (Idle, Running, Jumping, etc.)

	// === NON-PLAYER ENTITY UPDATE ===
		// Skip physics-free particles (their group moves them), the player, and entities with physics off.
	sceneGraph.entities.forEach(entity => {
		if (entity.particle !== null && entity.particle.physicsMode === "none") return;
		if (entity.type === "player") return;
		if (!entity.performance.physics) return;
		updateEntityMovement(entity, deltaSeconds);
		ApplyPhysicsPipeline(entity, sceneGraph, deltaSeconds);
	});

	// === PARTICLES ===
	// After the entity pass so "full" groups are already displaced, before runFrameTail publishes.
	updateParticles(sceneGraph, deltaMs, deltaSeconds);

	// === CAMERA ===
	UpdateCamera(sceneGraph, deltaSeconds, playerState, false);

	// === ANIMATION (visual-only display transforms; player only this pass) ===
	// Pose models and animate after true poses settle, before render reads display.transform.
	ResolveEntityAnimation(playerState, deltaSeconds);

	runFrameTail(sceneGraph, deltaMs);
}


const GetActiveLevel = () => levelRuntimeState.sceneGraph;

/* === SCENE MUTATION === */

// Find the height of a mesh's top face, ignoring rotation.
const meshTop = (mesh) => mesh.transform.position.y + (mesh.dimensions.y * mesh.transform.scale.y * 0.5);

// Map spawn surfaces by id. topY is where models stand: the object's top.
function buildSurfaceMap(terrain, groups) {
	const map = {};
	terrain.forEach((mesh) => {
		map[mesh.id] = { position: mesh.transform.position, dimensions: mesh.dimensions, scale: mesh.transform.scale, topY: meshTop(mesh) };
	});
	for (const id in groups) {
		const parts = groups[id].parts;

		// Skip void-obstacles
		if (parts.length === 0) continue;

		// Note: Position, dimensions and scale come from the first part. An obstacle's top is its highest part's.
		const [part] = parts;
		map[id] = { position: part.transform.position, dimensions: part.dimensions, scale: part.transform.scale, topY: Math.max(...parts.map(meshTop)) };
	}
	return map;
}

// Every entity type other than terrain and obstacle lives in the entities array.
const generatorCollections = {
	terrain : (sceneGraph) => sceneGraph.terrain.entries,
	entity  : (sceneGraph) => sceneGraph.entities,
};

const generatorCollectionOf = (type) => (type === "terrain" || type === "obstacle" ? type : "entity");

// Find an obstacle's group by id
const findGroup = (sceneGraph, id) => Object.hasOwn(sceneGraph.obstacles.groups, id) ? sceneGraph.obstacles.groups[id] : undefined;

function indexById(collection) {
	const index = new Map();
	collection.forEach((candidate) => index.set(candidate.id, candidate));
	return index;
}

// Find a target's mesh by part id. A null partId picks the object's mesh (an entity's first part).
function targetMesh(owner, partId, collection) {
	switch (collection) {
		case "terrain" : return owner;
		case "obstacle": return partId === null ? owner.parts[0]            : owner.parts.find((part)       => part.id === partId);
		default        : return partId === null ? owner.model.parts[0].mesh : owner.model.parts.find((part) => part.id === partId)?.mesh;
	}
}

// Find a target's transform by part id. With a null partId, an entity follows its root, not its first part.
function targetTransform(owner, partId, collection) {
	if (collection === "entity" && partId === null) return owner.transform;
	return targetMesh(owner, partId, collection)?.transform;
}

// Build the followed transforms once per frame to give every group the same ones.
function resolveGeneratorTargets(sceneGraph) {
	const wanted = new Map();
	sceneGraph.entities.forEach((entity) => {
		const group = entity.particle;
		if (group === null || group.targetKey === null) return;
		wanted.set(group.targetKey, group.target);
	});

	// Skip the frame's targets when no group follows anything.
	if (wanted.size === 0) return null;

	const indexes = {};
	const targets = {};
	wanted.forEach((target, key) => {
		const collection = generatorCollectionOf(target.type);

		// Index terrain and entities once per frame.
		if (collection !== "obstacle" && indexes[collection] === undefined) indexes[collection] = indexById(generatorCollections[collection](sceneGraph));

		// A dead object has no entry, which orphans the group following it.
		const owner = collection === "obstacle" ? findGroup(sceneGraph, target.id) : indexes[collection].get(target.id);
		targets[key] = owner === undefined ? undefined : targetTransform(owner, target.partId, collection);
	});
	return targets;
}

// Flattens the three collections' differing shapes for core/ validators. undefined = no such id.
function findSceneTarget(sceneGraph, id, partId) {
	for (const collection of ["entity", "obstacle", "terrain"]) {
		const owner = collection === "obstacle"
			? findGroup(sceneGraph, id)
			: generatorCollections[collection](sceneGraph).find((candidate) => candidate.id === id);
		if (owner === undefined) continue;
		return {
			type     : collection === "entity" ? owner.type : collection,
			transform: targetTransform(owner, partId, collection),
			mesh     : targetMesh(owner, partId, collection),
		};
	}
}

// Wake every entity to recheck what it rests on.
const wakeEntities = (sceneGraph) => sceneGraph.entities.forEach((entity) => entity.physics.lastFrame.resting = false);

function finalizeSpawn(result, objectType, sceneGraph) {
	(Array.isArray(result) ? result : [result]).forEach((mesh) => AddToVisualResources(mesh, objectType, sceneGraph));
	if (!ENTITY_TYPES.includes(objectType)) wakeEntities(sceneGraph);
	SyncTextureAnimation(sceneGraph);
	if (shouldRefreshBoundingBoxes()) RefreshDebugBoundingBoxes(sceneGraph);
	return result;
}

// Also takes entities built outside SpawnIntoScene, like the player model.
function AddEntityToScene(entity, sceneGraph) {
	sceneGraph.entities.push(entity);
	return finalizeSpawn(entity, "entity", sceneGraph);
}

function SpawnIntoScene(definition, objectType, sceneGraph) {
	// Reuse texture registry when applicable
	const faceTextureStore = sceneGraph.visualResources.textureRegistry;

	if (ENTITY_TYPES.includes(objectType)) {
		const built = BuildEntity(
			definition,
			buildSurfaceMap(sceneGraph.terrain.entries, sceneGraph.obstacles.groups),
			sceneGraph.world.textureScale,
			faceTextureStore
		).entity;
		return AddEntityToScene(built, sceneGraph);
	}

	// Add the obstacle's group and its non-void parts.
	// Note: An obstacle made only of voids adds an empty group.
	if (objectType === "obstacle") {
		const { entries, groups } = BuildObstacles([definition], { textureScale: sceneGraph.world.textureScale, faceTextureStore });
		Object.assign(sceneGraph.obstacles.groups, groups);
		entries.forEach((mesh) => {
			sceneGraph.obstacles.entries.push(mesh);
			AddChunk(sceneGraph, mesh, "obstacle");
		});
		return finalizeSpawn(Object.values(groups)[0], objectType, sceneGraph);
	}

	if (objectType === "terrain") {
		const terrain = BuildTerrain([definition], sceneGraph.world, faceTextureStore).terrain;
		BuildOccluders(terrain, []);
		terrain.forEach((mesh) => {
			sceneGraph.terrain.entries.push(mesh);
			AddChunk(sceneGraph, mesh, "terrain");
		});
		return finalizeSpawn(terrain, objectType, sceneGraph);
	}

	const built = BuildObject({ ...definition, textureScale: sceneGraph.world.textureScale, faceTextureStore }).mesh;
	sceneGraph.terrain.entries.push(built);
	AddChunk(sceneGraph, built, "terrain");
	return finalizeSpawn(built, objectType, sceneGraph);
}

function DespawnFromScene(target, objectType, sceneGraph) {
	const isEntity   = ENTITY_TYPES.includes(objectType);
	const isObstacle = objectType === "obstacle";
	const array      = isEntity ? sceneGraph.entities : isObstacle ? sceneGraph.obstacles.entries : sceneGraph.terrain.entries;
	const targets    = Array.isArray(target) ? target : [target];

	// Despawn an obstacle by its group, taking all of the group's parts with it.
	if (isObstacle) targets.forEach((group) => delete sceneGraph.obstacles.groups[group.id]);

	(isObstacle ? targets.flatMap((group) => group.parts) : targets).forEach((element) => {
		const index = array.indexOf(element);
		if (index < 0) return;
		array.splice(index, 1);

		// Take terrain and obstacles out of their collision chunk.
		if (!isEntity) RemoveChunkMember(sceneGraph, element);
	});
	wakeEntities(sceneGraph);
	SyncTextureAnimation(sceneGraph);
	if (shouldRefreshBoundingBoxes()) RefreshDebugBoundingBoxes(sceneGraph);
	return target;
}

// Game-facing particle request. Fire-and-forget: nothing is returned, everything is logged.
// Note: Only appends to entities. A game's event handler can call this mid-loop.
function SpawnParticles(request, generator) {
	const sceneGraph = GetActiveLevel();
	if (sceneGraph === null) return Log("ENGINE", "Level.SpawnParticles: no active level.", "error", "Level");
	if (IsSimulatorActive()) return Log("ENGINE", "Level.SpawnParticles: simulator mode never ticks particles.", "error", "Level");

	const resolveTarget = (id, partId) => findSceneTarget(sceneGraph, id, partId);
	const normalized = ValidateRuntime.Particles(request, generator, resolveTarget);
	if (normalized === null) return;

	if (normalized.mode === "generator") {
		const { transform, mesh } = resolveTarget(normalized.target.id, normalized.target.partId);
		Object.assign(normalized, GeneratorPlacement(normalized, mesh, transform));
	}

	// A far burst would sit frozen and play late once the player arrives.
	const { Tiers, Fractions } = PERFORMANCE_SCALING.SimDistance;
	const drawReach = Tiers[CONFIG.Performance.SimDistance].value * Fractions.WorldInstances.Cull;
	if (normalized.mode === "burst" && Vector3Distance(sceneGraph.cameraConfig.state.position, normalized.position) > drawReach) {
		Log("ENGINE", `Level.SpawnParticles: '${normalized.templateId}' burst dropped beyond draw distance.`, "warn", "Level");
		return;
	}

	// Empty only when particles are disabled, which GenerateParticles already logs.
	const groups = generateForScene(normalized, sceneGraph).groups;
	if (groups.length === 0) return;

	// Added as plain entities; "particle" isn't one of the standard entity types.
	sceneGraph.entities.push(...groups);

	// Gather collision candidates now so groups spawned mid-step collide this step.
	groups.forEach((group) => UpdateCollisionCandidates(group, sceneGraph));
	finalizeSpawn(groups, "entity", sceneGraph);
	Log("ENGINE", `Particles spawned: id=${normalized.templateId}, mode=${normalized.mode}, groups=${groups.length}`, "log", "Level");
}

// Generators for a runtime-spawned object. Requests arrive built; the caller owns their overrides.
function SpawnParticleRequests(requests, sceneGraph) {
	requests.forEach((request) => {
		const groups = generateForScene(request, sceneGraph).groups;
		sceneGraph.entities.push(...groups);
		finalizeSpawn(groups, "entity", sceneGraph);
	});
}


export {
	CreateLevel, ClearLevel, Update, GetActiveLevel,
	StartLevelLoop, StopLevelLoop, PauseLevelLoop, ResumeLevelLoop, ToggleLevelLoopPause,
	SpawnIntoScene, AddEntityToScene, DespawnFromScene, SpawnParticles, SpawnParticleRequests,
};
