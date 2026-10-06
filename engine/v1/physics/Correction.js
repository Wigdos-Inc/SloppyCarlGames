// Corrects velocity, position, rotation, etc to prevent weird clipping or misalignment.

// Used by physics/Master.js

import { CONFIG, GROUNDING } from "../core/config.js";
import { Log, EPSILON } from "../core/meta.js";
import { AddVector3, AngleBetweenVector3, TransportVector3, CrossVector3, DotVector3, MultiplyVector3, RotateByEuler, ScaleVector3, SubtractVector3, ResolveVector3Axis, CloneVector3, Vector3Length, WORLD_NORMALS } from "../math/Vector3.js";
import { ProjectOntoPlane } from "../math/Collision.js";
import { EulerFromBasis } from "../math/Matrix.js";
import { Clamp } from "../math/Utilities.js";

const hasMeaningfulDelta = (currentValue, nextValue) => Math.abs(nextValue - currentValue) > EPSILON;

function hasMeaningfulVectorDelta(currentVector, nextVector) {
	return (
		hasMeaningfulDelta(currentVector.x, nextVector.x) ||
		hasMeaningfulDelta(currentVector.y, nextVector.y) ||
		hasMeaningfulDelta(currentVector.z, nextVector.z)
	);
}

// Contact-less orientation: world up, velocity untouched. The last surface pose holds through the grace.
function resetSurfaceState(playerState) {
	const changedContact = playerState.surfaceContact !== "none";
	if (playerState.launched) playerState.contactGrace = 0;
	else if (changedContact) playerState.contactGrace = GROUNDING.ContactGraceMs / 1000;
	playerState.surfaceContact = "none";

	if (playerState.contactGrace > EPSILON) {
		return { changedContact, changedOrientation: false, changedPosition: false, changedVelocity: false, anyChanged: changedContact };
	}

	const changedOrientation = hasMeaningfulVectorDelta(playerState.alignedUp, WORLD_NORMALS.Up);
	playerState.surfaceNormal = CloneVector3(WORLD_NORMALS.Up);
	playerState.alignedUp = CloneVector3(WORLD_NORMALS.Up);

	return {
		changedContact, changedOrientation,
		changedPosition: false,
		changedVelocity: false,
		anyChanged: changedContact || changedOrientation,
	};
}

const CORRECTION_DISABLED = Object.freeze({
	changedContact: false,
	changedOrientation: false,
	changedPosition: false,
	changedVelocity: false,
	anyChanged: false,
});

const angleBetweenDegrees = (a, b) => (AngleBetweenVector3(a, b) * 180) / Math.PI;

const angleLimitsFor = (underwater) => CONFIG.Physics.Correction.MaxAngleDelta[underwater ? "Water" : "Air"];

// How far the grounding reference may decay toward world up this frame, radians.
const ReferenceReleaseStep = (deltaSeconds) => CONFIG.Physics.Correction.ReferenceReleaseRate * deltaSeconds;

/**
 * Eases the grip demand toward the contact surface's share of top speed; held while airborne.
 * The target grows with gravity support lost past `Ground`: none there, full `MinGripSpeed` upside down.
 */
function UpdateGripDemand(entity, groundContact, deltaSeconds) {
	if (!groundContact.hit) return;
	const minGrip = CONFIG.Physics.Correction.MinGripSpeed[entity.underwater ? "Water" : "Air"];
	const groundSupport = Math.cos((angleLimitsFor(entity.underwater).Ground * Math.PI) / 180);
	const target = Math.max(0, minGrip * (groundSupport - groundContact.normal.y) / (groundSupport + 1));
	const step = (minGrip / GROUNDING.GripRampMs) * deltaSeconds * 1000;
	entity.gripDemand += Clamp(target - entity.gripDemand, -step, step);
}

/**
 * Pure surface classification: `incline` gates standing, `delta` gates transitioning steeper.
 * `currentContact` tightens the walkable limit to `Recover` mid-slide — hysteresis.
 * Past the `Ground` incline, `speedRatio` (speed along the surface / top speed) below `gripDemand` slides instead.
 * @returns {"walkable" | "sliding" | "wall"}
 */
