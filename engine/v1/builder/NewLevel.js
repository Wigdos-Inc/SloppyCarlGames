// Builds a level's world: terrain, water, obstacles, voids, scatter, triggers, entities and particles.
// Can also be used to create Boss Arenas

// Used by handlers/game/Level.js
// Uses NewTerrain.js and NewObject.js for terrain, water and trigger meshes.
// Uses NewObstacle.js for static obstacles.
// Uses NewVoid.js for void walls.
// Uses NewScatter.js for scatter batches.
// Uses NewEntity.js for level entities.
// Uses NewParticles.js for level-authored particle generators.
// Uses NewTemplate.js to resolve template refs.
// Uses templates/Instance.js to register the level's game templates.
// Uses subProcesses/Chunks.js to group touching terrain into chunks.
// Uses subProcesses/Occlusion.js for terrain blockers.
// Uses subProcesses/Loops.js to find loop surfaces.

import { BuildObject } from "./NewObject.js";
import { RegisterGameTemplates } from "./templates/Instance.js";
import { BuildEntity } from "./NewEntity.js";
import { GenerateParticles, ParticleGeneratorRequests } from "./NewParticles.js";
import { BuildObstacles } from "./NewObstacle.js";
import { BuildTerrain } from "./NewTerrain.js";
import { ResolveObjectSource } from "./NewTemplate.js";
import { BuildScatterBatches, BuildScatterVisualResources } from "./NewScatter.js";
import { BuildVoidWalls } from "./NewVoid.js";
import { AssembleTerrainChunks } from "./subProcesses/Chunks.js";
import { FindLoops } from "./subProcesses/Loops.js";
import { BuildOccluders } from "./subProcesses/Occlusion.js";
import { CONFIG, PERFORMANCE_SCALING } from "../core/config.js";
import { Log } from "../core/meta.js";
import { Clamp, UnitVector3 } from "../math/Utilities.js";
import { ToVector3 } from "../math/Vector3.js";

// Blueprints by id, across every blueprint category.
function resolveEntityBlueprintMap(payload) {
	const map = {};
	["enemies", "npcs", "collectibles", "projectiles", "entities"].forEach(key => {
		payload.entityBlueprints[key].forEach((entry) => map[entry.id] = entry)
	});

	return map;
}

// Attach the entity's blueprint when it names one.
function buildEntityInput(source, blueprintMap) {
	const merged = source.blueprintId ? { ...source, baseBlueprint: blueprintMap[source.blueprintId] } : source;
	return {
		...merged,
		id: merged.id,
	};
}

// Debug colour per trigger type.
function resolveTriggerColor(triggerType) {
	switch (triggerType) {
		case "cutscene": return { r: 0.45, g: 0.75, b: 1.00, a: 0.35 };
		case "dialogue": return { r: 0.40, g: 1.00, b: 0.65, a: 0.35 };
		case "combat"  : return { r: 1.00, g: 0.45, b: 0.45, a: 0.35 };
		default        : return { r: 1.00, g: 0.85, b: 0.40, a: 0.35 };
	}
}

function buildTriggerMesh(triggerDefinition, world) {
	const { id, start, end, type, payload, activateOnce } = triggerDefinition;

	// Build a trigger volume over the authored footprint, from its start height up to the world ceiling.
	const triggerHeight = world.height.value - start.y;
	const position = start.clone().add(end).scale(0.5); 
	position.y = start.y + triggerHeight * 0.5;

	const { mesh } = BuildObject(
		{
			id,
			shape           : "cube",
			complexity      : "medium",
			dimensions      : new UnitVector3(
				Math.max(1, Math.abs(end.x - start.x)),
				triggerHeight,
				Math.max(1, Math.abs(end.z - start.z)),
				"cnu"
			),
			position,
			rotation        : new UnitVector3(0, 0, 0, "radians"),
			scale           : ToVector3(1),
			pivot           : new UnitVector3(0, 0, 0, "cnu"),
			primitiveOptions: {},
			texture: {
				generated: {
					id            : "default-tiles",
					shape         : null,
					compositeMode : null,
					primary       : resolveTriggerColor(type),
					secondary     : null,
					density       : 1,
					speckSize     : 1,
					animated      : false,
					holdTimeSpeed : 1,
					blendTimeSpeed: 1,
				},
				custom: [],
			},
			detail         : { scatter: [] },
			role           : "trigger",
			collisionShape : "none",
			trigger        : { type, payload, activateOnce }
		}
	);
	return mesh;
}

