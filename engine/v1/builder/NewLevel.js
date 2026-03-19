// Creates the Level's World by creating Terrain, Background, and placing Obstacles, Triggers and Entities
// Can also be used to create Boss Arenas

// Used by handlers/game/Level.js
// Uses NewEntity.js for building Enemies
// Uses NewObstacle.js for static obstacles
// Uses NewObject.js for terrain generation.

import { BuildObject } from "./NewObject.js";
import { BuildEntity } from "./NewEntity.js";
import { BuildObstacles } from "./NewObstacle.js";
import { GetPerformanceScatterMultiplier, BuildScatterBatches } from "./NewScatter.js";
import { CONFIG } from "../core/config.js";
import { Log } from "../core/meta.js";
import { Unit, UnitVector3 } from "../math/Utilities.js";
import { PrepareLevelVisualResources } from "./NewTexture.js";

function resolveEntityBlueprintMap(payload) {
	const map = {};
	const blueprints = payload.entityBlueprints;

	const registerList = (list) => {
		list.forEach((entry) => map[entry.id] = entry);
	};

	registerList(blueprints.enemies);
	registerList(blueprints.npcs);
	registerList(blueprints.collectibles);
	registerList(blueprints.projectiles);
	registerList(blueprints.entities);

	return map;
}

function buildEntityInput(entityDefinition, index, blueprintMap) {
	const source = entityDefinition;
	const merged = source.blueprintId
		? { ...source, baseBlueprint: blueprintMap[source.blueprintId] }
		: source;

	return {
		...merged,
		id: merged.id,
	};
}

function resolveTriggerColor(triggerType) {
	if (triggerType === "cutscene") return { r: 0.45, g: 0.75, b: 1, a: 0.35 };
	if (triggerType === "dialogue") return { r: 0.4, g: 1, b: 0.65, a: 0.35 };
	if (triggerType === "combat") return { r: 1, g: 0.45, b: 0.45, a: 0.35 };
	// Future Additions: Checkpoint, Custom
	return { r: 1, g: 0.85, b: 0.4, a: 0.3 };
}

function buildTriggerMesh(triggerDefinition, world, index) {
	const source = triggerDefinition;
	const start = source.start;
	const end = source.end;
	const triggerY = start.y;
	const triggerHeight = world.height.value - triggerY;
	const center = new UnitVector3(
		(start.x + end.x) * 0.5,
		triggerY + triggerHeight * 0.5,
		(start.z + end.z) * 0.5,
		"cnu"
	);

	const size = new UnitVector3(
		Math.max(1, Math.abs(end.x - start.x)),
		triggerHeight,
		Math.max(1, Math.abs(end.z - start.z)),
		"cnu"
	);

	const color = resolveTriggerColor(source.type);
	return BuildObject(
		{
			id: source.id,
			shape: "cube",
			complexity: "medium",
			dimensions: size,
			position: center,
			rotation: new UnitVector3(0, 0, 0, "radians"),
			scale: { x: 1, y: 1, z: 1 },
			pivot: new UnitVector3(0, 0, 0, "cnu"),
			primitiveOptions: {},
			texture: {
				textureID: "default-grid",
				baseTextureID: "default-grid",
				materialTextureID: "default-grid",
				shape: null,
				color: color,
				opacity: color.a,
				density: 1,
			},
			detail: { scatter: [] },
			role: "trigger",
			trigger: {
				type: source.type,
				payload: source.payload,
				activateOnce: source.activateOnce,
			},
		},
		{ role: "trigger" }
	);
}

