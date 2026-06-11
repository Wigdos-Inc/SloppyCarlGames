// Creates the Level's World by creating Terrain, Background, and placing Obstacles, Triggers and Entities
// Can also be used to create Boss Arenas

// Used by handlers/game/Level.js
// Uses NewEntity.js for building Enemies
// Uses NewObstacle.js for static obstacles
// Uses NewObject.js for terrain generation.

import { BuildObject } from "./NewObject.js";
import { BuildEntity } from "./NewEntity.js";
import { BuildObstacles } from "./NewObstacle.js";
import { GetPerformanceScatterMultiplier, BuildScatterBatches, BuildScatterVisualResources } from "./NewScatter.js";
import { CONFIG } from "../core/config.js";
import { Log } from "../core/meta.js";
import { Clamp, UnitVector3 } from "../math/Utilities.js";
import { ToVector3 } from "../math/Vector3.js";

function resolveEntityBlueprintMap(payload) {
	const map = {};
	const blueprints = payload.entityBlueprints;

	const registerList = (list) => list.forEach((entry) => map[entry.id] = entry);

	registerList(blueprints.enemies);
	registerList(blueprints.npcs);
	registerList(blueprints.collectibles);
	registerList(blueprints.projectiles);
	registerList(blueprints.entities);

	return map;
}

function buildEntityInput(source, blueprintMap) {
	const merged = source.blueprintId ? { ...source, baseBlueprint: blueprintMap[source.blueprintId] } : source;
	return {
		...merged,
		id: merged.id,
	};
}

function resolveTriggerColor(triggerType) {
	switch (triggerType) {
		case "cutscene": return { r: 0.45, g: 0.75, b: 1, a: 0.35 };
		case "dialogue": return { r: 0.4, g: 1, b: 0.65, a: 0.35 };
		case "combat"  : return { r: 1, g: 0.45, b: 0.45, a: 0.35 };
		default        : return { r: 1, g: 0.85, b: 0.4, a: 0.3 };
	}
}

function buildTriggerMesh(triggerDefinition, world, index) {
	const triggerHeight = world.height.value - triggerDefinition.start.y;
	const color = resolveTriggerColor(triggerDefinition.type);
	return BuildObject(
		{
			id              : triggerDefinition.id,
			shape           : "cube",
			complexity      : "medium",
			dimensions      : new UnitVector3(
				Math.max(1, Math.abs(triggerDefinition.end.x - triggerDefinition.start.x)),
				triggerHeight,
				Math.max(1, Math.abs(triggerDefinition.end.z - triggerDefinition.start.z)),
				"cnu"
			),
			position        : new UnitVector3(
				triggerDefinition.start.x + triggerDefinition.end.x,
				triggerDefinition.start.y + triggerHeight,
				triggerDefinition.start.z + triggerDefinition.end.z,
				"cnu"
			).scale(0.5),
			rotation        : new UnitVector3(0, 0, 0, "radians"),
			scale           : ToVector3(1),
			pivot           : new UnitVector3(0, 0, 0, "cnu"),
			primitiveOptions: {},
			texture: {
				textureID        : "default-grid",
				baseTextureID    : "default-grid",
				materialTextureID: "default-grid",
				shape            : null,
				color            : color,
				opacity          : color.a,
				density          : 1,
				speckSize        : 1,
				animated         : false,
				holdTimeSpeed    : 1,
				blendTimeSpeed   : 1,
			},
			detail         : { scatter: [] },
			role           : "trigger",
			collisionShape : "none",
			customTextures : [],
			trigger        : {
				type        : triggerDefinition.type,
				payload     : triggerDefinition.payload,
				activateOnce: triggerDefinition.activateOnce,
			}
		}
	);
}

