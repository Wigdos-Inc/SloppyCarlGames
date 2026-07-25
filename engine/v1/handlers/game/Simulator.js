// Simulator handler — manages the two-phase simulator lifecycle:
// Start() builds the disc environment; Load/Clear mutate the live sceneGraph directly.

import { CreateLevel, ClearLevel, GetActiveLevel, StopLevelLoop, SpawnIntoScene, DespawnFromScene } from "./Level.js";
import { UpdateCameraState, SetDefaultCamFraming } from "./Camera.js";
import { ResolveEntityAnimation } from "./Animation.js";
import { Cache, Log, SendEvent, ENTITY_TYPES, EngineInitialized } from "../../core/meta.js";
import { CreateUI, ClearUI, ApplyMenuUI } from "../UI.js";
import { SetElementText, RemoveRoot } from "../Render.js";
import { ValidateSimulatorPayload, ValidateSimulatorBulkPayload } from "../../core/validate.js";
import { MergeAabb, CreateDetailedBoundsFromParts } from "../../builder/NewObstacle.js";
import { UpdateObjectWorldAabb } from "../../builder/NewObject.js";
import { UnitVector3 } from "../../math/Utilities.js";
import simulatorTemplates from "../../builder/templates/levels.json" with { type: "json" };
import { CloneVector3, SubtractVector3 } from "../../math/Vector3.js";

// Platform padding and camera-fit factors relative to the loaded object's bounds.
const platformPadFactor = 1.6;
const framingFactor     = 1.8;
const heightFraction    = 0.5;

const templateDisc   = simulatorTemplates.simulatorLevel.terrain.objects[0];
const templateCamera = simulatorTemplates.simulatorLevel.camera;

const simulatorRuntime = {
	active           : false,
	hadLevel         : false,
	entity           : null,
	followTarget     : null,
	builtObject      : null,
	platformMesh     : null,
	objectType       : null,
	animSetKeys      : [],
	currentSetIdx    : 0,
	holdTimer        : 0,
	isHolding        : false,
	hudRootId        : "engine-simulator-hud",
	savedEntityAction: undefined,
	uiCleared        : false,
};

const simulatorCache = new Map();

function buildSimulatorHud() {
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
					row("sim-hud-id",          "ID: —"),
					row("sim-hud-type",        "Type: —"),
					row("sim-hud-entity-type", "Entity Type: —"),
					row("sim-hud-parts",       "Parts: —"),
					row("sim-hud-anim-set",    "Anim Set: —"),
					row("sim-hud-anim-frame",  "Frame: —"),
				],
			},
			{
				type: "div", id: "sim-hud-controls",
				attributes: {}, styles: controlBarStyles, events: {}, on: {},
				text: "[W] Next Anim   [S] Prev Anim   [Mouse/Arrows] Camera Orbit   [Esc x2] Exit",
				children: [],
			},
		],
	});
}

function updateSimulatorHudTarget(definition, objectType, entity) {
	const parts = entity !== null ? entity.model.parts.length > 10 ? entity.model.parts.length : entity.model.parts.map(p => p.id).join(", ") : "—";
	SetElementText("sim-hud-id",          `ID: ${definition.id}`);
	SetElementText("sim-hud-type",        `Type: ${objectType}`);
	SetElementText("sim-hud-entity-type", `Entity Type: ${entity !== null ? entity.type : "—"}`);
	SetElementText("sim-hud-parts",       `Parts: ${parts}`);
}

function updateSimulatorHudNoTarget() {
	SetElementText("sim-hud-id",          "ID: —");
	SetElementText("sim-hud-type",        "Type: —");
	SetElementText("sim-hud-entity-type", "Entity Type: —");
	SetElementText("sim-hud-parts",       "Parts: —");
	SetElementText("sim-hud-anim-set",    "Anim Set: —");
	SetElementText("sim-hud-anim-frame",  "Frame: —");
}

