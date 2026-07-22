// Boot-time Unit-instancing of engine-owned template JSON, run after ini.js clones the
// raw singletons for ENGINE.Blueprints.* — not at import, which would corrupt the API.

import charactersImport from "../../player/characters.json" with { type: "json" };
import texturesImport from "./textures.json" with { type: "json" };
import terrainImport from "./terrainBlueprints.json" with { type: "json" };
import obstacleImport from "./obstacleBlueprints.json" with { type: "json" };
import { Unit, UnitVector3 } from "../../math/Utilities.js";

const toUnitVector3 = (vector, type) => new UnitVector3(vector.x, vector.y, vector.z, type);

// Scatter parts carry no pivot.
function canonicalizePartTransform(part, includePivot = true) {
	part.dimensions    = toUnitVector3(part.dimensions,    "cnu");
	part.localPosition = toUnitVector3(part.localPosition, "cnu");
	part.localRotation = toUnitVector3(part.localRotation, "degrees").toRadians(true);
	if (includePivot) part.pivot = toUnitVector3(part.pivot, "cnu");
}

function instanceCharacterTemplates() {
	for (const characterId in charactersImport) {
		const character = charactersImport[characterId];
		character.meta.jumpHeight = new Unit(character.meta.jumpHeight, "cnu");

		character.model.parts.forEach((part) => {
			canonicalizePartTransform(part);

			part.texture.custom.forEach((decal) => {
				decal.localTransform.position = toUnitVector3(decal.localTransform.position, "cnu");
				decal.localTransform.rotation = new Unit(decal.localTransform.rotation, "degrees").toRadians(true);
			});

			// Tube parts carry a bone chain of world-space nodes.
			if (part.shape !== "tube") return;
			part.primitiveOptions.thickness = new Unit(part.primitiveOptions.thickness, "cnu");
			part.primitiveOptions.nodes.forEach((node) => {
				node.dimensions    = toUnitVector3(node.dimensions,    "cnu");
				node.localPosition = toUnitVector3(node.localPosition, "cnu");
				node.localRotation = toUnitVector3(node.localRotation, "degrees").toRadians(true);
				node.thickness     = new Unit(node.thickness,          "cnu");
			});
		});
	}
}

function instanceScatterTemplates() {
	for (const key in texturesImport.scatterTypes) {
		texturesImport.scatterTypes[key].parts.forEach((part) => canonicalizePartTransform(part, false));
	}
}

// Both JSONs are {} today (inert); the assumed .model.parts shape is unconfirmed.
function instanceBlueprintTemplates() {
	[terrainImport, obstacleImport].forEach((blueprints) => {
		for (const blueprintId in blueprints) {
			blueprints[blueprintId].model.parts.forEach((part) => canonicalizePartTransform(part));
		}
	});
}

// Clone authored singletons for the API, then instance them in place for engine use.
function InstanceEngineTemplates() {
	const raw = {
		PlayerCharacters: structuredClone(charactersImport),
		Terrain         : structuredClone(terrainImport),
		Obstacles       : structuredClone(obstacleImport),
		Scatter         : structuredClone(texturesImport.scatterTypes),
	};

	instanceCharacterTemplates();
	instanceScatterTemplates();
	instanceBlueprintTemplates();

	const instanced = {
		PlayerCharacters: charactersImport,
		Terrain         : terrainImport,
		Obstacles       : obstacleImport,
		Scatter         : texturesImport.scatterTypes,
	};

	return { raw, instanced };
}

export { InstanceEngineTemplates };
