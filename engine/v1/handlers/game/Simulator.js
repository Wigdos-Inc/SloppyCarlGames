// Simulator handler — manages the two-phase simulator lifecycle:
// Start() builds the disc environment; Load/Clear mutate the live sceneGraph directly.

import { CreateLevel, ClearLevel, GetActiveLevel, StopLevelLoop, SpawnIntoScene, AddEntityToScene, DespawnFromScene, SpawnParticleRequests } from "./Level.js";
import { CharacterData, BuildPlayerModel } from "../../player/Model.js";
import { ParticleGeneratorRequests, WithParticleOverride } from "../../builder/NewParticles.js";
import { UpdateCameraState, SetDefaultCamFraming } from "./Camera.js";
import { ResolveEntityAnimation } from "./Animation.js";
import { Cache, Log, SendEvent, ENTITY_TYPES, EngineInitialized } from "../../core/meta.js";
import { CreateUI, ClearUI, ApplyMenuUI } from "../UI.js";
import { SetElementText, RemoveRoot, DECAL_SHAPE_CODES, DECAL_FACE_ROTATIONS, ResolveDecalShapeCode, SelectDecalFacets, DecalSurfaceUv, BuildDecalPlacementMatrix, CapsuleBand } from "../Render.js";
import { ValidateSimulatorPayload, ValidateSimulatorBulkPayload } from "../../core/validate.js";
import { MergeAabb, CreateDetailedBoundsFromParts } from "../../builder/NewObstacle.js";
import { UpdateObjectWorldAabb } from "../../builder/NewObject.js";
import { UpdateEntityModelFromTransform } from "../../builder/NewEntity.js";
import { Squared, UnitVector3 } from "../../math/Utilities.js";
import simulatorTemplates from "../../builder/templates/levels.json" with { type: "json" };
import terrainTemplates from "../../builder/templates/terrain.json" with { type: "json" };
import obstacleTemplates from "../../builder/templates/obstacles.json" with { type: "json" };
import characterTemplates from "../../builder/templates/characters.json" with { type: "json" };
import enemyTemplates from "../../builder/templates/enemies.json" with { type: "json" };
import projectileTemplates from "../../builder/templates/projectiles.json" with { type: "json" };
import { CloneVector3, SubtractVector3, AddVector3, ScaleVector3, CrossVector3, ResolveVector3Axis, WORLD_NORMALS, ToVector3, DivideVector3, MultiplyVector3 } from "../../math/Vector3.js";
import { CreateModelMatrix } from "../../math/Matrix.js";

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
	loadedId         : null,
	animSetKeys      : [],
	currentSetIdx    : 0,
	holdTimer        : 0,
	isHolding        : false,
	hudRootId        : "engine-simulator-hud",
	savedEntityAction: undefined,
	uiCleared        : false,
};

const simulatorCache = new Map();

// Engine content any game can preview, cached on first Start.
const objectTemplates = { terrain: terrainTemplates, obstacle: obstacleTemplates };
const entityTemplates = { character: characterTemplates, enemy: enemyTemplates, projectile: projectileTemplates };
let engineEntriesCached = false;

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
		stylesheet: null,
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
					row("sim-hud-export",      "Export: —"),
				],
			},
			{
				type: "div", id: "sim-hud-controls",
				attributes: {}, styles: controlBarStyles, events: {}, on: {},
				text: "[W] Next Anim   [S] Prev Anim   [E] Export GLB   [Mouse/Arrows] Camera Orbit   [Esc x2] Exit",
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
	SetElementText("sim-hud-export",      "Export: —");
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
	simulatorRuntime.loadedId          = null;
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
	if (!engineEntriesCached) await cacheEngineEntries();

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

	const center = aabb.max.clone().add(aabb.min).scale(0.5); center.y = aabb.min.y;
	simulatorRuntime.followTarget = { transform: { position: center } };
	return ext;
}

