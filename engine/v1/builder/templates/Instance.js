// Boot-time Unit-instancing of engine-owned template JSON, run after ini.js clones the
// raw singletons for ENGINE.Blueprints.* — not at import, which would corrupt the API.

import playerCharactersImport from "../../player/characters.json" with { type: "json" };
import texturesImport from "./textures.json" with { type: "json" };
import terrainImport from "./terrain.json" with { type: "json" };
import obstacleImport from "./obstacles.json" with { type: "json" };
import characterImport from "./characters.json" with { type: "json" };
import enemyImport from "./enemies.json" with { type: "json" };
import projectileImport from "./projectiles.json" with { type: "json" };
import particleImport from "./particles.json" with { type: "json" };
import simulatorLevelsImport from "./levels.json" with { type: "json" };
import { Unit, UnitVector3 } from "../../math/Utilities.js";

const toUnitVector3 = (vector, type) => new UnitVector3(vector.x, vector.y, vector.z, type);

// Shared by instanceModelPart and instanceScatterTemplates — canonicalizes decal placement fields.
function canonicalizeDecalTransforms(customTextures) {
	customTextures.forEach((decal) => {
		decal.localTransform.position = toUnitVector3(decal.localTransform.position, "cnu");
		decal.localTransform.rotation = new Unit(decal.localTransform.rotation, "degrees").toRadians(true);
	});
}

function canonicalizePartTransform(part) {
	part.dimensions    = toUnitVector3(part.dimensions,    "cnu");
	part.localPosition = toUnitVector3(part.localPosition, "cnu");
	part.localRotation = toUnitVector3(part.localRotation, "degrees").toRadians(true);
	part.pivot         = toUnitVector3(part.pivot,         "cnu");
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

	// Engine templates author no generators; absent canonicalizes to null.
	if (part.particle === undefined) part.particle = null;

	if (part.texture !== null) canonicalizeDecalTransforms(part.texture.custom);

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

const toCnuVector    = (vector) => toUnitVector3(vector, "cnu");
const toRadianVector = (vector) => toUnitVector3(vector, "degrees").toRadians(true);

// Scatter-only: a quality-tiered field is keyed low/medium/high, so each tier instances in place.
function instanceScatterField(part, field, instancer) {
	const value = part[field];
	if (value.low === undefined) { part[field] = instancer(value); return; }
	for (const tier in value) value[tier] = instancer(value[tier]);
}

// Scatter parts carry no pivot, and localScale stays a raw vector at every tier.
function instanceScatterTemplates() {
	for (const key in texturesImport.scatterTypes) {
		texturesImport.scatterTypes[key].parts.forEach((part) => {
			instanceScatterField(part, "dimensions",    toCnuVector);
			instanceScatterField(part, "localPosition", toCnuVector);
			instanceScatterField(part, "localRotation", toRadianVector);
			canonicalizeDecalTransforms(part.texture.custom);
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

// Group velocity is the burst axis; the single prototype part reuses the shared part instancer.
function instanceParticleTemplates() {
	for (const templateId in particleImport) {
		const template = particleImport[templateId];
		template.velocity = toUnitVector3(template.velocity, "cnu");
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

// Clone authored singletons for the API, then instance them in place for engine use.
function InstanceEngineTemplates() {
	const raw = {
		PlayerCharacters: structuredClone(playerCharactersImport),
		Terrain         : structuredClone(terrainImport),
		Obstacles       : structuredClone(obstacleImport),
		Characters      : structuredClone(characterImport),
		Enemies         : structuredClone(enemyImport),
		Projectiles     : structuredClone(projectileImport),
		Particles       : structuredClone(particleImport),
		Scatter         : structuredClone(texturesImport.scatterTypes),
	};

	instanceCharacterTemplates();
	instanceScatterTemplates();
	instanceObjectTemplates();
	instanceEntityTemplates();
	instanceParticleTemplates();
	instanceSimulatorTemplates();

	const instanced = {
		PlayerCharacters: playerCharactersImport,
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
