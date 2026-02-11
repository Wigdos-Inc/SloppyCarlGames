// Splash screen sequencing for built-in engine startup visuals.

/* === IMPORTS === */
// Rendering, audio, and event dispatch.

import {
	FadeElement,
	SetElementSource,
} from "../handlers/Render.js";
import { PlaySfx, PlayVoice } from "../handlers/Sound.js";
import { Log, pushToSession, readFromSession, SESSION_KEYS } from "./meta.js";
import { CONFIG } from "./config.js";

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
				"../assets/carlStudios/sloppyCarl.png",
				import.meta.url
			).href,
			sfx: {
				src: new URL("../assets/carlStudios/splat.mp3", import.meta.url)
					.href,
				options: { id: "SPLAT", rate: 1.5 },
			},
			voice: {
				src: new URL("../assets/carlStudios/sloppyCarl.mp3", import.meta.url)
					.href,
				options: { id: "SLOPPY_CARL" },
			},
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
				"../assets/wigdosStudios/wigdosPublisher.png",
				import.meta.url
			).href,
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
				"../assets/engine/carlNetEngine.png",
				import.meta.url
			).href,
			voice: {
				src: new URL("../assets/engine/carlNetEngine.mp3", import.meta.url)
					.href,
				options: { id: "CARLNET_ENGINE" },
			},
			voiceAtStart: true,
			fadeInSeconds: 0.3,
			holdMs: 2500,
			fadeOutSeconds: 1,
		},
	];
}

// Execute each splash step in order.
async function runSequenceSteps(sequence, context) {
	for (let index = 0; index < sequence.length; index += 1) {
		const step = sequence[index];
		if (step.name) {
			Log(
				"ENGINE",
				`Splash stage start: ${step.name}.`,
				"log",
				"Startup"
			);
		}

		// Swap the splash image when provided.
		if (step.image) {
			SetElementSource(context.imageId, step.image);
		}

		// Play SFX tied to the splash stage.
		if (step.sfx && step.sfx.src) {
			PlaySfx(step.sfx.src, step.sfx.options);
		}

		// Trigger voice-over at the start of a step.
		if (step.voiceAtStart && step.voice && step.voice.src) {
			PlayVoice(step.voice.src, step.voice.options);
		}

		// Fade in the splash image.
		if (typeof step.fadeInSeconds === "number") {
			await FadeElement(context.imageId, 1, step.fadeInSeconds);
		}

		// Hold the image on screen.
		if (typeof step.holdMs === "number") {
			await context.wait(step.holdMs);
		}

		// Play voice-over after the hold.
		if (!step.voiceAtStart && step.voice && step.voice.src) {
			await PlayVoice(step.voice.src, step.voice.options);
		}

		if (typeof step.fadeOutSeconds === "number") {
			// Fade out the splash image.
			await FadeElement(context.imageId, 0, step.fadeOutSeconds);
		}

		// Pause between splash steps.
		if (index < sequence.length - 1) {
			await context.wait(1000);
		}
	}
}

async function RunSplashSequence() {
	// Build the full splash sequence pipeline.
	const context = setupSplashSequence();
	const skipSplash =
		(CONFIG && CONFIG.DEBUG && CONFIG.DEBUG.SKIP && CONFIG.DEBUG.SKIP.Splash === true) ||
		readFromSession(SESSION_KEYS.SplashPlayed, false) === true;

	if (skipSplash) {
		Log("ENGINE", "Splash skipped.", "log", "Startup");
		return context;
	}
	const providers = [
		getCarlStudiosSequence,
		getWigdosStudiosSequence,
		getCarlNetEngineSequence,
	];
	const steps = providers.flatMap((provider) => provider());

	// Initial pacing before the first splash.
	await context.wait(1000);
	await runSequenceSteps(steps, context);

	// Final pacing after splash(es).
	await context.wait(1000);
	pushToSession(SESSION_KEYS.SplashPlayed, true);

	return context;
}

/* === EXPORTS === */
// Public splash sequence for Bootup.

export { RunSplashSequence };
