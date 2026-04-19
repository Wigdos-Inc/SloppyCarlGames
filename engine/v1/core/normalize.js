import canonSchemas from "./canonSchemas.json" with { type: "json" };
import characterData from "../player/characters.json" with { type: "json" };
import { Log } from "./meta.js";
import { Clamp, Unit, UnitVector3 } from "../math/Utilities.js";

function normalizeSchemaKey(key) {
	return key.toLowerCase().replace(/[-_]/g, "");
}

function normalizePayloadSchema(payload, rootKey) {
	const canonLayer = canonSchemas[rootKey];

	function resolveFieldLayer(payloadLayer, canonFieldLayer) {
		const sourceLayer = payloadLayer && typeof payloadLayer === "object" && !Array.isArray(payloadLayer)
			? payloadLayer
			: {};
		const resolvedLayer = {};
		const payloadKeys = Object.keys(sourceLayer);

		for (const key in canonFieldLayer) {
			if (key === "__meta" || key === "__entry") continue;

			const fieldSchema = canonFieldLayer[key];
			const meta = fieldSchema.__meta;
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

			let resolvedValue;
			if (matchedKey === null) {
				resolvedValue = meta.fallback !== null && typeof meta.fallback === "object"
					? structuredClone(meta.fallback)
					: meta.fallback;

				if (meta.isExpected === true) {
					Log(
						"ENGINE",
						`Normalize ${rootKey}.${key}: missing, using fallback ${JSON.stringify(meta.fallback)}.`,
						"warn",
						"Validation"
					);
				}
			}
			else {
				resolvedValue = sourceLayer[matchedKey];

				if (meta.deprecated === true) {
					Log(
						"ENGINE",
						`Normalize ${rootKey}.${key}: '${matchedKey}' is deprecated.`,
						"warn",
						"Validation"
					);
				}

				let valid = meta.isExpected === false && resolvedValue === null;
				if (!valid) {
					switch (meta.dataType) {
						case "string":
							valid = typeof resolvedValue === "string";
							break;
						case "number":
							valid = typeof resolvedValue === "number" && Number.isFinite(resolvedValue);
							break;
						case "boolean":
							valid = typeof resolvedValue === "boolean";
							break;
						case "object":
							valid = resolvedValue !== null && typeof resolvedValue === "object" && !Array.isArray(resolvedValue);
							break;
						case "array":
							valid = Array.isArray(resolvedValue);
							break;
						case "vector3":
							valid =
								resolvedValue !== null &&
								typeof resolvedValue === "object" &&
								!Array.isArray(resolvedValue) &&
								typeof resolvedValue.x === "number" && Number.isFinite(resolvedValue.x) &&
								typeof resolvedValue.y === "number" && Number.isFinite(resolvedValue.y) &&
								typeof resolvedValue.z === "number" && Number.isFinite(resolvedValue.z);
							break;
					}
				}

				if (!valid) {
					Log(
						"ENGINE",
						`Normalize ${rootKey}.${key}: invalid ${meta.dataType}, using fallback ${JSON.stringify(meta.fallback)}.`,
						"warn",
						"Validation"
					);
					resolvedValue = meta.fallback !== null && typeof meta.fallback === "object"
						? structuredClone(meta.fallback)
						: meta.fallback;
				}

				if (meta.range && meta.dataType === "number" && resolvedValue !== null) {
					const clamped = Clamp(resolvedValue, meta.range.min, meta.range.max);
					if (clamped !== resolvedValue) {
						Log(
							"ENGINE",
							`Normalize ${rootKey}.${key}: clamped ${resolvedValue} to ${clamped}.`,
							"warn",
							"Validation"
						);
						resolvedValue = clamped;
					}
				}

				if (meta.allowedValues && meta.dataType === "string" && resolvedValue !== null && !meta.allowedValues.includes(resolvedValue)) {
					Log(
						"ENGINE",
						`Normalize ${rootKey}.${key}: '${resolvedValue}' not allowed, using fallback ${JSON.stringify(meta.fallback)}.`,
						"warn",
						"Validation"
					);
					resolvedValue = meta.fallback !== null && typeof meta.fallback === "object"
						? structuredClone(meta.fallback)
						: meta.fallback;
				}
			}

			if (fieldSchema.__entry && Array.isArray(resolvedValue)) {
				const resolvedEntries = [];
				for (let entryIndex = 0; entryIndex < resolvedValue.length; entryIndex++) {
					resolvedEntries.push(resolveFieldLayer(resolvedValue[entryIndex], fieldSchema.__entry));
				}
				resolvedValue = resolvedEntries;
			}
			else {
				let hasChildren = false;
				for (const childKey in fieldSchema) {
					if (childKey !== "__meta" && childKey !== "__entry") {
						hasChildren = true;
						break;
					}
				}

				if (hasChildren && resolvedValue !== null) {
					resolvedValue = resolveFieldLayer(resolvedValue, fieldSchema);
				}
			}

			resolvedLayer[key] = resolvedValue;
		}

		return resolvedLayer;
	}

	const rootPayload = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
	return resolveFieldLayer(rootPayload, canonLayer);
}

