import canonSchemas from "./canonSchemas.json" with { type: "json" };
import characterData from "../player/characters.json" with { type: "json" };
import { Log } from "./meta.js";
import { Clamp, ToNumber, Unit, UnitVector3 } from "../math/Utilities.js";
import { CloneVector3 } from "../math/Vector3.js";

function warnLog(text) {
	Log("ENGINE", text, "warn", "Validation");
}

/* Data Type Normalization */

function normalizeString(value, fallback = "") {
	const bool = typeof value === "string";
	return { bool, value: bool ? value : fallback };
}

function normalizeNumber(value, fallback = 0) {
	const number = ToNumber(value, NaN);
	const bool = Number.isFinite(number);
	return { bool, value: bool ? number : fallback };
}

function normalizeBool(value, fallback = false) {
	const bool = typeof value === "boolean";
	return { bool, value: bool ? value : fallback };
}

function normalizeArray(value, fallback = []) {
	const bool = Array.isArray(value);
	return { bool, value: bool ? value : fallback };
}

function normalizeObject(value, fallback = {}) {
	const bool = value !== null && typeof value === "object" && !Array.isArray(value);
	return { bool, value: bool ? value : fallback };
}

function toUnitVector3(vector, type) {
	return new UnitVector3(vector.x, vector.y, vector.z, type);
}

/* Generic Normalization */

function normalizeSchemaKey(key) {
	return key.toLowerCase().replace(/[-_]/g, "");
}

function normalizePayloadSchema(payload, rootKey) {
	const canonLayer = canonSchemas[rootKey];

	function cloneFallback(meta) {
		return normalizeObject(structuredClone(meta.fallback), meta.fallback).value
	}

	function resolveFieldLayer(payloadLayer, canonFieldLayer) {
		const sourceLayer = normalizeObject(payloadLayer).value;
		const resolvedLayer = {};

		for (const key in canonFieldLayer) {
			if (key === "__meta" || key === "__entry") continue;

			const fieldSchema = canonFieldLayer[key];
			const meta = fieldSchema.__meta;
			let matchedKey = null;

			for (const payloadKey in sourceLayer) {
				for (const alias of [key, ...meta.aliases]) {
					if (normalizeSchemaKey(payloadKey) === normalizeSchemaKey(alias)) {
						matchedKey = payloadKey;
						break;
					}
				}

				if (matchedKey !== null) break;
			}

			let resolvedValue;
			if (matchedKey === null) {
				resolvedValue = cloneFallback(meta);

				if (meta.isExpected === true) {
					warnLog(`${rootKey}.${key}: missing, using fallback ${JSON.stringify(meta.fallback)}.`);
				}
			}
			else {
				resolvedValue = sourceLayer[matchedKey];

				if (meta.deprecated === true) {
					warnLog(`${rootKey}.${key}: '${matchedKey}' is deprecated.`);
				}

				let valid = meta.isExpected === false && resolvedValue === null;
				if (!valid) {
					switch (meta.dataType) {
						case "string" : valid = normalizeString(resolvedValue).bool; break;
						case "number" : valid = normalizeNumber(resolvedValue).bool; break;
						case "boolean": valid = normalizeBool(resolvedValue).bool  ; break;
						case "object" : valid = normalizeObject(resolvedValue).bool; break;
						case "array"  : valid = normalizeArray(resolvedValue).bool ; break;
						case "vector3": {
							const resolvedObject = normalizeObject(resolvedValue);
							valid =
								resolvedObject.bool &&
								normalizeNumber(resolvedObject.value.x).bool &&
								normalizeNumber(resolvedObject.value.y).bool &&
								normalizeNumber(resolvedObject.value.z).bool;
							break;
						}
					}
				}

				if (!valid) {
					warnLog(
						`${rootKey}.${key}: invalid ${meta.dataType}, using fallback ${JSON.stringify(meta.fallback)}.`
					);
					resolvedValue = cloneFallback(meta);
				}

				if (meta.range && meta.dataType === "number" && resolvedValue !== null) {
					const clamped = Clamp(resolvedValue, meta.range.min, meta.range.max);
					if (clamped !== resolvedValue) {
						warnLog(`${rootKey}.${key}: clamped ${resolvedValue} to ${clamped}.`);
						resolvedValue = clamped;
					}
				}

				if (meta.allowedValues && meta.dataType === "string" && resolvedValue !== null && !meta.allowedValues.includes(resolvedValue)) {
					warnLog(
						`${rootKey}.${key}: '${resolvedValue}' not allowed, using fallback ${JSON.stringify(meta.fallback)}.`
					);
					resolvedValue = cloneFallback(meta);
				}
			}

			if (fieldSchema.__entry && Array.isArray(resolvedValue)) {
				resolvedValue = resolvedValue.map((entry) => resolveFieldLayer(entry, fieldSchema.__entry));
			}
			else {
				let hasChildren = false;
				for (const childKey in fieldSchema) {
					if (childKey !== "__meta" && childKey !== "__entry") {
						hasChildren = true;
						break;
					}
				}

				if (hasChildren && resolvedValue !== null) resolvedValue = resolveFieldLayer(resolvedValue, fieldSchema);
			}

			resolvedLayer[key] = resolvedValue;
		}

		return resolvedLayer;
	}

	return resolveFieldLayer(normalizeObject(payload).value, canonLayer);
}

