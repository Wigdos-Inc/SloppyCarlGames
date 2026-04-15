
// Listens for data from the game, receives their payload and destination, and checks if incoming data suffices.
// Throws error if data doesn't suffice. Can pass on data to any module the data belongs to.


import { Log } from "./meta.js";
import Normalize from "./normalize.js";
import aliasMap from "./aliases.json" with { type: "json" };

// Example valid payloads
const exampleMenuUIPayload = {};

const exampleLevelPayload = {};

function isObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
	return value && typeof value === "string" && value.length !== 0;
}

function normalizeKey(key) {
	return String(key).toLowerCase().replace(/[-_]/g, "");
}

function findAcceptedAliasValue(source, aliases) {
	if (!isObject(source)) return undefined;
	const accepted = new Set();
	for (let index = 0; index < aliases.length; index++) accepted.add(normalizeKey(aliases[index]));
	const keys = Object.keys(source);
	for (let index = 0; index < keys.length; index++) {
		const key = keys[index];
		if (accepted.has(normalizeKey(key))) return source[key];
	}
	return undefined;
}

function hasAcceptedAlias(source, aliases) {
	return findAcceptedAliasValue(source, aliases) !== undefined;
}

function isVector3(value) {
	return (
		isObject(value)
		&& typeof value.x === "number"
		&& Number.isFinite(value.x)
		&& typeof value.y === "number"
		&& Number.isFinite(value.y)
		&& typeof value.z === "number"
		&& Number.isFinite(value.z)
	);
}

function ValidateMenuUIPayload(payload) {
	const errors = [];
	if (!isObject(payload)) errors.push("payload must be an object");
	else {
		const rawElements = findAcceptedAliasValue(payload, aliasMap.shared.elements);
		if (!isString(findAcceptedAliasValue(payload, aliasMap.menu.screenId))) {
			errors.push("'screenId' must be a non-empty string");
		}
		if (!Array.isArray(rawElements)) errors.push("'elements' must be an array");
	}

	if (errors.length > 0) {
		Log("ENGINE", `Invalid Payload. Example valid menuUI payload: \n${JSON.stringify(exampleMenuUIPayload, null, 2)}`, "error", "Validation");
		Log("ENGINE", `Menu UI payload rejected:\n- ${errors.join("\n- ")}.`, "error", "Validation");
		return null;
	}

	return Normalize.MenuUIPayload(payload);
}

function ValidateSplashPayload(payload) {
	if (payload === null || payload === undefined) return { presetId: null, sequence: [], outputType: "default" };
	if (!isObject(payload) && !Array.isArray(payload) && !isString(payload)) {
		Log("ENGINE", "Splash payload ignored: expected string, array, or object. Using engine default.", "warn", "Validation");
		return { presetId: null, sequence: [], outputType: "default" };
	}

	const normalized = Normalize.SplashPayload(payload);
	if (normalized === null) {
		Log("ENGINE", "Splash payload normalization failed. Using engine default.", "warn", "Validation");
		return { presetId: null, sequence: [], outputType: "default" };
	}

	return normalized;
}

function ValidateCutscenePayload(payload, cutsceneType) {
	const errors = [];

	if (!isObject(payload)) errors.push("'payload' must be an object");
	else {
		if (
			cutsceneType === "rendered" && 
			!isString(findAcceptedAliasValue(payload, aliasMap.cutsceneRendered.source))
		) {
			errors.push("rendered cutscene requires a non-empty source");
		}

		if (cutsceneType === "engine") {
			if (!hasAcceptedAlias(payload, aliasMap.cutsceneEngine.data)) errors.push("engine cutscene requires a payload");

			const rawDuration = findAcceptedAliasValue(payload, aliasMap.cutsceneEngine.durationSeconds);
			if (rawDuration !== undefined && rawDuration !== null) {
				const duration = Number(rawDuration);
				if (!Number.isFinite(duration) || duration < 0) {
					errors.push("'durationSeconds' must be a non-negative number when provided");
				}
			}

			const rawFallbackWaitMs = findAcceptedAliasValue(payload, aliasMap.cutsceneEngine.fallbackWaitMs);
			if (rawFallbackWaitMs !== undefined && rawFallbackWaitMs !== null) {
				const fallbackWaitMs = Number(rawFallbackWaitMs);
				if (!Number.isFinite(fallbackWaitMs) || fallbackWaitMs < 0) {
					errors.push("'fallbackWaitMs' must be a non-negative number when provided");
				}
			}
		}
	}

	if (errors.length > 0) {
		Log("ENGINE", `Cutscene payload rejected:\n\n${errors.join("\n")}.`, "error", "Validation");
		return null;
	}

	const normalized = Normalize.CutscenePayload(payload, cutsceneType);
	if (normalized === null) {
		Log("ENGINE", "Cutscene payload normalization failed.", "error", "Validation");
		return null;
	}
	return normalized;
}

