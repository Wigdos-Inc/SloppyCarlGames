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
import { NormalizeVector3 } from "../math/Vector3.js";
import { CONFIG } from "../core/config.js";
import { Log } from "../core/meta.js";
import {
	LoadEngineVisualTemplates,
	PrepareLevelVisualResources,
} from "./NewTexture.js";

function toNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeWorld(world) {
	const source = world && typeof world === "object" ? world : {};
	return {
		length: Math.max(1, toNumber(source.length, 100)),
		width: Math.max(1, toNumber(source.width, 100)),
		height: Math.max(1, toNumber(source.height, 40)),
		deathBarrierY: toNumber(source.deathBarrierY, -25),
		waterLevel: toNumber(source.waterLevel, -9999),
		textureScale: Math.max(0.05, toNumber(source.textureScale, 1)),
		scatterScale: Math.max(0.05, toNumber(source.scatterScale, 1)),
	};
}

function normalizeCameraConfig(camera) {
	const source = camera && typeof camera === "object" ? camera : {};
	return {
		mode: "stationary",
		levelOpening: {
			startPosition: NormalizeVector3(
				source.levelOpening && source.levelOpening.startPosition,
				{ x: 0, y: 40, z: 80 }
			),
			endPosition: NormalizeVector3(
				source.levelOpening && source.levelOpening.endPosition,
				{ x: 0, y: 40, z: 80 }
			),
		},
		distanceFromPlayer: NormalizeVector3(source.distanceFromPlayer, { x: 0, y: 20, z: 40 }),
	};
}

function resolveEntityBlueprintMap(payload) {
	const map = {};
	const blueprints = payload && payload.entityBlueprints && typeof payload.entityBlueprints === "object"
		? payload.entityBlueprints
		: null;

	if (!blueprints) {
		return map;
	}

	const registerList = (list) => {
		if (!Array.isArray(list)) {
			return;
		}
		list.forEach((entry) => {
			if (entry && entry.id) {
				map[entry.id] = entry;
			}
		});
	};

	registerList(blueprints.enemies);
	registerList(blueprints.npcs);
	registerList(blueprints.collectibles);
	registerList(blueprints.projectiles);

	if (Array.isArray(blueprints.entities)) {
		registerList(blueprints.entities);
	}

	return map;
}

function buildEntityInput(entityDefinition, index, blueprintMap) {
	const source = entityDefinition && typeof entityDefinition === "object" ? entityDefinition : {};
	const merged = source.blueprintId && blueprintMap[source.blueprintId]
		? { ...source, baseBlueprint: blueprintMap[source.blueprintId] }
		: source;

	return {
		...merged,
		id: merged.id || `entity-${index}`,
	};
}

function resolveTriggerColor(triggerType) {
	if (triggerType === "cutscene") {
		return { r: 0.45, g: 0.75, b: 1, a: 0.35 };
	}
	if (triggerType === "dialogue") {
		return { r: 0.4, g: 1, b: 0.65, a: 0.35 };
	}
	if (triggerType === "combat") {
		return { r: 1, g: 0.45, b: 0.45, a: 0.35 };
	}
	return { r: 1, g: 0.85, b: 0.4, a: 0.3 };
}

function buildTriggerMesh(triggerDefinition, world, index) {
	const source = triggerDefinition && typeof triggerDefinition === "object" ? triggerDefinition : {};
	const start = NormalizeVector3(source.start, { x: 0, y: 0, z: 0 });
	const end = NormalizeVector3(source.end, start);
	const center = {
		x: (start.x + end.x) * 0.5,
		y: toNumber(source.y, world.height * 0.5),
		z: (start.z + end.z) * 0.5,
	};

	const size = {
		x: Math.max(1, Math.abs(end.x - start.x)),
		y: Math.max(world.height * 2, 24),
		z: Math.max(1, Math.abs(end.z - start.z)),
	};

	const color = resolveTriggerColor(source.type || "generic");
	return BuildObject(
		{
			id: source.id || `trigger-${index}`,
			primitive: "cube",
			dimensions: size,
			position: center,
			textureID: "default-grid",
			textureColor: color,
			textureOpacity: color.a,
			role: "trigger",
			trigger: {
				type: source.type || "generic",
				payload: source.payload || null,
				activateOnce: source.activateOnce !== false,
			},
		},
		{ role: "trigger" }
	);
}

