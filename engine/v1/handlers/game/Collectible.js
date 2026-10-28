// Handles collectible events

// Used by Level.js to pass on collectible triggers
// Uses player/Master.js and/or UI.js to engage Collectible Effects

import { CONFIG } from "../../core/config.js";
import { Log, SendEvent } from "../../core/meta.js";
import { CloneVector3 } from "../../math/Vector3.js";
import { AabbOverlap } from "../../math/Collision.js";

// Collectible pickup & removal from the scene.
function HandleCollectiblePickups(playerState, sceneGraph) {
	if (playerState.action === "Dead") return;

	for (let i = sceneGraph.entities.length - 1; i >= 0; i--) {
		const entity = sceneGraph.entities[i];
		if (entity.type !== "collectible") continue;
		if (!entity.performance.physics || entity.collision === null) continue;
		if (!AabbOverlap(playerState.collision.aabb, entity.collision.aabb)) continue;

		// Pickup!
		playerState.collectibles = Math.min(playerState.collectibles + 1, playerState.maxCollectibles);

		Log("ENGINE", `Collectible "${entity.id}" picked up. Total: ${playerState.collectibles}`, "log", "Level");

		// Remove from scene.
		if (entity.customEvents.despawn && CONFIG.CustomEvents.Entities.Despawn) {
			SendEvent("ENTITY_DESPAWN", {
				id      : entity.id,
				type    : entity.type,
				position: CloneVector3(entity.transform.position),
				velocity: CloneVector3(entity.velocity),
			});
		}
		sceneGraph.entities.splice(i, 1);

		SendEvent("COLLECTIBLE_PICKED_UP", { id: entity.id, total: playerState.collectibles });
	}
}

/* === EXPORTS === */

export { HandleCollectiblePickups };