function updateSimulatorHud() {
	const animRuntime = simulatorRuntime.entity.animationRuntime;
	const setName     = simulatorRuntime.isHolding ? null : animRuntime.currentSetName;
	SetElementText("sim-hud-anim-set",   `Anim Set: ${setName ?? "none"}`);
	SetElementText("sim-hud-anim-frame", `Frame: ${setName !== null ? Math.floor(animRuntime.elapsed * 60) : "0"}`);
}

function initSimulatorTarget(entity, objectType, definition) {
	if (entity !== null) {
		simulatorRuntime.savedEntityAction = entity.action;
		simulatorRuntime.animSetKeys       = Object.keys(entity.animations);
		entity.action                      = simulatorRuntime.animSetKeys.length > 0 ? simulatorRuntime.animSetKeys[0] : "idle";
	}
	else simulatorRuntime.animSetKeys = [];
	simulatorRuntime.entity        = entity;
	simulatorRuntime.currentSetIdx = 0;
	simulatorRuntime.isHolding     = false;
	simulatorRuntime.holdTimer     = 0;
	updateSimulatorHudTarget(definition, objectType, entity);
}

function clearTargetState() {
	if (simulatorRuntime.entity !== null) simulatorRuntime.entity.action = simulatorRuntime.savedEntityAction;
	simulatorRuntime.entity            = null;
	simulatorRuntime.builtObject       = null;
	simulatorRuntime.objectType        = null;
	simulatorRuntime.animSetKeys       = [];
	simulatorRuntime.currentSetIdx     = 0;
	simulatorRuntime.holdTimer         = 0;
	simulatorRuntime.isHolding         = false;
	simulatorRuntime.savedEntityAction = undefined;
}

function clearEnvironmentState() {
	if (simulatorRuntime.active) RemoveRoot(simulatorRuntime.hudRootId);
	clearTargetState();
	simulatorRuntime.followTarget = null;
	simulatorRuntime.platformMesh = null;
	simulatorRuntime.active       = false;
	simulatorRuntime.hadLevel     = false;
	simulatorRuntime.uiCleared    = false;
}

async function Start() {
	if (!EngineInitialized) {
		Log("ENGINE", "Simulator.Start: engine not yet initialized.", "error", "Simulator");
		return;
	}
	if (simulatorRuntime.active) {
		Log("ENGINE", "Simulator.Start: already active.", "error", "Simulator");
		return;
	}

	simulatorRuntime.hadLevel = GetActiveLevel() !== null;
	if (simulatorRuntime.hadLevel) ClearLevel(false);
	else StopLevelLoop();

	if (!simulatorRuntime.uiCleared && Cache.UI.lastPayload && document.getElementById(Cache.UI.lastPayload.rootId)) {
		ClearUI(Cache.UI.lastPayload.rootId, false);
		simulatorRuntime.uiCleared = true;
	}

	const baseEnvPayload = {
		...simulatorTemplates.simulatorLevel,
		obstacles       : [],
		entities        : [],
		entityBlueprints: { enemies: [], npcs: [], collectibles: [], projectiles: [], entities: [] },
		animations      : {},
		meta            : { levelId: "simulator", stageId: "simulator-level" },
	};

	await CreateLevel(baseEnvPayload, { renderOptions: { rootId: "engine-level-root" } }, true);
	simulatorRuntime.platformMesh = [GetActiveLevel().terrain[0]];
	simulatorRuntime.followTarget = GetActiveLevel().terrain[0];
	buildSimulatorHud();
	simulatorRuntime.active = true;
	Log("ENGINE", "simulator environment ready", "log", "Simulator");
}

// Rebuilds a fresh, correctly-sized disc platform through the terrain spawn path.
function spawnPlatform(sceneGraph, footprintXZ) {
	const disc = {
		...templateDisc,
		dimensions      : templateDisc.dimensions.clone(),
		position        : templateDisc.position.clone(),
		rotation        : templateDisc.rotation.clone(),
		scale           : CloneVector3(templateDisc.scale),
		pivot           : templateDisc.pivot.clone(),
		texture         : structuredClone(templateDisc.texture),
		detail          : structuredClone(templateDisc.detail),
		primitiveOptions: structuredClone(templateDisc.primitiveOptions),
	};
	disc.dimensions.x = footprintXZ;
	disc.dimensions.z = footprintXZ;
	return SpawnIntoScene(disc, "terrain", sceneGraph);
}

