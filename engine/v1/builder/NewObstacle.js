// Creates Obstacles the player has to avoid or use an ability on (can be destrucible)

// Used by NewLevel.js and handlers/Cutscene.js
// Uses NewObject.js for 3D objects

/* === IMPORTS === */
// Logging and object builders.

import { Log } from "../core/meta.js";
import { normalizeVector3 } from "../math/Vector3.js";
import { BuildObject, BuildObjects } from "./NewObject.js";

/* === INTERNALS === */
// Local ids and normalizers for obstacle definitions.

let obstacleCounter = 0;

function nextObstacleId(prefix) {
	obstacleCounter += 1;
	return `${prefix}-${obstacleCounter}`;
}

function normalizeTransform(definition) {
	const transform = definition && definition.transform ? definition.transform : definition;
	return {
		position: normalizeVector3(transform && transform.position, { x: 0, y: 0, z: 0 }),
		rotation: normalizeVector3(transform && transform.rotation, { x: 0, y: 0, z: 0 }),
		scale: normalizeVector3(transform && transform.scale, { x: 1, y: 1, z: 1 }),
	};
}

/* === BUILDERS === */
// Public builders for obstacle payloads.

function BuildObstacle(definition, options) {
	if (!definition || typeof definition !== "object") {
		return null;
	}

	const prefix = options && options.defaultPrefix ? options.defaultPrefix : "obstacle";
	const id = definition.id || nextObstacleId(prefix);
	const transform = normalizeTransform(definition);

	const parts = Array.isArray(definition.parts)
		? BuildObjects(definition.parts, { defaultPrefix: `${id}-part` })
		: [];

	const root = definition.object
		? BuildObject(definition.object, { defaultPrefix: `${id}-root` })
		: null;

	const obstacleData = {
		id: id,
		type: definition.type || "obstacle",
		name: definition.name || id,
		transform: transform,
		parts: parts,
		root: root,
		destructible: definition.destructible === true,
		triggers: Array.isArray(definition.triggers) ? definition.triggers : [],
		behaviors: definition.behaviors && typeof definition.behaviors === "object" ? definition.behaviors : {},
		tags: Array.isArray(definition.tags) ? definition.tags : [],
		meta: definition.meta && typeof definition.meta === "object" ? definition.meta : {},
	};

	Log("ENGINE", `Built obstacle ${id}.`, "log", "Builder");
	return obstacleData;
}

function BuildObstacles(definitions, options) {
	if (!Array.isArray(definitions)) {
		return [];
	}

	return definitions
		.map((definition) => BuildObstacle(definition, options))
		.filter((obstacle) => obstacle);
}

/* === EXPORTS === */
// Public obstacle pipeline surface.

export { BuildObstacle, BuildObstacles };