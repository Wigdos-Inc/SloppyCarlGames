// Enforces the Physics Pipeline

// Used by handlers/game/Level.js to run physics on each entity every frame.
// Uses physics/Forces.js, Collision.js and Correction.js for each step's results (applied here).
// Uses math/Collision.js to wake resting entities a mover touches.
// Uses builder/NewEntity.js to move the model with the body.
// Uses player/Master.js to respawn the player below the death barrier.

import { CONFIG } from "../core/config.js";
import { Log, SendEvent, EPSILON } from "../core/meta.js";
import { AbsoluteVector3, CloneVector3, CompareVector3, DotVector3, ScaleVector3, ToVector3 } from "../math/Vector3.js";
import { AabbOverlap } from "../math/Collision.js";
import { GetGravity, GetBuoyancy, GetResistance, GetSubmergence, GetFloatiness, GetStaticFriction } from "./Forces.js";
import { DetectPhysicsCollisions, DetectCurrentPhysicsOverlaps, ResolveCollisions, GatherGroundHits, PickGroundContact, NO_GROUND_CONTACT } from "./Collision.js";
import { 
	GetCorrectionFrame, 
	GetSurfaceCorrection, 
	GetGroundSnap, 
	GetSurfaceOrientation, 
	GetGripDemand, 
	GetReferenceNormal, 
	ResolveGrounded, 
	CORRECTION_DISABLED 
} from "./Correction.js";
import { TriggerPlayerDeath } from "../player/Master.js";
import { UpdateEntityModel } from "../builder/NewEntity.js";

// Detection result for an entity with nothing to collide with.
const noContacts = Object.freeze({ items: Object.freeze([]), count: 0 });
const noDetection = Object.freeze({ solids: noContacts, triggers: noContacts });

// Check whether a velocity is small enough to count as standing still.
const isStill = (velocity) => CompareVector3(AbsoluteVector3(velocity), ToVector3(EPSILON), "lesser-loose");

// Check whether a moving entity's box now overlaps this one
function touchedByMover(entity) {
	if (entity.performance.collision === false) return false;
	for (const candidate of entity.performance.collision) {
		if (candidate.type !== "entity" || candidate.ref.physics.lastFrame.resting) continue;
		if (AabbOverlap(candidate.ref.physics.collision.aabb, entity.physics.collision.aabb))    return true;
	}
	return false;
}

// Check whether a resting entity can skip this step.
function isResting(entity) {
	const lastFrame = entity.physics.lastFrame, { position, rotation } = entity.transform;
	return (
		lastFrame.resting && isStill(entity.velocity) &&
		CompareVector3(position, lastFrame.position) && CompareVector3(rotation, lastFrame.rotation) &&
		!touchedByMover(entity)
	);
}

// Record how the step ended for the next step's rest check.
function recordStep(entity) {
	const lastFrame = entity.physics.lastFrame;
	lastFrame.resting = (
		isStill(entity.velocity) &&
		CompareVector3(entity.transform.position, lastFrame.position) &&
		CompareVector3(entity.transform.rotation, lastFrame.rotation)
	);
	lastFrame.position.set(entity.transform.position);
	lastFrame.rotation.set(entity.transform.rotation);
}

function moveEntity(entity, offset, physicsState) {
	entity.transform.position.add(offset);
	physicsState.collision.overlaps    = null;
	physicsState.correction.groundHits = null;
}

// Detect overlaps where the entity stands, reusing the last detection until it moves.
function detectOverlaps(entity, sceneGraph, collision) {
	if (!collision.enabled) return noDetection;
	if (collision.overlaps === null) collision.overlaps = DetectCurrentPhysicsOverlaps(entity, sceneGraph);
	return collision.overlaps;
}