// Fits DefaultCam framing and follow target to the loaded object's bounds; returns its extent.
function frameLoadedObject(aabb) {
	const ext = SubtractVector3(aabb.max, aabb.min);
	const distance     = Math.max(templateCamera.distance, framingFactor * Math.max(ext.x, ext.z, ext.y));
	const heightOffset = Math.max(templateCamera.heightOffset, ext.y * heightFraction);
	SetDefaultCamFraming({ distance, heightOffset });

	// new
	const center = aabb.max.clone().add(aabb.min).scale(0.5); center.y = aabb.min.y;
	simulatorRuntime.followTarget = { transform: { position: center } };
	return ext;
}

async function Load(payload) {
	if (!simulatorRuntime.active) {
		Log("ENGINE", "Simulator.Load: simulator not active.", "error", "Simulator");
		return;
	}

	const validated = await ValidateSimulatorPayload(payload);
	if (validated === null) {
		Log("ENGINE", "Simulator.Load: payload rejected by validation.", "error", "Simulator");
		return;
	}

	let definition, objectType;
	if (validated.payloadType === "cached") {
		const cached = simulatorCache.get(validated.id);
		if (!cached) {
			Log("ENGINE", `Simulator.Load: no cached entry for id '${validated.id}'.`, "error", "Simulator");
			return;
		}
		definition = cached.definition;
		objectType = cached.objectType;
	} 
	else {
		definition = validated.definition;
		objectType = validated.objectType;
	}

	const sceneGraph = GetActiveLevel();
	if (simulatorRuntime.builtObject !== null) {
		DespawnFromScene(simulatorRuntime.builtObject, simulatorRuntime.objectType, sceneGraph);
	}
	clearTargetState();

	// Reset the part-geometry cache each load
	sceneGraph.partGeometryCache = new Map();

	let built, aabb;
	if (objectType === "terrain") {
		// Loaded terrain is the ground: drop the disc platform.
		if (simulatorRuntime.platformMesh !== null) DespawnFromScene(simulatorRuntime.platformMesh, "terrain", sceneGraph);
		simulatorRuntime.platformMesh = null;
		built = SpawnIntoScene(definition, objectType, sceneGraph);
		aabb  = built.reduce((accumulator, mesh) => MergeAabb(accumulator, mesh.worldAabb), null);
	}
	else {
		// Entities ground on the surface map, so a platform must exist before the object spawns.
		if (simulatorRuntime.platformMesh === null) simulatorRuntime.platformMesh = spawnPlatform(sceneGraph, templateDisc.dimensions.x);
		built = SpawnIntoScene(definition, objectType, sceneGraph);

		if (objectType === "obstacle") {
			// Obstacles have no self-grounding step; snap onto the platform here.
			const platformMesh  = simulatorRuntime.platformMesh[0];
			const platformTopY  = platformMesh.transform.position.y + (platformMesh.dimensions.y * platformMesh.transform.scale.y * 0.5);
			const deltaY        = platformTopY - built.worldAabb.min.y;
			built.parts.forEach((part) => {
				part.transform.position.y += deltaY;
				UpdateObjectWorldAabb(part);
			});
			built.worldAabb      = built.parts.reduce((accumulator, part) => MergeAabb(accumulator, part.worldAabb), null);
			built.detailedBounds = CreateDetailedBoundsFromParts(built, built.parts, built.worldAabb);
		}

		aabb  = ENTITY_TYPES.includes(objectType) ? built.collision.aabb : built.worldAabb;
	}

	simulatorRuntime.builtObject = built;
	simulatorRuntime.objectType  = objectType;

	const ext = frameLoadedObject(aabb);

	if (objectType !== "terrain") {
		// Resize the platform to the object's footprint.
		DespawnFromScene(simulatorRuntime.platformMesh, "terrain", sceneGraph);
		const footprint = Math.max(templateDisc.dimensions.x, Math.max(ext.x, ext.z) * platformPadFactor);
		simulatorRuntime.platformMesh = spawnPlatform(sceneGraph, footprint);
	}

	initSimulatorTarget(ENTITY_TYPES.includes(objectType) ? built : null, objectType, definition);
	Log("ENGINE", `Simulator loaded: id=${definition.id}, type=${objectType}`, "log", "Simulator");
}

