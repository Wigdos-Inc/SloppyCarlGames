// Assembles the player as an entity.

// Used by player/Master.js to build the player for a level.
// Used by handlers/game/Simulator.js to build players for preview.
// Uses builder/NewEntity.js to build the entity.

import { BuildEntity } from "../builder/NewEntity.js";
import { Unit, UnitVector3 } from "../math/Utilities.js";
import { Log } from "../core/meta.js";

/* === SPAWN SURFACE === */

// Surface a player without one spawns on, keeping its coordinates absolute.
const playerSurfaceId = "player-origin";

const playerSurfaceMap = {
	[playerSurfaceId]: {
		position: new UnitVector3(0, 0, 0, "cnu"),
		topY    : 0,
	},
};

/* === DEFINITION SYNTHESIS === */

// Build the entity definition the player is assembled from.
function synthesizeDefinition(character, playerData) {
	const { position, rotation, scale, pivot } = playerData.rootTransform;

	return {
		id               : "player",
		type             : "player",
		blueprintId      : character.id,
		meta             : { hp: 3 },
		attacks          : [],
		collisionOverride: character.collisionOverride,
		customEvents     : playerData.customEvents,
		animations       : playerData.animations,
		velocity         : new UnitVector3(0, 0, 0, "cnu"), // Per second

		// Zero the movement track's speed to leave moving the player to input.
		movement: {
			speed  : new Unit(0, "cnu"),    // Per second
			start  : position.clone(),
			end    : position.clone(),
			physics: { ...character.physics },
		},

		model: {
			spawnSurfaceId: playerData.spawnSurfaceId ?? playerSurfaceId,
			rootTransform : { position, rotation: rotation.clone(), scale, pivot },
			parts: character.model.parts,
		},
	};
}

/* === PUBLIC API === */

// Assemble the player entity from a character template.
function BuildPlayerModel(character, playerData, surfaceMap) {
	// Build the player as an entity, without a level texture scale or face texture store.
	const entity = BuildEntity(synthesizeDefinition(character, playerData), { ...surfaceMap, ...playerSurfaceMap }, null, null).entity;

	Log(
		"ENGINE",
		`Player model built: ${entity.model.parts.length} parts, collider=${entity.physics.collision.physics.shape}.`,
		"log",
		"Level"
	);

	return entity;
}

/* === EXPORTS === */

export { BuildPlayerModel };
