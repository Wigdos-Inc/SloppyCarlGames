// Creates Models for anything that should support being animated.

// Called by NewBoss.js, player/Model.js, helpers/game/Level.js and helpers/Cutscene.js for Entity Models
// Uses NewObject.js for Model Parts

/* === IMPORTS === */
// Logging and model part builders.

import { Log } from "../core/meta.js";
import { normalizeVector3 } from "../math/Vector3.js";
import { BuildObject, BuildObjects } from "./NewObject.js";

/* === INTERNALS === */
// Local ids and normalizers for entity definitions.

let entityCounter = 0;

function nextEntityId(prefix) {
	entityCounter += 1;
	return `${prefix}-${entityCounter}`;
}

function normalizeTransform(definition) {
	const transform = definition && definition.transform ? definition.transform : definition;
	return {
		position: normalizeVector3(transform && transform.position, { x: 0, y: 0, z: 0 }),
		rotation: normalizeVector3(transform && transform.rotation, { x: 0, y: 0, z: 0 }),
		scale: normalizeVector3(transform && transform.scale, { x: 1, y: 1, z: 1 }),
	};
}

function normalizePath(pathDef) {
	if (!pathDef || typeof pathDef !== "object") {
		return null;
	}

	const points = Array.isArray(pathDef.points)
		? pathDef.points.map((point) => normalizeVector3(point, { x: 0, y: 0, z: 0 }))
		: [];

	return {
		points: points,
		repeat: pathDef.repeat === true,
		loop: pathDef.loop === true,
		speed: Number(pathDef.speed || 1),
		waitSeconds: Number(pathDef.waitSeconds || 0),
	};
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
			payload: trigger.payload || null,
			behavior: trigger.behavior || null,
		}));
}

function buildModel(definition, entityId) {
	if (!definition || typeof definition !== "object") {
		return { parts: [], root: null };
	}

	if (Array.isArray(definition.parts)) {
		return {
			parts: BuildObjects(definition.parts, { defaultPrefix: `${entityId}-part` }),
			root: null,
		};
	}

	if (definition.object) {
		return {
			parts: [],
			root: BuildObject(definition.object, { defaultPrefix: `${entityId}-root` }),
		};
	}

	return {
		parts: BuildObjects([definition], { defaultPrefix: `${entityId}-part` }),
		root: null,
	};
}

/* === BUILDERS === */
// Public builders for entity payloads.

function BuildEntity(definition, options) {
	if (!definition || typeof definition !== "object") {
		return null;
	}

	const prefix = options && options.defaultPrefix ? options.defaultPrefix : "entity";
	const id = definition.id || nextEntityId(prefix);
	const transform = normalizeTransform(definition);
	const model = buildModel(definition.model || definition.modelParts, id);

	const entityData = {
		id: id,
		type: definition.type || definition.kind || "entity",
		name: definition.name || id,
		transform: transform,
		path: normalizePath(definition.path),
		animated: definition.animated !== false,
		model: model,
		collider: definition.collider || null,
		triggers: normalizeTriggers(definition.triggers),
		behaviors: definition.behaviors && typeof definition.behaviors === "object" ? definition.behaviors : {},
		tags: Array.isArray(definition.tags) ? definition.tags : [],
		meta: definition.meta && typeof definition.meta === "object" ? definition.meta : {},
	};

	Log("ENGINE", `Built entity ${id} (${entityData.type}).`, "log", "Builder");
	return entityData;
}

function BuildEntities(definitions, options) {
	if (!Array.isArray(definitions)) {
		return [];
	}

	return definitions
		.map((definition) => BuildEntity(definition, options))
		.filter((entity) => entity);
}

/* === EXPORTS === */
// Public entity pipeline surface.

export { BuildEntity, BuildEntities };