async function CacheEntries(bulkPayload) {
	Log("ENGINE", "Simulator cache request received.", "log", "Simulator");
	const validated = await ValidateSimulatorBulkPayload(bulkPayload);
	for (const entry of validated) simulatorCache.set(entry.definition.id, { definition: entry.definition, objectType: entry.objectType });
	Log("ENGINE", `Simulator caching complete: ${validated.length} entries.\n${validated.map(e => `- ${e.definition.id} (${e.objectType})`).join("\n")}`, "log", "Simulator");
}

function Clear() {
	if (!simulatorRuntime.active) {
		Log("ENGINE", "Simulator.Clear: simulator not active.", "error", "Simulator");
		return;
	}
	if (simulatorRuntime.builtObject !== null) DespawnFromScene(simulatorRuntime.builtObject, simulatorRuntime.objectType, GetActiveLevel());
	clearTargetState();
	updateSimulatorHudNoTarget();
	Log("ENGINE", "simulator target cleared", "log", "Simulator");
}

async function Exit() {
	if (!simulatorRuntime.active) {
		Log("ENGINE", "Simulator.Exit: simulator not active.", "error", "Simulator");
		return;
	}
	const hadLevel = simulatorRuntime.hadLevel;
	clearEnvironmentState();
	ClearLevel(false);
	if (hadLevel) await CreateLevel(Cache.Level.lastPayload, { renderOptions: { rootId: "engine-level-root" } }, true);
	if (Cache.UI.lastPayload) await ApplyMenuUI(Cache.UI.lastPayload);
	SendEvent("SIMULATOR_EXITED", {});
	Log("ENGINE", "simulator exited", "log", "Simulator");
}

const IsSimulatorActive  = () => simulatorRuntime.active;
const GetModelState      = () => simulatorRuntime.builtObject;
const GetFullState       = () => simulatorRuntime;

function HandleSimulatorInput(event) {
	if (event.type !== "keydown") return false;
	if (event.code === "Escape") {
		Exit();
		return true;
	}

	if (simulatorRuntime.entity === null || simulatorRuntime.animSetKeys.length === 0) return false;

	if ((event.code === "KeyW" || event.code === "KeyS") && !simulatorRuntime.isHolding) {
		const len = simulatorRuntime.animSetKeys.length;
		simulatorRuntime.currentSetIdx = event.code === "KeyW"
			? (simulatorRuntime.currentSetIdx + 1) % len
			: (simulatorRuntime.currentSetIdx - 1 + len) % len;
		simulatorRuntime.entity.action = "__sim-hold__";
		simulatorRuntime.isHolding    = true;
		simulatorRuntime.holdTimer    = 0.2;
		return true;
	}

	return false;
}

function UpdateSimulator(deltaMilliseconds, sceneGraph) {
	const deltaSeconds = Math.max(0, deltaMilliseconds) / 1000;

	if (simulatorRuntime.isHolding) {
		simulatorRuntime.holdTimer -= deltaSeconds;
		if (simulatorRuntime.holdTimer <= 0) {
			simulatorRuntime.isHolding    = false;
			simulatorRuntime.holdTimer    = 0;
			simulatorRuntime.entity.action = simulatorRuntime.animSetKeys[simulatorRuntime.currentSetIdx];
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
}

export { Start, Load, CacheEntries as Cache, Clear, Exit, IsSimulatorActive, HandleSimulatorInput, UpdateSimulator, GetModelState, GetFullState };
