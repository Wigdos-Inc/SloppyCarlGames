
// Listens for data from the game, receives their payload and destination, and checks if incoming data suffices.
// Throws error if data doesn't suffice. Can pass on data to any module the data belongs to.


import { Log } from "./meta.js";
import Normalize from "./normalize.js";

// Example valid payloads
const exampleMenuUIPayload = {};

const exampleLevelPayload = {};

function isObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUnit(value, expectedType) {
	if (!isObject(value)) {
		return false;
	}
	if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
		return false;
	}
	if (expectedType && value.type !== expectedType) {
		return false;
	}
	return true;
}

function isUnitVector3(value, expectedType) {
	if (!isObject(value)) {
		return false;
	}
	if (typeof value.x !== "number" || !Number.isFinite(value.x)) {
		return false;
	}
	if (typeof value.y !== "number" || !Number.isFinite(value.y)) {
		return false;
	}
	if (typeof value.z !== "number" || !Number.isFinite(value.z)) {
		return false;
	}
	if (expectedType && value.type !== expectedType) {
		return false;
	}
	return true;
}

function validateNormalizedUIElementTree(element, path) {
	if (!isObject(element)) {
		Log("ENGINE", `UI payload normalization produced invalid element at '${path}'.`, "error", "Validation");
		return false;
	}

	if (!Array.isArray(element.children)) {
		Log("ENGINE", `UI payload normalization produced invalid children array at '${path}.children'.`, "error", "Validation");
		return false;
	}

	if (!isObject(element.events)) {
		Log("ENGINE", `UI payload normalization produced invalid events map at '${path}.events'.`, "error", "Validation");
		return false;
	}

	if (!isObject(element.on)) {
		Log("ENGINE", `UI payload normalization produced invalid on map at '${path}.on'.`, "error", "Validation");
		return false;
	}

	for (let index = 0; index < element.children.length; index += 1) {
		if (!validateNormalizedUIElementTree(element.children[index], `${path}.children[${index}]`)) {
			return false;
		}
	}

	return true;
}

function validateNormalizedWorld(world) {
	return (
		isObject(world)
		&& isUnit(world.length, "cnu")
		&& isUnit(world.width, "cnu")
		&& isUnit(world.height, "cnu")
		&& isUnit(world.deathBarrierY, "cnu")
		&& (world.waterLevel === null || isUnit(world.waterLevel, "cnu"))
		&& typeof world.textureScale === "number"
		&& Number.isFinite(world.textureScale)
		&& typeof world.scatterScale === "number"
		&& Number.isFinite(world.scatterScale)
	);
}

function validateNormalizedCamera(camera) {
	return (
		isObject(camera)
		&& camera.mode === "stationary"
		&& isObject(camera.levelOpening)
		&& isUnitVector3(camera.levelOpening.startPosition, "cnu")
		&& isUnitVector3(camera.levelOpening.endPosition, "cnu")
		&& isUnit(camera.distance, "cnu")
		&& isUnit(camera.heightOffset, "cnu")
		&& typeof camera.sensitivity === "number"
		&& Number.isFinite(camera.sensitivity)
	);
}

function validateNormalizedPlayer(player) {
	return (
		isObject(player)
		&& typeof player.character === "string"
		&& player.character.length > 0
		&& isUnitVector3(player.spawnPosition, "cnu")
		&& isObject(player.scale)
		&& typeof player.scale.x === "number"
		&& Number.isFinite(player.scale.x)
		&& typeof player.scale.y === "number"
		&& Number.isFinite(player.scale.y)
		&& typeof player.scale.z === "number"
		&& Number.isFinite(player.scale.z)
	);
}

function isVector3(value) {
	return (
		isObject(value)
		&& typeof value.x === "number"
		&& Number.isFinite(value.x)
		&& typeof value.y === "number"
		&& Number.isFinite(value.y)
		&& typeof value.z === "number"
		&& Number.isFinite(value.z)
	);
}

function validateBlueprintList(list, key) {
	if (!Array.isArray(list)) {
		Log(
			"ENGINE", 
			`Level payload normalization failed: entityBlueprints.${key} must be an array.`, 
			"error", 
			"Validation"
		);
		return false;
	}

	for (let index = 0; index < list.length; index += 1) {
		const entry = list[index];
		if (!isObject(entry) || typeof entry.id !== "string" || entry.id.length === 0) {
			Log(
				"ENGINE", 
				`Level payload normalization failed: entityBlueprints.${key}[${index}] must be an object with a string id.`, 
				"error", 
				"Validation"
			);
			return false;
		}
	}

	return true;
}