// Only the loaded object can emit here, so every live group belongs to the object being replaced.
const clearParticles = (sceneGraph) => DespawnFromScene(sceneGraph.entities.filter((entity) => entity.particle !== null), "entity", sceneGraph);

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
	clearParticles(sceneGraph);
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
		const platformMesh = simulatorRuntime.platformMesh[0];
		const platformTopY = platformMesh.transform.position.y + (platformMesh.dimensions.y * platformMesh.transform.scale.y * 0.5);

		if (objectType === "player") {
			// Built exactly as a level builds the player.
			const playerData = { spawnPosition: new UnitVector3(0, platformTopY, 0, "cnu"), scale: ToVector3(1), animations: {}, customEvents: {}, hasCustomParts: false };
			built      = AddEntityToScene(await BuildPlayerModel(definition, playerData), sceneGraph);
			objectType = "entity";
		}
		else built = SpawnIntoScene(definition, objectType, sceneGraph);

		if (objectType === "obstacle") {
			// Obstacles have no self-grounding step; centre on the platform and snap onto it here.
			const deltaY       = platformTopY - built.worldAabb.min.y;
			const deltaX       = platformMesh.transform.position.x - (built.worldAabb.min.x + built.worldAabb.max.x) * 0.5;
			const deltaZ       = platformMesh.transform.position.z - (built.worldAabb.min.z + built.worldAabb.max.z) * 0.5;
			built.parts.forEach((part) => {
				part.transform.position.x += deltaX;
				part.transform.position.y += deltaY;
				part.transform.position.z += deltaZ;
				UpdateObjectWorldAabb(part);
			});
			built.worldAabb      = built.parts.reduce((accumulator, part) => MergeAabb(accumulator, part.worldAabb), null);
			built.detailedBounds = CreateDetailedBoundsFromParts(built, built.parts, built.worldAabb);
		}
		else {
			// The surface map grounds Y; authored placement and a movement path still carry X/Z off the disc.
			built.transform.position.x = platformMesh.transform.position.x;
			built.transform.position.z = platformMesh.transform.position.z;
			UpdateEntityModelFromTransform(built);
		}

		aabb  = ENTITY_TYPES.includes(objectType) ? built.collision.aabb : built.worldAabb;
	}

	simulatorRuntime.builtObject = built;
	simulatorRuntime.objectType  = objectType;
	simulatorRuntime.loadedId    = definition.id;

	const ext = frameLoadedObject(aabb);

	if (objectType !== "terrain") {
		// Resize the platform to the object's footprint.
		DespawnFromScene(simulatorRuntime.platformMesh, "terrain", sceneGraph);
		const footprint = Math.max(templateDisc.dimensions.x, Math.max(ext.x, ext.z) * platformPadFactor);
		simulatorRuntime.platformMesh = spawnPlatform(sceneGraph, footprint);
	}

	initSimulatorTarget(ENTITY_TYPES.includes(objectType) ? built : null, objectType, definition);

	// Terrain spawns return an array of meshes; every other type returns one carrier.
	const carriers = objectType === "terrain" ? built : [built];
	const requests = carriers.flatMap((carrier) => ParticleGeneratorRequests(carrier, ENTITY_TYPES.includes(objectType) ? "entity" : objectType));

	// No physics pipeline runs here, so anything but "none" would emit and never move.
	requests.forEach((request) => { request.overrides = WithParticleOverride(request.overrides, "physics", "none"); });
	SpawnParticleRequests(requests, sceneGraph);

	Log("ENGINE", `Simulator loaded: id=${definition.id}, type=${objectType}`, "log", "Simulator");
}

async function CacheEntries(bulkPayload) {
	Log("ENGINE", "Simulator cache request received.", "log", "Simulator");
	const validated = await ValidateSimulatorBulkPayload(bulkPayload);
	for (const entry of validated) simulatorCache.set(entry.definition.id, { definition: entry.definition, objectType: entry.objectType });
	Log("ENGINE", `Simulator caching complete: ${validated.length} entries.\n${validated.map(e => `- ${e.definition.id} (${e.objectType})`).join("\n")}`, "log", "Simulator");
}