function ValidateLevelPayload(payload) {
	const errors = [];
	const validateRawTrigger = (trigger, index) => {
		if (!isObject(trigger)) {
			errors.push(`'terrain.triggers[${index}]' must be an object`);
			return;
		}

		if (!isString(trigger.id)) errors.push(`'terrain.triggers[${index}].id' must be a non-empty string`);

		if (!isString(findAcceptedAliasValue(trigger, aliasMap.level.terrain.triggers.type))) {
			errors.push(`'terrain.triggers[${index}].type' must be a non-empty string`);
		}

		if (!isVector3(findAcceptedAliasValue(trigger, aliasMap.level.terrain.triggers.start))) {
			errors.push(`'terrain.triggers[${index}].start' must be a vector3`);
		}

		if (!isVector3(findAcceptedAliasValue(trigger, aliasMap.level.terrain.triggers.end))) {
			errors.push(`'terrain.triggers[${index}].end' must be a vector3`);
		}
	};

	if (!isObject(payload)) errors.push("payload must be an object");
	else {
		const rawTerrain = findAcceptedAliasValue(payload, aliasMap.shared.terrain);

		if (!isString(findAcceptedAliasValue(payload, aliasMap.level.id))) errors.push("'id' must be a non-empty string");
		if (!isString(findAcceptedAliasValue(payload, aliasMap.level.title))) errors.push("'title' must be a non-empty string");
		if (!isObject(findAcceptedAliasValue(payload, aliasMap.shared.world))) errors.push("'world' must be an object");
		if (!isObject(rawTerrain)) errors.push("'terrain' must be an object");
		else {
			const rawObjects = findAcceptedAliasValue(rawTerrain, aliasMap.shared.objects);
			const rawTriggers = findAcceptedAliasValue(rawTerrain, aliasMap.shared.triggers);
			if (!Array.isArray(rawObjects)) errors.push("'terrain.objects' must be an array");
			if (!Array.isArray(rawTriggers)) errors.push("'terrain.triggers' must be an array");
			else {
				for (let index = 0; index < rawTriggers.length; index++) {
					validateRawTrigger(rawTriggers[index], index);
				}
			}
		}
		if (!Array.isArray(findAcceptedAliasValue(payload, aliasMap.shared.obstacles))) errors.push("'obstacles' must be an array");
		if (!Array.isArray(findAcceptedAliasValue(payload, aliasMap.shared.entities))) errors.push("'entities' must be an array");
		if (!isObject(findAcceptedAliasValue(payload, aliasMap.shared.entityBlueprints))) errors.push("'entityBlueprints' must be an object");
		if (!isObject(findAcceptedAliasValue(payload, aliasMap.shared.meta))) errors.push("'meta' must be an object");
	}

	if (errors.length > 0) {
		Log("ENGINE", `Invalid Payload. Example valid level payload: \n${JSON.stringify(exampleLevelPayload, null, 2)}`, "error", "Validation");
		Log("ENGINE", `Level payload rejected:\n\n${errors.join("\n")}.`, "error", "Validation");
		return null;
	}

	return Normalize.LevelPayload(payload);
}



export { ValidateMenuUIPayload, ValidateSplashPayload, ValidateCutscenePayload, ValidateLevelPayload };