// General Level Initialiser and state handler

// Receives level data from game, validated by core/validate.js
// Creates level world or boss arena using builder/NewLevel.js
// Builds enemies and collectibles using builder/NewEntity.js
// End of player pipeline(s) to determine position.
// Uses Render.js for rendering level state per frame.

import { BuildLevel, RefreshSceneBoundingBoxes } from "../../builder/NewLevel.js";
import { RenderLevel, SetElementText, RemoveRoot, ClearLevelRenderer } from "../Render.js";
import { Cache, Log, PushToSession, RequestPointerLock, SendEvent, SESSION_KEYS } from "../../core/meta.js";
import { CONFIG } from "../../core/config.js";
import { InitializeCameraState, UpdateCameraState, GetCameraVectors } from "./Camera.js";
import { Vector3Distance, LerpVector3, CloneVector3 } from "../../math/Vector3.js";
import { UpdateEntityModelFromTransform } from "../../builder/NewEntity.js";
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
import { InitializeTextureAnimation, UpdateTextureAnimation } from "./Texture.js";
import { PrepareLevelVisualResources } from "../../builder/NewTexture.js";
import { Clamp01, UnitVector3 } from "../../math/Utilities.js";
import { CreateUI, ClearUI, ApplyMenuUI } from "../UI.js";
import simulatorTemplates from "../../builder/templates/levels.json" with { type: "json" };

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

