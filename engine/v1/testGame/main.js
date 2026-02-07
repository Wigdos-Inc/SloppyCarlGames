// Entry point for the test game. Importing Bootup auto-starts the engine.

console.log("Importing Engine");

const { ENGINE } = await import("../Bootup.js");
await import("./menus/ui.js");

void ENGINE;
