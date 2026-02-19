// Creates the Level's World by creating Terrain, Background, and placing Obstacles, Triggers and Entities
// Can also be used to create Boss Arenas

// Used by handlers/game/Level.js
// Uses NewEntity.js for building Enemies
// Uses NewObstacle.js for static obstacles
// Uses NewObject.js for terrain generation.

import { BuildObject } from "./NewObject.js";
import { BuildEntity } from "./NewEntity.js";
import { BuildObstacles } from "./NewObstacle.js";
import { normalizeVector3 } from "../math/Vector3.js";
import { CONFIG } from "../core/config.js";
import { Log } from "../core/meta.js";
import {
	LoadEngineVisualTemplates,
	PrepareLevelVisualResources,
	ResolveScatterType,
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
	};
}

function normalizeCameraConfig(camera) {
	const source = camera && typeof camera === "object" ? camera : {};
	return {
		mode: "stationary",
		levelOpening: {
			startPosition: normalizeVector3(
				source.levelOpening && source.levelOpening.startPosition,
				{ x: 0, y: 40, z: 80 }
			),
			endPosition: normalizeVector3(
				source.levelOpening && source.levelOpening.endPosition,
				{ x: 0, y: 40, z: 80 }
			),
		},
		distanceFromPlayer: normalizeVector3(source.distanceFromPlayer, { x: 0, y: 20, z: 40 }),
	};
}

function getPerformanceScatterMultiplier() {
	const level = CONFIG && CONFIG.PERFORMANCE ? CONFIG.PERFORMANCE.TerrainScatter : "Medium";
	if (level === "High") {
		return 1;
	}
	if (level === "Low") {
		return 0;
	}
	return 0.5;
}

