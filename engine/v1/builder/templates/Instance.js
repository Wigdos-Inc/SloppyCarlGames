// Instances engine-owned template JSON at boot.

// Used by core/ini.js to instance the templates and keep raw copies for ENGINE.Blueprints.
// Uses core/normalize.js to load image decals.

import playerData from "../../player/characters.json" with { type: "json" };
import texturesImport from "./textures.json" with { type: "json" };
import terrainImport from "./terrain.json" with { type: "json" };
import obstacleImport from "./obstacles.json" with { type: "json" };
import characterImport from "./characters.json" with { type: "json" };
import enemyImport from "./enemies.json" with { type: "json" };
import projectileImport from "./projectiles.json" with { type: "json" };
import particleImport from "./particles.json" with { type: "json" };
import simulatorLevelsImport from "./levels.json" with { type: "json" };
import { Unit, UnitVector3 } from "../../math/Utilities.js";
import { NormalizeImage } from "../../core/normalize.js";

const toUnitVector3 = (vector, type) => new UnitVector3(vector.x, vector.y, vector.z, type);

function instanceDecalTransforms(customTextures) {
	customTextures.forEach((decal) => {
		decal.localTransform.position = toUnitVector3(decal.localTransform.position, "cnu");
		decal.localTransform.rotation = new Unit(decal.localTransform.rotation, "degrees").toRadians(true);
	});
}

// Instance the transforms offset between a part's repeats.
function instancePartRepeat(part) {
	if (part.repeat === undefined) return part.repeat = null;
	part.repeat.offset.position = toUnitVector3(part.repeat.offset.position, "cnu");
	part.repeat.offset.rotation = toUnitVector3(part.repeat.offset.rotation, "degrees").toRadians(true);
}

function instanceModelPart(part) {
	part.dimensions    = toUnitVector3(part.dimensions,    "cnu");
	part.localPosition = toUnitVector3(part.localPosition, "cnu");
	part.localRotation = toUnitVector3(part.localRotation, "degrees").toRadians(true);
	part.pivot         = toUnitVector3(part.pivot,         "cnu");

	if (part.particle === undefined) part.particle = null;
	if (part.texture !== null) instanceDecalTransforms(part.texture.custom);

	if (part.shape === "tube") {
		part.primitiveOptions.thickness = new Unit(part.primitiveOptions.thickness, "cnu");

		// Instance each node of a tube.
		part.primitiveOptions.nodes.forEach((node) => {
			node.dimensions    = toUnitVector3(node.dimensions,    "cnu");
			node.localPosition = toUnitVector3(node.localPosition, "cnu");
			node.localRotation = toUnitVector3(node.localRotation, "degrees").toRadians(true);
			node.thickness     = new Unit(node.thickness, "cnu");
		});
	}
}

function instanceCharacterTemplates() {
	for (const characterId in playerData) {
		const character = playerData[characterId];
		const meta = character.meta;
		meta.jumpHeight       = new Unit(meta.jumpHeight, "cnu");
		meta.maxSpeed         = new Unit(meta.maxSpeed, "cnu");                             // Per second
		meta.acceleration     = new Unit(meta.acceleration, "cnu");                         // Per second (squared)
		meta.deceleration     = new Unit(meta.deceleration, "cnu");                         // Per second (squared)
		meta.momentumTurnRate = new Unit(meta.momentumTurnRate, "degrees").toRadians(true); // Per second
		character.model.parts.forEach((part) => instanceModelPart(part));
	}
}

// Instance scatter part transforms and decals.
function instanceScatterTemplates() {
	// Instance a field, or each of its tiers if split by complexity (low/medium/high).
	function instanceTiers(part, field, instance) {
		const value = part[field];
		if (value.low === undefined) return part[field] = instance(value);
		for (const tier in value) value[tier] = instance(value[tier]);
	}

	for (const key in texturesImport.scatterTypes) {
		texturesImport.scatterTypes[key].parts.forEach((part) => {
			instanceTiers(part, "dimensions",    (vector) => toUnitVector3(vector, "cnu"));
			instanceTiers(part, "localPosition", (vector) => toUnitVector3(vector, "cnu"));
			instanceTiers(part, "localRotation", (vector) => toUnitVector3(vector, "degrees").toRadians(true));
			instanceDecalTransforms(part.texture.custom);
		});
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
			movement.speed = new Unit(movement.speed, "cnu");            // Per second
			movement.jump  = new Unit(movement.jump,  "cnu");
			template.velocity = toUnitVector3(template.velocity, "cnu"); // Per second

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

// Instance each particle template's initial velocity and the part it emits.
function instanceParticleTemplates() {
	for (const templateId in particleImport) {
		const template = particleImport[templateId];
		template.velocity = toUnitVector3(template.velocity, "cnu"); // Per second
		instanceModelPart(template.part);
	}
}

function instanceSimulatorTemplates() {
	const disc = simulatorLevelsImport.simulatorLevel.terrain.objects[0];
	disc.dimensions = toUnitVector3(disc.dimensions, "cnu");
	disc.position   = toUnitVector3(disc.position,   "cnu");
	disc.rotation   = toUnitVector3(disc.rotation,   "degrees").toRadians(true);
	disc.pivot      = toUnitVector3(disc.pivot,      "cnu");
}

// Load the bitmaps for every template's image decals. Paths are relative to templates/.
function loadTemplateDecalBitmaps() {
	// Register all textures.
	const textures = new Set();
	[characterImport, enemyImport, projectileImport].forEach((collection) => {
		for (const templateId in collection) collection[templateId].model.parts.forEach((part) => textures.add(part.texture));
	});
	[terrainImport, obstacleImport].forEach((collection) => {
		for (const templateId in collection) collection[templateId].parts.forEach((part) => textures.add(part.texture));
	});
	for (const templateId in particleImport) textures.add(particleImport[templateId].part.texture);
	for (const key in texturesImport.scatterTypes) texturesImport.scatterTypes[key].parts.forEach((part) => textures.add(part.texture));

	// Load each texture's bitmap.
	textures.forEach((texture) => texture.custom.forEach((decal) => {
		if (decal.decalType !== "image") return;
		NormalizeImage(new URL(decal.imagePath, import.meta.url).href, decal.sourceType, "webgl").then((result) => {
			decal.bitmap = result.value;
		});
	}));
}

function InstanceEngineTemplates() {
	// Clone raw for the API.
	const raw = {
		PlayerCharacters: structuredClone(playerData),
		Terrain         : structuredClone(terrainImport),
		Obstacles       : structuredClone(obstacleImport),
		Characters      : structuredClone(characterImport),
		Enemies         : structuredClone(enemyImport),
		Projectiles     : structuredClone(projectileImport),
		Particles       : structuredClone(particleImport),
		Scatter         : structuredClone(texturesImport.scatterTypes),
	};

	// Canonicalize all engine-owned data.
	instanceCharacterTemplates();
	instanceScatterTemplates();
	instanceObjectTemplates();
	instanceEntityTemplates();
	instanceParticleTemplates();
	instanceSimulatorTemplates();
	loadTemplateDecalBitmaps();

	const instanced = {
		PlayerCharacters: playerData,
		Terrain         : terrainImport,
		Obstacles       : obstacleImport,
		Characters      : characterImport,
		Enemies         : enemyImport,
		Projectiles     : projectileImport,
		Particles       : particleImport,
		Scatter         : texturesImport.scatterTypes,
	};

	return { raw, instanced };
}

export { InstanceEngineTemplates };
