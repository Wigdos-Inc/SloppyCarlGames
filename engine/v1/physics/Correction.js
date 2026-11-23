// Keeps bodies seated and aligned on the surfaces they touch.

// Used by physics/Master.js to correct each body every physics step.
// Used by physics/Collision.js to classify ground hits.
// Used by camera/Modes.js and handlers/game/Animation.js for the pivot the shown model turns about.

import { CONFIG, GROUNDING } from "../core/config.js";
import { Log, EPSILON } from "../core/meta.js";
import { 
	AngleBetweenVector3, 
	TransportVector3, 
	DotVector3, 
	CrossVector3, 
	MultiplyVector3, 
	ProjectOntoPlane, 
	RotateByEuler, 
	ScaleVector3, 
	SubtractVector3, 
	ResolveVector3Axis, 
	CloneVector3, 
	CompareVector3, 
	RotateTowardVector3, 
	Vector3Length, 
	WORLD_NORMALS, 
	AbsoluteVector3 
} from "../math/Vector3.js";
import { AabbCenter } from "../math/Geometry.js";
import { EulerFromBasis } from "../math/Matrix.js";
import { Clamp, DegreesToRadians } from "../math/Utilities.js";

// Check a correction moves a vector by more than rounding.
function vectorChanged(vector, corrected) {
	const { x, y, z } = AbsoluteVector3(SubtractVector3(corrected, vector));
	return x > EPSILON || y > EPSILON || z > EPSILON;
}

// Result for a correction that changes nothing.
const CORRECTION_DISABLED = Object.freeze({
	changedContact    : false,
	changedOrientation: false,
	changedPosition   : false,
	changedVelocity   : false,
	anyChanged        : false,
});

// Release the entity from its surface, holding its last pose through the contact grace.
function releasedSurface(entity) {
	const changedContact = entity.physics.correction.surfaceContact !== "none";
	let contactGrace     = entity.physics.correction.contactGrace;
	if (entity.physics.launched) contactGrace = 0;
	else if (changedContact) contactGrace = GROUNDING.ContactGraceMs / 1000;

	const held = contactGrace > EPSILON;
	const changedOrientation = !held && vectorChanged(entity.physics.correction.alignedUp, WORLD_NORMALS.Up);

	return {
		surfaceContact : "none",
		contactGrace,
		surfaceNormal  : held ? entity.physics.correction.surfaceNormal : CloneVector3(WORLD_NORMALS.Up),
		alignedUp      : held ? entity.physics.correction.alignedUp     : CloneVector3(WORLD_NORMALS.Up),
		velocity       : entity.velocity,
		changedContact, changedOrientation,
		changedPosition: false,
		changedVelocity: false,
		anyChanged     : changedContact || changedOrientation,
	};
}

const angleBetweenDegrees = (a, b) => (AngleBetweenVector3(a, b) * 180) / Math.PI;

// Capture what the correction loop holds fixed for this step.
function GetCorrectionFrame(entity, physicsState) {
	const correction  = entity.physics.correction;
	const groundAngle = (CONFIG.Physics.Correction.MaxAngleDelta[entity.physics.medium].Ground * Math.PI) / 180;
	const keptFooting = entity.physics.grounded && !entity.physics.launched;
	const slopeReach  = keptFooting ? Vector3Length(physicsState.displacement) * Math.sin(groundAngle) : 0;

	return {
		frameStart  : { referenceNormal: CloneVector3(correction.referenceNormal), surfaceId: entity.physics.lastFrame.groundSurfaceId },
		groundReach : physicsState.groundSnapTolerance + slopeReach,
		fold        : keptFooting ? { normal: correction.surfaceNormal, minCos: Math.cos(groundAngle) } : null,
		contactGrace: Math.max(0, correction.contactGrace - physicsState.deltaSeconds),
	};
}

// Ease the grip demand toward the surface's share of top speed, holding it while airborne.
function GetGripDemand(entity, groundContact, deltaSeconds) {
	const demand = entity.physics.slopes.gripDemand;
	if (!groundContact.hit) return demand;

	const { MinGripSpeed, MaxAngleDelta } = CONFIG.Physics.Correction;
	const minGrip       = MinGripSpeed[entity.physics.medium];
	const groundSupport = Math.cos((MaxAngleDelta[entity.physics.medium].Ground * Math.PI) / 180);
	const step          = (minGrip / GROUNDING.GripRampMs) * deltaSeconds * 1000;

	// Demand more grip the further the surface tips past Ground, up to MinGripSpeed upside down.
	const target = Math.max(0, minGrip * (groundSupport - groundContact.normal.y) / (groundSupport + 1));
	return demand + Clamp(target - demand, -step, step);
}

