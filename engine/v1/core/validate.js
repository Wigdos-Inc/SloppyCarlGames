
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

function isUnit(value, expectedType) {
	if (!isObject(value)) return false;
	if (typeof value.value !== "number" || !Number.isFinite(value.value)) return false;
	if (expectedType && value.type !== expectedType) return false;
	return true;
}

function isUnitVector3(value, expectedType) {
	if (!isObject(value)) return false;
	if (typeof value.x !== "number" || !Number.isFinite(value.x)) return false;
	if (typeof value.y !== "number" || !Number.isFinite(value.y)) return false;
	if (typeof value.z !== "number" || !Number.isFinite(value.z)) return false;
	if (expectedType && value.type !== expectedType) return false;
	return true;
}

function isAllowedEntityCollisionShape(value) {
	return (
		value === null
		|| value === "sphere"
		|| value === "aabb"
		|| value === "capsule"
		|| value === "obb"
		|| value === "compound-sphere"
	);
}

function validateNormalizedUIElementTree(element, path) {
	if (!isObject(element)) {
		Log("ENGINE", `UI payload normalization produced invalid element at '${path}'.`, "error", "Validation");
		return false;
	}

	if (!Array.isArray(element.children)) {
		Log("ENGINE", `UI payload normalization produced invalid children array at '${path}.children'.`, "error", "Validation");
		return false;
	}

	if (!isObject(element.events)) {
		Log("ENGINE", `UI payload normalization produced invalid events map at '${path}.events'.`, "error", "Validation");
		return false;
	}

	if (!isObject(element.on)) {
		Log("ENGINE", `UI payload normalization produced invalid on map at '${path}.on'.`, "error", "Validation");
		return false;
	}

	for (let index = 0; index < element.children.length; index += 1) {
		if (!validateNormalizedUIElementTree(element.children[index], `${path}.children[${index}]`)) {
			return false;
		}
	}

	return true;
}

function validateNormalizedWorld(world) {
	return (
		isObject(world)
		&& isUnit(world.length, "cnu")
		&& isUnit(world.width, "cnu")
		&& isUnit(world.height, "cnu")
		&& isUnit(world.deathBarrierY, "cnu")
		&& (world.waterLevel === null || isUnit(world.waterLevel, "cnu"))
		&& typeof world.textureScale === "number"
		&& Number.isFinite(world.textureScale)
		&& typeof world.scatterScale === "number"
		&& Number.isFinite(world.scatterScale)
	);
}

function validateNormalizedCamera(camera) {
	return (
		isObject(camera)
		&& camera.mode === "stationary"
		&& isObject(camera.levelOpening)
		&& isUnitVector3(camera.levelOpening.startPosition, "cnu")
		&& isUnitVector3(camera.levelOpening.endPosition, "cnu")
		&& isUnit(camera.distance, "cnu")
		&& isUnit(camera.heightOffset, "cnu")
		&& typeof camera.sensitivity === "number"
		&& Number.isFinite(camera.sensitivity)
	);
}

function validateNormalizedPlayerModelPart(part) {
	const validEntityFaces = ["front", "back", "left", "right", "top", "bottom", "center"];
	return (
		isObject(part)
		&& typeof part.id === "string"
		&& part.id.length > 0
		&& typeof part.shape === "string"
		&& part.shape.length > 0
		&& typeof part.complexity === "string"
		&& part.complexity.length > 0
		&& typeof part.parentId === "string"
		&& part.parentId.length > 0
		&& typeof part.anchorPoint === "string"
		&& part.anchorPoint.length > 0
		&& validEntityFaces.includes(part.anchorPoint)
		&& typeof part.attachmentPoint === "string"
		&& part.attachmentPoint.length > 0
		&& validEntityFaces.includes(part.attachmentPoint)
		&& isUnitVector3(part.localPosition, "cnu")
		&& isUnitVector3(part.localRotation, "radians")
		&& isUnitVector3(part.dimensions, "cnu")
		&& isUnitVector3(part.pivot, "cnu")
		&& isObject(part.localScale)
		&& typeof part.localScale.x === "number"
		&& Number.isFinite(part.localScale.x)
		&& typeof part.localScale.y === "number"
		&& Number.isFinite(part.localScale.y)
		&& typeof part.localScale.z === "number"
		&& Number.isFinite(part.localScale.z)
		&& isObject(part.primitiveOptions)
		&& validateNormalizedTextureDescriptor(part.texture)
		&& isObject(part.detail)
		&& Array.isArray(part.detail.scatter)
	);
}

