// Assembles the player as an entity.

// Creates a player model from a JSON template using the entity building system.
// Uses characters.json for character template definitions.
// Uses builder/NewEntity.js to build the entity and to refresh it each frame.
// Used by Master.js, which orchestrates the built entity as player state.

import { BuildEntity, UpdateEntityModelFromTransform } from "../builder/NewEntity.js";
import { Unit, UnitVector3 } from "../math/Utilities.js";
import { Log } from "../core/meta.js";
import CharacterData from "./characters.json" with { type: "json" };

/* === SPAWN SURFACE === */

// Without a spawn surface the player spawns in absolute coordinates, on a zero-origin surface.

const playerSurfaceId = "player-origin";

const playerSurfaceMap = {
	[playerSurfaceId]: {
		position: new UnitVector3(0, 0, 0, "cnu"),
		topY    : 0,
	},
};

/* === DEFINITION SYNTHESIS === */

/**
 * Build the entity definition the player is assembled from. The character template supplies the
 * model and collider shapes; the level payload supplies placement and per-level concerns.
 * @param {object} character — a characters.json entry, already merged with any meta overrides.
 * @param {object} playerData — { rootTransform, spawnSurfaceId, animations, customEvents }.
 */
function synthesizeDefinition(character, playerData) {
	const { position, rotation, scale, pivot } = playerData.rootTransform;

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
		velocity         : new UnitVector3(0, 0, 0, "cnu"), // Per second

		// Zero speed keeps the builder's movement track from moving the player; input does that.
		movement: {
			speed: new Unit(0, "cnu"), // Per second
			start: position.clone(),
			end  : position.clone(),
		},

		model: {
			spawnSurfaceId: playerData.spawnSurfaceId ?? playerSurfaceId,
			rootTransform : { position, rotation: rotation.clone(), scale, pivot },
			parts: character.model.parts,
		},
	};
}

/* === PUBLIC API === */

/**
 * Assemble the player entity from a character template.
 * @param {object} character — a characters.json entry, already merged with any meta overrides.
 * @param {object} playerData — { rootTransform, spawnSurfaceId, animations, customEvents }.
 * @param {object} surfaceMap — the level's spawn surfaces, { [surfaceId]: { position, topY } }.
 * @returns {object} — the built entity, ready for Master.js to extend into player state.
 */
function BuildPlayerModel(character, playerData, surfaceMap) {
	// Null geometryCache: the player's parts build uncached, textured like any entity's.
	const { entity } = BuildEntity(synthesizeDefinition(character, playerData), { ...surfaceMap, ...playerSurfaceMap }, null, null, null);

	Log(
		"ENGINE",
		`Player model built: ${entity.model.parts.length} parts, collider=${entity.collision.physics.shape}.`,
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
	BuildPlayerModel,
	RefreshPlayerModel,
};
