// Assembles the player as an entity.

// Creates a player model from a JSON template using the entity building system.
// Uses characters.json for character template definitions.
// Uses builder/NewEntity.js to build the entity and to refresh it each frame.
// Used by Master.js, which orchestrates the built entity as player state.

import { BuildEntity, UpdateEntityModelFromTransform } from "../builder/NewEntity.js";
import { NormalizeImage } from "../core/normalize.js";
import { Unit, UnitVector3 } from "../math/Utilities.js";
import { Log } from "../core/meta.js";
import CharacterData from "./characters.json" with { type: "json" };

/* === CHARACTER TEMPLATE CANONICALIZATION === */

// characters.json bypasses core/normalize.js — this IIFE is its single Unit-instancing site (runs once at import).

(function instanceCharacterTemplates() {
	const toUnitVector3 = (vector, type) => new UnitVector3(vector.x, vector.y, vector.z, type);

	for (const characterId in CharacterData) {
		const character = CharacterData[characterId];
		character.meta.jumpHeight = new Unit(character.meta.jumpHeight, "cnu");

		character.model.parts.forEach((part) => {
			part.dimensions    = toUnitVector3(part.dimensions,    "cnu");
			part.localPosition = toUnitVector3(part.localPosition, "cnu");
			part.localRotation = toUnitVector3(part.localRotation, "degrees").toRadians(true);
			part.pivot         = toUnitVector3(part.pivot,         "cnu");

			part.texture.custom.forEach((decal) => {
				decal.localTransform.position = toUnitVector3(decal.localTransform.position, "cnu");
				decal.localTransform.rotation = new Unit(decal.localTransform.rotation, "degrees").toRadians(true);
			});

			// Tube parts carry a bone chain whose nodes hold world-space values of their own.
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
})();

/* === SPAWN SURFACE === */

// Player spawn is absolute, so hand the builder a zero-origin surface (world pos = rootTransform pos).

const playerSurfaceId = "player-origin";

const playerSurfaceMap = {
	[playerSurfaceId]: {
		position: new UnitVector3(0, 0, 0, "cnu"),
		topY    : 0,
	},
};

/* === DEFINITION SYNTHESIS === */

/**
 * Drop image decals that failed to load, without mutating the shared character template. Each part
 * is shallow-copied only when it actually carries a dead decal, so the template's `texture.custom`
 * stays intact and a transient load failure retries on the next level.
 */
function filterDeadDecals(parts) {
	return parts.map((part) => {
		const alive = part.texture.custom.filter((decal) => decal.decalType !== "image" || decal.bitmap !== null);
		if (alive.length === part.texture.custom.length) return part;
		return { ...part, texture: { ...part.texture, custom: alive } };
	});
}

/**
 * Build the entity definition the player is assembled from. The character template supplies the
 * model and collider shapes; the level payload supplies placement and per-level concerns.
 * @param {object} character — a characters.json entry, already merged with any meta overrides.
 * @param {object} playerData — { spawnPosition, scale, animations, customEvents }.
 */
function synthesizeDefinition(character, playerData) {
	return {
		id               : "player",
		type             : "player",
		blueprintId      : null,
		hp               : 3,
		attacks          : [],
		hardcoded        : {},
		platform         : null,
		collisionOverride: character.collisionOverride,
		customEvents     : playerData.customEvents,
		animations       : playerData.animations,
		velocity         : new UnitVector3(0, 0, 0, "cnu"),

		// The player is driven by input, not by the builder's movement track. A zero speed keeps
		// the builder's movement lerp inert so the spawn position is left untouched.
		movement: {
			speed: new Unit(0, "cnu"),
			start: playerData.spawnPosition.clone(),
			end  : playerData.spawnPosition.clone(),
		},

		model: {
			spawnSurfaceId: playerSurfaceId,
			rootTransform : {
				position: playerData.spawnPosition,
				rotation: new UnitVector3(0, 0, 0, "radians"),
				scale   : playerData.scale,
				pivot   : new UnitVector3(0, 0, 0, "cnu"),
			},
			parts: filterDeadDecals(character.model.parts),
		},
	};
}

/* === DECALS === */

// Loads image decals to bitmaps, cached on the shared template. Failed decals are dropped later in
// the definition (filterDeadDecals), never off the template. Paths resolve relative to player/.
async function loadDecalBitmaps(parts) {
	const imageLoads = [];

	parts.forEach((part) => {
		part.texture.custom.forEach((decal) => {
			if (decal.decalType !== "image") return;
			imageLoads.push(
				NormalizeImage(new URL(decal.imagePath, import.meta.url).href, decal.sourceType, "webgl").then((result) => {
					decal.bitmap = result.bool ? result.value : null;
				})
			);
		});
	});

	await Promise.all(imageLoads);
}

/* === PUBLIC API === */

/**
 * Assemble the player entity from a character template.
 * @param {object} character — a characters.json entry, already merged with any meta overrides.
 * @param {object} playerData — { spawnPosition, scale, animations, customEvents, hasCustomParts }.
 * @returns {object} — the built entity, ready for Master.js to extend into player state.
 */
async function BuildPlayerModel(character, playerData) {
	if (playerData.hasCustomParts === false) await loadDecalBitmaps(character.model.parts);

	// textureScale null opts the player out of the shared entity-part geometry/face-texture cache,
	// matching how the player model has always been built.
	const { entity } = BuildEntity(synthesizeDefinition(character, playerData), playerSurfaceMap, null, null, null);

	Log(
		"ENGINE",
		`Player model built: ${entity.model.parts.length} parts, collider=${entity.collision.shape}.`,
		"log",
		"Level"
	);

	return entity;
}

/**
 * Re-pose the player model from its transform and recompute aabb/physics/hurtbox/hitbox.
 * @param {object} playerState — the player entity.
 */
function RefreshPlayerModel(playerState) {
	UpdateEntityModelFromTransform(playerState);
	playerState.mesh = playerState.model.parts[0].mesh;
}

/* === EXPORTS === */

export {
	CharacterData,
	BuildPlayerModel,
	RefreshPlayerModel,
};