function validateNormalizedModelParts(parts, contextPath) {
	if (!Array.isArray(parts) || parts.length === 0) {
		Log("ENGINE", `Level payload normalization failed: ${contextPath} must be a non-empty array.`, "error", "Validation");
		return false;
	}

	const partIds = new Set();
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index];
		if (!validateNormalizedPlayerModelPart(part)) {
			Log("ENGINE", `Level payload normalization failed: ${contextPath}[${index}] has invalid normalized model-part data.`, "error", "Validation");
			return false;
		}

		if (partIds.has(part.id)) {
			Log("ENGINE", `Level payload normalization failed: ${contextPath}[${index}] duplicates part id '${part.id}'.`, "error", "Validation");
			return false;
		}

		partIds.add(part.id);
	}

	for (let index = 0; index < parts.length; index++) {
		const part = parts[index];
		if (part.parentId !== "root" && !partIds.has(part.parentId)) {
			Log("ENGINE", `Level payload normalization failed: ${contextPath}[${index}] references missing parentId '${part.parentId}'.`, "error", "Validation");
			return false;
		}
	}

	return true;
}

function validateNormalizedTextureDescriptor(texture) {
	return (
		isObject(texture)
		&& typeof texture.textureID === "string"
		&& texture.textureID.length > 0
		&& typeof texture.baseTextureID === "string"
		&& texture.baseTextureID.length > 0
		&& typeof texture.materialTextureID === "string"
		&& texture.materialTextureID.length > 0
		&& isObject(texture.color)
		&& typeof texture.color.r === "number"
		&& Number.isFinite(texture.color.r)
		&& typeof texture.color.g === "number"
		&& Number.isFinite(texture.color.g)
		&& typeof texture.color.b === "number"
		&& Number.isFinite(texture.color.b)
		&& typeof texture.color.a === "number"
		&& Number.isFinite(texture.color.a)
		&& typeof texture.opacity === "number"
		&& Number.isFinite(texture.opacity)
		&& typeof texture.density === "number"
		&& Number.isFinite(texture.density)
		&& typeof texture.speckSize === "number"
		&& Number.isFinite(texture.speckSize)
		&& typeof texture.animated === "boolean"
		&& typeof texture.holdTimeSpeed === "number"
		&& Number.isFinite(texture.holdTimeSpeed)
		&& typeof texture.blendTimeSpeed === "number"
		&& Number.isFinite(texture.blendTimeSpeed)
	);
}

