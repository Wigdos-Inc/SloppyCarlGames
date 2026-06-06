import canonSchemas from "./canonSchemas.json" with { type: "json" };
import characterData from "../player/characters.json" with { type: "json" };
import objectDetail from "../builder/templates/textures.json" with { type: "json" };
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

				if (meta.allowedValues && meta.dataType === "array" && resolvedValue !== null) {
					resolvedValue = resolvedValue.filter((item) => {
						if (meta.allowedValues.includes(item)) return true;
						warnLog(`${rootKey}.${key}: '${item}' not in allowedValues, removed.`);
						return false;
					});
					if (resolvedValue.length === 0) {
						warnLog(`${rootKey}.${key}: no valid entries remain, using fallback ${JSON.stringify(meta.fallback)}.`);
						resolvedValue = cloneFallback(meta);
					}
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
	const normalized = normalizePayloadSchema({ ...normalizeObject(rawPayload.options).value, ...rawPayload }, "audio");

	if (normalized.name === null) {
		if (normalized.id !== null) normalized.name = normalized.id;
		else if (normalized.src) {
			const sourceParts = normalized.src.split("/");
			const basename = sourceParts[sourceParts.length - 1] || "AUDIO";
			normalized.name = basename.replace(/\.[^.]+$/, "") || "AUDIO";
		}
	}

	if (normalized.id === null) normalized.id = normalized.name;

	const options = structuredClone(normalized.options);
	if (options.id === undefined && normalized.id !== null) options.id = normalized.id;
	if (options.name === undefined && normalized.name !== null) options.name = normalized.name;
	if (normalized.rate !== null) options.rate = normalized.rate;
	if (normalized.loop !== null) options.loop = normalized.loop;
	if (normalized.category !== null) options.category = normalized.category;
	normalized.options = options;

	return normalized;
}

/* === MENU PAYLOAD NORMALIZATION === */

