// Test game intro cinematic handler.
// Listens for the engine intro request and provides Opening.mp4.

import { ENGINE } from "../../Bootup.js";

function handleCutsceneRequest(event) {
	const payload = event && event.detail ? event.detail.payload : null;
	if (!payload || payload.cutsceneId !== "Opening") {
		return;
	}

	const introSrc = new URL("./rendered/Opening.mp4", import.meta.url).href;

	if (ENGINE && typeof ENGINE.Log === "function") {
		ENGINE.Log(
			"GAME",
			"Sent Intro cinematic Payload: Opening.mp4",
			"log",
			"Cutscene"
		);
	}

	if (ENGINE && ENGINE.Startup && typeof ENGINE.Startup.PlayIntroCinematic === "function") {
		ENGINE.Startup.PlayIntroCinematic(introSrc);
	}
}

window.addEventListener("CUTSCENE_REQUEST", handleCutsceneRequest);
