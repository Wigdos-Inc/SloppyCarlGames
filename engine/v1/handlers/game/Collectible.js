// Handles collectible events

// Used by Level.js to pass on collectible triggers
// Uses player/Master.js and/or UI.js to engage Collectible Effects

import { CONFIG } from "../../core/config.js";
import { Log, SendEvent } from "../../core/meta.js";
import { DistanceVector3 } from "../../math/Vector3.js";
import { GetSimDistanceValue, CheckEntityAabbOverlap } from "../../physics/Collision.js";

/**
 * Check for collectible pickups — player AABB overlapping collectible entities.
 * On overlap: increment counter, remove entity, emit event.
 *
 * @param {object} playerState — mutable player state.
 * @param {object} sceneGraph — active scene graph.
 */
function HandleCollectiblePickups(playerState, sceneGraph) {
	if (!playerState || !playerState.active || playerState.state === "Dead") { return; }

	const entities = Array.isArray(sceneGraph && sceneGraph.entities) ? sceneGraph.entities : [];
	const playerPos = playerState.transform.position;
	const cameraPos = sceneGraph && sceneGraph.cameraConfig && sceneGraph.cameraConfig.state
		? sceneGraph.cameraConfig.state.position
		: playerPos;
	const activityRadius = GetSimDistanceValue();
	const playerAabb = playerState.collision && playerState.collision.aabb ? playerState.collision.aabb : null;

	if (!playerAabb) { return; }

	for (let i = entities.length - 1; i >= 0; i--) {
		const entity = entities[i];
		if (!entity || entity.type !== "collectible") { continue; }
		if (!entity.collision || !entity.collision.aabb) { continue; }

		// SimDistance gate is camera-relative; only qualified entities enter this collision pass.
		const entityPos = entity.transform ? entity.transform.position : { x: 0, y: 0, z: 0 };
		if (cameraPos && DistanceVector3(cameraPos, entityPos) > activityRadius) { continue; }

		if (!CheckEntityAabbOverlap(playerState, entity)) { continue; }

		// Pickup!
		playerState.collectibles = Math.min(
			playerState.collectibles + 1,
			playerState.maxCollectibles || 999
		);

		if (CONFIG && CONFIG.DEBUG && CONFIG.DEBUG.ALL === true && CONFIG.DEBUG.LOGGING && CONFIG.DEBUG.LOGGING.Channel && CONFIG.DEBUG.LOGGING.Channel.Level) {
			Log("ENGINE", `Collectible "${entity.id}" picked up. Total: ${playerState.collectibles}`, "log", "Level");
		}

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