function AudioPayload(payload) {
	const rawPayload = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
	const normalized = normalizePayloadSchema(rawPayload, "audio");
	const rawOptions = rawPayload.options && typeof rawPayload.options === "object" && !Array.isArray(rawPayload.options)
		? rawPayload.options
		: {};
	const options = normalized.options && typeof normalized.options === "object" && !Array.isArray(normalized.options)
		? structuredClone(normalized.options)
		: {};

	if (typeof rawOptions.id === "string" && normalized.id === null) normalized.id = rawOptions.id;
	if (typeof rawOptions.name === "string" && normalized.name === null) normalized.name = rawOptions.name;
	if (typeof rawOptions.rate === "number" && rawPayload.rate === undefined) normalized.rate = Clamp(rawOptions.rate, 0.01, 4);
	if (typeof rawOptions.loop === "boolean" && rawPayload.loop === undefined) normalized.loop = rawOptions.loop;
	if (typeof rawOptions.category === "string" && rawPayload.category === undefined) normalized.category = rawOptions.category;

	if (normalized.name === null) {
		if (normalized.id !== null) normalized.name = normalized.id;
		else if (normalized.src) {
			const sourceParts = normalized.src.split("/");
			const basename = sourceParts[sourceParts.length - 1] || "AUDIO";
			normalized.name = basename.replace(/\.[^.]+$/, "") || "AUDIO";
		}
	}

	if (normalized.id === null) normalized.id = normalized.name;
	if (normalized.category !== null && ["Game", "Menu", "Cutscene", "Voice", "Music", "Sfx"].includes(normalized.category) === false) {
		Log("ENGINE", `Normalize audio.category: '${normalized.category}' not allowed, using null.`, "warn", "Validation");
		normalized.category = null;
	}

	if (options.id === undefined && normalized.id !== null) options.id = normalized.id;
	if (options.name === undefined && normalized.name !== null) options.name = normalized.name;
	if (normalized.rate !== null) options.rate = normalized.rate;
	if (normalized.loop !== null) options.loop = normalized.loop;
	if (normalized.category !== null) options.category = normalized.category;
	normalized.options = options;

	return normalized;
}

function MenuUIPayload(payload) {
	const rawPayload = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
	const normalized = normalizePayloadSchema(rawPayload, "menu");

	const normalizeElements = (rawElements) => {
		const resolved = [];
		const sourceElements = Array.isArray(rawElements) ? rawElements : [];

		for (let index = 0; index < sourceElements.length; index++) {
			const rawElement = sourceElements[index] && typeof sourceElements[index] === "object" && !Array.isArray(sourceElements[index])
				? sourceElements[index]
				: {};
			const element = normalizePayloadSchema(rawElement, "menuElement");
			element.children = normalizeElements(rawElement.children);

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

			for (let keyIndex = 0; keyIndex < directEventKeys.length; keyIndex++) {
				const directKey = directEventKeys[keyIndex];
				if (rawElement[directKey] !== undefined) element[directKey] = rawElement[directKey];
			}

			if (element.id === null) delete element.id;
			if (element.className === null) delete element.className;
			if (element.text === null) delete element.text;
			if (element.src === null) delete element.src;
			if (element.value === null) delete element.value;
			if (element.checked === null) delete element.checked;

			resolved.push(element);
		}

		return resolved;
	};

	normalized.elements = normalizeElements(rawPayload.elements);
	if (rawPayload.music && typeof rawPayload.music === "object" && !Array.isArray(rawPayload.music)) {
		normalized.music = AudioPayload(rawPayload.music);
	}
	else normalized.music = null;

	return normalized;
}

