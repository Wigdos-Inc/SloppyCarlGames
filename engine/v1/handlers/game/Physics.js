// Enforces the Physics Pipeline

// Used by any Entity state manager to apply physics to moving entities.
// Uses all Modules in the physics directory.

import { CONFIG } from "../../core/config.js";
import { Log } from "../../core/meta.js";
import { ScaleVector3 } from "../../math/Vector3.js";
import { ToNumber } from "../../math/Utilities.js";
import { ApplyGravity } from "../../physics/Gravity.js";
import { ApplyResistance } from "../../physics/Resistance.js";
import { ApplyBuoyancy } from "../../physics/Buoyancy.js";
import {
	DetectPhysicsCollisions,
	DetectCurrentPhysicsOverlaps,
	ResolveCollisions,
	ResetCollisionPools,
} from "../../physics/Collision.js";
import {
	ApplySurfaceCorrection,
	ApplyGroundSnap,
	ApplyPlayerSurfaceOrientation,
} from "../../physics/Correction.js";
import { UpdatePlayerModelFromState, SyncPlayerCollisionFromState } from "../../player/Model.js";
import { UpdateEntityModelFromTransform } from "../../builder/NewEntity.js";

function RebuildBounds(entity) {
	if (entity.type === "player") {
		UpdatePlayerModelFromState(entity);
		SyncPlayerCollisionFromState(entity);
		return;
	}

	UpdateEntityModelFromTransform(entity);
}

function ApplyOrientation(entity) {
	if (entity.type === "player") return ApplyPlayerSurfaceOrientation(entity);
	return { changedOrientation: false, anyChanged: false };
}

function ApplyCorrection(entity, groundContact, deltaSeconds) {
	if (entity.type === "player") return ApplySurfaceCorrection(entity, groundContact, deltaSeconds);
	return {
		changedGrounded: false,
		changedOrientation: false,
		changedPosition: false,
		changedVelocity: false,
		anyChanged: false,
	};
}

function ApplyFinalGroundSnap(entity, groundContact) {
	if (entity.type === "player") return ApplyGroundSnap(entity, groundContact);
	return {
		changedGrounded: false,
		changedOrientation: false,
		changedPosition: false,
		changedVelocity: false,
		anyChanged: false,
	};
}

function StorePlayerTriggers(playerState, triggers) {
	playerState.activeTriggers.length = 0;
	for (let index = 0; index < triggers.count; index++) playerState.activeTriggers.push(triggers.items[index]);
}

function RunPhysicsLoop(entity, sceneGraph, deltaSeconds, displacement) {
	let latestTriggers = null;
	let groundContact = { hit: false, normal: { x: 0, y: 1, z: 0 } };
	let iterations = 0;
	let hadMeaningfulWork = false;

	ApplyOrientation(entity);
	RebuildBounds(entity);

	ResetCollisionPools();
	const swept = DetectPhysicsCollisions(entity, displacement, sceneGraph);
	const sweptResolution = ResolveCollisions(entity.velocity, displacement, swept.solids);
	entity.velocity.set(sweptResolution.resolvedVelocity);
	entity.transform.position.add(sweptResolution.resolvedDisplacement);
	if (sweptResolution.groundContact.hit) groundContact = sweptResolution.groundContact;
	latestTriggers = swept.triggers;
	hadMeaningfulWork = hadMeaningfulWork || sweptResolution.anyChanged;

	ApplyOrientation(entity);
	RebuildBounds(entity);

	for (iterations = 0; iterations < 3; iterations++) {
		ResetCollisionPools();
		const overlaps = DetectCurrentPhysicsOverlaps(entity, sceneGraph);
		const overlapResolution = ResolveCollisions(entity.velocity, { x: 0, y: 0, z: 0 }, overlaps.solids);
		if (overlapResolution.groundContact.hit) groundContact = overlapResolution.groundContact;
		entity.velocity.set(overlapResolution.resolvedVelocity);
		if (overlapResolution.changedPosition) entity.transform.position.add(overlapResolution.resolvedDisplacement);
		latestTriggers = overlaps.triggers;
		hadMeaningfulWork = hadMeaningfulWork || overlapResolution.anyChanged;

		RebuildBounds(entity);

		const correction = ApplyCorrection(entity, groundContact, deltaSeconds);
		const orientation = ApplyOrientation(entity);
		hadMeaningfulWork = hadMeaningfulWork || correction.anyChanged || orientation.anyChanged;
		if (
			correction.changedPosition || 
			correction.changedOrientation || 
			orientation.changedOrientation
		) {
			RebuildBounds(entity);
		}

		if (!overlapResolution.anyChanged && !correction.anyChanged && !orientation.anyChanged) break;
	}

	const snap = ApplyFinalGroundSnap(entity, groundContact);
	const finalOrientation = ApplyOrientation(entity);
	hadMeaningfulWork = hadMeaningfulWork || snap.anyChanged || finalOrientation.anyChanged;
	if (
		snap.changedPosition ||
		snap.changedOrientation || 
		finalOrientation.changedOrientation
	) {
		RebuildBounds(entity);
	}

	ResetCollisionPools();
	latestTriggers = DetectCurrentPhysicsOverlaps(entity, sceneGraph).triggers;
	if (entity.type === "player" && hadMeaningfulWork && iterations) {
		Log(
			"ENGINE",
			`Collision/correction loop finished: iterations=${iterations}`,
			"log",
			"Level"
		);
	}

	return { groundContact: groundContact, triggers: latestTriggers };
}

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
	if (playerState.underwater) playerState.velocity.set(ApplyBuoyancy(playerState.velocity, pos, waterLevel, dt));

	// Step 4: Compute intended displacement.
	const displacement = ScaleVector3(playerState.velocity, dt);

	// Step 4b: Grounded stability.
	// Grounded frames still need a small downward probe so landing correction can
	// revalidate and snap while idle instead of preserving a hover gap indefinitely.
	if (playerState.grounded && Math.abs(displacement.y) < 0.001) displacement.y = -0.005;

	// Step 5: Collision & Correction Pipeline
	const { triggers } = RunPhysicsLoop(playerState, sceneGraph, dt, displacement);

	// Step 9: Death barrier check.
	if (playerState.transform.position.y < deathBarrierY) {
		playerState.transform.position.y = deathBarrierY;
		playerState.velocity.y = 0;
		RebuildBounds(playerState);
		// Signal death — will be handled by the state machine or Enemy.js.
		if (playerState.state !== "Dead") Log("ENGINE", "Player hit death barrier.", "log", "Level");
	}

	// Store triggered volumes for game-side handling.
	StorePlayerTriggers(playerState, triggers);
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
	// Check if Physics are Enabled for this entity.
	if (!entity.movement.physics) return;

	const deathBarrierY = sceneGraph.world.deathBarrierY.value;

	// Gravity.
	entity.velocity.set(ApplyGravity(entity.velocity, deltaSeconds));

	// Calculate Displacement
	const displacement = ScaleVector3(entity.velocity, deltaSeconds);

	// Apply Collision & Correction Pipeline
	RunPhysicsLoop(entity, sceneGraph, deltaSeconds, displacement);

	// Death barrier.
	if (entity.transform.position.y < deathBarrierY) {
		entity.transform.position.y = deathBarrierY;
		entity.velocity.y = 0;
		RebuildBounds(entity);
	}
}

/* === EXPORTS === */

export { ApplyPhysicsPipeline, ApplyEntityPhysics, ResetCollisionPools };
