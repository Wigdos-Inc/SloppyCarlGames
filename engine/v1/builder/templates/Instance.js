// Boot-time Unit-instancing of engine-owned template JSON, run after ini.js clones the
// raw singletons for ENGINE.Blueprints.* — not at import, which would corrupt the API.

import playerCharactersImport from "../../player/characters.json" with { type: "json" };
import texturesImport from "./textures.json" with { type: "json" };
import terrainImport from "./terrain.json" with { type: "json" };
import obstacleImport from "./obstacles.json" with { type: "json" };
import characterImport from "./characters.json" with { type: "json" };
import enemyImport from "./enemies.json" with { type: "json" };
import projectileImport from "./projectiles.json" with { type: "json" };
import { Unit, UnitVector3 } from "../../math/Utilities.js";

const toUnitVector3 = (vector, type) => new UnitVector3(vector.x, vector.y, vector.z, type);

// Scatter parts carry no pivot.
function canonicalizePartTransform(part, includePivot = true) {
	part.dimensions    = toUnitVector3(part.dimensions,    "cnu");
	part.localPosition = toUnitVector3(part.localPosition, "cnu");
	part.localRotation = toUnitVector3(part.localRotation, "degrees").toRadians(true);
	if (includePivot) part.pivot = toUnitVector3(part.pivot, "cnu");
}

// Absent repeat canonicalizes to null; authored offsets instance once.
function instancePartRepeat(part) {
	if (part.repeat === undefined) {
		part.repeat = null;
		return;
	}
	part.repeat.offset.position = toUnitVector3(part.repeat.offset.position, "cnu");
	part.repeat.offset.rotation = toUnitVector3(part.repeat.offset.rotation, "degrees").toRadians(true);
}

// Shared by player-character, entity-template and object-template parts.
// Object template parts may author texture: null (shared texture baked in afterwards).
function instanceModelPart(part) {
	canonicalizePartTransform(part);

	if (part.texture !== null) {
		part.texture.custom.forEach((decal) => {
			decal.localTransform.position = toUnitVector3(decal.localTransform.position, "cnu");
			decal.localTransform.rotation = new Unit(decal.localTransform.rotation, "degrees").toRadians(true);
		});
	}

	// Tube parts carry a bone chain of world-space nodes.
	if (part.shape !== "tube") return;
	part.primitiveOptions.thickness = new Unit(part.primitiveOptions.thickness, "cnu");
	part.primitiveOptions.nodes.forEach((node) => {
		node.dimensions    = toUnitVector3(node.dimensions,    "cnu");
		node.localPosition = toUnitVector3(node.localPosition, "cnu");
		node.localRotation = toUnitVector3(node.localRotation, "degrees").toRadians(true);
		node.thickness     = new Unit(node.thickness,          "cnu");
	});
}

function instanceCharacterTemplates() {
	for (const characterId in playerCharactersImport) {
		const character = playerCharactersImport[characterId];
		character.meta.jumpHeight = new Unit(character.meta.jumpHeight, "cnu");
		character.model.parts.forEach((part) => instanceModelPart(part));
	}
}

function instanceScatterTemplates() {
	for (const key in texturesImport.scatterTypes) {
		texturesImport.scatterTypes[key].parts.forEach((part) => canonicalizePartTransform(part, false));
	}
}

function instanceObjectTemplates() {
	[terrainImport, obstacleImport].forEach((collection) => {
		for (const templateId in collection) {
			const template = collection[templateId];
			const shared = template.shared;
			shared.dimensions = toUnitVector3(shared.dimensions, "cnu");
			shared.pivot      = toUnitVector3(shared.pivot,      "cnu");

			template.parts.forEach((part) => {
				instanceModelPart(part);
				instancePartRepeat(part);
				if (part.texture === null) part.texture = shared.texture;
			});
		}
	});
}

function instanceEntityTemplates() {
	[characterImport, enemyImport, projectileImport].forEach((collection) => {
		for (const templateId in collection) {
			const template = collection[templateId];
			const movement = template.movement;
			movement.start = toUnitVector3(movement.start, "cnu");
			movement.end   = toUnitVector3(movement.end,   "cnu");
			movement.speed = new Unit(movement.speed, "cnu");
			movement.jump  = new Unit(movement.jump,  "cnu");
			template.velocity = toUnitVector3(template.velocity, "cnu");

			const rootTransform = template.model.rootTransform;
			rootTransform.position = toUnitVector3(rootTransform.position, "cnu");
			rootTransform.rotation = toUnitVector3(rootTransform.rotation, "degrees").toRadians(true);
			rootTransform.pivot    = toUnitVector3(rootTransform.pivot,    "cnu");

			template.model.parts.forEach((part) => {
				instanceModelPart(part);
				instancePartRepeat(part);
			});
		}
	});
}

// Clone authored singletons for the API, then instance them in place for engine use.
function InstanceEngineTemplates() {
	const raw = {
		PlayerCharacters: structuredClone(playerCharactersImport),
		Terrain         : structuredClone(terrainImport),
		Obstacles       : structuredClone(obstacleImport),
		Characters      : structuredClone(characterImport),
		Enemies         : structuredClone(enemyImport),
		Projectiles     : structuredClone(projectileImport),
		Scatter         : structuredClone(texturesImport.scatterTypes),
	};

	instanceCharacterTemplates();
	instanceScatterTemplates();
	instanceObjectTemplates();
	instanceEntityTemplates();

	const instanced = {
		PlayerCharacters: playerCharactersImport,
		Terrain         : terrainImport,
		Obstacles       : obstacleImport,
		Characters      : characterImport,
		Enemies         : enemyImport,
		Projectiles     : projectileImport,
		Scatter         : texturesImport.scatterTypes,
	};

	return { raw, instanced };
}

export { InstanceEngineTemplates };