async function cacheEngineEntries() {
	for (const id in CharacterData) simulatorCache.set(`player.${id}`, { definition: { ...CharacterData[id], id: `player.${id}` }, objectType: "player" });

	const refs = [];
	for (const objectType in objectTemplates) for (const template in objectTemplates[objectType]) {
		refs.push({ objectType, definition: { id: `template.${template}`, shape: "template", template } });
	}
	for (const type in entityTemplates) for (const template in entityTemplates[type]) {
		refs.push({ objectType: entityTemplates[type][template].type, definition: { id: `template.${template}`, shape: "template", template, type } });
	}
	await CacheEntries(refs);
	engineEntriesCached = true;
}

function Clear() {
	if (!simulatorRuntime.active) {
		Log("ENGINE", "Simulator.Clear: simulator not active.", "error", "Simulator");
		return;
	}
	if (simulatorRuntime.builtObject !== null) DespawnFromScene(simulatorRuntime.builtObject, simulatorRuntime.objectType, GetActiveLevel());
	clearParticles(GetActiveLevel());
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

/* === GLB EXPORT === */

const glbMagic         = 0x46546C67;
const glbJsonChunkType = 0x4E4F534A;
const glbBinChunkType  = 0x004E4942;
const gltfFloat        = 5126;
const gltfArrayBuffer  = 34962;
const gltfLinear       = 9729;
const gltfRepeat       = 10497;
const gltfClampToEdge  = 33071;

const decalSurfaceOffset  = 0.001;
const decalLayerStep      = 0.0004;
const decalUvTolerance    = 0.05; // in decal widths
const decalMaxSubdivision = 16;

const alignTo4 = (value) => (value + 3) & ~3;

// Loaded object only; sceneGraph.terrain would include the disc platform.
// Mode filter mirrors the renderer: terrain by mesh, obstacles by record, entity parts never.
function exportMeshList() {
	const built = simulatorRuntime.builtObject;
	if (simulatorRuntime.objectType === "terrain")  return built.filter((mesh) => mesh.meta.mode === "default");
	if (simulatorRuntime.objectType === "obstacle") return built.mode === "default" ? built.parts : [];
	return built.model.parts.map((part) => part.mesh);
}

// Sole reader of material.textureID — per-face meshes never register it.
function meshPrimitiveSpans(mesh) {
	if (mesh.geometry.faceTextureGroups) return mesh.geometry.faceTextureGroups;
	return [{ indexStart: 0, indexCount: mesh.geometry.indices.length, textureID: mesh.material.textureID }];
}

function triangleNormal(pa, pb, pc) {
	const normal = ResolveVector3Axis(CrossVector3(SubtractVector3(pb, pa), SubtractVector3(pc, pa)));
	return normal.x === 0 && normal.y === 0 && normal.z === 0 ? WORLD_NORMALS.Up : normal;
}

// Dominant axis instead of the shader's pow(w,4) blend; diverges only near 45° faces.
function triplanarTriangleUvs(pa, pb, pc, normal, textureScale) {
	const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
	if (ax >= ay && ax >= az) return [pa.z, pa.y, pb.z, pb.y, pc.z, pc.y].map((v) => v * textureScale);
	if (ay >= az)             return [pa.x, pa.z, pb.x, pb.z, pc.x, pc.z].map((v) => v * textureScale);
	return [pa.x, pa.y, pb.x, pb.y, pc.x, pc.y].map((v) => v * textureScale);
}

function createVertexData(triangleCount) {
	return {
		position: new Float32Array(triangleCount * 9),
		normal  : new Float32Array(triangleCount * 9),
		uv      : new Float32Array(triangleCount * 6),
		min     : [Infinity, Infinity, Infinity],
		max     : [-Infinity, -Infinity, -Infinity],
		count   : 0,
	};
}

function pushVertex(data, point, normal, u, v) {
	const at3 = data.count * 3, at2 = data.count * 2;
	data.position[at3] = point.x;  data.position[at3 + 1] = point.y;  data.position[at3 + 2] = point.z;
	data.normal[at3]   = normal.x; data.normal[at3 + 1]   = normal.y; data.normal[at3 + 2]   = normal.z;
	data.uv[at2]       = u;        data.uv[at2 + 1]       = v;
	data.min[0] = Math.min(data.min[0], point.x); data.max[0] = Math.max(data.max[0], point.x);
	data.min[1] = Math.min(data.min[1], point.y); data.max[1] = Math.max(data.max[1], point.y);
	data.min[2] = Math.min(data.min[2], point.z); data.max[2] = Math.max(data.max[2], point.z);
	data.count++;
}

// De-indexes one span into local-space vertices with flat per-triangle normals.
function buildMeshVertices(mesh, span) {
	const { positions, indices, uvs } = mesh.geometry;
	const triplanar = mesh.geometry.triplanar === true;
	const data      = createVertexData(span.indexCount / 3);
	const pointAt   = (index) => ({ x: positions[index * 3], y: positions[index * 3 + 1], z: positions[index * 3 + 2] });

	for (let offset = 0; offset < span.indexCount; offset += 3) {
		const ia = indices[span.indexStart + offset];
		const ib = indices[span.indexStart + offset + 1];
		const ic = indices[span.indexStart + offset + 2];
		const pa = pointAt(ia), pb = pointAt(ib), pc = pointAt(ic);
		const normal = triangleNormal(pa, pb, pc);
		const uv     = triplanar
			? triplanarTriangleUvs(pa, pb, pc, normal, mesh.material.textureScale)
			: [uvs[ia * 2], uvs[ia * 2 + 1], uvs[ib * 2], uvs[ib * 2 + 1], uvs[ic * 2], uvs[ic * 2 + 1]];
		pushVertex(data, pa, normal, uv[0], uv[1]);
		pushVertex(data, pb, normal, uv[2], uv[3]);
		pushVertex(data, pc, normal, uv[4], uv[5]);
	}
	return data;
}

// Analytic, not per-facet: shared corners lift identically, so the sheet cannot tear.
function decalSurfaceNormal(shapeCode, point, halfExtents, faceAxis) {
	switch (shapeCode) {
		case DECAL_SHAPE_CODES.Flat    : return faceAxis;
		case DECAL_SHAPE_CODES.Cylinder: return ResolveVector3Axis({ x: point.x / Squared(halfExtents.x), y: 0, z: point.z / Squared(halfExtents.z) });
		case DECAL_SHAPE_CODES.Capsule :
			const band = CapsuleBand(halfExtents, point.y);
			return ResolveVector3Axis({ x: point.x / Squared(halfExtents.x), y: (point.y - band.originY) / Squared(band.capRadius), z: point.z / Squared(halfExtents.z) });
		default: return  ResolveVector3Axis(DivideVector3(point, MultiplyVector3(halfExtents, halfExtents)));
	}
}

// glTF has no discard: clip to the [-0.5, 0.5] square the fragment shader cuts at runtime.
function clipToDecalSquare(polygon) {
	for (const [axis, sign] of [["u", 1], ["u", -1], ["v", 1], ["v", -1]]) {
		const kept = [];
		polygon.forEach((a, index) => {
			const b  = polygon[(index + 1) % polygon.length];
			const da = 0.5 - sign * a[axis], db = 0.5 - sign * b[axis];
			if (da >= 0) kept.push(a);
			if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
				const t = da / (da - db);
				kept.push({ point: AddVector3(a.point, ScaleVector3(SubtractVector3(b.point, a.point), t)), u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });
			}
		});
		if (kept.length < 3) return [];
		polygon = kept;
	}
	return polygon;
}

