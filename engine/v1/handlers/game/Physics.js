// Enforces the Physics Pipeline

// Used by any Entity state manager to apply physics to moving entities.
// Uses all Modules in the physics directory.

import { CONFIG } from "../../core/config.js";
import { Log, SendEvent, EPSILON } from "../../core/meta.js";
import { CloneVector3, ScaleVector3, ToVector3, WORLD_NORMALS } from "../../math/Vector3.js";
import { ApplyGravity } from "../../physics/Gravity.js";
import { AIR_DRAG_COEFFICIENT, WATER_DRAG_COEFFICIENT } from "../../physics/Resistance.js";
import { ComputeBuoyancyDeltaV } from "../../physics/Buoyancy.js";
import {
	DetectPhysicsCollisions,
	DetectCurrentPhysicsOverlaps,
	ResolveCollisions,
	ResetCollisionPools,
	ProbeGroundContact,
} from "../../physics/Collision.js";
import {
	ApplySurfaceCorrection,
	ApplyGroundSnap,
	ApplyPlayerSurfaceOrientation,
} from "../../physics/Correction.js";
import { TriggerPlayerRespawnSequence } from "../../player/Master.js";
import { UpdatePlayerModelFromState, SyncPlayerCollisionFromState } from "../../player/Model.js";
import { UpdateEntityModelFromTransform } from "../../builder/NewEntity.js";

function rebuildBounds(entity) {
	if (entity.type === "player") {
		UpdatePlayerModelFromState(entity);
		SyncPlayerCollisionFromState(entity);
		return;
	}

	UpdateEntityModelFromTransform(entity);
}

function applyOrientation(entity) {
	if (entity.type === "player") return ApplyPlayerSurfaceOrientation(entity);
	return { changedOrientation: false, anyChanged: false };
}

function applyCorrection(entity, groundContact, deltaSeconds) {
	if (entity.type === "player") return ApplySurfaceCorrection(entity, groundContact, deltaSeconds);
	return {
		changedGrounded: false,
		changedOrientation: false,
		changedPosition: false,
		changedVelocity: false,
		anyChanged: false,
	};
}

function applyFinalGroundSnap(entity, groundContact) {
	if (entity.type === "player") return ApplyGroundSnap(entity, groundContact);
	return {
		changedGrounded: false,
		changedOrientation: false,
		changedPosition: false,
		changedVelocity: false,
		anyChanged: false,
	};
}

function storePlayerTriggers(playerState, triggers) {
	playerState.activeTriggers.length = 0;
	for (let index = 0; index < triggers.count; index++) playerState.activeTriggers.push(triggers.items[index]);
}

function hasZeroDisplacement(displacement) {
	return (
		Math.abs(displacement.x) <= EPSILON &&
		Math.abs(displacement.y) <= EPSILON &&
		Math.abs(displacement.z) <= EPSILON
	);
}

function transformMatchesCachedPhysicsState(entity) {
	const cache = entity.physicsRuntime;
	return (
		entity.transform.position.x === cache.previousPosition.x &&
		entity.transform.position.y === cache.previousPosition.y &&
		entity.transform.position.z === cache.previousPosition.z &&
		entity.transform.rotation.x === cache.previousRotation.x &&
		entity.transform.rotation.y === cache.previousRotation.y &&
		entity.transform.rotation.z === cache.previousRotation.z
	);
}

function shouldSkipCollisionPipeline(entity, displacement) {
	const cache = entity.physicsRuntime;
	return (
		cache.cachePrimed === true &&
		cache.hasUnresolvedPenetration === false &&
		hasZeroDisplacement(displacement) &&
		transformMatchesCachedPhysicsState(entity)
	);
}

function updatePhysicsRuntimeCache(entity, hasUnresolvedPenetration) {
	const cache = entity.physicsRuntime;
	cache.previousPosition.set(entity.transform.position);
	cache.previousRotation.set(entity.transform.rotation);
	cache.hasUnresolvedPenetration = hasUnresolvedPenetration;
	cache.cachePrimed = true;
}

