// Splash screen sequence for engine startup.

// Used by Bootup.js
// Uses Render.js

// Splash screen sequencing for built-in engine startup visuals.

/* === IMPORTS === */
// Rendering, audio, and event dispatch.

import {
	FadeElement,
	SetElementSource,
	SetElementStyle,
} from "../Render.js";
import { CreateUI } from "../UI.js";
import { PlayAudio } from "../Sound.js";
import { Log, PushToSession, ReadFromSession, SESSION_KEYS, Wait } from "../../core/meta.js";
import { CONFIG } from "../../core/config.js";
import { ValidateSplashPayload } from "../../core/validate.js";
import { NormalizeImage } from "../../core/normalize.js";

class splashSequenceStep {
	constructor(rawStep) {
		this.name           = rawStep.name;
		this.image          = rawStep.image;
		this.sfx            = rawStep.sfx;
		this.voice          = rawStep.voice;
		this.voiceAtStart   = rawStep.voiceAtStart;
		this.fadeInSeconds  = rawStep.fadeInSeconds;
		this.holdMs         = rawStep.holdMs;
		this.fadeOutSeconds = rawStep.fadeOutSeconds;
		this.elements       = rawStep.elements;
		this.text           = rawStep.text;

		this.estimatedLength = (this.fadeInSeconds * 1000) + this.holdMs + (this.fadeOutSeconds * 1000);
		this._preloadPromise = NormalizeImage(this.image, "splash", "html");
	}

	async play(context, stepIndex) {
		this.imageData = await this._preloadPromise;
		const resolvedUrl = this.imageData.bool ? this.imageData.value.url : this.image;

		Log("ENGINE", `Splash stage start: ${this.name}.`, "log", "Startup");

		SetElementSource(context.imageId, resolvedUrl);
		renderSplashStepElements(this, context, stepIndex);

		context.supplementalElementIds.forEach((id) => SetElementStyle(id, { opacity: "0" }));

		if (this.sfx !== null) PlayAudio(this.sfx.src, this.sfx.options, "Sfx");
		if (this.voiceAtStart) PlayAudio(this.voice.src, this.voice.options, "Voice");

		const fadeInPromises = [FadeElement(context.imageId, 1, this.fadeInSeconds)];
		context.supplementalElementIds.forEach((id) => fadeInPromises.push(FadeElement(id, 1, this.fadeInSeconds)));
		await Promise.all(fadeInPromises);

		await Wait(this.holdMs);

		if (!this.voiceAtStart && this.voice !== null) await PlayAudio(this.voice.src, this.voice.options, "Voice");

		const fadeOutPromises = [FadeElement(context.imageId, 0, this.fadeOutSeconds)];
		context.supplementalElementIds.forEach((id) => fadeOutPromises.push(FadeElement(id, 0, this.fadeOutSeconds)));
		await Promise.all(fadeOutPromises);
		removeSplashSupplementalElements(context);
	}
}

const splashData = {
	order: [],
	steps: {},
	baseLength: 0,
	waitAction(length) {
		return Wait(length);
	},
};

splashData.steps["Sloppy Carl Games"] = new splashSequenceStep({
	name: "Sloppy Carl Games",
	image: new URL("../../assets/carlStudios/sloppyCarl.png", import.meta.url).href,
	sfx: {
		src: new URL("../../assets/carlStudios/splat.mp3", import.meta.url).href,
		options: { id: "SPLAT", rate: 1.5 },
	},
	voice: {
		src: new URL("../../assets/carlStudios/sloppyCarl.mp3", import.meta.url).href,
		options: { id: "SLOPPY_CARL" },
	},
	voiceAtStart: false,
	fadeInSeconds: 0.3,
	holdMs: 600,
	fadeOutSeconds: 1,
	elements: [],
	text: [],
});

splashData.steps["Wigdos Studios Inc"] = new splashSequenceStep({
	name: "Wigdos Studios Inc",
	image: new URL("../../assets/wigdosStudios/wigdosPublisher.png", import.meta.url).href,
	sfx: null,
	voice: null,
	voiceAtStart: false,
	fadeInSeconds: 0.5,
	holdMs: 2000,
	fadeOutSeconds: 1,
	elements: [],
	text: [],
});

splashData.steps["CarlNet Engine"] = new splashSequenceStep({
	name: "CarlNet Engine",
	image: new URL("../../assets/engine/carlNetEngine.png", import.meta.url).href,
	sfx: null,
	voice: {
		src: new URL("../../assets/engine/carlNetEngine.mp3", import.meta.url).href,
		options: { id: "CARLNET_ENGINE" },
	},
	voiceAtStart: true,
	fadeInSeconds: 0.3,
	holdMs: 2500,
	fadeOutSeconds: 1,
	elements: [],
	text: [],
});

let splashRequested = false;
let bufferedSplashPayload = null;

function removeSplashSupplementalElements(context) {
	context.supplementalElementIds.forEach((id) => {
		const element = document.getElementById(id);
		element.parentNode.removeChild(element);
	});
	context.supplementalElementIds = [];
}