function AudioPayload(payload) {
	const rawPayload = normalizeObject(payload).value;
	const rateMeta = canonSchemas.audio.rate.__meta;
	const normalized = normalizePayloadSchema(rawPayload, "audio");
	const rawOptions = normalizeObject(rawPayload.options).value;

	if (normalizeString(rawOptions.id).bool && normalized.id === null) normalized.id = rawOptions.id;
	if (normalizeString(rawOptions.name).bool && normalized.name === null) normalized.name = rawOptions.name;
	if (normalizeNumber(rawOptions.rate).bool && rawPayload.rate === undefined) {
		normalized.rate = Clamp(rawOptions.rate, rateMeta.range.min, rateMeta.range.max);
	}
	if (normalizeBool(rawOptions.loop).bool && rawPayload.loop === undefined) normalized.loop = rawOptions.loop;
	if (normalizeString(rawOptions.category).bool && rawPayload.category === undefined) normalized.category = rawOptions.category;

	if (normalized.name === null) {
		if (normalized.id !== null) normalized.name = normalized.id;
		else if (normalized.src) {
			const sourceParts = normalized.src.split("/");
			const basename = sourceParts[sourceParts.length - 1] || "AUDIO";
			normalized.name = basename.replace(/\.[^.]+$/, "") || "AUDIO";
		}
	}

	const categoryMeta = canonSchemas.audio.category.__meta;
	if (normalized.id === null) normalized.id = normalized.name;
	if (normalized.category !== null && categoryMeta.allowedValues.includes(normalized.category) === false) {
		warnLog(`audio.category: '${normalized.category}' invalid, fallback to null.`);
		normalized.category = categoryMeta.fallback;
	}

	const options = structuredClone(normalized.options);
	if (options.id === undefined && normalized.id !== null) options.id = normalized.id;
	if (options.name === undefined && normalized.name !== null) options.name = normalized.name;
	if (normalized.rate !== null) options.rate = normalized.rate;
	if (normalized.loop !== null) options.loop = normalized.loop;
	if (normalized.category !== null) options.category = normalized.category;
	normalized.options = options;

	return normalized;
}

function MenuUIPayload(payload) {
	const normalizeElements = (rawElements) => {
		const resolved = [];
		const sourceElements = normalizeArray(rawElements).value;
		const directEventKeys = [
			"onClick",
			"onInput",
			"onChange",
			"onPointerover",
			"onPointerout",
			"onPointerdown",
			"onPointerup",
			"onKeydown",
			"onKeyup",
			"onWheel",
			"onMousemove"
		];

		sourceElements.forEach((rawEntry) => {
			const rawElement = normalizeObject(rawEntry).value;
			const element = normalizePayloadSchema(rawElement, "menuElement");
			element.children = normalizeElements(rawElement.children);

			directEventKeys.forEach((directKey) => {
				if (rawElement[directKey] !== undefined) element[directKey] = rawElement[directKey];
			});

			if (element.id === null) delete element.id;
			if (element.className === null) delete element.className;
			if (element.text === null) delete element.text;
			if (element.src === null) delete element.src;
			if (element.value === null) delete element.value;
			if (element.checked === null) delete element.checked;

			resolved.push(element);
		});

		return resolved;
	};

	const rawPayload = normalizeObject(payload).value;
	const normalized = normalizePayloadSchema(rawPayload, "menu");

	normalized.elements = normalizeElements(rawPayload.elements);
	const musicSource = normalizeObject(rawPayload.music);
	normalized.music = musicSource.bool ? AudioPayload(musicSource.value) : null;

	return normalized;
}