// Decay the reference toward world up off every surface, or adopt the surface while moving on walkable ground.
function GetReferenceNormal(entity, deltaSeconds) {
	const correction  = entity.physics.correction;
	const releaseStep = DegreesToRadians(CONFIG.Physics.Correction.ReferenceReleaseRate) * deltaSeconds;
	return correction.surfaceContact === "none" && correction.contactGrace <= EPSILON
		? RotateTowardVector3(correction.referenceNormal, WORLD_NORMALS.Up, releaseStep)
		: correction.surfaceContact === "walkable" && !CompareVector3(entity.transform.position, entity.physics.lastFrame.position)
			? CloneVector3(correction.surfaceNormal)
			: correction.referenceNormal;
}

// Classify a surface as walkable, sliding or wall.
function ClassifySurface(referenceNormal, candidate, currentContact, medium, speedRatio, gripDemand) {
	const limits  = CONFIG.Physics.Correction.MaxAngleDelta[medium];
	const incline = angleBetweenDegrees(candidate, WORLD_NORMALS.Up);

	// Tighten the walkable limit mid-slide to stop it flickering between states.
	const walkableLimit = currentContact === "sliding" ? limits.Recover : limits.Ground;

	// Past the Ground incline, slide when moving slower than the grip demand.
	const walkable = incline <= limits.Ground || speedRatio >= gripDemand ? "walkable" : "sliding";

	if (incline <= CONFIG.Physics.Correction.FlatSnapDegrees) return "walkable";

	// Let incline alone decide on surfaces no steeper than the reference.
	if (candidate.y >= referenceNormal.y && incline <= walkableLimit) return walkable;

	const delta = angleBetweenDegrees(referenceNormal, candidate);
	return delta <= walkableLimit ? walkable : delta <= limits.Sliding ? "sliding" : "wall";
}

/**
 * Work out one loop pass's surface contact, orientation and slope-following velocity.
 * @param {object} entity — the player, read but never written.
 * @param {{ hit: boolean, normal: { x, y, z }, contact: string, surfaceId: string }} groundContact — from `PickGroundContact`.
 * @param {{ surfaceId: string | null }} frameStart — the last surface stood on, frozen for this frame.
 */