// Build the world-wide water body and its animated top surface.
function buildWaterVisualMeshes(world, faceTextureStore) {
	// Levels without a water level don't have water. Shocking, I know.
	if (!world.water.level) return null;

	const centerX     = world.length.value * 0.5;
	const centerZ     = world.width.value * 0.5;
	const waterBottom = Clamp(world.water.level.value - 0.1, 0, world.deathBarrierY.value);
	const waterHeight = Math.max(0.1, world.water.level.value - waterBottom);

	const { mesh: body } = BuildObject(
		{
			id              : `water-body-${world.length.value}-${world.width.value}-${waterBottom}-${world.water.level.value}`,
			shape           : "cube",
			complexity      : "medium",
			dimensions      : new UnitVector3(world.length.value, waterHeight, world.width.value, "cnu"),
			position        : new UnitVector3(centerX, waterBottom + waterHeight * 0.5, centerZ, "cnu"),
			rotation        : new UnitVector3(0, 0, 0, "radians"),
			scale           : ToVector3(1),
			pivot           : new UnitVector3(0, 0, 0, "cnu"),
			primitiveOptions: {},
			texture         : {
				generated: {
					id            : "underwater", 
					shape         : null, 
					compositeMode : null,
					primary       : null, 
					secondary     : null,
					density       : 1, 
					speckSize     : 1,
					animated      : false, 
					holdTimeSpeed : 1, 
					blendTimeSpeed: 1,
				},
				custom: [],
			},
			detail         : { scatter: [] },
			role           : "water",
			collisionShape : "none",
			textureScale   : world.textureScale,
			faceTextureStore,
		}
	);

	const { mesh: top } = BuildObject(
		{
			id              : `water-top-${world.length.value}-${world.width.value}-${world.water.level.value}`,
			shape           : "plane", 
			complexity      : "",
			dimensions      : new UnitVector3(world.length.value, world.width.value, 0, "cnu"),
			position        : new UnitVector3(centerX, world.water.level.value + 0.02, centerZ, "cnu"), // Sit just above the body to avoid flicker.
			rotation        : new UnitVector3(-90, 0, 0, "degrees").toRadians(true),                     // Lay the upright plane flat, facing up.
			scale           : ToVector3(1),
			pivot           : new UnitVector3(0, 0, 0, "cnu"),
			primitiveOptions: { crossed: false, sprite: null },
			texture         : {
				generated: {
					id            : "sea-surface", 
					shape         : null, 
					compositeMode : null,
					primary       : null, 
					secondary     : null,
					density       : 4, 
					speckSize     : 2,
					animated      : true, 
					holdTimeSpeed : 1, 
					blendTimeSpeed: 1,
				},
				custom: [],
			},
			detail        : { scatter: [] }, 
			role          : "water", 
			collisionShape: "none",
			textureScale  : world.textureScale,
			faceTextureStore,
		}
	);

	return { body, top };
}

// Collect spawn surfaces by id. topY determines where models are anchored to.
function buildSurfaceMap(terrainDefinitions, obstacleDefinitions) {
	const map = {};
	const addSurface = (def) => {
		const { position, dimensions, scale } = def;
		map[def.id] = {
			position, dimensions, scale,
			topY: def.position.y + (def.dimensions.y * def.scale.y * 0.5),
		};
	};
	terrainDefinitions.forEach(addSurface);
	obstacleDefinitions.forEach(addSurface);
	return map;
}

// Build debug bounding boxes for every scene object.
function buildDebugBoundingBoxes(sceneGraph) {
	const bounds = [];
	const classifyEntityType = (entity) => {
		if (entity.type.includes("player"))   return { whole: "Player",   part: "PlayerPart" };
		if (entity.type.includes("boss"))     return { whole: "Boss",     part: "BossPart" };
		if (entity.type.includes("particle")) return { whole: "Particle", part: "ParticlePart" };
		return { whole: "Entity", part: "EntityPart" };
	};

	const push = (type, id, aabb) => bounds.push({ 
		type, id, 
		min : aabb.min, 
		max : aabb.max 
	});

	sceneGraph.terrain.forEach((mesh) => push("Terrain", mesh.id, mesh.worldAabb));
	sceneGraph.scatter.forEach((mesh) => push("Scatter", mesh.id, mesh.worldAabb));

	// Scatter boxes come per model from batch generation.
	sceneGraph.debug.scatterBounds.forEach(({ type, id, min, max }) => bounds.push({ type, id, min, max }));

	sceneGraph.obstacles.forEach((obstacle) => {
		push("Obstacle", obstacle.id, obstacle.worldAabb);
		obstacle.parts.forEach((part) => push("Obstacle", part.id, part.worldAabb));
	});

	sceneGraph.voids.terrain.forEach((mesh) => push("Void", mesh.id, mesh.worldAabb));
	sceneGraph.voids.obstacles.forEach((obstacle) => {
		push("Void", obstacle.id, obstacle.worldAabb);
		obstacle.parts.forEach((part) => push("Void", part.id, part.worldAabb));
	});

	sceneGraph.entities.forEach((entity) => {
		const category = classifyEntityType(entity);
		if (entity.collision !== null) push(category.whole, entity.id, entity.collision.aabb);
		entity.model.parts.forEach((part) => push(category.part, `${entity.id}:${part.id}`, part.mesh.worldAabb));
	});

	return bounds;
}