async function MenuPayload(payload) {
	const normalizeElements = (rawElements) => {
		const resolved = [];
		const sourceElements = normalizeArray(rawElements).value;
		const directEventKeys = [
			"onClick", "onInput", "onChange", "onPointerover", "onPointerout", "onPointerdown", 
			"onPointerup", "onKeydown", "onKeyup", "onWheel", "onMousemove"
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

	const pendingImageLoads = [];
	const preloadedImages = [];
	const queuedImagePaths = new Set();
	const queueImagePath = (path) => {
		if (path === "" || queuedImagePaths.has(path)) return;
		queuedImagePaths.add(path);
		pendingImageLoads.push(
			NormalizeImage(path, "menu", "html").then((result) => {
				if (result.bool) preloadedImages.push(result.value.image);
			})
		);
	};
	const queueElementImages = (elements) => {
		elements.forEach((element) => {
			if (element.type === "img" && element.src !== undefined) queueImagePath(element.src);

			if (typeof element.styles.backgroundImage === "string") {
				for (const match of element.styles.backgroundImage.matchAll(/url\((['\"]?)([^'\"()]+)\1\)/gi)) {
					queueImagePath(match[2]);
				}
			}

			queueElementImages(element.children);
		});
	};

	queueElementImages(normalized.elements);
	await Promise.all(pendingImageLoads);

	if (preloadedImages.length > 0) {
		Object.defineProperty(normalized, "preloadedImages", {
			value: preloadedImages,
			writable: true,
			configurable: true,
			enumerable: false,
		});
	}

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

	if (normalized.outputType === "preset" && normalized.presetId === null) {
		warnLog("splash.presetId: expected a non-empty array of preset IDs, using default.");
		normalized.outputType = "default";
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

export async function NormalizeImage(path, sourceType, renderType) {
	try {
		const response = await fetch(path);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const blob = await response.blob();
		const bitmap = await createImageBitmap(blob);
		if (renderType === "html") return { bool: true, value: { image: bitmap, url: path } };
		return { bool: true, value: bitmap };
	} catch (e) {
		warnLog(`NormalizeImage: failed to load '${path}' (${sourceType}): ${e.message}`);
		return { bool: false, value: null };
	}
}

/* Animation Normalization */

const animationChannels = ["transform", "color"];

// Map each part id to the Set of its addressable (id-bearing) decal ids, for referential drops.
function buildAnimationContext(parts) {
	const context = {};
	parts.forEach((part) => {
		const decalIds = new Set();
		part.customTextures.forEach((decal) => { if (decal.id) decalIds.add(decal.id); });
		context[part.id] = decalIds;
	});
	return context;
}

// Keyframe value is left raw here (instanced later, in target-type context).
function normalizeKeyframeList(rawKeyframes) {
	return normalizeArray(rawKeyframes).value.map((rawEntry) => {
		const source = normalizeObject(rawEntry).value;
		const keyframe = normalizePayloadSchema(source, "levelAnimationKeyframe");
		keyframe.value = normalizeObject(source.value).value;
		return keyframe;
	});
}

function normalizeTrackChannels(rawTrack) {
	const track = {};
	for (const channel of animationChannels) {
		const channelSource = normalizeObject(rawTrack[channel]);
		if (channelSource.bool) track[channel] = { keyframes: normalizeKeyframeList(channelSource.value.keyframes) };
	}
	return track;
}

// Resolve one target's own channels, then bake referenced shared channels (overlap → warn + drop).
function resolveAnimationTarget(rawTarget, effectiveShared, label) {
	const source = normalizeObject(rawTarget).value;
	const resolved = normalizeTrackChannels(source);

	normalizeArray(source.shared).value.forEach((key) => {
		const def = normalizeObject(effectiveShared[key]);
		if (!def.bool) {
			warnLog(`${label}: shared key '${key}' not found, dropping.`);
			return;
		}
		const defChannels = normalizeTrackChannels(def.value);
		for (const channel of animationChannels) {
			if (defChannels[channel] === undefined) continue;
			if (resolved[channel] !== undefined) {
				warnLog(`${label}: shared '${key}' ${channel} overlaps own track, dropping shared entry.`);
				continue;
			}
			resolved[channel] = defChannels[channel];
		}
	});

	const rawSwap = normalizeArray(source.swap).value;
	if (rawSwap.length > 0) {
		const snaps = [];
		rawSwap.forEach((rawSnap) => {
			const snap = normalizeObject(rawSnap).value;
			if (typeof snap.time !== "number" || typeof snap.sourceKey !== "string") {
				warnLog(`${label}: swap snap has invalid time or sourceKey, dropping.`);
				return;
			}
			snaps.push({ time: Math.max(0, Math.min(1, snap.time)), sourceKey: snap.sourceKey });
		});
		if (snaps.length > 0) resolved.swap = snaps.sort((a, b) => a.time - b.time);
	}

	return resolved;
}

// Structure + shared resolution (overlap/referential warn + drop). Keyframe values stay raw.
function resolveAnimations(rawAnimations, context, globalShared) {
	const source = normalizeObject(rawAnimations).value;
	const effectiveShared = { ...globalShared };
	const entityShared = normalizeObject(source.shared).value;
	for (const key in entityShared) {
		if (effectiveShared[key] !== undefined) warnLog(`animations.shared: entity key '${key}' shadows global definition.`);
		effectiveShared[key] = entityShared[key];
	}

	const animations = {};
	for (const animName in source) {
		if (animName === "shared") continue;
		const rawSet = normalizeObject(source[animName]).value;
		const set = normalizePayloadSchema(rawSet, "levelAnimationSet");
		set.parts = {};

		const rawParts = normalizeObject(rawSet.parts).value;
		for (const partId in rawParts) {
			const decalIds = context[partId];
			if (decalIds === undefined) {
				warnLog(`animations.${animName}.parts: unknown part '${partId}', dropping.`);
				continue;
			}
			const partLabel = `animations.${animName}.parts.${partId}`;
			const rawPartTarget = normalizeObject(rawParts[partId]).value;
			const partTarget = resolveAnimationTarget(rawPartTarget, effectiveShared, partLabel);
			partTarget.decals = {};

			const rawDecals = normalizeObject(rawPartTarget.decals).value;
			for (const decalId in rawDecals) {
				if (!decalIds.has(decalId)) {
					warnLog(`${partLabel}.decals: unknown decal '${decalId}', dropping.`);
					continue;
				}
				partTarget.decals[decalId] = resolveAnimationTarget(rawDecals[decalId], effectiveShared, `${partLabel}.decals.${decalId}`);
			}
			set.parts[partId] = partTarget;
		}
		animations[animName] = set;
	}
	return animations;
}

// Instance keyframe values once, in target-type context: position cnu, rotation degrees→radians
// (vector3 for parts, scalar for decals), scale cloned, color raw. Missing props stay absent (→ rest).
function instanceKeyframeValue(value, channel, isDecal) {
	if (channel === "color") return { ...value };
	const instanced = {};
	if (value.position !== undefined) instanced.position = toUnitVector3(value.position, "cnu");
	if (value.rotation !== undefined) {
		instanced.rotation = isDecal
			? new Unit(value.rotation, "degrees").toRadians(true)
			: toUnitVector3(value.rotation, "degrees").toRadians(true);
	}
	if (value.scale !== undefined) instanced.scale = CloneVector3(value.scale);
	return instanced;
}

function instanceTargetTracks(target, isDecal) {
	for (const channel of animationChannels) {
		if (target[channel] === undefined) continue;
		target[channel].keyframes.forEach((keyframe) => {
			keyframe.value = instanceKeyframeValue(keyframe.value, channel, isDecal);
		});
	}
}

// Walk resolved animations and instance every keyframe value exactly once. Only ever called on
// raw resolved data (never on already-instanced values), so it never re-instances.
function instanceAnimationTracks(animations) {
	for (const animName in animations) {
		const parts = animations[animName].parts;
		for (const partId in parts) {
			const partTarget = parts[partId];
			instanceTargetTracks(partTarget, false);
			for (const decalId in partTarget.decals) instanceTargetTracks(partTarget.decals[decalId], true);
		}
	}
}

function markMutableDecals(animations, parts) {
	const decalMap = new Map();
	parts.forEach((part) => part.customTextures.forEach((ct) => { if (ct.id) decalMap.set(ct.id, ct); }));
	for (const animName in animations) {
		const animParts = animations[animName].parts;
		for (const partId in animParts) {
			for (const decalId in animParts[partId].decals) {
				const track = animParts[partId].decals[decalId];
				const ct = decalMap.get(decalId);
				if (ct === undefined) continue;
				if (track.color !== undefined && track.color.keyframes.length > 0 && ct.decalType === "shape") {
					ct.mutable = true;
				}
				if (track.swap !== undefined && track.swap.length > 0) {
					if (ct.decalType === "shape") ct.mutable = true;
					if (ct.sources !== null) {
						const validKeys = new Set(Object.keys(ct.sources));
						track.swap = track.swap.filter((snap) => {
							if (validKeys.has(snap.sourceKey)) return true;
							warnLog(`animations.${animName}: decal '${decalId}' swap to unknown source '${snap.sourceKey}', dropping.`);
							return false;
						});
						if (track.swap.length === 0) delete track.swap;
					} else {
						warnLog(`animations.${animName}: decal '${decalId}' has swap track but no sources declared, dropping swap.`);
						delete track.swap;
					}
				}
			}
		}
	}
}

async function LevelPayload(payload) {
	const pendingImageLoads    = [];
	const affectedParts        = new Set();
	const affectedDecalSources = new Set();

	const resolveTextureId = (textureId, fallbackTextureId, fieldPath = "") => {
		if (objectDetail.textures[textureId] !== undefined) return textureId;
		if (fieldPath !== "") warnLog(`${fieldPath}: '${textureId}' invalid, using 'levelTexture.${fallbackTextureId}'.`);
		return fallbackTextureId;
	};

	const normalizeTexture = (rawTexture) => {
		const texture = normalizePayloadSchema(normalizeObject(rawTexture).value, "levelTexture");

		const fallback = canonSchemas.levelTexture.textureID.__meta.fallback;
		texture.textureID = resolveTextureId(texture.textureID, fallback, "textureID");
		if (texture.baseTextureID === null) texture.baseTextureID = texture.textureID;
		else texture.baseTextureID = resolveTextureId(texture.baseTextureID, texture.textureID);
		if (texture.materialTextureID === null) texture.materialTextureID = texture.textureID;
		else texture.materialTextureID = resolveTextureId(texture.materialTextureID, texture.textureID);
		return texture;
	};

	const normalizeScatter = (rawScatter) => {
		const resolvedScatter = [];

		normalizeArray(rawScatter).value.forEach((rawEntry) => {
			const entrySource = normalizeObject(rawEntry);
			if (!entrySource.bool) return;
			const entry = normalizePayloadSchema(entrySource.value, "levelScatterEntry");
			if (objectDetail.scatterTypes[entry.typeID] === undefined) {
				warnLog(`levelScatterEntry.typeID: '${entry.typeID}' invalid, dropping entry.`);
				return;
			}
			resolvedScatter.push(entry);
		});

		return resolvedScatter;
	};

	const normalizeDetail = (rawDetail) => {
		return { scatter: normalizeScatter(normalizeObject(rawDetail).value.scatter) };
	};

	const normalizeCustomTextures = (rawCustomTextures, part) => {
		const entries = [];

		// Adding a shape: register its key here AND in NewTexture.js shapeMaskBuilders AND in
		// canonSchemas.json levelCustomTexture.shape.allowedValues.
		const shapeRequiredFields = {
			square:   () => true,
			circle:   () => true,
			triangle: () => true,
		};

		const normalizeSources = (entry) => {
			const localWarnLog = (text) => warnLog(`normalizeCustomTextures: ${text}, dropping.`);

			if (entry.sources === null) return;

			const normalized = {};
			for (const key in entry.sources) {
				const rawSrc = normalizeObject(entry.sources[key]);
				if (!rawSrc.bool) { 
					localWarnLog(`nsource '${key}' is not a valid object`); 
					continue; 
				}
				const src = normalizePayloadSchema(rawSrc.value, "levelDecalSource");
				switch (src.decalType) {
					case null   : localWarnLog(`source '${key}' has null decalType`); continue;
					case "image":
						if (src.imagePath === null || src.sourceType === null) {
							localWarnLog(`image source '${key}' missing required fields`);
							continue;
						}
						normalized[key] = src;
						pendingImageLoads.push({ entry: src, promise: NormalizeImage(src.imagePath, src.sourceType, "webgl") });
						affectedDecalSources.add(entry);
						break;
					case "shape":
						if (src.shape === null) { localWarnLog(`shape source '${key}' missing required 'shape' field`); continue; }
						if (src.detail !== null) {
							const validBaseId = resolveTextureId(src.detail.baseTextureID, null);
							if (validBaseId === null && src.detail.baseTextureID !== null) {
								localWarnLog(`shape source '${key}' detail.baseTextureID '${src.detail.baseTextureID}' invalid`);
								continue;
							}
							src.detail.baseTextureID = validBaseId;
						}
						src.mutable = false;
						normalized[key] = src;
						break;
				}
			}
			entry.sources = Object.keys(normalized).length > 0 ? normalized : null;
		};

		normalizeArray(rawCustomTextures).value.forEach((rawEntry) => {
			const entrySource = normalizeObject(rawEntry);
			if (!entrySource.bool) return;
			const entry = normalizePayloadSchema(entrySource.value, "levelCustomTexture");

			entry.localTransform.position = toUnitVector3(entry.localTransform.position, "cnu");
			entry.localTransform.rotation = new Unit(entry.localTransform.rotation, "degrees").toRadians(true);
			entry.localTransform.scale    = CloneVector3(entry.localTransform.scale);

			switch (entry.decalType) {
				case null   : warnLog(`normalizeCustomTextures: dropping entry with null decalType.`); return;
				case "image":
					if (entry.imagePath === null || entry.sourceType === null) {
						warnLog(`normalizeCustomTextures: image decal missing required fields (imagePath=${entry.imagePath}, sourceType=${entry.sourceType}), dropping entry.`);
						return;
					}
					normalizeSources(entry);
					entries.push(entry);
					pendingImageLoads.push({ entry, promise: NormalizeImage(entry.imagePath, entry.sourceType, "webgl") });
					affectedParts.add(part);
					return;
				case "shape":
					if (entry.shape === null) {
						warnLog(`normalizeCustomTextures: shape decal missing required 'shape' field, dropping entry.`);
						return;
					}
					if (!shapeRequiredFields[entry.shape]()) {
						warnLog(`normalizeCustomTextures: shape '${entry.shape}' failed required field check, dropping entry.`);
						return;
					}
					if (entry.detail !== null) {
						const validBaseId = resolveTextureId(entry.detail.baseTextureID, null);
						if (validBaseId === null && entry.detail.baseTextureID !== null) {
							warnLog(`normalizeCustomTextures: detail.baseTextureID '${entry.detail.baseTextureID}' is not a valid texture ID, dropping entry.`);
							return;
						}
						entry.detail.baseTextureID = validBaseId;
					}
					entry.mutable = false;
					normalizeSources(entry);
					entries.push(entry);
					affectedParts.add(part);
					break;
			}
		});

		return entries;
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
		part.customTextures = normalizeCustomTextures(
			partSource.customTextures !== undefined ? partSource.customTextures : part.customTextures,
			part
		);
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
		object.customTextures = normalizeCustomTextures(
			objectSource.customTextures !== undefined ? objectSource.customTextures : object.customTextures,
			object
		);
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
			enemy      : { physics: "capsule",         hurtbox: "sphere",          hitbox: "capsule" },
			npc        : { physics: "capsule",         hurtbox: null,              hitbox: null },
			collectible: { physics: "sphere",          hurtbox: "sphere",          hitbox: null },
			projectile : { physics: "sphere",          hurtbox: "sphere",          hitbox: "sphere" },
			boss       : { physics: "compound-sphere", hurtbox: "compound-sphere", hitbox: null },
			entity     : { physics: "capsule",         hurtbox: null,              hitbox: null },
		};
		const defaults = defaultsByType[entityType] || defaultsByType.entity;
		const source = normalizeObject(rawCollisionOverride).value;
		const collisionOverride = normalizePayloadSchema(source, "levelCollisionOverride");

		return { 
			physics: collisionOverride.physics !== null ? collisionOverride.physics : defaults.physics, 
			hurtbox: source.hurtbox === null ? null : source.hurtbox === undefined
				? defaults.hurtbox
				: collisionOverride.hurtbox !== null
					? collisionOverride.hurtbox
					: defaults.hurtbox, 
			hitbox: source.hitbox === null ? null : source.hitbox === undefined
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
		blueprint.collisionOverride = resolveCollisionOverride(blueprintSource.collisionOverride, blueprint.type);
		blueprint.model.rootTransform = {
			position: toUnitVector3(blueprint.model.rootTransform.position, "cnu"),
			rotation: toUnitVector3(blueprint.model.rootTransform.rotation, "degrees").toRadians(true),
			scale   : CloneVector3(blueprint.model.rootTransform.scale),
			pivot   : toUnitVector3(blueprint.model.rootTransform.pivot, "cnu"),
		};
		blueprint.model.parts = normalizeArray(blueprintSource.model?.parts).value.map((part) => normalizePart(part));
		// Resolved but left raw (un-instanced) — instanced once per entity at the merge below.
		blueprint.animations = resolveAnimations(blueprintSource.animations, buildAnimationContext(blueprint.model.parts), globalShared);
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

	// Global shared animation definitions — kept raw; baked into each target during resolution.
	const globalShared = normalized.animations.shared;

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
		const mv = merged.movement;
		merged.movement = {
			...mv,
			start: toUnitVector3(mv.start, "cnu"),
			end  : toUnitVector3(mv.end,   "cnu"),
			speed: new Unit(mv.speed.value, "cnu"),
			jump : new Unit(mv.jump.value,  "cnu"),
		};
		merged.velocity = toUnitVector3(merged.velocity, "cnu");

		merged.id = override.id;
		merged.blueprintId = override.blueprintId;
		if (entrySource.type !== undefined) merged.type = override.type;
		if (entrySource.hp !== undefined && override.hp !== null) merged.hp = override.hp;
		if (entrySource.hardcoded !== undefined && override.hardcoded !== null) merged.hardcoded = override.hardcoded;
		if (entrySource.attacks !== undefined) merged.attacks = override.attacks;
		if (entrySource.platform !== undefined && override.platform !== null) merged.platform = override.platform;
		if (entrySource.animations !== undefined && override.animations !== null) {
			merged.animations = resolveAnimations(override.animations, buildAnimationContext(merged.model.parts), globalShared);
		}
		// Single instancing point: merged.animations is raw-resolved (cloned blueprint or override) here.
		instanceAnimationTracks(merged.animations);
		markMutableDecals(merged.animations, merged.model.parts);
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
	const playerSource = normalizeObject(rawPayload.player);
	if (playerSource.bool) {
		normalized.player = normalizePayloadSchema(playerSource.value, "levelPlayer");
		normalized.player.spawnPosition = toUnitVector3(normalized.player.spawnPosition, "cnu");
		normalized.player.scale = CloneVector3(normalized.player.scale);
		normalized.player.modelParts = normalizeArray(playerSource.value.modelParts).value.map((part) => normalizePart(part));
		normalized.player.metaOverrides = structuredClone(normalized.player.metaOverrides);
		if (!Array.isArray(normalized.player.metaOverrides.list)) normalized.player.metaOverrides.list = [];
		if (characterIds.includes(normalized.player.character) === false) {
			warnLog(`level.player.character: '${normalized.player.character}' missing, using '${characterIds[0]}'.`);
			normalized.player.character = characterIds[0];
		}
		// Animation targets resolve against custom modelParts, or the character profile's parts when absent.
		const playerParts = normalized.player.modelParts.length > 0
			? normalized.player.modelParts
			: characterData[normalized.player.character].model.parts;
		normalized.player.animations = resolveAnimations(playerSource.value.animations, buildAnimationContext(playerParts), globalShared);
		instanceAnimationTracks(normalized.player.animations);
		markMutableDecals(normalized.player.animations, playerParts);
	}
	else normalized.player = null;

	const musicSource = normalizeObject(rawPayload.music);
	normalized.music = musicSource.bool ? AudioPayload(musicSource.value) : null;

	await Promise.all(pendingImageLoads.map(({ entry, promise }) =>
		promise.then((result) => { entry.bitmap = result.bool ? result.value : null; })
	));
	affectedParts.forEach((part) => {
		part.customTextures = part.customTextures.filter((e) => e.decalType !== "image" || e.bitmap !== null);
	});
	affectedDecalSources.forEach((decalEntry) => {
		for (const key in decalEntry.sources) {
			if (decalEntry.sources[key].decalType === "image" && decalEntry.sources[key].bitmap === null) {
				delete decalEntry.sources[key];
			}
		}
		if (Object.keys(decalEntry.sources).length === 0) decalEntry.sources = null;
	});

	return normalized;
}

export default {
	AudioPayload,
	MenuPayload,
	SplashPayload,
	CutscenePayload,
	LevelPayload,
};