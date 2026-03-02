// Enforces the Physics Pipeline

// Used by any Entity state manager to apply physics to moving entities.
// Uses all Modules in the physics directory.

import { CONFIG } from "../../core/config.js";
import { Log } from "../../core/meta.js";
import {
	NormalizeVector3,
	AddVector3,
	scaleVector3,
	vector3Length,
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
	if (!playerState || !playerState.active) { return; }

	const dt = ToNumber(deltaSeconds, 0);
	const world = sceneGraph && sceneGraph.world ? sceneGraph.world : {};
	const waterLevel = ToNumber(world.waterLevel, -9999);
	const deathBarrierY = ToNumber(world.deathBarrierY, -25);
	const pos = playerState.transform.position;

	// Determine medium.
	playerState.underwater = pos.y < waterLevel;
	const medium = playerState.underwater ? "water" : "air";

	// Step 1: Gravity (if not grounded or always apply — ground correction will nullify).
	if (!playerState.grounded) {
		const gravityOptions = playerState.underwater ? { strengthOverride: ToNumber(CONFIG.PHYSICS.Gravity.Strength, 25) * 0.4 } : {};
		playerState.velocity = ApplyGravity(playerState.velocity, dt, gravityOptions);
	}

	// Step 2: Resistance (drag).
	playerState.velocity = ApplyResistance(playerState.velocity, dt, medium);

	// Step 3: Buoyancy (underwater float).
	if (playerState.underwater) {
		playerState.velocity = ApplyBuoyancy(playerState.velocity, pos, waterLevel, dt);
	}

	// Step 4: Compute intended displacement.
	const displacement = scaleVector3(playerState.velocity, dt);

	// Step 5: Collision detection (swept AABB).
	const { solids, triggers } = DetectCollisions(playerState, displacement, sceneGraph);

	// Step 6: Resolve solid collisions (slide, ground contact).
	const { resolvedVelocity, resolvedDisplacement, groundContact } = ResolveCollisions(
		playerState.velocity,
		displacement,
		solids
	);

	playerState.velocity = resolvedVelocity;

	// Step 7: Apply displacement to position.
	playerState.transform.position = AddVector3(pos, resolvedDisplacement);

	// Step 8: Surface alignment / correction.
	ApplySurfaceAlignment(playerState, groundContact, dt);

	// Step 9: Death barrier check.
	if (playerState.transform.position.y < deathBarrierY) {
		playerState.transform.position.y = deathBarrierY;
		playerState.velocity.y = 0;
		// Signal death — will be handled by the state machine or Enemy.js.
		if (playerState.state !== "Dead") {
			Log("ENGINE", "Player hit death barrier.", "log", "Level");
		}
	}

	// Store triggered volumes for game-side handling.
	playerState.activeTriggers = triggers;
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
	if (!entity) { return; }

	const movement = entity.movement || {};
	const world = sceneGraph && sceneGraph.world ? sceneGraph.world : {};
	const deathBarrierY = ToNumber(world.deathBarrierY, -25);
	const dt = ToNumber(deltaSeconds, 0);

	if (!entity.velocity) {
		entity.velocity = { x: 0, y: 0, z: 0 };
	}
	if (!entity.transform) {
		entity.transform = { position: { x: 0, y: 0, z: 0 } };
	}
	if (!entity.transform.position) {
		entity.transform.position = { x: 0, y: 0, z: 0 };
	}

	if (!movement.physics) {
		return;
	}

	// Gravity.
	entity.velocity = ApplyGravity(entity.velocity, dt);

	// Simple collision for physics-enabled entities.
	const entityPos = entity.transform.position;

	if (entity.collision && entity.collision.aabb) {
		const displacement = scaleVector3(entity.velocity, dt);
		const { solids } = DetectCollisions(entity, displacement, sceneGraph);
		if (solids.length > 0) {
			const { resolvedVelocity, resolvedDisplacement } = ResolveCollisions(entity.velocity, displacement, solids);
			entity.velocity = resolvedVelocity;
			entity.transform.position = AddVector3(entityPos, resolvedDisplacement);
		} else {
			entity.transform.position = AddVector3(entityPos, displacement);
		}
	} else {
		entity.transform.position = AddVector3(entityPos, scaleVector3(entity.velocity, dt));
	}

	// Death barrier.
	if (entity.transform.position.y < deathBarrierY) {
		entity.transform.position.y = deathBarrierY;
		entity.velocity.y = 0;
	}
}

/* === EXPORTS === */

export { ApplyPhysicsPipeline, ApplyEntityPhysics };
