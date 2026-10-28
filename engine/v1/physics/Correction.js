// Corrects velocity, position, rotation, etc to prevent weird clipping or misalignment.

// Used by physics/Master.js, which applies every result it returns.
// Used by physics/Collision.js to classify ground hits, and by handlers/game/Animation.js for the pose pivot.

import { CONFIG, GROUNDING } from "../core/config.js";
import { Log, EPSILON } from "../core/meta.js";
import { AngleBetweenVector3, TransportVector3, DotVector3, MultiplyVector3, RotateByEuler, ScaleVector3, SubtractVector3, ResolveVector3Axis, CloneVector3, CompareVector3, RotateTowardVector3, Vector3Length, WORLD_NORMALS, AbsoluteVector3 } from "../math/Vector3.js";
import { AabbCenter, SurfaceAlignedRotation } from "../math/Collision.js";
import { Clamp, DegreesToRadians } from "../math/Utilities.js";

function hasMeaningfulVectorDelta(vector, corrected) {
	const { x, y, z } = AbsoluteVector3(SubtractVector3(corrected, vector));
	return x > EPSILON || y > EPSILON || z > EPSILON;
}

const CORRECTION_DISABLED = Object.freeze({
	changedContact    : false,
	changedOrientation: false,
	changedPosition   : false,
	changedVelocity   : false,
	anyChanged        : false,
});

// Release the entity from its surface. Orient to world up, keep its velocity, and hold the last pose through the contact grace.
function releasedSurface(entity) {
	const changedContact = entity.surfaceContact !== "none";
	let contactGrace     = entity.contactGrace;
	if (entity.launched) contactGrace = 0;
	else if (changedContact) contactGrace = GROUNDING.ContactGraceMs / 1000;

	const held = contactGrace > EPSILON;
	const changedOrientation = !held && hasMeaningfulVectorDelta(entity.alignedUp, WORLD_NORMALS.Up);

	return {
		surfaceContact : "none",
		contactGrace,
		surfaceNormal  : held ? entity.surfaceNormal : CloneVector3(WORLD_NORMALS.Up),
		alignedUp      : held ? entity.alignedUp : CloneVector3(WORLD_NORMALS.Up),
		velocity       : entity.velocity,
		changedContact, changedOrientation,
		changedPosition: false,
		changedVelocity: false,
		anyChanged     : changedContact || changedOrientation,
	};
}

const angleBetweenDegrees = (a, b) => (AngleBetweenVector3(a, b) * 180) / Math.PI;
const angleLimitsFor      = (underwater) => CONFIG.Physics.Correction.MaxAngleDelta[underwater ? "Water" : "Air"];

// Capture what the correction loop keeps fixed for the step, plus this step's decayed contact grace.
function GetCorrectionFrame(entity, physicsState) {
	const groundLimit = angleLimitsFor(entity.underwater).Ground;
	const keptFooting = entity.grounded && !entity.launched;

	// With footing kept, the ground probe reaches as far down as a walkable fold can drop in one step.
	const foldDrop = keptFooting ? Vector3Length(physicsState.displacement) * Math.sin((groundLimit * Math.PI) / 180) : 0;

	return {
		frameStart  : { referenceNormal: CloneVector3(entity.referenceNormal), surfaceId: entity.physicsRuntime.groundSurfaceId },
		groundReach : physicsState.groundSnapTolerance + foldDrop,
		fold        : keptFooting ? { normal: entity.surfaceNormal, minCos: Math.cos((groundLimit * Math.PI) / 180) } : null,
		contactGrace: Math.max(0, entity.contactGrace - physicsState.deltaSeconds),
	};
}

/**
 * Ease the grip demand toward the contact surface's share of top speed, holding it while airborne.
 * The target grows with gravity support lost past `Ground`: none there, full `MinGripSpeed` upside down.
 */
function GetGripDemand(entity, groundContact, deltaSeconds) {
	if (!groundContact.hit) return entity.gripDemand;

	const minGrip       = CONFIG.Physics.Correction.MinGripSpeed[entity.underwater ? "Water" : "Air"];
	const groundSupport = Math.cos((angleLimitsFor(entity.underwater).Ground * Math.PI) / 180);
	const step          = (minGrip / GROUNDING.GripRampMs) * deltaSeconds * 1000;
	return entity.gripDemand + Clamp(Math.max(0, minGrip * (groundSupport - groundContact.normal.y) / (groundSupport + 1)) - entity.gripDemand, -step, step);
}

