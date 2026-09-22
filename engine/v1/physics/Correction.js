// Corrects velocity, position, rotation, etc to prevent weird clipping or misalignment.

// Used by physics/Master.js

import { CONFIG } from "../core/config.js";
import { Log, EPSILON } from "../core/meta.js";
import { CrossVector3, DotVector3, MultiplyVector3, RotateByEuler, ScaleVector3, SubtractVector3, ResolveVector3Axis, CloneVector3, Vector3Length, WORLD_NORMALS } from "../math/Vector3.js";
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

// Contact-less orientation: world up, velocity untouched.
function resetSurfaceState(playerState) {
	const changedOrientation = hasMeaningfulVectorDelta(playerState.alignedUp, WORLD_NORMALS.Up);

	const changedContact = playerState.surfaceContact !== "none";
	playerState.surfaceContact = "none";
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

const angleBetweenDegrees = (a, b) => (Math.acos(Clamp(DotVector3(a, b), -1, 1)) * 180) / Math.PI;

const angleLimitsFor = (underwater) => CONFIG.PHYSICS.Correction.MaxAngleDelta[underwater ? "Water" : "Air"];

// How far the grounding reference may decay toward world up this frame, radians.
const ReferenceReleaseStep = (deltaSeconds) => CONFIG.PHYSICS.Correction.ReferenceReleaseRate * deltaSeconds;

/**
 * Pure surface classification: `incline` gates standing, `delta` gates transitioning steeper.
 * `currentContact` tightens the walkable limit to `Recover` mid-slide — hysteresis.
 * @returns {"walkable" | "sliding" | "wall"}
 */
function ClassifySurface(referenceNormal, candidate, currentContact, underwater) {
	const limits = angleLimitsFor(underwater);
	const walkableLimit = currentContact === "sliding" ? limits.Recover : limits.Ground;
	const incline = angleBetweenDegrees(candidate, WORLD_NORMALS.Up);

	if (incline <= CONFIG.PHYSICS.Correction.FlatSnapDegrees) return "walkable";
	// Not steeper than the reference: incline alone decides.
	if (candidate.y >= referenceNormal.y && incline <= walkableLimit) return "walkable";

	const delta = angleBetweenDegrees(referenceNormal, candidate);
	if (delta <= walkableLimit)  return "walkable";
	if (delta <= limits.Sliding) return "sliding";
	return "wall";
}

/**
 * Loop-time slope correction for Sonic-style running.
 * Publishes `surfaceContact`, surface orientation state, and slope-projected velocity.
 * Position snap is handled separately after the collision/correction loop stabilizes.
 *
 * @param {object} playerState — full mutable player state.
 * @param {{ hit: boolean, normal: { x, y, z }, contact: string }} groundContact — from `ProbeGroundContact`.
 */
function ApplySurfaceCorrection(playerState, groundContact) {
	if (CONFIG.PHYSICS.Correction.Enabled === false) return CORRECTION_DISABLED;

	if (!groundContact.hit) return resetSurfaceState(playerState);

	const normal = ResolveVector3Axis(groundContact.normal);
	const incline = angleBetweenDegrees(normal, WORLD_NORMALS.Up);
	const contact = groundContact.contact;

	const changedContact = playerState.surfaceContact !== contact;
	playerState.surfaceContact = contact;
	let changedVelocity = false;

	const vel = playerState.velocity;
	const intoSurface = DotVector3(normal, vel);

	if (intoSurface < 0) {
		// Removes only the into-surface component.
		const newVelocity = SubtractVector3(vel, ScaleVector3(normal, intoSurface));

		changedVelocity =
			hasMeaningfulDelta(vel.x, newVelocity.x) ||
			hasMeaningfulDelta(vel.y, newVelocity.y) ||
			hasMeaningfulDelta(vel.z, newVelocity.z);

		vel.set(newVelocity);
	}

	const isFlat = incline <= CONFIG.PHYSICS.Correction.FlatSnapDegrees;
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
	if (CONFIG.PHYSICS.Correction.Enabled === false || !playerState.grounded) return CORRECTION_DISABLED;
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

function ApplyPlayerSurfaceOrientation(playerState) {
	if (CONFIG.PHYSICS.Correction.Enabled === false) return { changedOrientation: false, anyChanged: false };

	const rotation = playerState.transform.rotation;
	// Exact: collider, ground probe and pivot all key off this. The model's ease is Animation's business.
	const solved = solveAlignmentRotation(playerState.alignedUp, playerState.facing, rotation, playerState.surfaceContact === "sliding");
	const changedOrientation = hasMeaningfulVectorDelta(rotation, solved);

	if (changedOrientation === false) return { changedOrientation, anyChanged: false };

	// Pivot about the contact cap, not the transform origin. Only meaningful while there is a contact.
	const anchor = MultiplyVector3(playerState.collision.rest.groundCapsule.segmentStart, playerState.transform.scale);
	const before = RotateByEuler(anchor, rotation);

	rotation.set(solved);

	if (playerState.surfaceContact !== "none") playerState.transform.position.add(SubtractVector3(before, RotateByEuler(anchor, rotation)));

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

// Sole grounding authority; jump veto clears on descent, not on action alone.
// Measured along the contact's up — world y is nonzero for pure tangent motion on a slope.
const ResolveGrounded = (entity) =>
	entity.surfaceContact === "walkable" &&
	!(entity.action === "Jumping" && DotVector3(entity.velocity, entity.alignedUp) > EPSILON) &&
	entity.buoyancyForce <= CONFIG.PHYSICS.Gravity.Strength.value;

/* === EXPORTS === */

export { ClassifySurface, ApplySurfaceCorrection, ApplyGroundSnap, ApplyPlayerSurfaceOrientation, ResolveGrounded, ReferenceReleaseStep, CORRECTION_DISABLED };
