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

async function RunSplashSequence() {
	const startupOverlayId = "engine-startup-overlay";
	const startupImageId = "engine-splash-image";
	const sloppyCarlImage = new URL(
		"../assets/carlStudios/sloppyCarl.png",
		import.meta.url
	).href;
	const splatSound = new URL(
		"../assets/carlStudios/splat.mp3",
		import.meta.url
	).href;
	const sloppyCarlAudio = new URL(
		"../assets/carlStudios/sloppyCarl.mp3",
		import.meta.url
	).href;

	const wait = (milliseconds) =>
		new Promise((resolve) => {
			setTimeout(resolve, milliseconds);
		});

	log("ENGINE", "Splash stage 1/3 start: Carl Studios.", "log", "Startup");

	SetElementSource(startupImageId, sloppyCarlImage);
	PlaySfx(splatSound, { id: "SPLAT", rate: 1.5 });
	await FadeElement(startupImageId, 1, 0.3);

	await wait(600);
	await PlayVoice(sloppyCarlAudio, { id: "SLOPPY_CARL" });

	await FadeElement(startupImageId, 0, 1);
	sendEvent("TitleScreen");
	await FadeElement(startupOverlayId, 0, 0.6);
	RemoveRoot(startupOverlayId);
}

/* === EXPORTS === */
// Public splash sequence for Bootup.

export { RunSplashSequence };