// Decay the reference toward world up off every surface, or adopt the surface while moving on walkable ground.
function GetReferenceNormal(entity, deltaSeconds) {
	return entity.surfaceContact === "none" && entity.contactGrace <= EPSILON
		? RotateTowardVector3(entity.referenceNormal, WORLD_NORMALS.Up, DegreesToRadians(CONFIG.Physics.Correction.ReferenceReleaseRate) * deltaSeconds)
		: entity.surfaceContact === "walkable" && !CompareVector3(entity.transform.position, entity.physicsRuntime.lastPosition)
			? CloneVector3(entity.surfaceNormal)
			: entity.referenceNormal;
}

/**
 * Classify a surface as walkable, sliding or wall. `incline` gates standing, and `delta` gates moving onto something steeper.
 * `currentContact` tightens the walkable limit to `Recover` mid-slide, to stop it flickering between states.
 * Past the `Ground` incline, `speedRatio` (speed along the surface / top speed) below `gripDemand` slides instead.
 * @returns {"walkable" | "sliding" | "wall"}
 */
function ClassifySurface(referenceNormal, candidate, currentContact, underwater, speedRatio, gripDemand) {
	const limits        = angleLimitsFor(underwater);
	const walkableLimit = currentContact === "sliding" ? limits.Recover : limits.Ground;
	const incline       = angleBetweenDegrees(candidate, WORLD_NORMALS.Up);
	const walkable      = incline <= limits.Ground || speedRatio >= gripDemand ? "walkable" : "sliding";

	if (incline <= CONFIG.Physics.Correction.FlatSnapDegrees) return "walkable";

	// Not steeper than the reference: incline alone decides.
	if (candidate.y >= referenceNormal.y && incline <= walkableLimit) return walkable;

	const delta = angleBetweenDegrees(referenceNormal, candidate);
	return delta <= walkableLimit ? walkable : delta <= limits.Sliding ? "sliding" : "wall";
}

/**
 * One loop pass's slope correction: the new surface contact, surface orientation and slope-following velocity.
 *
 * @param {object} entity — the player, read but never written.
 * @param {{ hit: boolean, normal: { x, y, z }, contact: string, surfaceId: string }} groundContact — from `PickGroundContact`.
 * @param {{ surfaceId: string | null }} frameStart — the last surface stood on, frozen for this frame.
 */
function GetSurfaceCorrection(entity, groundContact, frameStart) {
	if (CONFIG.Physics.Correction.Enabled === false) {
		const { surfaceContact, contactGrace, surfaceNormal, alignedUp, velocity } = entity;
		return { surfaceContact, contactGrace, surfaceNormal, alignedUp, velocity, ...CORRECTION_DISABLED };
	}

	if (!groundContact.hit) return releasedSurface(entity);

	const normal  = ResolveVector3Axis(groundContact.normal);

	// Release a surface that a launch is still moving away from.
	if (entity.launched && DotVector3(normal, entity.velocity) > EPSILON) return releasedSurface(entity);

	const incline = angleBetweenDegrees(normal, WORLD_NORMALS.Up);
	const contact = groundContact.contact;

	const changedContact = entity.surfaceContact !== contact;
	let changedVelocity  = false, velocity = entity.velocity, alongNormal = DotVector3(normal, velocity);

	// Pinned only with kept footing (same surface, or reached while grounded); a new surface's first touch stays a collision.
	const keptFooting = entity.grounded || groundContact.surfaceId === frameStart.surfaceId;

	// Grounded is judged on the new contact.
	const onContact = { 
		surfaceContact: contact, 
		launched: entity.launched, 
		velocity, 
		alignedUp: entity.alignedUp, 
		buoyancyForce: entity.buoyancyForce 
	};
	const pinned = keptFooting && !entity.launched && ResolveGrounded(onContact);

	// Over a walkable crest, velocity turns onto the new facet instead of losing its lift-off; concave folds turn in the collision slide.
	if (
		pinned && entity.grounded && contact === "walkable" && alongNormal > EPSILON &&
		DotVector3(entity.surfaceNormal, normal) < 1 - EPSILON
	) {
		velocity = TransportVector3(velocity, entity.surfaceNormal, normal);
		alongNormal = DotVector3(normal, velocity);
		changedVelocity = true;
	}

	if (alongNormal < 0 || (pinned && alongNormal > 0)) {
		let newVelocity = SubtractVector3(velocity, ScaleVector3(normal, alongNormal));

		// A fold's lift, already turned by the collision slide, keeps its speed.
		if (alongNormal > 0 && contact === "walkable" && Vector3Length(newVelocity) > EPSILON) {
			newVelocity = ScaleVector3(ResolveVector3Axis(newVelocity), Vector3Length(velocity));
		}
		changedVelocity = changedVelocity || hasMeaningfulVectorDelta(velocity, newVelocity);
		velocity = newVelocity;
	}

	// Near-flat stands upright; the real normal is still kept for tracking.
	const isFlat = incline <= CONFIG.Physics.Correction.FlatSnapDegrees;
	const targetUp = isFlat ? WORLD_NORMALS.Up : normal;
	const changedOrientation = hasMeaningfulVectorDelta(entity.alignedUp, targetUp);

	if (!isFlat && (changedOrientation || changedVelocity)) {
		Log(
			"ENGINE",
			`
				Slope correction applied: 
				- Normal=(${normal.x.toFixed(2)}, ${normal.y.toFixed(2)}, ${normal.z.toFixed(2)}) 
				- OrientationChanged=${changedOrientation} 
				- VelocityChanged=${changedVelocity}
			`,
			"log",
			"Level"
		);
	}

	return {
		surfaceContact: contact,
		contactGrace  : 0,
		surfaceNormal : CloneVector3(normal),
		alignedUp     : CloneVector3(targetUp),
		velocity, changedContact, changedOrientation, changedVelocity,
		changedPosition: false,
		anyChanged: changedContact || changedOrientation || changedVelocity,
	};
}