function buildWaterVisualMeshes(world) {
	if (!world.waterLevel) return null;

	const centerX     = world.length.value * 0.5;
	const centerZ     = world.width.value * 0.5;
	const waterBottom = Clamp(world.waterLevel.value - 0.1, 0, world.deathBarrierY.value);
	const waterHeight = Math.max(0.1, world.waterLevel.value - waterBottom);

	const body = BuildObject(
		{
			id              : `water-body-${world.length.value}-${world.width.value}-${waterBottom}-${world.waterLevel.value}`,
			shape           : "cube",
			complexity      : "medium",
			dimensions      : new UnitVector3(world.length.value, waterHeight, world.width.value, "cnu"),
			position        : new UnitVector3(centerX, waterBottom + waterHeight * 0.5, centerZ, "cnu"),
			rotation        : new UnitVector3(0, 0, 0, "radians"),
			scale           : ToVector3(1),
			pivot           : new UnitVector3(0, 0, 0, "cnu"),
			primitiveOptions: {},
			texture         : {
				textureID        : "default-grid",
				baseTextureID    : "default-grid",
				materialTextureID: "default-grid",
				shape            : null,
				color            : { r: 0.1, g: 0.28, b: 0.44, a: 1 },
				opacity          : 0.2,
				density          : 1,
				speckSize        : 1,
				animated         : false,
				holdTimeSpeed    : 1,
				blendTimeSpeed   : 1,
			},
			detail         : { scatter: [] },
			role           : "water",
			collisionShape : "none",
			customTextures : [],
		}
	);

	const top = BuildObject(
		{
			id: `water-top-${world.length.value}-${world.width.value}-${world.waterLevel.value}`,
			shape: "plane", complexity: "medium",
			dimensions      : new UnitVector3(world.length.value, 1, world.width.value, "cnu"),
			position        : new UnitVector3( centerX, world.waterLevel.value + 0.02, centerZ, "cnu"),
			rotation        : new UnitVector3(0, 0, 0, "radians"),
			scale           : ToVector3(1),
			pivot           : new UnitVector3(0, 0, 0, "cnu"),
			primitiveOptions: {},
			texture         : {
				textureID: "sea-surface", baseTextureID: "sea-surface", materialTextureID: "sea-surface", shape: "square",
				color: { r: 0.38, g: 0.62, b: 0.85, a: 1 },
				opacity: 0.35, density: 1, speckSize: 2, animated: true, holdTimeSpeed: 1, blendTimeSpeed: 1,
			},
			detail: { scatter: [] }, role: "water", collisionShape: "none", customTextures: [],
		}
	);

	return { body, top };
}

function buildSurfaceMap(terrainDefinitions, obstacleDefinitions) {
	const map = {};
	const addSurface = (def) => {
		map[def.id] = {
			position  : def.position,
			dimensions: def.dimensions,
			scale     : def.scale,
			topY      : def.position.y + (def.dimensions.y * def.scale.y * 0.5),
		};
	};
	terrainDefinitions.forEach(addSurface);
	obstacleDefinitions.forEach(addSurface);
	return map;
}

function buildSceneBoundingBoxes(sceneGraph) {
	const bounds = [];
	const classifyEntityType = (entity) => {
		if (entity.type.includes("player")) return { whole: "Player", part: "PlayerPart" };
		if (entity.type.includes("boss")) return { whole: "Boss", part: "BossPart" };
		return { whole: "Entity", part: "EntityPart" };
	};

	const push = (type, id, aabb) => bounds.push({ 
		type: type, 
		id  : id, 
		min : aabb.min, 
		max : aabb.max 
	});

	sceneGraph.terrain.forEach((mesh) => push("Terrain", mesh.id, mesh.worldAabb));
	sceneGraph.scatter.forEach((mesh) => push("Scatter", mesh.id, mesh.worldAabb));

	// Per-model scatter bounding boxes from instanced batch generation.
	sceneGraph.debug.scatterBounds.forEach(({ type, id, min, max }) => bounds.push({ type, id, min, max }));

	sceneGraph.obstacles.forEach((obstacle) => {
		push("Obstacle", obstacle.id, obstacle.bounds);
		obstacle.parts.forEach((part) => push("Obstacle", part.id, part.worldAabb));
	});

	sceneGraph.entities.forEach((entity) => {
		const category = classifyEntityType(entity);
		if (entity.type === "player") push(category.whole, entity.id, entity.collision.profile.modelAabb);
		else push(category.whole, entity.id, entity.collision.aabb);
		entity.model.parts.forEach((part) => push(category.part, `${entity.id}:${part.id}`, part.mesh.worldAabb));
	});

	return bounds;
}