function buildSplashStepElements(step) {
	const elements = [];
	const ids = [];

	step.elements.forEach((source) => {
		elements.push({
			...source,
			id: source.id,
		});
		ids.push(source.id);
	});

	step.text.forEach((text) => {
		elements.push({
			type      : text.type,
			id        : text.id,
			className : text.className,
			text      : text.content,
			attributes: text.attributes,
			styles    : text.styles,
			events    : {},
			on        : {},
			children  : [],
		});
		ids.push(text.id);
	});

	return { elements, ids };
}

function renderSplashStepElements(step, context, stepIndex) {
	removeSplashSupplementalElements(context);
	const { elements, ids } = buildSplashStepElements(step);
	if (elements.length === 0) return;

	CreateUI({
		screenId: `EngineSplashStep${stepIndex}`,
		rootId: context.overlayId,
		replace: false,
		elements,
	});

	context.supplementalElementIds = ids;
}

function resolveOrder(requestedSplashPayload) {
	splashData.order = [];

	switch (requestedSplashPayload.outputType) {
		case "default": splashData.order.push("Sloppy Carl Games", "Wigdos Studios Inc", "CarlNet Engine"); break;
		case "preset": {
			const presetKeyMap = {
				sloppycarl: "Sloppy Carl Games",
				wigdos:     "Wigdos Studios Inc",
				carlnet:    "CarlNet Engine",
			};
			requestedSplashPayload.presetId.forEach((id) => splashData.order.push(presetKeyMap[id]));
			break;
		}
		default:
			requestedSplashPayload.sequence.forEach((rawStep) => {
				const step = new splashSequenceStep(rawStep);
				splashData.steps[step.name] = step;
				splashData.order.push(step.name);
			});
			break;
	}

	splashData.baseLength = (splashData.order.length + 1) * 1000;
}

async function runSplashSequence(requestedSplashPayload) {
	const context = {
		overlayId: "engine-startup-overlay",
		imageId: "engine-splash-image",
		supplementalElementIds: [],
	};

	if (CONFIG.DEBUG.SKIP.Splash === true || ReadFromSession(SESSION_KEYS.SplashPlayed, false) === true) {
		Log("ENGINE", "Splash screen sequence skipped.", "log", "Startup");
		return context;
	}

	resolveOrder(requestedSplashPayload);

	const names = splashData.order.map((k, i) => `${i + 1}:${k}`).join("\n- ");
	switch (requestedSplashPayload.outputType) {
		case "custom":
			Log("ENGINE", `Using custom splash payload with ${splashData.order.length} step(s):\n- ${names}`, "log", "Startup");
			break;
		case "preset":
			Log("ENGINE", `Using preset splashId='${requestedSplashPayload.presetId.join(", ")}'. Preset order:\n- ${names}`, "log", "Startup");
			break;
		default: Log("ENGINE", "Using default splash sequence.", "log", "Startup");
	}

	const stepTotal = splashData.order.reduce((sum, k) => sum + splashData.steps[k].estimatedLength, 0);
	Log("ENGINE", `Estimated splash sequence length: ${stepTotal + splashData.baseLength + 1000}ms`, "log", "Startup");

	await splashData.waitAction(1000);

	for (let i = 0; i < splashData.order.length; i++) {
		await splashData.steps[splashData.order[i]].play(context, i);
		if (i < splashData.order.length - 1) await splashData.waitAction(1000);
	}

	await splashData.waitAction(1000);

	PushToSession(SESSION_KEYS.SplashPlayed, true);
	return context;
}

const AcceptSplashPayload = () => { splashRequested = true; bufferedSplashPayload = null };
const declineSplashPayload = () => splashRequested = false;

function ProvideSplashScreenPayload(payload) {
	if (!splashRequested) {
		Log("ENGINE", "No splash screens were requested. Ignoring payload.", "warn", "Startup");
		return false;
	}

	bufferedSplashPayload = payload;
	Log("ENGINE", `Buffered splash payload received.`, "log", "Startup");
	return true;
}

async function ApplySplashScreenSequence(options) {
	// Stop accepting payloads immediately as splash sequence is about to start.
	declineSplashPayload();

	// Validate (and normalize) buffered splash payload.
	let payload;
	if (!CONFIG.DEBUG.SKIP.Splash) {
		payload = ValidateSplashPayload(bufferedSplashPayload);
		if (payload === null) {
			Log("ENGINE", "Splash.ApplySplashScreenSequence falling back to default sequence after validation failure.", "error", "Startup");
			payload = { outputType: "default", presetId: null, sequence: [] };
		}
	}
	else payload = { outputType: "default", presetId: null, sequence: [] };

	// Start Sequence
	options.onSequenceStart();
	return runSplashSequence(payload);
}

/* === EXPORTS === */
// Public splash sequence for Bootup.

export { ApplySplashScreenSequence, ProvideSplashScreenPayload, AcceptSplashPayload };