// Probes the ground, then lands this pass's surface correction on the entity before the next pass probes again.
function correctSurface(entity, sceneGraph, physicsState) {
	const { collision, correction } = physicsState;

	// Reuse the ground hits until the entity moves.
	if (collision.enabled) {
		if (correction.groundHits === null) correction.groundHits = GatherGroundHits(entity, sceneGraph, correction.groundReach);
		correction.groundContact = PickGroundContact(entity, correction.groundHits, correction.frameStart);
	}
	else correction.groundContact = NO_GROUND_CONTACT;

	// The last surface stood on outlives a missed probe.
	if (correction.groundContact.hit) entity.physics.lastFrame.groundSurfaceId = correction.groundContact.surfaceId;

	const surface = GetSurfaceCorrection(entity, correction.groundContact, correction.frameStart);
	entity.physics.correction.surfaceContact = surface.surfaceContact;
	entity.physics.correction.surfaceNormal  = surface.surfaceNormal;
	entity.physics.correction.alignedUp      = surface.alignedUp;
	entity.physics.correction.contactGrace   = surface.contactGrace;
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
		entity.physics.correction.contactGrace = frame.contactGrace;
	}
	UpdateEntityModel(entity);

	const swept = collision.enabled ? DetectPhysicsCollisions(entity, displacement, sceneGraph) : noDetection;
	const sweptResolution = ResolveCollisions(entity.velocity, displacement, swept.solids, correction.fold);
	entity.velocity.set(sweptResolution.resolvedVelocity);
	moveEntity(entity, sweptResolution.resolvedDisplacement, physicsState);
	loop.hadMeaningfulWork = loop.hadMeaningfulWork || sweptResolution.anyChanged;

	const { floorImpact, wallImpact, collisionKey } = sweptResolution;
	if      (collisionKey !== "")                   entity.physics.lastFrame.collisionKey = collisionKey;
	else if (!isPlayer || !entity.physics.grounded) entity.physics.lastFrame.collisionKey = "";

	const isNewContact = collisionKey !== "" && collisionKey !== entity.physics.lastFrame.collisionKey;
	if (isNewContact && entity.customEvents.collision && CONFIG.CustomEvents.Entities.Collision) {
		// Report a new contact to the game, naming the floor it hit before any wall.
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

	UpdateEntityModel(entity);

	for (loop.iterations = 0; loop.iterations < 3; loop.iterations++) {
		const overlaps          = detectOverlaps(entity, sceneGraph, collision);
		const overlapResolution = ResolveCollisions(entity.velocity, ToVector3(0), overlaps.solids, correction.fold);

		entity.velocity.set(overlapResolution.resolvedVelocity);
		if (overlapResolution.changedPosition) moveEntity(entity, overlapResolution.resolvedDisplacement, physicsState);
		loop.hadMeaningfulWork = loop.hadMeaningfulWork || overlapResolution.anyChanged;

		UpdateEntityModel(entity);

		const surface = correction.enabled ? correctSurface(entity, sceneGraph, physicsState) : CORRECTION_DISABLED;
		loop.hadMeaningfulWork = loop.hadMeaningfulWork || surface.anyChanged;

		if (!overlapResolution.anyChanged && !surface.anyChanged) break;
	}

	entity.physics.grounded = ResolveGrounded(entity, entity.physics.correction.surfaceContact);
	if (entity.physics.launched && DotVector3(entity.velocity, entity.physics.correction.alignedUp) <= EPSILON) entity.physics.launched = false;

	// Get the conditions (speed and angle) for sticking to walls.
	if (correction.enabled) {
		entity.physics.slopes.gripDemand = GetGripDemand(entity, correction.groundContact, physicsState.deltaSeconds);
		entity.physics.correction.referenceNormal = GetReferenceNormal(entity, physicsState.deltaSeconds);
	}

	const snap = correction.enabled ? GetGroundSnap(entity, correction.groundContact, correction.groundReach) : CORRECTION_DISABLED;
	loop.hadMeaningfulWork = loop.hadMeaningfulWork || snap.anyChanged;
	if (snap.changedPosition) {
		moveEntity(entity, snap.offset, physicsState);
		UpdateEntityModel(entity);
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
		UpdateEntityModel(entity);
	}

	if (isPlayer && loop.hadMeaningfulWork && loop.iterations) {
		Log("ENGINE", `Collision/correction loop finished: iterations=${loop.iterations}`, "log", "Level");
	}
}