function buildSceneDetailedBounds(sceneGraph) {
	const detailed = [];
	const classifyEntityType = (entity) => {
		const type = entity.type;
		if (type.includes("player")) return "Player";
		if (type.includes("boss")) return "Boss";
		return "Entity";
	};

	const push = (type, id, bounds) => {
		if (!bounds) return;
		detailed.push({ type: type, id: id, bounds: bounds });
	};

	sceneGraph.terrain.forEach((mesh) => push("Terrain", mesh.id, mesh.detailedBounds));
	sceneGraph.obstacles.forEach((obstacle) => push("Obstacle", obstacle.id, obstacle.detailedBounds));

	sceneGraph.entities.forEach((entity) => {
		const category = classifyEntityType(entity);
		if (entity.collision.physics.bounds.type === "capsule") {
			push(category, entity.id, {
				type        : "capsule",
				radius      : entity.collision.physics.bounds.radius,
				halfHeight  : entity.collision.physics.bounds.halfHeight,
				segmentStart: entity.collision.physics.bounds.segmentStart,
				segmentEnd  : entity.collision.physics.bounds.segmentEnd,
			});

			return;
		}

		push(category, entity.id, entity.collision.physics.bounds);
	});

	return detailed;
}

function RefreshSceneBoundingBoxes(sceneGraph) {
	sceneGraph.debugBoundingBoxes = buildSceneBoundingBoxes(sceneGraph);
	sceneGraph.debug.detailedBounds = buildSceneDetailedBounds(sceneGraph);
	return sceneGraph.debugBoundingBoxes;
}

async function BuildLevel(payload) {
	const scatterBatches      = new Map();
	const scatterDebugBounds  = [];
	const enqueueScatterBatches = (objectMesh, indexSeed) => {
		if (objectMesh.detail.scatter.length === 0) return;
		BuildScatterBatches({
			objectMesh, indexSeed, 
			scatterMultiplier   : GetPerformanceScatterMultiplier(),
			world               : payload.world,
			explicitScatter     : objectMesh.detail.scatter,
			batchMap            : scatterBatches,
			debugBboxAccumulator: scatterDebugBounds,
		});
	};

	const terrain = payload.terrain.objects.map((terrainObject, index) => {
		terrainObject.position.y += terrainObject.dimensions.y * terrainObject.scale.y * 0.5;

		const terrainMesh = BuildObject(
			{
				...terrainObject,
				id            : terrainObject.id,
				role          : "terrain",
				collisionShape: terrainObject.collisionShape,
				customTextures: terrainObject.customTextures,
			}
		);

		enqueueScatterBatches(terrainMesh, index + 1);

		return terrainMesh;
	});
	if (terrain.length > 0) Log("ENGINE", `Terrain object group created: count=${terrain.length}`, "log", "Level");

	const obstacleRecords = BuildObstacles(payload.obstacles, {});

	// Generate scatter batches for obstacles that have scatter.
	obstacleRecords.forEach((record, index) => enqueueScatterBatches(record.mesh, payload.terrain.objects.length + index + 1));

	let totalBatchInstances = 0;
	scatterBatches.forEach((batch) => { totalBatchInstances += batch.instanceCount; });
	if (totalBatchInstances > 0) {
		Log(
			"ENGINE",
			`Scatter batches: ${scatterBatches.size} batch key(s), ${totalBatchInstances} total instance(s)`,
			"log",
			"Level"
		);
	}

	const triggers = payload.terrain.triggers.map((triggerDefinition, index) => {
		return buildTriggerMesh(triggerDefinition, payload.world, index);
	});
	if (triggers.length > 0) Log("ENGINE", `Trigger group created: count=${triggers.length}`, "log", "Level");

	const surfaceMap = buildSurfaceMap(payload.terrain.objects, payload.obstacles);

	const entities = payload.entities.map((entity) => {
		return BuildEntity(buildEntityInput(entity, resolveEntityBlueprintMap(payload)), surfaceMap);
	});
	if (entities.length > 0) Log("ENGINE", `Entity group created: count=${entities.length}`, "log", "Level");

	const sceneGraph = {
		world: payload.world, 
		terrain, entities, triggers, scatter: [], scatterBatches, 
		obstacles               : obstacleRecords,
		waterVisual             : buildWaterVisualMeshes(payload.world),
		scatterPrimitiveGeometry: BuildScatterVisualResources(scatterBatches),
		debug                   : {
			showTriggerVolumes: !!(CONFIG.DEBUG.ALL === true && CONFIG.DEBUG.LEVELS.Triggers === true),
			detailedBounds    : [],
			scatterBounds     : scatterDebugBounds,
		},
		effects: {
			underwater: {
				enabled     : false,
				particleHook: null,
			},
		},
		cameraConfig: payload.camera,
		playerConfig: payload.player,
		meta        : payload.meta,
	};

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