const simulatorRuntime = {
	active          : false,
	hadLevel        : false,
	entity          : null,
	followTarget    : null,
	animSetKeys     : [],
	currentSetIdx   : 0,
	holdTimer       : 0,
	isHolding       : false,
	hudRootId       : "engine-simulator-hud",
	savedEntityState: undefined,
	uiCleared       : false,
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

	payload = await ValidateLevelPayload(payload);
	if (!payload) {
		Log("ENGINE", "Level.CreateLevel aborted: invalid payload.", "error", "Level");
		return null;
	}

	// Update Input Events Engine Listens for
	UpdateInputEventTypes({ payloadType: "level", payload });

	// Cache Level Payload (if not simulator)
	const cachedPayload = simulatorOverride ? payload : cacheLevelPayload(payload);

	// Delete Menu UI Cache (if not simulator)
	if (!simulatorOverride) {
		Cache.UI.lastPayload = null;
		Cache.UI.screenID = null;
		PushToSession(SESSION_KEYS.Cache, Cache);
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
	Log("ENGINE", `Level sceneGraph created: ${cachedPayload.id}`, "log", "Level");

	// Initialize player if payload defines one.
	if (sceneGraph.playerConfig) {
		await InitializePlayer(sceneGraph.playerConfig, sceneGraph);
		Log("ENGINE", `Player initialized: character=${sceneGraph.playerConfig.character}`, "log", "Level");
	}

	await PrepareLevelVisualResources(sceneGraph);

	sceneGraph.cameraConfig.state = InitializeCameraState(
		sceneGraph,
		sceneGraph.cameraConfig,
		cachedPayload.meta,
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
		levelId: cachedPayload.id,
		title: cachedPayload.title,
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

	if (simulatorRuntime.active) {
		if (simulatorRuntime.isHolding) {
			simulatorRuntime.holdTimer -= deltaSeconds;
			if (simulatorRuntime.holdTimer <= 0) {
				simulatorRuntime.isHolding    = false;
				simulatorRuntime.holdTimer    = 0;
				simulatorRuntime.entity.state = simulatorRuntime.animSetKeys[simulatorRuntime.currentSetIdx];
			}
		}
		sceneGraph.cameraConfig.state = UpdateCameraState(
			sceneGraph.cameraConfig.state,
			sceneGraph,
			sceneGraph.cameraConfig,
			deltaSeconds,
			simulatorRuntime.followTarget
		);
		if (simulatorRuntime.entity !== null) {
			if (!simulatorRuntime.isHolding) ResolveEntityAnimation(simulatorRuntime.entity, deltaSeconds);
			updateSimulatorHud();
		}
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

/* === SIMULATOR === */

function buildSimulatorPayload(type, definition) {
	const isEntityType = ["entity","enemy","npc","collectible","projectile"].includes(type);

	const terrainObjects = [...simulatorTemplates.simulatorLevel.terrain.objects];
	if (type === "terrain") terrainObjects.push(definition);

	const bucketKey = type === "enemy" 
		? "enemies" : type === "npc" 
			? "npcs" : type === "collectible" 
				? "collectibles" : type === "projectile"  
					? "projectiles" : "entities";
	const entityBlueprints = { enemies: [], npcs: [], collectibles: [], projectiles: [], entities: [] };
	if (isEntityType) entityBlueprints[bucketKey] = [definition];

	return {
		...simulatorTemplates.simulatorLevel,
		terrain: { ...simulatorTemplates.simulatorLevel.terrain, objects: terrainObjects },
		obstacles: type === "obstacle" ? [definition] : [], 
		entities: isEntityType ? [{ id: definition.id, type: definition.type, blueprintId: definition.id, spawnSurfaceId: "sim-disc" }] : [],
		entityBlueprints, animations: {},
		meta: { levelId: "simulator", stageId: "simulator-level" },
	};
}

function buildSimulatorHud(definition, type, entity) {
	const panelStyles = {
		position: "absolute", top: "12px", left: "12px", background: "rgba(0,0,0,0.55)", color: "#e8eaf0",
		padding: "10px 14px", borderRadius: "6px", fontSize: "13px", lineHeight: "1.7", fontFamily: "monospace",
		pointerEvents: "none",
	};

	const controlBarStyles = {
		position: "absolute", bottom: "12px", left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.55)", 
		color: "#e8eaf0", padding: "8px 18px", borderRadius: "6px", fontSize: "12px", whiteSpace: "nowrap", pointerEvents: "none",
	};

	const row = (id, text) => ({ type: "div", id, text, attributes: {}, styles: {}, events: {}, on: {}, children: [] });

	CreateUI({
		screenId: "SimulatorHUD",
		rootId: simulatorRuntime.hudRootId,
		rootStyles: {
			position: "fixed", top: "0", left: "0",
			width: "100%", height: "100%",
			zIndex: "10", pointerEvents: "none", fontFamily: "monospace",
		},
		elements: [
			{
				type: "div", id: "sim-hud-panel",
				attributes: {}, styles: panelStyles, events: {}, on: {},
				children: [
					row("sim-hud-id",          `ID: ${definition.id}`),
					row("sim-hud-type",        `Type: ${type}`),
					row("sim-hud-entity-type", `Entity Type: ${entity !== null ? entity.type : "—"}`),
					row("sim-hud-parts",       `Parts: ${entity !== null ? entity.model.parts.map(p => p.id).join(", ") : "—"}`),
					row("sim-hud-anim-set",    "Anim Set: —"),
					row("sim-hud-anim-frame",  "Frame: —"),
				],
			},
			{
				type: "div", id: "sim-hud-controls",
				attributes: {}, styles: controlBarStyles, events: {}, on: {},
				text: "[W] Next Anim   [S] Prev Anim   [Mouse] Orbit   [Esc] Exit",
				children: [],
			},
		],
	});
}

function updateSimulatorHud() {
	const animRuntime = simulatorRuntime.entity.animationRuntime;
	const setName     = simulatorRuntime.isHolding ? null : animRuntime.currentSetName;
	SetElementText("sim-hud-anim-set",   `Anim Set: ${setName ?? "none"}`);
	SetElementText("sim-hud-anim-frame", `Frame: ${setName !== null ? Math.floor(animRuntime.elapsed * 60) : "0"}`);
}

function clearSimulatorRuntime() {
	if (simulatorRuntime.entity !== null) simulatorRuntime.entity.state = simulatorRuntime.savedEntityState;
	if (simulatorRuntime.active) RemoveRoot(simulatorRuntime.hudRootId);

	simulatorRuntime.active           = false;
	simulatorRuntime.hadLevel         = false;
	simulatorRuntime.entity           = null;
	simulatorRuntime.followTarget     = null;
	simulatorRuntime.animSetKeys      = [];
	simulatorRuntime.currentSetIdx    = 0;
	simulatorRuntime.holdTimer        = 0;
	simulatorRuntime.isHolding        = false;
	simulatorRuntime.savedEntityState = undefined;
	// uiCleared is NOT reset here — it must survive SimulatorClear; only SimulatorExit resets it.
}

function initSimulatorState(entity, type, definition, sceneGraph) {
	if (entity !== null) {
		simulatorRuntime.savedEntityState = entity.state;
		simulatorRuntime.animSetKeys      = Object.keys(entity.animations);
		entity.state                      = simulatorRuntime.animSetKeys.length > 0 ? simulatorRuntime.animSetKeys[0] : "idle";
		simulatorRuntime.followTarget     = entity;
	} 
	else {
		const aabb = (sceneGraph.terrain[0] ?? sceneGraph.obstacles[0]).worldAabb;
		simulatorRuntime.followTarget = {
			transform: { position: new UnitVector3(
				(aabb.min.x + aabb.max.x) * 0.5,
				aabb.max.y,
				(aabb.min.z + aabb.max.z) * 0.5,
				"cnu"
			) },
		};
		simulatorRuntime.animSetKeys = [];
	}

	simulatorRuntime.entity        = entity;
	simulatorRuntime.active        = true;
	simulatorRuntime.currentSetIdx = 0;
	simulatorRuntime.isHolding     = false;
	simulatorRuntime.holdTimer     = 0;

	buildSimulatorHud(definition, type, entity);
}

async function SimulatorLoad(definition, type) {
	const hadLevel = levelRuntimeState.sceneGraph !== null;
	if (levelRuntimeState.sceneGraph) ClearLevel(false);
	else StopLevelLoop();
	clearSimulatorRuntime();
	simulatorRuntime.hadLevel = hadLevel;

	if (!simulatorRuntime.uiCleared && Cache.UI.lastPayload) {
		ClearUI(Cache.UI.lastPayload.rootId, false);
		simulatorRuntime.uiCleared = true;
	}

	const sceneGraph = await CreateLevel(buildSimulatorPayload(type, definition), { renderOptions: { rootId: "engine-level-root" } }, true);
	initSimulatorState(sceneGraph.entities.length > 0 ? sceneGraph.entities[0] : null, type, definition, sceneGraph);
	Log("ENGINE", `Simulator loaded: id=${definition.id}, type=${type}`, "log", "Simulator");
	return sceneGraph;
}

function SimulatorClear() {
	// Remove Current Simulation Data
	ClearLevel(false);
	clearSimulatorRuntime();
	Log("ENGINE", "Simulator cleared.", "log", "Simulator");
}

async function SimulatorExit() {
	const hadLevel = simulatorRuntime.hadLevel;
	SimulatorClear();
	simulatorRuntime.uiCleared = false;
	if (hadLevel) await CreateLevel(Cache.Level.lastPayload, { renderOptions: { rootId: "engine-level-root" } }, true);
	if (Cache.UI.lastPayload) await ApplyMenuUI(Cache.UI.lastPayload);
	SendEvent("SIMULATOR_EXITED", {});
}

const IsSimulatorActive = () => simulatorRuntime.active;

function HandleSimulatorInput(event) {
	if (event.type !== "keydown") return false;

	if (event.code === "Escape") {
		SimulatorExit();
		return true;
	}

	if (simulatorRuntime.entity === null || simulatorRuntime.animSetKeys.length === 0) return false;

	if ((event.code === "KeyW" || event.code === "KeyS") && !simulatorRuntime.isHolding) {
		const len = simulatorRuntime.animSetKeys.length;
		simulatorRuntime.currentSetIdx = event.code === "KeyW"
			? (simulatorRuntime.currentSetIdx + 1) % len
			: (simulatorRuntime.currentSetIdx - 1 + len) % len;
		simulatorRuntime.entity.state = "__sim-hold__";
		simulatorRuntime.isHolding    = true;
		simulatorRuntime.holdTimer    = 0.2;
		return true;
	}

	return false;
}

export {
	CreateLevel, ClearLevel, Update, GetActiveLevel,
	StartLevelLoop, StopLevelLoop, PauseLevelLoop, ResumeLevelLoop, ToggleLevelLoopPause,
	SimulatorLoad, SimulatorClear, SimulatorExit,
	IsSimulatorActive, HandleSimulatorInput,
};
