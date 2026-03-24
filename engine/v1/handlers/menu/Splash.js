// Splash screen sequence for engine startup.

// Used by Bootup.js
// Uses Render.js

// Splash screen sequencing for built-in engine startup visuals.

/* === IMPORTS === */
// Rendering, audio, and event dispatch.

import {
	FadeElement,
	SetElementSource,
} from "../Render.js";
import { PlaySfx, PlayVoice } from "../Sound.js";
import { Log, PushToSession, ReadFromSession, SendEvent, SESSION_KEYS } from "../../core/meta.js";
import { CONFIG } from "../../core/config.js";
import { ValidateSplashPayload } from "../../core/validate.js";

let pendingSplashResolve = null;

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
		wait: wait,
	};
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

	if (requestedSplashPayload.presetId) {
		return getBuiltInSequenceById(requestedSplashPayload.presetId);
	}

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

		if (step.sfx !== null) PlaySfx(step.sfx.src, step.sfx.options);

		if (step.voiceAtStart) PlayVoice(step.voice.src, step.voice.options);

		await FadeElement(context.imageId, 1, step.fadeInSeconds);

		await context.wait(step.holdMs);

		if (!step.voiceAtStart && step.voice !== null) await PlayVoice(step.voice.src, step.voice.options);

		await FadeElement(context.imageId, 0, step.fadeOutSeconds);

		// Pause between splash steps.
		if (index < sequence.length - 1) await context.wait(1000);
	}
}

async function runSplashSequence(requestedSplashPayload) {
	// Build the full splash sequence pipeline.
	const context = setupSplashSequence();

	if (
		(CONFIG.DEBUG.SKIP.Splash === true) ||
		ReadFromSession(SESSION_KEYS.SplashPlayed, false) === true
	) {
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

function requestSplashPayload(timeoutMs) {
	SendEvent("SPLASH_REQUEST", { timeoutMs: timeoutMs });

	return new Promise((resolve) => {
		const finish = (payload) => {
			pendingSplashResolve = null;
			clearTimeout(timeoutId);
			resolve(payload);
		};

		pendingSplashResolve = finish;
		const timeoutId = setTimeout(() => finish(null), timeoutMs);
	});
}

function ProvideSplashScreenPayload(payload) {
	if (!pendingSplashResolve) {
		Log("ENGINE", "No splash screens were requested. Ignoring payload.", "warn", "Startup");
		return false;
	}

	pendingSplashResolve(payload);
	return true;
}

async function ApplySplashScreenSequence(options) {
	const rawPayload = await requestSplashPayload(options.timeoutMs);
	const payload = ValidateSplashPayload(rawPayload);
	return runSplashSequence(payload);
}

/* === EXPORTS === */
// Public splash sequence for Bootup.

export { ApplySplashScreenSequence, ProvideSplashScreenPayload };