function validateNormalizedPlayer(player) {
	if (!isObject(player)) return false;

	if (!Array.isArray(player.modelParts)) return false;

	for (let index = 0; index < player.modelParts.length; index++) {
		if (!validateNormalizedPlayerModelPart(player.modelParts[index])) return false;
	}
	// Optional metaOverrides must normalize to an object if present; collisionHalfExtents should be vector-like if present
	if (player.metaOverrides !== undefined) {
		if (!isObject(player.metaOverrides)) return false;
		if (player.metaOverrides.collisionHalfExtents !== undefined) {
			if (!isVector3(player.metaOverrides.collisionHalfExtents)) return false;
		}
	}

	return (
		typeof player.character === "string"
		&& player.character.length > 0
		&& isUnitVector3(player.spawnPosition, "cnu")
		&& isObject(player.scale)
		&& typeof player.scale.x === "number"
		&& Number.isFinite(player.scale.x)
		&& typeof player.scale.y === "number"
		&& Number.isFinite(player.scale.y)
		&& typeof player.scale.z === "number"
		&& Number.isFinite(player.scale.z)
	);
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

function validateBlueprintList(list, key) {
	if (!Array.isArray(list)) {
		Log(
			"ENGINE", 
			`Level payload normalization failed: entityBlueprints.${key} must be an array.`, 
			"error", 
			"Validation"
		);
		return false;
	}

	for (let index = 0; index < list.length; index += 1) {
		const entry = list[index];
		if (
			!isObject(entry)
			|| typeof entry.id !== "string"
			|| entry.id.length === 0
			|| !isObject(entry.model)
			|| !validateNormalizedModelParts(entry.model.parts, `entityBlueprints.${key}[${index}].model.parts`)
		) {
			Log(
				"ENGINE", 
				`Level payload normalization failed: entityBlueprints.${key}[${index}] must resolve to a canonical blueprint with valid model parts.`, 
				"error", 
				"Validation"
			);
			return false;
		}
	}

	return true;
}

function validateNormalizedLevelCollections(payload) {
	if (!Array.isArray(payload.terrain.objects)) {
		Log("ENGINE", "Level payload normalization failed: terrain.objects must be an array.", "error", "Validation");
		return false;
	}

	if (!Array.isArray(payload.terrain.triggers)) {
		Log("ENGINE", "Level payload normalization failed: terrain.triggers must be an array.", "error", "Validation");
		return false;
	}

	for (let index = 0; index < payload.terrain.objects.length; index += 1) {
		const object = payload.terrain.objects[index];
		if (
			!isObject(object) || 
			typeof object.id !== "string" || 
			!isVector3(object.position) || 
			!isVector3(object.dimensions) || 
			!isVector3(object.scale) || 
			!validateNormalizedTextureDescriptor(object.texture)
		) {
			Log(
				"ENGINE", 
				`Level payload normalization failed: terrain.objects[${index}] must include id, position, dimensions, scale, and canonical texture data.`, 
				"error", 
				"Validation"
			);
			return false;
		}
	}

	for (let index = 0; index < payload.terrain.triggers.length; index += 1) {
		const trigger = payload.terrain.triggers[index];
		if (
			!isObject(trigger) || 
			typeof trigger.id !== "string" || 
			trigger.id.length === 0 || 
			typeof trigger.type !== "string" || 
			trigger.type.length === 0 || 
			!isVector3(trigger.start) || 
			!isVector3(trigger.end)
		) {
			Log(
				"ENGINE", 
				`Level payload normalization failed: terrain.triggers[${index}] must include id, type, and start/end vectors.`, 
				"error", 
				"Validation"
			);
			return false;
		}

		if (!isObject(trigger.payload)) {
			Log(
				"ENGINE", 
				`Level payload normalization failed: terrain.triggers[${index}].payload must normalize to an object.`, 
				"error", 
				"Validation"
			);
			return false;
		}

		if (typeof trigger.activateOnce !== "boolean") {
			Log(
				"ENGINE", 
				`Level payload normalization failed: terrain.triggers[${index}].activateOnce must normalize to a boolean.`, 
				"error", 
				"Validation"
			);
			return false;
		}
	}

	if (!Array.isArray(payload.obstacles)) {
		Log("ENGINE", "Level payload normalization failed: obstacles must be an array.", "error", "Validation");
		return false;
	}

	for (let index = 0; index < payload.obstacles.length; index += 1) {
		const obstacle = payload.obstacles[index];
		if (!isObject(obstacle) || typeof obstacle.id !== "string" || !isVector3(obstacle.position) || !isVector3(obstacle.dimensions) || !isVector3(obstacle.scale) || !validateNormalizedTextureDescriptor(obstacle.texture)) {
			Log(
				"ENGINE", 
				`Level payload normalization failed: obstacles[${index}] must include id, position, dimensions, scale, and canonical texture data.`, 
				"error", 
				"Validation"
			);
			return false;
		}
	}

	if (!Array.isArray(payload.entities)) {
		Log("ENGINE", "Level payload normalization failed: entities must be an array.", "error", "Validation");
		return false;
	}

	for (let index = 0; index < payload.entities.length; index += 1) {
		const entity = payload.entities[index];
		if (
			!isObject(entity)
			|| typeof entity.id !== "string"
			|| typeof entity.type !== "string"
			|| !isObject(entity.movement)
			|| !isVector3(entity.movement.start)
			|| !isVector3(entity.movement.end)
			|| !isObject(entity.model)
			|| !Array.isArray(entity.model.parts)
			|| entity.model.parts.length === 0
			|| !isVector3(entity.velocity)
			|| !Array.isArray(entity.attacks)
			|| !isObject(entity.hardcoded)
			|| !isObject(entity.animations)
			|| typeof entity.simRadiusPadding !== "number"
			|| !Number.isFinite(entity.simRadiusPadding)
			|| !isObject(entity.collisionCapsule)
			|| !isObject(entity.collisionOverride)
			|| !isAllowedEntityCollisionShape(entity.collisionOverride.physics)
			|| !isAllowedEntityCollisionShape(entity.collisionOverride.hurtbox)
			|| !isAllowedEntityCollisionShape(entity.collisionOverride.hitbox)
		) {
			Log(
				"ENGINE", 
				`Level payload normalization failed: entities[${index}] is missing required normalized fields.`, 
				"error", 
				"Validation"
			);
			return false;
		}

		if (!validateNormalizedModelParts(entity.model.parts, `entities[${index}].model.parts`)) return false;
	}

	if (!isObject(payload.entityBlueprints)) {
		Log("ENGINE", "Level payload normalization failed: entityBlueprints must be an object.", "error", "Validation");
		return false;
	}

	if (!validateBlueprintList(payload.entityBlueprints.enemies, "enemies")) return false;
	if (!validateBlueprintList(payload.entityBlueprints.npcs, "npcs")) return false;
	if (!validateBlueprintList(payload.entityBlueprints.collectibles, "collectibles")) return false;
	if (!validateBlueprintList(payload.entityBlueprints.projectiles, "projectiles")) return false;
	if (!validateBlueprintList(payload.entityBlueprints.entities, "entities")) return false;

	return true;
}

function ValidateMenuUIPayload(payload) {
	// Accept common top-level aliases so validation accepts variant payloads
	if (isObject(payload)) {
		if (!Array.isArray(payload.elements) && Array.isArray(payload.items)) payload.elements = payload.items;
		if (!payload.rootId && (typeof payload.root === "string")) payload.rootId = payload.root;
		if (!payload.screenId && (typeof payload.screen === "string")) payload.screenId = payload.screen;
	}
	const errors = [];
	if (!isObject(payload)) {
		errors.push("payload must be an object");
	} 
	else {
		if (typeof payload.screenId !== "string" || payload.screenId.length === 0) {
			errors.push("'screenId' must be a non-empty string");
		}
		if (!Array.isArray(payload.elements)) {
			errors.push("'elements' must be an array");
		}
	}

	if (errors.length > 0) {
		Log("ENGINE", `Invalid Payload. Example valid menuUI payload: \n${JSON.stringify(exampleMenuUIPayload, null, 2)}`, "error", "Validation");
		Log("ENGINE", `Menu UI payload rejected:\n- ${errors.join("\n- ")}.`, "error", "Validation");
		return null;
	}

	payload = Normalize.MenuUIPayload(payload);
	if (!isObject(payload) || !Array.isArray(payload.elements) || typeof payload.rootId !== "string") {
		Log("ENGINE", "Menu UI payload normalization failed to produce required top-level shape.", "error", "Validation");
		return null;
	}

	for (let index = 0; index < payload.elements.length; index++) {
		if (!validateNormalizedUIElementTree(payload.elements[index], `elements[${index}]`)) return null;
	}
	
    return payload;
}

function ValidateSplashPayload(payload) {
	// No payload provided — use engine default
	if (payload === null || payload === undefined) return { presetId: null, sequence: [], outputType: "default" };

	const normalizeSplashPresetId = (presetId) => {
		return presetId
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "")
			.trim();
	};

	const isAllowedSplashPresetId = (presetId) => {
		const normalizedPresetId = normalizeSplashPresetId(presetId);
		return (
			normalizedPresetId === "default" ||
			normalizedPresetId === "all" ||
			normalizedPresetId === "sloppycarlgames" ||
			normalizedPresetId === "sloppycarl" ||
			normalizedPresetId === "wigdosstudios" ||
			normalizedPresetId === "wigdos" ||
			normalizedPresetId === "carlnetengine" ||
			normalizedPresetId === "carlnet"
		);
	};

	const errors = [];
	const validateRawSplashStep = (step, index, path) => {
		if (!isObject(step)) {
			errors.push(`'${path}[${index}]' must be an object`);
			return;
		}

		if (typeof step.image !== "string" || step.image.length === 0) {
			errors.push(`'${path}[${index}].image' must be a non-empty string`);
		}

		if (Object.prototype.hasOwnProperty.call(step, "elements") && !Array.isArray(step.elements)) {
			errors.push(`'${path}[${index}].elements' must be an array when provided`);
		}

		if (Object.prototype.hasOwnProperty.call(step, "text")) {
			if (!Array.isArray(step.text)) {
				errors.push(`'${path}[${index}].text' must be an array when provided`);
			} else {
				for (let textIndex = 0; textIndex < step.text.length; textIndex += 1) {
					const entry = step.text[textIndex];
					if (!isObject(entry)) {
						errors.push(`'${path}[${index}].text[${textIndex}]' must be an object`);
						continue;
					}

					const content =
						typeof entry.content === "string" && entry.content.length > 0
							? entry.content
							: typeof entry.text === "string" && entry.text.length > 0
								? entry.text
								: typeof entry.label === "string" && entry.label.length > 0
									? entry.label
									: typeof entry.caption === "string" && entry.caption.length > 0
										? entry.caption
										: "";

					if (content.length === 0) {
						errors.push(`'${path}[${index}].text[${textIndex}]' must include non-empty content/text/label/caption`);
					}
				}
			}
		}

		if (Object.prototype.hasOwnProperty.call(step, "sfx") && step.sfx !== null) {
			if (!isObject(step.sfx)) {
				errors.push(`'${path}[${index}].sfx' must be an object when provided`);
			} else {
				const hasSfxSrc = (typeof step.sfx.src === "string" && step.sfx.src.length > 0)
					|| (typeof step.sfx.file === "string" && step.sfx.file.length > 0)
					|| (typeof step.sfx.url === "string" && step.sfx.url.length > 0)
					|| (typeof step.sfx.path === "string" && step.sfx.path.length > 0)
					|| (typeof step.sfx.source === "string" && step.sfx.source.length > 0);
				if (!hasSfxSrc) errors.push(`'${path}[${index}].sfx' must include a non-empty src/file/url/path/source`);
			}
		}

		if (Object.prototype.hasOwnProperty.call(step, "voice") && step.voice !== null) {
			if (!isObject(step.voice)) {
				errors.push(`'${path}[${index}].voice' must be an object when provided`);
			} else {
				const hasVoiceSrc = (typeof step.voice.src === "string" && step.voice.src.length > 0)
					|| (typeof step.voice.file === "string" && step.voice.file.length > 0)
					|| (typeof step.voice.url === "string" && step.voice.url.length > 0)
					|| (typeof step.voice.path === "string" && step.voice.path.length > 0)
					|| (typeof step.voice.source === "string" && step.voice.source.length > 0);
				if (!hasVoiceSrc) errors.push(`'${path}[${index}].voice' must include a non-empty src/file/url/path/source`);
			}
		}
	};

	if (typeof payload === "string") {
		if (payload.length === 0) errors.push("'payload' string must be non-empty");
		if (payload.length > 0 && !isAllowedSplashPresetId(payload)) {
			errors.push("'payload' preset id is not supported by the engine splash handler");
		}
	}

	if (Array.isArray(payload)) {
		if (payload.length === 0) {
			errors.push("'payload' sequence must not be empty");
		} else {
			for (let index = 0; index < payload.length; index++) {
				validateRawSplashStep(payload[index], index, "payload");
			}
		}
	}

	if (isObject(payload)) {
		const rawPresetId = payload.presetId || payload.splashId || payload.id;
		const hasPreset = typeof rawPresetId === "string" && rawPresetId.length > 0;
		const rawSequence = Array.isArray(payload.sequence)
			? payload.sequence
			: Array.isArray(payload.steps)
				? payload.steps
				: null;
		const hasSequence = Array.isArray(rawSequence);

		if (!hasPreset && !hasSequence) {
			errors.push("'payload' must include a non-empty presetId/splashId/id or a sequence/steps array");
		}

		if (hasPreset && !isAllowedSplashPresetId(rawPresetId)) {
			errors.push("'payload.presetId' is not supported by the engine splash handler");
		}

		if (hasSequence) {
			if (rawSequence.length === 0) {
				errors.push("'payload.sequence' must not be empty when provided");
			} else {
				for (let index = 0; index < rawSequence.length; index += 1) {
					validateRawSplashStep(rawSequence[index], index, "payload.sequence");
				}
			}
		}
	}

	if (!isObject(payload) && !Array.isArray(payload) && typeof payload !== "string") {
		errors.push("'payload' must be a string preset id, sequence array, or splash payload object");
	}

	if (errors.length > 0) {
		Log("ENGINE", `Splash payload rejected:\n\n${errors.join("\n")}.\n\nUsing engine default.`, "warn", "Validation");
		return { presetId: null, sequence: [], outputType: "default" };
	}

	const normalized = Normalize.SplashPayload(payload);
	if (normalized === null) {
		Log("ENGINE", "Splash payload normalization failed. Using engine default.", "warn", "Validation");
		return { presetId: null, sequence: [], outputType: "default" };
	}

	if (!isObject(normalized) || !Array.isArray(normalized.sequence)) {
		Log(
			"ENGINE", 
			"Splash payload normalization failed to produce required shape. Using engine default.", 
			"warn", 
			"Validation"
		);
		return { presetId: null, sequence: [], outputType: "default" };
	}

	if (normalized.presetId !== null && (typeof normalized.presetId !== "string" || normalized.presetId.length === 0)) {
		Log(
			"ENGINE", 
			"Splash payload normalization produced invalid presetId. Using engine default.", 
			"warn", 
			"Validation"
		);
		return { presetId: null, sequence: [], outputType: "default" };
	}

	for (let index = 0; index < normalized.sequence.length; index += 1) {
		const step = normalized.sequence[index];
		if (
			!isObject(step)
			|| typeof step.image !== "string"
			|| step.image.length === 0
			|| !Array.isArray(step.elements)
			|| !Array.isArray(step.text)
		) {
			Log(
				"ENGINE", 
				`Splash payload normalization produced invalid step at sequence[${index}]. Using engine default.`, 
				"error", 
				"Validation"
			);
			return { presetId: null, sequence: [], outputType: "default" };
		}

		for (let textIndex = 0; textIndex < step.text.length; textIndex += 1) {
			const textEntry = step.text[textIndex];
			if (
				!isObject(textEntry)
				|| typeof textEntry.content !== "string"
				|| textEntry.content.length === 0
				|| !isObject(textEntry.styles)
				|| !isObject(textEntry.attributes)
			) {
				Log(
					"ENGINE",
					`Splash payload normalization produced invalid text entry at sequence[${index}].text[${textIndex}]. Using engine default.`,
					"error",
					"Validation"
				);
				return { presetId: null, sequence: [], outputType: "default" };
			}
		}
	}

	return normalized;
}

