// Test game intro cinematic handler.
// Listens for the engine intro request and provides Opening.mp4.

function playIntroCinematic(event) {
	if (!event.detail || event.detail.cutsceneId !== "Opening") {
		return;
	}

	const introSrc = new URL("./rendered/Opening.mp4", import.meta.url).href;

	ENGINE.Log(
		"GAME",
		"Sent Intro cinematic Payload: Opening.mp4",
		"log",
		"Cutscene"
	);

	ENGINE.Startup.PlayIntroCinematic({
		source: introSrc,
	}, "rendered");
}

window.addEventListener("INTRO_CINEMATIC_REQUEST", playIntroCinematic);