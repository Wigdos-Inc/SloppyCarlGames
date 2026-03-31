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
	if (playerState.state === "Dead") { return; }

	const entities = sceneGraph.entities;
	const cameraPos = sceneGraph.cameraConfig.state.position;
	const activityRadius = GetSimDistanceValue();

	for (let i = entities.length - 1; i >= 0; i--) {
		const entity = entities[i];
		if (entity.type !== "collectible") { continue; }

		// SimDistance gate is camera-relative; only qualified entities enter this collision pass.
		const entityPos = entity.transform.position;
		if (Vector3Distance(cameraPos, entityPos) > activityRadius) continue;

		if (!CheckEntityAabbOverlap(playerState, entity)) continue;

		// Pickup!
		playerState.collectibles = Math.min(
			playerState.collectibles + 1,
			playerState.maxCollectibles
		);

		Log("ENGINE", `Collectible "${entity.id}" picked up. Total: ${playerState.collectibles}`, "log", "Level");

		// Remove from scene.
		entities.splice(i, 1);

		SendEvent("COLLECTIBLE_PICKED_UP", {
			id: entity.id,
			total: playerState.collectibles,
		});
	}
}

/* === EXPORTS === */

export { HandleCollectiblePickups };