// Run an entity through the physics stages its flags enable.
function ApplyPhysicsPipeline(entity, sceneGraph, deltaSeconds) {
	if (isResting(entity)) return;

	const isPlayer = entity.type === "player";
	const entityPhysics = entity.movement.physics;
	const wasGrounded = isPlayer ? entity.physics.grounded : undefined;

	const physicsState = {
		deltaSeconds,
		submergence: 0,
		waterLevel: sceneGraph.world.water.topY,
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
			enabled: CONFIG.Physics.Resistance.Enabled && entityPhysics.resistance && !entity.physics.slopes.isCoasting,
			result : null,
		},
		collision: {
			enabled                 : entity.performance.collision !== false,
			triggers                : null,
			hasUnresolvedPenetration: false,
			overlaps                : null,
		},
		correction: {
			enabled      : entityPhysics.correction,
			frameStart   : null,
			groundReach  : 0,
			fold         : null,
			groundContact: NO_GROUND_CONTACT,
			groundHits   : null,
		},
		loop: {
			iterations       : 0,
			hadMeaningfulWork: false,
		},
	};

	// Measure the water and set the medium every step, even with both water stages off.
	physicsState.submergence   = GetSubmergence(entity, sceneGraph.world.water.topY);
	entity.physics.submergence = physicsState.submergence;
	entity.physics.medium      = physicsState.submergence >= 0.5 ? "Water" : "Air";

	// Reset the buoyant force, leaving it at 0 when buoyancy is off.
	entity.physics.buoyancyForce = 0;

	const yBefore = entity.velocity.y;

	if (physicsState.gravity.enabled) physicsState.gravity.result = entity.velocity.set(GetGravity(entity, physicsState));

	if (physicsState.buoyancy.enabled) {
		physicsState.buoyancy.result = GetBuoyancy(entity, physicsState);
		entity.physics.buoyancyForce = physicsState.buoyancy.result.buoyancyForce;
		entity.velocity.y     += physicsState.buoyancy.result.velocityChange;
	}

	if (physicsState.resistance.enabled) physicsState.resistance.result = entity.velocity.set(GetResistance(entity, physicsState));

	if (isPlayer) entity.velocity.y = GetFloatiness(entity, yBefore);
	if (entity.physics.slopes.staticFriction > 0) entity.velocity.set(GetStaticFriction(entity, physicsState, yBefore));

	physicsState.displacement = ScaleVector3(entity.velocity, deltaSeconds);

	runPhysicsLoop(entity, sceneGraph, physicsState);
	if (isPlayer) {
		entity.activeTriggers.length = 0;
		for (let i = 0; i < physicsState.collision.triggers.count; i++) entity.activeTriggers.push(physicsState.collision.triggers.items[i]);
	}

	if (entity.transform.position.y < sceneGraph.world.deathBarrierY.value) {
		entity.transform.position.y = sceneGraph.world.deathBarrierY.value;
		entity.velocity.y = 0;
		UpdateEntityModel(entity);
		if (isPlayer && entity.action !== "Dead") {
			Log("ENGINE", "Player hit death barrier.", "log", "Level");
			TriggerPlayerDeath();
		}
	}

	recordStep(entity);

	if (
		isPlayer && entity.physics.grounded !== wasGrounded && 
		entity.customEvents.groundedChange && 
		CONFIG.CustomEvents.Entities.GroundedChange
	) {
		SendEvent("PLAYER_GROUNDED_CHANGE", {
			id      : entity.id,
			type    : entity.type,
			position: CloneVector3(entity.transform.position),
			velocity: CloneVector3(entity.velocity),
			grounded: entity.physics.grounded,
		});
	}
}

/* === EXPORTS === */

export { ApplyPhysicsPipeline };
