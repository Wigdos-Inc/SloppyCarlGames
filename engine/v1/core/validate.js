import canonSchemas from "./canonSchemas.json" with { type: "json" };
import Normalize, { isTemplateRef } from "./normalize.js";
import { Log, ENTITY_TYPES } from "./meta.js";

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const normalizeSchemaKey = (key) => key.toLowerCase().replace(/[-_]/g, "");

function validatePayloadSchema(payload, rootKey, rootPath = rootKey) {
	const errors = [];
	const canonLayer = canonSchemas[rootKey];

	function describeType(value) {
		if (Array.isArray(value)) return "array";
		if (value === null) return "null";
		return typeof value;
	}

	function validateFieldValue(value, meta, path) {
		let valid = false;

		switch (meta.dataType) {
			case "string": valid = typeof value === "string"; break;
			case "number": valid = typeof value === "number" && Number.isFinite(value); break;
			case "boolean": valid = typeof value === "boolean"; break;
			case "object": valid = isPlainObject(value); break;
			case "array": valid = Array.isArray(value); break;
			case "vector3":
				valid =
					isPlainObject(value) &&
					typeof value.x === "number" && Number.isFinite(value.x) &&
					typeof value.y === "number" && Number.isFinite(value.y) &&
					typeof value.z === "number" && Number.isFinite(value.z);
				break;
		}

		if (!valid) return `${path}: expected ${meta.dataType}, got ${describeType(value)}.`;
		if (meta.allowedValues && meta.dataType === "string" && !meta.allowedValues.includes(value)) return `${path}: '${value}' not allowed.`;
		if (meta.range && meta.dataType === "number" && (value < meta.range.min || value > meta.range.max)) {
			return `${path}: ${value} outside range ${meta.range.min}-${meta.range.max}.`;
		}

		return null;
	}

	function checkFieldLayer(payloadLayer, canonFieldLayer, path) {
		const sourceLayer = isPlainObject(payloadLayer) ? payloadLayer : {};

		for (const key in canonFieldLayer) {
			if (key === "__meta" || key === "__entry") continue;

			const fieldSchema = canonFieldLayer[key];
			let matchedKey = null;

			for (const payloadKey in sourceLayer) {
				for (const alias of [key, ...fieldSchema.__meta.aliases]) {
					if (normalizeSchemaKey(payloadKey) === normalizeSchemaKey(alias)) {
						matchedKey = payloadKey;
						break;
					}
				}

				if (matchedKey !== null) break;
			}

			if (matchedKey === null) {
				if (fieldSchema.__meta.isRequired === true) errors.push(`${path}.${key}: missing required ${fieldSchema.__meta.dataType}.`);
				continue;
			}

			const value = sourceLayer[matchedKey];
			const fieldError = validateFieldValue(value, fieldSchema.__meta, `${path}.${key}`);
			if (fieldError !== null) {
				if (fieldSchema.__meta.isRequired === true) errors.push(fieldError);
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
				value.forEach((entry, entryIndex) => checkFieldLayer(entry, fieldSchema.__entry, `${path}.${key}[${entryIndex}]`));
			}
			else if (hasChildren && isPlainObject(value)) checkFieldLayer(value, fieldSchema, `${path}.${key}`);
		}

		return errors;
	}

	return checkFieldLayer(isPlainObject(payload) ? payload : {}, canonLayer, rootPath);
}

function logValidationErrors(errors) {
	errors.forEach((error) => Log("ENGINE", error, "error", "Validation"));
}

function validateMenuElementTree(rawElements, path, errors) {
	if (!Array.isArray(rawElements)) return;

	rawElements.forEach((rawElement, index) => {
		errors.push(...validatePayloadSchema(rawElement, "menuElement", `${path}[${index}]`));
		validateMenuElementTree((isPlainObject(rawElement) ? rawElement : {}).children, `${`${path}[${index}]`}.children`, errors);
	});
}

function validateSplashTextEntries(rawTextEntries, path, errors) {
	if (!Array.isArray(rawTextEntries)) return;
	rawTextEntries.forEach((rawText, index) => errors.push(...validatePayloadSchema(rawText, "splashText", `${path}[${index}]`)));
}

function ValidateAudioPayload(payload) {
	const errors = validatePayloadSchema(payload, "audio");
	logValidationErrors(errors);
	if (errors.length > 0) return null;
	return Normalize.AudioPayload(payload);
}

function ValidateMenuPayload(payload) {
	const errors = validatePayloadSchema(payload, "menu");
	const rawPayload = isPlainObject(payload) ? payload : {};

	validateMenuElementTree(rawPayload.elements, "menu.elements", errors);
	if (isPlainObject(rawPayload.music)) errors.push(...validatePayloadSchema(rawPayload.music, "audio", "menu.music"));

	logValidationErrors(errors);
	if (errors.length > 0) return null;
	return Normalize.MenuPayload(payload);
}

