// Enforces the Physics Pipeline

// Used by any Entity state manager to apply physics to moving entities.
// Uses all Modules in the physics directory.

import { CONFIG } from "../core/config.js";
import { Log, SendEvent, EPSILON } from "../core/meta.js";
import { AbsoluteVector3, CloneVector3, ScaleVector3, ToVector3, WORLD_NORMALS } from "../math/Vector3.js";
import { GetGravity, GetBuoyancy, GetResistance, GetSubmergence } from "./Forces.js";
import {
	DetectPhysicsCollisions,
	DetectCurrentPhysicsOverlaps,
	ResolveCollisions,
	ResetCollisionPools,
	ProbeGroundContact,
} from "./Collision.js";
import {
	ApplySurfaceCorrection,
	ApplyGroundSnap,
	ApplyPlayerSurfaceOrientation,
} from "./Correction.js";
import { TriggerPlayerRespawnSequence } from "../player/Master.js";
import { UpdatePlayerModelFromState, SyncPlayerCollisionFromState } from "../player/Model.js";
import { UpdateEntityModelFromTransform } from "../builder/NewEntity.js";

function rebuildBounds(entity) {
	if (entity.type === "player") {
		UpdatePlayerModelFromState(entity);
		SyncPlayerCollisionFromState(entity);
		return;
	}

	UpdateEntityModelFromTransform(entity);
}

