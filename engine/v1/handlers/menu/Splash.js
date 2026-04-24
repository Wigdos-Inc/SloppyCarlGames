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
	const definitions = [];
	const ids = [];

	step.elements.forEach((source) => {
		definitions.push({
			...source,
			id: source.id,
		});
		ids.push(source.id);
	});

	step.text.forEach((text) => {
		definitions.push({
			type: text.type,
			id: text.id,
			className: text.className,
			text: text.content,
			attributes: text.attributes,
			styles: text.styles,
			events: {},
			on: {},
			children: [],
		});
		ids.push(text.id);
	});

	return { definitions, ids };
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


// Splash steps for Sloppy Carl Games.
function getCarlStudiosSequence() {
	return [
		{
			name: "Sloppy Carl Games",
			image: new URL(
				"../../assets/carlStudios/sloppyCarl.png",
				import.meta.url
			).href,
			sfx: {
				src: new URL("../../assets/carlStudios/splat.mp3", import.meta.url)
					.href,
				options: { id: "SPLAT", rate: 1.5 },
			},
			voice: {
				src: new URL("../../assets/carlStudios/sloppyCarl.mp3", import.meta.url)
					.href,
				options: { id: "SLOPPY_CARL" },
			},
			voiceAtStart: false,
			fadeInSeconds: 0.3,
			holdMs: 600,
			fadeOutSeconds: 1,
			elements: [],
			text: [],
		},
	];
}

// Splash steps for Wigdos Studios Inc.
function getWigdosStudiosSequence() {
	return [
		{
			name: "Wigdos Studios Inc",
			image: new URL(
				"../../assets/wigdosStudios/wigdosPublisher.png",
				import.meta.url
			).href,
			sfx: null,
			voice: null,
			voiceAtStart: false,
			fadeInSeconds: 0.5,
			holdMs: 2000,
			fadeOutSeconds: 1,
			elements: [],
			text: [],
		},
	];
}

// Splash steps for CarlNet Engine.
function getCarlNetEngineSequence() {
	return [
		{
			name: "CarlNet Engine",
			image: new URL(
				"../../assets/engine/carlNetEngine.png",
				import.meta.url
			).href,
			voice: {
				src: new URL("../../assets/engine/carlNetEngine.mp3", import.meta.url)
					.href,
				options: { id: "CARLNET_ENGINE" },
			},
			voiceAtStart: true,
			sfx: null,
			fadeInSeconds: 0.3,
			holdMs: 2500,
			fadeOutSeconds: 1,
			elements: [],
			text: [],
		},
	];
}

function getDefaultSequence() {
	const providers = [
		getCarlStudiosSequence,
		getWigdosStudiosSequence,
		getCarlNetEngineSequence,
	];

	return providers.flatMap((provider) => provider());
}

function getBuiltInSequenceById(presetId) {
	switch (presetId) {
		case "sloppycarl": return getCarlStudiosSequence();
		case "wigdos"    : return getWigdosStudiosSequence();
		case "carlnet"   : return getCarlNetEngineSequence();
		case "default"   : return getDefaultSequence();
		default          : return getDefaultSequence();
	}
}

function resolveSplashSteps(requestedSplashPayload) {
	if (!requestedSplashPayload) return getDefaultSequence();

	// Allow canonical default payloads to explicitly indicate the engine default
	if (requestedSplashPayload.outputType === "default") return getDefaultSequence();

	if (requestedSplashPayload.presetId) return getBuiltInSequenceById(requestedSplashPayload.presetId);

	return requestedSplashPayload.sequence;
}