// Build debug wireframes of each object's exact collision shape.
function buildDebugDetailedBounds(sceneGraph) {
	const detailed = [];
	const classifyEntityType = (entity) => {
		if (entity.type.includes("player")) return "Player";
		if (entity.type.includes("boss")) return "Boss";
		if (entity.type.includes("particle")) return "Particle";
		return "Entity";
	};

	// `toggle` references a debug flag. `type` references a wireframe color.
	const push = (type, id, bounds, toggle = type) => {
		if (!bounds) return;
		detailed.push({ type: type, id: id, bounds: bounds, toggle: toggle });
	};

	// Push a void's volume, walls and open faces, all under the Void flag.
	const pushVoid = (entry) => {
		push("Void", entry.id, entry.detailedBounds);
		for (const hostId in entry.relations) {
			const relation = entry.relations[hostId];
			relation.voidWallMeshes.forEach((wall) => {
				push("VoidWall", `${wall.id}|floor`, wall.floorBounds, "Void");
				push("VoidWall", `${wall.id}|wall`, wall.wallBounds, "Void");
			});
			if (relation.openFaces.length === 0) continue;
			push("VoidOpenFace", `${entry.id}|${hostId}|open`, { type: "triangle-soup", triangles: relation.openFaces }, "Void");
		}
	};

	sceneGraph.terrain.forEach((mesh) => push("Terrain", mesh.id, mesh.detailedBounds));
	sceneGraph.obstacles.forEach((obstacle) => push("Obstacle", obstacle.id, obstacle.detailedBounds));
	sceneGraph.voids.terrain.forEach(pushVoid);
	sceneGraph.voids.obstacles.forEach(pushVoid);

	sceneGraph.entities.forEach((entity) => {
		if (entity.collision === null) return;
		
		const category = classifyEntityType(entity);
		const { type, radius, halfHeight, segmentStart, segmentEnd } = entity.collision.physics.bounds;
		if (type === "capsule") {
			push(category, entity.id, { type, radius, halfHeight, segmentStart, segmentEnd });
			return;
		}

		push(category, entity.id, entity.collision.physics.bounds);
	});

	return detailed;
}

// Rebuild after scene changes.
function RefreshDebugBoundingBoxes(sceneGraph) {
	sceneGraph.debugBoundingBoxes = buildDebugBoundingBoxes(sceneGraph);
	sceneGraph.debug.detailedBounds = buildDebugDetailedBounds(sceneGraph);
	return sceneGraph.debugBoundingBoxes;
}