function buildWaterVisualMeshes(world) {
	if (!world.waterLevel) return null;

	const waterLength = Math.max(1, world.length.value);
	const waterWidth = Math.max(1, world.width.value);
	const centerX = waterLength * 0.5;
	const centerZ = waterWidth * 0.5;
	const waterLevel = world.waterLevel.value;
	const worldBottom = world.deathBarrierY.value;
	const waterBottom = Math.max(0, Math.min(worldBottom, waterLevel - 0.1));
	const waterHeight = Math.max(0.1, waterLevel - waterBottom);

	const body = BuildObject(
		{
			id: `water-body-${waterLength}-${waterWidth}-${waterBottom}-${waterLevel}`,
			shape: "cube",
			complexity: "medium",
			dimensions: new UnitVector3( waterLength, waterHeight, waterWidth, "cnu"),
			position: new UnitVector3(centerX, waterBottom + waterHeight * 0.5, centerZ, "cnu"),
			rotation: new UnitVector3(0, 0, 0, "radians"),
			scale: { x: 1, y: 1, z: 1 },
			pivot: new UnitVector3(0, 0, 0, "cnu"),
			primitiveOptions: {},
			texture: {
				textureID: "default-grid",
				baseTextureID: "default-grid",
				materialTextureID: "default-grid",
				shape: null,
				color: { r: 0.1, g: 0.28, b: 0.44, a: 1 },
				opacity: 0.2,
				density: 1,
			},
			detail: { scatter: [] },
			role: "water",
		},
		{ role: "water" }
	);

	const top = BuildObject(
		{
			id: `water-top-${waterLength}-${waterWidth}-${waterLevel}`,
			shape: "plane",
			complexity: "medium",
			dimensions: new UnitVector3(waterLength, 1, waterWidth, "cnu"),
			position: new UnitVector3( centerX, waterLevel + 0.02, centerZ, "cnu"),
			rotation: new UnitVector3(0, 0, 0, "radians"),
			scale: { x: 1, y: 1, z: 1 },
			pivot: new UnitVector3(0, 0, 0, "cnu"),
			primitiveOptions: {},
			texture: {
				textureID: "default-grid",
				baseTextureID: "default-grid",
				materialTextureID: "default-grid",
				shape: null,
				color: { r: 0.38, g: 0.62, b: 0.85, a: 1 },
				opacity: 0.35,
				density: 1,
			},
			detail: { scatter: [] },
			role: "water",
		},
		{ role: "water" }
	);

	return {
		body: body,
		top: top,
	};
}

function buildSurfaceMap(terrainDefinitions, obstacleDefinitions) {
	const map = {};
	const addSurface = (def) => {
		map[def.id] = {
			position: def.position,
			dimensions: def.dimensions,
			scale: def.scale,
			topY: def.position.y + (def.dimensions.y * def.scale.y * 0.5),
		};
	};
	terrainDefinitions.forEach(addSurface);
	obstacleDefinitions.forEach(addSurface);
	return map;
}

function buildSceneBoundingBoxes(sceneGraph) {
	const bounds = [];
	const classifyEntityType = (entity) => {
		const type = String(entity.type).toLowerCase();
		if (type.includes("player")) {
			return { whole: "Player", part: "PlayerPart" };
		}
		if (type.includes("boss")) {
			return { whole: "Boss", part: "BossPart" };
		}
		return { whole: "Entity", part: "EntityPart" };
	};

	const push = (type, id, aabb) => {
		bounds.push({ type: type, id: id, min: { ...aabb.min }, max: { ...aabb.max } });
	};

	const terrain = sceneGraph.terrain;
	terrain.forEach((mesh) => push("Terrain", mesh.id, mesh.worldAabb));

	const scatter = sceneGraph.scatter;
	scatter.forEach((mesh) => push("Scatter", mesh.id, mesh.worldAabb));

	// Per-model scatter bounding boxes from instanced batch generation.
	const scatterDebugBounds = sceneGraph.scatterDebugBounds ?? [];
	scatterDebugBounds.forEach((record) => {
		bounds.push({ type: record.type || "Scatter", id: record.id, min: { ...record.min }, max: { ...record.max } });
	});

	const obstacles = sceneGraph.obstacles;
	obstacles.forEach((obstacle) => {
		push("Obstacle", obstacle.id, obstacle.bounds);
		obstacle.parts.forEach((part) => push("Obstacle", part.id, part.worldAabb));
	});

	const entities = sceneGraph.entities;
	entities.forEach((entity) => {
		const category = classifyEntityType(entity);
		push(category.whole, entity.id, entity.collision.aabb);
		entity.model.parts.forEach((part) => push(category.part, `${entity.id}:${part.id}`, part.mesh.worldAabb));
	});

	return bounds;
}

function RefreshSceneBoundingBoxes(sceneGraph) {
	sceneGraph.debugBoundingBoxes = buildSceneBoundingBoxes(sceneGraph);
	return sceneGraph.debugBoundingBoxes;
}

