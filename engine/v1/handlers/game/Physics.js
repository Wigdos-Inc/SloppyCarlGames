// Enforces the Physics Pipeline

// Used by any Entity state manager to apply physics to moving entities.
// Uses all Modules in the physics directory.

import { CONFIG } from "../../core/config.js";
import { Log } from "../../core/meta.js";
import {
	NormalizeVector3,
	AddVector3,
	ScaleVector3,
	Vector3Length,
} from "../../math/Vector3.js";
import { ToNumber } from "../../math/Utilities.js";
import { ApplyGravity } from "../../physics/Gravity.js";
import { ApplyResistance } from "../../physics/Resistance.js";
import { ApplyBuoyancy } from "../../physics/Buoyancy.js";
import { DetectCollisions, ResolveCollisions } from "../../physics/Collision.js";
import { ApplySurfaceAlignment } from "../../physics/Correction.js";

/**
 * Full physics pipeline for the player entity each fixed frame.
 * Order: gravity → resistance → buoyancy → displacement → collision detect → resolve → position → correction → death barrier.
 *
 * @param {object} playerState — full mutable player state.
 * @param {object} sceneGraph — active scene graph.
 * @param {number} deltaSeconds
 */
function ApplyPhysicsPipeline(playerState, sceneGraph, deltaSeconds) {
	const dt = ToNumber(deltaSeconds, 0);
	const world = sceneGraph.world;
	const waterLevel = world.waterLevel;
	const deathBarrierY = world.deathBarrierY.value;
	const pos = playerState.transform.position;

	// Determine medium.
	playerState.underwater = waterLevel && pos.y < waterLevel;
	const medium = playerState.underwater ? "water" : "air";

	// Step 1: Gravity (if not grounded or always apply — ground correction will nullify).
	if (!playerState.grounded) {
		const gravityOptions = playerState.underwater ? { strengthOverride: CONFIG.PHYSICS.Gravity.Strength * 0.4 } : {};
		playerState.velocity.set(ApplyGravity(playerState.velocity, dt, gravityOptions));
	}

	// Step 2: Resistance (drag).
	playerState.velocity.set(ApplyResistance(playerState.velocity, dt, medium));

	// Step 3: Buoyancy (underwater float).
	if (playerState.underwater) {
		playerState.velocity.set(ApplyBuoyancy(playerState.velocity, pos, waterLevel, dt));
	}

	// Step 4: Compute intended displacement.
	const displacement = ScaleVector3(playerState.velocity, dt);

	// Step 4b: Grounded stability.
	// When grounded with negligible displacement, skip the full collision pipeline.
	// Zero-displacement swept AABB cannot detect the ground surface, which would
	// falsely clear grounded and cause a Falling↔Idle oscillation every other frame.
	if (playerState.grounded) {
		const dispLenSq = displacement.x * displacement.x + displacement.y * displacement.y + displacement.z * displacement.z;
		if (dispLenSq < 0.0001) {
			// Standing still on ground: preserve grounded state, skip collision.
			playerState.transform.position.add(displacement);
			if (playerState.transform.position.y < deathBarrierY) {
				playerState.transform.position.y = deathBarrierY;
				playerState.velocity.y = 0;
				if (playerState.state !== "Dead") Log("ENGINE", "Player hit death barrier.", "log", "Level");
			}
			playerState.activeTriggers.length = 0;
			return;
		}

		// Moving while grounded: inject a small downward probe so the Y axis
		// isn't degenerate in swept AABB. This lets the collision system detect
		// ground contact when running, and correctly un-ground when walking off a ledge.
		if (Math.abs(displacement.y) < 0.001) displacement.y = -0.005;
	}

	// Step 5: Collision detection (swept AABB).
	const { solids, triggers } = DetectCollisions(playerState, displacement, sceneGraph);

	// Step 6: Resolve solid collisions (slide, ground contact).
	const { resolvedVelocity, resolvedDisplacement, groundContact } = ResolveCollisions(
		playerState.velocity,
		displacement,
		solids
	);

	playerState.velocity.set(resolvedVelocity);

	// Step 7: Apply displacement to position.
	playerState.transform.position.add(resolvedDisplacement);

	// Step 8: Surface alignment / correction.
	ApplySurfaceAlignment(playerState, groundContact, dt);

	// Step 9: Death barrier check.
	if (playerState.transform.position.y < deathBarrierY) {
		playerState.transform.position.y = deathBarrierY;
		playerState.velocity.y = 0;
		// Signal death — will be handled by the state machine or Enemy.js.
		if (playerState.state !== "Dead") Log("ENGINE", "Player hit death barrier.", "log", "Level");
	}

	// Store triggered volumes for game-side handling.
	playerState.activeTriggers.length = 0;
	for (let index = 0; index < triggers.length; index += 1) {
		playerState.activeTriggers.push(triggers[index]);
	}
}

/**
 * Simplified physics for non-player entities (enemies, collectibles, etc.).
 * Replaces the inline gravity in Level.js.
 * Only applies gravity + death barrier. Collision optional per entity.
 *
 * @param {object} entity
 * @param {object} sceneGraph
 * @param {number} deltaSeconds
 */
function ApplyEntityPhysics(entity, sceneGraph, deltaSeconds) {
	const movement = entity.movement;
	const world = sceneGraph.world;
	const deathBarrierY = world.deathBarrierY.value;

	// Check if Physics are Enabled for this entity.
	if (!movement.physics) return;

	// Gravity.
	entity.velocity.set(ApplyGravity(entity.velocity, deltaSeconds));

	// Simple collision for physics-enabled entities.
	const entityPos = entity.transform.position;

	const displacement = ScaleVector3(entity.velocity, deltaSeconds);
	const { solids } = DetectCollisions(entity, displacement, sceneGraph);
	if (solids.length > 0) {
		const { resolvedVelocity, resolvedDisplacement } = ResolveCollisions(entity.velocity, displacement, solids);
		entity.velocity.set(resolvedVelocity);
		entity.transform.position.add(resolvedDisplacement);
	} else entity.transform.position.add(displacement);

	// Death barrier.
	if (entity.transform.position.y < deathBarrierY) {
		entity.transform.position.y = deathBarrierY;
		entity.velocity.y = 0;
	}
}

/* === EXPORTS === */

export { ApplyPhysicsPipeline, ApplyEntityPhysics };
