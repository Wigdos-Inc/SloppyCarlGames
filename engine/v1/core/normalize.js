// Normalization of Game Payloads for Engine use
// Exclusively called by validate.js

import { ToVector3 } from "../math/Vector3.js";
import { Clamp, Clamp01, ToNumber, Unit, UnitVector3 } from "../math/Utilities.js";
import { Log } from "./meta.js";
import visualTemplates from "../builder/templates/textures.json" with { type: "json" };
import characterData from "../player/characters.json" with { type: "json" };
import aliasMap from "./aliases.json" with { type: "json" };

const validPlayerCharacterIds = new Set(Object.keys(characterData));

/* === Helpers === */

function warnLog(string) {
	Log("ENGINE", string, "warn", "Validation");
}

function normalizeString(value, fallback = "") {
	return (value && typeof value === "string" && value.length > 0) ? value : fallback;
}
function normalizeArray(value) { 
	return Array.isArray(value) ? value : []; 
}
function normalizeObject(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function hasOwn(source, key) {
	return Object.prototype.hasOwnProperty.call(source, key);
}

function normalizeVector3(value, fallback = ToVector3(0), warningMessage = "") {
	const normalized = ToVector3(fallback);
	let usedFallback = false;

	if (Array.isArray(value)) {
		const x = ToNumber(value[0], NaN);
		const y = ToNumber(value[1], NaN);
		const z = ToNumber(value[2], NaN);
		if (Number.isFinite(x)) normalized.x = x;
		else usedFallback = true;
		if (Number.isFinite(y)) normalized.y = y;
		else usedFallback = true;
		if (Number.isFinite(z)) normalized.z = z;
		else usedFallback = true;
	}
	else if (value && typeof value === "object") {
		const x = ToNumber(value.x, NaN);
		const y = ToNumber(value.y, NaN);
		const z = ToNumber(value.z, NaN);
		if (Number.isFinite(x)) normalized.x = x;
		else usedFallback = true;
		if (Number.isFinite(y)) normalized.y = y;
		else usedFallback = true;
		if (Number.isFinite(z)) normalized.z = z;
		else usedFallback = true;
	}
	else usedFallback = true;

	if (usedFallback && warningMessage.length > 0) warnLog(warningMessage);
	return { value: normalized, usedFallback };
}

function toUnitVector3(v, t) {
	return new UnitVector3(v.x, v.y, v.z, t);
}

function generateDeterministicId(prefix, path) {
	const raw = String(path || "");
	const normalized = raw.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
	return normalized.length > 0 ? `${prefix}-${normalized}` : `${prefix}`;
}

function normalizeElement(element, path) {
	const source = normalizeObject(element);
	if (Object.keys(source).length === 0) {
		warnLog(`Dropped malformed element at '${path}'.`);
		return null;
	}

	const children = [];
	const sourceChildren = normalizeArray(source.children);
	for (let i = 0; i < sourceChildren.length; i++) {
		const normalized = normalizeElement(sourceChildren[i], `${path}.children[${i}]`);
		if (normalized) children.push(normalized);
	}

	// Canonicalize direct shorthand event props (e.g. onClick) into the normalized events map
	const directEventKeyMap = {
		onclick: "click",
		oninput: "input",
		onchange: "change",
		onpointerover: "pointerover",
		onpointerout: "pointerout",
		onpointerdown: "pointerdown",
		onpointerup: "pointerup",
		onkeydown: "keydown",
		onkeyup: "keyup",
		onwheel: "wheel",
		onmousemove: "mousemove",
	};
	const eventMap = normalizeActionMap(source.events, `${path}.events`);
	
	const sourceKeys = Object.keys(source);
	for (let i = 0; i < sourceKeys.length; i++) {
		const directKey = sourceKeys[i];
		const eventName = directEventKeyMap[String(directKey).toLowerCase().replace(/[-_]/g, "")];
		if (!eventName) continue;
		const normalizedAction = normalizeAction(source[directKey], `${path}.${directKey}`);
		if (normalizedAction !== null && !eventMap[eventName]) eventMap[eventName] = normalizedAction;
	}

	const idValue = normalizeString(source.id, "");
	const fallbackId = generateDeterministicId("element", path);

	return {
		...source,
		type: normalizeString(source.type, "div"),
		id: idValue.length > 0 ? idValue : fallbackId,
		className: normalizeString(source.className, ""),
		text: typeof source.text === "string" ? source.text : source.text !== undefined 
			? String(source.text) : undefined,
		attributes: normalizeObject(source.attributes),
		styles: normalizeObject(source.styles),
		events: eventMap,
		on: normalizeActionMap(source.on, `${path}.on`),
		children,
	};
}

function normalizeActionMap(actions, path) {
	const source = normalizeObject(actions);
	if (Object.keys(source).length === 0) return {};

	const normalized = {};
	for (const key of source) {
		if (!normalizeString(key, "")) continue;
		const value = normalizeAction(source[key], `${path}.${key}`);
		if (value !== null) normalized[key] = value;
	}

	return normalized;
}

function normalizeAction(action, path) {
	if (typeof action === "string") {
		const trimmed = action.trim();
		if (trimmed.length === 0) {
			warnLog(`Dropped empty string action at '${path}'.`);
			return null;
		}
		return trimmed;
	}

	if (Array.isArray(action)) {
		const list = [];
		for (let i = 0; i < action.length; i++) {
			const normalized = normalizeAction(action[i], `${path}[${i}]`);
			if (normalized !== null) list.push(normalized);
		}

		if (list.length === 0) {
			warnLog(`Dropped empty action list at '${path}'.`);
			return null;
		}

		return list;
	}

	if (!action || typeof action !== "object") {
		warnLog(`Dropped malformed action at '${path}'.`);
		return null;
	}

	const actionSource = normalizeObject(action);
	switch (normalizeString(actionSource.type, "")) {
		case "ui":
			const uiPayload = normalizeObject(actionSource.payload);
			if (Object.keys(uiPayload).length === 0) {
				warnLog(`Dropped invalid 'ui' action at '${path}': missing object payload.`);
				return null;
			}
			return { ...actionSource, type: "ui", payload: uiPayload };
		case "request":
			const screenId = normalizeString(actionSource.screenId, "");
			if (screenId.length === 0) {
				warnLog(`Dropped invalid 'request' action at '${path}': missing screenId.`);
				return null;
			}
			return { ...actionSource, type: "request", screenId };
		case "event": 
			const eventName = normalizeString(actionSource.name, "");
			if (eventName.length === 0) {
				warnLog(`Dropped invalid 'event' action at '${path}': missing event name.`);
				return null;
			}
			return { ...actionSource, type: "event", name: eventName };
		case "exit": return { ...actionSource, type: "exit" }
		case "style":
			const targetId = normalizeString(actionSource.targetId, "");
			if (targetId.length === 0) {
				warnLog(`Dropped invalid 'style' action at '${path}': missing targetId.`);
				return null;
			}
		

			const stylesSource = normalizeObject(actionSource.styles);
			const styles = Object.keys(stylesSource).length > 0 ? { ...stylesSource } : null;
			if (!styles) {
				warnLog(`Dropped invalid 'style' action at '${path}': missing styles object.`);
				return null;
			}

			styles.classList = normalizeStyleClassList(stylesSource.classList);
			return {
				...actionSource,
				type: "style",
				targetId,
				styles,
			};
		default:
			warnLog(`Dropped unsupported action type at '${path}'.`);
			return null;
	}
}

function normalizeStyleClassList(classListConfig) {
	const add = [];
	const remove = [];

	const classListArray = normalizeArray(classListConfig);
	if (classListArray.length > 0) {
		for (let index = 0; index < classListArray.length; index++) {
			const className = normalizeString(classListArray[index], "");
			if (className) add.push(className);
		}
		return { add, remove };
	}

	const source = normalizeObject(classListConfig);
	if (Object.keys(source).length > 0) {
		// Keep classList aliasing local because action styles intentionally pass through arbitrary CSS keys.
		for (const key in source) {
			const normalizedKey = normalizeAliasKey(key);
			if (normalizedKey === "add" || normalizedKey === "addclasses" || normalizedKey === "classestoadd") {
				const addClasses = normalizeArray(source[key]);
				for (let index = 0; index < addClasses.length; index++) {
					const className = normalizeString(addClasses[index], "");
					if (className) add.push(className);
				}
			}
			if (normalizedKey === "remove" || normalizedKey === "removeclasses" || normalizedKey === "classestoremove") {
				const removeClasses = normalizeArray(source[key]);
				for (let index = 0; index < removeClasses.length; index++) {
					const className = normalizeString(removeClasses[index], "");
					if (className) remove.push(className);
				}
			}
		}
	}

	return { add, remove };
}

function normalizeAudioSource(source) {
	let normalized = source.replace(/^(\.\.\/)+/, "");

	try {
		const url = new URL(normalized, import.meta.url);
		const markerIndex = url.pathname.toLowerCase().lastIndexOf("/audio/");
		if (markerIndex >= 0) normalized = url.pathname.slice(markerIndex + 1);
	} 
	catch (error) {}

	return normalized;
}

/* Alias Normalization */

function normalizeAliasKey(key) {
	return String(key).toLowerCase().replace(/[-_]/g, "");
}

function resolveAliases(source, schema) {
	const resolved = {};

	// Iterate through payload fields
	for (const sourceKey in source) {
		let matchedKey = null;
		let matchedSchema = null;

		// Iterate through alias fields
		for (const schemaKey in schema) {
			const schemaField = schema[schemaKey];

			// Store aliases from nested or shared array
			const aliases = Array.isArray(schemaField) ? schemaField : aliasMap.shared[schemaKey];

			// Check each accepted alias and normalize to contractual key
			for (const alias of aliases) {
				if (normalizeAliasKey(alias) !== normalizeAliasKey(sourceKey)) continue;
				matchedKey = schemaKey;
				matchedSchema = schemaField;
				break;
			}

			// End early on found match
			if (matchedKey !== null) break;
		}

		// Let the game know if no match was found
		if (matchedKey === null) {
			warnLog(`'${sourceKey}' was ignored because it didn't match a known alias.`);
			continue;
		}

		if (hasOwn(resolved, matchedKey)) continue;

		const value = source[sourceKey];
		const nestedSchema = Array.isArray(matchedSchema) ? null : Object.keys(matchedSchema).length === 0 
			? schema : matchedSchema;
		if (Array.isArray(value) && nestedSchema !== null) {
			const normalizedList = new Array(value.length);
			for (let index = 0; index < value.length; index++) {
				const entry = value[index];
				const entrySource = normalizeObject(entry);
				normalizedList[index] = entrySource === entry ? resolveAliases(entrySource, nestedSchema) : entry;
			}
			resolved[matchedKey] = normalizedList;
			continue;
		}

		const objectValue = normalizeObject(value);
		if (nestedSchema !== null && objectValue === value) {
			resolved[matchedKey] = resolveAliases(objectValue, nestedSchema);
			continue;
		}

		resolved[matchedKey] = value;
	}

	return resolved;
}

/* === UI Payload === */

function MenuUIPayload(payload) {
	const source = resolveAliases(payload, aliasMap.menu);

	const elements = [];
	for (let i = 0; i < source.elements.length; i++) {
		const normalized = normalizeElement(source.elements[i], `elements[${i}]`);
		if (normalized) elements.push(normalized);
	}

	return {
		...source,
		screenId: source.screenId,
		rootId: normalizeString(source.rootId, "engine-ui-root"),
		elements,
		music: normalizeMenuMusic(source.music),
	};
}

function normalizeMenuMusic(music) {
	const source = normalizeObject(music);
	if (Object.keys(source).length === 0) return null;

	const name = normalizeString(source.name, "");
	const src = normalizeString(source.src, "");
	if (name.length === 0 || src.length === 0) {
		warnLog("UI payload music config ignored: 'name' and 'src' are both required when music is provided.");
		return null;
	}

	return {
		...source,
		name,
		src: normalizeAudioSource(src),
	};
}

/* === Splash Payload === */

function SplashPayload(payload) {
	const source = resolveAliases(
		typeof payload === "string" ? { presetId: payload } 
			: Array.isArray(payload) ? { sequence: payload } : payload
	, aliasMap.splash);
	
	const rawPresetId = normalizeString(presetId, "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
	const presetId = rawPresetId === "default" || rawPresetId === "all" ? "default"
		: rawPresetId === "sloppycarlgames" || rawPresetId === "sloppycarl" ? "sloppycarl"
			: rawPresetId === "wigdosstudios" || rawPresetId === "wigdos" ? "wigdos"
				: rawPresetId === "carlnetengine" || rawPresetId === "carlnet" ? "carlnet" : "";

	const rawSequence = normalizeArray(source.sequence);
	const sequence = [];
	for (let index = 0; index < rawSequence.length; index++) {
		const step = normalizeSplashStep(rawSequence[index], `splash.sequence[${index}]`);
		if (step) sequence.push(step);
	}

	if (presetId.length === 0 && sequence.length === 0) {
		warnLog("Splash payload ignored: expected presetId/splashId or a non-empty sequence.");
		return null;
	}

	return {
		presetId: presetId.length > 0 ? presetId : null,
		sequence,
		outputType: presetId.length > 0 ? "preset" : "custom",
	};
}

function normalizeSplashStep(step, path) {
	const source = normalizeObject(step);
	if (Object.keys(source).length === 0) {
		warnLog(`Splash payload dropped malformed step at '${path}'.`);
		return null;
	}

	const name = normalizeString(source.name, "");
	const image = normalizeString(source.image, "");
	if (image.length === 0) {
		warnLog(`Splash payload dropped step at '${path}' because image is required.`);
		return null;
	}

	const rawElements = normalizeArray(source.elements);
	const elements = [];
	for (let index = 0; index < rawElements.length; index++) {
		const element = normalizeElement(rawElements[index], `${path}.elements[${index}]`);
		if (element) elements.push(element);
	}

	const rawText = normalizeArray(source.text);
	const text = [];
	for (let index = 0; index < rawText.length; index++) {
		const entry = normalizeSplashTextEntry(rawText[index], `${path}.text[${index}]`);
		if (entry) text.push(entry);
	}

	const indexMatch = path.match(/\[(\d+)\]/);
	const finalName = name.length > 0 ? name : `splash-${indexMatch[1]}`;

	return {
		name: finalName,
		image,
		sfx: normalizeSplashAudio(source.sfx),
		voice: normalizeSplashAudio(source.voice),
		voiceAtStart: source.voiceAtStart === true,
		fadeInSeconds: ToNumber(source.fadeInSeconds, 0.3),
		holdMs: Math.max(0, Math.floor(ToNumber(source.holdMs, 1000))),
		fadeOutSeconds: ToNumber(source.fadeOutSeconds, 1),
		elements,
		text,
	};
}

function normalizeSplashTextEntry(entry, path) {
	const source = normalizeObject(entry);
	if (Object.keys(source).length === 0) {
		warnLog(`Splash payload ignored malformed text entry at '${path}'.`);
		return null;
	}

	const content = normalizeString(source.content, "");
	if (content.length === 0) {
		warnLog(`Splash payload ignored text entry at '${path}' because content is required.`);
		return null;
	}

	const position = normalizeObject(source.position);
	const mergedStyles = { ...position, styles: normalizeObject(source.styles) };
	if (Object.keys(position).length > 0 && typeof mergedStyles.position !== "string") mergedStyles.position = "absolute";

	const idValue = normalizeString(source.id, "");
	const typeValue = normalizeString(source.type, "div");

	return {
		id: idValue.length > 0 ? idValue : generateDeterministicId("splash-text", path),
		className: normalizeString(source.className, ""),
		type: typeValue.length > 0 ? typeValue : "div",
		content,
		styles: mergedStyles,
		attributes: normalizeObject(source.attributes),
	};
}

function normalizeSplashAudio(audio) {
	const source = normalizeObject(audio);
	if (Object.keys(source).length === 0) return null;

	const src = normalizeString(source.src, "");
	if (src.length === 0) return null;

	return {
		src: normalizeAudioSource(src),
		options: normalizeObject(source.options),
	};
}

/* === Cutscene Payload === */

function CutscenePayload(payload, type) {
	const source = resolveAliases(payload, type === "rendered" ? aliasMap.cutsceneRendered : aliasMap.cutsceneEngine);
	if (Object.keys(source).length === 0) return null;

	if (type === "rendered") return normalizeRenderedCutscenePayload(source);
	if (type === "engine") return {
		type: "engine",
		data: source.data,
		durationSeconds: source.durationSeconds === undefined || source.durationSeconds === null ? 0 : source.durationSeconds,
		fallbackWaitMs: source.fallbackWaitMs === undefined || source.fallbackWaitMs === null ? 0 : Math.floor(source.fallbackWaitMs),
		fadeLeadSeconds: parseCutsceneNumberField(source, "fadeLeadSeconds",
			{ defaultValue: 0.5, min: 0, integer: false, label: "Cutscene payload engine.fadeLeadSeconds" }
		),
		fadeOutSeconds: parseCutsceneNumberField(source,  "fadeOutSeconds",
			{ defaultValue: 0.5, min: 0, integer: false, label: "Cutscene payload engine.fadeOutSeconds" }
		),
	};

	warnLog("Cutscene payload ignored: unsupported cutscene type.");
	return null;
}

function normalizeRenderedCutscenePayload(source) {
	const rawFit = hasOwn(source, "fit") ? source.fit : undefined;
	const fit = normalizeString(rawFit, "cover");
	if (rawFit === undefined || fit === "cover" && rawFit !== "cover") {
		warnLog("Cutscene payload rendered.fit missing or malformed; defaulted to 'cover'.");
	}

	const rawMuted = hasOwn(source, "muted") ? source.muted : undefined;
	const muted = rawMuted === true;
	if (rawMuted === undefined || typeof rawMuted !== "boolean") {
		warnLog("Cutscene payload rendered.muted missing or malformed; defaulted to false.");
	}

	const rawLoop = hasOwn(source, "loop") ? source.loop : undefined;
	const loop = rawLoop === true;
	if (rawLoop === undefined || typeof rawLoop !== "boolean") {
		warnLog("Cutscene payload rendered.loop missing or malformed; defaulted to false.");
	}

	return {
		type: "rendered",
		source: source.source,
		muted,
		loop,
		fit,
		fadeOutSeconds: parseCutsceneNumberField(source, "fadeOutSeconds", {
		  	defaultValue: 0.5, min: 0, integer: false, label: "Cutscene payload rendered.fadeOutSeconds"
		}),
		fadeLeadSeconds: parseCutsceneNumberField(source, "fadeLeadSeconds", {
		  	defaultValue: 0.5, min: 0, integer: false, label: "Cutscene payload rendered.fadeLeadSeconds"
		}),
	};
}

function parseCutsceneNumberField(source, key, { defaultValue = 0, min = -Infinity, integer = false, label } = {}) {
	const parsed = ToNumber(hasOwn(source, key) ? source[key] : undefined, NaN);
	if (!Number.isFinite(parsed) || parsed < min) {
	  	warnLog(`${label || `Cutscene payload ${key}`} missing or malformed; defaulted to ${defaultValue}.`);
	  	return defaultValue;
	}
	const value = integer ? Math.floor(parsed) : parsed;
	return min !== -Infinity ? Math.max(min, value) : value;
}

/* === Level Payload === */

function LevelPayload(payload) {
	const source = resolveAliases(payload, aliasMap.level);
	
	const normalizedBlueprints = (() => {
		const normalize = (list, prefix) => {
			const source = normalizeArray(list);
			const normalized = [];
			for (let index = 0; index < source.length; index++) {
				const entry = normalizeObject(source[index]);
				normalized.push(normalizeEntityData(entry, normalizeString(source.id, `${prefix}-${index}`)));
			}
			return normalized;
		}

		return {
			...source.entityBlueprints,
			enemies: normalize(source.entityBlueprints.enemies, "enemy-blueprint"),
			npcs: normalize(source.entityBlueprints.npcs, "npc-blueprint"),
			collectibles: normalize(source.entityBlueprints.collectibles, "collectible-blueprint"),
			projectiles: normalize(source.entityBlueprints.projectiles, "projectile-blueprint"),
			entities: normalize(source.entityBlueprints.entities, "entity-blueprint"),
		}
	})();

	return {
		...source,
		terrain: {
			...source.terrain,
			objects: source.terrain.objects.map((entry, index) => normalizeTerrainObject(entry, index)),
			triggers: source.terrain.triggers.map((entry, index) => normalizeTrigger(entry, index)),
		},
		obstacles: source.obstacles.map((entry, index) => normalizeObstacle(entry, index)),
		entities: source.entities.map((entry, index) => {
			const source = normalizeObject(entry);
			const blueprintId = normalizeString(source.blueprintId, "");
			return normalizeEntityData(
				source, 
				normalizeString(source.id, `entity-${index}`), 
				blueprintId ? normalizeObject(buildBlueprintMap(normalizedBlueprints)[blueprintId]) : null
			);
		}),
		entityBlueprints: normalizedBlueprints,
		meta: {
			...source.meta,
			levelId: normalizeString(source.meta.levelId, source.id),
			stageId: normalizeString(source.meta.stageId, source.id),
		},
		world: worldConfig(source.world),
		camera: (() => {
			const source = normalizeObject(source.camera);
			const levelOpening = normalizeObject(source.levelOpening);

			return {
				mode: "stationary",
				levelOpening: {
					startPosition: toUnitVector3(normalizeVector3(levelOpening.startPosition, { x: 0, y: 40, z: 80 }).value, "cnu"),
					endPosition: toUnitVector3(normalizeVector3(levelOpening.endPosition, { x: 0, y: 40, z: 80 }).value, "cnu"),
				},
				distance: new Unit(ToNumber(source.distance, 10), "cnu"),
				sensitivity: ToNumber(source.sensitivity, 0.12),
				heightOffset: new Unit(ToNumber(source.heightOffset, 3), "cnu"),
			};
		})(),
		player: playerConfig(source.player),
	};
}

function worldConfig(source) {
	const height = Math.max(1, ToNumber(source.height, 40));
	const deathBarrierY = ToNumber(source.deathBarrierY, -25);
	const waterLevel = (() => {
		if (!hasOwn(source, "waterLevel")) return null;

		const level = ToNumber(source.waterLevel, NaN);
		if (!Number.isFinite(level)) {
			warnLog("World waterLevel was malformed and has been normalized to null.");
			return null;
		}
		else if (level < deathBarrierY || level > height) {
			warnLog("World waterLevel was outside world bounds and has been normalized to null.");
			return null;
		}
		return level;
	})();

	return {
		length: new Unit(Math.max(1, ToNumber(source.length, 100)), "cnu"),
		width: new Unit(Math.max(1, ToNumber(source.width, 100)), "cnu"),
		height: new Unit(height, "cnu"),
		deathBarrierY: new Unit(deathBarrierY, "cnu"),
		waterLevel: waterLevel === null ? null : new Unit(waterLevel, "cnu"),
		textureScale: Math.max(0.05, ToNumber(source.textureScale, 1)),
		scatterScale: Math.max(0.05, ToNumber(source.scatterScale, 1)),
	};
}

function playerConfig(player) {
	const source = normalizeObject(player);
	const fallback = {
		character: "chara",
		spawnPosition: ToVector3(0),
		scale: ToVector3(1)
	}

	// Normalize optional meta overrides provided by payload.
	const rawMeta = normalizeObject(source.meta);
	const metaOverrides = {};
	const metaList = [];
	const metaKeys = Object.keys(rawMeta);
	for (const key of metaKeys) {
		const rawValue = rawMeta[key];
		const numericValue = ToNumber(rawValue, NaN);
		const normalizedVector = normalizeVector3(rawValue, ToVector3(0));
		let normalizedValue;
		if (!normalizedVector.usedFallback) {
			normalizedValue = normalizedVector.value;
			metaOverrides[key] = normalizedValue;
		} 
		else if (typeof rawValue === "boolean" || typeof rawValue === "string") {
			normalizedValue = rawValue;
			metaOverrides[key] = normalizedValue;
		} 
		else if (Number.isFinite(numericValue)) {
			normalizedValue = numericValue;
			metaOverrides[key] = normalizedValue;
		}

		let sval;
		try {
			sval = typeof normalizedValue === "object" ? JSON.stringify(normalizedValue) : String(normalizedValue);
		} catch (e) {
			sval = String(normalizedValue);
		}
		metaList.push(`${key}: ${sval}`);
	}
	metaOverrides.list = metaList;
	const characterSource = normalizeString(source.character, fallback.character).toLowerCase();
	const resolvedCharacter = validPlayerCharacterIds.has(characterSource)
		? characterSource
		: fallback.character;
	if (resolvedCharacter !== characterSource) {
		warnLog(`Player payload character malformed; defaulted to '${fallback.character}'.`);
	}

	return {
		character: resolvedCharacter,
		spawnPosition: toUnitVector3(normalizeVector3(source.spawnPosition, fallback.spawnPosition).value, "cnu"),
		scale: normalizeVector3(source.scale, ToVector3(1)).value,
		collectibles: ToNumber(source.collectibles, 0),
		modelParts: (() => {
			const directParts = normalizeArray(source.parts);
			const selectedParts = directParts.length > 0 
				? directParts 
				: normalizeArray(normalizeObject(source.model).parts);
			return selectedParts.map((part, index) => normalizeEntityModelPart(part, "player", index));
		})(),
		metaOverrides,
	}
}

function buildBlueprintMap(blueprintSet) {
	const map = {};
	const register = (list) => {
		for (let index = 0; index < list.length; index++) {
			const entry = normalizeString(list[index]);
			if (entry) map[entry.id] = entry;
		}
	};

	register(normalizeArray(blueprintSet.enemies));
	register(normalizeArray(blueprintSet.npcs));
	register(normalizeArray(blueprintSet.collectibles));
	register(normalizeArray(blueprintSet.projectiles));
	register(normalizeArray(blueprintSet.entities));

	return map;
}

// Entity Normalization
function normalizeEntityData(source, entityId, blueprint) {
	const blueprintSource = normalizeObject(blueprint);
	const entityType = (() => {
		const sourceValue = source.type;
		if (normalizeString(sourceValue, "")) return sourceValue;
		warnLog(`Entity payload ${entityId} 'type' malformed; using blueprint/default fallback.`);
		return normalizeString(blueprint[key], "entity");
	})();
	const movementSource = normalizeObject(source.movement);
	const blueprintMovement = normalizeObject(blueprintSource.movement);

	// Ensure top-level entity rootTransform (level overrides) are canonical UnitVector3 instances.
	// Builders assume `rootTransform.position`/`rotation` are UnitVector3 and call `.clone()`/.set()
	const rt = normalizeObject(source.rootTransform)
	if (rt) {
		source.rootTransform = {
			...rt,
			position: toUnitVector3(normalizeVector3(rt.position, ToVector3(0)).value, "cnu"),
			rotation: toUnitVector3(normalizeVector3(rt.rotation, ToVector3(0)).value, "degrees").toRadians(true),
			scale: normalizeVector3(rt.scale, ToVector3(1)).value,
			pivot: toUnitVector3(normalizeVector3(rt.pivot, ToVector3(0)).value, "cnu"),
		};
	}

	const resolveField = {
		shared(source, blueprint, key, fallback, contextPath, coerce, label = key) {
			const sourceValue = source[key];
			if (sourceValue !== undefined) {
				const resolved = coerce(sourceValue);
				if (resolved !== undefined) return resolved;
				warnLog(`Entity payload ${contextPath} '${label}' malformed; using blueprint/default fallback.`);
			}

			const blueprintValue = coerce(blueprint[key]);
			return blueprintValue !== undefined ? blueprintValue : fallback;
		},
		boolean(source, blueprint, key, fallback, contextPath) {
			return resolveField.shared(source, blueprint, key, fallback, contextPath, (value) => {
				typeof value === "boolean" ? value : undefined
			});
		},
		number(source, blueprint, key, fallback, contextPath) {
			return resolveField.shared(source, blueprint, key, fallback, contextPath, (value) => {
				const normalized = ToNumber(value, NaN);
				return Number.isFinite(normalized) ? normalized : undefined;
			});
		},
		object(source, blueprint, key, fallback, contextPath) {
			return resolveField.shared(source, blueprint, key, fallback, contextPath, (value) => {
				Object.keys(normalizeObject(value)) > 0 ? value : undefined
			});
		},
		vector3(source, blueprint, key, fallback, contextPath, label = key) {
			return resolveField.shared(source, blueprint, key, fallback, contextPath, (value) => {
				const normalized = normalizeVector3(value, fallback);
				return normalized.usedFallback ? undefined : normalized.value;
			}, label);
		}
	};

	const movementStart = resolveField.vector3(
		movementSource, blueprintMovement, "start",
		ToVector3(0), entityId, "movement.start"
	);
	const movementEnd = resolveField.vector3(
		movementSource, blueprintMovement, "end",
		movementStart, entityId, "movement.end"
	);

	return {
		...source,
		id: entityId,
		type: entityType,
		movement: {
			...movementSource,
			start: toUnitVector3(movementStart, "cnu"),
			end: toUnitVector3(movementEnd, "cnu"),
			repeat: resolveField.boolean(movementSource, blueprintMovement, "repeat", true, `${entityId}.movement`),
			backAndForth: resolveField.boolean(movementSource, blueprintMovement, "backAndForth", true, `${entityId}.movement`),
			speed: new Unit(
				Math.max(0, resolveField.number(movementSource, blueprintMovement, "speed", 0, `${entityId}.movement`)),
				"cnu"
			),
			jump: new Unit(
				Math.max(0, resolveField.number(movementSource, blueprintMovement, "jump", 0, `${entityId}.movement`)),
				"cnu"
			),
			jumpInterval: Math.max(0, resolveField.number(movementSource, blueprintMovement, "jumpInterval", 0, `${entityId}.movement`)),
			jumpOnSight: resolveField.boolean(movementSource, blueprintMovement, "jumpOnSight", false, `${entityId}.movement`),
			disappear: resolveField.boolean(movementSource, blueprintMovement, "disappear", false, `${entityId}.movement`),
			chase: resolveField.boolean(movementSource, blueprintMovement, "chase", false, `${entityId}.movement`),
			physics: resolveField.boolean(movementSource, blueprintMovement, "physics", false, `${entityId}.movement`),
		},
		hp: Math.max(0, resolveField.number(source, blueprintSource, "hp", 1, entityId)),
		attacks: Array.isArray(source.attacks) ? source.attacks 
			: Array.isArray(blueprintSource.attacks) ? blueprintSource.attacks : [],
		hardcoded: resolveField.object(source, blueprintSource, "hardcoded", {}, entityId),
		platform: source.platform || blueprintSource.platform,
		animations: resolveField.object(source, blueprintSource, "animations", {}, entityId),
		velocity: toUnitVector3(resolveField.vector3(
			source, blueprintSource, "velocity",
			ToVector3(0), entityId, "velocity"
		), "cnu"),
		collisionOverride: normalizeEntityCollisionOverride(
			resolveField.object(source, blueprintSource, "collisionOverride", {}, entityId),
			entityType,
			entityId
		),
		model: normalizeEntityModel(source.model, source, entityId, blueprint),
	};
}

function normalizeEntityCollisionOverride(value, entityType, contextPath) {
	const source = normalizeObject(value);
	const defaults = {};
	switch (entityType) {
		case "player":                              defaults.physics = "sphere";
		case "enemy":                               defaults.physics = "aabb";
		case "enemy-large": case "enemy-irregular": defaults.physics = "capsule";
		case "boss":                                defaults.physics = "compound-sphere";
		case "projectile":                          defaults.physics = "sphere";
		case "collectible":                         defaults.physics = "aabb";
		case "npc":                                 defaults.physics = "capsule";
	}
	switch (entityType) {
		case "player"                             : defaults.hurtbox = "sphere", defaults.hitbox = "sphere";
		case "enemy"                              : defaults.hurtbox = "aabb", defaults.hitbox = "aabb";
		case "enemy-large": case "enemy-irregular": defaults.hurtbox = "aabb", defaults.hitbox = "capsule";
		case "boss"                               : defaults.hurtbox = "compound-sphere", defaults.hitbox = "compound-sphere";
		case "projectile"                         : defaults.hurtbox = "sphere", defaults.hitbox = null;
		case "collectible"                        : defaults.hurtbox = "aabb", defaults.hitbox = null;
		case "npc"                                : defaults.hurtbox = null, defaults.hitbox = null;
		default                                   : defaults.hurtbox = defaults.physics, defaults.hitbox = null;
	}

	const normalizeShape = (value, fallback, fieldName) => {
		const normalized = normalizeString(value, fallback);
		if (normalized && ["sphere", "aabb", "capsule", "obb", "compound-sphere"].includes(normalized)) return normalized;

		warnLog(`Entity payload ${contextPath} '${fieldName}' malformed; defaulted to '${fallback}'.`);
		return fallback;
	}
	return {
		physics: normalizeShape(source.physics, defaults.physics, "collisionOverride.physics"),
		hurtbox: normalizeShape(source.hurtbox, defaults.hurtbox, "collisionOverride.hurtbox"),
		hitbox: normalizeShape(source.hitbox, defaults.hitbox, "collisionOverride.hitbox"),
	};
}

function normalizeEntityModel(model, source, entityId, blueprint) {
	const modelSource = normalizeObject(model);
	const partDefinitions = normalizeArray(modelSource.parts);
	const spawnSurfaceId = normalizeString(modelSource.spawnSurfaceId, normalizeString(source.spawnSurfaceId, null));

	const normalizeRootTransform = (rootTransform) => {
		const transform = normalizeObject(rootTransform);
		return {
			...transform,
			position: toUnitVector3(normalizeVector3(transform.position, ToVector3(0)).value, "cnu"),
			rotation: toUnitVector3(normalizeVector3(transform.rotation, normalizeVector3(source.rotation, ToVector3(0)).value).value, "degrees").toRadians(true),
			scale: normalizeVector3(transform.scale, normalizeVector3(source.scale, ToVector3(1)).value).value,
			pivot: toUnitVector3(normalizeVector3(transform.pivot, ToVector3(0)).value, "cnu"),
		};
	}
	
	if (partDefinitions.length === 0) {
		const blueprintModel = normalizeObject(blueprint && blueprint.model);
		const blueprintSpawnSurfaceId = normalizeString(blueprintModel.spawnSurfaceId, null);
		const blueprintParts = normalizeArray(blueprintModel.parts);
		if (blueprintParts.length > 0) {
			return {
				...blueprintModel,
				...modelSource,
				spawnSurfaceId: spawnSurfaceId || blueprintSpawnSurfaceId,
				rootTransform: normalizeRootTransform(
					modelSource.rootTransform || blueprintModel.rootTransform || source.rootTransform || null
				),
				parts: blueprintParts,
			};
		}

		return buildDefaultEntityModel(source, entityId);
	}

	return {
		...modelSource,
		spawnSurfaceId,
		rootTransform: normalizeRootTransform(modelSource.rootTransform),
		parts: partDefinitions.map((part, index) => normalizeEntityModelPart(part, entityId, index)),
	};
}
function buildDefaultEntityModel(source, entityId) {
	const texture = normalizeTextureDescriptor(
		source, 
		{ textureID: "default-grid", defaultColor: { r: 0.9, g: 0.35, b: 0.35, a: 1 } }, 
		`${entityId}.defaultModelPart`
	);
	return {
		spawnSurfaceId: normalizeString(source.spawnSurfaceId, null),
		rootTransform: {
			position: new UnitVector3(0, 0, 0, "cnu"),
			rotation: toUnitVector3(normalizeVector3(source.rotation, ToVector3(0)).value, "degrees").toRadians(true),
			scale: normalizeVector3(source.scale, ToVector3(1)).value,
			pivot: new UnitVector3(0, 0, 0, "cnu"),
		},
		parts: [
			{
				id: `${entityId}-core`,
				parentId: "root",
				anchorPoint: "bottom",
				attachmentPoint: "top",
				localPosition: new UnitVector3(0, 0, 0, "cnu"),
				localRotation: new UnitVector3(0, 0, 0, "radians"),
				localScale: ToVector3(1),
				shape: normalizeObjectShape(source, `${entityId}.defaultModelPart`),
				complexity: "medium",
				dimensions: toUnitVector3(normalizeVector3(source.dimensions, ToVector3(1)).value, "cnu"),
				texture: texture,
				textureID: texture.textureID,
				textureColor: texture.color,
				textureOpacity: texture.opacity,
				pivot: new UnitVector3(0, 0, 0, "cnu"),
				primitiveOptions: normalizePrimitiveOptions(source, `${entityId}.defaultModelPart`),
				detail: { scatter: [] },
			},
		],
	};
}
function normalizeEntityModelPart(part, entityId, index) {
	const source = normalizeObject(part);
	const texture = normalizeTextureDescriptor(source, { textureID: "default-grid" }, `${entityId}.parts[${index}]`);
	const parentId = normalizeString(source.parentId, "root");

	const normalizeFace = (value, fallback, contextPath, fieldName) => {
		const normalized = normalizeString(value, fallback).trim().toLowerCase();
		if (["front", "back", "left", "right", "top", "bottom", "center"].includes(normalized)) return normalized;

		warnLog(`Entity payload ${contextPath} '${fieldName}' invalid; defaulted to '${fallback}'.`);
		return fallback;
	}

	return {
		...source,
		id: normalizeString(source.id, `${entityId}-part-${index}`),
		shape: normalizeObjectShape(source, `${entityId}.parts[${index}]`),
		complexity: normalizeGeometryComplexity(source.complexity, `${entityId}.parts[${index}]`),
		parentId: parentId,
		anchorPoint: normalizeFace(source.anchorPoint, parentId === "root" ? "bottom" : "center", `${entityId}.parts[${index}]`, "anchorPoint"),
		attachmentPoint: normalizeFace(source.attachmentPoint, "top", `${entityId}.parts[${index}]`, "attachmentPoint"),
		localPosition: toUnitVector3(normalizeVector3(source.localPosition, ToVector3(0)).value, "cnu"),
		localRotation: toUnitVector3(normalizeVector3(source.localRotation, ToVector3(0)).value, "degrees").toRadians(true),
		localScale: normalizeVector3(source.localScale, ToVector3(1)).value,
		dimensions: toUnitVector3(normalizeVector3(source.dimensions, ToVector3(1)).value, "cnu"),
		pivot: toUnitVector3(normalizeVector3(source.pivot, ToVector3(0), `Object payload ${entityId}.parts[${index}] pivot malformed or missing; defaulted to (0, 0, 0).`).value, "cnu"),
		rotation: new UnitVector3(0, 0, 0, "radians"),
		scale: ToVector3(1),
		position: new UnitVector3(0, 0, 0, "cnu"),
		primitiveOptions: normalizePrimitiveOptions(source, `${entityId}.parts[${index}]`),
		texture: texture,
		detail: { scatter: [] },
		textureID: texture.textureID,
		textureColor: texture.color,
		textureOpacity: texture.opacity,
	};
}

// Terrain & Obstacle Normalization
function normalizeTerrainObject(definition, index) {
	const source = normalizeObject(definition);
	const shape = normalizeObjectShape(source, `terrain[${index}]`);
	const detail = normalizeObject(source.detail);

	return {
		...source,
		id: normalizeString(source.id, `terrain-${index}`),
		shape: shape,
		complexity: normalizeGeometryComplexity(source.complexity, `terrain[${index}]`),
		collisionShape: normalizeObjectCollisionShape(
			source.collisionShape,
			resolveDefaultObjectCollisionShape(shape, `terrain[${index}]`),
			`terrain[${index}]`
		),
		nullSpace: source.nullSpace && typeof source.nullSpace === "boolean",
		sticky: source.sticky && typeof source.sticky === "boolean",
		position: toUnitVector3(normalizeVector3(source.position, ToVector3(0), `Object payload terrain[${index}] position malformed or missing; defaulted to (0, 0, 0).`).value, "cnu"),
		dimensions: toUnitVector3(normalizeVector3(source.dimensions, ToVector3(1), `Object payload terrain[${index}] dimensions malformed or missing; defaulted to (1, 1, 1).`).value, "cnu"),
		rotation: toUnitVector3(normalizeVector3(source.rotation, ToVector3(0), `Object payload terrain[${index}] rotation malformed or missing; defaulted to (0, 0, 0).`).value, "degrees").toRadians(true),
		scale: normalizeVector3(source.scale, ToVector3(1)).value,
		pivot: toUnitVector3(normalizeVector3(source.pivot, ToVector3(0), `Object payload terrain[${index}] pivot malformed or missing; defaulted to (0, 0, 0).`).value, "cnu"),
		primitiveOptions: normalizePrimitiveOptions(source, `terrain[${index}]`),
		texture: normalizeTextureDescriptor(
			source, 
			{ textureID: "grass-soft", defaultColor: { r: 0.28, g: 0.58, b: 0.42, a: 1 } }, 
			`terrain[${index}]`
		),
		detail: {
			...detail,
			scatter: normalizeScatterForDetail(source, detail, `terrain[${index}]`),
		},
	};
}

function normalizeObstacle(definition, index) {
	const source = normalizeObject(definition);
	
	// Normalize optional parts for multi-part obstacles so builders can assume canonical shapes
	const parts = Array.isArray(source.parts) ? source.parts.map((part, pIndex) => {
		const p = normalizeObject(part);
		return {
			...p,
			id: normalizeString(p.id, `${normalizeString(source.id, `obstacle-${index}`)}-part-${pIndex}`),
			shape: normalizeObjectShape(p, `obstacle[${index}].parts[${pIndex}]`),
			complexity: normalizeGeometryComplexity(p.complexity, `obstacle[${index}].parts[${pIndex}]`),
			dimensions: toUnitVector3(normalizeVector3(p.dimensions, ToVector3(1)).value, "cnu"),
			localPosition: toUnitVector3(normalizeVector3(p.localPosition, ToVector3(0)).value, "cnu"),
			localRotation: toUnitVector3(normalizeVector3(p.localRotation, ToVector3(0)).value, "degrees").toRadians(true),
			localScale: normalizeVector3(p.localScale, ToVector3(1)).value,
			primitiveOptions: normalizePrimitiveOptions(p, `obstacle[${index}].parts[${pIndex}]`),
			texture: normalizeTextureDescriptor(p, { textureID: "default-grid" }, `obstacle[${index}].parts[${pIndex}]`),
			detail: { ...normalizeObject(p.detail),
				scatter: normalizeScatterForDetail(
					p, 
					normalizeObject(p.detail), 
					`obstacle[${index}].parts[${pIndex}]`
				),
			},
		};
	}) : [];

	const detail = normalizeObject(source.detail);
	const shape = normalizeObjectShape(source, `obstacle[${index}]`);
	const collisionShape = normalizeObjectCollisionShape(
		source.collisionShape,
		normalizeArray(source.parts).length > 0 ? "obb" : resolveDefaultObjectCollisionShape(shape, `obstacle[${index}]`),
		`obstacle[${index}]`
	);

	return {
		...source,
		id: normalizeString(source.id, `obstacle-${index}`),
		shape,
		complexity: normalizeGeometryComplexity(source.complexity, `obstacle[${index}]`),
		collisionShape: collisionShape,
		position: toUnitVector3(normalizeVector3(source.position, ToVector3(0), `Object payload obstacle[${index}] position malformed or missing; defaulted to (0, 0, 0).`).value, "cnu"),
		dimensions: toUnitVector3(normalizeVector3(source.dimensions, ToVector3(1), `Object payload obstacle[${index}] dimensions malformed or missing; defaulted to (1, 1, 1).`).value, "cnu"),
		rotation: toUnitVector3(normalizeVector3(source.rotation, ToVector3(0), `Object payload obstacle[${index}] rotation malformed or missing; defaulted to (0, 0, 0).`).value, "degrees").toRadians(true),
		scale: normalizeVector3(source.scale, ToVector3(1)).value,
		pivot: toUnitVector3(normalizeVector3(source.pivot, ToVector3(0), `Object payload obstacle[${index}] pivot malformed or missing; defaulted to (0, 0, 0).`).value, "cnu"),
		primitiveOptions: normalizePrimitiveOptions(source, `obstacle[${index}]`),
		texture: normalizeTextureDescriptor(source, { textureID: "default-grid" }, `obstacle[${index}]`),
		detail: {
			...detail,
			scatter: normalizeScatterForDetail(source, detail, `obstacle[${index}]`),
		},
		parts,
	};
}

function normalizeObjectCollisionShape(value, fallback, contextPath) {
	const normalized = normalizeString(value, fallback).trim().toLowerCase();
	if (
		normalized === fallback ||
		!["none", "obb", "aabb", "sphere", "capsule", "triangle-soup"].includes(normalized)
	) {
		warnLog(`Object payload ${contextPath} collisionShape '${value}' invalid; defaulted to '${fallback}'.`);
		return fallback;
	}
	return normalized;
}
function resolveDefaultObjectCollisionShape(shape, contextPath) {
	switch (shape) {
		case "cube": case "plane": case "ramp-simple":                               return "obb";
		case "cylinder": case "capsule":                                             return "capsule";
		case "sphere":                                                               return "sphere";
		case "pyramid": case "cone": case "tube": case "torus": case "ramp-complex": return "triangle-soup";
		default:
			warnLog(`Object payload ${contextPath} shape '${shape}' missing bounds mapping; defaulted collisionShape to 'aabb'.`);
			return "aabb";
	}
}

function normalizeScatterForDetail(source, detail, contextPath) {
	const normalized = normalizeArray(detail.scatter || source.scatter);
	if (!normalized.length) {
		warnLog(`Object payload ${contextPath} scatter malformed; defaulted to empty array.`);
		return [];
	}

	const contextPathScatter = `${contextPath}.detail.scatter`;
	const out = [];
	for (let i = 0; i < normalized.length; i++) {
		const entry = normalizeObject(normalized[i]);
		if (!Object.keys(entry).length) {
			warnLog(`Object payload ${contextPathScatter}[${i}] scatter malformed; scatter entry dropped.`);
			continue;
		}
		const typeID = normalizeString(entry.typeID, "");
		if (!typeID) {
			warnLog(`Object payload ${contextPathScatter}[${i}] scatter missing typeID; entry dropped.`);
			continue;
		}
		out.push({ typeID, density: Math.max(0, ToNumber(entry.density, 0)) });
	}

	return out;
}

// Trigger Normalization
function normalizeTrigger(source, index) {
	const payload = normalizeObject(source.payload);

	if (!hasOwn(source, "payload") || Object.keys(payload).length === 0) warnLog(`
		Trigger '${normalizeString(source.id, `trigger-${index}`)}' 
		payload was malformed and was normalized to an empty object.
	`);

	return {
		...source,
		id: source.id,
		type: source.type,
		start: toUnitVector3(source.start, "cnu"),
		end: toUnitVector3(source.end, "cnu"),
		payload,
		activateOnce: source.activateOnce && typeof source.activateOnce === "boolean",
	};
}

// Level Payload Helpers
function normalizeObjectShape(source, contextPath) {
	const normalized = normalizeString(source.shape, "").toLowerCase();
	if (!["cube", "cylinder", "sphere", "capsule", "cone", "ramp-simple", "ramp-complex", "tube", "torus", "pyramid", "plane"].includes(normalized)) {
		warnLog(`Object payload ${contextPath} shape missing, malformed or invalid; defaulted to 'cube'.`);
		return "cube";
	}
	return normalized;
}

function normalizePrimitiveOptions(source, contextPath) {
	const src = normalizeObject(source);
	const shape = normalizeObject(src.primitiveOptions);
	const geometry = normalizeObject(src.geometry);
	const detail = normalizeObject(src.detail);

	if (!Object.keys(shape).length) {
		warnLog(`Object payload ${contextPath} primitiveOptions malformed or missing; defaulted to empty object.`);
	}
	if (!Object.keys(geometry).length) {
		warnLog(`Object payload ${contextPath} geometry malformed or missing; geometry ignored.`);
	}
	if (!Object.keys(detail).length) {
		warnLog(`Object payload ${contextPath} detail malformed or missing; detail ignored.`);
	}

	return {
		angle: shape.angle || geometry.angle || src.angle || null,
		thickness: ToNumber(shape.thickness || geometry.thickness || detail.thickness || src.thickness, 0),
		radius: ToNumber(shape.radius || geometry.radius || detail.radius || src.radius, 0),
		subdivisionsX: Math.max(1, Math.floor(ToNumber(shape.subdivisionsX || geometry.subdivisionsX || src.subdivisionsX, 1))),
		subdivisionsZ: Math.max(1, Math.floor(ToNumber(shape.subdivisionsZ || geometry.subdivisionsZ || src.subdivisionsZ, 1))),
	};
}

function normalizeGeometryComplexity(value, contextPath) {
	const normalized = normalizeString(value, "").trim().toLowerCase();
	if (!["low", "high", "medium"].includes(normalized)) {
		warnLog(`Object payload ${contextPath} complexity missing, malformed or invalid; defaulted to 'medium'.`);
		return "medium";
	}
	return normalized;
}

function normalizeTextureDescriptor(source, options, contextPath) {
	const src = normalizeObject(source);
	const textureFromSource = normalizeObject(src.texture);

	const opacity = ToNumber(textureFromSource.opacity, ToNumber(src.textureOpacity, 1));
	if (!Number.isFinite(opacity)) warnLog(`Object payload ${contextPath} texture.opacity malformed; defaulted to 1.`);

	let baseTextureID = normalizeString(textureFromSource.textureID, normalizeString(options.textureID, "default-grid"));
	if (!hasOwn(visualTemplates.textures, baseTextureID)) {
		warnLog(`Object payload ${contextPath} unknown textureID '${baseTextureID}'; defaulted to 'default-grid'.`);
		baseTextureID = "default-grid";
	}
	
	const shape = normalizeString(textureFromSource.shape)
	const animatedSource = [textureFromSource.animated, src.textureAnimated];
	return {
		textureID: baseTextureID,
		baseTextureID: baseTextureID,
		materialTextureID: shape ? `${baseTextureID}::shape=${shape}` : baseTextureID,
		shape: shape,
		color: (() => {
			const color = normalizeObject(textureFromSource.color || src.textureColor || options.defaultColor);
			if (Object.keys(color).length === 0) return fallback;
			const r = ToNumber(color.r, 1);
			const g = ToNumber(color.g, 1);
			const b = ToNumber(color.b, 1);
			const a = ToNumber(color.a, 1);
			if ([r, g, b, a].some((v) => !Number.isFinite(v))) {
				warnLog(`Object payload ${contextPath + ".color"} color malformed; defaulting to fallback.`);
				return { r: 1, g: 1, b: 1, a: 1 };
			}
			return { r: Clamp01(r), g: Clamp01(g), b: Clamp01(b), a: Clamp01(a) };
		})(),
		opacity: Clamp01(ToNumber(opacity, 1)),
		density: Math.max(0, ToNumber(textureFromSource.density, ToNumber(src.textureDensity, 1))),
		speckSize: Math.max(0.1, ToNumber(textureFromSource.speckSize, ToNumber(src.textureSpeckSize, 1))),
		animated: ((animatedSource[0] && typeof animatedSource[0]) || (animatedSource[1] && typeof animatedSource[1])) === true,
		holdTimeSpeed: Clamp(ToNumber(textureFromSource.holdTimeSpeed, ToNumber(src.textureHoldTimeSpeed, 1)), 0, 10),
		blendTimeSpeed: Clamp(ToNumber(textureFromSource.blendTimeSpeed, ToNumber(src.textureBlendTimeSpeed, 1)), 0.05, 10),
	};
}

export default { 
	MenuUIPayload, 
	SplashPayload,
	CutscenePayload,
	LevelPayload,
};
