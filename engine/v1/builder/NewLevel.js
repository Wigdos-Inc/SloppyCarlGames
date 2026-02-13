// Creates the Level's World by creating Terrain, Background, and placing Obstacles, Triggers and Entities
// Can also be used to create Boss Arenas

// Used by handlers/game/Level.js
// Uses NewEntity.js for building Enemies
// Uses NewObstacle.js for static obstacles
// Uses NewObject.js for terrain generation.

/* === IMPORTS === */
// Logging, cache, and builder helpers.

import { Log, Cache } from "../core/meta.js";
import { normalizeVector3 } from "../math/Vector3.js";
import { BuildTerrain, BuildObjects } from "./NewObject.js";
import { BuildEntities } from "./NewEntity.js";
import { BuildObstacles } from "./NewObstacle.js";
import { BuildBoss } from "./NewBoss.js";

/* === INTERNALS === */
// Local ids and normalizers for level payloads.

let levelCounter = 0;

function nextLevelId(prefix) {
	levelCounter += 1;
	return `${prefix}-${levelCounter}`;
}

function normalizeTriggers(definition) {
	if (!Array.isArray(definition)) {
		return [];
	}

	return definition
		.filter((trigger) => trigger && typeof trigger === "object")
		.map((trigger) => ({
			id: trigger.id || null,
			type: trigger.type || "generic",
			position: normalizeVector3(trigger.position, { x: 0, y: 0, z: 0 }),
			radius: Number(trigger.radius || 0),
			payload: trigger.payload || null,
			behavior: trigger.behavior || null,
			meta: trigger.meta && typeof trigger.meta === "object" ? trigger.meta : {},
		}));
}

function buildIndexes(entries) {
	const index = {};
	entries.forEach((entry) => {
		if (entry && entry.id) {
			index[entry.id] = entry;
		}
	});
	return index;
}

/* === BUILDERS === */
// Public builders for full level payloads.

function BuildLevel(payload, options) {
	const levelPayload = payload && typeof payload === "object" ? payload : {};
	const prefix = options && options.defaultPrefix ? options.defaultPrefix : "level";
	const id = levelPayload.id || nextLevelId(prefix);

	const terrain = BuildTerrain(levelPayload.terrain || levelPayload.world || []);
	const background = BuildObjects(levelPayload.background || [], { defaultPrefix: `${id}-bg` });
	const obstacles = BuildObstacles(levelPayload.obstacles || [], { defaultPrefix: `${id}-obstacle` });
	const entities = BuildEntities(levelPayload.entities || [], { defaultPrefix: `${id}-entity` });
	const boss = levelPayload.boss ? BuildBoss(levelPayload.boss, { defaultPrefix: `${id}-boss` }) : null;

	const triggers = normalizeTriggers(levelPayload.triggers);
	const behaviors = levelPayload.behaviors && typeof levelPayload.behaviors === "object" ? levelPayload.behaviors : {};
	const meta = levelPayload.meta && typeof levelPayload.meta === "object" ? levelPayload.meta : {};

	const builtLevel = {
		id: id,
		name: levelPayload.name || id,
		seed: levelPayload.seed || null,
		terrain: terrain,
		background: background,
		obstacles: obstacles,
		entities: entities,
		boss: boss,
		triggers: triggers,
		behaviors: behaviors,
		meta: meta,
		index: {
			terrain: buildIndexes(terrain),
			background: buildIndexes(background),
			obstacles: buildIndexes(obstacles),
			entities: buildIndexes(entities),
			triggers: buildIndexes(triggers),
		},
		createdAt: Date.now(),
	};

	Cache.Level.lastPayload = payload || null;
	Cache.Level.lastBuild = builtLevel;

	Log("ENGINE", `Level build complete (${id}).`, "log", "Level");
	return builtLevel;
}

/* === EXPORTS === */
// Public level builder surface.

export { BuildLevel };