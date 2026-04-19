import canonSchemas from "./canonSchemas.json" with { type: "json" };
import Normalize from "./normalize.js";
import { Log } from "./meta.js";

function normalizeSchemaKey(key) {
	return key.toLowerCase().replace(/[-_]/g, "");
}

function validatePayloadSchema(payload, rootKey) {
	const errors = [];
	const canonLayer = canonSchemas[rootKey];

	function checkFieldLayer(payloadLayer, canonFieldLayer, path) {
		const sourceLayer = payloadLayer && typeof payloadLayer === "object" && !Array.isArray(payloadLayer)
			? payloadLayer
			: {};
		const payloadKeys = Object.keys(sourceLayer);

		for (const key in canonFieldLayer) {
			if (key === "__meta" || key === "__entry") continue;

			const fieldSchema = canonFieldLayer[key];
			const meta = fieldSchema.__meta;
			if (meta.isRequired !== true) continue;

			const aliases = [key, ...meta.aliases];
			let matchedKey = null;

			for (let keyIndex = 0; keyIndex < payloadKeys.length; keyIndex++) {
				const payloadKey = payloadKeys[keyIndex];
				const normalizedPayloadKey = normalizeSchemaKey(payloadKey);

				for (let aliasIndex = 0; aliasIndex < aliases.length; aliasIndex++) {
					if (normalizedPayloadKey === normalizeSchemaKey(aliases[aliasIndex])) {
						matchedKey = payloadKey;
						break;
					}
				}

				if (matchedKey !== null) break;
			}

			if (matchedKey === null) {
				errors.push(`${path}.${key}: missing required ${meta.dataType}.`);
				continue;
			}

			const value = sourceLayer[matchedKey];
			let valid = false;
			switch (meta.dataType) {
				case "string":
					valid = typeof value === "string";
					break;
				case "number":
					valid = typeof value === "number" && Number.isFinite(value);
					break;
				case "boolean":
					valid = typeof value === "boolean";
					break;
				case "object":
					valid = value !== null && typeof value === "object" && !Array.isArray(value);
					break;
				case "array":
					valid = Array.isArray(value);
					break;
				case "vector3":
					valid =
						value !== null &&
						typeof value === "object" &&
						!Array.isArray(value) &&
						typeof value.x === "number" && Number.isFinite(value.x) &&
						typeof value.y === "number" && Number.isFinite(value.y) &&
						typeof value.z === "number" && Number.isFinite(value.z);
					break;
			}

			if (!valid) {
				errors.push(`${path}.${key}: expected ${meta.dataType}, got ${Array.isArray(value) ? "array" : value === null ? "null" : typeof value}.`);
				continue;
			}

			let hasChildren = false;
			for (const childKey in fieldSchema) {
				if (childKey !== "__meta" && childKey !== "__entry") {
					hasChildren = true;
					break;
				}
			}

			if (fieldSchema.__entry && Array.isArray(value)) {
				for (let entryIndex = 0; entryIndex < value.length; entryIndex++) {
					checkFieldLayer(value[entryIndex], fieldSchema.__entry, `${path}.${key}[${entryIndex}]`);
				}
			}
			else if (hasChildren) {
				checkFieldLayer(value, fieldSchema, `${path}.${key}`);
			}
		}

		return errors;
	}

	const rootPayload = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
	return checkFieldLayer(rootPayload, canonLayer, rootKey);
}

function logValidationErrors(errors) {
	for (let index = 0; index < errors.length; index++) {
		Log("ENGINE", errors[index], "error", "Validation");
	}
}

function ValidateAudioPayload(payload) {
	const errors = validatePayloadSchema(payload, "audio");
	logValidationErrors(errors);
	if (errors.length > 0) return null;
	return Normalize.AudioPayload(payload);
}

function ValidateMenuUIPayload(payload) {
	const errors = validatePayloadSchema(payload, "menu");
	logValidationErrors(errors);
	if (errors.length > 0) return null;
	return Normalize.MenuUIPayload(payload);
}

function ValidateSplashPayload(payload) {
	const errors = validatePayloadSchema(payload, "splash");
	logValidationErrors(errors);
	if (errors.length > 0) return null;
	return Normalize.SplashPayload(payload);
}

function ValidateCutscenePayload(payload, type) {
	if (type !== "rendered" && type !== "engine") {
		const errors = [`cutscene: unknown type '${type}'.`];
		logValidationErrors(errors);
		return null;
	}

	const rootKey = type === "rendered" ? "cutsceneRendered" : "cutsceneEngine";
	const errors = validatePayloadSchema(payload, rootKey);
	logValidationErrors(errors);
	if (errors.length > 0) return null;
	return Normalize.CutscenePayload(payload, type);
}

function ValidateLevelPayload(payload) {
	const errors = validatePayloadSchema(payload, "level");
	logValidationErrors(errors);
	if (errors.length > 0) return null;
	return Normalize.LevelPayload(payload);
}

export {
	ValidateAudioPayload,
	ValidateMenuUIPayload,
	ValidateSplashPayload,
	ValidateCutscenePayload,
	ValidateLevelPayload,
};