function runPhysicsLoop(entity, sceneGraph, deltaSeconds, displacement) {
	let latestTriggers = null;
	let groundContact = { hit: false, normal: CloneVector3(WORLD_NORMALS.Up) };
	let iterations = 0;
	let hadMeaningfulWork = false;

	applyOrientation(entity);
	rebuildBounds(entity);

	ResetCollisionPools();
	const swept = DetectPhysicsCollisions(entity, displacement, sceneGraph);
	const sweptResolution = ResolveCollisions(entity.velocity, displacement, swept.solids);
	entity.velocity.set(sweptResolution.resolvedVelocity);
	entity.transform.position.add(sweptResolution.resolvedDisplacement);
	if (sweptResolution.groundContact.hit) groundContact = sweptResolution.groundContact;
	latestTriggers = swept.triggers;
	hadMeaningfulWork = hadMeaningfulWork || sweptResolution.anyChanged;

	const gc = sweptResolution.groundContact;
	const wc = sweptResolution.wallContact;
	const collisionKey = swept.solids.count > 0
		? (gc.hit && wc.hit ? "ground+wall" : gc.hit ? "ground" : wc.hit ? "wall" : "solid")
		: "";
	const isNewContact = collisionKey !== "" && collisionKey !== entity.physicsRuntime.lastPhysicsCollisionKey;
	if (collisionKey !== "") {
		entity.physicsRuntime.lastPhysicsCollisionKey = collisionKey;
	} else if (entity.type !== "player" || !entity.grounded) {
		entity.physicsRuntime.lastPhysicsCollisionKey = "";
	}

	if (isNewContact && entity.customEvents.collision && CONFIG.CUSTOM_EVENTS.Entities.collision) {
		SendEvent(entity.type === "player" ? "PLAYER_COLLISION" : "ENTITY_COLLISION", {
			id           : entity.id,
			type         : entity.type,
			position     : CloneVector3(entity.transform.position),
			velocity     : CloneVector3(entity.velocity),
			contactType  : "physics",
			groundContact: gc.hit,
			wallContact  : wc.hit,
			contactNormal: gc.hit ? CloneVector3(gc.normal) : wc.hit ? CloneVector3(wc.normal) : null,
		});
	}

	applyOrientation(entity);
	rebuildBounds(entity);

	for (iterations = 0; iterations < 3; iterations++) {
		ResetCollisionPools();
		const overlaps = DetectCurrentPhysicsOverlaps(entity, sceneGraph);
		const overlapResolution = ResolveCollisions(entity.velocity, ToVector3(0), overlaps.solids);
		if (overlapResolution.groundContact.hit) groundContact = overlapResolution.groundContact;
		entity.velocity.set(overlapResolution.resolvedVelocity);
		if (overlapResolution.changedPosition) entity.transform.position.add(overlapResolution.resolvedDisplacement);
		latestTriggers = overlaps.triggers;
		hadMeaningfulWork = hadMeaningfulWork || overlapResolution.anyChanged;

		rebuildBounds(entity);

		if (entity.type === "player") groundContact = ProbeGroundContact(entity, sceneGraph);
		const correction = applyCorrection(entity, groundContact, deltaSeconds);
		const orientation = applyOrientation(entity);
		hadMeaningfulWork = hadMeaningfulWork || correction.anyChanged || orientation.anyChanged;
		if (
			correction.changedPosition || 
			correction.changedOrientation || 
			orientation.changedOrientation
		) {
			rebuildBounds(entity);
		}

		if (!overlapResolution.anyChanged && !correction.anyChanged && !orientation.anyChanged) break;
	}

	if (entity.type === "player") {
		const jumping = entity.state === "Jumping" && entity.velocity.y > EPSILON;
		if (!jumping) {
			entity.grounded = groundContact.hit &&
				entity.buoyancyForce <= CONFIG.PHYSICS.Gravity.Strength.value;
		}
	}

	const snap = applyFinalGroundSnap(entity, groundContact);
	const finalOrientation = applyOrientation(entity);
	hadMeaningfulWork = hadMeaningfulWork || snap.anyChanged || finalOrientation.anyChanged;
	if (
		snap.changedPosition ||
		snap.changedOrientation || 
		finalOrientation.changedOrientation
	) {
		rebuildBounds(entity);
	}

	ResetCollisionPools();
	const finalOverlaps = DetectCurrentPhysicsOverlaps(entity, sceneGraph);
	latestTriggers = finalOverlaps.triggers;
	const hasUnresolvedPenetration = finalOverlaps.solids.count > 0;
	if (entity.type === "player" && hadMeaningfulWork && iterations) {
		Log(
			"ENGINE",
			`Collision/correction loop finished: iterations=${iterations}`,
			"log",
			"Level"
		);
	}

	return { groundContact, triggers: latestTriggers, hasUnresolvedPenetration };
}

/**
 * Full physics pipeline for the player entity each fixed frame.
 * Order: gravity → buoyancy → resistance → floatiness → displacement → collision detect → resolve → position → correction → death barrier.
 *
 * @param {object} playerState — full mutable player state.
 * @param {object} sceneGraph — active scene graph.
 * @param {number} deltaSeconds
 */