// Build the persistent sceneGraph from a level payload.
async function BuildLevel(payload) {
	RegisterGameTemplates(payload.templates);

	const scatterBatches = new Map(), scatterDebugBounds = [];
	const enqueueScatterBatches = (objectMesh, indexSeed, openFaces) => {
		if (objectMesh.detail.scatter.length === 0) return;

		BuildScatterBatches({
			objectMesh, indexSeed, openFaces,
			scatterMultiplier   : PERFORMANCE_SCALING.Density.Scatter[CONFIG.Performance.Scatter.Density],
			world               : payload.world,
			explicitScatter     : objectMesh.detail.scatter,
			batchMap            : scatterBatches,
			debugBboxAccumulator: scatterDebugBounds,
		});
	};

	// Shared storage between builders. Reusable face textures and part geometry.
	const faceTextureStore = {}, partGeometryCache = new Map();

	// Resolve template refs once here. The builders take these as they are.
	const terrainDefinitions  = payload.terrain.objects.map((definition) => ResolveObjectSource(definition, "terrain"));
	const obstacleDefinitions = payload.obstacles.map((definition)       => ResolveObjectSource(definition, "obstacle"));

	const { terrain, voidTerrain, meshes: allTerrain } = BuildTerrain(terrainDefinitions, payload.world, faceTextureStore);

	const { built: allObstacleRecords } = BuildObstacles(obstacleDefinitions, { textureScale: payload.world.textureScale, faceTextureStore });
	const obstacles     = allObstacleRecords.filter((r) => r.mode !== "void");
	const voidObstacleRecords = allObstacleRecords.filter((r) => r.mode === "void");

	// Cut each void into the terrain and obstacles it overlaps.
	const voids = { terrain: voidTerrain, obstacles: voidObstacleRecords };
	BuildVoidWalls({ terrain, obstacles, voids }, payload.world.textureScale);

	// Fit each terrain mesh occlusion boxes (for occlusion culling).
	BuildOccluders(terrain, voidTerrain);

	// Group touching terrain into chunks, then identify navigable loops.
	const terrainChunks = AssembleTerrainChunks(terrain, voidTerrain);
	const { loopSurfaces, tubeCenterlines } = FindLoops(terrainChunks, [...terrain, ...voidTerrain]);

	// Gather each object's open faces from every void that cuts into it.
	const openFacesByObjectId = new Map();
	const collectOpenFaces = (entries) => {
		for (const entry of entries) {
			for (const id in entry.relations) {
				if (!openFacesByObjectId.has(id)) openFacesByObjectId.set(id, []);
				for (const face of entry.relations[id].openFaces) openFacesByObjectId.get(id).push(face);
			}
		}
	};
	collectOpenFaces(voidTerrain);
	collectOpenFaces(voidObstacleRecords);

	// Generate scatter batches for default terrain and obstacles.
	allTerrain.forEach((terrainMesh, index) => {
		if (terrainMesh.meta.mode === "default") enqueueScatterBatches(terrainMesh, index + 1, openFacesByObjectId.get(terrainMesh.id) ?? []);
	});
	obstacles.forEach((record, index) => {
		if (record.mode === "default") enqueueScatterBatches(record.mesh, payload.terrain.objects.length + index + 1, openFacesByObjectId.get(record.id) ?? []);
	});

	let totalBatchInstances = 0;
	scatterBatches.forEach((batch) => totalBatchInstances += batch.instanceCount);
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

	const spawnSurfaces = buildSurfaceMap(terrainDefinitions, obstacleDefinitions);
	const entities      = payload.entities.map((entity) => {
		const { entity: built } = BuildEntity(
			buildEntityInput(entity, resolveEntityBlueprintMap(payload)),
			spawnSurfaces,
			payload.world.textureScale,
			faceTextureStore,
			partGeometryCache
		);
		return built;
	});
	if (entities.length > 0) Log("ENGINE", `Entity group created: count=${entities.length}`, "log", "Level");

	let particleGroups = 0;

	// Note: Gather every request first. Generation pushes new groups into `entities`.
	const generatorRequests = [
		...allTerrain.flatMap((mesh) => ParticleGeneratorRequests(mesh, "terrain")),
		...allObstacleRecords.flatMap((record) => ParticleGeneratorRequests(record, "obstacle")),
		...entities.flatMap((entity) => ParticleGeneratorRequests(entity, "entity")),
	];

	generatorRequests.forEach((request) => {
		const { groups } = GenerateParticles(
			request,
			payload.world.textureScale,
			faceTextureStore,
			partGeometryCache
		);
		entities.push(...groups);
		particleGroups += groups.length;
	});
	if (particleGroups > 0) Log("ENGINE", `Particle group created: count=${particleGroups}`, "log", "Level");

	const sceneGraph = {
		world: payload.world,
		terrain, entities, triggers, scatter: [], scatterBatches, obstacles, voids, 
		waterVisual: buildWaterVisualMeshes(payload.world, faceTextureStore), 
		chunks: terrainChunks.chunks, loopSurfaces, tubeCenterlines,
		scatterPrimitiveGeometry: BuildScatterVisualResources(scatterBatches),
		debug                   : {
			showTriggerVolumes: CONFIG.Debug.All === true && CONFIG.Debug.Levels.Triggers === true,
			detailedBounds    : [],
			scatterBounds     : scatterDebugBounds,
		},
		effects: {
			underwater: {
				enabled     : false,
				particleHook: null,
			},
		},
		cameraConfig       : payload.camera,
		playerConfig       : payload.player,
		spawnSurfaces,
		meta               : payload.meta,
		pendingFaceTextures: faceTextureStore,
		partGeometryCache,
	};

	RefreshDebugBoundingBoxes(sceneGraph);
	Log(
		"ENGINE",
		`
			Level generation complete: 
			- Terrain=${terrain.length}
			- Obstacles=${obstacles.length}, 
			- VoidTerrain=${voidTerrain.length}, 
			- VoidObstacles=${voidObstacleRecords.length}, 
			- Entities=${entities.length}, 
			- Triggers=${triggers.length}, 
			- ScatterBatches=${scatterBatches.size}, 
			- ScatterInstances=${totalBatchInstances}
		`,
		"log",
		"Level"
	);
	return sceneGraph;
}

export { BuildLevel, RefreshDebugBoundingBoxes };