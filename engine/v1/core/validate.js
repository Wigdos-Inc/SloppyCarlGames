import canonSchemas from "./canonSchemas.json" with { type: "json" };
import cameraSets from "../camera/Sets.json" with { type: "json" };
import Normalize, { IsTemplateRef } from "./normalize.js";
import { Log, ENTITY_TYPES } from "./meta.js";

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const normalizeSchemaKey = (key) => key.toLowerCase().replace(/[-_]/g, "");

function validatePayloadSchema(payload, rootKey, rootPath = rootKey) {
	const errors = [];

	// Note: normalize.js resolves the field references in place at load.
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

const logValidationErrors = (errors) => errors.forEach(error => Log("ENGINE", error, "error", "Validation"));

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

		// Accept the raw 'generated' alias, as the schema does.
		const base = rawTexture.base ?? rawTexture.generated;
		if (isPlainObject(base)) errors.push(...validatePayloadSchema(base, "generatedTexture", `${path}.base`));
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

	function validatePartList(rawParts, path) {
		if (!Array.isArray(rawParts)) return;
		rawParts.forEach((rawPart, index) => validatePart(rawPart, `${path}[${index}]`));
	}

	function validateObjectList(rawObjects, path) {
		if (!Array.isArray(rawObjects)) return;

		rawObjects.forEach((rawObject, index) => {
			const objectPath = `${path}[${index}]`;
			if (IsTemplateRef(rawObject)) {
				errors.push(...validatePayloadSchema(rawObject, "templateObjectRef", objectPath));
				validateTexture(rawObject.texture, `${objectPath}.texture`);
				return;
			}
			errors.push(...validatePayloadSchema(rawObject, "levelObject", objectPath));

			const objectSource = isPlainObject(rawObject) ? rawObject : {};
			validateTexture(objectSource.texture, `${objectPath}.texture`);
			validateDetail(objectSource.detail, `${objectPath}.detail`);
			validatePartList(objectSource.parts, `${objectPath}.parts`);
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

	// Check the skybox color's shape, which follows its mode. One dataType can't express that.
	function validateSkybox(rawWorld, path) {
		if (!isPlainObject(rawWorld) || !isPlainObject(rawWorld.skybox)) return;

		const skybox = rawWorld.skybox;
		if (skybox.color === undefined) return errors.push(`${path}.color: missing required color.`);
		if (skybox.mode === "gradient") {
			if (!Array.isArray(skybox.color)) errors.push(`${path}.color: expected array in 'gradient' mode.`);
			return;
		}
		if (!isPlainObject(skybox.color)) errors.push(`${path}.color: expected object in 'fill' mode.`);
	}

	// Check the camera set. A custom set must author its starting mode.
	function validateCamera(rawCamera, path) {
		const activeSet = rawCamera?.activeSet;
		if (activeSet === "custom") {
			if (!cameraSets.modes.includes(rawCamera.situations?.slowMovement)) errors.push(`${path}.situations.slowMovement: required mode when activeSet is 'custom'.`);
			return;
		}
		if (typeof activeSet === "string" && !Object.hasOwn(cameraSets.sets, activeSet)) errors.push(`${path}.activeSet: '${activeSet}' not allowed.`);
	}

	function validateTrigger(rawTrigger, path) {
		errors.push(...validatePayloadSchema(rawTrigger, "levelTrigger", path));
		if (rawTrigger?.type !== "camera") return;

		const mode = rawTrigger.payload?.mode;
		if (mode !== "release" && !cameraSets.modes.includes(mode)) errors.push(`${path}.payload.mode: '${mode}' is not a camera mode or 'release'.`);
	}

	function validatePlayer(rawPlayer, path) {
		errors.push(...validatePayloadSchema(rawPlayer, "levelPlayer", path));

		const playerSource = isPlainObject(rawPlayer) ? rawPlayer : {};
		validatePartList(playerSource.modelParts, `${path}.modelParts`);
	}

	// Note: Object and entity template parts may repeat, unlike payload parts.
	function validateTemplateParts(rawParts, path) {
		if (!Array.isArray(rawParts)) return;

		rawParts.forEach((rawPart, index) => {
			validatePart(rawPart, `${path}[${index}]`);
			if (isPlainObject(rawPart) && isPlainObject(rawPart.repeat)) {
				errors.push(...validatePayloadSchema(rawPart.repeat, "partRepeat", `${path}[${index}].repeat`));
			}
		});
	}

	function validateScatterTemplate(rawTemplate, path) {
		errors.push(...validatePayloadSchema(rawTemplate, "scatterTemplate", path));

		const parts = isPlainObject(rawTemplate) && Array.isArray(rawTemplate.parts) ? rawTemplate.parts : [];
		parts.forEach((rawPart, index) => {
			errors.push(...validatePayloadSchema(rawPart, "scatterTemplatePart", `${path}.parts[${index}]`));
			validateTexture(rawPart?.texture, `${path}.parts[${index}].texture`);
		});
	}

	function validateObjectTemplate(rawTemplate, path) {
		errors.push(...validatePayloadSchema(rawTemplate, "objectTemplate", path));

		const templateSource = isPlainObject(rawTemplate) ? rawTemplate : {};
		if (isPlainObject(templateSource.shared)) {
			errors.push(...validatePayloadSchema(templateSource.shared, "objectTemplateShared", `${path}.shared`));
			validateTexture(templateSource.shared.texture, `${path}.shared.texture`);
			validateDetail(templateSource.shared.detail, `${path}.shared.detail`);
		}
		
		// Require at least one part. A template has no shape of its own.
		if (Array.isArray(templateSource.parts) && templateSource.parts.length === 0) errors.push(`${path}.parts: needs at least one part.`);
		validateTemplateParts(templateSource.parts, `${path}.parts`);
	}

	function validateEntityTemplate(rawTemplate, path) {
		errors.push(...validatePayloadSchema(rawTemplate, "entityTemplate", path));

		const templateSource = isPlainObject(rawTemplate) ? rawTemplate : {};
		validateMovement(templateSource.movement, `${path}.movement`);
		validateAttacks(templateSource.attacks, `${path}.attacks`);
		validateCollisionOverride(templateSource.collisionOverride, `${path}.collisionOverride`);
		if (isPlainObject(templateSource.model)) validateTemplateParts(templateSource.model.parts, `${path}.model.parts`);
	}

	// Check every game template in each collection by its id.
	function validateTemplates(rawTemplates) {
		const templates = isPlainObject(rawTemplates) ? rawTemplates : {};
		const collection = (name) => isPlainObject(templates[name]) ? templates[name] : {};
		const path = (name, id) => `level.templates.${name}.${id}`;

		const textures = collection("textures");
		for (const id in textures) errors.push(...validatePayloadSchema(textures[id], "textureTemplate", path("textures", id)));

		const scatter = collection("scatter");
		for (const id in scatter) validateScatterTemplate(scatter[id], path("scatter", id));

		const particles = collection("particles");
		for (const id in particles) {
			errors.push(...validatePayloadSchema(particles[id], "particleTemplate", path("particles", id)));
			if (isPlainObject(particles[id]?.part)) validatePart(particles[id].part, `${path("particles", id)}.part`);
		}

		for (const name of ["terrain", "obstacles"]) {
			const objects = collection(name);
			for (const id in objects) validateObjectTemplate(objects[id], path(name, id));
		}

		for (const name of ["npcs", "projectiles"]) {
			const entities = collection(name);
			for (const id in entities) validateEntityTemplate(entities[id], path(name, id));
		}

		const playerCharacters = collection("playerCharacters");
		for (const id in playerCharacters) {
			errors.push(...validatePayloadSchema(playerCharacters[id], "playerCharacterTemplate", path("playerCharacters", id)));
			validatePartList(playerCharacters[id]?.model?.parts, `${path("playerCharacters", id)}.model.parts`);
		}
	}

	const rawPayload = isPlainObject(payload) ? payload : {};

	// Note: Templates go first. The rest of the payload may reference them.
	validateTemplates(rawPayload.templates);

	validateSkybox(rawPayload.world, "level.world.skybox");
	validateCamera(rawPayload.camera, "level.camera");
	validateObjectList(rawPayload.terrain?.objects, "level.terrain.objects");
	if (Array.isArray(rawPayload.terrain?.triggers)) {
		rawPayload.terrain.triggers.forEach((rawTrigger, index) => validateTrigger(rawTrigger, `level.terrain.triggers[${index}]`));
	}
	validateObjectList(rawPayload.obstacles, "level.obstacles");

	const rawBlueprintBuckets = isPlainObject(rawPayload.entityBlueprints) ? rawPayload.entityBlueprints : {};
	["enemies", "npcs", "collectibles", "projectiles", "entities"].forEach(bucket => {
		const rawEntries = rawBlueprintBuckets[bucket];
		if (!Array.isArray(rawEntries)) return;

		rawEntries.forEach((rawEntry, index) => {
			const path = `level.entityBlueprints.${bucket}[${index}]`;
			if (IsTemplateRef(rawEntry)) {
				errors.push(...validatePayloadSchema(rawEntry, "templateEntityRef", path));
				validateCollisionOverride(rawEntry.collisionOverride, `${path}.collisionOverride`);
				return;
			}
			errors.push(...validatePayloadSchema(rawEntry, "levelEntityBlueprint", path));

			const blueprintSource = isPlainObject(rawEntry) ? rawEntry : {};
			validateMovement(blueprintSource.movement, `${path}.movement`);
			validateAttacks(blueprintSource.attacks, `${path}.attacks`);
			validateCollisionOverride(blueprintSource.collisionOverride, `${path}.collisionOverride`);
			validatePartList(blueprintSource.model?.parts, `${path}.model.parts`);
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
		const definitionSchemaKey = IsTemplateRef(rawPayload.definition)
			? (ENTITY_TYPES.includes(objectType) ? "templateEntityRef" : "templateObjectRef")
			: (ENTITY_TYPES.includes(objectType) ? "levelEntityBlueprint" : "levelObject");
		errors.push(...validatePayloadSchema(rawPayload.definition, definitionSchemaKey, "simulatorDefinition.definition"));
	}

	logValidationErrors(errors);
	if (errors.length > 0) return null;
	const normalized = await Normalize.SimulatorPayload({ ...payload, payloadType });
	if (normalized.payloadType === "definition" && normalized.definition === null) return null;

	// Reject a void, which leaves the Simulator nothing to show. Parts share the root's mode.
	// Note: A template ref is checked by its own mode. Engine templates are never voids.
	if (normalized.payloadType === "definition" && normalized.definition.mode === "void") {
		Log("ENGINE", `Simulator: '${normalized.definition.id}' is made only of voids, which the Simulator can't show.`, "error", "Validation");
		return null;
	}
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

/* === RUNTIME REQUESTS === */

// Validate and normalize small fire-and-forget requests from the running game.
// Note: Scene lookups come in as a resolver function. core/ can't import handlers/.
const ValidateRuntime = {
	Particles: (request, generator, resolveTarget) => {
		const errors = validatePayloadSchema(request, "particleRequest");
		const rawRequest = isPlainObject(request) ? request : {};

		if (generator === true) {
			const targetError = ValidateRuntime.helpers.targetExists(resolveTarget, rawRequest.target);
			if (targetError !== null) errors.push(targetError);
		}

		logValidationErrors(errors);
		if (errors.length > 0) return null;

		// Normalize the request, rejecting it when its template id doesn't exist.
		const normalized = Normalize.Runtime.Particles(request, generator);
		if (normalized === null) {
			logValidationErrors(["particleRequest.id: unknown particle template."]);
			return null;
		}
		return normalized;
	},

	helpers: {
		// Check whether a generator's target is a scene object of the right type, with the named part.
		targetExists(resolveTarget, target) {
			if (!isPlainObject(target)) return "particleRequest.target: required when requesting a generator.";

			// Treat an omitted partId as the object's own transform, not a missing part.
			const partId = target.partId ?? null;
			const entry  = resolveTarget(target.id, partId);
			if (entry === undefined)           return `particleRequest.target: no scene object with id '${target.id}'.`;
			if (entry.type !== target.type)    return `particleRequest.target: '${target.id}' is type '${entry.type}', not '${target.type}'.`;
			if (entry.transform === undefined) return `particleRequest.target: '${target.id}' has no part '${partId}'.`;
			return null;
		},
	},
};

export {
	ValidateAudioPayload,
	ValidateMenuPayload,
	ValidateSplashPayload,
	ValidateCutscenePayload,
	ValidateLevelPayload,
	ValidateSimulatorPayload,
	ValidateSimulatorBulkPayload,
	ValidateRuntime,
};