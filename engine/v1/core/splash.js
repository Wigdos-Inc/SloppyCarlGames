// Splash screen sequencing for built-in engine startup visuals.

/* === IMPORTS === */
// Rendering, audio, and event dispatch.

import {
	FadeElement,
	RemoveRoot,
	SetElementSource,
} from "../handlers/Render.js";
import { PlaySfx, PlayVoice } from "../handlers/Sound.js";
import { log, sendEvent } from "./meta.js";

/* === SEQUENCE === */
// Runs the built-in splash and transitions to the title screen.

function setupSplashSequence() {
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

function getCarlStudiosSequence() {
	return [
		{
			name: "Carl Studios",
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

async function runSequenceSteps(sequence, context) {
	for (let index = 0; index < sequence.length; index += 1) {
		const step = sequence[index];
		if (step.name) {
			log(
				"ENGINE",
				`Splash stage start: ${step.name}.`,
				"log",
				"Startup"
			);
		}

		if (step.image) {
			SetElementSource(context.imageId, step.image);
		}

		if (step.sfx && step.sfx.src) {
			PlaySfx(step.sfx.src, step.sfx.options);
		}

		if (step.voiceAtStart && step.voice && step.voice.src) {
			PlayVoice(step.voice.src, step.voice.options);
		}

		if (typeof step.fadeInSeconds === "number") {
			await FadeElement(context.imageId, 1, step.fadeInSeconds);
		}

		if (typeof step.holdMs === "number") {
			await context.wait(step.holdMs);
		}

		if (!step.voiceAtStart && step.voice && step.voice.src) {
			await PlayVoice(step.voice.src, step.voice.options);
		}

		if (typeof step.fadeOutSeconds === "number") {
			await FadeElement(context.imageId, 0, step.fadeOutSeconds);
		}

		if (index < sequence.length - 1) {
			await context.wait(1000);
		}
	}
}

async function RunSplashSequence() {
	const context = setupSplashSequence();
	const providers = [
		getCarlStudiosSequence,
		getWigdosStudiosSequence,
		getCarlNetEngineSequence,
	];
	const steps = providers.flatMap((provider) => provider());

	await context.wait(1000);
	await runSequenceSteps(steps, context);

	await context.wait(1000);

	await FadeElement(context.overlayId, 0, 1);
	RemoveRoot(context.overlayId);
	sendEvent("TitleScreen");
}

/* === EXPORTS === */
// Public splash sequence for Bootup.

export { RunSplashSequence };
