// Handles collectible events

// Used by Level.js to pass on collectible triggers
// Uses player/Master.js and/or UI.js to engage Collectible Effects

import { CONFIG } from "../../core/config.js";
import { Log, SendEvent } from "../../core/meta.js";
import { Vector3Distance } from "../../math/Vector3.js";
import { GetSimDistanceValue, CheckEntityAabbOverlap } from "../../physics/Collision.js";

/**
 * Check for collectible pickups — player AABB overlapping collectible entities.
 * On overlap: increment counter, remove entity, emit event.
 *
 * @param {object} playerState — mutable player state.
 * @param {object} sceneGraph — active scene graph.
 */
function HandleCollectiblePickups(playerState, sceneGraph) {
	if (playerState.action === "Dead") return;

	for (let i = sceneGraph.entities.length - 1; i >= 0; i--) {
		const entity = sceneGraph.entities[i];
		if (entity.type !== "collectible") continue;

		// SimDistance gate is camera-relative; only qualified entities enter this collision pass.
		if (Vector3Distance(sceneGraph.cameraConfig.state.position, entity.transform.position) > GetSimDistanceValue()) continue;

		if (!CheckEntityAabbOverlap(playerState, entity)) continue;

		// Pickup!
		playerState.collectibles = Math.min(
			playerState.collectibles + 1,
			playerState.maxCollectibles
		);

		Log("ENGINE", `Collectible "${entity.id}" picked up. Total: ${playerState.collectibles}`, "log", "Level");

		// Remove from scene.
		if (entity.customEvents.despawn && CONFIG.CUSTOM_EVENTS.Entities.despawn) {
			SendEvent("ENTITY_DESPAWN", {
				id      : entity.id,
				type    : entity.type,
				position: { x: entity.transform.position.x, y: entity.transform.position.y, z: entity.transform.position.z },
				velocity: { x: entity.velocity.x, y: entity.velocity.y, z: entity.velocity.z },
			});
		}
		sceneGraph.entities.splice(i, 1);

		SendEvent("COLLECTIBLE_PICKED_UP", { id: entity.id, total: playerState.collectibles });
	}
}

/* === EXPORTS === */

export { HandleCollectiblePickups };
