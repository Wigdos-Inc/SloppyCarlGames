// Entry point for the test game. Importing Bootup auto-starts the engine.

console.log("Importing Engine");

const { ENGINE } = await import("../Bootup.js");
await import("./menus/ui.js");
await import("./cutscene/cutscene.js");

function handleUserInput(event) {
	const payload = event && event.detail ? event.detail.payload : null;
	if (ENGINE && typeof ENGINE.Log === "function") {
		ENGINE.Log(
			"GAME",
			`USER_INPUT received: ${payload && payload.type ? payload.type : "unknown"}`,
			"log",
			"Controls"
		);
	}
}

window.addEventListener("USER_INPUT", handleUserInput);

void ENGINE;