function buildSceneBoundingBoxes(sceneGraph) {
	const bounds = [];
	const classifyEntityType = (entity) => {
		const type = String(entity && entity.type ? entity.type : "entity").toLowerCase();
		if (type.includes("player")) {
			return { whole: "Player", part: "PlayerPart" };
		}
		if (type.includes("boss")) {
			return { whole: "Boss", part: "BossPart" };
		}
		return { whole: "Entity", part: "EntityPart" };
	};

	const push = (type, id, aabb) => {
		if (!aabb || !aabb.min || !aabb.max) {
			return;
		}
		bounds.push({ type: type, id: id, min: { ...aabb.min }, max: { ...aabb.max } });
	};

	const terrain = Array.isArray(sceneGraph && sceneGraph.terrain) ? sceneGraph.terrain : [];
	terrain.forEach((mesh) => push("Terrain", mesh.id, mesh.worldAabb));

	const scatter = Array.isArray(sceneGraph && sceneGraph.scatter) ? sceneGraph.scatter : [];
	scatter.forEach((mesh) => push("Scatter", mesh.id, mesh.worldAabb));

	// Per-model scatter bounding boxes from instanced batch generation.
	const scatterDebugBounds = Array.isArray(sceneGraph && sceneGraph.scatterDebugBounds)
		? sceneGraph.scatterDebugBounds
		: [];
	scatterDebugBounds.forEach((record) => {
		if (record && record.min && record.max) {
			bounds.push({ type: record.type || "Scatter", id: record.id, min: { ...record.min }, max: { ...record.max } });
		}
	});

	const obstacles = Array.isArray(sceneGraph && sceneGraph.obstacles) ? sceneGraph.obstacles : [];
	obstacles.forEach((obstacle) => {
		push("Obstacle", obstacle.id, obstacle.bounds || null);
		if (Array.isArray(obstacle.parts)) {
			obstacle.parts.forEach((part) => push("Obstacle", part.id, part.worldAabb || null));
		}
	});

	const entities = Array.isArray(sceneGraph && sceneGraph.entities) ? sceneGraph.entities : [];
	entities.forEach((entity) => {
		const category = classifyEntityType(entity);
		push(category.whole, entity.id, entity.collision && entity.collision.aabb ? entity.collision.aabb : null);
		if (entity.model && Array.isArray(entity.model.parts)) {
			entity.model.parts.forEach((part) => push(category.part, `${entity.id}:${part.id}`, part.mesh && part.mesh.worldAabb ? part.mesh.worldAabb : null));
		}
	});

	return bounds;
}

function RefreshSceneBoundingBoxes(sceneGraph) {
	if (!sceneGraph || typeof sceneGraph !== "object") {
		return [];
	}

	sceneGraph.debugBoundingBoxes = buildSceneBoundingBoxes(sceneGraph);
	return sceneGraph.debugBoundingBoxes;
}

async function BuildLevel(payload) {
	const source = payload && typeof payload === "object" ? payload : {};
	const world = normalizeWorld(source.world);
	const terrainDefinitions = source.terrain && Array.isArray(source.terrain.objects)
		? source.terrain.objects
		: [];
	const triggerDefinitions = source.terrain && Array.isArray(source.terrain.triggers)
		? source.terrain.triggers
		: [];
	const obstacleDefinitions = Array.isArray(source.obstacles) ? source.obstacles : [];
	const entityDefinitions = Array.isArray(source.entities) ? source.entities : [];
	const blueprintMap = resolveEntityBlueprintMap(source);
	const scatterMultiplier = GetPerformanceScatterMultiplier();
	const visualTemplateRegistry = await LoadEngineVisualTemplates();
	const scatterBatches = new Map();
	const scatterDebugBounds = [];

	const terrain = terrainDefinitions.map((terrainObject, index) => {
		const terrainMesh = BuildObject(
			{
				...terrainObject,
				id: terrainObject && terrainObject.id ? terrainObject.id : `terrain-${index}`,
				primitive: terrainObject && terrainObject.primitive ? terrainObject.primitive : terrainObject.shape,
				role: "terrain",
				texture: terrainObject && terrainObject.texture
					? terrainObject.texture
					: {
						textureID: terrainObject && terrainObject.textureID ? terrainObject.textureID : "grass-soft",
						color: terrainObject && terrainObject.textureColor ? terrainObject.textureColor : { r: 1, g: 1, b: 1, a: 1 },
						opacity: terrainObject && typeof terrainObject.textureOpacity === "number" ? terrainObject.textureOpacity : 1,
					},
			},
			{
				role: "terrain",
				defaultColor: { r: 0.28, g: 0.58, b: 0.42, a: 1 },
				textureID: "grass-soft",
			}
		);

		// Generate scatter batches for this terrain object.
		const scatterRequests = terrainMesh.detail && Array.isArray(terrainMesh.detail.scatter)
			? terrainMesh.detail.scatter
			: [];
		if (scatterRequests.length > 0) {
			BuildScatterBatches({
				objectMesh: terrainMesh,
				scatterDefinitions: visualTemplateRegistry,
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
		const obstacleMesh = record.mesh || record;
		const scatterRequests = obstacleMesh.detail && Array.isArray(obstacleMesh.detail.scatter)
			? obstacleMesh.detail.scatter
			: [];
		if (scatterRequests.length > 0) {
			BuildScatterBatches({
				objectMesh: obstacleMesh,
				scatterDefinitions: visualTemplateRegistry,
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

	const entities = entityDefinitions.map((entity, index) =>
		BuildEntity(buildEntityInput(entity, index, blueprintMap))
	);
	if (entities.length > 0) {
		Log("ENGINE", `Entity group created: count=${entities.length}`, "log", "Level");
	}

	const sceneGraph = {
		world: world,
		terrain: terrain,
		obstacles: obstacleRecords,
		entities: entities,
		triggers: triggers,
		scatter: [],
		scatterBatches: scatterBatches,
		scatterDebugBounds: scatterDebugBounds,
		debug: {
			showTriggerVolumes: CONFIG && CONFIG.DEBUG && CONFIG.DEBUG.ALL === true && CONFIG.DEBUG.LEVELS && CONFIG.DEBUG.LEVELS.Triggers === true,
		},
		effects: {
			underwater: {
				enabled: false,
				particleHook: null,
			},
		},
		cameraConfig: normalizeCameraConfig(source.camera),
		meta: source.meta || {},
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