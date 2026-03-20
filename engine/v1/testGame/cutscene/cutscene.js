// Test game intro cinematic handler.
// Listens for the engine intro request and provides Opening.mp4.

import { Log } from "../../core/meta.js";
import { ENGINE } from "../../Bootup.js";

function playIntroCinematic(event) {
	if (!event.detail || event.detail.cutsceneId !== "Opening") {
		return;
	}

	const introSrc = new URL("./rendered/Opening.mp4", import.meta.url).href;

	Log(
		"GAME",
		"Sent Intro cinematic Payload: Opening.mp4",
		"log",
		"Cutscene"
	);

	ENGINE.Startup.PlayIntroCinematic(introSrc);
}

window.addEventListener("CUTSCENE_REQUEST", playIntroCinematic);