// Execute each splash step in order.
async function runSequenceSteps(sequence, context) {
	for (let index = 0; index < sequence.length; index++) {
		const step = sequence[index];
		Log(
			"ENGINE",
			`Splash stage start: ${step.name}.`,
			"log",
			"Startup"
		);

		SetElementSource(context.imageId, step.image);
		renderSplashStepElements(step, context, index);

		// Initialize supplemental elements to fully transparent so they can fade with the image.
		context.supplementalElementIds.forEach((id) => SetElementStyle(id, { opacity: "0" }));

		if (step.sfx !== null) PlayAudio(step.sfx.src, step.sfx.options, "Sfx");
		if (step.voiceAtStart) PlayAudio(step.voice.src, step.voice.options, "Voice");

		// Fade image and supplemental elements together.
		const fadeInPromises = [FadeElement(context.imageId, 1, step.fadeInSeconds)];
		context.supplementalElementIds.forEach((id) => fadeInPromises.push(FadeElement(id, 1, step.fadeInSeconds)));
		await Promise.all(fadeInPromises);

		await Wait(step.holdMs);

		if (!step.voiceAtStart && step.voice !== null) await PlayAudio(step.voice.src, step.voice.options, "Voice");

		// Fade image and supplemental elements out together.
		const fadeOutPromises = [FadeElement(context.imageId, 0, step.fadeOutSeconds)];
		context.supplementalElementIds.forEach((id) => fadeOutPromises.push(FadeElement(id, 0, step.fadeOutSeconds)));
		await Promise.all(fadeOutPromises);
		removeSplashSupplementalElements(context);

		// Pause between splash steps.
		if (index < sequence.length - 1) await Wait(1000);
	}
}

async function runSplashSequence(requestedSplashPayload) {
	// Build the full splash sequence pipeline.
	const context = {
		overlayId: "engine-startup-overlay",
		imageId: "engine-splash-image",
		supplementalElementIds: [],
	};

	if (CONFIG.DEBUG.SKIP.Splash === true || ReadFromSession(SESSION_KEYS.SplashPlayed, false) === true) {
		Log("ENGINE", "Splash scren sequence skipped.", "log", "Startup");
		return context;
	}
	const steps = resolveSplashSteps(requestedSplashPayload);

	// Initial pacing before the first splash.
	await context.wait(1000);
	await runSequenceSteps(steps, context);

	// Final pacing after splash(es).
	await context.wait(1000);
	PushToSession(SESSION_KEYS.SplashPlayed, true);

	return context;
}

function AcceptSplashPayload() {
	splashRequested = true;
	bufferedSplashPayload = null;
}

function DeclineSplashPayload() {
	splashRequested = false;
}

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
	DeclineSplashPayload();

	// Validate (and normalize) buffered splash payload.
	let payload = ValidateSplashPayload(bufferedSplashPayload);
	if (payload === null) {
		Log("ENGINE", "Splash.ApplySplashScreenSequence falling back to default sequence after validation failure.", "error", "Startup");
		payload = { outputType: "default", presetId: null, sequence: [] };
	}

	// Log whether this is a custom sequence, a preset, or the default using normalized outputType.
	switch (payload.outputType) {
		case "custom": {
			const names = payload.sequence.map((s, i) => s.name ? `${i + 1}:${s.name}` : `${i + 1}:<unnamed>`).join("\n- ");
			Log("ENGINE", `Using custom splash payload with ${payload.sequence.length} step(s):\n- ${names}`, "log", "Startup");
			break;
		}
		case "preset": {
			const preset = payload.presetId;
			const seq = getBuiltInSequenceById(preset);
			const names = seq.map((s, i) => s.name ? `${i + 1}:${s.name}` : `${i + 1}:<unnamed>`).join("\n- ");
			Log("ENGINE", `Using preset splashId='${preset}'. Preset order:\n- ${names}`, "log", "Startup");
			break;
		}
		default:
			Log("ENGINE", "Using default splash sequence.", "log", "Startup");
	}

	// Start Sequence
	options.onSequenceStart();
	return runSplashSequence(payload);
}

/* === EXPORTS === */
// Public splash sequence for Bootup.

export { ApplySplashScreenSequence, ProvideSplashScreenPayload, AcceptSplashPayload };
