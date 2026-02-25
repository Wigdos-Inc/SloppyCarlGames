
// Listens for data from the game, receives their payload and destination, and checks if incoming data suffices.
// Throws error if data doesn't suffice. Can pass on data to any module the data belongs to.


import { Log } from "./meta.js";

// Example valid payloads
const exampleMenuUIPayload = {};

const exampleLevelPayload = {};


function ValidateMenuUIPayload(payload) {
	if (!payload || typeof payload !== "object" || typeof payload.screenId !== "string" || !Array.isArray(payload.elements)) {
		Log("ENGINE", `Invalid Payload. Example valid menuUI payload: \n${JSON.stringify(exampleMenuUIPayload, null, 2)}`, "error", "Validation");
		return null;
	}
	
    return payload;
}


function ValidateLevelPayload(payload) {
	if (
		!payload || typeof payload !== "object" ||
		typeof payload.id !== "string" || typeof payload.title !== "string" ||
		!payload.world || typeof payload.world !== "object" ||
		!payload.terrain || typeof payload.terrain !== "object" ||
		!Array.isArray(payload.obstacles) ||
		!Array.isArray(payload.entities) ||
		!payload.entityBlueprints || typeof payload.entityBlueprints !== "object" ||
		!payload.meta || typeof payload.meta !== "object"
	) {
		Log("ENGINE", `Invalid Payload. Example valid level payload: \n${JSON.stringify(exampleLevelPayload, null, 2)}`, "error", "Validation");
		return null;
	}
	
    return payload;
}



export { ValidateMenuUIPayload, ValidateLevelPayload };