function GetSurfaceCorrection(entity, groundContact, frameStart) {
	if (CONFIG.Physics.Correction.Enabled === false) {
		const { physics: { correction: { surfaceContact, contactGrace, surfaceNormal, alignedUp } }, velocity } = entity;
		return { surfaceContact, contactGrace, surfaceNormal, alignedUp, velocity, ...CORRECTION_DISABLED };
	}

	if (!groundContact.hit) return releasedSurface(entity);

	const normal = ResolveVector3Axis(groundContact.normal);

	// Release a surface that a launch is still moving away from.
	if (entity.physics.launched && DotVector3(normal, entity.velocity) > EPSILON) return releasedSurface(entity);

	const incline = angleBetweenDegrees(normal, WORLD_NORMALS.Up);
	const contact = groundContact.contact;

	const changedContact = entity.physics.correction.surfaceContact !== contact;
	let changedVelocity  = false, velocity = entity.velocity, alongNormal = DotVector3(normal, velocity);

	// Keep footing on the last surface or one reached while grounded, leaving a new surface's first touch to collision.
	const keptFooting = entity.physics.grounded || groundContact.surfaceId === frameStart.surfaceId;

	// Grounded is judged on the new contact.
	const pinned = keptFooting && !entity.physics.launched && ResolveGrounded(entity, contact);

	// Turn velocity onto the new facet over a walkable crest, keeping it from lifting off.
	if (
		pinned && entity.physics.grounded && contact === "walkable" && alongNormal > EPSILON &&
		DotVector3(entity.physics.correction.surfaceNormal, normal) < 1 - EPSILON
	) {
		velocity = TransportVector3(velocity, entity.physics.correction.surfaceNormal, normal);
		alongNormal = DotVector3(normal, velocity);
		changedVelocity = true;
	}

	if (alongNormal < 0 || (pinned && alongNormal > 0)) {
		let newVelocity = SubtractVector3(velocity, ScaleVector3(normal, alongNormal));

		// A fold's lift, already turned by the collision slide, keeps its speed.
		if (alongNormal > 0 && contact === "walkable" && Vector3Length(newVelocity) > EPSILON) {
			newVelocity = ScaleVector3(ResolveVector3Axis(newVelocity), Vector3Length(velocity));
		}
		changedVelocity = changedVelocity || vectorChanged(velocity, newVelocity);
		velocity = newVelocity;
	}

	// Stand upright on near-flat ground, still keeping the real normal for tracking.
	const isFlat = incline <= CONFIG.Physics.Correction.FlatSnapDegrees;
	const targetUp = isFlat ? WORLD_NORMALS.Up : normal;
	const changedOrientation = vectorChanged(entity.physics.correction.alignedUp, targetUp);

	if (!isFlat && (changedOrientation || changedVelocity)) {
		Log(
			"ENGINE",
			`
				Slope correction applied: 
				- Normal: (${normal.x.toFixed(2)}, ${normal.y.toFixed(2)}, ${normal.z.toFixed(2)}) 
				- OrientationChanged: ${changedOrientation} 
				- VelocityChanged: ${changedVelocity}
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
		velocity, changedContact, changedOrientation, changedVelocity, changedPosition: false,
		anyChanged: changedContact || changedOrientation || changedVelocity,
	};
}

// Find the offset that seats the capsule on the ground it stands on.
function GetGroundSnap(entity, groundContact, groundSnapTolerance) {
	if (CONFIG.Physics.Correction.Enabled === false || !entity.physics.grounded) return CORRECTION_DISABLED;

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
	const { physics: { collision, correction: { surfaceContact } } } = entity;
	const local = collision === null
		? AabbCenter(entity.model.restFullAabb)
		: surfaceContact !== "none" ? collision.rest.groundCapsule.segmentStart : AabbCenter(collision.rest.aabb);
	return MultiplyVector3(local, entity.transform.scale);
}

// Stand the entity upright on the surface, steered by its current heading.
function surfaceAlignedRotation(alignedUp, facing, rotation, onBack) {
	let planar = ProjectOntoPlane(facing, alignedUp);
	if (Vector3Length(planar) <= 0.05) {
		// Aim uphill if possible, otherwise keep the flat heading.
		const uphill = ProjectOntoPlane(WORLD_NORMALS.Up, alignedUp);
		planar = Vector3Length(uphill) > EPSILON ? uphill : { x: Math.sin(rotation.y), y: 0, z: Math.cos(rotation.y) };
	}

	const right   = ResolveVector3Axis(CrossVector3(alignedUp, planar));
	const forward = CrossVector3(right, alignedUp);

	// Lay a sliding body on its back, its front facing away from the surface.
	return onBack
		? EulerFromBasis(right, ScaleVector3(forward, -1), alignedUp, rotation.z)
		: EulerFromBasis(right, alignedUp, forward, rotation.z);
}

// Find the rotation that stands the entity on its surface, and the shift that keeps it pivoting about its anchor.
function GetSurfaceOrientation(entity) {
	const correction = entity.physics.correction;

	// Skip when disabled, or while the contact grace holds the whole pose (sliding included).
	if (CONFIG.Physics.Correction.Enabled === false || correction.contactGrace > EPSILON) return CORRECTION_DISABLED;

	const rotation = entity.transform.rotation;

	// Solve the standing rotation, laying the body on its back while sliding.
	const solved = surfaceAlignedRotation(correction.alignedUp, entity.facing, rotation, correction.surfaceContact === "sliding");
	const changedOrientation = vectorChanged(rotation, solved);

	if (changedOrientation === false) return CORRECTION_DISABLED;

	const anchor = PoseAnchor(entity);
	return {
		rotation: solved,
		offset  : SubtractVector3(RotateByEuler(anchor, rotation), RotateByEuler(anchor, solved)),
		changedOrientation,
		anyChanged: changedOrientation,
	};
}

// Check whether the entity stands on walkable ground while not launched or floating.
function ResolveGrounded(entity, contact) {
	return contact === "walkable" &&
		!(entity.physics.launched && DotVector3(entity.velocity, entity.physics.correction.alignedUp) > EPSILON) &&
		entity.physics.buoyancyForce <= CONFIG.Physics.Gravity.Strength;
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
