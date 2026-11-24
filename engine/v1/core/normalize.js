// Normalizes External Data coming into the Engine
// Engine-Owned Data should NOT be Normalized here
/*
Exceptions:
- Images: images aren't just normalized here, they're also pre-loaded to prevent pop-in. Engine-owned images may use NormalizeImage
*/


import canonSchemas from "./canonSchemas.json" with { type: "json" };
import characterData from "../player/characters.json" with { type: "json" };
import textureTemplates from "../builder/templates/textures.json" with { type: "json" };
import scatterTemplates from "../builder/templates/scatter.json" with { type: "json" };
import terrainTemplates from "../builder/templates/terrain.json" with { type: "json" };
import obstacleTemplates from "../builder/templates/obstacles.json" with { type: "json" };
import characterTemplates from "../builder/templates/characters.json" with { type: "json" };
import enemyTemplates from "../builder/templates/enemies.json" with { type: "json" };
import projectileTemplates from "../builder/templates/projectiles.json" with { type: "json" };
import particleTemplates from "../builder/templates/particles.json" with { type: "json" };
import cameraSets from "../camera/Sets.json" with { type: "json" };
import { Log, ENTITY_TYPES } from "./meta.js";
import { SKY_STOP_LIMIT } from "./config.js";
import { Clamp, ToNumber, Unit, UnitVector3 } from "../math/Utilities.js";
import { CloneVector3 } from "../math/Vector3.js";

const warnLog = (text) => Log("ENGINE", text, "warn", "Validation");