function ValidateSplashPayload(payload) {
	const errors = validatePayloadSchema(payload, "splash");
	const rawPayload = isPlainObject(payload) ? payload : {};

	if (Array.isArray(rawPayload.sequence)) {
		rawPayload.sequence.forEach((rawStep, index) => {
			const stepPath = `splash.sequence[${index}]`;
			errors.push(...validatePayloadSchema(rawStep, "splashStep", stepPath));

			const stepSource = isPlainObject(rawStep) ? rawStep : {};
			if (isPlainObject(stepSource.sfx)) errors.push(...validatePayloadSchema(stepSource.sfx, "audio", `${stepPath}.sfx`));
			if (isPlainObject(stepSource.voice)) errors.push(...validatePayloadSchema(stepSource.voice, "audio", `${stepPath}.voice`));
			validateMenuElementTree(stepSource.elements, `${stepPath}.elements`, errors);
			validateSplashTextEntries(stepSource.text, `${stepPath}.text`, errors);
		});
	}

	logValidationErrors(errors);
	if (errors.length > 0) return null;
	return Normalize.SplashPayload(payload);
}

function ValidateCutscenePayload(payload, type) {
	if (type !== "rendered" && type !== "engine") {
		logValidationErrors([`cutscene: unknown type '${type}'.`]);
		return null;
	}

	const errors = validatePayloadSchema(payload, type === "rendered" ? "cutsceneRendered" : "cutsceneEngine");
	logValidationErrors(errors);
	if (errors.length > 0) return null;
	return Normalize.CutscenePayload(payload, type);
}

function ValidateLevelPayload(payload) {
	const errors = validatePayloadSchema(payload, "level");

	function validateTexture(rawTexture, path) {
		if (!isPlainObject(rawTexture)) return;
		if (isPlainObject(rawTexture.generated)) errors.push(...validatePayloadSchema(rawTexture.generated, "generatedTexture", `${path}.generated`));
	}

	function validateDetail(rawDetail, path) {
		if (!isPlainObject(rawDetail)) return;
		if (!Array.isArray(rawDetail.scatter)) return; 
		rawDetail.scatter.forEach((rawEntry, index) => {
			errors.push(...validatePayloadSchema(rawEntry, "levelScatterEntry", `${path}.scatter[${index}]`));
		});
	}

	function validatePart(rawPart, path) {
		errors.push(...validatePayloadSchema(rawPart, "levelPart", path));

		const partSource = isPlainObject(rawPart) ? rawPart : {};
		validateTexture(partSource.texture, `${path}.texture`);
		validateDetail(partSource.detail, `${path}.detail`);
	}

	function validateObjectList(rawObjects, path) {
		if (!Array.isArray(rawObjects)) return;

		rawObjects.forEach((rawObject, index) => {
			const objectPath = `${path}[${index}]`;
			if (isTemplateRef(rawObject)) {
				errors.push(...validatePayloadSchema(rawObject, "templateObjectRef", objectPath));
				validateTexture(rawObject.texture, `${objectPath}.texture`);
				return;
			}
			errors.push(...validatePayloadSchema(rawObject, "levelObject", objectPath));

			const objectSource = isPlainObject(rawObject) ? rawObject : {};
			validateTexture(objectSource.texture, `${objectPath}.texture`);
			validateDetail(objectSource.detail, `${objectPath}.detail`);
			if (Array.isArray(objectSource.parts)) {
				objectSource.parts.forEach((rawPart, partIndex) => {
					validatePart(rawPart, `${objectPath}.parts[${partIndex}]`);
				});
			}
		});
	}

	function validateMovement(rawMovement, path) {
		if (isPlainObject(rawMovement)) errors.push(...validatePayloadSchema(rawMovement, "levelMovement", path));
	}

	function validateAttacks(rawAttacks, path) {
		if (!Array.isArray(rawAttacks)) return;

		rawAttacks.forEach((rawAttack, index) => {
			errors.push(...validatePayloadSchema(rawAttack, "levelAttack", `${path}[${index}]`));
		});
	}

	function validateCollisionOverride(rawCollisionOverride, path) {
		if (isPlainObject(rawCollisionOverride)) {
			errors.push(...validatePayloadSchema(rawCollisionOverride, "levelCollisionOverride", path));
		}
	}

	function validateOverride(rawOverride, path) {
		errors.push(...validatePayloadSchema(rawOverride, "levelEntityOverride", path));

		const overrideSource = isPlainObject(rawOverride) ? rawOverride : {};
		validateMovement(overrideSource.movement, `${path}.movement`);
		validateAttacks(overrideSource.attacks, `${path}.attacks`);
		validateCollisionOverride(overrideSource.collisionOverride, `${path}.collisionOverride`);
	}

	function validatePlayer(rawPlayer, path) {
		errors.push(...validatePayloadSchema(rawPlayer, "levelPlayer", path));

		const playerSource = isPlainObject(rawPlayer) ? rawPlayer : {};
		if (Array.isArray(playerSource.modelParts)) {
			playerSource.modelParts.forEach((rawPart, index) => {
				validatePart(rawPart, `${path}.modelParts[${index}]`);
			});
		}
	}

	const rawPayload = isPlainObject(payload) ? payload : {};
	validateObjectList(rawPayload.terrain?.objects, "level.terrain.objects");
	if (Array.isArray(rawPayload.terrain?.triggers)) {
		rawPayload.terrain.triggers.forEach((rawTrigger, index) => {
			errors.push(...validatePayloadSchema(rawTrigger, "levelTrigger", `level.terrain.triggers[${index}]`));
		});
	}
	validateObjectList(rawPayload.obstacles, "level.obstacles");

	const rawBlueprintBuckets = isPlainObject(rawPayload.entityBlueprints) ? rawPayload.entityBlueprints : {};
	["enemies", "npcs", "collectibles", "projectiles", "entities"].forEach((bucket) => {
		const rawEntries = rawBlueprintBuckets[bucket];
		if (!Array.isArray(rawEntries)) return;

		rawEntries.forEach((rawEntry, index) => {
			const path = `level.entityBlueprints.${bucket}[${index}]`;
			if (isTemplateRef(rawEntry)) {
				errors.push(...validatePayloadSchema(rawEntry, "templateEntityRef", path));
				validateCollisionOverride(rawEntry.collisionOverride, `${path}.collisionOverride`);
				return;
			}
			errors.push(...validatePayloadSchema(rawEntry, "levelEntityBlueprint", `${path}.collisionOverride`));

			const blueprintSource = isPlainObject(rawEntry) ? rawEntry : {};
			validateMovement(blueprintSource.movement, `${path}.movement`);
			validateAttacks(blueprintSource.attacks, `${path}.attacks`);
			validateCollisionOverride(blueprintSource.collisionOverride, `${path}.collisionOverride`);

			const modelSource = isPlainObject(blueprintSource.model) ? blueprintSource.model : null;
			if (modelSource !== null && Array.isArray(modelSource.parts)) {
				modelSource.parts.forEach((rawPart, index) => {
					validatePart(rawPart, `${path}.model.parts[${index}]`);
				});
			}
		});
	});

	if (Array.isArray(rawPayload.entities)) {
		rawPayload.entities.forEach((rawEntity, index) => validateOverride(rawEntity, `level.entities[${index}]`));
	}

	if (isPlainObject(rawPayload.player)) validatePlayer(rawPayload.player, "level.player");
	if (isPlainObject(rawPayload.music)) errors.push(...validatePayloadSchema(rawPayload.music, "audio", "level.music"));

	logValidationErrors(errors);
	if (errors.length > 0) return null;
	return Normalize.LevelPayload(payload);
}