function validateNormalizedLevelCollections(payload) {
	if (!Array.isArray(payload.terrain.objects)) {
		Log("ENGINE", "Level payload normalization failed: terrain.objects must be an array.", "error", "Validation");
		return false;
	}

	if (!Array.isArray(payload.terrain.triggers)) {
		Log("ENGINE", "Level payload normalization failed: terrain.triggers must be an array.", "error", "Validation");
		return false;
	}

	for (let index = 0; index < payload.terrain.objects.length; index += 1) {
		const object = payload.terrain.objects[index];
		if (!isObject(object) || typeof object.id !== "string" || !isVector3(object.position) || !isVector3(object.dimensions) || !isVector3(object.scale)) {
			Log(
				"ENGINE", 
				`Level payload normalization failed: terrain.objects[${index}] must include id, position, dimensions, and scale.`, 
				"error", 
				"Validation"
			);
			return false;
		}
	}

	for (let index = 0; index < payload.terrain.triggers.length; index += 1) {
		const trigger = payload.terrain.triggers[index];
		if (!isObject(trigger) || typeof trigger.id !== "string" || trigger.id.length === 0 || typeof trigger.type !== "string" || trigger.type.length === 0 || !isVector3(trigger.start) || !isVector3(trigger.end)) {
			Log(
				"ENGINE", 
				`Level payload normalization failed: terrain.triggers[${index}] must include id, type, and start/end vectors.`, 
				"error", 
				"Validation"
			);
			return false;
		}

		if (!isObject(trigger.payload)) {
			Log(
				"ENGINE", 
				`Level payload normalization failed: terrain.triggers[${index}].payload must normalize to an object.`, 
				"error", 
				"Validation"
			);
			return false;
		}

		if (typeof trigger.activateOnce !== "boolean") {
			Log(
				"ENGINE", 
				`Level payload normalization failed: terrain.triggers[${index}].activateOnce must normalize to a boolean.`, 
				"error", 
				"Validation"
			);
			return false;
		}
	}

	if (!Array.isArray(payload.obstacles)) {
		Log("ENGINE", "Level payload normalization failed: obstacles must be an array.", "error", "Validation");
		return false;
	}

	for (let index = 0; index < payload.obstacles.length; index += 1) {
		const obstacle = payload.obstacles[index];
		if (!isObject(obstacle) || typeof obstacle.id !== "string" || !isVector3(obstacle.position) || !isVector3(obstacle.dimensions) || !isVector3(obstacle.scale)) {
			Log(
				"ENGINE", 
				`Level payload normalization failed: obstacles[${index}] must include id, position, dimensions, and scale.`, 
				"error", 
				"Validation"
			);
			return false;
		}
	}

	if (!Array.isArray(payload.entities)) {
		Log("ENGINE", "Level payload normalization failed: entities must be an array.", "error", "Validation");
		return false;
	}

	for (let index = 0; index < payload.entities.length; index += 1) {
		const entity = payload.entities[index];
		if (
			!isObject(entity)
			|| typeof entity.id !== "string"
			|| typeof entity.type !== "string"
			|| !isObject(entity.movement)
			|| !isVector3(entity.movement.start)
			|| !isVector3(entity.movement.end)
			|| !isObject(entity.model)
			|| !Array.isArray(entity.model.parts)
			|| entity.model.parts.length === 0
			|| !isVector3(entity.velocity)
			|| !Array.isArray(entity.attacks)
			|| !isObject(entity.hardcoded)
			|| !isObject(entity.animations)
		) {
			Log(
				"ENGINE", 
				`Level payload normalization failed: entities[${index}] is missing required normalized fields.`, 
				"error", 
				"Validation"
			);
			return false;
		}
	}

	if (!isObject(payload.entityBlueprints)) {
		Log("ENGINE", "Level payload normalization failed: entityBlueprints must be an object.", "error", "Validation");
		return false;
	}

	if (!validateBlueprintList(payload.entityBlueprints.enemies, "enemies")) return false;
	if (!validateBlueprintList(payload.entityBlueprints.npcs, "npcs")) return false;
	if (!validateBlueprintList(payload.entityBlueprints.collectibles, "collectibles")) return false;
	if (!validateBlueprintList(payload.entityBlueprints.projectiles, "projectiles")) return false;
	if (!validateBlueprintList(payload.entityBlueprints.entities, "entities")) return false;

	return true;
}


