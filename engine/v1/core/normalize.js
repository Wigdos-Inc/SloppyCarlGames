// Normalization of Game Payloads for Engine use
// Exclusively called by validate.js

import { NormalizeVector3, ToVector3 } from "../math/Vector3.js";
import { ToNumber, Unit, UnitVector3 } from "../math/Utilities.js";
import { Log } from "./meta.js";
import visualTemplates from "../builder/templates/textures.json" with { type: "json" };
import aliasMap from "./aliases.json" with { type: "json" };

function warnLog(string) {
	Log("ENGINE", string, "warn", "Validation");
}

function normalizeKey(key) {
	return String(key).toLowerCase().replace(/[-_]/g, "");
}

function getAliasValue(source, aliases, fallback = undefined) {
	const src = normalizeObject(source);
	if (Object.keys(src).length === 0) return fallback;

	const lookup = {};
	const keys = Object.keys(src);
	for (let i = 0; i < keys.length; i += 1) {
		const key = keys[i];
		const normalized = normalizeKey(key);
		if (!Object.prototype.hasOwnProperty.call(lookup, normalized)) lookup[normalized] = src[key];
	}

	for (let i = 0; i < aliases.length; i += 1) {
		const normalized = normalizeKey(aliases[i]);
		if (Object.prototype.hasOwnProperty.call(lookup, normalized)) return lookup[normalized];
	}

	return fallback;
}

function hasAliasValue(source, aliases) {
	const sentinel = undefined;
	return getAliasValue(source, aliases, sentinel) !== sentinel;
}

function alias(path) {
	const segments = path.split(".");
	let result = aliasMap;
	for (let index = 0; index < segments.length; index += 1) {
		result = result[segments[index]];
	}
	return result;
}

function getByAlias(source, aliasPath, fallback = undefined) {
	return getAliasValue(source, alias(aliasPath), fallback);
}

function hasByAlias(source, aliasPath) {
	return hasAliasValue(source, alias(aliasPath));
}

/* === UI Data === */

function MenuUIPayload(payload) {
	const source = normalizeObject(payload);
	const rawElements = normalizeArray(getByAlias(source, "menu.elements", []));
	const screenId = normalizeString(getByAlias(source, "menu.screenId", ""), "");
	const rootId = normalizeString(getByAlias(source, "menu.rootId", "engine-ui-root"), "engine-ui-root");
	const musicSource = getByAlias(source, "menu.music", null);
	const elements = [];

	for (let i = 0; i < rawElements.length; i += 1) {
		const normalized = normalizeElement(rawElements[i], `elements[${i}]`);
		if (normalized) elements.push(normalized);
	}

	return {
		...source,
		screenId,
		rootId,
		elements,
		music: normalizeMusic(musicSource),
	};
}