function ApplyPhysicsPipeline(playerState, sceneGraph, deltaSeconds) {
	const deathBarrierY = sceneGraph.world.deathBarrierY.value;
	const wasGrounded = playerState.grounded;

	// Compute submergence ratio (0–1): fraction of capsule below waterLevel.
	const profile = playerState.collision.profile;
	const capsuleBottom = playerState.transform.position.y + profile.bottomOffset.value;
	const capsuleHeight = 2 * (profile.capsuleRadius.value + profile.capsuleHalfHeight.value);
	const submergence = sceneGraph.world.waterLevel !== null
		? Math.max(0, Math.min(1, (sceneGraph.world.waterLevel.value - capsuleBottom) / capsuleHeight))
		: 0;
	playerState.submergence = submergence;
	playerState.buoyancyForce = 0;
	playerState.underwater = submergence >= 0.5;

	// Steps 1–4: Gravity → Buoyancy → Resistance → Floatiness (unified vertical step).
	const gravity = CONFIG.PHYSICS.Gravity.Strength.value;
	const k = AIR_DRAG_COEFFICIENT + (WATER_DRAG_COEFFICIENT - AIR_DRAG_COEFFICIENT) * submergence;
	const meta = playerState.character.meta;
	const activeFloatiness = playerState.underwater ? meta.waterFloatiness : meta.airFloatiness;
	const buoyancyDeltaV = ComputeBuoyancyDeltaV(
		playerState.transform.position, sceneGraph.world.waterLevel, submergence, deltaSeconds, playerState
	);
	playerState.velocity.y = StepVerticalVelocity(
		playerState.velocity.y, gravity, k, buoyancyDeltaV, activeFloatiness, deltaSeconds
	);

	// Horizontal resistance (floatiness is vertical only; gravity and buoyancy are vertical-only).
	const hFactor = 1 - k * deltaSeconds;
	playerState.velocity.x *= hFactor;
	playerState.velocity.z *= hFactor;

	// Step 5: Compute intended displacement.
	const displacement = ScaleVector3(playerState.velocity, deltaSeconds);
	const shouldSkipCollision = shouldSkipCollisionPipeline(playerState, displacement);
	let hasUnresolvedPenetration = playerState.physicsRuntime.hasUnresolvedPenetration;

	// Step 6: Collision & Correction Pipeline
	if (!shouldSkipCollision) {
		const physicsResult = runPhysicsLoop(playerState, sceneGraph, deltaSeconds, displacement);
		storePlayerTriggers(playerState, physicsResult.triggers);
		hasUnresolvedPenetration = physicsResult.hasUnresolvedPenetration;
	}

	// Step 9: Death barrier check.
	if (playerState.transform.position.y < deathBarrierY) {
		playerState.transform.position.y = deathBarrierY;
		playerState.velocity.y = 0;
		rebuildBounds(playerState);
		if (playerState.state !== "Dead") {
			Log("ENGINE", "Player hit death barrier.", "log", "Level");
			TriggerPlayerRespawnSequence();
		}
	}

	updatePhysicsRuntimeCache(playerState, hasUnresolvedPenetration);

	if (playerState.grounded !== wasGrounded && playerState.customEvents.groundedChange && CONFIG.CUSTOM_EVENTS.Entities.groundedChange) {
		SendEvent("PLAYER_GROUNDED_CHANGE", {
			id      : playerState.id,
			type    : playerState.type,
			position: CloneVector3(playerState.transform.position),
			velocity: CloneVector3(playerState.velocity),
			grounded: playerState.grounded,
		});
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
	// Check if Physics are Enabled for this entity.
	if (!entity.movement.physics) return;

	const deathBarrierY = sceneGraph.world.deathBarrierY.value;

	// Gravity.
	entity.velocity.set(ApplyGravity(entity.velocity, deltaSeconds));

	// Calculate Displacement
	const displacement = ScaleVector3(entity.velocity, deltaSeconds);
	const shouldSkipCollision = shouldSkipCollisionPipeline(entity, displacement);
	let hasUnresolvedPenetration = entity.physicsRuntime.hasUnresolvedPenetration;

	// Apply Collision & Correction Pipeline
	if (!shouldSkipCollision) {
		const physicsResult = runPhysicsLoop(entity, sceneGraph, deltaSeconds, displacement);
		hasUnresolvedPenetration = physicsResult.hasUnresolvedPenetration;
	}

	// Death barrier.
	if (entity.transform.position.y < deathBarrierY) {
		entity.transform.position.y = deathBarrierY;
		entity.velocity.y = 0;
		rebuildBounds(entity);
	}

	updatePhysicsRuntimeCache(entity, hasUnresolvedPenetration);
}

/**
 * One frame of the composed vertical force step, shared by ApplyPhysicsPipeline (runtime)
 * and the jump solver in Movement.js. Order: gravity → buoyancy → resistance → floatiness.
 * @param {number} vy
 * @param {number} gravity — CONFIG.PHYSICS.Gravity.Strength.value
 * @param {number} k — drag coefficient for this medium/frame
 * @param {number} buoyancyDeltaV — upward ΔV this frame (0 if not submerged / disabled)
 * @param {number} floatiness — active airFloatiness or waterFloatiness (> 0, authored)
 * @param {number} dt
 * @returns {number}
 */
function StepVerticalVelocity(vy, gravity, k, buoyancyDeltaV, floatiness, dt) {
	const vyBefore = vy;
	vy -= gravity * dt;
	vy += buoyancyDeltaV;
	vy *= (1 - k * dt);
	return vyBefore + (vy - vyBefore) / floatiness;
}

/* === EXPORTS === */

export { ApplyPhysicsPipeline, ApplyEntityPhysics, ResetCollisionPools, StepVerticalVelocity };