// Offset straight off the ground that seats the capsule on the surface it stands on.
function GetGroundSnap(entity, groundContact, groundSnapTolerance) {
	if (CONFIG.Physics.Correction.Enabled === false || !entity.grounded) return CORRECTION_DISABLED;

	const normal = ResolveVector3Axis(groundContact.normal);
	const delta = groundContact.restDelta;

	if (Math.abs(delta) > groundSnapTolerance) return CORRECTION_DISABLED;

	const changedPosition = Math.abs(delta) > EPSILON;
	if (changedPosition) Log("ENGINE", `Ground snap: delta=${delta.toFixed(4)}`, "log", "Level");

	return {
		offset: ScaleVector3(normal, delta),
		changedContact: false, changedOrientation: false, changedPosition, changedVelocity: false,
		anyChanged: changedPosition,
	};
}

// Pivot about the contact cap while touching a surface, the body's center when releasing one, or the full box's center without collision.
function PoseAnchor(entity) {
	const { collision, surfaceContact } = entity;
	const local = collision === null
		? AabbCenter(entity.model.restFullAabb)
		: surfaceContact !== "none" ? collision.rest.groundCapsule.segmentStart : AabbCenter(collision.rest.aabb);
	return MultiplyVector3(local, entity.transform.scale);
}

// Rotation that stands the entity on its surface, and the position shift that keeps it pivoting about its anchor.
function GetSurfaceOrientation(entity) {
	// The contact grace holds the whole pose, sliding included.
	if (CONFIG.Physics.Correction.Enabled === false || entity.contactGrace > EPSILON) return CORRECTION_DISABLED;

	const rotation = entity.transform.rotation;
	
	// The exact standing rotation; the collider, ground probe and pivot all follow it.
	const solved = SurfaceAlignedRotation(entity.alignedUp, entity.facing, rotation, entity.surfaceContact === "sliding");
	const changedOrientation = hasMeaningfulVectorDelta(rotation, solved);

	if (changedOrientation === false) return CORRECTION_DISABLED;

	const anchor = PoseAnchor(entity);
	return {
		rotation: solved,
		offset  : SubtractVector3(RotateByEuler(anchor, rotation), RotateByEuler(anchor, solved)),
		changedOrientation,
		anyChanged: changedOrientation,
	};
}

// Grounded when on walkable ground, not launched upward and not floating.
function ResolveGrounded({ surfaceContact, launched, velocity, alignedUp, buoyancyForce }) {
	return surfaceContact === "walkable" &&
		!(launched && DotVector3(velocity, alignedUp) > EPSILON) &&
		buoyancyForce <= CONFIG.Physics.Gravity.Strength;
}

/* === EXPORTS === */

export {
	ClassifySurface,
	GetCorrectionFrame,
	GetSurfaceCorrection,
	GetGroundSnap,
	GetSurfaceOrientation,
	GetGripDemand,
	GetReferenceNormal,
	PoseAnchor,
	ResolveGrounded,
	CORRECTION_DISABLED,
};
