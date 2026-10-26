// Enforces the Physics Pipeline

// Used by any Entity state manager to apply physics to moving entities.
// Uses all Modules in the physics directory, and is the only one that writes their results onto the entity.

import { CONFIG } from "../core/config.js";
import { Log, SendEvent, EPSILON } from "../core/meta.js";
import { AbsoluteVector3, CloneVector3, CompareVector3, DotVector3, ScaleVector3, ToVector3 } from "../math/Vector3.js";
import { GetGravity, GetBuoyancy, GetResistance, GetSubmergence, GetFloatiness, GetStaticFriction } from "./Forces.js";
import { DetectPhysicsCollisions, DetectCurrentPhysicsOverlaps, ResolveCollisions, GatherGroundHits, PickGroundContact, GetEntityPhysicsFlags, NO_GROUND_CONTACT } from "./Collision.js";
import { GetCorrectionFrame, GetSurfaceCorrection, GetGroundSnap, GetSurfaceOrientation, GetGripDemand, GetReferenceNormal, ResolveGrounded, CORRECTION_DISABLED } from "./Correction.js";
import { TriggerPlayerRespawnSequence } from "../player/Master.js";
import { UpdateEntityModelFromTransform } from "../builder/NewEntity.js";

// Detection result for an entity with nothing to collide with.
const noContacts = Object.freeze({ items: Object.freeze([]), count: 0 });
const noDetection = Object.freeze({ solids: noContacts, triggers: noContacts });

function shouldSkipCollisionPipeline(entity, displacement) {
	return (
		entity.physicsRuntime.cachePrimed === true &&
		entity.physicsRuntime.hasUnresolvedPenetration === false &&
		CompareVector3(AbsoluteVector3(displacement), ToVector3(EPSILON), "lesser-loose") &&
		CompareVector3(entity.transform.position, entity.physicsRuntime.lastPosition) &&
		CompareVector3(entity.transform.rotation, entity.physicsRuntime.lastRotation)
	);
}

function updatePhysicsRuntimeCache(entity, hasUnresolvedPenetration) {
	entity.physicsRuntime.lastPosition.set(entity.transform.position);
	entity.physicsRuntime.lastRotation.set(entity.transform.rotation);
	entity.physicsRuntime.hasUnresolvedPenetration = hasUnresolvedPenetration;
	entity.physicsRuntime.cachePrimed = true;
}

// Moves the entity; the player's detections from its old position no longer apply.
function moveEntity(entity, offset, physicsState) {
	entity.transform.position.add(offset);
	physicsState.collision.overlaps    = null;
	physicsState.correction.groundHits = null;
}

// Overlaps where the entity stands; the player reuses its last detection until it moves.
function detectOverlaps(entity, sceneGraph, collision) {
	if (!collision.enabled) return noDetection;
	if (entity.type !== "player" || collision.overlaps === null) collision.overlaps = DetectCurrentPhysicsOverlaps(entity, sceneGraph);
	return collision.overlaps;
}

// Probes the ground, then lands this pass's surface correction on the entity before the next pass probes again.
function correctSurface(entity, sceneGraph, physicsState) {
	const { collision, correction } = physicsState;

	// The player's ground hits are gathered again only after it moves; they're classified and ranked every pass.
	if (collision.enabled) {
		if (entity.type !== "player" || correction.groundHits === null) correction.groundHits = GatherGroundHits(entity, sceneGraph, correction.groundReach);
		correction.groundContact = PickGroundContact(entity, correction.groundHits, correction.frameStart);
	}
	else correction.groundContact = NO_GROUND_CONTACT;

	// The last surface stood on outlives a missed probe.
	if (correction.groundContact.hit) entity.physicsRuntime.groundSurfaceId = correction.groundContact.surfaceId;

	const surface = GetSurfaceCorrection(entity, correction.groundContact, correction.frameStart);
	entity.surfaceContact = surface.surfaceContact;
	entity.contactGrace   = surface.contactGrace;
	entity.surfaceNormal  = surface.surfaceNormal;
	entity.alignedUp      = surface.alignedUp;
	entity.velocity.set(surface.velocity);
	return surface;
}