function SplashPayload(payload) {
	const rawPayload = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
	const normalized = normalizePayloadSchema(rawPayload, "splash");

	const normalizeElements = (rawElements) => {
		const resolved = [];
		const sourceElements = Array.isArray(rawElements) ? rawElements : [];

		for (let index = 0; index < sourceElements.length; index++) {
			const rawElement = sourceElements[index] && typeof sourceElements[index] === "object" && !Array.isArray(sourceElements[index])
				? sourceElements[index]
				: {};
			const element = normalizePayloadSchema(rawElement, "menuElement");
			element.children = normalizeElements(rawElement.children);
			if (element.id === null) delete element.id;
			if (element.className === null) delete element.className;
			if (element.text === null) delete element.text;
			if (element.src === null) delete element.src;
			if (element.value === null) delete element.value;
			if (element.checked === null) delete element.checked;
			resolved.push(element);
		}

		return resolved;
	};

	const normalizeText = (rawTextEntries) => {
		const resolved = [];
		const sourceTextEntries = Array.isArray(rawTextEntries) ? rawTextEntries : [];

		for (let index = 0; index < sourceTextEntries.length; index++) {
			const rawText = sourceTextEntries[index] && typeof sourceTextEntries[index] === "object" && !Array.isArray(sourceTextEntries[index])
				? sourceTextEntries[index]
				: {};
			const textEntry = normalizePayloadSchema(rawText, "splashText");
			if (textEntry.id === null) delete textEntry.id;
			if (textEntry.className === null) delete textEntry.className;
			resolved.push(textEntry);
		}

		return resolved;
	};

	const sourceSequence = Array.isArray(rawPayload.sequence) ? rawPayload.sequence : [];
	normalized.sequence = sourceSequence.map((rawStep) => {
		const stepSource = rawStep && typeof rawStep === "object" && !Array.isArray(rawStep) ? rawStep : {};
		const step = normalizePayloadSchema(stepSource, "splashStep");
		step.sfx = stepSource.sfx && typeof stepSource.sfx === "object" && !Array.isArray(stepSource.sfx)
			? AudioPayload(stepSource.sfx)
			: null;
		step.voice = stepSource.voice && typeof stepSource.voice === "object" && !Array.isArray(stepSource.voice)
			? AudioPayload(stepSource.voice)
			: null;
		step.elements = normalizeElements(stepSource.elements);
		step.text = normalizeText(stepSource.text);
		return step;
	});

	if (normalized.outputType === "preset") {
		const presetIds = ["sloppycarl", "wigdos", "carlnet", "default"];
		if (normalized.presetId === null || presetIds.includes(normalized.presetId) === false) {
			Log("ENGINE", `Normalize splash.presetId: '${normalized.presetId}' invalid, using default mode.`, "warn", "Validation");
			normalized.outputType = "default";
			normalized.presetId = null;
			normalized.sequence = [];
		}
	}

	if (normalized.outputType === "custom" && normalized.sequence.length === 0) {
		Log("ENGINE", "Normalize splash.sequence: custom payload had no steps, using default mode.", "warn", "Validation");
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
		Log("ENGINE", `Normalize cutscene.fadeLeadSeconds: clamped ${normalized.fadeLeadSeconds} to duration ${normalized.durationSeconds}.`, "warn", "Validation");
		normalized.fadeLeadSeconds = normalized.durationSeconds;
	}

	return normalized;
}