async function BuildLevel(payload) {
	const source = payload;
	const world = source.world;
	const terrainDefinitions = source.terrain.objects;
	const triggerDefinitions = source.terrain.triggers;
	const obstacleDefinitions = source.obstacles;
	const entityDefinitions = source.entities;
	const blueprintMap = resolveEntityBlueprintMap(source);
	const scatterMultiplier = GetPerformanceScatterMultiplier();
	const scatterBatches = new Map();
	const scatterDebugBounds = [];

	const terrain = terrainDefinitions.map((terrainObject, index) => {
		terrainObject.position.y += terrainObject.dimensions.y * terrainObject.scale.y * 0.5;

		const terrainMesh = BuildObject(
			{
				...terrainObject,
				id: terrainObject.id,
				role: "terrain",
			},
			{
				role: "terrain",
			}
		);

		// Generate scatter batches for this terrain object.
		const scatterRequests = terrainMesh.detail.scatter;
		if (scatterRequests.length > 0) {
			BuildScatterBatches({
				objectMesh: terrainMesh,
				scatterMultiplier: scatterMultiplier,
				world: world,
				indexSeed: index + 1,
				explicitScatter: scatterRequests,
				batchMap: scatterBatches,
				debugBboxAccumulator: scatterDebugBounds,
			});
		}

		return terrainMesh;
	});
	if (terrain.length > 0) {
		Log("ENGINE", `Terrain object group created: count=${terrain.length}`, "log", "Level");
	}

	const obstacleRecords = BuildObstacles(obstacleDefinitions, {});
	const obstacles = obstacleRecords.map((record) => record.mesh);

	// Generate scatter batches for obstacles that have scatter.
	obstacleRecords.forEach((record, index) => {
		const obstacleMesh = record.mesh;
		const scatterRequests = obstacleMesh.detail.scatter;
		if (scatterRequests.length > 0) {
			BuildScatterBatches({
				objectMesh: obstacleMesh,
				scatterMultiplier: scatterMultiplier,
				world: world,
				indexSeed: (terrainDefinitions.length + index + 1),
				explicitScatter: scatterRequests,
				batchMap: scatterBatches,
				debugBboxAccumulator: scatterDebugBounds,
			});
		}
	});

	let totalBatchInstances = 0;
	scatterBatches.forEach((batch) => { totalBatchInstances += batch.instances.length; });
	if (totalBatchInstances > 0) {
		Log(
			"ENGINE",
			`Scatter batches: ${scatterBatches.size} batch key(s), ${totalBatchInstances} total instance(s)`,
			"log",
			"Level"
		);
	}

	const triggers = triggerDefinitions.map((triggerDefinition, index) =>
		buildTriggerMesh(triggerDefinition, world, index)
	);
	if (triggers.length > 0) {
		Log("ENGINE", `Trigger group created: count=${triggers.length}`, "log", "Level");
	}

	const surfaceMap = buildSurfaceMap(terrainDefinitions, obstacleDefinitions);

	const entities = entityDefinitions.map((entity, index) =>
		BuildEntity(buildEntityInput(entity, index, blueprintMap), surfaceMap)
	);
	if (entities.length > 0) {
		Log("ENGINE", `Entity group created: count=${entities.length}`, "log", "Level");
	}

	const sceneGraph = {
		world: world,
		waterVisual: buildWaterVisualMeshes(world),
		terrain: terrain,
		obstacles: obstacleRecords,
		entities: entities,
		triggers: triggers,
		scatter: [],
		scatterBatches: scatterBatches,
		scatterDebugBounds: scatterDebugBounds,
		debug: {
			showTriggerVolumes: !!(CONFIG.DEBUG.ALL === true && CONFIG.DEBUG.LEVELS.Triggers === true),
		},
		effects: {
			underwater: {
				enabled: false,
				particleHook: null,
			},
		},
		cameraConfig: source.camera,
		playerConfig: source.player,
		meta: source.meta,
	};

	await PrepareLevelVisualResources(sceneGraph);
	RefreshSceneBoundingBoxes(sceneGraph);
	Log(
		"ENGINE",
		`Level generation complete: terrain=${terrain.length}, obstacles=${obstacleRecords.length}, entities=${entities.length}, triggers=${triggers.length}, scatterBatches=${scatterBatches.size}, scatterInstances=${totalBatchInstances}`,
		"log",
		"Level"
	);
	return sceneGraph;
}

export { BuildLevel, RefreshSceneBoundingBoxes };