function runPhysicsLoop(entity, sceneGraph, physicsState) {
	const isPlayer = entity.type === "player";
	const { displacement, collision, correction, loop } = physicsState;

	if (correction.enabled) {
		const frame = GetCorrectionFrame(entity, physicsState);
		correction.frameStart  = frame.frameStart;
		correction.groundReach = frame.groundReach;
		correction.fold        = frame.fold;
		entity.contactGrace    = frame.contactGrace;
	}
	UpdateEntityModelFromTransform(entity);

	const swept = collision.enabled ? DetectPhysicsCollisions(entity, displacement, sceneGraph) : noDetection;
	const sweptResolution = ResolveCollisions(entity.velocity, displacement, swept.solids, correction.fold);
	entity.velocity.set(sweptResolution.resolvedVelocity);
	moveEntity(entity, sweptResolution.resolvedDisplacement, physicsState);
	loop.hadMeaningfulWork = loop.hadMeaningfulWork || sweptResolution.anyChanged;

	const { floorImpact, wallImpact, collisionKey } = sweptResolution;
	const isNewContact = collisionKey !== "" && collisionKey !== entity.physicsRuntime.lastPhysicsCollisionKey;
	if (collisionKey !== "") entity.physicsRuntime.lastPhysicsCollisionKey = collisionKey;
	else if (!isPlayer || !entity.grounded) entity.physicsRuntime.lastPhysicsCollisionKey = "";

	if (isNewContact && entity.customEvents.collision && CONFIG.CustomEvents.Entities.Collision) {
		// Floor wins the normal/surface; wall is the fallback.
		const impact = floorImpact.hit ? floorImpact : wallImpact;
		SendEvent(isPlayer ? "PLAYER_COLLISION" : "ENTITY_COLLISION", {
			id         : entity.id,
			type       : entity.type,
			position   : CloneVector3(entity.transform.position),
			velocity   : CloneVector3(entity.velocity),
			contactType: "physics",
			collision  : {
				result  : collisionKey,
				normal  : impact.hit ? CloneVector3(impact.normal) : null,
				approach: wallImpact.approach,
				surface : impact.type,
			},
		});
	}

	UpdateEntityModelFromTransform(entity);

	for (loop.iterations = 0; loop.iterations < 3; loop.iterations++) {
		const overlaps = detectOverlaps(entity, sceneGraph, collision);
		const overlapResolution = ResolveCollisions(entity.velocity, ToVector3(0), overlaps.solids, correction.fold);

		entity.velocity.set(overlapResolution.resolvedVelocity);
		if (overlapResolution.changedPosition) moveEntity(entity, overlapResolution.resolvedDisplacement, physicsState);
		loop.hadMeaningfulWork = loop.hadMeaningfulWork || overlapResolution.anyChanged;

		UpdateEntityModelFromTransform(entity);

		const surface = correction.enabled ? correctSurface(entity, sceneGraph, physicsState) : CORRECTION_DISABLED;
		loop.hadMeaningfulWork = loop.hadMeaningfulWork || surface.anyChanged;

		if (!overlapResolution.anyChanged && !surface.anyChanged) break;
	}

	entity.grounded = ResolveGrounded(entity);
	if (entity.launched && DotVector3(entity.velocity, entity.alignedUp) <= EPSILON) entity.launched = false;

	// Get the conditions (speed and angle) for sticking to walls.
	if (correction.enabled) {
		entity.gripDemand = GetGripDemand(entity, correction.groundContact, physicsState.deltaSeconds);
		entity.referenceNormal = GetReferenceNormal(entity, physicsState.deltaSeconds);
	}

	const snap = correction.enabled ? GetGroundSnap(entity, correction.groundContact, correction.groundReach) : CORRECTION_DISABLED;
	loop.hadMeaningfulWork = loop.hadMeaningfulWork || snap.anyChanged;
	if (snap.changedPosition) {
		moveEntity(entity, snap.offset, physicsState);
		UpdateEntityModelFromTransform(entity);
	}

	const finalOverlaps = detectOverlaps(entity, sceneGraph, collision);
	collision.triggers = finalOverlaps.triggers;
	collision.hasUnresolvedPenetration = finalOverlaps.solids.count > 0;

	// The frame's single orientation write: rotation first, then the position shift that keeps the pivot in place.
	const orientation = correction.enabled ? GetSurfaceOrientation(entity) : CORRECTION_DISABLED;
	loop.hadMeaningfulWork = loop.hadMeaningfulWork || orientation.anyChanged;
	if (orientation.changedOrientation) {
		entity.transform.rotation.set(orientation.rotation);
		entity.transform.position.add(orientation.offset);
		UpdateEntityModelFromTransform(entity);
	}

	if (isPlayer && loop.hadMeaningfulWork && loop.iterations) {
		Log("ENGINE", `Collision/correction loop finished: iterations=${loop.iterations}`, "log", "Level");
	}
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
	const entityPhysics = GetEntityPhysicsFlags(entity);
	const wasGrounded = isPlayer ? entity.grounded : undefined;

	const physicsState = {
		deltaSeconds,
		submergence: 0,
		waterLevel: sceneGraph.world.water.level,
		groundSnapTolerance: 0.01,
		displacement: null,
		gravity: {
			enabled              : CONFIG.Physics.Gravity.Enabled && entityPhysics.gravity,
			strength             : CONFIG.Physics.Gravity.Strength,
			airTerminalVelocity  : CONFIG.Physics.Gravity.TerminalVelocity.Air,
			waterTerminalVelocity: CONFIG.Physics.Gravity.TerminalVelocity.Water,
			result               : null,
		},
		buoyancy: {
			enabled      : CONFIG.Physics.Buoyancy.Enabled && entityPhysics.buoyancy,
			gradientDepth: CONFIG.Physics.Buoyancy.GradientDepth,
			forceMin     : CONFIG.Physics.Buoyancy.Force.Min,
			forceMax     : CONFIG.Physics.Buoyancy.Force.Max,
			result       : null,
		},
		resistance: {
			enabled: CONFIG.Physics.Resistance.Enabled && entityPhysics.resistance && !entity.dragFree,
			result : null,
		},
		collision: {
			enabled                 : entity.performance.collision !== false,
			triggers                : null,
			hasUnresolvedPenetration: entity.physicsRuntime.hasUnresolvedPenetration,
			overlaps                : null,      // Last overlap detection; the player reuses it until it moves.
		},
		correction: {
			enabled      : entityPhysics.correction,
			frameStart   : null,
			groundReach  : 0,
			fold         : null,
			groundContact: NO_GROUND_CONTACT,
			groundHits   : null,                 // Last ground probe hits; the player reuses them until it moves.
		},
		loop: {
			iterations       : 0,
			hadMeaningfulWork: false,
		},
	};

	if (physicsState.buoyancy.enabled || physicsState.resistance.enabled) {
		physicsState.submergence = GetSubmergence(entity, sceneGraph.world.water.level);
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

	if (physicsState.resistance.enabled) physicsState.resistance.result = entity.velocity.set(GetResistance(entity, physicsState));

	if (isPlayer) entity.velocity.y = GetFloatiness(entity, yBefore);
	if (entity.staticFriction > 0) entity.velocity.set(GetStaticFriction(entity, physicsState, yBefore));

	physicsState.displacement = ScaleVector3(entity.velocity, deltaSeconds);

	if (!shouldSkipCollisionPipeline(entity, physicsState.displacement)) {
		runPhysicsLoop(entity, sceneGraph, physicsState);
		if (isPlayer) {
			entity.activeTriggers.length = 0;
			for (let i = 0; i < physicsState.collision.triggers.count; i++) entity.activeTriggers.push(physicsState.collision.triggers.items[i]);
		}
	}

	if (entity.transform.position.y < sceneGraph.world.deathBarrierY.value) {
		entity.transform.position.y = sceneGraph.world.deathBarrierY.value;
		entity.velocity.y = 0;
		UpdateEntityModelFromTransform(entity);
		if (isPlayer && entity.action !== "Dead") {
			Log("ENGINE", "Player hit death barrier.", "log", "Level");
			TriggerPlayerRespawnSequence();
		}
	}

	updatePhysicsRuntimeCache(entity, physicsState.collision.hasUnresolvedPenetration);

	if (
		isPlayer && entity.grounded !== wasGrounded && 
		entity.customEvents.groundedChange && 
		CONFIG.CustomEvents.Entities.GroundedChange
	) {
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

export { ApplyPhysicsPipeline };