function LevelPayload(payload) {
	const rawPayload = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
	const normalized = normalizePayloadSchema(rawPayload, "level");
	const characterIds = Object.keys(characterData);
	const defaultCharacterId = characterIds[0];
	const surfaceIds = new Set();

	const normalizeTexture = (rawTexture) => {
		const textureSource = rawTexture && typeof rawTexture === "object" && !Array.isArray(rawTexture) ? rawTexture : {};
		const texture = normalizePayloadSchema(textureSource, "levelTexture");
		if (texture.baseTextureID === null) texture.baseTextureID = texture.textureID;
		if (texture.materialTextureID === null) texture.materialTextureID = texture.textureID;
		return texture;
	};

	const normalizeScatter = (rawScatter) => {
		const scatterEntries = Array.isArray(rawScatter) ? rawScatter : [];
		const resolvedScatter = [];

		for (let index = 0; index < scatterEntries.length; index++) {
			const entry = scatterEntries[index] && typeof scatterEntries[index] === "object" && !Array.isArray(scatterEntries[index])
				? scatterEntries[index]
				: null;
			if (entry === null) continue;
			resolvedScatter.push({
				typeID: typeof entry.typeID === "string" ? entry.typeID : "",
				density: typeof entry.density === "number" && Number.isFinite(entry.density)
					? Clamp(entry.density, 0, 100)
					: 1,
			});
		}

		return resolvedScatter;
	};

	const normalizeDetail = (rawDetail) => {
		const detailSource = rawDetail && typeof rawDetail === "object" && !Array.isArray(rawDetail) ? rawDetail : {};
		return { scatter: normalizeScatter(detailSource.scatter) };
	};

	const normalizePart = (rawPart) => {
		const partSource = rawPart && typeof rawPart === "object" && !Array.isArray(rawPart) ? rawPart : {};
		const part = normalizePayloadSchema(partSource, "levelPart");
		part.dimensions = new UnitVector3(part.dimensions.x, part.dimensions.y, part.dimensions.z, "cnu");
		part.localPosition = new UnitVector3(part.localPosition.x, part.localPosition.y, part.localPosition.z, "cnu");
		part.localRotation = new UnitVector3(part.localRotation.x, part.localRotation.y, part.localRotation.z, "degrees").toRadians(true);
		part.localScale = { x: part.localScale.x, y: part.localScale.y, z: part.localScale.z };
		part.pivot = new UnitVector3(part.pivot.x, part.pivot.y, part.pivot.z, "cnu");
		part.texture = normalizeTexture(partSource.texture || part.texture);
		part.detail = normalizeDetail(partSource.detail || part.detail);
		if (part.label === null) delete part.label;
		return part;
	};

	const normalizeObject = (rawObject, fallbackCollisionShape) => {
		const objectSource = rawObject && typeof rawObject === "object" && !Array.isArray(rawObject) ? rawObject : {};
		const object = normalizePayloadSchema(objectSource, "levelObject");
		object.dimensions = new UnitVector3(object.dimensions.x, object.dimensions.y, object.dimensions.z, "cnu");
		object.position = new UnitVector3(object.position.x, object.position.y, object.position.z, "cnu");
		object.rotation = new UnitVector3(object.rotation.x, object.rotation.y, object.rotation.z, "degrees").toRadians(true);
		object.scale = { x: object.scale.x, y: object.scale.y, z: object.scale.z };
		object.pivot = new UnitVector3(object.pivot.x, object.pivot.y, object.pivot.z, "cnu");
		object.texture = normalizeTexture(objectSource.texture || object.texture);
		object.detail = normalizeDetail(objectSource.detail || object.detail);
		object.parts = (Array.isArray(objectSource.parts) ? objectSource.parts : []).map((part) => normalizePart(part));
		if (!object.collisionShape) object.collisionShape = fallbackCollisionShape;
		surfaceIds.add(object.id);
		return object;
	};

	const normalizeMovement = (rawMovement) => {
		const movementSource = rawMovement && typeof rawMovement === "object" && !Array.isArray(rawMovement) ? rawMovement : {};
		const movement = normalizePayloadSchema(movementSource, "levelMovement");
		movement.start = new UnitVector3(movement.start.x, movement.start.y, movement.start.z, "cnu");
		movement.end = new UnitVector3(movement.end.x, movement.end.y, movement.end.z, "cnu");
		movement.speed = new Unit(movement.speed, "cnu");
		movement.jump = new Unit(movement.jump, "cnu");
		return movement;
	};

	const resolveCollisionOverride = (rawCollisionOverride, entityType) => {
		const allowedShapes = ["sphere", "aabb", "capsule", "obb", "compound-sphere", "triangle-soup"];
		const defaultsByType = {
			enemy: { physics: "sphere", hurtbox: "sphere", hitbox: "sphere" },
			npc: { physics: "capsule", hurtbox: null, hitbox: null },
			collectible: { physics: "sphere", hurtbox: null, hitbox: null },
			projectile: { physics: "sphere", hurtbox: null, hitbox: "sphere" },
			boss: { physics: "capsule", hurtbox: "capsule", hitbox: "capsule" },
			entity: { physics: "sphere", hurtbox: null, hitbox: null },
		};
		const defaults = defaultsByType[entityType] || defaultsByType.entity;
		const source = rawCollisionOverride && typeof rawCollisionOverride === "object" && !Array.isArray(rawCollisionOverride)
			? rawCollisionOverride
			: {};

		const physics = typeof source.physics === "string" && allowedShapes.includes(source.physics)
			? source.physics
			: defaults.physics;
		const hurtbox = source.hurtbox === null
			? null
			: typeof source.hurtbox === "string" && allowedShapes.includes(source.hurtbox)
				? source.hurtbox
				: defaults.hurtbox;
		const hitbox = source.hitbox === null
			? null
			: typeof source.hitbox === "string" && allowedShapes.includes(source.hitbox)
				? source.hitbox
				: defaults.hitbox;

		return { physics, hurtbox, hitbox };
	};

	const normalizeAttacks = (rawAttacks) => {
		const attackEntries = Array.isArray(rawAttacks) ? rawAttacks : [];
		const resolvedAttacks = [];

		for (let index = 0; index < attackEntries.length; index++) {
			const attackSource = attackEntries[index] && typeof attackEntries[index] === "object" && !Array.isArray(attackEntries[index])
				? attackEntries[index]
				: {};
			resolvedAttacks.push(normalizePayloadSchema(attackSource, "levelAttack"));
		}

		return resolvedAttacks;
	};

	const normalizeBlueprint = (rawBlueprint) => {
		const blueprintSource = rawBlueprint && typeof rawBlueprint === "object" && !Array.isArray(rawBlueprint) ? rawBlueprint : {};
		const blueprint = normalizePayloadSchema(blueprintSource, "levelEntityBlueprint");
		blueprint.movement = normalizeMovement(blueprintSource.movement);
		blueprint.velocity = new UnitVector3(blueprint.velocity.x, blueprint.velocity.y, blueprint.velocity.z, "cnu");
		blueprint.attacks = normalizeAttacks(blueprintSource.attacks);
		blueprint.hardcoded = blueprint.hardcoded && typeof blueprint.hardcoded === "object" && !Array.isArray(blueprint.hardcoded)
			? blueprint.hardcoded
			: {};
		blueprint.animations = blueprint.animations && typeof blueprint.animations === "object" && !Array.isArray(blueprint.animations)
			? blueprint.animations
			: {};
		blueprint.collisionOverride = resolveCollisionOverride(blueprintSource.collisionOverride, blueprint.type);
		blueprint.model.rootTransform = {
			position: new UnitVector3(
				blueprint.model.rootTransform.position.x,
				blueprint.model.rootTransform.position.y,
				blueprint.model.rootTransform.position.z,
				"cnu"
			),
			rotation: new UnitVector3(
				blueprint.model.rootTransform.rotation.x,
				blueprint.model.rootTransform.rotation.y,
				blueprint.model.rootTransform.rotation.z,
				"degrees"
			).toRadians(true),
			scale: {
				x: blueprint.model.rootTransform.scale.x,
				y: blueprint.model.rootTransform.scale.y,
				z: blueprint.model.rootTransform.scale.z,
			},
			pivot: new UnitVector3(
				blueprint.model.rootTransform.pivot.x,
				blueprint.model.rootTransform.pivot.y,
				blueprint.model.rootTransform.pivot.z,
				"cnu"
			),
		};
		blueprint.model.parts = (Array.isArray(blueprintSource.model?.parts) ? blueprintSource.model.parts : []).map((part) => normalizePart(part));
		return blueprint;
	};

	const normalizeOverride = (rawOverride) => {
		const overrideSource = rawOverride && typeof rawOverride === "object" && !Array.isArray(rawOverride) ? rawOverride : {};
		const override = normalizePayloadSchema(overrideSource, "levelEntityOverride");
		override.movement = normalizeMovement(overrideSource.movement);
		override.velocity = new UnitVector3(override.velocity.x, override.velocity.y, override.velocity.z, "cnu");
		override.attacks = normalizeAttacks(overrideSource.attacks);
		override.rootTransform = {
			position: new UnitVector3(override.rootTransform.position.x, override.rootTransform.position.y, override.rootTransform.position.z, "cnu"),
			rotation: new UnitVector3(override.rootTransform.rotation.x, override.rootTransform.rotation.y, override.rootTransform.rotation.z, "degrees").toRadians(true),
			scale: {
				x: override.rootTransform.scale.x,
				y: override.rootTransform.scale.y,
				z: override.rootTransform.scale.z,
			},
			pivot: new UnitVector3(override.rootTransform.pivot.x, override.rootTransform.pivot.y, override.rootTransform.pivot.z, "cnu"),
		};
		return override;
	};

	normalized.world.length = new Unit(normalized.world.length, "cnu");
	normalized.world.width = new Unit(normalized.world.width, "cnu");
	normalized.world.height = new Unit(normalized.world.height, "cnu");
	normalized.world.deathBarrierY = new Unit(normalized.world.deathBarrierY, "cnu");
	if (normalized.world.waterLevel !== null) {
		const clampedWaterLevel = Clamp(normalized.world.waterLevel, normalized.world.deathBarrierY.value, normalized.world.height.value);
		if (clampedWaterLevel !== normalized.world.waterLevel) {
			Log("ENGINE", `Normalize level.world.waterLevel: clamped ${normalized.world.waterLevel} to ${clampedWaterLevel}.`, "warn", "Validation");
		}
		normalized.world.waterLevel = new Unit(clampedWaterLevel, "cnu");
	}

	normalized.camera.distance = new Unit(normalized.camera.distance, "cnu");
	normalized.camera.heightOffset = new Unit(normalized.camera.heightOffset, "cnu");
	normalized.camera.levelOpening.startPosition = new UnitVector3(
		normalized.camera.levelOpening.startPosition.x,
		normalized.camera.levelOpening.startPosition.y,
		normalized.camera.levelOpening.startPosition.z,
		"cnu"
	);
	normalized.camera.levelOpening.endPosition = new UnitVector3(
		normalized.camera.levelOpening.endPosition.x,
		normalized.camera.levelOpening.endPosition.y,
		normalized.camera.levelOpening.endPosition.z,
		"cnu"
	);

	normalized.terrain.objects = (Array.isArray(rawPayload.terrain?.objects) ? rawPayload.terrain.objects : []).map((entry) => normalizeObject(entry, "aabb"));
	normalized.obstacles = (Array.isArray(rawPayload.obstacles) ? rawPayload.obstacles : []).map((entry) => normalizeObject(entry, "aabb"));
	normalized.terrain.triggers = (Array.isArray(rawPayload.terrain?.triggers) ? rawPayload.terrain.triggers : []).map((entry) => {
		const trigger = normalizePayloadSchema(entry, "levelTrigger");
		trigger.start = new UnitVector3(trigger.start.x, trigger.start.y, trigger.start.z, "cnu");
		trigger.end = new UnitVector3(trigger.end.x, trigger.end.y, trigger.end.z, "cnu");
		return trigger;
	});

	const rawBlueprintBuckets = rawPayload.entityBlueprints && typeof rawPayload.entityBlueprints === "object" && !Array.isArray(rawPayload.entityBlueprints)
		? rawPayload.entityBlueprints
		: {};
	const blueprintBuckets = ["enemies", "npcs", "collectibles", "projectiles", "entities"];
	for (let index = 0; index < blueprintBuckets.length; index++) {
		const bucket = blueprintBuckets[index];
		normalized.entityBlueprints[bucket] = (Array.isArray(rawBlueprintBuckets[bucket]) ? rawBlueprintBuckets[bucket] : []).map((entry) => normalizeBlueprint(entry));
	}

	const blueprintMap = {};
	for (let bucketIndex = 0; bucketIndex < blueprintBuckets.length; bucketIndex++) {
		const bucketName = blueprintBuckets[bucketIndex];
		const bucketEntries = normalized.entityBlueprints[bucketName];
		for (let entryIndex = 0; entryIndex < bucketEntries.length; entryIndex++) {
			blueprintMap[bucketEntries[entryIndex].id] = bucketEntries[entryIndex];
		}
	}

	const firstSurfaceId = normalized.terrain.objects[0]?.id || normalized.obstacles[0]?.id || null;
	normalized.entities = (Array.isArray(rawPayload.entities) ? rawPayload.entities : []).map((entry) => {
		const entrySource = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
		const override = normalizeOverride(entrySource);
		const blueprint = override.blueprintId !== null ? blueprintMap[override.blueprintId] : null;

		if (!blueprint) {
			Log("ENGINE", `Normalize level.entities: missing blueprint '${override.blueprintId}' for '${override.id}', dropping entry.`, "warn", "Validation");
			return null;
		}

		const merged = structuredClone(blueprint);
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
				Log("ENGINE", `Normalize level.entities: invalid spawnSurfaceId for '${merged.id}', using '${firstSurfaceId}'.`, "warn", "Validation");
				merged.model.spawnSurfaceId = firstSurfaceId;
			}
		}

		return merged;
	}).filter((entry) => entry !== null);

	if (rawPayload.player && typeof rawPayload.player === "object" && !Array.isArray(rawPayload.player)) {
		normalized.player = normalizePayloadSchema(rawPayload.player, "levelPlayer");
		normalized.player.spawnPosition = new UnitVector3(
			normalized.player.spawnPosition.x,
			normalized.player.spawnPosition.y,
			normalized.player.spawnPosition.z,
			"cnu"
		);
		normalized.player.scale = {
			x: normalized.player.scale.x,
			y: normalized.player.scale.y,
			z: normalized.player.scale.z,
		};
		normalized.player.modelParts = (Array.isArray(rawPayload.player.modelParts) ? rawPayload.player.modelParts : []).map((part) => normalizePart(part));
		normalized.player.metaOverrides = normalized.player.metaOverrides && typeof normalized.player.metaOverrides === "object" && !Array.isArray(normalized.player.metaOverrides)
			? structuredClone(normalized.player.metaOverrides)
			: { list: [] };
		if (!Array.isArray(normalized.player.metaOverrides.list)) normalized.player.metaOverrides.list = [];
		if (characterIds.includes(normalized.player.character) === false) {
			Log("ENGINE", `Normalize level.player.character: '${normalized.player.character}' missing, using '${defaultCharacterId}'.`, "warn", "Validation");
			normalized.player.character = defaultCharacterId;
		}
	}
	else normalized.player = null;

	normalized.music = rawPayload.music && typeof rawPayload.music === "object" && !Array.isArray(rawPayload.music)
		? AudioPayload(rawPayload.music)
		: null;

	return normalized;
}

export default {
	AudioPayload,
	MenuUIPayload,
	SplashPayload,
	CutscenePayload,
	LevelPayload,
};