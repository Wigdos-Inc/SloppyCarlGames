// Handles enemy AI and state

// Receives enemy data from Level.js when enemy is within AI distance.
// Uses builder/NewEntity.js to build enemy projectile attacks.

import { Log, SendEvent } from "../../core/meta.js";
import {
	SubtractVector3,
	ResolveVector3Axis,
} from "../../math/Vector3.js";
import { GetSimDistanceValue, DetectCombatOverlaps } from "../../physics/Collision.js";
import { TriggerPlayerRespawnSequence } from "../../player/Master.js";

const KNOCKBACK_FORCE = 12;
const INVULNERABILITY_DURATION = 2.0;

/**
 * Handle collisions between the player and all enemy entities.
 * Uses the three-layer combat overlap system:
 *   - playerState.hitboxActive → player attacks enemies (hitbox vs hurtbox).
 *   - Otherwise enemies attack player (entity hitbox vs player hurtbox).
 *
 * @param {object} playerState — mutable player state.
 * @param {object} sceneGraph — active scene graph.
 * @param {number} deltaSeconds
 */
function HandleEnemyCollisions(playerState, sceneGraph, deltaSeconds) {
	if (playerState.state === "Dead") return;

	const entities = sceneGraph.entities;

	// Use three-layer combat detection.
	const combatResults = DetectCombatOverlaps(
		playerState, 
		entities, 
		GetSimDistanceValue(), 
		sceneGraph.cameraConfig.state.position
	);

	for (let i = combatResults.count - 1; i >= 0; i--) {
		const result = combatResults.items[i];

		if (result.type === "player-attacks") {
			// === ENEMY TAKES DAMAGE ===
			const entity = result.target;
			if (entity.type !== "enemy") continue;

			entity.hp--;
			Log("ENGINE", `Enemy "${entity.id}" hit by player. HP: ${entity.hp}`, "log", "Level");

			if (entity.hp <= 0) {
				const idx = entities.indexOf(entity);
				if (idx !== -1) entities.splice(idx, 1);
				Log("ENGINE", `Enemy "${entity.id}" destroyed.`, "log", "Level");
				SendEvent("ENEMY_DESTROYED", { id: entity.id });
			}
		} 
		else if (result.type === "entity-attacks" && !playerState.invulnerable.active) {
			// === PLAYER TAKES DAMAGE ===
			const entity = result.attacker;
			if (entity.type !== "enemy") continue;

			applyPlayerDamage(playerState, entity.transform.position);
			break; // Only process one damage event per frame.
		}
	}
}

function applyPlayerDamage(playerState, damageSourcePosition) {
	const playerPos = playerState.transform.position;

	// Drop ALL primary collectibles on damage.
	const dropCount = Math.max(0, playerState.collectibles);
	playerState.collectibles = 0;

	Log("ENGINE", `Player damaged! Lost ${dropCount} collectibles. Remaining: ${playerState.collectibles}`, "log", "Level");

	// TODO: Spawn collectible entities from stored count (placeholder — just log).
	if (dropCount > 0) Log("ENGINE", `[Placeholder] Would spawn ${dropCount} collectible entities.`, "log", "Level");

	// Check for death when no collectibles were available at hit time.
	if (dropCount <= 0) {
		TriggerPlayerRespawnSequence();
		return;
	}

	// Apply knockback impulse (direction away from damage source).
	const knockDir = ResolveVector3Axis(SubtractVector3(playerPos, damageSourcePosition));
	playerState.velocity.set({
		x: knockDir.x * KNOCKBACK_FORCE,
		y: Math.max(knockDir.y * KNOCKBACK_FORCE, KNOCKBACK_FORCE * 0.5),
		z: knockDir.z * KNOCKBACK_FORCE,
	});

	// Start invulnerability.
	playerState.invulnerable.active = true;
	playerState.invulnerable.timer = INVULNERABILITY_DURATION;
	playerState.invulnerable.flashTimer = 0;

	// Transition to stunned state.
	playerState.previousState = playerState.state;
	playerState.state = "Stunned";
	playerState.grounded = false;

	SendEvent("PLAYER_DAMAGED", { collectibles: playerState.collectibles, dropped: dropCount });
}

/* === EXPORTS === */

export { HandleEnemyCollisions };
