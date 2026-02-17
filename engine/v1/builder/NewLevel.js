// Creates the Level's World by creating Terrain, Background, and placing Obstacles, Triggers and Entities
// Can also be used to create Boss Arenas

// Used by handlers/game/Level.js
// Uses NewEntity.js for building Enemies
// Uses NewObstacle.js for static obstacles
// Uses NewObject.js for terrain generation.

import { BuildObject } from "./NewObject.js";
import { BuildEntity } from "./NewEntity.js";
import { normalizeVector3 } from "../math/Vector3.js";

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

function BuildLevel(payload) {
	const source = payload && typeof payload === "object" ? payload : {};
	const world = normalizeWorld(source.world);
	const terrainDefinitions = source.terrain && Array.isArray(source.terrain.objects)
		? source.terrain.objects
		: [];
	const entityDefinitions = Array.isArray(source.entities) ? source.entities : [];

	const terrain = terrainDefinitions.map((terrainObject, index) =>
		BuildObject(
			{
				...terrainObject,
				id: terrainObject && terrainObject.id ? terrainObject.id : `terrain-${index}`,
				role: "terrain",
			},
			{
				role: "terrain",
				defaultColor: { r: 0.28, g: 0.58, b: 0.42, a: 1 },
			}
		)
	);

	const entities = entityDefinitions.map((entity, index) =>
		BuildEntity({
			...entity,
			id: entity && entity.id ? entity.id : `entity-${index}`,
		})
	);

	return {
		world: world,
		terrain: terrain,
		entities: entities,
		cameraConfig: normalizeCameraConfig(source.camera),
	};
}

export { BuildLevel };