function ClassifySurface(referenceNormal, candidate, currentContact, underwater, speedRatio, gripDemand) {
	const limits = angleLimitsFor(underwater);
	const walkableLimit = currentContact === "sliding" ? limits.Recover : limits.Ground;
	const incline = angleBetweenDegrees(candidate, WORLD_NORMALS.Up);
	const walkable = incline <= limits.Ground || speedRatio >= gripDemand ? "walkable" : "sliding";

	if (incline <= CONFIG.Physics.Correction.FlatSnapDegrees) return "walkable";
	// Not steeper than the reference: incline alone decides.
	if (candidate.y >= referenceNormal.y && incline <= walkableLimit) return walkable;

	const delta = angleBetweenDegrees(referenceNormal, candidate);
	if (delta <= walkableLimit)  return walkable;
	if (delta <= limits.Sliding) return "sliding";
	return "wall";
}

/**
 * Loop-time slope correction for Sonic-style running.
 * Publishes `surfaceContact`, surface orientation state, and slope-projected velocity.
 * Position snap is handled separately after the collision/correction loop stabilizes.
 *
 * @param {object} playerState — full mutable player state.
 * @param {{ hit: boolean, normal: { x, y, z }, contact: string, surfaceId: string }} groundContact — from `ProbeGroundContact`.
 * @param {{ surfaceId: string | null }} frameStart — the last surface stood on, frozen for this frame.
 */
function ApplySurfaceCorrection(playerState, groundContact, frameStart) {
	if (CONFIG.Physics.Correction.Enabled === false) return CORRECTION_DISABLED;

	if (!groundContact.hit) return resetSurfaceState(playerState);

	const normal = ResolveVector3Axis(groundContact.normal);
	const incline = angleBetweenDegrees(normal, WORLD_NORMALS.Up);
	const contact = groundContact.contact;

	const changedContact = playerState.surfaceContact !== contact;
	playerState.surfaceContact = contact;
	playerState.contactGrace = 0;
	let changedVelocity = false;

	const vel = playerState.velocity;
	let alongNormal = DotVector3(normal, vel);
	// Pinned only with kept footing (same surface, or reached while grounded); a new surface's first touch stays a collision.
	const keptFooting = playerState.grounded || groundContact.surfaceId === frameStart.surfaceId;
	const pinned = keptFooting && !playerState.launched && ResolveGrounded(playerState);

	// Over a walkable crest, velocity turns onto the new facet instead of losing its lift-off; concave folds turn in the collision slide.
	if (
		pinned && playerState.grounded && contact === "walkable" && alongNormal > EPSILON && 
		DotVector3(playerState.surfaceNormal, normal) < 1 - EPSILON
	) {
		vel.set(TransportVector3(vel, playerState.surfaceNormal, normal));
		alongNormal = DotVector3(normal, vel);
		changedVelocity = true;
	}

	if (alongNormal < 0 || (pinned && alongNormal > 0)) {
		let newVelocity = SubtractVector3(vel, ScaleVector3(normal, alongNormal));
		
		// A fold's lift, already turned by the collision slide, keeps its speed.
		if (alongNormal > 0 && contact === "walkable" && Vector3Length(newVelocity) > EPSILON) newVelocity = ScaleVector3(ResolveVector3Axis(newVelocity), Vector3Length(vel));
		changedVelocity = changedVelocity || hasMeaningfulVectorDelta(vel, newVelocity);
		vel.set(newVelocity);
	}

	const isFlat = incline <= CONFIG.Physics.Correction.FlatSnapDegrees;
	// Near-flat stands upright; the real normal is still kept for tracking.
	const targetUp = isFlat ? WORLD_NORMALS.Up : normal;
	const changedOrientation = hasMeaningfulVectorDelta(playerState.alignedUp, targetUp);
	playerState.surfaceNormal = CloneVector3(normal);
	playerState.alignedUp = CloneVector3(targetUp);

	if (!isFlat && (changedOrientation || changedVelocity)) {
		Log(
			"ENGINE",
			`Slope correction applied: normal=(${normal.x.toFixed(2)}, ${normal.y.toFixed(2)}, ${normal.z.toFixed(2)}) orientationChanged=${changedOrientation} velocityChanged=${changedVelocity}`,
			"log",
			"Level"
		);
	}

	const anyChanged = changedContact || changedOrientation || changedVelocity;
	return { changedContact, changedOrientation, changedPosition: false, changedVelocity, anyChanged };
}