function ValidateMenuUIPayload(payload) {
	const errors = [];
	if (!isObject(payload)) {
		errors.push("payload must be an object");
	} 
	else {
		if (typeof payload.screenId !== "string" || payload.screenId.length === 0) {
			errors.push("'screenId' must be a non-empty string");
		}
		if (!Array.isArray(payload.elements)) {
			errors.push("'elements' must be an array");
		}
	}

	if (errors.length > 0) {
		Log("ENGINE", `Invalid Payload. Example valid menuUI payload: \n${JSON.stringify(exampleMenuUIPayload, null, 2)}`, "error", "Validation");
		Log("ENGINE", `Menu UI payload rejected:\n\n${errors.join("\n")}.`, "error", "Validation");
		return null;
	}

	payload = Normalize.MenuUIPayload(payload);
	if (!isObject(payload) || !Array.isArray(payload.elements) || typeof payload.rootId !== "string") {
		Log("ENGINE", "Menu UI payload normalization failed to produce required top-level shape.", "error", "Validation");
		return null;
	}

	for (let index = 0; index < payload.elements.length; index += 1) {
		if (!validateNormalizedUIElementTree(payload.elements[index], `elements[${index}]`)) {
			return null;
		}
	}
	
    return payload;
}


function ValidateLevelPayload(payload) {
	const errors = [];
	const validateRawTrigger = (trigger, index) => {
		if (!isObject(trigger)) {
			errors.push(`'terrain.triggers[${index}]' must be an object`);
			return;
		}

		if (typeof trigger.id !== "string" || trigger.id.length === 0) {
			errors.push(`'terrain.triggers[${index}].id' must be a non-empty string`);
		}

		if (typeof trigger.type !== "string" || trigger.type.length === 0) {
			errors.push(`'terrain.triggers[${index}].type' must be a non-empty string`);
		}

		if (!isVector3(trigger.start)) {
			errors.push(`'terrain.triggers[${index}].start' must be a vector3`);
		}

		if (!isVector3(trigger.end)) {
			errors.push(`'terrain.triggers[${index}].end' must be a vector3`);
		}
	};

	if (!isObject(payload)) {
		errors.push("payload must be an object");
	} else {
		if (typeof payload.id !== "string" || payload.id.length === 0) {
			errors.push("'id' must be a non-empty string");
		}
		if (typeof payload.title !== "string" || payload.title.length === 0) {
			errors.push("'title' must be a non-empty string");
		}
		if (!isObject(payload.world)) {
			errors.push("'world' must be an object");
		}
		if (!isObject(payload.terrain)) {
			errors.push("'terrain' must be an object");
		} else {
			if (!Array.isArray(payload.terrain.objects)) {
				errors.push("'terrain.objects' must be an array");
			}
			if (!Array.isArray(payload.terrain.triggers)) {
				errors.push("'terrain.triggers' must be an array");
			} else {
				for (let index = 0; index < payload.terrain.triggers.length; index += 1) {
					validateRawTrigger(payload.terrain.triggers[index], index);
				}
			}
		}
		if (!Array.isArray(payload.obstacles)) {
			errors.push("'obstacles' must be an array");
		}
		if (!Array.isArray(payload.entities)) {
			errors.push("'entities' must be an array");
		}
		if (!isObject(payload.entityBlueprints)) {
			errors.push("'entityBlueprints' must be an object");
		}
		if (!isObject(payload.meta)) {
			errors.push("'meta' must be an object");
		}
	}

	if (errors.length > 0) {
		Log("ENGINE", `Invalid Payload. Example valid level payload: \n${JSON.stringify(exampleLevelPayload, null, 2)}`, "error", "Validation");
		Log("ENGINE", `Level payload rejected:\n\n${errors.join("\n")}.`, "error", "Validation");
		return null;
	}

	payload = Normalize.LevelPayload(payload);

	if (!validateNormalizedWorld(payload.world)) {
		Log("ENGINE", "Level payload normalization failed: invalid normalized world config.", "error", "Validation");
		return null;
	}

	if (!validateNormalizedCamera(payload.camera)) {
		Log("ENGINE", "Level payload normalization failed: invalid normalized camera config.", "error", "Validation");
		return null;
	}

	if (!validateNormalizedPlayer(payload.player)) {
		Log("ENGINE", "Level payload normalization failed: invalid normalized player config.", "error", "Validation");
		return null;
	}

	if (!validateNormalizedLevelCollections(payload)) {
		return null;
	}

	if (!isObject(payload.meta) || typeof payload.meta.levelId !== "string" || typeof payload.meta.stageId !== "string") {
		Log("ENGINE", "Level payload normalization failed: meta.levelId and meta.stageId must resolve to strings.", "error", "Validation");
		return null;
	}

    return payload;
}



export { ValidateMenuUIPayload, ValidateLevelPayload };