function ValidateCutscenePayload(payload, cutsceneType) {
	const errors = [];

	const aliases = aliasMap.cutscene;
	const readFirstDefined = (source, keys) => {
		for (let index = 0; index < keys.length; index += 1) {
			const key = keys[index];
			if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
		}
		return undefined;
	};

	if (!isObject(payload)) errors.push("'payload' must be an object");
	else {
		if (cutsceneType === "rendered") {
			const source = readFirstDefined(payload, aliases.rendered.source);
			if (typeof source !== "string" || source.length === 0) {
				errors.push("rendered cutscene requires a non-empty source");
			}
		}

		if (cutsceneType === "engine") {
			const hasData = Object.prototype.hasOwnProperty.call(payload, "data")
				|| Object.prototype.hasOwnProperty.call(payload, "payload")
				|| Object.prototype.hasOwnProperty.call(payload, "scene")
				|| Object.prototype.hasOwnProperty.call(payload, "cutsceneData");
			if (!hasData) errors.push("engine cutscene requires a payload");

			const rawDuration = readFirstDefined(payload, aliases.engine.durationSeconds);
			if (rawDuration !== undefined && rawDuration !== null) {
				const duration = Number(rawDuration);
				if (!Number.isFinite(duration) || duration < 0) {
					errors.push("'durationSeconds' must be a non-negative number when provided");
				}
			}

			const rawFallbackWaitMs = readFirstDefined(payload, aliases.engine.fallbackWaitMs);
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

	if (cutsceneType === "rendered") {
		if (
			typeof normalized.source !== "string"
			|| normalized.source.length === 0
			|| typeof normalized.muted !== "boolean"
			|| typeof normalized.loop !== "boolean"
			|| typeof normalized.fit !== "string"
			|| normalized.fit.length === 0
			|| typeof normalized.fadeOutSeconds !== "number"
			|| !Number.isFinite(normalized.fadeOutSeconds)
			|| normalized.fadeOutSeconds < 0
			|| typeof normalized.fadeLeadSeconds !== "number"
			|| !Number.isFinite(normalized.fadeLeadSeconds)
			|| normalized.fadeLeadSeconds < 0
		) {
			Log("ENGINE", "Cutscene payload normalization produced invalid rendered shape.", "error", "Validation");
			return null;
		}

		return normalized;
	}

	if (cutsceneType === "engine") {
		if (
			typeof normalized.fadeOutSeconds !== "number"
			|| !Number.isFinite(normalized.fadeOutSeconds)
			|| normalized.fadeOutSeconds < 0
			|| typeof normalized.fadeLeadSeconds !== "number"
			|| !Number.isFinite(normalized.fadeLeadSeconds)
			|| normalized.fadeLeadSeconds < 0
		) {
			Log("ENGINE", "Cutscene payload normalization produced invalid engine timing shape.", "error", "Validation");
			return null;
		}

		if (normalized.durationSeconds !== null && (typeof normalized.durationSeconds !== "number" || !Number.isFinite(normalized.durationSeconds))) {
			Log("ENGINE", "Cutscene payload normalization produced invalid durationSeconds.", "error", "Validation");
			return null;
		}

		if (normalized.fallbackWaitMs !== null && (typeof normalized.fallbackWaitMs !== "number" || !Number.isFinite(normalized.fallbackWaitMs))) {
			Log("ENGINE", "Cutscene payload normalization produced invalid fallbackWaitMs.", "error", "Validation");
			return null;
		}

		return normalized;
	}
}

function ValidateLevelPayload(payload) {
	const errors = [];
	const validateRawTrigger = (trigger, index) => {
		if (!isObject(trigger)) {
			errors.push(`'terrain.triggers[${index}]' must be an object`);
			return;
		}

		if (typeof trigger.id !== "string" || trigger.id.length === 0) {
			errors.push(`'terrain.triggers[${index}].id' must be a non-empty string`);
		}

		if (typeof trigger.type !== "string" || trigger.type.length === 0) {
			errors.push(`'terrain.triggers[${index}].type' must be a non-empty string`);
		}

		if (!isVector3(trigger.start)) {
			errors.push(`'terrain.triggers[${index}].start' must be a vector3`);
		}

		if (!isVector3(trigger.end)) {
			errors.push(`'terrain.triggers[${index}].end' must be a vector3`);
		}
	};

	if (!isObject(payload)) {
		errors.push("payload must be an object");
	} else {
		if (typeof payload.id !== "string" || payload.id.length === 0) {
			errors.push("'id' must be a non-empty string");
		}
		if (typeof payload.title !== "string" || payload.title.length === 0) {
			errors.push("'title' must be a non-empty string");
		}
		if (!isObject(payload.world)) {
			errors.push("'world' must be an object");
		}
		if (!isObject(payload.terrain)) {
			errors.push("'terrain' must be an object");
		} else {
			if (!Array.isArray(payload.terrain.objects)) {
				errors.push("'terrain.objects' must be an array");
			}
			if (!Array.isArray(payload.terrain.triggers)) {
				errors.push("'terrain.triggers' must be an array");
			} else {
				for (let index = 0; index < payload.terrain.triggers.length; index++) {
					validateRawTrigger(payload.terrain.triggers[index], index);
				}
			}
		}
		if (!Array.isArray(payload.obstacles)) errors.push("'obstacles' must be an array");
		if (!Array.isArray(payload.entities)) errors.push("'entities' must be an array");
		if (!isObject(payload.entityBlueprints)) errors.push("'entityBlueprints' must be an object");
		if (!isObject(payload.meta)) errors.push("'meta' must be an object");
	}

	if (errors.length > 0) {
		Log("ENGINE", `Invalid Payload. Example valid level payload: \n${JSON.stringify(exampleLevelPayload, null, 2)}`, "error", "Validation");
		Log("ENGINE", `Level payload rejected:\n\n${errors.join("\n")}.`, "error", "Validation");
		return null;
	}

	payload = Normalize.LevelPayload(payload);

	if (!validateNormalizedWorld(payload.world)) {
		Log("ENGINE", "Level payload normalization failed: invalid normalized world config.", "error", "Validation");
		return null;
	}

	if (!validateNormalizedCamera(payload.camera)) {
		Log("ENGINE", "Level payload normalization failed: invalid normalized camera config.", "error", "Validation");
		return null;
	}

	if (!validateNormalizedPlayer(payload.player)) {
		Log("ENGINE", "Level payload normalization failed: invalid normalized player config.", "error", "Validation");
		return null;
	}

	if (!validateNormalizedLevelCollections(payload)) {
		return null;
	}

	if (
		!isObject(payload.meta) || 
		typeof payload.meta.levelId !== "string" || 
		typeof payload.meta.stageId !== "string"
	) {
		Log(
			"ENGINE", 
			"Level payload normalization failed: meta.levelId and meta.stageId must resolve to strings.", 
			"error", 
			"Validation"
		);
		return null;
	}

    return payload;
}



export { ValidateMenuUIPayload, ValidateSplashPayload, ValidateCutscenePayload, ValidateLevelPayload };