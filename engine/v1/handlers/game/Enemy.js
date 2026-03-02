// Handles enemy AI and state

// Receives enemy data from Level.js when enemy is within AI distance.
// Uses builder/NewEntity.js to build enemy projectile attacks.

import { CONFIG } from "../../core/config.js";
import { Log, sendEvent } from "../../core/meta.js";
import {
	SubtractVector3,
	NormalizeUnitVector3,
	distanceVector3,
} from "../../math/Vector3.js";
import { ToNumber } from "../../math/Utilities.js";
import { getSimDistanceValue, CheckEntityAabbOverlap } from "../../physics/Collision.js";
import { TriggerPlayerDeath, RespawnPlayer } from "../../player/Master.js";

const KNOCKBACK_FORCE = 12;
const INVULNERABILITY_DURATION = 2.0;
const DEATH_WAIT_MS = 1500;

/**
 * Handle collisions between the player and all enemy entities.
 * If player.attackFlag is true → enemy takes damage.
 * If player.attackFlag is false → player takes damage.
 *
 * @param {object} playerState — mutable player state.
 * @param {object} sceneGraph — active scene graph.
 * @param {number} deltaSeconds
 */
function HandleEnemyCollisions(playerState, sceneGraph, deltaSeconds) {
	if (!playerState || !playerState.active || playerState.state === "Dead") { return; }

	const entities = Array.isArray(sceneGraph && sceneGraph.entities) ? sceneGraph.entities : [];
	const playerPos = playerState.transform.position;
	const cameraPos = sceneGraph && sceneGraph.cameraConfig && sceneGraph.cameraConfig.state
		? sceneGraph.cameraConfig.state.position
		: playerPos;
	const activityRadius = getSimDistanceValue();
	const playerAabb = playerState.collision && playerState.collision.aabb ? playerState.collision.aabb : null;

	if (!playerAabb) { return; }

	for (let i = entities.length - 1; i >= 0; i--) {
		const entity = entities[i];
		if (!entity || entity.type !== "enemy") { continue; }
		if (!entity.collision || !entity.collision.aabb) { continue; }

		// SimDistance gate is camera-relative; only qualified entities enter this collision pass.
		const entityPos = entity.transform ? entity.transform.position : { x: 0, y: 0, z: 0 };
		if (cameraPos && distanceVector3(cameraPos, entityPos) > activityRadius) { continue; }

		if (!CheckEntityAabbOverlap(playerState, entity)) { continue; }

		// Collision occurred.
		if (playerState.attackFlag) {
			// === ENEMY TAKES DAMAGE ===
			entity.hp = ToNumber(entity.hp, 1) - 1;

			if (CONFIG && CONFIG.DEBUG && CONFIG.DEBUG.ALL === true && CONFIG.DEBUG.LOGGING && CONFIG.DEBUG.LOGGING.Channel && CONFIG.DEBUG.LOGGING.Channel.Level) {
				Log("ENGINE", `Enemy "${entity.id}" hit by player. HP: ${entity.hp}`, "log", "Level");
			}

			if (entity.hp <= 0) {
				// Remove enemy from scene.
				entities.splice(i, 1);
				Log("ENGINE", `Enemy "${entity.id}" destroyed.`, "log", "Level");
				sendEvent("ENEMY_DESTROYED", { id: entity.id });
			}
		} else if (!playerState.invulnerable.active) {
			// === PLAYER TAKES DAMAGE ===
			applyPlayerDamage(playerState, entityPos, sceneGraph);
			break; // Only process one damage event per frame.
		}
	}
}

function applyPlayerDamage(playerState, damageSourcePosition, sceneGraph) {
	const playerPos = playerState.transform.position;

	// Drop ALL primary collectibles on damage.
	const dropCount = Math.max(0, ToNumber(playerState.collectibles, 0));
	playerState.collectibles = 0;

	if (CONFIG && CONFIG.DEBUG && CONFIG.DEBUG.ALL === true && CONFIG.DEBUG.LOGGING && CONFIG.DEBUG.LOGGING.Channel && CONFIG.DEBUG.LOGGING.Channel.Level) {
		Log("ENGINE", `Player damaged! Lost ${dropCount} collectibles. Remaining: ${playerState.collectibles}`, "log", "Level");
	}

	// TODO: Spawn collectible entities from stored count (placeholder — just log).
	if (dropCount > 0) {
		Log("ENGINE", `[Placeholder] Would spawn ${dropCount} collectible entities.`, "log", "Level");
	}

	// Check for death when no collectibles were available at hit time.
	if (dropCount <= 0) {
		triggerDeathSequence(playerState, sceneGraph);
		return;
	}

	// Apply knockback impulse (direction away from damage source).
	const knockDir = NormalizeUnitVector3(SubtractVector3(playerPos, damageSourcePosition));
	playerState.velocity = {
		x: knockDir.x * KNOCKBACK_FORCE,
		y: Math.max(knockDir.y * KNOCKBACK_FORCE, KNOCKBACK_FORCE * 0.5),
		z: knockDir.z * KNOCKBACK_FORCE,
	};

	// Start invulnerability.
	playerState.invulnerable.active = true;
	playerState.invulnerable.timer = INVULNERABILITY_DURATION;
	playerState.invulnerable.flashTimer = 0;

	// Transition to stunned state.
	playerState.previousState = playerState.state;
	playerState.state = "Stunned";
	playerState.grounded = false;

	sendEvent("PLAYER_DAMAGED", { collectibles: playerState.collectibles, dropped: dropCount });
}

async function triggerDeathSequence(playerState, sceneGraph) {
	TriggerPlayerDeath();

	sendEvent("PLAYER_DEATH", {});

	// Wait for death animation / minimum duration.
	sendEvent("FADE_OUT", { duration: 500 });

	// Use setTimeout to allow the fade to play, then respawn.
	setTimeout(() => {
		RespawnPlayer();
		sendEvent("FADE_IN", { duration: 500 });
	}, DEATH_WAIT_MS);
}

/* === EXPORTS === */

export { HandleEnemyCollisions };
