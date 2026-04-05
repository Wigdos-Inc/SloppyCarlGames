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
import { PlaySfx, PlayVoice } from "../Sound.js";
import { Log, PushToSession, ReadFromSession, SESSION_KEYS } from "../../core/meta.js";
import { CONFIG } from "../../core/config.js";
import { ValidateSplashPayload } from "../../core/validate.js";

let splashRequested = false;
let bufferedSplashPayload = null;

/* === SEQUENCE === */
// Runs the built-in splash and transitions to the title screen.

function setupSplashSequence() {
	// Provide shared context for splash sequencing.
	const wait = (milliseconds) =>
		new Promise((resolve) => {
			setTimeout(resolve, milliseconds);
		});

	return {
		overlayId: "engine-startup-overlay",
		imageId: "engine-splash-image",
		supplementalElementIds: [],
		wait: wait,
	};
}

function removeSplashSupplementalElements(context) {
	for (let index = 0; index < context.supplementalElementIds.length; index++) {
		const id = context.supplementalElementIds[index];
		const element = document.getElementById(id);
		element.parentNode.removeChild(element);
	}

	context.supplementalElementIds = [];
}

function buildSplashStepElements(step, stepIndex) {
	const definitions = [];
	const ids = [];

	for (let index = 0; index < step.elements.length; index++) {
		const source = step.elements[index];
		const elementId = source.id;

		definitions.push({
			...source,
			id: elementId,
		});
		ids.push(elementId);
	}

	const textEntries = step.text;
	for (let index = 0; index < textEntries.length; index++) {
		const text = textEntries[index];
		const elementId = text.id;

		definitions.push({
			type: text.type,
			id: elementId,
			className: text.className,
			text: text.content,
			attributes: text.attributes,
			styles: text.styles,
			events: {},
			on: {},
			children: [],
		});
		ids.push(elementId);
	}

	return { definitions, ids };
}

function renderSplashStepElements(step, context, stepIndex) {
	removeSplashSupplementalElements(context);
	const { definitions, ids } = buildSplashStepElements(step, stepIndex);
	if (definitions.length === 0) return;

	CreateUI({
		screenId: `EngineSplashStep${stepIndex}`,
		rootId: context.overlayId,
		replace: false,
		elements: definitions,
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
		for (let i = 0; i < context.supplementalElementIds.length; i++) {
			SetElementStyle(context.supplementalElementIds[i], { opacity: "0" });
		}

		if (step.sfx !== null) PlaySfx(step.sfx.src, step.sfx.options);

		if (step.voiceAtStart) PlayVoice(step.voice.src, step.voice.options);

		// Fade image and supplemental elements together.
		const fadeInPromises = [FadeElement(context.imageId, 1, step.fadeInSeconds)];
		for (let i = 0; i < context.supplementalElementIds.length; i++) {
			fadeInPromises.push(FadeElement(context.supplementalElementIds[i], 1, step.fadeInSeconds));
		}
		await Promise.all(fadeInPromises);

		await context.wait(step.holdMs);

		if (!step.voiceAtStart && step.voice !== null) await PlayVoice(step.voice.src, step.voice.options);

		// Fade image and supplemental elements out together.
		const fadeOutPromises = [FadeElement(context.imageId, 0, step.fadeOutSeconds)];
		for (let i = 0; i < context.supplementalElementIds.length; i++) {
			fadeOutPromises.push(FadeElement(context.supplementalElementIds[i], 0, step.fadeOutSeconds));
		}
		await Promise.all(fadeOutPromises);
		removeSplashSupplementalElements(context);

		// Pause between splash steps.
		if (index < sequence.length - 1) await context.wait(1000);
	}
}

async function runSplashSequence(requestedSplashPayload) {
	// Build the full splash sequence pipeline.
	const context = setupSplashSequence();

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
	const payload = ValidateSplashPayload(bufferedSplashPayload);

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