function SplashPayload(payload) {
	const normalizeElements = (rawElements) => {
		const resolved = [];

		normalizeArray(rawElements).value.forEach((rawEntry) => {
			const rawElement = normalizeObject(rawEntry).value;
			const element = normalizePayloadSchema(rawElement, "menuElement");
			element.children = normalizeElements(rawElement.children);
			if (element.id === null) delete element.id;
			if (element.className === null) delete element.className;
			if (element.text === null) delete element.text;
			if (element.src === null) delete element.src;
			if (element.value === null) delete element.value;
			if (element.checked === null) delete element.checked;
			resolved.push(element);
		});

		return resolved;
	};

	const normalizeText = (rawTextEntries) => {
		const resolved = [];

		normalizeArray(rawTextEntries).value.forEach((rawEntry) => {
			const textEntry = normalizePayloadSchema(normalizeObject(rawEntry).value, "splashText");
			if (textEntry.id === null) delete textEntry.id;
			if (textEntry.className === null) delete textEntry.className;
			resolved.push(textEntry);
		});

		return resolved;
	};

	const rawPayload = normalizeObject(payload).value;
	const normalized = normalizePayloadSchema(rawPayload, "splash");

	normalized.sequence = normalizeArray(rawPayload.sequence).value.map((rawStep) => {
		const stepSource = normalizeObject(rawStep).value;
		const step = normalizePayloadSchema(stepSource, "splashStep");
		const sfxSource = normalizeObject(stepSource.sfx);
		const voiceSource = normalizeObject(stepSource.voice);
		step.sfx = sfxSource.bool ? AudioPayload(sfxSource.value) : null;
		step.voice = voiceSource.bool ? AudioPayload(voiceSource.value) : null;
		if (step.sfx !== null && step.sfx.category === null) {
			step.sfx.category = "Menu";
			step.sfx.options.category = "Menu";
		}
		if (step.voice !== null && step.voice.category === null) {
			step.voice.category = "Voice";
			step.voice.options.category = "Voice";
		}
		step.elements = normalizeElements(stepSource.elements);
		step.text = normalizeText(stepSource.text);
		return step;
	});

	if (normalized.outputType === "preset") {
		const presetIds = ["sloppycarl", "wigdos", "carlnet", "default"];
		if (normalized.presetId === null || presetIds.includes(normalized.presetId) === false) {
			warnLog(`splash.presetId: '${normalized.presetId}' invalid, using default.`);
			normalized.outputType = "default";
			normalized.presetId = null;
			normalized.sequence = [];
		}
	}

	if (normalized.outputType === "custom" && normalized.sequence.length === 0) {
		warnLog("splash.sequence: custom payload had no steps, using default.");
		normalized.outputType = "default";
	}

	if (normalized.outputType === "default") {
		normalized.presetId = null;
		normalized.sequence = [];
	}

	return normalized;
}

function CutscenePayload(payload, type) {
	const rootKey = type === "rendered" ? "cutsceneRendered" : "cutsceneEngine";
	const normalized = normalizePayloadSchema(payload, rootKey);

	if (type === "engine" && normalized.fadeLeadSeconds > normalized.durationSeconds) {
		warnLog(`cutscene.fadeLeadSeconds: clamped ${normalized.fadeLeadSeconds} to duration ${normalized.durationSeconds}.`);
		normalized.fadeLeadSeconds = normalized.durationSeconds;
	}

	return normalized;
}