// Host facets, lifted by a fixed epsilon since glTF has no polygon offset.
function buildDecalVertices(mesh, decalEntry, lift) {
	const halfExtents = mesh.dimensions.clone().divide(ToVector3(2));
	const shapeCode   = ResolveDecalShapeCode(mesh.shape, decalEntry.side);
	const faceMatrix  = DECAL_FACE_ROTATIONS[decalEntry.side];
	const faceAxis    = { x: faceMatrix[8], y: faceMatrix[9], z: faceMatrix[10] };
	const placement   = BuildDecalPlacementMatrix(mesh.dimensions, decalEntry.localTransform, decalEntry.side);
	const { positions, uvs } = SelectDecalFacets(mesh.geometry, placement, shapeCode, halfExtents, 1);
	const corner    = (index) => ({ point: { x: positions[index * 3], y: positions[index * 3 + 1], z: positions[index * 3 + 2] }, u: uvs[index * 2], v: uvs[index * 2 + 1] });
	const windingOf = (first) => Math.sign((uvs[first * 2 + 2] - uvs[first * 2]) * (uvs[first * 2 + 5] - uvs[first * 2 + 1]) - (uvs[first * 2 + 4] - uvs[first * 2]) * (uvs[first * 2 + 3] - uvs[first * 2 + 1]));

	// Uv winding flips only across a sphere's antipodal fold; the facet nearest the centre sets the true one.
	let winding = 0, nearest = Infinity;
	for (let first = 0; first < positions.length / 3; first += 3) {
		let distance = 0;
		for (let slot = 0; slot < 9; slot++) distance += Squared(positions[first * 3 + slot] - placement[12 + slot % 3]);
		if (distance < nearest && windingOf(first) !== 0) { nearest = distance; winding = windingOf(first); }
	}

	const corners = [];
	const emit = (p, q, r) => {
		const polygon = clipToDecalSquare([p, q, r]);
		for (let fan = 1; fan + 1 < polygon.length; fan++) corners.push(polygon[0], polygon[fan], polygon[fan + 1]);
	};
	for (let first = 0; first < positions.length / 3; first += 3) {
		if (windingOf(first) !== winding) continue;
		const a = corner(first), b = corner(first + 1), c = corner(first + 2);
		const baseArc = DecalSurfaceUv(a.point, placement, shapeCode, halfExtents, 0).arc;
		const at = (i, j, n) => {
			const point = AddVector3(a.point, AddVector3(ScaleVector3(SubtractVector3(b.point, a.point), i / n), ScaleVector3(SubtractVector3(c.point, a.point), j / n)));
			const uv    = DecalSurfaceUv(point, placement, shapeCode, halfExtents, baseArc);
			return { point, u: uv.u, v: uv.v };
		};
		const deviation = (i, j, n) => {
			const exact = at(i, j, n);
			return Math.hypot(exact.u - (a.u + (b.u - a.u) * i / n + (c.u - a.u) * j / n), exact.v - (a.v + (b.v - a.v) * i / n + (c.v - a.v) * j / n));
		};

		// glTF interpolates uv linearly; subdivide on the facet until that tracks the per-fragment map.
		const error = Math.max(deviation(1, 0, 2), deviation(0, 1, 2), deviation(1, 1, 2), deviation(1, 1, 3));
		const n     = Math.min(decalMaxSubdivision, Math.max(1, Math.ceil(Math.sqrt(error / decalUvTolerance))));
		const grid  = [];
		for (let i = 0; i <= n; i++) {
			grid.push([]);
			for (let j = 0; i + j <= n; j++) grid[i].push(at(i, j, n));
		}
		for (let i = 0; i < n; i++) {
			for (let j = 0; i + j < n; j++) {
				emit(grid[i][j], grid[i + 1][j], grid[i][j + 1]);
				if (i + j < n - 1) emit(grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
			}
		}
	}

	const data = createVertexData(corners.length / 3);
	corners.forEach(({ point, u, v }) => {
		const normal = decalSurfaceNormal(shapeCode, point, halfExtents, faceAxis);
		pushVertex(data, AddVector3(point, ScaleVector3(normal, lift)), normal, u + 0.5, 0.5 - v);
	});
	return data;
}

// Canvas or ImageBitmap — both CanvasImageSource. toBlob un-premultiplies; don't correct twice.
async function encodeTextureImage(source) {
	const canvas  = document.createElement("canvas");
	canvas.width  = source.width;
	canvas.height = source.height;
	const context = canvas.getContext("2d");
	context.drawImage(source, 0, 0);

	const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
	let partial = false, zero = false;
	for (let i = 3; i < pixels.length; i += 4) {
		if (pixels[i] === 0) zero = true;
		else if (pixels[i] !== 255) { 
			partial = true; 
			break; 
		}
	}

	const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
	return { bytes: new Uint8Array(await blob.arrayBuffer()), alphaMode: partial ? "BLEND" : zero ? "MASK" : "OPAQUE" };
}

function collectTextureIds(meshes) {
	const ids  = [];
	const seen = new Set();
	const add  = (id) => { if (!seen.has(id)) { seen.add(id); ids.push(id); } };
	meshes.forEach((mesh) => {
		meshPrimitiveSpans(mesh).forEach((span) => add(span.textureID));
		for (let index = 0; index < mesh.customTextures.length; index++) add(`${mesh.id}::customTexture::${index}`);
	});
	return ids;
}

// 4-align every piece; PNG payloads do not self-align.
function pushBinaryView(writer, bytes, target) {
	const byteOffset = writer.binaryLength;
	const view       = { buffer: 0, byteOffset, byteLength: bytes.byteLength };
	if (target !== null) view.target = target;
	writer.binaryParts.push({ bytes, byteOffset });
	writer.binaryLength = alignTo4(byteOffset + bytes.byteLength);
	writer.bufferViews.push(view);
	return writer.bufferViews.length - 1;
}

function pushFloatAccessor(writer, values, type, count, min, max) {
	const accessor = {
		bufferView   : pushBinaryView(writer, new Uint8Array(values.buffer, values.byteOffset, values.byteLength), gltfArrayBuffer),
		componentType: gltfFloat,
		count, type,
	};
	if (min !== null) { accessor.min = min; accessor.max = max; }
	writer.accessors.push(accessor);
	return writer.accessors.length - 1;
}

// Face and decal bakes are single-tile atlases; everything else tiles.
function pushTexture(writer, textureID, image) {
	writer.images.push({ bufferView: pushBinaryView(writer, image.bytes, null), mimeType: "image/png" });
	writer.textures.push({
		sampler: textureID.includes("::face=") || textureID.includes("::customTexture::") ? 1 : 0,
		source : writer.images.length - 1,
	});
	return writer.textures.length - 1;
}

function pushMaterial(writer, textureIndex, alphaMode, baseColorFactor) {
	const pbr = { baseColorTexture: { index: textureIndex }, metallicFactor: 0, roughnessFactor: 1 };
	if (baseColorFactor !== null) pbr.baseColorFactor = baseColorFactor;

	const material = { pbrMetallicRoughness: pbr, doubleSided: true };
	if (alphaMode === "MASK")  { material.alphaMode = "MASK"; material.alphaCutoff = 0.5; }
	if (alphaMode === "BLEND") material.alphaMode = "BLEND";
	writer.materials.push(material);
	return writer.materials.length - 1;
}

function pushVertexPrimitive(writer, data, materialIndex) {
	return {
		attributes: {
			POSITION  : pushFloatAccessor(writer, data.position, "VEC3", data.count, data.min, data.max),
			NORMAL    : pushFloatAccessor(writer, data.normal,   "VEC3", data.count, null, null),
			TEXCOORD_0: pushFloatAccessor(writer, data.uv,       "VEC2", data.count, null, null),
		},
		material: materialIndex,
	};
}

// JSON pads 0x20, BIN pads 0x00 — spec-mandated.
function writeGlbBinary(writer) {
	const json = JSON.stringify({
		asset      : { version: "2.0", generator: "CarlNet Engine v1 - Sloppy Carl Games" },
		scene      : 0,
		scenes     : [{ nodes: writer.nodes.map((_, index) => index) }],
		nodes      : writer.nodes,
		meshes     : writer.meshes,
		materials  : writer.materials,
		textures   : writer.textures,
		samplers   : writer.samplers,
		images     : writer.images,
		accessors  : writer.accessors,
		bufferViews: writer.bufferViews,
		buffers    : [{ byteLength: writer.binaryLength }],
	});

	const jsonBytes  = new TextEncoder().encode(json);
	const jsonPadded = alignTo4(jsonBytes.length);
	const binHeader  = 20 + jsonPadded;
	const total      = binHeader + 8 + writer.binaryLength;

	const buffer = new ArrayBuffer(total);
	const view   = new DataView(buffer);
	const bytes  = new Uint8Array(buffer);

	view.setUint32(0, glbMagic, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, total, true);
	view.setUint32(12, jsonPadded, true);
	view.setUint32(16, glbJsonChunkType, true);
	bytes.fill(0x20, 20, binHeader);
	bytes.set(jsonBytes, 20);
	view.setUint32(binHeader, writer.binaryLength, true);
	view.setUint32(binHeader + 4, glbBinChunkType, true);
	writer.binaryParts.forEach((part) => bytes.set(part.bytes, binHeader + 8 + part.byteOffset));

	return buffer;
}

function triggerFileDownload(buffer, fileName) {
	const url  = URL.createObjectURL(new Blob([buffer], { type: "model/gltf-binary" }));
	const link = document.createElement("a");
	link.href     = url;
	link.download = fileName;
	link.click();
	// The fetch runs on a queued task; the URL must outlive this one.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function Download() {
	if (!simulatorRuntime.active) {
		Log("ENGINE", "Simulator.Download: simulator not active.", "error", "Simulator");
		return;
	}
	if (simulatorRuntime.builtObject === null) {
		Log("ENGINE", "Simulator.Download: no object loaded.", "error", "Simulator");
		return;
	}

	SetElementText("sim-hud-export", "Export: baking…");

	const meshes   = exportMeshList();
	const registry = GetActiveLevel().visualResources.textureRegistry;
	const ids      = collectTextureIds(meshes);
	const encoded  = await Promise.all(ids.map((id) => encodeTextureImage(registry[id].source)));

	const writer = {
		bufferViews : [],
		accessors   : [],
		images      : [],
		samplers    : [
			{ magFilter: gltfLinear, minFilter: gltfLinear, wrapS: gltfRepeat,      wrapT: gltfRepeat      },
			{ magFilter: gltfLinear, minFilter: gltfLinear, wrapS: gltfClampToEdge, wrapT: gltfClampToEdge },
		],
		textures    : [],
		materials   : [],
		meshes      : [],
		nodes       : [],
		binaryParts : [],
		binaryLength: 0,
	};

	const textures      = new Map();
	const baseMaterials = new Map();
	ids.forEach((id, index) => textures.set(id, { index: pushTexture(writer, id, encoded[index]), alphaMode: encoded[index].alphaMode }));

	const baseMaterialFor = (id) => {
		if (!baseMaterials.has(id)) baseMaterials.set(id, pushMaterial(writer, textures.get(id).index, textures.get(id).alphaMode, null));
		return baseMaterials.get(id);
	};
	// Always BLEND (anti-aliased edges). Mutable decals bake colour-stripped, so tint here.
	const decalMaterialFor = (id, decalEntry) => {
		const tint = decalEntry.mutable === true ? decalEntry.texture.primary : null;
		return pushMaterial(writer, textures.get(id).index, "BLEND", tint === null ? null : [tint.r, tint.g, tint.b, tint.a]);
	};

	meshes.forEach((mesh) => {
		const primitives = meshPrimitiveSpans(mesh).map((span) => pushVertexPrimitive(writer, buildMeshVertices(mesh, span), baseMaterialFor(span.textureID)));
		mesh.customTextures.forEach((decalEntry, index) => primitives.push(pushVertexPrimitive(
			writer,
			buildDecalVertices(mesh, decalEntry, decalSurfaceOffset + index * decalLayerStep),
			decalMaterialFor(`${mesh.id}::customTexture::${index}`, decalEntry)
		)));
		writer.meshes.push({ name: mesh.id, primitives });
		writer.nodes.push({ name: mesh.id, mesh: writer.meshes.length - 1, matrix: CreateModelMatrix(mesh.transform) });
	});

	const fileName = `${simulatorRuntime.loadedId}.glb`;
	triggerFileDownload(writeGlbBinary(writer), fileName);
	SetElementText("sim-hud-export", `Export: ${fileName}`);
	Log("ENGINE", `simulator exported ${fileName}: ${writer.nodes.length} nodes, ${writer.materials.length} materials`, "log", "Simulator");
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
	if (event.code === "KeyE") {
		Download();
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

export { Start, Load, CacheEntries as Cache, Clear, Exit, Download, IsSimulatorActive, HandleSimulatorInput, UpdateSimulator, GetModelState, GetFullState };