function SplashPayload(payload) {
	if (payload === null || payload === undefined) return null;

	if (typeof payload === "string") {
		const presetId = normalizeSplashPresetId(payload);
		if (presetId.length === 0) return null;
		return { presetId, sequence: [], outputType: "preset" };
	}

	if (Array.isArray(payload)) {
		const sequence = normalizeSplashSequence(payload);
		if (sequence.length === 0) {
			warnLog("Splash payload provided an empty sequence and was ignored.");
			return null;
		}
		return { presetId: null, sequence, outputType: "custom" };
	}

	const source = normalizeObject(payload);
	const presetValue = getByAlias(source, "splash.presetId", "");
	const presetId = normalizeSplashPresetId(presetValue);
	const sequenceSource = getByAlias(source, "splash.sequence", []);
	const inputSequence = Array.isArray(sequenceSource) ? sequenceSource : [];
	const sequence = normalizeSplashSequence(inputSequence);

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

function normalizeSplashPresetId(presetId) {
	const normalized = normalizeString(presetId, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "")
		.trim();

	if (normalized === "default" || normalized === "all") return "default";
	if (normalized === "sloppycarlgames" || normalized === "sloppycarl") return "sloppycarl";
	if (normalized === "wigdosstudios" || normalized === "wigdos") return "wigdos";
	if (normalized === "carlnetengine" || normalized === "carlnet") return "carlnet";

	return "";
}

function normalizeSplashSequence(sequence) {
	const source = normalizeArray(sequence);
	const normalized = [];

	for (let index = 0; index < source.length; index += 1) {
		const step = normalizeSplashStep(source[index], `splash.sequence[${index}]`);
		if (step) normalized.push(step);
	}

	return normalized;
}

function normalizeSplashStep(step, path) {
	const source = normalizeObject(step);
	if (Object.keys(source).length === 0) {
		warnLog(`Splash payload dropped malformed step at '${path}'.`);
		return null;
	}

	const name = normalizeString(getByAlias(source, "splash.step.name", ""), "");
	const image = normalizeString(getByAlias(source, "splash.step.image", ""), "");
	if (image.length === 0) {
		warnLog(`Splash payload dropped step at '${path}' because image is required.`);
		return null;
	}

	const sfx = normalizeSplashAudio(getByAlias(source, "splash.step.sfx", null));
	const voice = normalizeSplashAudio(getByAlias(source, "splash.step.voice", null));
	const voiceAtStartSource = getByAlias(source, "splash.step.voiceAtStart", false);
	const fadeInSource = getByAlias(source, "splash.step.fadeInSeconds", 0.3);
	const holdMsSource = getByAlias(source, "splash.step.holdMs", 1000);
	const fadeOutSource = getByAlias(source, "splash.step.fadeOutSeconds", 1);
	const rawElements = normalizeArray(getByAlias(source, "splash.step.elements", []));
	const rawText = normalizeArray(getByAlias(source, "splash.step.text", []));

	const elements = [];
	for (let index = 0; index < rawElements.length; index += 1) {
		const element = normalizeElement(rawElements[index], `${path}.elements[${index}]`);
		if (element) elements.push(element);
	}

	const text = [];
	for (let index = 0; index < rawText.length; index += 1) {
		const entry = normalizeSplashTextEntry(rawText[index], `${path}.text[${index}]`);
		if (entry) text.push(entry);
	}

	// Ensure name is always a non-null string. If missing, derive a deterministic fallback from the step index in the path.
	const indexMatch = path && typeof path === "string" ? path.match(/\[(\d+)\]/) : null;
	const stepIndex = indexMatch ? indexMatch[1] : "0";
	const finalName = name.length > 0 ? name : `splash-${stepIndex}`;

	return {
		name: finalName,
		image,
		sfx,
		voice,
		voiceAtStart: voiceAtStartSource === true,
		fadeInSeconds: ToNumber(fadeInSource, 0.3),
		holdMs: Math.max(0, Math.floor(ToNumber(holdMsSource, 1000))),
		fadeOutSeconds: ToNumber(fadeOutSource, 1),
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

	const content = normalizeString(getByAlias(source, "splash.text.content", ""), "");
	if (content.length === 0) {
		warnLog(`Splash payload ignored text entry at '${path}' because content is required.`);
		return null;
	}

	const idValue = normalizeString(getByAlias(source, "splash.text.id", ""), "");
	const classNameValue = normalizeString(getByAlias(source, "splash.text.className", ""), "");
	const typeValue = normalizeString(getByAlias(source, "splash.text.type", "div"), "div");
	const position = normalizeObject(getByAlias(source, "splash.text.position", {}));
	const styles = normalizeObject(getByAlias(source, "splash.text.styles", {}));
	const attributes = normalizeObject(getByAlias(source, "splash.text.attributes", {}));

	const mergedStyles = { ...position, ...styles };
	if (Object.keys(position).length > 0 && typeof mergedStyles.position !== "string") {
		mergedStyles.position = "absolute";
	}

	const fallbackTextId = generateDeterministicId("splash-text", path);
	return {
		id: idValue.length > 0 ? idValue : fallbackTextId,
		className: classNameValue,
		type: typeValue.length > 0 ? typeValue : "div",
		content,
		styles: mergedStyles,
		attributes,
	};
}

function generateDeterministicId(prefix, path) {
	const raw = String(path || "");
	const normalized = raw.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
	return normalized.length > 0 ? `${prefix}-${normalized}` : `${prefix}`;
}

function normalizeSplashAudio(audio) {
	const source = normalizeObject(audio);
	if (Object.keys(source).length === 0) return null;

	const src = normalizeString(getByAlias(source, "splash.audio.src", ""), "");
	if (src.length === 0) return null;

	return {
		src: normalizeAudioSource(src),
		options: normalizeObject(getByAlias(source, "splash.audio.options", {})),
	};
}

function normalizeMusic(music) {
	const source = normalizeObject(music);
	if (Object.keys(source).length === 0) return null;

	const name = normalizeString(getByAlias(source, "music.name", ""), "");
	const src = normalizeString(getByAlias(source, "music.src", ""), "");
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

function normalizeAudioSource(source) {
	if (typeof source !== "string" || source.length === 0) return source;

	let normalized = source.replace(/^(\.\.\/)+/, "");

	try {
		const url = new URL(normalized, import.meta.url);
		const marker = "/audio/";
		const markerIndex = url.pathname.toLowerCase().lastIndexOf(marker);
		if (markerIndex >= 0) {
			normalized = url.pathname.slice(markerIndex + 1);
		}
	} catch (error) {
		// leave normalized as-is for relative paths
	}

	return normalized;
}

function normalizeElement(element, path) {
	const source = normalizeObject(element);
	if (Object.keys(source).length === 0) {
		warnLog(`UI payload dropped malformed element at '${path}'.`);
		return null;
	}

	const children = [];
	const sourceChildren = normalizeArray(getByAlias(source, "element.children", []));
	for (let i = 0; i < sourceChildren.length; i += 1) {
		const normalized = normalizeElement(sourceChildren[i], `${path}.children[${i}]`);
		if (normalized) children.push(normalized);
	}

	const attributes = normalizeObject(getByAlias(source, "element.attributes", {}));
	const styles = normalizeObject(getByAlias(source, "element.styles", {}));

	const eventMap = normalizeActionMap(getByAlias(source, "element.events", {}), `${path}.events`);
	const onMap = normalizeActionMap(getByAlias(source, "element.on", {}), `${path}.on`);

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

	const sourceKeys = Object.keys(source);
	for (let i = 0; i < sourceKeys.length; i += 1) {
		const directKey = sourceKeys[i];
		const eventName = directEventKeyMap[normalizeKey(directKey)];
		if (!eventName) continue;
		const normalizedAction = normalizeAction(source[directKey], `${path}.${directKey}`);
		if (normalizedAction !== null) {
			// Prefer existing explicit `events` entry; otherwise set from shorthand.
			if (!eventMap[eventName]) eventMap[eventName] = normalizedAction;
		}
	}

	const idValue = normalizeString(getByAlias(source, "element.id", ""), "");
	const classNameValue = normalizeString(getByAlias(source, "element.className", ""), "");
	const fallbackId = generateDeterministicId("element", path);

	return {
		...source,
		type: normalizeString(getByAlias(source, "element.type", "div"), "div"),
		id: idValue.length > 0 ? idValue : fallbackId,
		className: classNameValue,
		text: (() => {
			const textValue = getByAlias(source, "element.text", undefined);
			return typeof textValue === "string" ? textValue : textValue !== undefined ? String(textValue) : undefined;
		})(),
		attributes,
		styles,
		events: eventMap,
		on: onMap,
		children,
	};
}

function normalizeActionMap(actions, path) {
	const source = normalizeObject(actions);
	if (Object.keys(source).length === 0) return {};

	const normalized = {};
	const keys = Object.keys(source);
	for (let index = 0; index < keys.length; index += 1) {
		const key = keys[index];
		if (typeof key !== "string" || key.length === 0) continue;

		const value = normalizeAction(source[key], `${path}.${key}`);
		if (value !== null) normalized[key] = value;
	}

	return normalized;
}

function normalizeAction(action, path) {
	if (typeof action === "string") {
		const trimmed = action.trim();
		if (trimmed.length === 0) {
			warnLog(`UI payload dropped empty string action at '${path}'.`);
			return null;
		}
		return trimmed;
	}

	if (Array.isArray(action)) {
		const list = [];
		for (let i = 0; i < action.length; i += 1) {
			const normalized = normalizeAction(action[i], `${path}[${i}]`);
			if (normalized !== null) list.push(normalized);
		}

		if (list.length === 0) {
			warnLog(`UI payload dropped empty action list at '${path}'.`);
			return null;
		}

		return list;
	}

	if (!action || typeof action !== "object") {
		warnLog(`UI payload dropped malformed action at '${path}'.`);
		return null;
	}

	const actionSource = normalizeObject(action);
	const actionType = normalizeString(getByAlias(actionSource, "action.type", ""), "");

	if (actionType === "ui") {
		const uiPayload = normalizeObject(getByAlias(actionSource, "action.payload", {}));
		if (Object.keys(uiPayload).length === 0) {
			warnLog(`UI payload dropped invalid 'ui' action at '${path}': missing object payload.`);
			return null;
		}
		return { ...actionSource, type: "ui", payload: uiPayload };
	}

	if (actionType === "request") {
		const screenId = normalizeString(getByAlias(actionSource, "action.screenId", ""), "");
		if (screenId.length === 0) {
			warnLog(`UI payload dropped invalid 'request' action at '${path}': missing screenId.`);
			return null;
		}
		return { ...actionSource, type: "request", screenId };
	}

	if (actionType === "event") {
		const eventName = normalizeString(getByAlias(actionSource, "action.name", ""), "");
		if (eventName.length === 0) {
			warnLog(`UI payload dropped invalid 'event' action at '${path}': missing event name.`);
			return null;
		}
		return { ...actionSource, type: "event", name: eventName };
	}

	if (actionType === "exit") return { ...actionSource, type: "exit" };

	if (actionType === "style") {
		const targetId = normalizeString(getByAlias(actionSource, "action.targetId", ""), "");
		if (targetId.length === 0) {
			warnLog(`UI payload dropped invalid 'style' action at '${path}': missing targetId.`);
			return null;
		}

		const stylesSource = normalizeObject(getByAlias(actionSource, "action.styles", {}));
		const styles = Object.keys(stylesSource).length > 0 ? { ...stylesSource } : null;
		if (!styles) {
			warnLog(`UI payload dropped invalid 'style' action at '${path}': missing styles object.`);
			return null;
		}

		styles.classList = normalizeStyleClassList(getByAlias(stylesSource, "action.classList", styles.classList));
		return {
			...actionSource,
			type: "style",
			targetId,
			styles,
		};
	}

	warnLog(`UI payload dropped unsupported action type at '${path}'.`);
	return null;
}

function normalizeStyleClassList(classListConfig) {
	const add = [];
	const remove = [];

	const classListArray = normalizeArray(classListConfig);
	if (classListArray.length > 0) {
		for (let index = 0; index < classListArray.length; index += 1) {
			const className = classListArray[index];
			if (typeof className === "string" && className.length > 0) add.push(className);
		}
		return { add, remove };
	}

	const source = normalizeObject(classListConfig);
	if (Object.keys(source).length > 0) {
		const addClasses = normalizeArray(getByAlias(source, "styleClassList.add", []));
		for (let index = 0; index < addClasses.length; index += 1) {
			const className = addClasses[index];
			if (typeof className === "string" && className.length > 0) add.push(className);
		}

		const removeClasses = normalizeArray(getByAlias(source, "styleClassList.remove", []));
		for (let index = 0; index < removeClasses.length; index += 1) {
			const className = removeClasses[index];
			if (typeof className === "string" && className.length > 0) remove.push(className);
		}
	}

	return { add, remove };
}

function normalizeRenderedCutscenePayload(payload) {
	const source = normalizeObject(payload);
	const missing = undefined;
	const rawRenderedSource = getByAlias(source, "cutscene.rendered.source", missing);
	const rawFit = getByAlias(source, "cutscene.rendered.fit", missing);
	const rawFadeOutSeconds = getByAlias(source, "cutscene.rendered.fadeOutSeconds", missing);
	const rawFadeLeadSeconds = getByAlias(source, "cutscene.rendered.fadeLeadSeconds", missing);
	const rawMuted = getByAlias(source, "cutscene.rendered.muted", missing);
	const rawLoop = getByAlias(source, "cutscene.rendered.loop", missing);

	const renderedSource = normalizeString(rawRenderedSource, "");
	if (rawRenderedSource === missing || renderedSource.length === 0) {
		warnLog("Cutscene payload rendered.source missing or malformed; defaulted to empty string.");
	}

	const fit = normalizeString(rawFit, "cover");
	if (rawFit === missing || fit === "cover" && rawFit !== "cover") {
		warnLog("Cutscene payload rendered.fit missing or malformed; defaulted to 'cover'.");
	}

	const parsedFadeOutSeconds = ToNumber(rawFadeOutSeconds, NaN);
	const fadeOutSeconds = Number.isFinite(parsedFadeOutSeconds)
		? Math.max(0, parsedFadeOutSeconds)
		: 0.5;
	if (rawFadeOutSeconds === missing || !Number.isFinite(parsedFadeOutSeconds) || parsedFadeOutSeconds < 0) {
		warnLog("Cutscene payload rendered.fadeOutSeconds missing or malformed; defaulted to 0.5.");
	}

	const parsedFadeLeadSeconds = ToNumber(rawFadeLeadSeconds, NaN);
	const fadeLeadSeconds = Number.isFinite(parsedFadeLeadSeconds)
		? Math.max(0, parsedFadeLeadSeconds)
		: 0.5;
	if (rawFadeLeadSeconds === missing || !Number.isFinite(parsedFadeLeadSeconds) || parsedFadeLeadSeconds < 0) {
		warnLog("Cutscene payload rendered.fadeLeadSeconds missing or malformed; defaulted to 0.5.");
	}

	const muted = rawMuted === true;
	if (rawMuted === missing || typeof rawMuted !== "boolean") {
		warnLog("Cutscene payload rendered.muted missing or malformed; defaulted to false.");
	}

	const loop = rawLoop === true;
	if (rawLoop === missing || typeof rawLoop !== "boolean") {
		warnLog("Cutscene payload rendered.loop missing or malformed; defaulted to false.");
	}

	return {
		type: "rendered",
		source: renderedSource,
		muted,
		loop,
		fit,
		fadeOutSeconds,
		fadeLeadSeconds,
	};
}

function normalizeEngineCutscenePayload(payload) {
	const source = normalizeObject(payload);
	const missing = undefined;
	const rawDurationSeconds = getByAlias(source, "cutscene.engine.durationSeconds", missing);
	const rawFallbackWaitMs = getByAlias(source, "cutscene.engine.fallbackWaitMs", missing);
	const rawFadeLeadSeconds = getByAlias(source, "cutscene.engine.fadeLeadSeconds", missing);
	const rawFadeOutSeconds = getByAlias(source, "cutscene.engine.fadeOutSeconds", missing);
	const parsedDurationSeconds = rawDurationSeconds === missing
		? NaN
		: ToNumber(rawDurationSeconds, NaN);
	const parsedFallbackWaitMs = rawFallbackWaitMs === missing
		? NaN
		: ToNumber(rawFallbackWaitMs, NaN);
	const durationSeconds = Number.isFinite(parsedDurationSeconds)
		? Math.max(0, parsedDurationSeconds)
		: 0;
	if (rawDurationSeconds === missing || !Number.isFinite(parsedDurationSeconds) || parsedDurationSeconds < 0) {
		warnLog("Cutscene payload engine.durationSeconds missing or malformed; defaulted to 0.");
	}

	const fallbackWaitMs = Number.isFinite(parsedFallbackWaitMs)
		? Math.max(0, Math.floor(parsedFallbackWaitMs))
		: 0;
	if (rawFallbackWaitMs === missing || !Number.isFinite(parsedFallbackWaitMs) || parsedFallbackWaitMs < 0) {
		warnLog("Cutscene payload engine.fallbackWaitMs missing or malformed; defaulted to 0.");
	}

	const parsedFadeLeadSeconds = ToNumber(rawFadeLeadSeconds, NaN);
	const fadeLeadSeconds = Number.isFinite(parsedFadeLeadSeconds)
		? Math.max(0, parsedFadeLeadSeconds)
		: 0.5;
	if (rawFadeLeadSeconds === missing || !Number.isFinite(parsedFadeLeadSeconds) || parsedFadeLeadSeconds < 0) {
		warnLog("Cutscene payload engine.fadeLeadSeconds missing or malformed; defaulted to 0.5.");
	}

	const parsedFadeOutSeconds = ToNumber(rawFadeOutSeconds, NaN);
	const fadeOutSeconds = Number.isFinite(parsedFadeOutSeconds)
		? Math.max(0, parsedFadeOutSeconds)
		: 0.5;
	if (rawFadeOutSeconds === missing || !Number.isFinite(parsedFadeOutSeconds) || parsedFadeOutSeconds < 0) {
		warnLog("Cutscene payload engine.fadeOutSeconds missing or malformed; defaulted to 0.5.");
	}

	return {
		type: "engine",
		data: getByAlias(source, "cutscene.engine.data", null),
		durationSeconds,
		fallbackWaitMs,
		fadeLeadSeconds,
		fadeOutSeconds,
	};
}

function CutscenePayload(payload, cutsceneType) {
	const source = normalizeObject(payload);
	if (Object.keys(source).length === 0) return null;

	if (cutsceneType === "rendered") return normalizeRenderedCutscenePayload(source);
	if (cutsceneType === "engine") return normalizeEngineCutscenePayload(source);

	warnLog("Cutscene payload ignored: unsupported cutscene type.");
	return null;
}

/* === Level Data === */

// Datatype Normalization Helpers
function normalizeObject(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function normalizeString(value, fallback = "") {
	return (value && typeof value === "string" && value.length > 0) ? value : fallback;
}

function normalizeCollisionShape(value) {
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase();
	return normalized.length > 0 ? normalized : null;
}


function resolveDefaultEntityCollisionShape(entityType) {
	switch (entityType) {
		case "player": return "sphere";
		case "enemy": return "aabb";
		case "enemy-large":
		case "enemy-irregular": return "sphere";
		case "boss": return "compound-sphere";
		case "projectile": return "sphere";
		case "collectible": return "aabb";
		case "npc": return "capsule";
		default: return "sphere";
	}
}

function resolveDefaultEntityCollisionLayers(entityType) {
	const physics = resolveDefaultEntityCollisionShape(entityType);
	switch (entityType) {
		case "player": return { physics, hurtbox: "sphere", hitbox: "sphere" };
		case "enemy": return { physics, hurtbox: "aabb", hitbox: "aabb" };
		case "enemy-large":
		case "enemy-irregular": return { physics, hurtbox: "sphere", hitbox: "sphere" };
		case "boss": return { physics, hurtbox: "compound-sphere", hitbox: "compound-sphere" };
		case "projectile": return { physics, hurtbox: "sphere", hitbox: null };
		case "collectible": return { physics, hurtbox: "aabb", hitbox: null };
		case "npc": return { physics, hurtbox: null, hitbox: null };
		default: return { physics, hurtbox: physics, hitbox: null };
	}
}

const validEntityCollisionShapes = new Set(["sphere", "aabb", "capsule", "obb", "compound-sphere"]);
const validObjectShapes = new Set(["cube", "cylinder", "sphere", "capsule", "cone", "ramp", "tube", "torus", "pyramid", "plane"]);
const validObjectCollisionShapes = new Set(["none", "obb", "aabb", "triangle-soup"]);
function normalizeEntityCollisionLayerShape(value, fallback, contextPath, fieldName) {
	if (value === undefined || value === null) return fallback;

	const normalized = normalizeCollisionShape(value);
	if (normalized !== null && validEntityCollisionShapes.has(normalized)) return normalized;

	warnLog(`Entity payload ${contextPath} '${fieldName}' malformed; defaulted to '${fallback}'.`);
	return fallback;
}

function normalizeEntityCollisionOverride(value, entityType, contextPath) {
	const source = normalizeObject(value);
	const defaults = resolveDefaultEntityCollisionLayers(entityType);
	return {
		physics: normalizeEntityCollisionLayerShape(source.physics, defaults.physics, contextPath, "collisionOverride.physics"),
		hurtbox: normalizeEntityCollisionLayerShape(source.hurtbox, defaults.hurtbox, contextPath, "collisionOverride.hurtbox"),
		hitbox: normalizeEntityCollisionLayerShape(source.hitbox, defaults.hitbox, contextPath, "collisionOverride.hitbox"),
	};
}

function normalizeArray(value) { 
	return Array.isArray(value) ? value : []; 
}

function isFiniteNumber(value) { 
	return typeof value === "number" && Number.isFinite(value); 
}

function isVector3Like(value) {
	// Check if value matches vector structure: { x,y,z }
	return value
		&& typeof value === "object"
		&& !Array.isArray(value)
		&& isFiniteNumber(value.x)
		&& isFiniteNumber(value.y)
		&& isFiniteNumber(value.z);
}

function normalizeGeometryComplexity(value, contextPath) {
	// Check if complexity is provided.
	if (typeof value !== "string") {
		warnLog(`Object payload ${contextPath} missing complexity; defaulted to 'medium'.`);
		return "medium";
	}

	// Check if complexity matches expected values
	const normalized = value.trim().toLowerCase();
	if (normalized === "low" || normalized === "high" || normalized === "medium") return normalized;

	warnLog(`Object payload ${contextPath} complexity '${value}' invalid; defaulted to 'medium'.`);
	return "medium";
}

function normalizeShapeAlias(source, contextPath) {
	const shape = normalizeString(getByAlias(source, "shape.shape", ""), "");
	if (shape.length > 0) {
		const normalized = shape.toLowerCase();
		if (validObjectShapes.has(normalized)) return normalized;
		warnLog(`Object payload ${contextPath} shape '${shape}' invalid; defaulted to 'cube'.`);
		return "cube";
	}

	const primitive = normalizeString(getByAlias(source, "shape.primitive", ""), "");
	if (primitive.length > 0) {
		const normalized = primitive.toLowerCase();
		if (validObjectShapes.has(normalized)) return normalized;
		warnLog(`Object payload ${contextPath} primitive '${primitive}' invalid; defaulted to 'cube'.`);
		return "cube";
	}

	warnLog(`Object payload ${contextPath} missing 'shape' or 'primitive' definition; defaulted to 'cube'.`);
	return "cube";
}

function normalizeObjectCollisionShape(value, fallback, contextPath) {
	if (value === undefined || value === null) return fallback;

	const normalized = normalizeCollisionShape(value);
	if (normalized !== null && validObjectCollisionShapes.has(normalized)) return normalized;

	warnLog(`Object payload ${contextPath} collisionShape '${value}' invalid; defaulted to '${fallback}'.`);
	return fallback;
}

function normalizeVector3WithWarning(value, fallback, contextPath, fieldName) {
	if (!isVector3Like(value)) {
		warnLog(`
			Object payload ${contextPath} ${fieldName} malformed or missing; 
			defaulted to (${fallback.x}, ${fallback.y}, ${fallback.z}).
		`);
	}

	return NormalizeVector3(value, fallback);
}

function normalizeEntityFace(value, fallback, contextPath, fieldName) {
	const normalized = normalizeString(value, fallback).trim().toLowerCase();
	if (["front", "back", "left", "right", "top", "bottom", "center"].includes(normalized)) return normalized;

	warnLog(`Entity payload ${contextPath} '${fieldName}' invalid; defaulted to '${fallback}'.`);
	return fallback;
}

function normalizePrimitiveOptions(source, contextPath) {
	const src = normalizeObject(source);
	const rawPrimitive = getByAlias(src, "primitive.options", undefined);
	const rawGeometry = getByAlias(src, "primitive.geometry", undefined);
	const rawDetail = getByAlias(src, "primitive.detail", undefined);

	if (
		rawPrimitive !== undefined && 
		(typeof rawPrimitive !== "object" || Array.isArray(rawPrimitive) || rawPrimitive === null)
	) {
		warnLog(`Object payload ${contextPath} primitiveOptions malformed; defaulted to empty object.`);
	}
	if (
		rawGeometry !== undefined && 
		(typeof rawGeometry !== "object" || Array.isArray(rawGeometry) || rawGeometry === null)
	) {
		warnLog(`Object payload ${contextPath} geometry malformed; geometry aliases ignored.`);
	}
	if (
		rawDetail !== undefined && 
		(typeof rawDetail !== "object" || Array.isArray(rawDetail) || rawDetail === null)
	) {
		warnLog(`Object payload ${contextPath} detail malformed; detail aliases ignored.`);
	}

	const primitive = normalizeObject(rawPrimitive);
	const geometry = normalizeObject(rawGeometry);
	const detail = normalizeObject(rawDetail);

	return {
		angle: primitive.angle || primitive.rampAngle || geometry.angle || src.angle || src.rampAngle || null,
		thickness: ToNumber(primitive.thickness, ToNumber(geometry.thickness, ToNumber(detail.thickness, ToNumber(src.thickness, 0)))),
		radius: ToNumber(primitive.radius, ToNumber(geometry.radius, ToNumber(detail.radius, ToNumber(src.radius, 0)))),
		subdivisionsX: Math.max(1, Math.floor(ToNumber(primitive.subdivisionsX, ToNumber(geometry.subdivisionsX, ToNumber(src.subdivisionsX, 1))))),
		subdivisionsZ: Math.max(1, Math.floor(ToNumber(primitive.subdivisionsZ, ToNumber(geometry.subdivisionsZ, ToNumber(src.subdivisionsZ, 1))))),
	};
}

function normalizeScatterForDetail(source, detail, contextPath) {
	if (Array.isArray(detail.scatter)) return normalizeScatterRequests(
		detail.scatter, 
		`${contextPath}.detail.scatter`
	);

	if (source.scatter !== undefined) {
		if (Array.isArray(source.scatter)) return normalizeScatterRequests(
			source.scatter, 
			`${contextPath}.scatter`
		);

		warnLog(`Object payload ${contextPath} scatter malformed; defaulted to empty array.`);
	}

	return [];
}

function normalizeTerrainObject(definition, index) {
	const source = normalizeObject(definition);
	const detail = normalizeObject(getByAlias(source, "detail.value", {}));
	const shape = normalizeShapeAlias(source, `terrain[${index}]`);
	const complexity = normalizeGeometryComplexity(getByAlias(source, "geometry.complexity", undefined), `terrain[${index}]`);
	const primitiveOptions = normalizePrimitiveOptions(source, `terrain[${index}]`);

	const position = normalizeVector3WithWarning(
		getByAlias(source, "vector.position", undefined), 
		ToVector3(0), 
		`terrain[${index}]`, 
		"position"
	);
	const dimensions = normalizeVector3WithWarning(
		getByAlias(source, "vector.dimensions", undefined), 
		ToVector3(1), 
		`terrain[${index}]`, 
		"dimensions"
	);
	const rotation = normalizeVector3WithWarning(
		getByAlias(source, "vector.rotation", undefined), 
		ToVector3(0), 
		`terrain[${index}]`, 
		"rotation"
	);
	const pivot = normalizeVector3WithWarning(
		getByAlias(source, "vector.pivot", undefined), 
		ToVector3(0), 
		`terrain[${index}]`,
		"pivot"
	);
	
	const texture = normalizeTextureDescriptor(
		source, 
		{ textureID: "grass-soft", defaultColor: { r: 0.28, g: 0.58, b: 0.42, a: 1 } }, 
		`terrain[${index}]`
	);

	return {
		...source,
		id: normalizeString(source.id, `terrain-${index}`),
		shape: shape,
		complexity: complexity,
		collisionShape: normalizeObjectCollisionShape(source.collisionShape, "obb", `terrain[${index}]`),
		position: new UnitVector3(position.x, position.y, position.z, "cnu"),
		dimensions: new UnitVector3(dimensions.x, dimensions.y, dimensions.z, "cnu"),
		rotation: new UnitVector3(rotation.x, rotation.y, rotation.z, "degrees").toRadians(true),
		scale: NormalizeVector3(source.scale, ToVector3(1)),
		pivot: new UnitVector3(pivot.x, pivot.y, pivot.z, "cnu"),
		primitiveOptions: primitiveOptions,
		texture: texture,
		detail: {
			...detail,
			scatter: normalizeScatterForDetail(source, detail, `terrain[${index}]`),
		},
	};
}

function normalizeTrigger(definition, index) {
	const source = normalizeObject(definition);
	const start = NormalizeVector3(getByAlias(source, "vector.start", undefined), ToVector3(0));
	const end = NormalizeVector3(getByAlias(source, "vector.end", undefined), start);
	const triggerType = normalizeString(getByAlias(source, "trigger.type", ""), "");
	const payload = normalizeObject(getByAlias(source, "trigger.payload", {}));

	if (hasByAlias(source, "trigger.payload") && Object.keys(payload).length === 0) warnLog(`
		Trigger '${normalizeString(source.id, `trigger-${index}`)}' 
		payload was malformed and was normalized to an empty object.
	`);

	let activateOnce = true;
	const activateOnceSource = getByAlias(source, "trigger.activateOnce", undefined);
	if (typeof activateOnceSource === "boolean") activateOnce = activateOnceSource;
	else if (activateOnceSource !== undefined) warnLog(`
		Trigger '${normalizeString(source.id, `trigger-${index}`)}' 
		activateOnce was malformed and defaulted to true.
	`);

	return {
		...source,
		id: normalizeString(source.id, `trigger-${index}`),
		type: triggerType,
		start: new UnitVector3(start.x, start.y, start.z, "cnu"),
		end: new UnitVector3(end.x, end.y, end.z, "cnu"),
		payload,
		activateOnce,
	};
}

function normalizeObstacle(definition, index) {
	const source = normalizeObject(definition);
	const detail = normalizeObject(getByAlias(source, "detail.value", {}));
	const texture = normalizeTextureDescriptor(source, { textureID: "default-grid" }, `obstacle[${index}]`);
	const shape = normalizeShapeAlias(source, `obstacle[${index}]`);
	const complexity = normalizeGeometryComplexity(getByAlias(source, "geometry.complexity", undefined), `obstacle[${index}]`);
	const primitiveOptions = normalizePrimitiveOptions(source, `obstacle[${index}]`);

	const position = normalizeVector3WithWarning(
		getByAlias(source, "vector.position", undefined), 
		ToVector3(0), 
		`obstacle[${index}]`, "position"
	);
	const dimensions = normalizeVector3WithWarning(
		getByAlias(source, "vector.dimensions", undefined),
		ToVector3(1), 
		`obstacle[${index}]`, 
		"dimensions"
	);
	const rotation = normalizeVector3WithWarning(
		getByAlias(source, "vector.rotation", undefined), 
		ToVector3(0), 
		`obstacle[${index}]`, 
		"rotation"
	);
	const pivot = normalizeVector3WithWarning(
		getByAlias(source, "vector.pivot", undefined), 
		ToVector3(0), 
		`obstacle[${index}]`, 
		"pivot"
	);

	// Normalize optional parts for multi-part obstacles so builders can assume canonical shapes
	const parts = Array.isArray(source.parts)
		? source.parts.map((part, pIndex) => {
			const p = normalizeObject(part);
			const dims = NormalizeVector3(getByAlias(p, "vector.dimensionsCompact", undefined), ToVector3(1));
			const localPosition = NormalizeVector3(getByAlias(p, "entityPart.localPosition", undefined), ToVector3(0));
			const localRotation = NormalizeVector3(getByAlias(p, "entityPart.localRotation", undefined), ToVector3(0));
			const partTexture = normalizeTextureDescriptor(
				p, { textureID: "default-grid" }, 
				`obstacle[${index}].parts[${pIndex}]`
			);
			return {
				...p,
				id: normalizeString(p.id, `${normalizeString(source.id, `obstacle-${index}`)}-part-${pIndex}`),
				shape: normalizeShapeAlias(p, `obstacle[${index}].parts[${pIndex}]`),
				complexity: normalizeGeometryComplexity(getByAlias(p, "geometry.complexity", undefined), `obstacle[${index}].parts[${pIndex}]`),
				dimensions: new UnitVector3(dims.x, dims.y, dims.z, "cnu"),
				localPosition: new UnitVector3(localPosition.x, localPosition.y, localPosition.z, "cnu"),
				localRotation: new UnitVector3(
					localRotation.x, 
					localRotation.y, 
					localRotation.z, 
					"degrees"
				).toRadians(true),
				localScale: NormalizeVector3(p.localScale, ToVector3(1)),
				primitiveOptions: normalizePrimitiveOptions(p, `obstacle[${index}].parts[${pIndex}]`),
				texture: partTexture,
				detail: {
					...normalizeObject(p.detail),
					scatter: normalizeScatterForDetail(
						p, 
						normalizeObject(p.detail), 
						`obstacle[${index}].parts[${pIndex}]`
					),
				},
			};
		})
		: [];

	return {
		...source,
		id: normalizeString(source.id, `obstacle-${index}`),
		shape,
		complexity,
		collisionShape: normalizeObjectCollisionShape(source.collisionShape, "obb", `obstacle[${index}]`),
		position: new UnitVector3(position.x, position.y, position.z, "cnu"),
		dimensions: new UnitVector3(dimensions.x, dimensions.y, dimensions.z, "cnu"),
		rotation: new UnitVector3(rotation.x, rotation.y, rotation.z, "degrees").toRadians(true),
		scale: NormalizeVector3(source.scale, ToVector3(1)),
		pivot: new UnitVector3(pivot.x, pivot.y, pivot.z, "cnu"),
		primitiveOptions,
		texture,
		detail: {
			...detail,
			scatter: normalizeScatterForDetail(source, detail, `obstacle[${index}]`),
		},
		parts,
	};
}

// Mesh/Object normalization for builders
function normalizeColorDescriptor(color, contextPath, fallback = { r: 1, g: 1, b: 1, a: 1 }) {
	const source = normalizeObject(color);
	if (Object.keys(source).length === 0) return fallback;
	const r = ToNumber(getByAlias(source, "color.r", fallback.r), fallback.r);
	const g = ToNumber(getByAlias(source, "color.g", fallback.g), fallback.g);
	const b = ToNumber(getByAlias(source, "color.b", fallback.b), fallback.b);
	const a = ToNumber(getByAlias(source, "color.a", fallback.a), fallback.a);
	if ([r, g, b, a].some((v) => !Number.isFinite(v))) {
		warnLog(`Object payload ${contextPath} color malformed; defaulting to fallback.`);
		return fallback;
	}
	return { 
		r: Math.max(0, Math.min(1, r)), 
		g: Math.max(0, Math.min(1, g)), 
		b: Math.max(0, Math.min(1, b)), 
		a: Math.max(0, Math.min(1, a)) 
	};
}

function normalizeTextureShape(shape) {
	if (typeof shape !== "string") return null;
	const value = shape.trim().toLowerCase();
	return value.length > 0 ? value : null;
}

function normalizeTextureDescriptor(source, options, contextPath) {
	const src = normalizeObject(source);
	const textureCandidate = getByAlias(src, "texture.texture", null);
	const textureFromSource = textureCandidate && typeof textureCandidate === "object" ? textureCandidate : null;
	const shape = normalizeTextureShape(
		(textureFromSource && getByAlias(textureFromSource, "texture.shape", null))
	);

	const color = normalizeColorDescriptor(
		(textureFromSource && getByAlias(textureFromSource, "texture.color", null)) || 
		getByAlias(src, "texture.colorFallback", null) || 
		(options && options.defaultColor), contextPath + ".color"
	);

	const opacitySource = textureFromSource && typeof getByAlias(textureFromSource, "texture.opacity", undefined) === "number" 
		? getByAlias(textureFromSource, "texture.opacity", undefined)
		: getByAlias(src, "texture.opacityFallback", undefined);
	const opacity = ToNumber(opacitySource, 1);
	if (!Number.isFinite(opacity)) warnLog(`Object payload ${contextPath} texture.opacity malformed; defaulted to 1.`);

	let baseTextureID = (
		textureFromSource && 
		typeof getByAlias(textureFromSource, "texture.textureId", undefined) === "string" && 
		getByAlias(textureFromSource, "texture.textureId", undefined)
	)
		? getByAlias(textureFromSource, "texture.textureId", undefined)
		: (normalizeString(getByAlias(src, "texture.textureId", normalizeString(options && options.textureID, "default-grid")), normalizeString(options && options.textureID, "default-grid")));
	if (!Object.prototype.hasOwnProperty.call(visualTemplates.textures, baseTextureID)) {
		warnLog(`Object payload ${contextPath} unknown textureID '${baseTextureID}'; defaulted to 'default-grid'.`);
		baseTextureID = "default-grid";
	}
	const densitySource = textureFromSource && typeof getByAlias(textureFromSource, "texture.density", undefined) === "number" 
		? getByAlias(textureFromSource, "texture.density", undefined)
		: getByAlias(src, "texture.densityFallback", undefined);
	const speckSizeSource = textureFromSource && typeof getByAlias(textureFromSource, "texture.speckSize", undefined) === "number"
		? getByAlias(textureFromSource, "texture.speckSize", undefined)
		: getByAlias(src, "texture.speckSizeFallback", undefined);
	const animatedSource = textureFromSource && typeof getByAlias(textureFromSource, "texture.animated", undefined) === "boolean"
		? getByAlias(textureFromSource, "texture.animated", undefined)
		: getByAlias(src, "texture.animatedFallback", undefined);
	const holdTimeSpeedSource = textureFromSource && typeof getByAlias(textureFromSource, "texture.holdTimeSpeed", undefined) === "number"
		? getByAlias(textureFromSource, "texture.holdTimeSpeed", undefined)
		: getByAlias(src, "texture.holdTimeSpeedFallback", undefined);
	const blendTimeSpeedSource = textureFromSource && typeof getByAlias(textureFromSource, "texture.blendTimeSpeed", undefined) === "number"
		? getByAlias(textureFromSource, "texture.blendTimeSpeed", undefined)
		: getByAlias(src, "texture.blendTimeSpeedFallback", undefined);

	const materialTextureID = shape ? `${baseTextureID}::shape=${shape}` : baseTextureID;

	return {
		textureID: baseTextureID,
		baseTextureID: baseTextureID,
		materialTextureID: materialTextureID,
		shape: shape,
		color: color,
		opacity: Math.max(0, Math.min(1, ToNumber(opacity, 1))),
		density: Math.max(0, ToNumber(densitySource, 1)),
		speckSize: Math.max(0.1, ToNumber(speckSizeSource, 1)),
		animated: animatedSource === true,
		holdTimeSpeed: Math.max(0.05, Math.min(10, ToNumber(holdTimeSpeedSource, 1))),
		blendTimeSpeed: Math.max(0.05, Math.min(10, ToNumber(blendTimeSpeedSource, 1))),
	};
}

function normalizeScatterRequests(source, contextPath) {
	if (!source || !Array.isArray(source)) return [];
	const out = [];
	for (let i = 0; i < source.length; i += 1) {
		const entry = source[i];
		if (!entry || typeof entry !== "object") {
			warnLog(`Object payload ${contextPath}[${i}] malformed scatter entry dropped.`);
			continue;
		}
		const typeID = normalizeString(getByAlias(entry, "scatter.typeID", ""), "");
		if (typeID.length === 0) {
			warnLog(`Object payload ${contextPath}[${i}] scatter missing typeID; entry dropped.`);
			continue;
		}
		const densityValue = getByAlias(entry, "scatter.density", 0);
		out.push({ typeID: typeID, density: Math.max(0, ToNumber(densityValue, 0)) });
	}
	return out;
}

function buildDefaultEntityModel(source, entityId) {
	const rotation = NormalizeVector3(getByAlias(source, "vector.rotation", undefined), ToVector3(0));
	const dimensions = NormalizeVector3(getByAlias(source, "vector.dimensionsShort", undefined), ToVector3(1));
	const shape = normalizeShapeAlias(source, `${entityId}.defaultModelPart`);
	const texture = normalizeTextureDescriptor(source, { textureID: "default-grid", defaultColor: { r: 0.9, g: 0.35, b: 0.35, a: 1 } }, `${entityId}.defaultModelPart`);
	const spawnSurfaceId = normalizeString(getByAlias(source, "entity.spawnSurfaceId", ""), "");
	return {
		spawnSurfaceId: spawnSurfaceId.length > 0 ? spawnSurfaceId : null,
		rootTransform: {
			position: new UnitVector3(0, 0, 0, "cnu"),
			rotation: new UnitVector3(rotation.x, rotation.y, rotation.z, "degrees").toRadians(true),
			scale: NormalizeVector3(source.scale, ToVector3(1)),
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
				shape: shape,
				complexity: "medium",
				dimensions: new UnitVector3(dimensions.x, dimensions.y, dimensions.z, "cnu"),
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

function normalizeEntityRootTransform(rootTransform, source) {
	const transform = normalizeObject(rootTransform);
	const sourceRotation = NormalizeVector3(getByAlias(source, "vector.rotationBasic", undefined), ToVector3(0));
	const position = NormalizeVector3(getByAlias(transform, "transform.position", undefined), ToVector3(0));
	const rotation = NormalizeVector3(getByAlias(transform, "vector.rotation", undefined), sourceRotation);
	const pivot = NormalizeVector3(getByAlias(transform, "vector.pivot", undefined), ToVector3(0));
	const scaleSource = getByAlias(transform, "transform.scale", undefined);
	const fallbackScaleSource = getByAlias(source, "transform.scale", ToVector3(1));

	return {
		...transform,
		position: new UnitVector3(position.x, position.y, position.z, "cnu"),
		rotation: new UnitVector3(rotation.x, rotation.y, rotation.z, "degrees").toRadians(true),
		scale: NormalizeVector3(scaleSource, NormalizeVector3(fallbackScaleSource, ToVector3(1))),
		pivot: new UnitVector3(pivot.x, pivot.y, pivot.z, "cnu"),
	};
}

function normalizeEntityModelPart(part, entityId, index) {
	const source = normalizeObject(part);
	const dimensions = NormalizeVector3(getByAlias(source, "vector.dimensionsCompact", undefined), ToVector3(1));
	const localPosition = NormalizeVector3(getByAlias(source, "entityPart.localPosition", undefined), ToVector3(0));
	const localRotation = NormalizeVector3(getByAlias(source, "entityPart.localRotation", undefined), ToVector3(0));
	const texture = normalizeTextureDescriptor(source, { textureID: "default-grid" }, `${entityId}.parts[${index}]`);
	const shape = normalizeShapeAlias(source, `${entityId}.parts[${index}]`);
	const complexity = normalizeGeometryComplexity(getByAlias(source, "geometry.complexity", undefined), `${entityId}.parts[${index}]`);
	const pivot = normalizeVector3WithWarning(getByAlias(source, "vector.pivot", undefined), ToVector3(0), `${entityId}.parts[${index}]`, "pivot");
	const primitiveOptions = normalizePrimitiveOptions(source, `${entityId}.parts[${index}]`);
	const parentId = normalizeString(getByAlias(source, "entityPart.parentId", "root"), "root");
	const defaultAnchorPoint = parentId === "root" ? "bottom" : "center";

	return {
		...source,
		id: normalizeString(source.id, `${entityId}-part-${index}`),
		shape: shape,
		complexity: complexity,
		parentId: parentId,
		anchorPoint: normalizeEntityFace(
			getByAlias(source, "entityPart.anchorPoint", defaultAnchorPoint),
			defaultAnchorPoint,
			`${entityId}.parts[${index}]`,
			"anchorPoint"
		),
		attachmentPoint: normalizeEntityFace(
			getByAlias(source, "entityPart.attachmentPoint", "top"),
			"top",
			`${entityId}.parts[${index}]`,
			"attachmentPoint"
		),
		localPosition: new UnitVector3(localPosition.x, localPosition.y, localPosition.z, "cnu"),
		localRotation: new UnitVector3(localRotation.x, localRotation.y, localRotation.z, "degrees").toRadians(true),
		localScale: NormalizeVector3(getByAlias(source, "entityPart.localScale", undefined), ToVector3(1)),
		dimensions: new UnitVector3(dimensions.x, dimensions.y, dimensions.z, "cnu"),
		pivot: new UnitVector3(pivot.x, pivot.y, pivot.z, "cnu"),
		rotation: new UnitVector3(0, 0, 0, "radians"),
		scale: ToVector3(1),
		position: new UnitVector3(0, 0, 0, "cnu"),
		primitiveOptions: primitiveOptions,
		texture: texture,
		detail: { scatter: [] },
		textureID: texture.textureID,
		textureColor: texture.color,
		textureOpacity: texture.opacity,
	};
}

function normalizeEntityModel(model, source, entityId, blueprint) {
	const modelSource = normalizeObject(model);
	const partDefinitions = normalizeArray(modelSource.parts);
	const modelSpawnSurfaceId = normalizeString(getByAlias(modelSource, "entity.spawnSurfaceId", ""), "");
	const sourceSpawnSurfaceId = normalizeString(getByAlias(source, "entity.spawnSurfaceId", ""), "");
	if (partDefinitions.length === 0) {
		const blueprintModel = normalizeObject(blueprint && blueprint.model);
		const blueprintSpawnSurfaceId = normalizeString(getByAlias(blueprintModel, "entity.spawnSurfaceId", ""), "");
		const blueprintParts = normalizeArray(blueprintModel.parts);
		if (blueprintParts.length > 0) {
			const resolvedRootTransform =
				modelSource.rootTransform ||
				blueprintModel.rootTransform ||
				source.rootTransform ||
				null;

			return {
				...blueprintModel,
				...modelSource,
				spawnSurfaceId: modelSpawnSurfaceId || sourceSpawnSurfaceId || blueprintSpawnSurfaceId || null,
				rootTransform: normalizeEntityRootTransform(resolvedRootTransform, source),
				parts: blueprintParts.map((part, index) => normalizeEntityModelPart(part, entityId, index)),
			};
		}

		return buildDefaultEntityModel(source, entityId);
	}

	return {
		...modelSource,
		spawnSurfaceId: modelSpawnSurfaceId || sourceSpawnSurfaceId || null,
		rootTransform: normalizeEntityRootTransform(modelSource.rootTransform, source),
		parts: partDefinitions.map((part, index) => normalizeEntityModelPart(part, entityId, index)),
	};
}

function normalizePlayerModelParts(player) {
	const source = normalizeObject(player);
	const sourceModel = normalizeObject(source.model);
	const directParts = normalizeArray(getByAlias(source, "entity.parts", []));
	const modelParts = normalizeArray(getByAlias(sourceModel, "entity.parts", []));
	const selectedParts = directParts.length > 0 ? directParts : modelParts;
	return selectedParts.map((part, index) => normalizeEntityModelPart(part, "player", index));
}

function hasOwn(source, key) {
	return Object.prototype.hasOwnProperty.call(source, key);
}

function resolveStringField(source, blueprint, key, fallback, contextPath, aliases = []) {
	const sourceValue = getAliasValue(source, [key, ...aliases], undefined);
	if (sourceValue !== undefined) {
		if (typeof sourceValue === "string" && sourceValue.length > 0) return sourceValue;
		warnLog(`Entity payload ${contextPath} '${key}' malformed; using blueprint/default fallback.`);
	}

	const blueprintValue = getAliasValue(blueprint, [key, ...aliases], undefined);
	if (typeof blueprintValue === "string" && blueprintValue.length > 0) return blueprintValue;
	return fallback;
}

function resolveNumberField(source, blueprint, key, fallback, contextPath, aliases = []) {
	const sourceValue = getAliasValue(source, [key, ...aliases], undefined);
	if (sourceValue !== undefined) {
		const value = ToNumber(sourceValue, NaN);
		if (Number.isFinite(value)) return value;
		warnLog(`Entity payload ${contextPath} '${key}' malformed; using blueprint/default fallback.`);
	}

	const blueprintValue = ToNumber(getAliasValue(blueprint, [key, ...aliases], undefined), NaN);
	if (Number.isFinite(blueprintValue)) return blueprintValue;
	return fallback;
}

function resolveBooleanField(source, blueprint, key, fallback, contextPath, aliases = []) {
	const sourceValue = getAliasValue(source, [key, ...aliases], undefined);
	if (sourceValue !== undefined) {
		if (typeof sourceValue === "boolean") return sourceValue;
		warnLog(`Entity payload ${contextPath} '${key}' malformed; using blueprint/default fallback.`);
	}

	const blueprintValue = getAliasValue(blueprint, [key, ...aliases], undefined);
	if (typeof blueprintValue === "boolean") return blueprintValue;
	return fallback;
}

function resolveVector3Field(sourceValue, blueprintValue, fallback, contextPath, fieldName) {
	if (sourceValue !== undefined) {
		if (isVector3Like(sourceValue)) return NormalizeVector3(sourceValue, fallback);
		warnLog(`Entity payload ${contextPath} '${fieldName}' malformed; using blueprint/default fallback.`);
	}

	if (isVector3Like(blueprintValue)) return NormalizeVector3(blueprintValue, fallback);
	return NormalizeVector3(undefined, fallback);
}

function resolveArrayField(source, blueprint, key, contextPath) {
	if (hasOwn(source, key)) {
		if (Array.isArray(source[key])) return source[key];
		warnLog(`Entity payload ${contextPath} '${key}' malformed; using blueprint/default fallback.`);
	}

	if (Array.isArray(blueprint[key])) return blueprint[key];
	return [];
}

function resolveObjectField(source, blueprint, key, contextPath) {
	if (hasOwn(source, key)) {
		if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) return source[key];
		warnLog(`Entity payload ${contextPath} '${key}' malformed; using blueprint/default fallback.`);
	}

	const blueprintValue = blueprint[key];
	if (blueprintValue && typeof blueprintValue === "object" && !Array.isArray(blueprintValue)) return blueprintValue;
	return {};
}

function normalizeEntityData(source, entityId, blueprint) {
	const blueprintSource = normalizeObject(blueprint);
	const entityType = resolveStringField(source, blueprintSource, "type", "entity", entityId, ["entityType", "typeName"]);
	const movementSource = normalizeObject(getByAlias(source, "entity.movement", {}));
	const blueprintMovement = normalizeObject(getByAlias(blueprintSource, "entity.movement", {}));
	const movementStart = resolveVector3Field(
		getByAlias(movementSource, "vector.start", undefined),
		getByAlias(blueprintMovement, "vector.start", undefined),
		ToVector3(0),
		entityId,
		"movement.start"
	);
	const movementEnd = resolveVector3Field(
		getByAlias(movementSource, "vector.end", undefined),
		getByAlias(blueprintMovement, "vector.end", undefined),
		movementStart,
		entityId,
		"movement.end"
	);
	const velocityVector = resolveVector3Field(
		getByAlias(source, "entity.velocity", undefined),
		getByAlias(blueprintSource, "entity.velocity", undefined),
		ToVector3(0),
		entityId,
		"velocity"
	);

	// Ensure top-level entity rootTransform (level overrides) are canonical UnitVector3 instances.
	// Builders assume `rootTransform.position`/`rotation` are UnitVector3 and call `.clone()`/.set()
	if (source.rootTransform && typeof source.rootTransform === "object") {
		const rt = normalizeObject(source.rootTransform);
		const rtPos = NormalizeVector3(rt.position, ToVector3(0));
		const rtRot = NormalizeVector3(rt.rotation, ToVector3(0));
		const rtScale = NormalizeVector3(rt.scale, ToVector3(1));
		const rtPivot = NormalizeVector3(rt.pivot, ToVector3(0));
		source.rootTransform = {
			...rt,
			position: new UnitVector3(rtPos.x, rtPos.y, rtPos.z, "cnu"),
			rotation: new UnitVector3(rtRot.x, rtRot.y, rtRot.z, "degrees").toRadians(true),
			scale: rtScale,
			pivot: new UnitVector3(rtPivot.x, rtPivot.y, rtPivot.z, "cnu"),
		};
	}

	return {
		...source,
		id: entityId,
		type: entityType,
		movement: {
			...movementSource,
			start: new UnitVector3(movementStart.x, movementStart.y, movementStart.z, "cnu"),
			end: new UnitVector3(movementEnd.x, movementEnd.y, movementEnd.z, "cnu"),
			repeat: resolveBooleanField(movementSource, blueprintMovement, "repeat", true, `${entityId}.movement`, ["loop"]),
			backAndForth: resolveBooleanField(movementSource, blueprintMovement, "backAndForth", true, `${entityId}.movement`, ["pingPong", "yoyo"]),
			speed: new Unit(
				Math.max(0, resolveNumberField(movementSource, blueprintMovement, "speed", 0, `${entityId}.movement`, ["moveSpeed", "velocity", "maxSpeed"])),
				"cnu"
			),
			jump: new Unit(
				Math.max(0, resolveNumberField(movementSource, blueprintMovement, "jump", 0, `${entityId}.movement`, ["jumpStrength", "jumpHeight"])),
				"cnu"
			),
			jumpInterval: Math.max(0, resolveNumberField(movementSource, blueprintMovement, "jumpInterval", 0, `${entityId}.movement`, ["jumpDelay", "jumpCooldown"])),
			jumpOnSight: resolveBooleanField(movementSource, blueprintMovement, "jumpOnSight", false, `${entityId}.movement`, ["jumpOnSee", "jumpOnPlayer"]),
			disappear: resolveBooleanField(movementSource, blueprintMovement, "disappear", false, `${entityId}.movement`),
			chase: resolveBooleanField(movementSource, blueprintMovement, "chase", false, `${entityId}.movement`),
			physics: resolveBooleanField(movementSource, blueprintMovement, "physics", false, `${entityId}.movement`),
		},
		hp: Math.max(0, resolveNumberField(source, blueprintSource, "hp", 1, entityId, ["health", "hitPoints", "life"])),
		simRadiusPadding: Math.max(0, resolveNumberField(source, blueprintSource, "simRadiusPadding", 8, entityId, ["simDistancePadding"])),
		attacks: (() => {
			const sourceAttacks = getByAlias(source, "entity.attacks", undefined);
			const blueprintAttacks = getByAlias(blueprintSource, "entity.attacks", undefined);
			if (Array.isArray(sourceAttacks)) return sourceAttacks;
			if (Array.isArray(blueprintAttacks)) return blueprintAttacks;
			return [];
		})(),
		hardcoded: normalizeObject(resolveObjectField(source, blueprintSource, "hardcoded", entityId)),
		platform: getByAlias(source, "entity.platform", getByAlias(blueprintSource, "entity.platform", null)),
		animations: normalizeObject(resolveObjectField(source, blueprintSource, "animations", entityId)),
		velocity: new UnitVector3(velocityVector.x, velocityVector.y, velocityVector.z, "cnu"),
		collisionCapsule: normalizeObject(resolveObjectField(source, blueprintSource, "collisionCapsule", entityId)),
		collisionOverride: normalizeEntityCollisionOverride(
			resolveObjectField(source, blueprintSource, "collisionOverride", entityId),
			entityType,
			entityId
		),
		model: normalizeEntityModel(source.model, source, entityId, blueprint),
	};
}

function normalizeEntity(definition, index, blueprintMap) {
	const source = normalizeObject(definition);
	const entityId = normalizeString(getByAlias(source, "entity.id", `entity-${index}`), `entity-${index}`);
	const blueprintId = normalizeString(getByAlias(source, "entity.blueprintId", ""), "");
	const blueprint = blueprintId.length > 0 ? normalizeObject(blueprintMap[blueprintId]) : null;
	return normalizeEntityData(source, entityId, blueprint);
}

function normalizeBlueprintEntry(definition, index, prefix) {
	const source = normalizeObject(definition);
	const entityId = normalizeString(getByAlias(source, "entity.id", `${prefix}-${index}`), `${prefix}-${index}`);
	return normalizeEntityData(source, entityId);
}

function normalizeBlueprintList(list, prefix) {
	const source = Array.isArray(list) ? list : [];
	const normalized = [];
	for (let index = 0; index < source.length; index++) {
		normalized.push(normalizeBlueprintEntry(source[index], index, prefix));
	}
	return normalized;
}

function buildBlueprintMap(blueprintSet) {
	const map = {};
	const register = (list) => {
		for (let index = 0; index < list.length; index++) {
			const entry = list[index];
			if (entry && typeof entry.id === "string" && entry.id.length > 0) map[entry.id] = entry;
		}
	};

	register(normalizeArray(blueprintSet.enemies));
	register(normalizeArray(blueprintSet.npcs));
	register(normalizeArray(blueprintSet.collectibles));
	register(normalizeArray(blueprintSet.projectiles));
	register(normalizeArray(blueprintSet.entities));

	return map;
}

function LevelPayload(payload) {
	const source = normalizeObject(payload);
	const terrain = normalizeObject(getByAlias(source, "level.terrain", {}));
	const blueprintSource = normalizeObject(getByAlias(source, "level.entityBlueprints", {}));
	const metaSource = normalizeObject(source.meta);
	const terrainObjects = normalizeArray(getByAlias(terrain, "level.objects", []));
	const terrainTriggers = normalizeArray(getByAlias(terrain, "level.triggers", []));
	const obstacles = normalizeArray(getByAlias(source, "level.obstacles", []));
	const entities = normalizeArray(getByAlias(source, "level.entities", []));
	const normalizedBlueprints = {
		...blueprintSource,
		enemies: normalizeBlueprintList(blueprintSource.enemies, "enemy-blueprint"),
		npcs: normalizeBlueprintList(blueprintSource.npcs, "npc-blueprint"),
		collectibles: normalizeBlueprintList(blueprintSource.collectibles, "collectible-blueprint"),
		projectiles: normalizeBlueprintList(blueprintSource.projectiles, "projectile-blueprint"),
		entities: normalizeBlueprintList(blueprintSource.entities, "entity-blueprint"),
	};
	const blueprintMap = buildBlueprintMap(normalizedBlueprints);

	return {
		...source,
		terrain: {
			...terrain,
			objects: terrainObjects.map((entry, index) => normalizeTerrainObject(entry, index)),
			triggers: terrainTriggers.map((entry, index) => normalizeTrigger(entry, index)),
		},
		obstacles: obstacles.map((entry, index) => normalizeObstacle(entry, index)),
		entities: entities.map((entry, index) => normalizeEntity(entry, index, blueprintMap)),
		entityBlueprints: normalizedBlueprints,
		meta: {
			...metaSource,
			levelId: normalizeString(getByAlias(metaSource, "meta.levelId", normalizeString(source.id, "unknown")), normalizeString(source.id, "unknown")),
			stageId: normalizeString(getByAlias(metaSource, "meta.stageId", normalizeString(source.id, "unknown")), normalizeString(source.id, "unknown")),
		},
		world: worldConfig(source.world),
		camera: cameraConfig(source.camera),
		player: playerConfig(source.player),
	};
}

function worldConfig(world) {
	const source = normalizeObject(world);
	const length = Math.max(1, ToNumber(getByAlias(source, "world.length", 100), 100));
	const width = Math.max(1, ToNumber(getByAlias(source, "world.width", 100), 100));
	const height = Math.max(1, ToNumber(getByAlias(source, "world.height", 40), 40));
	const deathBarrierY = ToNumber(getByAlias(source, "world.deathBarrierY", -25), -25);
	const resolvedWaterLevel = resolveWaterLevel(source, deathBarrierY, height);

	return {
		length: new Unit(length, "cnu"),
		width: new Unit(width, "cnu"),
		height: new Unit(height, "cnu"),
		deathBarrierY: new Unit(deathBarrierY, "cnu"),
		waterLevel: resolvedWaterLevel === null ? null : new Unit(resolvedWaterLevel, "cnu"),
		textureScale: Math.max(0.05, ToNumber(getByAlias(source, "world.textureScale", 1), 1)),
		scatterScale: Math.max(0.05, ToNumber(getByAlias(source, "world.scatterScale", 1), 1)),
	};
}

function resolveWaterLevel(source, deathBarrierY, worldHeight) {
	if (!hasByAlias(source, "world.waterLevel")) return null;

	const level = Number(getByAlias(source, "world.waterLevel", null));
	if (!Number.isFinite(level)) {
		warnLog("World waterLevel was malformed and has been normalized to null.");
		return null;
	}

	if (level < deathBarrierY || level > worldHeight) {
		warnLog("World waterLevel was outside world bounds and has been normalized to null.");
		return null;
	}

	return level;
}

function cameraConfig(camera) {
	const source = normalizeObject(camera);
	const levelOpening = normalizeObject(getByAlias(source, "camera.levelOpening", {}));
	const openStart = NormalizeVector3(
		getByAlias(levelOpening, "camera.startPosition", undefined),
		{ x: 0, y: 40, z: 80 }
	);
	const openEnd = NormalizeVector3(
		getByAlias(levelOpening, "camera.endPosition", undefined),
		{ x: 0, y: 40, z: 80 }
	);

	return {
		mode: "stationary",
		levelOpening: {
			startPosition: new UnitVector3(openStart.x, openStart.y, openStart.z, "cnu"),
			endPosition: new UnitVector3(openEnd.x, openEnd.y, openEnd.z, "cnu"),
		},
		distance: new Unit(ToNumber(getByAlias(source, "camera.distance", 10), 10), "cnu"),
		sensitivity: ToNumber(getByAlias(source, "camera.sensitivity", 0.12), 0.12),
		heightOffset: new Unit(ToNumber(getByAlias(source, "camera.heightOffset", 3), 3), "cnu"),
	};
}

function playerConfig(player) {
	const fallback = {
		character: "carl",
		spawnPosition: ToVector3(0),
		scale: ToVector3(1)
	}

	const source = normalizeObject(player);
	const spawnPos = NormalizeVector3(getByAlias(source, "player.spawnPosition", undefined), fallback.spawnPosition);
	const modelParts = normalizePlayerModelParts(source);
	
	// Normalize optional meta overrides provided by payload (do not instantiate Units here;
	// character.meta in characters.json uses plain numbers and builders expect raw numbers)
	const rawMeta = normalizeObject(getByAlias(source, "player.meta", {}));
	const metaOverrides = {};
	const metaKeys = Object.keys(rawMeta);
	for (let i = 0; i < metaKeys.length; i += 1) {
		const key = metaKeys[i];
		const val = rawMeta[key];
		if (isVector3Like(val)) metaOverrides[key] = NormalizeVector3(val, ToVector3(0));
		else if (typeof val === 'number' || (!isNaN(Number(val)) && val !== null && val !== undefined)) {
			const n = ToNumber(val, NaN);
			if (Number.isFinite(n)) metaOverrides[key] = n;
		} 
		else if (typeof val === 'boolean' || typeof val === 'string') metaOverrides[key] = val;
	}
	// Provide a canonical list of override strings so downstream modules can rely
	// on a normalized, presence-guaranteed array instead of doing defensive checks.
	// Each entry is formatted for logging (e.g. "key: value").
	const metaList = [];
	const rawMetaKeys2 = Object.keys(rawMeta);
	for (let i2 = 0; i2 < rawMetaKeys2.length; i2 += 1) {
		const k = rawMetaKeys2[i2];
		const v = metaOverrides[k];
		let sval;
		try {
			sval = (typeof v === "object") ? JSON.stringify(v) : String(v);
		} catch (e) {
			sval = String(v);
		}
		metaList.push(`${k}: ${sval}`);
	}
	metaOverrides.list = metaList;
	const characterSource = getByAlias(source, "entity.character", undefined);
	const resolvedCharacter = typeof characterSource === "string" && characterSource.length > 0
		? characterSource.toLowerCase()
		: fallback.character;

	return {
		character: resolvedCharacter,
		spawnPosition: new UnitVector3(spawnPos.x, spawnPos.y, spawnPos.z, "cnu"),
		scale: NormalizeVector3(getByAlias(source, "player.scale", undefined), ToVector3(1)),
		modelParts: modelParts,
		metaOverrides: metaOverrides,
	}
}

export default { 
	MenuUIPayload, 
	SplashPayload,
	CutscenePayload,
	LevelPayload,
};