function hashNoise(x, z, seed) {
	const value = Math.sin(x * 12.9898 + z * 78.233 + seed * 37.719) * 43758.5453;
	return value - Math.floor(value);
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
	const start = normalizeVector3(source.start, { x: 0, y: 0, z: 0 });
	const end = normalizeVector3(source.end, start);
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

function generateTerrainScatter(terrainMesh, terrainDefinition, scatterDefinitions, scatterMultiplier, world, indexSeed) {
	if (scatterMultiplier <= 0) {
		return [];
	}

	const scatterTypeIDs = Array.isArray(terrainDefinition && terrainDefinition.scatterTypeIDs)
		? terrainDefinition.scatterTypeIDs
		: [];
	if (scatterTypeIDs.length === 0) {
		return [];
	}

	const baseDensity = Math.max(0, toNumber(terrainDefinition.baseDensity, 0));
	if (baseDensity <= 0) {
		return [];
	}

	const topY = terrainMesh.transform.position.y + (terrainMesh.dimensions.y * terrainMesh.transform.scale.y) * 0.5;
	const width = Math.max(1, terrainMesh.dimensions.x * terrainMesh.transform.scale.x);
	const depth = Math.max(1, terrainMesh.dimensions.z * terrainMesh.transform.scale.z);
	const approxArea = width * depth;
	const minX = terrainMesh.transform.position.x - width * 0.5;
	const maxX = terrainMesh.transform.position.x + width * 0.5;
	const minZ = terrainMesh.transform.position.z - depth * 0.5;
	const maxZ = terrainMesh.transform.position.z + depth * 0.5;
	const positionThreshold = 100000;

	Log(
		"ENGINE",
		`Scatter bounds: source=${terrainMesh.id}, minX=${minX.toFixed(2)}, maxX=${maxX.toFixed(2)}, minZ=${minZ.toFixed(2)}, maxZ=${maxZ.toFixed(2)}`,
		"log",
		"Level"
	);

	const scatterMeshes = [];
	scatterTypeIDs.forEach((scatterTypeID, scatterTypeIndex) => {
		const scatterType = ResolveScatterType(scatterDefinitions, scatterTypeID);
		if (!scatterType || !Array.isArray(scatterType.parts) || scatterType.parts.length === 0) {
			return;
		}

		const maxCount = Math.max(0, Math.floor((approxArea / 18) * baseDensity * scatterMultiplier));
		let typeCount = 0;
		let samplePosition = null;
		let sampleDimensions = null;
		for (let instanceIndex = 0; instanceIndex < maxCount; instanceIndex += 1) {
			const seed = indexSeed * 97 + scatterTypeIndex * 59 + instanceIndex * 17;
			const nx = hashNoise(instanceIndex + 1, seed + 2, seed + 11);
			const nz = hashNoise(seed + 3, instanceIndex + 5, seed + 13);
			const cluster = hashNoise(nx * 64, nz * 64, seed + 7);
			if (cluster < 0.4) {
				continue;
			}

			const worldX = terrainMesh.transform.position.x - width * 0.5 + nx * width;
			const worldZ = terrainMesh.transform.position.z - depth * 0.5 + nz * depth;
			const worldY = topY;

			if (!Number.isFinite(worldX) || !Number.isFinite(worldY) || !Number.isFinite(worldZ)) {
				Log("ENGINE", `Scatter position invalid (NaN/Infinity): type=${scatterType.id}`, "warn", "Level");
				continue;
			}

			if (Math.abs(worldX) > positionThreshold || Math.abs(worldY) > positionThreshold || Math.abs(worldZ) > positionThreshold) {
				Log("ENGINE", `Scatter position out of range: type=${scatterType.id} pos=(${worldX}, ${worldY}, ${worldZ})`, "warn", "Level");
				continue;
			}

			if (worldX < minX || worldX > maxX || worldZ < minZ || worldZ > maxZ) {
				Log("ENGINE", `Scatter position outside mesh bounds: type=${scatterType.id}`, "warn", "Level");
				continue;
			}

			if (worldY < scatterType.heightMin || worldY > scatterType.heightMax) {
				continue;
			}

			const slopeEstimate = Math.abs(Math.sin((worldX + worldZ) * scatterType.noiseScale)) * 0.25;
			if (slopeEstimate > scatterType.slopeMax) {
				continue;
			}

			const scaleNoise = hashNoise(worldX * 0.5, worldZ * 0.5, seed + 19);
			const uniformScale = scatterType.scaleRange.min + (scatterType.scaleRange.max - scatterType.scaleRange.min) * scaleNoise;

			scatterType.parts.forEach((part, partIndex) => {
				const baseDim = Math.max(0.0001, (part.dimensions.x + part.dimensions.y + part.dimensions.z) / 3);
				typeCount += 1;
				const finalScaleBoost = 1;
				const finalY = worldY + part.localPosition.y + 0.05;

				if (!samplePosition) {
					samplePosition = { x: worldX, y: finalY, z: worldZ };
					sampleDimensions = {
						x: part.dimensions.x * uniformScale * finalScaleBoost,
						y: part.dimensions.y * uniformScale * finalScaleBoost,
						z: part.dimensions.z * uniformScale * finalScaleBoost,
					};
				}

				scatterMeshes.push(
					BuildObject(
						{
							id: `${terrainMesh.id}-scatter-${scatterType.id}-${instanceIndex}-${partIndex}`,
							primitive: part.primitive,
							dimensions: part.dimensions,
							position: {
								x: worldX + part.localPosition.x,
								y: finalY,
								z: worldZ + part.localPosition.z,
							},
							rotation: {
								x: part.localRotation.x,
								y: part.localRotation.y + hashNoise(worldX, worldZ, seed + partIndex) * Math.PI * 2,
								z: part.localRotation.z,
							},
							scale: {
								x: part.localScale.x * uniformScale * finalScaleBoost,
								y: part.localScale.y * uniformScale * finalScaleBoost,
								z: part.localScale.z * uniformScale * finalScaleBoost,
							},
							textureID: part.textureID,
							textureColor: part.textureColor,
							textureOpacity: part.textureOpacity,
							role: "scatter",
						},
						{ role: "scatter" }
					)
				);
			});
		}

		if (typeCount > 0) {
			Log(
				"ENGINE",
				`Scatter diagnostics: type=${scatterType.id}, created=${typeCount}, samplePos=${samplePosition ? `${samplePosition.x.toFixed(2)},${samplePosition.y.toFixed(2)},${samplePosition.z.toFixed(2)}` : "n/a"}, sampleDim=${sampleDimensions ? `${sampleDimensions.x.toFixed(2)},${sampleDimensions.y.toFixed(2)},${sampleDimensions.z.toFixed(2)}` : "n/a"}`,
				"log",
				"Level"
			);
		}
	});

	return scatterMeshes;
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
	const scatterMultiplier = getPerformanceScatterMultiplier();
	const visualTemplateRegistry = await LoadEngineVisualTemplates();

	const terrain = terrainDefinitions.map((terrainObject, index) =>
		BuildObject(
			{
				...terrainObject,
				id: terrainObject && terrainObject.id ? terrainObject.id : `terrain-${index}`,
				primitive: terrainObject && terrainObject.primitive ? terrainObject.primitive : terrainObject.shape,
				role: "terrain",
				textureID: terrainObject && terrainObject.textureID ? terrainObject.textureID : "grass-soft",
				textureColor: terrainObject && terrainObject.textureColor ? terrainObject.textureColor : { r: 1, g: 1, b: 1, a: 1 },
				textureOpacity: terrainObject && typeof terrainObject.textureOpacity === "number" ? terrainObject.textureOpacity : 1,
			},
			{
				role: "terrain",
				defaultColor: { r: 0.28, g: 0.58, b: 0.42, a: 1 },
				textureID: "grass-soft",
			}
		)
	);
	if (terrain.length > 0) {
		Log("ENGINE", `Terrain object group created: count=${terrain.length}`, "log", "Level");
	}

	const scatter = [];
	let terrainScatterCount = 0;
	terrain.forEach((terrainMesh, terrainIndex) => {
		const terrainDefinition = terrainDefinitions[terrainIndex] || {};
		const generated = generateTerrainScatter(
				terrainMesh,
				terrainDefinition,
				visualTemplateRegistry,
				scatterMultiplier,
				world,
				terrainIndex + 1
			);
		terrainScatterCount += generated.length;
		scatter.push(...generated);
	});

	const obstacleRecords = BuildObstacles(obstacleDefinitions);
	const obstacles = obstacleRecords.map((record) => record.mesh);

	let obstacleScatterCount = 0;
	obstacleRecords.forEach((obstacleRecord, obstacleIndex) => {
		const obstacleMesh = obstacleRecord.mesh;
		const obstacleDefinition = {
			scatterTypeIDs: obstacleRecord.scatterTypeIDs,
			baseDensity: obstacleRecord.baseDensity,
		};
		const generated = generateTerrainScatter(
				obstacleMesh,
				obstacleDefinition,
				visualTemplateRegistry,
				scatterMultiplier,
				world,
				500 + obstacleIndex
			);
		obstacleScatterCount += generated.length;
		scatter.push(...generated);
	});

	if (scatter.length > 0) {
		Log(
			"ENGINE",
			`Scatter applied: total=${scatter.length}, terrain=${terrainScatterCount}, obstacles=${obstacleScatterCount}`,
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
		scatter: scatter,
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
		`Level generation complete: terrain=${terrain.length}, obstacles=${obstacleRecords.length}, entities=${entities.length}, triggers=${triggers.length}, scatter=${scatter.length}`,
		"log",
		"Level"
	);
	return sceneGraph;
}

export { BuildLevel, RefreshSceneBoundingBoxes };