function LevelPayload(payload) {
	const normalizeTexture = (rawTexture) => {
		const texture = normalizePayloadSchema(normalizeObject(rawTexture).value, "levelTexture");
		if (texture.baseTextureID === null) texture.baseTextureID = texture.textureID;
		if (texture.materialTextureID === null) texture.materialTextureID = texture.textureID;
		return texture;
	};

	const normalizeScatter = (rawScatter) => {
		const resolvedScatter = [];

		normalizeArray(rawScatter).value.forEach((rawEntry) => {
			const entrySource = normalizeObject(rawEntry);
			if (!entrySource.bool) return;
			resolvedScatter.push(normalizePayloadSchema(entrySource.value, "levelScatterEntry"));
		});

		return resolvedScatter;
	};

	const normalizeDetail = (rawDetail) => {
		return { scatter: normalizeScatter(normalizeObject(rawDetail).value.scatter) };
	};

	const normalizePart = (rawPart) => {
		const partSource = normalizeObject(rawPart).value;
		const part = normalizePayloadSchema(partSource, "levelPart");
		part.dimensions = toUnitVector3(part.dimensions, "cnu");
		part.localPosition = toUnitVector3(part.localPosition, "cnu");
		part.localRotation = toUnitVector3(part.localRotation, "degrees").toRadians(true);
		part.localScale = CloneVector3(part.localScale);
		part.pivot = toUnitVector3(part.pivot, "cnu");
		part.texture = normalizeTexture(partSource.texture !== undefined ? partSource.texture : part.texture);
		part.detail = normalizeDetail(partSource.detail !== undefined ? partSource.detail : part.detail);
		if (part.label === null) delete part.label;
		return part;
	};

	const surfaceIds = new Set();
	const defaultsByShape = {
		cube: "obb",
		plane: "obb",
		"ramp-simple": "obb",
		cylinder: "capsule",
		capsule: "capsule",
		sphere: "sphere",
		pyramid: "triangle-soup",
		cone: "triangle-soup",
		tube: "triangle-soup",
		torus: "triangle-soup",
		"ramp-complex": "triangle-soup",
	};

	const normalizeLevelObject = (rawObject, multipartFallbackShape = null) => {
		const objectSource = normalizeObject(rawObject).value;
		const object = normalizePayloadSchema(objectSource, "levelObject");
		object.dimensions = toUnitVector3(object.dimensions, "cnu");
		object.position = toUnitVector3(object.position, "cnu");
		object.rotation = toUnitVector3(object.rotation, "degrees").toRadians(true);
		object.scale = CloneVector3(object.scale);
		object.pivot = toUnitVector3(object.pivot, "cnu");
		object.texture = normalizeTexture(objectSource.texture !== undefined ? objectSource.texture : object.texture);
		object.detail = normalizeDetail(objectSource.detail !== undefined ? objectSource.detail : object.detail);
		object.parts = normalizeArray(objectSource.parts).value.map((part) => normalizePart(part));
		object.collisionShape = object.collisionShape !== null ? object.collisionShape
			: multipartFallbackShape !== null && object.parts.length > 1 ? multipartFallbackShape
				: defaultsByShape[object.shape];
		surfaceIds.add(object.id);
		return object;
	};

	const normalizeMovement = (rawMovement) => {
		const movement = normalizePayloadSchema(normalizeObject(rawMovement).value, "levelMovement");
		movement.start = toUnitVector3(movement.start, "cnu");
		movement.end = toUnitVector3(movement.end, "cnu");
		movement.speed = new Unit(movement.speed, "cnu");
		movement.jump = new Unit(movement.jump, "cnu");
		return movement;
	};

	const resolveCollisionOverride = (rawCollisionOverride, entityType) => {
		const defaultsByType = {
			enemy: { physics: "capsule", hurtbox: "sphere", hitbox: null },
			npc: { physics: "capsule", hurtbox: null, hitbox: null },
			collectible: { physics: "sphere", hurtbox: "sphere", hitbox: null },
			projectile: { physics: "sphere", hurtbox: "sphere", hitbox: "sphere" },
			boss: { physics: "compound-sphere", hurtbox: "compound-sphere", hitbox: null },
			entity: { physics: "capsule", hurtbox: null, hitbox: null },
		};
		const defaults = defaultsByType[entityType] || defaultsByType.entity;
		const source = normalizeObject(rawCollisionOverride).value;
		const collisionOverride = normalizePayloadSchema(source, "levelCollisionOverride");

		return { 
			physics: collisionOverride.physics !== null ? collisionOverride.physics : defaults.physics, 
			hurtbox: source.hurtbox === null
				? null
				: source.hurtbox === undefined
					? defaults.hurtbox
					: collisionOverride.hurtbox !== null
						? collisionOverride.hurtbox
						: defaults.hurtbox, 
			hitbox: source.hitbox === null
				? null
				: source.hitbox === undefined
					? defaults.hitbox
					: collisionOverride.hitbox !== null
						? collisionOverride.hitbox
						: defaults.hitbox
		};
	};

	const normalizeAttacks = (rawAttacks) => {
		return normalizeArray(rawAttacks).value.map((rawAttack) => {
			normalizePayloadSchema(normalizeObject(rawAttack).value, "levelAttack");
		});
	};

	const normalizeBlueprint = (rawBlueprint) => {
		const blueprintSource = normalizeObject(rawBlueprint).value;
		const blueprint = normalizePayloadSchema(blueprintSource, "levelEntityBlueprint");
		blueprint.movement = normalizeMovement(blueprintSource.movement);
		blueprint.velocity = toUnitVector3(blueprint.velocity, "cnu");
		blueprint.attacks = normalizeAttacks(blueprintSource.attacks);
		blueprint.hardcoded = normalizeObject(blueprint.hardcoded).value;
		blueprint.animations = normalizeObject(blueprint.animations).value;
		blueprint.collisionOverride = resolveCollisionOverride(blueprintSource.collisionOverride, blueprint.type);
		blueprint.model.rootTransform = {
			position: toUnitVector3(blueprint.model.rootTransform.position, "cnu"),
			rotation: toUnitVector3(blueprint.model.rootTransform.rotation, "degrees").toRadians(true),
			scale: CloneVector3(blueprint.model.rootTransform.scale),
			pivot: toUnitVector3(blueprint.model.rootTransform.pivot, "cnu"),
		};
		blueprint.model.parts = normalizeArray(blueprintSource.model?.parts).value.map((part) => normalizePart(part));
		return blueprint;
	};

	const normalizeOverride = (rawOverride) => {
		const overrideSource = normalizeObject(rawOverride).value;
		const override = normalizePayloadSchema(overrideSource, "levelEntityOverride");
		override.movement = normalizeMovement(overrideSource.movement);
		override.velocity = toUnitVector3(override.velocity, "cnu");
		override.attacks = normalizeAttacks(overrideSource.attacks);
		override.rootTransform = {
			position: toUnitVector3(override.rootTransform.position, "cnu"),
			rotation: toUnitVector3(override.rootTransform.rotation, "degrees").toRadians(true),
			scale: CloneVector3(override.rootTransform.scale),
			pivot: toUnitVector3(override.rootTransform.pivot, "cnu"),
		};
		return override;
	};

	const rawPayload = normalizeObject(payload).value;
	const normalized = normalizePayloadSchema(rawPayload, "level");

	normalized.world.length = new Unit(normalized.world.length, "cnu");
	normalized.world.width = new Unit(normalized.world.width, "cnu");
	normalized.world.height = new Unit(normalized.world.height, "cnu");
	normalized.world.deathBarrierY = new Unit(normalized.world.deathBarrierY, "cnu");
	if (normalized.world.waterLevel !== null) {
		const clampedWaterLevel = Clamp(normalized.world.waterLevel, normalized.world.deathBarrierY.value, normalized.world.height.value);
		if (clampedWaterLevel !== normalized.world.waterLevel) {
			warnLog(`level.world.waterLevel: clamped ${normalized.world.waterLevel} to ${clampedWaterLevel}.`);
		}
		normalized.world.waterLevel = new Unit(clampedWaterLevel, "cnu");
	}

	normalized.camera.distance = new Unit(normalized.camera.distance, "cnu");
	normalized.camera.heightOffset = new Unit(normalized.camera.heightOffset, "cnu");
	normalized.camera.levelOpening.startPosition = toUnitVector3(normalized.camera.levelOpening.startPosition, "cnu");
	normalized.camera.levelOpening.endPosition = toUnitVector3(normalized.camera.levelOpening.endPosition, "cnu");

	normalized.terrain.objects = normalizeArray(rawPayload.terrain?.objects).value.map((entry) => normalizeLevelObject(entry));
	normalized.obstacles = normalizeArray(rawPayload.obstacles).value.map((entry) => normalizeLevelObject(entry, "triangle-soup"));
	normalized.terrain.triggers = normalizeArray(rawPayload.terrain?.triggers).value.map((entry) => {
		const trigger = normalizePayloadSchema(normalizeObject(entry).value, "levelTrigger");
		trigger.start = toUnitVector3(trigger.start, "cnu");
		trigger.end = toUnitVector3(trigger.end, "cnu");
		return trigger;
	});

	const blueprintBuckets = ["enemies", "npcs", "collectibles", "projectiles", "entities"];
	blueprintBuckets.forEach((bucket) => {
		normalized.entityBlueprints[bucket] = normalizeArray(
			normalizeObject(rawPayload.entityBlueprints).value[bucket]
		).value.map((entry) => normalizeBlueprint(entry));
	});

	const blueprintMap = {};
	blueprintBuckets.forEach((bucketName) => {
		normalized.entityBlueprints[bucketName].forEach((entry) => blueprintMap[entry.id] = entry);
	});

	const firstSurfaceId = normalized.terrain.objects[0]?.id || normalized.obstacles[0]?.id || null;
	normalized.entities = normalizeArray(rawPayload.entities).value.map((entry) => {
		const entrySource = normalizeObject(entry).value;
		const override = normalizeOverride(entrySource);
		const blueprint = override.blueprintId !== null ? blueprintMap[override.blueprintId] : null;

		if (!blueprint) {
			warnLog(`level.entities: missing blueprint '${override.blueprintId}' for '${override.id}', dropping entry.`);
			return null;
		}

		const merged = structuredClone(blueprint);

		// structuredClone strips UnitVector3/Unit class prototypes — rehydrate before use.
		const rt = merged.model.rootTransform;
		merged.model.rootTransform = {
			position: toUnitVector3(rt.position, "cnu"),
			rotation: toUnitVector3(rt.rotation, "radians"),
			scale   : rt.scale,
			pivot   : toUnitVector3(rt.pivot, "cnu"),
		};
		merged.model.parts = merged.model.parts.map((part) => normalizePart(part));

		merged.id = override.id;
		merged.blueprintId = override.blueprintId;
		if (entrySource.type !== undefined) merged.type = override.type;
		if (entrySource.hp !== undefined && override.hp !== null) merged.hp = override.hp;
		if (entrySource.hardcoded !== undefined && override.hardcoded !== null) merged.hardcoded = override.hardcoded;
		if (entrySource.attacks !== undefined) merged.attacks = override.attacks;
		if (entrySource.platform !== undefined && override.platform !== null) merged.platform = override.platform;
		if (entrySource.animations !== undefined && override.animations !== null) merged.animations = override.animations;
		if (entrySource.collisionOverride !== undefined) merged.collisionOverride = resolveCollisionOverride(entrySource.collisionOverride, merged.type);
		if (entrySource.movement !== undefined) merged.movement = override.movement;
		if (entrySource.velocity !== undefined) merged.velocity = override.velocity;
		if (entrySource.spawnSurfaceId !== undefined && override.spawnSurfaceId !== null) merged.model.spawnSurfaceId = override.spawnSurfaceId;
		if (entrySource.rootTransform !== undefined) merged.model.rootTransform = override.rootTransform;
		merged.dialogue = override.dialogue;
		merged.collisionOverride = resolveCollisionOverride(merged.collisionOverride, merged.type);

		if (merged.model.spawnSurfaceId === null || surfaceIds.has(merged.model.spawnSurfaceId) === false) {
			if (firstSurfaceId !== null) {
				warnLog(`level.entities: invalid spawnSurfaceId for '${merged.id}', using '${firstSurfaceId}'.`);
				merged.model.spawnSurfaceId = firstSurfaceId;
			}
		}

		return merged;
	}).filter((entry) => entry !== null);

	const characterIds = Object.keys(characterData);
	const defaultCharacterId = characterIds[0];
	
	const playerSource = normalizeObject(rawPayload.player);
	if (playerSource.bool) {
		normalized.player = normalizePayloadSchema(playerSource.value, "levelPlayer");
		normalized.player.spawnPosition = toUnitVector3(normalized.player.spawnPosition, "cnu");
		normalized.player.scale = CloneVector3(normalized.player.scale);
		normalized.player.modelParts = normalizeArray(playerSource.value.modelParts).value.map((part) => normalizePart(part));
		normalized.player.metaOverrides = structuredClone(normalized.player.metaOverrides);
		if (!Array.isArray(normalized.player.metaOverrides.list)) normalized.player.metaOverrides.list = [];
		if (characterIds.includes(normalized.player.character) === false) {
			warnLog(`level.player.character: '${normalized.player.character}' missing, using '${defaultCharacterId}'.`);
			normalized.player.character = defaultCharacterId;
		}
	}
	else normalized.player = null;

	const musicSource = normalizeObject(rawPayload.music);
	normalized.music = musicSource.bool ? AudioPayload(musicSource.value) : null;

	return normalized;
}

export default {
	AudioPayload,
	MenuUIPayload,
	SplashPayload,
	CutscenePayload,
	LevelPayload,
};