function ApplyGroundSnap(playerState, groundContact, groundSnapTolerance) {
	if (CONFIG.Physics.Correction.Enabled === false || !playerState.grounded) return CORRECTION_DISABLED;
	const normal = ResolveVector3Axis(groundContact.normal);

	// Perpendicular offset that seats the capsule.
	const delta = groundContact.restDelta;
	if (Math.abs(delta) > groundSnapTolerance) return CORRECTION_DISABLED;

	const changedPosition = Math.abs(delta) > EPSILON;
	if (changedPosition) {
		playerState.transform.position.add(ScaleVector3(normal, delta));
		Log("ENGINE", `Ground snap: delta=${delta.toFixed(4)}`, "log", "Level");
	}

	return {
		changedContact: false, changedOrientation: false, changedPosition, changedVelocity: false,
		anyChanged: changedPosition,
	};
}

// Pivot about the contact cap while touching a surface; about the body's center when releasing one.
function PoseAnchor(entity) {
	const rest = entity.collision.rest;
	const local = entity.surfaceContact !== "none" ? rest.groundCapsule.segmentStart : ScaleVector3(AddVector3(rest.aabb.min, rest.aabb.max), 0.5);
	return MultiplyVector3(local, entity.transform.scale);
}

function ApplyPlayerSurfaceOrientation(playerState) {
	// The contact grace holds the whole pose, sliding included.
	if (CONFIG.Physics.Correction.Enabled === false || playerState.contactGrace > EPSILON) return { changedOrientation: false, anyChanged: false };

	const rotation = playerState.transform.rotation;
	// Exact: collider, ground probe and pivot all key off this. The model's ease is Animation's business.
	const solved = solveAlignmentRotation(playerState.alignedUp, playerState.facing, rotation, playerState.surfaceContact === "sliding");
	const changedOrientation = hasMeaningfulVectorDelta(rotation, solved);

	if (changedOrientation === false) return { changedOrientation, anyChanged: false };

	const anchor = PoseAnchor(playerState);
	const before = RotateByEuler(anchor, rotation);

	rotation.set(solved);

	playerState.transform.position.add(SubtractVector3(before, RotateByEuler(anchor, rotation)));

	return { changedOrientation, anyChanged: changedOrientation };
}

// Below this the facing has collapsed onto the normal and carries no usable heading.
const minPlanarFacing = 0.05;

/**
 * Orientation whose local up matches `alignedUp`, steered by the entity's current heading.
 * Yaw, pitch and roll all come out of one basis.
 * @param {{ x, y, z }} alignedUp — unit target up-vector.
 * @param {{ x, y, z }} facing — unit world-space heading, maintained by player/Movement.js.
 * @param {{ x, y, z }} rotation — the entity's current rotation, radians; roll seed and last-resort heading.
 * @param {boolean} onBack — sliding pose; lays the body on its back.
 * @returns {{ x: number, y: number, z: number }}
 */
function solveAlignmentRotation(alignedUp, facing, rotation, onBack) {
	let planar = ProjectOntoPlane(facing, alignedUp);
	if (Vector3Length(planar) <= minPlanarFacing) {
		// Aim uphill instead, or keep the flat heading when the surface has no uphill.
		const uphill = ProjectOntoPlane(WORLD_NORMALS.Up, alignedUp);
		planar = Vector3Length(uphill) > EPSILON ? uphill : { x: Math.sin(rotation.y), y: 0, z: Math.cos(rotation.y) };
	}

	const right = ResolveVector3Axis(CrossVector3(alignedUp, planar));
	const forward = CrossVector3(right, alignedUp);

	// Sliding turns the basis -90° about its own right axis.
	if (onBack) return EulerFromBasis(right, ScaleVector3(forward, -1), alignedUp, rotation.z);
	return EulerFromBasis(right, alignedUp, forward, rotation.z);
}

// Grounded when on walkable ground, not launched upward and not floating.
function ResolveGrounded({ surfaceContact, launched, velocity, alignedUp, buoyancyForce }) {
	return surfaceContact === "walkable" &&
		!(launched && DotVector3(velocity, alignedUp) > EPSILON) &&
		buoyancyForce <= CONFIG.Physics.Gravity.Strength.value;
}

/* === EXPORTS === */

export { ClassifySurface, ApplySurfaceCorrection, ApplyGroundSnap, ApplyPlayerSurfaceOrientation, PoseAnchor, ResolveGrounded, ReferenceReleaseStep, UpdateGripDemand, CORRECTION_DISABLED };