const noResult = Object.freeze({
	orientation: Object.freeze({
		changedOrientation: false,
		anyChanged: false,
	}),
	correction: Object.freeze({
		changedGrounded: false,
		changedOrientation: false,
		changedPosition: false,
		changedVelocity: false,
		anyChanged: false,
	}),
});

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
	return (
		entity.transform.position.x === entity.physicsRuntime.previousPosition.x &&
		entity.transform.position.y === entity.physicsRuntime.previousPosition.y &&
		entity.transform.position.z === entity.physicsRuntime.previousPosition.z &&
		entity.transform.rotation.x === entity.physicsRuntime.previousRotation.x &&
		entity.transform.rotation.y === entity.physicsRuntime.previousRotation.y &&
		entity.transform.rotation.z === entity.physicsRuntime.previousRotation.z
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

function runPhysicsLoop(entity, sceneGraph, displacement, physicsState) {
	const isPlayer = entity.type === "player";
	const entityPhysics = isPlayer ? entity.character.physics : entity.movement.physics;
	const applyCorrection = entityPhysics.correction;
	let latestTriggers;
	let groundContact = { hit: false, normal: CloneVector3(WORLD_NORMALS.Up) };
	let iterations;
	let hadMeaningfulWork = false;

	if (applyCorrection) ApplyPlayerSurfaceOrientation(entity);
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
		? (gc.hit && wc.hit ? "ground+wall" : gc.hit ? "ground" : wc.hit ? "wall" : "solid") : "";
	const isNewContact = collisionKey !== "" && collisionKey !== entity.physicsRuntime.lastPhysicsCollisionKey;
	if (collisionKey !== "") entity.physicsRuntime.lastPhysicsCollisionKey = collisionKey;
	else if (!isPlayer || !entity.grounded) entity.physicsRuntime.lastPhysicsCollisionKey = "";

	if (isNewContact && entity.customEvents.collision && CONFIG.CUSTOM_EVENTS.Entities.collision) {
		SendEvent(isPlayer ? "PLAYER_COLLISION" : "ENTITY_COLLISION", {
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

	if (applyCorrection) ApplyPlayerSurfaceOrientation(entity);
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

		if (isPlayer) groundContact = ProbeGroundContact(entity, sceneGraph, physicsState.groundSnapTolerance);
		const correction = applyCorrection ? ApplySurfaceCorrection(entity, groundContact) : noResult.correction;
		const orientation = applyCorrection ? ApplyPlayerSurfaceOrientation(entity) : noResult.orientation;
		hadMeaningfulWork = hadMeaningfulWork || correction.anyChanged || orientation.anyChanged;
		if (correction.changedPosition || correction.changedOrientation || orientation.changedOrientation) {
			rebuildBounds(entity);
		}

		if (!overlapResolution.anyChanged && !correction.anyChanged && !orientation.anyChanged) break;
	}

	if (isPlayer && entity.state !== "Jumping") {
		entity.grounded = groundContact.hit && entity.buoyancyForce <= CONFIG.PHYSICS.Gravity.Strength.value;
	}

	const snap = applyCorrection ? ApplyGroundSnap(entity, groundContact, physicsState.groundSnapTolerance) : noResult.correction;
	const finalOrientation = applyCorrection ? ApplyPlayerSurfaceOrientation(entity) : noResult.orientation;
	hadMeaningfulWork = hadMeaningfulWork || snap.anyChanged || finalOrientation.anyChanged;
	if (snap.changedPosition || snap.changedOrientation || finalOrientation.changedOrientation) rebuildBounds(entity);

	ResetCollisionPools();
	const finalOverlaps = DetectCurrentPhysicsOverlaps(entity, sceneGraph);
	latestTriggers = finalOverlaps.triggers;
	if (isPlayer && hadMeaningfulWork && iterations) {
		Log(
			"ENGINE",
			`Collision/correction loop finished: iterations=${iterations}`,
			"log",
			"Level"
		);
	}

	const hasUnresolvedPenetration = finalOverlaps.solids.count > 0;
	return { groundContact, triggers: latestTriggers, hasUnresolvedPenetration };
}

/**
 * Unified physics pipeline for all entities (player and non-player).
 * Active stages are driven by per-entity flags: movement.physics (entities) or character.physics (player).
 * Order: submergence → gravity → buoyancy → resistance → floatiness* → displacement → collision → correction* → death barrier.
 * (* player-only stages)
 *
 * @param {object} entity — full mutable entity or player state.
 * @param {object} sceneGraph — active scene graph.
 * @param {number} deltaSeconds
 */
function ApplyPhysicsPipeline(entity, sceneGraph, deltaSeconds) {
	const isPlayer = entity.type === "player";
	const entityPhysics = isPlayer ? entity.character.physics : entity.movement.physics;
	const deathBarrierY = sceneGraph.world.deathBarrierY.value;
	const wasGrounded = isPlayer ? entity.grounded : undefined;

	const physicsState = {
		deltaSeconds,
		submergence: 0,
		waterLevel: sceneGraph.world.waterLevel,
		// Hardcoded anti-phasing tolerance (CNU). Owned by the orchestrator and
		// handed to the ground probe / ground-snap assemblers as input, so they
		// consume it rather than defining or sharing it between themselves.
		groundSnapTolerance: 0.01,
		gravity: {
			enabled:               CONFIG.PHYSICS.Gravity.Enabled    && entityPhysics.gravity,
			strength:              CONFIG.PHYSICS.Gravity.Strength.value,
			airTerminalVelocity:   CONFIG.PHYSICS.Gravity.TerminalVelocity.Air.value,
			waterTerminalVelocity: CONFIG.PHYSICS.Gravity.TerminalVelocity.Water.value,
			result: null,
		},
		buoyancy: {
			enabled:       CONFIG.PHYSICS.Buoyancy.Enabled   && entityPhysics.buoyancy,
			gradientDepth: CONFIG.PHYSICS.Buoyancy.GradientDepth.value,
			forceMin:      CONFIG.PHYSICS.Buoyancy.Force.Min.value,
			forceMax:      CONFIG.PHYSICS.Buoyancy.Force.Max.value,
			result: null,
		},
		resistance: {
			enabled: CONFIG.PHYSICS.Resistance.Enabled && entityPhysics.resistance,
			result: null,
		},
	};

	if (physicsState.buoyancy.enabled || physicsState.resistance.enabled) {
		physicsState.submergence = GetSubmergence(entity, sceneGraph.world.waterLevel);
		entity.submergence = physicsState.submergence;
		entity.underwater   = physicsState.submergence >= 0.5;
		entity.buoyancyForce = 0;
	}

	const yBefore = entity.velocity.y;

	if (physicsState.gravity.enabled) physicsState.gravity.result = entity.velocity.set(GetGravity(entity, physicsState));

	if (physicsState.buoyancy.enabled) {
		physicsState.buoyancy.result = GetBuoyancy(entity, physicsState);
		entity.buoyancyForce   = physicsState.buoyancy.result.buoyancyForce;
		entity.velocity.y     += physicsState.buoyancy.result.velocityChange;
	}

	if (physicsState.resistance.enabled) {
		physicsState.resistance.result = entity.velocity.set(GetResistance(entity, physicsState));
	}

	if (isPlayer) {
		const activeFloatiness = entity.underwater ? entity.character.meta.waterFloatiness : entity.character.meta.airFloatiness;
		entity.velocity.y = yBefore + (entity.velocity.y - yBefore) / activeFloatiness;
	}

	const displacement = ScaleVector3(entity.velocity, deltaSeconds);
	let hasUnresolvedPenetration = entity.physicsRuntime.hasUnresolvedPenetration;

	if (!shouldSkipCollisionPipeline(entity, displacement)) {
		const physicsResult = runPhysicsLoop(entity, sceneGraph, displacement, physicsState);
		if (isPlayer) storePlayerTriggers(entity, physicsResult.triggers);
		hasUnresolvedPenetration = physicsResult.hasUnresolvedPenetration;
	}

	if (entity.transform.position.y < deathBarrierY) {
		entity.transform.position.y = deathBarrierY;
		entity.velocity.y = 0;
		rebuildBounds(entity);
		if (isPlayer && entity.state !== "Dead") {
			Log("ENGINE", "Player hit death barrier.", "log", "Level");
			TriggerPlayerRespawnSequence();
		}
	}

	updatePhysicsRuntimeCache(entity, hasUnresolvedPenetration);

	if (isPlayer && entity.grounded !== wasGrounded && entity.customEvents.groundedChange && CONFIG.CUSTOM_EVENTS.Entities.groundedChange) {
		SendEvent("PLAYER_GROUNDED_CHANGE", {
			id      : entity.id,
			type    : entity.type,
			position: CloneVector3(entity.transform.position),
			velocity: CloneVector3(entity.velocity),
			grounded: entity.grounded,
		});
	}
}

/* === EXPORTS === */

export { ApplyPhysicsPipeline, ResetCollisionPools };