const cssUrlPattern = /url\((['"]?)([^'"()]+)\1\)/gi;

/* Data Type Normalization */

const normalize = {
	string: (value, fallback = "")    => {
		const bool = typeof value === "string";
		return { bool, value: bool ? value : fallback };
	},
	number: (value, fallback = 0)     => {
		const number = ToNumber(value, NaN);
		const bool = Number.isFinite(number);
		return { bool, value: bool ? number : fallback };
	},
	bool  : (value, fallback = false) => {
		const bool = typeof value === "boolean";
		return { bool, value: bool ? value : fallback };
	},
	array : (value, fallback = [])    => {
		const bool = Array.isArray(value);
		return { bool, value: bool ? value : fallback }; 
	},
	object: (value, fallback = {})    => {
		const bool = value !== null && typeof value === "object" && !Array.isArray(value);
		return { bool, value: bool ? value : fallback };
	}
};

const toUnitVector3 = (v, t) => new UnitVector3(v.x, v.y, v.z, t);

/* Generic Normalization */

// Meta values a schema field may leave out.
const metaDefaults = { aliases: [], isRequired: false, isExpected: false, deprecated: false };

// Resolve field references (e.g. 'fields.colorRed')
// Note: validate.js reads the same schemas, resolved here in place at load.
function resolveSchemas(layer) {
	for (const key in layer) {
		// Autofill missing meta fields
		if (key === "__meta") {
			layer.__meta = { ...metaDefaults, ...layer.__meta };
			continue;
		}

		// Resolve string-path
		if (typeof layer[key] === "string") layer[key] = layer[key].split(".").reduce((node, step) => node[step], canonSchemas);

		resolveSchemas(layer[key]);
	}
}
resolveSchemas(canonSchemas);

const normalizeSchemaKey = (key) => key.toLowerCase().replace(/[-_]/g, "");

function normalizePayloadSchema(payload, rootKey, extraKey = null) {
	const cloneFallback = (meta) => normalize.object(structuredClone(meta.fallback), meta.fallback).value;

	function resolveFieldLayer(payloadLayer, canonFieldLayer, path) {
		const sourceLayer = normalize.object(payloadLayer).value;
		const resolvedLayer = {}, matchedKeys = new Set();

		for (const key in canonFieldLayer) {
			if (key === "__meta" || key === "__entry") continue;

			const fieldSchema = canonFieldLayer[key], meta = fieldSchema.__meta;
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
				if (meta.isExpected === true) warnLog(`${rootKey}.${key}: missing, using fallback ${JSON.stringify(meta.fallback)}.`);
			}
			else {
				matchedKeys.add(matchedKey);
				resolvedValue = sourceLayer[matchedKey];
				if (meta.deprecated === true) warnLog(`${rootKey}.${key}: '${matchedKey}' is deprecated.`);

				// Warn on the alias spelling only. 
				// Note: `deprecated` also fires on the canonical name.
				if (meta.deprecatedAliases && meta.deprecatedAliases.some((alias) => normalizeSchemaKey(alias) === normalizeSchemaKey(matchedKey))) {
					warnLog(`${rootKey}.${key}: '${matchedKey}' is deprecated, use '${key}'.`);
				}

				let valid = meta.isExpected === false && resolvedValue === null;
				if (!valid) {
					switch (meta.dataType) {
						case "string" : valid = normalize.string(resolvedValue).bool; break;
						case "number" : valid = normalize.number(resolvedValue).bool; break;
						case "boolean": valid = normalize.bool(resolvedValue).bool  ; break;
						case "object" : valid = normalize.object(resolvedValue).bool; break;
						case "array"  : valid = normalize.array(resolvedValue).bool ; break;
						case "vector3": {
							const resolvedObject = normalize.object(resolvedValue);
							valid = (
								resolvedObject.bool &&
								normalize.number(resolvedObject.value.x).bool &&
								normalize.number(resolvedObject.value.y).bool &&
								normalize.number(resolvedObject.value.z).bool
							);
							break;
						}
					}
				}

				if (!valid) {
					warnLog(`${rootKey}.${key}: invalid ${meta.dataType}, using fallback ${JSON.stringify(meta.fallback)}.`);
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
					warnLog(`${rootKey}.${key}: '${resolvedValue}' not allowed, using fallback ${JSON.stringify(meta.fallback)}.`);
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
				resolvedValue = resolvedValue.map((entry, index) => resolveFieldLayer(entry, fieldSchema.__entry, `${path}.${key}[${index}]`));
			}
			else {
				let hasChildren = false;
				for (const childKey in fieldSchema) {
					if (childKey !== "__meta" && childKey !== "__entry") {
						hasChildren = true;
						break;
					}
				}

				if (hasChildren && resolvedValue !== null) resolvedValue = resolveFieldLayer(resolvedValue, fieldSchema, `${path}.${key}`);
			}

			resolvedLayer[key] = resolvedValue;
		}

		for (const payloadKey in sourceLayer) {
			if (!matchedKeys.has(payloadKey)) warnLog(`${path}.${payloadKey}: not recognized, dropped.`);
		}
		return resolvedLayer;
	}

	const canonLayer = extraKey === null ? canonSchemas[rootKey] : { ...canonSchemas[rootKey], ...canonSchemas[extraKey] };
	return resolveFieldLayer(normalize.object(payload).value, canonLayer, rootKey);
}

function AudioPayload(payload) {
	const rawPayload = normalize.object(payload).value;
	const normalized = normalizePayloadSchema({ ...normalize.object(rawPayload.options).value, ...rawPayload }, "audio");

	if (normalized.name === null) {
		if (normalized.id !== null) normalized.name = normalized.id;
		else if (normalized.src) {
			const sourceParts = normalized.src.split("/");
			const basename    = sourceParts[sourceParts.length - 1] || "AUDIO";
			normalized.name   = basename.replace(/\.[^.]+$/, "") || "AUDIO";
		}
	}

	if (normalized.id === null) normalized.id = normalized.name;

	const options = structuredClone(normalized.options);
	if (options.id      === undefined && normalized.id   !== null) options.id       = normalized.id;
	if (options.name    === undefined && normalized.name !== null) options.name     = normalized.name;
	if (normalized.rate !== null)                                  options.rate     = normalized.rate;
	if (normalized.loop !== null)                                  options.loop     = normalized.loop;
	if (normalized.category !== null)                              options.category = normalized.category;
	normalized.options = options;

	return normalized;
}

/* === MENU PAYLOAD NORMALIZATION === */

async function MenuPayload(payload) {
	const normalizeElements = (rawElements) => {
		const resolved = [];
		const sourceElements = normalize.array(rawElements).value;
		const directEventKeys = [
			"onClick", "onInput", "onChange", "onPointerover", "onPointerout", "onPointerdown", 
			"onPointerup", "onKeydown", "onKeyup", "onWheel", "onMousemove"
		];

		sourceElements.forEach(rawEntry => {
			const rawElement = normalize.object(rawEntry).value;
			const element = normalizePayloadSchema(rawElement, "menuElement");
			element.children = normalizeElements(rawElement.children);

			directEventKeys.forEach(directKey => {
				if (rawElement[directKey] !== undefined) element[directKey] = rawElement[directKey];
			});

			for (const key of ["id", "className", "text", "src", "value", "checked"]) if (element[key] === null) delete element[key];

			resolved.push(element);
		});

		return resolved;
	};

	const rawPayload = normalize.object(payload).value;
	const normalized = normalizePayloadSchema(rawPayload, "menu");

	normalized.elements = normalizeElements(rawPayload.elements);
	const musicSource   = normalize.object(rawPayload.music);
	normalized.music    = musicSource.bool ? AudioPayload(musicSource.value) : null;

	const pendingImageLoads = [], preloadedImages = [];
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
		elements.forEach(element => {
			if (element.type === "img" && element.src !== undefined) queueImagePath(element.src);
			if (typeof element.styles.backgroundImage === "string") {
				for (const match of element.styles.backgroundImage.matchAll(cssUrlPattern)) queueImagePath(match[2]);
			}

			queueElementImages(element.children);
		});
	};

	queueElementImages(normalized.elements);

	// Preload stylesheet backgrounds too, to keep them from popping in on first paint.
	if (normalized.stylesheet !== null) {
		for (const match of normalized.stylesheet.matchAll(cssUrlPattern)) queueImagePath(match[2]);
	}

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

		normalize.array(rawElements).value.forEach(rawEntry => {
			const rawElement = normalize.object(rawEntry).value;
			const element    = normalizePayloadSchema(rawElement, "menuElement");
			element.children = normalizeElements(rawElement.children);

			for (const key of ["id", "className", "text", "src", "value", "checked"]) if (element[key] === null) delete element[key];
			resolved.push(element);
		});

		return resolved;
	};
	const normalizeText = (rawTextEntries) => {
		const resolved = [];
		normalize.array(rawTextEntries).value.forEach(rawEntry => {
			const textEntry = normalizePayloadSchema(normalize.object(rawEntry).value, "splashText");
			for (const key of ["id", "className"]) if (textEntry[key] === null) delete textEntry[key];
			resolved.push(textEntry);
		});
		return resolved;
	};

	const rawPayload = normalize.object(payload).value;
	const normalized = normalizePayloadSchema(rawPayload, "splash");

	normalized.sequence = normalize.array(rawPayload.sequence).value.map((rawStep) => {
		const stepSource = normalize.object(rawStep).value;
		const step       = normalizePayloadSchema(stepSource, "splashStep");
		const sfxSource  = normalize.object(stepSource.sfx), voiceSource = normalize.object(stepSource.voice);
		step.sfx   = sfxSource.bool ? AudioPayload(sfxSource.value) : null;
		step.voice = voiceSource.bool ? AudioPayload(voiceSource.value) : null;
		if (step.sfx !== null && step.sfx.category === null) {
			step.sfx.category         = "Menu";
			step.sfx.options.category = "Menu";
		}
		if (step.voice !== null && step.voice.category === null) {
			step.voice.category         = "Voice";
			step.voice.options.category = "Voice";
		}
		step.elements = normalizeElements(stepSource.elements);
		step.text = normalizeText(stepSource.text);
		return step;
	});

	if (normalized.outputType === "preset" && normalized.presetId === null) {
		warnLog("Splash Presets: expected a non-empty array of preset IDs, using default.");
		normalized.outputType = "default";
	}

	if (normalized.outputType === "custom" && normalized.sequence.length === 0) {
		warnLog("Splash Custom: custom payload had no steps, using default.");
		normalized.outputType = "default";
	}

	if (normalized.outputType === "default") {
		normalized.presetId = null;
		normalized.sequence = [];
	}

	return normalized;
}

function CutscenePayload(payload, type) {
	const rootKey    = type === "rendered" ? "cutsceneRendered" : "cutsceneEngine";
	const normalized = normalizePayloadSchema(payload, rootKey);

	if (type === "engine" && normalized.fadeLeadSeconds > normalized.durationSeconds) {
		warnLog(`Cutscene fadeLeadSeconds: clamped ${normalized.fadeLeadSeconds} to duration ${normalized.durationSeconds}.`);
		normalized.fadeLeadSeconds = normalized.durationSeconds;
	}

	return normalized;
}

export async function NormalizeImage(path, sourceType, renderType) {
	try {
		const response = await fetch(path);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		
		// Premultiply alpha at load to match how WebGL blends decals.
		const bitmap = await createImageBitmap(await response.blob(), renderType === "html" ? {} : { premultiplyAlpha: "premultiply" });
		return renderType === "html" ? { bool: true, value: { image: bitmap, url: path } } : { bool: true, value: bitmap };
	} 
	catch (e) {
		warnLog(`Image: failed to load '${path}' (${sourceType}):\n${e.message}`);
		return { bool: false, value: null };
	}
}

/* Animation Normalization */

const animationChannels = ["transform", "color"];

// List the parts and decals an animation can target, by id.
function buildAnimationContext(parts) {
	const context = {};
	parts.forEach(part => {
		const decalIds = new Set();
		for (const decal of part.texture.custom) if (decal.id) decalIds.add(decal.id);
		context[part.id] = decalIds;
	});
	return context;
}

// Normalize each keyframe's time and easing.
function normalizeKeyframeList(rawKeyframes) {
	return normalize.array(rawKeyframes).value.map((rawEntry) => {
		const source   = normalize.object(rawEntry).value;
		const keyframe = normalizePayloadSchema(source, "levelAnimationKeyframe");
		keyframe.value = normalize.object(source.value).value;
		return keyframe;
	});
}

function normalizeTrackChannels(rawTrack) {
	const track = {};
	for (const channel of animationChannels) {
		const channelSource = normalize.object(rawTrack[channel]);
		if (channelSource.bool) track[channel] = { keyframes: normalizeKeyframeList(channelSource.value.keyframes) };
	}
	return track;
}

// Resolve a target's own channels and add the shared channels it references.
function resolveAnimationTarget(rawTarget, effectiveShared, label) {
	const source = normalize.object(rawTarget).value;
	const resolved = normalizeTrackChannels(source);

	normalize.array(source.shared).value.forEach(key => {
		const def = normalize.object(effectiveShared[key]);
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

	const rawSwap = normalize.array(source.swap).value;
	if (rawSwap.length > 0) {
		const snaps = [];
		rawSwap.forEach(rawSnap => {
			const snap = normalize.object(rawSnap).value;
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

// Resolve animation sets and their shared definitions. Keyframe values stay raw.
function resolveAnimations(rawAnimations, context, globalShared) {
	const source = normalize.object(rawAnimations).value;
	const effectiveShared = { ...globalShared };
	const entityShared = normalize.object(source.shared).value;
	for (const key in entityShared) {
		if (effectiveShared[key] !== undefined) warnLog(`animations.shared: entity key '${key}' shadows global definition.`);
		effectiveShared[key] = entityShared[key];
	}

	const animations = {};
	for (const animName in source) {
		if (animName === "shared") continue;
		const rawSet = normalize.object(source[animName]).value;
		const set = normalizePayloadSchema(rawSet, "levelAnimationSet");
		set.parts = {};

		const rawParts = normalize.object(rawSet.parts).value;
		for (const partId in rawParts) {
			const decalIds = context[partId];
			if (decalIds === undefined) {
				warnLog(`animations.${animName}.parts: unknown part '${partId}', dropping.`);
				continue;
			}
			const partLabel = `animations.${animName}.parts.${partId}`;
			const rawPartTarget = normalize.object(rawParts[partId]).value;
			const partTarget = resolveAnimationTarget(rawPartTarget, effectiveShared, partLabel);
			partTarget.decals = {};

			const rawDecals = normalize.object(rawPartTarget.decals).value;
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

// Instance a keyframe value for its channel and target. Absent values fall back to rest.
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
		target[channel].keyframes.forEach(keyframe => {
			keyframe.value = instanceKeyframeValue(keyframe.value, channel, isDecal);
		});
	}
}

// Instance every resolved keyframe value once. Only call this on raw data.
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
	// Let the GPU recolor this decal, defaulting to white when colorless.
	const markMutable = (ct) => {
		ct.mutable = true;
		if (ct.texture.primary === null) ct.texture.primary = { r: 1, g: 1, b: 1, a: 1 };
	};
	const decalMap = new Map();
	for (const part of parts) {
		for (const ct of part.texture.custom) if (ct.id) decalMap.set(ct.id, ct);
	}
	for (const animName in animations) {
		const animParts = animations[animName].parts;
		for (const partId in animParts) {
			for (const decalId in animParts[partId].decals) {
				const track = animParts[partId].decals[decalId], ct = decalMap.get(decalId);
				if (ct === undefined) continue;
				if (track.color !== undefined && track.color.keyframes.length > 0 && ct.decalType === "shape") markMutable(ct);
				if (track.swap !== undefined && track.swap.length > 0) {
					if (ct.decalType === "shape") markMutable(ct);
					if (ct.sources !== null) {
						const validKeys = new Set(Object.keys(ct.sources));
						track.swap = track.swap.filter((snap) => {
							if (validKeys.has(snap.sourceKey)) return true;
							warnLog(`animations.${animName}: decal '${decalId}' swap to unknown source '${snap.sourceKey}', dropping.`);
							return false;
						});

						if (track.swap.length === 0) delete track.swap;
					} 
					else {
						warnLog(`animations.${animName}: decal '${decalId}' has swap track but no sources declared, dropping swap.`);
						delete track.swap;
					}
				}
			}
		}
	}
}

const defaultsByShape = {
	cube          : "obb",
	plane         : "obb",
	cylinder      : "capsule",
	capsule       : "capsule",
	sphere        : "sphere",
	pyramid       : "triangle-soup",
	cone          : "triangle-soup",
	tube          : "triangle-soup",
	torus         : "triangle-soup",
	"ramp-simple" : "triangle-soup",
	"ramp-complex": "triangle-soup",
};

function resolveTextureId(textureId, fallbackTextureId, fieldPath, ctx) {
	if (findTemplate(ctx, "texture", textureId) !== undefined) return textureId;
	warnLog(`${fieldPath}: '${textureId}' invalid, using '${fallbackTextureId}'.`);
	return fallbackTextureId;
}

// Move a color shorthand onto the texture color it stands for (if not already set).
function foldColorAlias(source, sourceKey, dest, destKey) {
	if (source[sourceKey] !== null && dest[destKey] === null) dest[destKey] = source[sourceKey];
	delete source[sourceKey];
}

// Fill in a decal's texture and move its color shorthands into place.
function normalizeDecalTexture(entry, rootKey, ctx) {
	entry.texture = normalizePayloadSchema(normalize.object(entry.texture).value, "decalTexture");
	foldColorAlias(entry.texture, "color", entry.texture, "secondary");
	foldColorAlias(entry, "color", entry.texture, "primary");

	// Fall back to the default texture when the id doesn't exist.
	entry.texture.id = resolveTextureId(entry.texture.id, canonSchemas.decalTexture.id.__meta.fallback, `${rootKey}.texture.id`, ctx);
}

function normalizeTexture(rawTexture, part, ctx) {
	const source = normalize.object(rawTexture).value;
	const base   = normalizePayloadSchema(normalize.object(source.base).value, "generatedTexture");
	foldColorAlias(base, "color", base, "secondary");

	const fallback = canonSchemas.generatedTexture.id.__meta.fallback;
	base.id = resolveTextureId(base.id, fallback, "texture.base.id", ctx);

	return { base, custom: normalizeCustomTextures(source.custom, part, ctx) };
}

function normalizeScatter(rawScatter, ctx) {
	const resolvedScatter = [];

	normalize.array(rawScatter).value.forEach(rawEntry => {
		const entrySource = normalize.object(rawEntry);
		if (!entrySource.bool) return;
		
		const entry = normalizePayloadSchema(entrySource.value, "levelScatterEntry");
		if (findTemplate(ctx, "scatter", entry.typeID) === undefined) {
			warnLog(`levelScatterEntry.typeID: '${entry.typeID}' invalid, dropping entry.`);
			return;
		}
		resolvedScatter.push(entry);
	});

	return resolvedScatter;
}

const normalizeDetail = (rawDetail, ctx) => { return { scatter: normalizeScatter(normalize.object(rawDetail).value.scatter, ctx) }};

function normalizeCustomTextures(rawCustomTextures, part, ctx) {
	const entries = [];

	// Note: New shapes also go in NewTexture.js and the decal shape lists in canonSchemas.json.
	const shapeRequiredFields = {
		square:   () => true,
		circle:   () => true,
		triangle: () => true,
		pill:     () => true,
	};

	const normalizeSources = (entry) => {
		const localWarnLog = (text) => warnLog(`normalizeCustomTextures: ${text}, dropping.`);

		if (entry.sources === null) return;

		const normalized = {};
		for (const key in entry.sources) {
			const rawSrc = normalize.object(entry.sources[key]);
			if (!rawSrc.bool) {
				localWarnLog(`nsource '${key}' is not a valid object`);
				continue;
			}
			const src = normalizePayloadSchema(rawSrc.value, "levelDecalSource");
			normalizeDecalTexture(src, "levelDecalSource", ctx);
			switch (src.decalType) {
				case null   : localWarnLog(`source '${key}' has null decalType`); continue;
				case "image":
					if (src.imagePath === null || src.sourceType === null) {
						localWarnLog(`image source '${key}' missing required fields`);
						continue;
					}
					normalized[key] = src;
					ctx.pendingImageLoads.push({ entry: src, promise: NormalizeImage(src.imagePath, src.sourceType, "webgl") });
					ctx.affectedDecalSources.add(entry);
					break;
				case "shape":
					if (src.shape === null) {
						localWarnLog(`shape source '${key}' missing required 'shape' field`);
						continue;
					}
					src.mutable = false;
					normalized[key] = src;
					break;
			}
		}
		entry.sources = Object.keys(normalized).length > 0 ? normalized : null;
	};

	normalize.array(rawCustomTextures).value.forEach(rawEntry => {
		const entrySource = normalize.object(rawEntry);
		if (!entrySource.bool) return;
		const entry = normalizePayloadSchema(entrySource.value, "levelCustomTexture");
		normalizeDecalTexture(entry, "levelCustomTexture", ctx);

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
				entry.opacity = Math.min(1, Math.max(0, normalize.number(entrySource.value.opacity, 1).value));
				normalizeSources(entry);
				entries.push(entry);
				ctx.pendingImageLoads.push({ entry, promise: NormalizeImage(entry.imagePath, entry.sourceType, "webgl") });
				ctx.affectedParts.add(part);
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
				entry.mutable = false;
				normalizeSources(entry);
				entries.push(entry);
				ctx.affectedParts.add(part);
				break;
		}
	});

	return entries;
}

function normalizeTubeNode(rawNode) {
	const node = normalizePayloadSchema(normalize.object(rawNode).value, "tubeNode");
	node.dimensions    = toUnitVector3(node.dimensions, "cnu");
	node.localPosition = toUnitVector3(node.localPosition, "cnu");
	node.localRotation = toUnitVector3(node.localRotation, "degrees").toRadians(true);
	node.thickness     = new Unit(node.thickness, "cnu");
	return node;
}

// Normalize a tube's primitiveOptions into a fresh object.
function normalizeTubeOptions(rawOptions) {
	// Resolve complexity through its schema.
	const complexity = normalizePayloadSchema(rawOptions.complexity === undefined ? {} : { complexity: rawOptions.complexity }, "complexityOptions").complexity;
	return {
		...rawOptions,
		complexity,
		nodes     : normalize.array(rawOptions.nodes).value.map((node) => normalizeTubeNode(node)),
		thickness : new Unit(normalize.number(rawOptions.thickness, 0.1).value, "cnu"),
		curved    : normalize.bool(rawOptions.curved, false).value,
		solid     : normalize.bool(rawOptions.solid, false).value,
		smoothness: Clamp(normalize.number(rawOptions.smoothness, 0).value, 0, 1),
	};
}

function normalizeRampOptions(rawOptions, label) {
	const options = normalizePayloadSchema(rawOptions, "rampOptions", "complexityOptions");
	if (options.depth === null) {
		warnLog(`${label}: ramp-complex missing 'depth', using fallback 0.5.`);
		options.depth = 0.5;
	}
	return options;
}

// Normalize a plane's depth, options and sprite.
function normalizePlaneOptions(owner, label, ctx) {
	// Flatten the plane to keep decals and attached parts right on its front and back.
	owner.dimensions.z = 0;

	const options = normalizePayloadSchema(owner.primitiveOptions, "planeOptions");

	// Read the owner's texture as authored. It's normalized after the shape.
	const texture = normalize.object(owner.texture).value;

	// Drop the decals a crossed or sprite plane can't carry.
	if ((options.crossed || options.sprite !== null) && normalize.array(texture.custom).value.length > 0) {
		warnLog(`${label}: decals can't sit on a crossed or sprite plane, dropping them.`);
		owner.texture = { ...texture, custom: [] };
	}
	if (options.sprite === null) return options;

	const sprite = options.sprite = normalizePayloadSchema(options.sprite, "spriteOptions");
	if (sprite.range !== null)         sprite.range         = new Unit(sprite.range, "cnu");
	if (sprite.occludedRange !== null) sprite.occludedRange = new Unit(sprite.occludedRange, "cnu");

	// Queue the sprite's image load, or drop an image missing its source.
	if (sprite.image !== null && (sprite.image.path === null || sprite.image.sourceType === null)) {
		warnLog(`${label}: sprite image missing path or sourceType, dropping image.`);
		sprite.image = null;
	}
	if (sprite.image !== null) {
		// Warn about an authored base texture if the image fails to load.
		if (Object.keys(normalize.object(texture.base).value).length > 0) warnLog(`${label}: a sprite with an image draws no base texture, dropping it once the image loads.`);
		ctx.pendingImageLoads.push({ entry: sprite.image, promise: NormalizeImage(sprite.image.path, sprite.image.sourceType, "webgl") });
		ctx.affectedParts.add(owner);
	}
	return options;
}

/* Template Reference Normalization (boundary lookups only — no definition construction) */

// Engine template collections, read live to find templates a level registers while it runs.
const templateCollections = {
	terrain        : terrainTemplates,
	obstacle       : obstacleTemplates,
	character      : characterTemplates,
	enemy          : enemyTemplates,
	projectile     : projectileTemplates,
	particle       : particleTemplates,
	texture        : textureTemplates,
	scatter        : scatterTemplates,
	playerCharacter: characterData,
};

// The game template collection checked before each engine one. Characters and enemies share npcs.
const gameCollections = {
	terrain        : "terrain",
	obstacle       : "obstacles",
	character      : "npcs",
	enemy          : "npcs",
	projectile     : "projectiles",
	particle       : "particles",
	texture        : "textures",
	scatter        : "scatter",
	playerCharacter: "playerCharacters",
};

// Empty game template collections, for lookups outside a level payload.
function emptyGameTemplates() {
	return { textures: {}, scatter: {}, particles: {}, terrain: {}, obstacles: {}, npcs: {}, projectiles: {}, playerCharacters: {} };
}

// Empty game templates for lookups that only read them: simulator definitions and runtime requests.
const noGameTemplates = emptyGameTemplates();

// Find a template by id. A level's game template overrides the engine one.
function findTemplate(ctx, collection, id) {
	const gameTemplates = ctx.templates[gameCollections[collection]], engineTemplates = templateCollections[collection];
	if (Object.hasOwn(gameTemplates, id)) return gameTemplates[id];
	return Object.hasOwn(engineTemplates, id) ? engineTemplates[id] : undefined;
}

// Entity types per template collection, for collision override defaults.
const templateEntityTypes = { character: "entity", enemy: "enemy", projectile: "projectile" };

export function IsTemplateRef(value) {
	const shape = normalize.object(value).value.shape;
	return shape === "template" || shape === "blueprint";
}

function templatePartList(ctx, collection, templateId) {
	const template = findTemplate(ctx, collection, templateId);
	return collection === "terrain" || collection === "obstacle" ? template.parts : template.model.parts;
}

// Drop a generator whose template id doesn't exist.
function normalizeParticle(particle, label, ctx) {
	if (findTemplate(ctx, "particle", particle.id) === undefined) {
		warnLog(`${label}: unknown particle template '${particle.id}', dropping generator.`);
		return null;
	}

	instanceParticle(particle);
	return particle;
}

// Instance a generator's offset, area and velocity override.
function instanceParticle(particle) {
	particle.position = toUnitVector3(particle.position, "cnu");
	particle.area     = toUnitVector3(particle.area, "cnu");
	if (particle.overrides !== null && particle.overrides.velocity !== null) particle.overrides.velocity = toUnitVector3(particle.overrides.velocity, "cnu");
}

// Fill an authored generator from its schema, then check and instance it.
const normalizeGenerator = (rawParticle, label, ctx) => rawParticle === null ? null : normalizeParticle(normalizePayloadSchema(rawParticle, "particleGenerator"), label, ctx);

// Drop root-authored and keep part-authored particle generators.
function normalizeRootParticle(particle, partCount, label, ctx) {
	if (particle !== null && partCount > 0) {
		warnLog(`${label}.particle: generators are per-part on an object with parts, dropping root generator.`);
		return null;
	}
	return normalizeGenerator(particle, `${label}.particle`, ctx);
}

// Drop the particle generators on a void and its parts.
function dropVoidGenerators(carriers, label) {
	const emitting = carriers.filter((carrier) => carrier.particle !== null);
	if (emitting.length === 0) return;
	warnLog(`${label}: a void can't carry particle generators, dropping ${emitting.length}.`);
	emitting.forEach(carrier => carrier.particle = null);
}

function normalizeOverrideTexture(texture, label, ctx) {
	texture.base = normalizePayloadSchema(texture.base, "generatedTexture");
	foldColorAlias(texture.base, "color", texture.base, "secondary");
	const fallback = canonSchemas.generatedTexture.id.__meta.fallback;
	texture.base.id = resolveTextureId(texture.base.id, fallback, `${label}.texture.base.id`, ctx);
}

// Check a template part is a sprite with an image.
const isImageSprite = (part) => part.shape === "plane" && part.primitiveOptions.sprite !== null && part.primitiveOptions.sprite.image !== null;

function normalizeTemplatePartOverrides(overrides, ctx, collection, templateId, label) {
	const partsById = new Map(templatePartList(ctx, collection, templateId).map((part) => [part.id, part]));

	return overrides.filter((entry) => {
		if (!partsById.has(entry.id)) {
			warnLog(`${label}: unknown template part '${entry.id}', dropping override.`);
			return false;
		}
		if ((entry.texture !== null || entry.color !== null) && isImageSprite(partsById.get(entry.id))) {
			warnLog(`${label}.parts.${entry.id}: a sprite with an image draws no base texture, dropping its texture and color overrides.`);
			entry.texture = null;
			entry.color   = null;
		}
		if (entry.scale !== null) entry.scale = CloneVector3(entry.scale);
		if (entry.texture !== null) normalizeOverrideTexture(entry.texture, `${label}.parts.${entry.id}`, ctx);
		entry.particle = normalizeGenerator(entry.particle, `${label}.parts.${entry.id}.particle`, ctx);
		return true;
	});
}

// Move the ref's texture and color into each part's override.
function foldRefTexture(ref, templateParts, label) {
	if (ref.texture === null && ref.color === null) return;

	const overridesById = new Map(ref.parts.map((entry) => [entry.id, entry]));
	for (const part of templateParts) {
		if (isImageSprite(part)) {
			warnLog(`${label}.parts.${part.id}: a sprite with an image draws no base texture, skipping the ref's texture and color.`);
			continue;
		}
		let entry = overridesById.get(part.id);
		if (entry === undefined) ref.parts.push(entry = { id: part.id, color: null, texture: null, scale: null, particle: null });

		// Keep a part's own texture over the ref's.
		if (entry.texture !== null) continue;
		entry.texture = ref.texture;
		entry.color   = entry.color ?? ref.color;
	}
	ref.texture = null;
	ref.color   = null;
}

function normalizeObjectTemplateRef(rawObject, ctx, collection, label) {
	const ref = normalizePayloadSchema(normalize.object(rawObject).value, "templateObjectRef");
	ref.shape = "template";

	if (findTemplate(ctx, collection, ref.template) === undefined) {
		warnLog(`${label}: unknown ${collection} template '${ref.template}', dropping entry.`);
		return null;
	}

	ref.position = toUnitVector3(ref.position, "cnu");
	ref.rotation = toUnitVector3(ref.rotation, "degrees").toRadians(true);
	if (ref.scale !== null) ref.scale = CloneVector3(ref.scale);
	if (ref.texture !== null) normalizeOverrideTexture(ref.texture, label, ctx);
	ref.particle = normalizeRootParticle(ref.particle, templatePartList(ctx, collection, ref.template).length, label, ctx);
	ref.parts = normalizeTemplatePartOverrides(ref.parts, ctx, collection, ref.template, label);
	if ((ref.mode ?? findTemplate(ctx, collection, ref.template).shared.mode) === "void") dropVoidGenerators([ref, ...ref.parts], label);
	foldRefTexture(ref, templatePartList(ctx, collection, ref.template), label);
	ctx.surfaceIds.add(ref.id);
	return ref;
}

function normalizeEntityTemplateRef(rawRef, ctx, label) {
	const refSource = normalize.object(rawRef).value;
	const ref = normalizePayloadSchema(refSource, "templateEntityRef");
	ref.shape = "template";

	if (findTemplate(ctx, ref.type, ref.template) === undefined) {
		warnLog(`${label}: unknown ${ref.type} template '${ref.template}', dropping entry.`);
		return null;
	}

	if (ref.collisionOverride !== null) ref.collisionOverride = resolveCollisionOverride(ref.collisionOverride, templateEntityTypes[ref.type]);

	ref.model.rootTransform = normalizeRootTransform(ref.model.rootTransform, false);
	ref.model.parts         = normalizeTemplatePartOverrides(ref.model.parts, ctx, ref.type, ref.template, label);
	return ref;
}

function normalizePart(rawPart, ctx) {
	const partSource   = normalize.object(rawPart).value;
	const part         = normalizePayloadSchema(partSource, "levelPart");
	part.dimensions    = toUnitVector3(part.dimensions, "cnu");
	part.localPosition = toUnitVector3(part.localPosition, "cnu");
	part.localRotation = toUnitVector3(part.localRotation, "degrees").toRadians(true);
	part.localScale    = CloneVector3(part.localScale);
	part.pivot         = toUnitVector3(part.pivot, "cnu");

	// Resolve the shape first. A plane's options decide which textures it keeps.
	switch(part.shape) {
		case "tube"        : part.primitiveOptions = normalizeTubeOptions(part.primitiveOptions);                                          break;
		case "ramp-complex": part.primitiveOptions = normalizeRampOptions(part.primitiveOptions, `levelPart.${part.id}`);                  break;
		case "capsule"     : part.primitiveOptions = normalizePayloadSchema(part.primitiveOptions, "capsuleOptions", "complexityOptions"); break;
		case "torus"       : part.primitiveOptions = normalizePayloadSchema(part.primitiveOptions, "torusOptions", "complexityOptions");   break;
		case "cylinder"    :
		case "sphere"      :
		case "cone"        : part.primitiveOptions = normalizePayloadSchema(part.primitiveOptions, "complexityOptions"); break;
		case "plane"       : part.primitiveOptions = normalizePlaneOptions(part, `levelPart.${part.id}`, ctx);           break;
	}

	part.texture = normalizeTexture(part.texture, part, ctx);
	foldColorAlias(part, "color", part.texture.base, "primary");
	part.detail   = normalizeDetail(partSource.detail !== undefined ? partSource.detail : part.detail, ctx);
	part.particle = normalizeGenerator(part.particle, `levelPart.${part.id}.particle`, ctx);
	if (part.label === null) delete part.label;

	return part;
}

// Shapes that can't be voids, since a void must be a closed solid.
const openPrimitiveShapes = new Set(["plane"]);
function hasOpenPrimitive(object) {
	return object.parts.length === 0
		? openPrimitiveShapes.has(object.shape)
		: object.parts.some((part) => openPrimitiveShapes.has(part.shape));
}

function normalizeLevelObject(rawObject, ctx, role) {
	const objectSource = normalize.object(rawObject).value;
	const object       = normalizePayloadSchema(objectSource, "levelObject", role === "obstacle" ? "obstacleFields" : null);
	object.dimensions  = toUnitVector3(object.dimensions, "cnu");
	object.position    = toUnitVector3(object.position, "cnu");
	object.rotation    = toUnitVector3(object.rotation, "degrees").toRadians(true);
	object.scale       = CloneVector3(object.scale);
	object.pivot       = toUnitVector3(object.pivot, "cnu");

	// Resolve the shape first. A plane's options decide which textures it keeps.
	switch (object.shape) {
		case "tube"        : object.primitiveOptions = normalizeTubeOptions(object.primitiveOptions);                                          break;
		case "ramp-complex": object.primitiveOptions = normalizeRampOptions(object.primitiveOptions, `levelObject.${object.id}`);              break;
		case "capsule"     : object.primitiveOptions = normalizePayloadSchema(object.primitiveOptions, "capsuleOptions", "complexityOptions"); break;
		case "torus"       : object.primitiveOptions = normalizePayloadSchema(object.primitiveOptions, "torusOptions", "complexityOptions");   break;
		case "cylinder"    :
		case "sphere"      :
		case "cone"        : object.primitiveOptions = normalizePayloadSchema(object.primitiveOptions, "complexityOptions"); break;
		case "plane"       : object.primitiveOptions = normalizePlaneOptions(object, `levelObject.${object.id}`, ctx);       break;
	}
	object.texture = normalizeTexture(object.texture, object, ctx);
	foldColorAlias(object, "color", object.texture.base, "primary");
	object.detail = normalizeDetail(objectSource.detail !== undefined ? objectSource.detail : object.detail, ctx);
	object.parts  = normalize.array(objectSource.parts).value.map((part) => normalizePart(part, ctx));
	if (object.mode === "void" && hasOpenPrimitive(object)) {
		warnLog(`levelObject.${object.id}: mode 'void' requires a closed shape, dropping.`);
		return null;
	}
	object.particle = normalizeRootParticle(object.particle, object.parts.length, `levelObject.${object.id}`, ctx);
	if (object.mode === "void") dropVoidGenerators([object, ...object.parts], `levelObject.${object.id}`);

	// Default crossed and sprite planes to box collision. Neither is flat.
	const boxedPlane = object.shape === "plane" && (object.primitiveOptions.crossed || object.primitiveOptions.sprite !== null);
	object.collisionShape = object.collisionShape !== null ? object.collisionShape : role === "obstacle" && object.parts.length > 1 
		? "triangle-soup"
		: boxedPlane ? "aabb" : defaultsByShape[object.shape];
	ctx.surfaceIds.add(object.id);
	return object;
}

function normalizeMovement(rawMovement) {
	const movement = normalizePayloadSchema(normalize.object(rawMovement).value, "levelMovement");
	movement.start = toUnitVector3(movement.start, "cnu");
	movement.end   = toUnitVector3(movement.end, "cnu");
	movement.speed = new Unit(movement.speed, "cnu");
	return movement;
}

function resolveCollisionOverride(rawCollisionOverride, entityType) {
	const defaultsByType = {
		enemy      : { physics: "auto",            hurtbox: "sphere",          hitbox: "capsule" },
		npc        : { physics: "auto",            hurtbox: null,              hitbox: null },
		collectible: { physics: "sphere",          hurtbox: "sphere",          hitbox: null },
		projectile : { physics: "sphere",          hurtbox: "sphere",          hitbox: "sphere" },
		boss       : { physics: "compound-sphere", hurtbox: "compound-sphere", hitbox: null },
		entity     : { physics: "auto",            hurtbox: null,              hitbox: null },
	};
	const defaults = defaultsByType[entityType] || defaultsByType.entity;
	const source = normalize.object(rawCollisionOverride).value;
	const collisionOverride = normalizePayloadSchema(source, "levelCollisionOverride");

	return {
		physics: collisionOverride.physics ?? defaults.physics,
		hurtbox: source.hurtbox === null ? null : collisionOverride.hurtbox ?? defaults.hurtbox,
		hitbox : source.hitbox  === null ? null : collisionOverride.hitbox  ?? defaults.hitbox,
	};
}

function normalizeAttacks(rawAttacks) {
	return normalize.array(rawAttacks).value.map((rawAttack) => normalizePayloadSchema(normalize.object(rawAttack).value, "levelAttack"));
}

// Instance root-transform fields. Without requireAll, null override fields stay null.
function normalizeRootTransform(transform, requireAll) {
	const conv = (value, fn) => (requireAll === false && value === null) ? null : fn(value);
	return {
		position: conv(transform.position, (v) => toUnitVector3(v, "cnu")),
		rotation: conv(transform.rotation, (v) => toUnitVector3(v, "degrees").toRadians(true)),
		scale   : conv(transform.scale, CloneVector3),
		pivot   : conv(transform.pivot, (v) => toUnitVector3(v, "cnu")),
	};
}

// Fill an entity's meta: hp on every type, plus aggroRange on enemies.
const normalizeMeta = (rawMeta, type) => normalizePayloadSchema(normalize.object(rawMeta).value, "entityMeta", type === "enemy" ? "enemyMeta" : null);

// Fill a meta override. Fields it leaves out stay null to keep the template's own.
const normalizeMetaOverride = (rawMeta, type) => normalizePayloadSchema(normalize.object(rawMeta).value, "entityMetaOverride", type === "enemy" ? "enemyMetaOverride" : null);

// Instance an enemy's aggro range.
function instanceMeta(meta, type) {
	if (type === "enemy" && meta.aggroRange !== null) meta.aggroRange = new Unit(meta.aggroRange, "cnu");
	return meta;
}

function normalizeBlueprint(rawBlueprint, ctx, globalShared) {
	const blueprintSource         = normalize.object(rawBlueprint).value;
	const blueprint               = normalizePayloadSchema(blueprintSource, "levelEntityBlueprint");
	blueprint.movement            = normalizeMovement(blueprintSource.movement);
	blueprint.velocity            = toUnitVector3(blueprint.velocity, "cnu");
	blueprint.attacks             = normalizeAttacks(blueprintSource.attacks);
	blueprint.meta                = normalizeMeta(blueprintSource.meta, blueprint.type);    // Instanced at the merge below
	blueprint.collisionOverride   = resolveCollisionOverride(blueprintSource.collisionOverride, blueprint.type);
	blueprint.model.rootTransform = normalizeRootTransform(blueprint.model.rootTransform, true);
	blueprint.model.parts         = normalize.array(blueprintSource.model?.parts).value.map((part) => normalizePart(part, ctx));
	
	// Leave animations uninstanced. Each entity instances its own copy when merged.
	blueprint.animations = resolveAnimations(blueprintSource.animations, buildAnimationContext(blueprint.model.parts), globalShared);
	return blueprint;
}

function normalizeOverride(rawOverride) {
	const overrideSource   = normalize.object(rawOverride).value;
	const override         = normalizePayloadSchema(overrideSource, "levelEntityOverride");
	override.movement      = normalizeMovement(overrideSource.movement);
	override.velocity      = toUnitVector3(override.velocity, "cnu");
	override.attacks       = normalizeAttacks(overrideSource.attacks);
	override.rootTransform = normalizeRootTransform(override.rootTransform, true);
	return override;
}

function resolveMergedSpawnSurface(merged, ctx) {
	if (merged.model.spawnSurfaceId === null || ctx.surfaceIds.has(merged.model.spawnSurfaceId) === false) {
		const firstSurfaceId = ctx.surfaceIds.size > 0 ? [...ctx.surfaceIds][0] : null;
		if (firstSurfaceId !== null) {
			warnLog(`level.entities: invalid spawnSurfaceId for '${merged.id}', using '${firstSurfaceId}'.`);
			merged.model.spawnSurfaceId = firstSurfaceId;
		}
	}
}

// Merge a spawn entry onto a template-ref blueprint, keeping the result a template reference.
function mergeTemplateRefEntity(ref, rawOverride, ctx) {
	const entrySource  = normalize.object(rawOverride).value;
	const override     = normalizeOverride(entrySource);
	const { position, rotation, scale, pivot }                    = ref.model.rootTransform;
	const { template, type } = ref, { id, blueprintId, dialogue } = override;

	// Merge the ref's and the entry's raw meta into one override, the entry's winning.
	const meta = normalizeMetaOverride({ ...ref.meta, ...normalize.object(entrySource.meta).value }, templateEntityTypes[type]);

	const merged = {
		shape            : "template", template, type, id, blueprintId, dialogue,
		meta             : instanceMeta(meta, templateEntityTypes[type]),
		collisionOverride: entrySource.collisionOverride !== undefined
			? resolveCollisionOverride(entrySource.collisionOverride, templateEntityTypes[type])
			: ref.collisionOverride !== null ? { ...ref.collisionOverride } : null,
		model: {
			spawnSurfaceId: override.spawnSurfaceId ?? ref.model.spawnSurfaceId,
			rootTransform : entrySource.rootTransform !== undefined ? override.rootTransform : {
				position: position !== null ? position.clone()    : null,
				rotation: rotation !== null ? rotation.clone()    : null,
				scale   : scale    !== null ? CloneVector3(scale) : null,
				pivot   : pivot    !== null ? pivot.clone()       : null,
			},
			parts: ref.model.parts,
		},
	};

	resolveMergedSpawnSurface(merged, ctx);
	return merged;
}

function mergeBlueprintWithOverride(blueprint, rawOverride, ctx, globalShared) {
	if (blueprint.shape === "template") return mergeTemplateRefEntity(blueprint, rawOverride, ctx);

	const entrySource = normalize.object(rawOverride).value;
	const override    = normalizeOverride(entrySource);
	const merged      = structuredClone(blueprint);

	// Note: structuredClone turned Unit/UnitVector3 into plain objects. Rebuild them before use.
	merged.model.rootTransform = {
		position: toUnitVector3(merged.model.rootTransform.position, "cnu"),
		rotation: toUnitVector3(merged.model.rootTransform.rotation, "radians"),
		scale   : merged.model.rootTransform.scale,
		pivot   : toUnitVector3(merged.model.rootTransform.pivot,    "cnu"),
	};
	merged.model.parts = merged.model.parts.map((part) => {
		part.dimensions    = toUnitVector3(part.dimensions,    "cnu");
		part.localPosition = toUnitVector3(part.localPosition, "cnu");
		part.localRotation = toUnitVector3(part.localRotation, "radians");
		part.localScale    = CloneVector3(part.localScale);
		part.pivot         = toUnitVector3(part.pivot,         "cnu");
		
		if (part.shape === "tube") {
			part.primitiveOptions.thickness = new Unit(part.primitiveOptions.thickness.value, "cnu");
			part.primitiveOptions.nodes.forEach(node => {
				node.dimensions    = toUnitVector3(node.dimensions,    "cnu");
				node.localPosition = toUnitVector3(node.localPosition, "cnu");
				node.localRotation = toUnitVector3(node.localRotation, "radians");
				node.thickness     = new Unit(node.thickness.value,    "cnu");
			});
		}
		if (part.shape === "plane" && part.primitiveOptions.sprite !== null) {
			const sprite = part.primitiveOptions.sprite;
			if (sprite.range !== null)         sprite.range         = new Unit(sprite.range.value, "cnu");
			if (sprite.occludedRange !== null) sprite.occludedRange = new Unit(sprite.occludedRange.value, "cnu");
		}
		if (part.particle !== null) instanceParticle(part.particle);
		return part;
	});
	const mv = merged.movement;
	merged.movement = {
		...mv,
		start: toUnitVector3(mv.start, "cnu"),
		end  : toUnitVector3(mv.end,   "cnu"),
		speed: new Unit(mv.speed.value, "cnu"),
	};
	merged.velocity = toUnitVector3(merged.velocity, "cnu");

	merged.id = override.id;
	merged.blueprintId = override.blueprintId;
	if (entrySource.type !== undefined) merged.type = override.type;

	// Fill meta for the final type, with the entry's fields winning.
	merged.meta = instanceMeta(normalizeMeta({ ...merged.meta, ...normalize.object(entrySource.meta).value }, merged.type), merged.type);
	if (entrySource.attacks !== undefined) merged.attacks = override.attacks;
	if (entrySource.animations !== undefined && override.animations !== null) {
		merged.animations = resolveAnimations(override.animations, buildAnimationContext(merged.model.parts), globalShared);
	}

	// Instance the entity's own copy of its animations.
	instanceAnimationTracks(merged.animations);
	markMutableDecals(merged.animations, merged.model.parts);

	if (entrySource.collisionOverride !== undefined) merged.collisionOverride = resolveCollisionOverride(entrySource.collisionOverride, merged.type);
	if (entrySource.movement !== undefined) merged.movement = override.movement;
	if (entrySource.velocity !== undefined) merged.velocity = override.velocity;
	if (entrySource.spawnSurfaceId !== undefined && override.spawnSurfaceId !== null) merged.model.spawnSurfaceId = override.spawnSurfaceId;
	if (entrySource.rootTransform !== undefined) merged.model.rootTransform = override.rootTransform;
	merged.dialogue = override.dialogue;
	merged.collisionOverride = resolveCollisionOverride(merged.collisionOverride, merged.type);

	resolveMergedSpawnSurface(merged, ctx);
	return merged;
}

function mergeSimulatorEntity(blueprint, ctx) {
	ctx.surfaceIds.add("sim-disc");
	return mergeBlueprintWithOverride(
		blueprint,
		{ id: blueprint.id, type: blueprint.type, blueprintId: blueprint.id, spawnSurfaceId: "sim-disc" },
		ctx,
		{}
	);
}

// Share a blueprint's loaded bitmaps with a merged entity, marking its parts to drop failed images.
function shareBlueprintBitmaps(entity, blueprint, ctx) {
	entity.model.parts.forEach((part, partIndex) => {
		const blueprintPart = blueprint.model.parts[partIndex];
		part.texture.custom.forEach((entry, entryIndex) => {
			const blueprintEntry = blueprintPart.texture.custom[entryIndex];
			if (entry.decalType === "image") entry.bitmap = blueprintEntry.bitmap;
			if (entry.sources === null) return;
			for (const key in entry.sources) {
				if (entry.sources[key].decalType === "image") entry.sources[key].bitmap = blueprintEntry.sources[key].bitmap;
			}
			ctx.affectedDecalSources.add(entry);
		});
		if (part.shape === "plane" && part.primitiveOptions.sprite !== null && part.primitiveOptions.sprite.image !== null) {
			part.primitiveOptions.sprite.image.bitmap = blueprintPart.primitiveOptions.sprite.image.bitmap;
		}
		ctx.affectedParts.add(part);
	});
}

// Drop images whose load failed. A sprite without its image falls back to its base texture.
function applyImageLoadResults(affectedParts, affectedDecalSources) {
	affectedParts.forEach(part => {
		part.texture.custom = part.texture.custom.filter((e) => e.decalType !== "image" || e.bitmap !== null);
		if (part.shape !== "plane" || part.primitiveOptions.sprite === null) return;

		const sprite = part.primitiveOptions.sprite;
		if (sprite.image !== null && sprite.image.bitmap === null) sprite.image = null;

		// Drop the base texture a loaded image replaces, on a copy to spare shared templates.
		if (sprite.image !== null) part.texture = { ...part.texture, base: null };
	});
	affectedDecalSources.forEach(decalEntry => {
		for (const key in decalEntry.sources) {
			if (decalEntry.sources[key].decalType === "image" && decalEntry.sources[key].bitmap === null) delete decalEntry.sources[key];
		}
		if (Object.keys(decalEntry.sources).length === 0) decalEntry.sources = null;
	});
}

const defaultSkyStop = { r: 0.04, g: 0.05, b: 0.08, a: 1 };

function normalizeSkyStop(rawStop, path) {
	const source = normalize.object(rawStop).value;
	const stop = {};
	for (const channel in defaultSkyStop) {
		const resolved = normalize.number(source[channel], defaultSkyStop[channel]);
		if (!resolved.bool) warnLog(`${path}.${channel}: invalid number, using fallback ${defaultSkyStop[channel]}.`);
		stop[channel] = Clamp(resolved.value, 0, 1);
	}
	return stop;
}

// Resolve the skybox color stops, keeping between 2 and SKY_STOP_LIMIT.
function resolveSkyStops(rawSkybox, mode) {
	const source = normalize.object(rawSkybox).value;
	const path = "level.world.skybox.color";

	if (mode === "fill") {
		const stop = normalizeSkyStop(source.color, path);
		return [stop, { ...stop }];
	}

	const stops = normalize.array(source.color).value.map((entry, index) => normalizeSkyStop(entry, `${path}[${index}]`));

	if (stops.length > SKY_STOP_LIMIT) {
		warnLog(`${path}: ${stops.length} stops exceeds ${SKY_STOP_LIMIT}, truncating.`);
		stops.length = SKY_STOP_LIMIT;
	}
	if (stops.length === 0) {
		warnLog(`${path}: no gradient stops, using fallback ${JSON.stringify(defaultSkyStop)}.`);
		return [{ ...defaultSkyStop }, { ...defaultSkyStop }];
	}
	if (stops.length === 1) {
		warnLog(`${path}: single gradient stop, duplicating.`);
		stops.push({ ...stops[0] });
	}

	return stops;
}

// Drop situation, mode and addon keys Sets.json doesn't define. Every mode gets an addon array.
function normalizeCameraMaps(camera) {
	const path = "level.camera";

	const situations = {};
	for (const situation in camera.situations) {
		const mode = camera.situations[situation];
		if (!cameraSets.situations.includes(situation) || !cameraSets.modes.includes(mode)) {
			warnLog(`${path}.situations: '${situation}: ${mode}' invalid, dropping.`);
			continue;
		}
		situations[situation] = mode;
	}
	camera.situations = situations;

	const modeAddons = Object.fromEntries(cameraSets.modes.map((mode) => [mode, []]));
	for (const mode in camera.modeAddons) {
		const addons = normalize.array(camera.modeAddons[mode]);
		if (!cameraSets.modes.includes(mode) || !addons.bool) {
			warnLog(`${path}.modeAddons: '${mode}' is not a mode with an addon array, dropping.`);
			continue;
		}
		modeAddons[mode] = addons.value.filter((addon) => {
			if (cameraSets.addons[mode].includes(addon)) return true;
			warnLog(`${path}.modeAddons.${mode}: '${addon}' not available, removed.`);
			return false;
		});
	}
	camera.modeAddons = modeAddons;
}

// Fall back on a whole { min, default, max } range when it's out of order, and instance it as cnu.
function normalizeCnuRange(range, path, fallback) {
	const ordered = range.min <= range.default && range.default <= range.max;
	if (!ordered) warnLog(`${path}: expected min <= default <= max, using fallback ${JSON.stringify(fallback)}.`);
	const source = ordered ? range : fallback;
	return { min: new Unit(source.min, "cnu"), default: new Unit(source.default, "cnu"), max: new Unit(source.max, "cnu") };
}

/* Game Template Normalization (output matches builder/templates/Instance.js, so game and engine templates look the same downstream) */

// Instance the transforms offset between a part's repeats. A part without one gets null.
function normalizePartRepeat(rawRepeat) {
	const repeatSource = normalize.object(rawRepeat);
	if (!repeatSource.bool) return null;

	const repeat = normalizePayloadSchema(repeatSource.value, "partRepeat");
	repeat.offset.position = toUnitVector3(repeat.offset.position, "cnu");
	repeat.offset.rotation = toUnitVector3(repeat.offset.rotation, "degrees").toRadians(true);
	return repeat;
}

// Normalize object and entity template parts, which may repeat.
function normalizeRepeatingParts(rawParts, ctx) {
	return normalize.array(rawParts).value.map((rawPart) => {
		const part = normalizePart(rawPart, ctx);
		part.repeat = normalizePartRepeat(rawPart.repeat);
		return part;
	});
}

// Normalize a scatter part. Batched scatter can't draw sprites, but its planes may cross.
function normalizeScatterPart(rawPart, label, ctx) {
	const part = normalizePayloadSchema(rawPart, "scatterTemplatePart");
	part.dimensions    = toUnitVector3(part.dimensions, "cnu");
	part.localPosition = toUnitVector3(part.localPosition, "cnu");
	part.localRotation = toUnitVector3(part.localRotation, "degrees").toRadians(true);
	part.texture       = normalizeTexture(part.texture, part, ctx);

	switch (part.shape) {
		case "tube": part.primitiveOptions = normalizeTubeOptions(part.primitiveOptions); break;
		case "ramp-complex": part.primitiveOptions = normalizeRampOptions(part.primitiveOptions, label); break;
		case "capsule"     : part.primitiveOptions = normalizePayloadSchema(part.primitiveOptions, "capsuleOptions", "complexityOptions"); break;
		case "torus"       : part.primitiveOptions = normalizePayloadSchema(part.primitiveOptions, "torusOptions", "complexityOptions"); break;
		case "cylinder"    :
		case "sphere"      :
		case "cone"        : part.primitiveOptions = normalizePayloadSchema(part.primitiveOptions, "complexityOptions"); break;
		case "plane"       :
			const { sprite, crossed } = normalizePayloadSchema(part.primitiveOptions, "planeOptions");
			if (sprite !== null) warnLog(`${label}: scatter planes can't be sprites, dropping the sprite.`);

			// Flatten the plane to keep decals on its surface.
			part.dimensions.z     = 0;
			part.primitiveOptions = { crossed, sprite: null };
			break;
	}
	
	return part;
}

function normalizeScatterTemplate(rawTemplate, id, ctx) {
	const scatter = normalizePayloadSchema(rawTemplate, "scatterTemplate");
	scatter.id    = id;
	scatter.parts = normalize.array(rawTemplate.parts).value.map((rawPart, index) => (
		normalizeScatterPart(rawPart, `level.templates.scatter.${id}.parts[${index}]`, ctx)
	));
	return scatter;
}

// Instance each particle template's initial velocity and the part it emits.
function normalizeParticleTemplate(rawTemplate, ctx) {
	const template    = normalizePayloadSchema(rawTemplate, "particleTemplate");
	template.velocity = toUnitVector3(template.velocity, "cnu"); // Per second
	template.part     = normalizePart(rawTemplate.part, ctx);
	return template;
}

function normalizeObjectTemplate(rawTemplate, id, ctx, collection) {
	const template = normalizePayloadSchema(rawTemplate, "objectTemplate");
	const shared = template.shared = normalizePayloadSchema(rawTemplate.shared, "objectTemplateShared", collection === "obstacles" ? "obstacleFields" : null);
	shared.dimensions = toUnitVector3(shared.dimensions, "cnu");
	shared.pivot      = toUnitVector3(shared.pivot,      "cnu");
	shared.texture    = normalizeTexture(shared.texture, shared, ctx);
	shared.detail     = normalizeDetail(rawTemplate.shared.detail !== undefined ? rawTemplate.shared.detail : shared.detail, ctx);

	template.parts = normalizeRepeatingParts(rawTemplate.parts, ctx);
	if (shared.mode === "void") dropVoidGenerators(template.parts, `templates.${collection}.${id}`);

	// Give a part without its own texture the shared one, tinted by the part's color if it has one.
	template.parts.forEach((part, index) => {
		const rawPart = rawTemplate.parts[index];
		if (rawPart.texture !== undefined && rawPart.texture !== null) return;
		if (rawPart.color === undefined || rawPart.color === null) return part.texture = shared.texture;
		part.texture = { base: { ...shared.texture.base, primary: part.texture.base.primary }, custom: shared.texture.custom };
	});
	return template;
}

function normalizeEntityTemplate(rawTemplate, ctx) {
	const template               = normalizePayloadSchema(rawTemplate, "entityTemplate");
	template.movement            = normalizeMovement(rawTemplate.movement);
	template.velocity            = toUnitVector3(template.velocity, "cnu"); // Per second
	template.attacks             = normalizeAttacks(rawTemplate.attacks);
	template.meta                = instanceMeta(normalizeMeta(rawTemplate.meta, template.type), template.type);
	template.collisionOverride   = resolveCollisionOverride(rawTemplate.collisionOverride, template.type);
	template.model.rootTransform = normalizeRootTransform(template.model.rootTransform, true);
	template.model.parts         = normalizeRepeatingParts(rawTemplate.model.parts, ctx);
	return template;
}

function normalizePlayerCharacterTemplate(rawTemplate, ctx) {
	const character = normalizePayloadSchema(rawTemplate, "playerCharacterTemplate");
	const meta = character.meta;
	meta.jumpHeight       = new Unit(meta.jumpHeight, "cnu");
	meta.maxSpeed         = new Unit(meta.maxSpeed, "cnu");                             // Per second
	meta.acceleration     = new Unit(meta.acceleration, "cnu");                         // Per second (squared)
	meta.deceleration     = new Unit(meta.deceleration, "cnu");                         // Per second (squared)
	meta.momentumTurnRate = new Unit(meta.momentumTurnRate, "degrees").toRadians(true); // Per second
	character.model.parts = normalize.array(rawTemplate.model.parts).value.map((part) => normalizePart(part, ctx));
	return character;
}

// Normalize a level's game templates. Each collection may use the ones before it.
function normalizeGameTemplates(rawTemplates, ctx) {
	const source = normalize.object(rawTemplates).value;
	const collection = (name) => normalize.object(source[name]).value;
	const templates = ctx.templates;

	const textures = collection("textures");
	for (const id in textures) {
		templates.textures[id] = { ...normalizePayloadSchema(textures[id], "textureTemplate"), id };
	}

	const scatter = collection("scatter");
	for (const id in scatter) templates.scatter[id] = normalizeScatterTemplate(scatter[id], id, ctx);

	const particles = collection("particles");
	for (const id in particles) templates.particles[id] = normalizeParticleTemplate(particles[id], ctx);

	for (const name of ["terrain", "obstacles"]) {
		const objects = collection(name);
		for (const id in objects) templates[name][id] = normalizeObjectTemplate(objects[id], id, ctx, name);
	}

	for (const name of ["npcs", "projectiles"]) {
		const entities = collection(name);
		for (const id in entities) templates[name][id] = normalizeEntityTemplate(entities[id], ctx);
	}

	const playerCharacters = collection("playerCharacters");
	for (const id in playerCharacters) templates.playerCharacters[id] = normalizePlayerCharacterTemplate(playerCharacters[id], ctx);
}

async function LevelPayload(payload) {
	const ctx = {
		pendingImageLoads   : [],
		affectedParts       : new Set(),
		affectedDecalSources: new Set(),
		surfaceIds          : new Set(),
		templates           : emptyGameTemplates(),
	};

	const rawPayload = normalize.object(payload).value;

	// Note: Templates go first. The rest of the payload may reference them.
	normalizeGameTemplates(rawPayload.templates, ctx);

	const blueprintBuckets = ["enemies", "npcs", "collectibles", "projectiles", "entities"];

	const normalized = normalizePayloadSchema(rawPayload, "level");
	normalized.templates = ctx.templates;

	// Global shared animation definitions, kept raw until each target bakes them in.
	const globalShared = normalized.animations.shared;

	normalized.world.dimensions    = toUnitVector3(normalized.world.dimensions, "cnu");
	normalized.world.deathBarrierY = new Unit(normalized.world.deathBarrierY, "cnu");
	if (normalized.world.water.topY !== null) {
		const clampedTopY = Clamp(normalized.world.water.topY, normalized.world.deathBarrierY.value, normalized.world.dimensions.y);
		if (clampedTopY !== normalized.world.water.topY) {
			warnLog(`level.world.water.topY: clamped ${normalized.world.water.topY} to ${clampedTopY}.`);
		}
		normalized.world.water.topY = new Unit(clampedTopY, "cnu");
	}
	normalized.world.skybox.stops = resolveSkyStops(normalize.object(rawPayload.world).value.skybox, normalized.world.skybox.mode);

	const cameraSchema = canonSchemas.level.camera;
	const freeCam = normalized.camera.freeCam;
	normalized.camera.distance = normalizeCnuRange(normalized.camera.distance, "level.camera.distance", cameraSchema.distance.__meta.fallback);
	normalized.camera.pitchLimit.top = new Unit(normalized.camera.pitchLimit.top, "degrees");
	normalized.camera.pitchLimit.bottom = new Unit(normalized.camera.pitchLimit.bottom, "degrees");
	freeCam.speed = normalizeCnuRange(freeCam.speed, "level.camera.freeCam.speed", cameraSchema.freeCam.speed.__meta.fallback);
	freeCam.acceleration = new Unit(freeCam.acceleration, "cnu");
	freeCam.speedStep = new Unit(freeCam.speedStep, "cnu");
	normalized.camera.heightOffset = new Unit(normalized.camera.heightOffset, "cnu");
	normalized.camera.levelOpening.startPosition = toUnitVector3(normalized.camera.levelOpening.startPosition, "cnu");
	normalizeCameraMaps(normalized.camera);

	normalized.terrain.objects = normalize.array(rawPayload.terrain?.objects).value.map((entry) =>
		IsTemplateRef(entry)
			? normalizeObjectTemplateRef(entry, ctx, "terrain", "level.terrain.objects")
			: normalizeLevelObject(entry, ctx, "terrain")
	).filter((entry) => entry !== null);
	normalized.obstacles = normalize.array(rawPayload.obstacles).value.map((entry) =>
		IsTemplateRef(entry)
			? normalizeObjectTemplateRef(entry, ctx, "obstacle", "level.obstacles")
			: normalizeLevelObject(entry, ctx, "obstacle")
	).filter((entry) => entry !== null);
	normalized.terrain.triggers = normalize.array(rawPayload.terrain?.triggers).value.map((entry) => {
		const trigger = normalizePayloadSchema(normalize.object(entry).value, "levelTrigger");
		trigger.start = toUnitVector3(trigger.start, "cnu");
		trigger.end = toUnitVector3(trigger.end, "cnu");
		return trigger;
	});

	blueprintBuckets.forEach(bucket => {
		normalized.entityBlueprints[bucket] = normalize.array(
			normalize.object(rawPayload.entityBlueprints).value[bucket]
		).value.map((entry) =>
			IsTemplateRef(entry)
				? normalizeEntityTemplateRef(entry, ctx, `level.entityBlueprints.${bucket}`)
				: normalizeBlueprint(entry, ctx, globalShared)
		).filter((entry) => entry !== null);
	});

	const blueprintMap = {};
	blueprintBuckets.forEach(bucketName => normalized.entityBlueprints[bucketName].forEach(entry => blueprintMap[entry.id] = entry));

	normalized.entities = normalize.array(rawPayload.entities).value.map((entry) => {
		const entrySource = normalize.object(entry).value;
		const override = normalizeOverride(entrySource);
		const blueprint = override.blueprintId !== null ? blueprintMap[override.blueprintId] : null;

		if (!blueprint) {
			warnLog(`level.entities: missing blueprint '${override.blueprintId}' for '${override.id}', dropping entry.`);
			return null;
		}

		return mergeBlueprintWithOverride(blueprint, entrySource, ctx, globalShared);
	}).filter((entry) => entry !== null);

	const characterIds = Object.keys(characterData);
	const playerSource = normalize.object(rawPayload.player);
	if (playerSource.bool) {
		normalized.player = normalizePayloadSchema(playerSource.value, "levelPlayer");
		normalized.player.rootTransform = normalizeRootTransform(normalized.player.rootTransform, true);
		if (normalized.player.spawnSurfaceId !== null && ctx.surfaceIds.has(normalized.player.spawnSurfaceId) === false) {
			warnLog(`level.player.spawnSurfaceId: '${normalized.player.spawnSurfaceId}' missing, using absolute coordinates.`);
			normalized.player.spawnSurfaceId = null;
		}
		normalized.player.modelParts = normalize.array(playerSource.value.modelParts).value.map((part) => normalizePart(part, ctx));
		normalized.player.metaOverrides = structuredClone(normalized.player.metaOverrides);
		if (!Array.isArray(normalized.player.metaOverrides.list)) normalized.player.metaOverrides.list = [];

		// Instance spatial meta overrides the same way as the character's own meta.
		const metaOverrides = normalized.player.metaOverrides;
		for (const key of ["jumpHeight", "maxSpeed", "acceleration", "deceleration"]) {
			if (key in metaOverrides) metaOverrides[key] = new Unit(metaOverrides[key], "cnu");
		}
		if ("momentumTurnRate" in metaOverrides) metaOverrides.momentumTurnRate = new Unit(metaOverrides.momentumTurnRate, "degrees").toRadians(true);
		if (findTemplate(ctx, "playerCharacter", normalized.player.character) === undefined) {
			warnLog(`level.player.character: '${normalized.player.character}' missing, using '${characterIds[0]}'.`);
			normalized.player.character = characterIds[0];
		}

		// Resolve the player's animations against its model parts.
		const characterParts = findTemplate(ctx, "playerCharacter", normalized.player.character).model.parts;
		const playerParts = normalized.player.modelParts.length > 0 ? normalized.player.modelParts : characterParts;
		normalized.player.animations = resolveAnimations(playerSource.value.animations, buildAnimationContext(playerParts), globalShared);
		instanceAnimationTracks(normalized.player.animations);
		markMutableDecals(normalized.player.animations, playerParts);
	}
	else normalized.player = null;

	const musicSource = normalize.object(rawPayload.music);
	normalized.music = musicSource.bool ? AudioPayload(musicSource.value) : null;

	await Promise.all(ctx.pendingImageLoads.map(({ entry, promise }) =>
		promise.then((result) => { entry.bitmap = result.bool ? result.value : null; })
	));
	normalized.entities.forEach(entity => {
		if (entity.shape !== "template") shareBlueprintBitmaps(entity, blueprintMap[entity.blueprintId], ctx);
	});
	applyImageLoadResults(ctx.affectedParts, ctx.affectedDecalSources);

	return normalized;
}

async function SimulatorPayload({ payloadType, ...payload }) {
	if (payloadType === "cached") {
		const normalized       = normalizePayloadSchema(normalize.object(payload).value, "simulatorCached");
		normalized.payloadType = "cached";
		return normalized;
	}

	const normalized       = normalizePayloadSchema(normalize.object(payload).value, "simulatorDefinition");
	normalized.payloadType = "definition";

	const ctx = {
		pendingImageLoads   : [],
		affectedParts       : new Set(),
		affectedDecalSources: new Set(),
		surfaceIds          : new Set(),
		templates           : noGameTemplates,
	};

	let pendingEntityBlueprint = null;
	if (ENTITY_TYPES.includes(normalized.objectType)) {
		if (IsTemplateRef(payload.definition)) {
			pendingEntityBlueprint = normalizeEntityTemplateRef(payload.definition, ctx, "simulator.definition");
			if (pendingEntityBlueprint === null) normalized.definition = null;
		}
		else pendingEntityBlueprint = normalizeBlueprint(payload.definition, ctx, {});
	}
	else if (IsTemplateRef(payload.definition)) {
		const collection = normalized.objectType === "terrain" ? "terrain" : "obstacle";
		normalized.definition = normalizeObjectTemplateRef(payload.definition, ctx, collection, "simulator.definition");
	}
	else normalized.definition = normalizeLevelObject(payload.definition, ctx, normalized.objectType);

	await Promise.all(ctx.pendingImageLoads.map(({ entry, promise }) => promise.then((result) => {
		entry.bitmap = result.bool ? result.value : null;
	})));
	applyImageLoadResults(ctx.affectedParts, ctx.affectedDecalSources);

	if (pendingEntityBlueprint !== null) normalized.definition = mergeSimulatorEntity(pendingEntityBlueprint, ctx);

	return normalized;
}

/* Runtime Request Normalization (small fire-and-forget requests from the running game) */

const Runtime = {
	Particles: (rawRequest, generator) => {
		const request = Runtime.helpers.cloneRequest(rawRequest, "particleRequest");
		if (normalizeParticle(request, "particleRequest", { templates: noGameTemplates }) === null) return null;

		return {
			templateId  : request.id,
			position    : request.position,
			side        : request.side,
			offset      : null,
			area        : generator === true ? request.area : null,
			rotation    : null,
			overrides   : request.overrides,
			mode        : generator === true ? "generator" : "burst",
			target      : generator === true ? request.target : null,
			customEvents: request.customEvents,
		};
	},

	helpers: {
		cloneRequest: (raw, rootKey) => structuredClone(normalizePayloadSchema(raw, rootKey)),
	},
};

export default {
	AudioPayload,
	MenuPayload,
	SplashPayload,
	CutscenePayload,
	LevelPayload,
	SimulatorPayload,
	Runtime,
};
