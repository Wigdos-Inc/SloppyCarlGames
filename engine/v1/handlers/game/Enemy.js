// Handles enemy AI and state

// Receives enemy data from Level.js when enemy is within AI distance.
// Uses builder/NewEntity.js to build enemy projectile attacks.

import { Log, SendEvent } from "../../core/meta.js";
import { CONFIG } from "../../core/config.js";
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

		const initiator = result.type === "player-attacks" ? playerState : result.attacker;
		const recipient = result.type === "player-attacks" ? result.target : playerState;

		if (CONFIG.CUSTOM_EVENTS.Entities.collision) {
			if (initiator.customEvents.collision) SendEvent(initiator.type === "player" ? "PLAYER_COLLISION" : "ENTITY_COLLISION", {
				id         : initiator.id,
				type       : initiator.type,
				position   : { x: initiator.transform.position.x, y: initiator.transform.position.y, z: initiator.transform.position.z },
				velocity   : { x: initiator.velocity.x, y: initiator.velocity.y, z: initiator.velocity.z },
				contactType: "combat",
				otherId    : recipient.id,
			});
			if (recipient.customEvents.collision) SendEvent(recipient.type === "player" ? "PLAYER_COLLISION" : "ENTITY_COLLISION", {
				id         : recipient.id,
				type       : recipient.type,
				position   : { x: recipient.transform.position.x, y: recipient.transform.position.y, z: recipient.transform.position.z },
				velocity   : { x: recipient.velocity.x, y: recipient.velocity.y, z: recipient.velocity.z },
				contactType: "combat",
				otherId    : initiator.id,
			});
		}

		if (result.type === "player-attacks") {
			// === ENEMY TAKES DAMAGE ===
			const entity = result.target;
			if (entity.type !== "enemy") continue;

			entity.hp--;
			Log("ENGINE", `Enemy "${entity.id}" hit by player. HP: ${entity.hp}`, "log", "Level");

			if (CONFIG.CUSTOM_EVENTS.Entities.damageReceived && entity.customEvents.damageReceived) {
				SendEvent("ENTITY_DAMAGE_RECEIVED", {
					id      : entity.id,
					type    : entity.type,
					position: { x: entity.transform.position.x, y: entity.transform.position.y, z: entity.transform.position.z },
					velocity: { x: entity.velocity.x, y: entity.velocity.y, z: entity.velocity.z },
					amount  : 1,
					sourceId: playerState.id,
				});
			}
			if (CONFIG.CUSTOM_EVENTS.Entities.damageInflicted && playerState.customEvents.damageInflicted) {
				SendEvent("PLAYER_DAMAGE_INFLICTED", {
					id      : playerState.id,
					type    : playerState.type,
					position: { x: playerState.transform.position.x, y: playerState.transform.position.y, z: playerState.transform.position.z },
					velocity: { x: playerState.velocity.x, y: playerState.velocity.y, z: playerState.velocity.z },
					amount  : 1,
					targetId: entity.id,
				});
			}

			if (entity.hp <= 0) {
				const idx = entities.indexOf(entity);
				if (idx !== -1) {
					if (entity.customEvents.despawn && CONFIG.CUSTOM_EVENTS.Entities.despawn) {
						SendEvent("ENTITY_DESPAWN", {
							id      : entity.id,
							type    : entity.type,
							position: { x: entity.transform.position.x, y: entity.transform.position.y, z: entity.transform.position.z },
							velocity: { x: entity.velocity.x, y: entity.velocity.y, z: entity.velocity.z },
						});
					}
					entities.splice(idx, 1);
				}
				Log("ENGINE", `Enemy "${entity.id}" destroyed.`, "log", "Level");
				SendEvent("ENEMY_DESTROYED", { id: entity.id });
			}
		}
		else if (result.type === "entity-attacks" && !playerState.invulnerable.active) {
			// === PLAYER TAKES DAMAGE ===
			const entity = result.attacker;
			if (entity.type !== "enemy") continue;

			if (CONFIG.CUSTOM_EVENTS.Entities.damageInflicted && entity.customEvents.damageInflicted) {
				SendEvent("ENTITY_DAMAGE_INFLICTED", {
					id      : entity.id,
					type    : entity.type,
					position: { x: entity.transform.position.x, y: entity.transform.position.y, z: entity.transform.position.z },
					velocity: { x: entity.velocity.x, y: entity.velocity.y, z: entity.velocity.z },
					amount  : 1,
					targetId: playerState.id,
				});
			}

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

	if (CONFIG.CUSTOM_EVENTS.Entities.damageReceived && playerState.customEvents.damageReceived) {
		SendEvent("PLAYER_DAMAGE_RECEIVED", {
			id          : playerState.id,
			type        : playerState.type,
			position    : { x: playerState.transform.position.x, y: playerState.transform.position.y, z: playerState.transform.position.z },
			velocity    : { x: playerState.velocity.x, y: playerState.velocity.y, z: playerState.velocity.z },
			collectibles: playerState.collectibles,
			dropped     : dropCount,
			amount      : 1,
		});
	}
}

/* === EXPORTS === */

export { HandleEnemyCollisions };