async function ValidateSimulatorPayload(payload) {
	const rawPayload = isPlainObject(payload) ? payload : {};
	const payloadType = rawPayload.definition !== undefined ? "definition" : "cached";
	const schemaKey = payloadType === "definition" ? "simulatorDefinition" : "simulatorCached";

	const errors = validatePayloadSchema(payload, schemaKey);

	if (payloadType === "definition" && errors.length === 0) {
		let objectType = null;
		for (const key in rawPayload) {
			if (normalizeSchemaKey(key) === "objecttype") {
				objectType = typeof rawPayload[key] === "string" ? rawPayload[key] : null;
				break;
			}
		}
		const definitionSchemaKey = isTemplateRef(rawPayload.definition)
			? (ENTITY_TYPES.includes(objectType) ? "templateEntityRef" : "templateObjectRef")
			: (ENTITY_TYPES.includes(objectType) ? "levelEntityBlueprint" : "levelObject");
		errors.push(...validatePayloadSchema(rawPayload.definition, definitionSchemaKey, "simulatorDefinition.definition"));
	}

	logValidationErrors(errors);
	if (errors.length > 0) return null;
	const normalized = await Normalize.SimulatorPayload({ ...payload, payloadType });
	if (normalized.payloadType === "definition" && normalized.definition === null) return null;
	return normalized;
}

async function ValidateSimulatorBulkPayload(bulkPayload) {
	const entries = Array.isArray(bulkPayload) ? bulkPayload : [bulkPayload];
	const results = [];
	for (const entry of entries) {
		const validated = await ValidateSimulatorPayload(entry);
		if (validated === null) {
			Log("ENGINE", `Simulator Caching: skipping invalid entry '${entry.definition?.id ?? entry.id ?? "(unknown)"}'.`, "warn", "Validation");
			continue;
		}
		if (validated.payloadType !== "definition") {
			Log("ENGINE", `Simulator Caching: entry '${validated.definition?.id ?? validated.id ?? "(unknown)"}' payloadType must be 'definition', got '${validated.payloadType}', skipping.`, "warn", "Validation");
			continue;
		}
		results.push(validated);
	}
	return results;
}

export {
	ValidateAudioPayload,
	ValidateMenuPayload,
	ValidateSplashPayload,
	ValidateCutscenePayload,
	ValidateLevelPayload,
	ValidateSimulatorPayload,
	ValidateSimulatorBulkPayload,
};