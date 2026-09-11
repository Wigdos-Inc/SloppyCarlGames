// Corrects velocity, position, rotation, etc to prevent weird clipping or misalignment.

// Used by physics/Master.js

import { CONFIG } from "../core/config.js";
import { Log, EPSILON } from "../core/meta.js";
import { DotVector3, MultiplyVector3, RotateByEuler, ScaleVector3, SubtractVector3, ResolveVector3Axis, CloneVector3, WORLD_NORMALS } from "../math/Vector3.js";
import { Clamp } from "../math/Utilities.js";

const hasMeaningfulDelta = (currentValue, nextValue) => Math.abs(nextValue - currentValue) > EPSILON;

function hasMeaningfulVectorDelta(currentVector, nextVector) {
	return (
		hasMeaningfulDelta(currentVector.x, nextVector.x) ||
		hasMeaningfulDelta(currentVector.y, nextVector.y) ||
		hasMeaningfulDelta(currentVector.z, nextVector.z)
	);
}

// Contact-less orientation: world up, velocity untouched. `contact` is "none" or "wall".
function resetSurfaceState(playerState, contact) {
	const changedOrientation =
		hasMeaningfulVectorDelta(playerState.surfaceNormal, WORLD_NORMALS.Up) ||
		hasMeaningfulVectorDelta(playerState.alignedUp, WORLD_NORMALS.Up);

	const changedContact = playerState.surfaceContact !== contact;
	playerState.surfaceContact = contact;
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

/**
 * Pure surface classification: `incline` gates standing, `delta` gates transitioning steeper.
 * `currentContact` tightens the walkable limit to `Recover` mid-slide — hysteresis.
 * @returns {"walkable" | "sliding" | "wall"}
 */
function classifySurface(referenceNormal, candidate, incline, currentContact, underwater) {
	const limits = angleLimitsFor(underwater);
	const walkableLimit = currentContact === "sliding" ? limits.Recover : limits.Ground;

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
 * @param {{ hit: boolean, normal: { x, y, z } }} groundContact — from collision resolution.
 * @param {{ referenceNormal: { x, y, z } }} frameStart — last walked surface, frozen for this frame.
 */
function ApplySurfaceCorrection(playerState, groundContact, frameStart) {
	if (CONFIG.PHYSICS.Correction.Enabled === false) return CORRECTION_DISABLED;

	if (!groundContact.hit) return resetSurfaceState(playerState, "none");
	if (groundContact.type !== "terrain" && groundContact.type !== "obstacle") return resetSurfaceState(playerState, "none");

	const normal = ResolveVector3Axis(groundContact.normal);
	const incline = angleBetweenDegrees(normal, WORLD_NORMALS.Up);
	const contact = classifySurface(frameStart.referenceNormal, normal, incline, playerState.surfaceContact, playerState.underwater);
	if (contact === "wall") return resetSurfaceState(playerState, "wall");

	const changedContact = playerState.surfaceContact !== contact;
	playerState.surfaceContact = contact;
	let changedOrientation = false;
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

	if (incline <= CONFIG.PHYSICS.Correction.FlatSnapDegrees) {
		// Near-flat: real normal kept for tracking, alignedUp forced to world up.
		changedOrientation = hasMeaningfulVectorDelta(playerState.alignedUp, WORLD_NORMALS.Up);
		playerState.surfaceNormal = CloneVector3(normal);
		playerState.alignedUp = CloneVector3(WORLD_NORMALS.Up);
	}
	else {
		// Real slope: align to the surface.
		changedOrientation = hasMeaningfulVectorDelta(playerState.alignedUp, normal);
		playerState.surfaceNormal = CloneVector3(normal);
		playerState.alignedUp = CloneVector3(normal);

		if (changedOrientation || changedVelocity) {
			Log(
				"ENGINE",
				`Slope correction applied: normal=(${normal.x.toFixed(2)}, ${normal.y.toFixed(2)}, ${normal.z.toFixed(2)}) orientationChanged=${changedOrientation} velocityChanged=${changedVelocity}`,
				"log",
				"Level"
			);
		}
	}

	const anyChanged = changedContact || changedOrientation || changedVelocity;
	return { changedContact, changedOrientation, changedPosition: false, changedVelocity, anyChanged };
}

function ApplyGroundSnap(playerState, groundContact, groundSnapTolerance) {
	if (CONFIG.PHYSICS.Correction.Enabled === false || !playerState.grounded)  return CORRECTION_DISABLED;
	if (groundContact.type !== "terrain" && groundContact.type !== "obstacle") return CORRECTION_DISABLED;
	const normal = ResolveVector3Axis(groundContact.normal);
	// Steeper than the sliding band never snaps.
	if (normal.y <= Math.cos((angleLimitsFor(playerState.underwater).Sliding * Math.PI) / 180)) return CORRECTION_DISABLED;

	// Vertical offset that seats the capsule — tolerance is perpendicular.
	const deltaY = groundContact.restDeltaY;
	if (Math.abs(deltaY) * normal.y > groundSnapTolerance) return CORRECTION_DISABLED;

	const changedPosition = Math.abs(deltaY) > EPSILON;
	if (changedPosition) {
		playerState.transform.position.y += deltaY;
		Log("ENGINE", `Ground snap: deltaY=${deltaY.toFixed(4)}`, "log", "Level");
	}

	return {
		changedContact: false, changedOrientation: false, changedPosition, changedVelocity: false,
		anyChanged: changedPosition,
	};
}

function ApplyPlayerSurfaceOrientation(playerState) {
	if (CONFIG.PHYSICS.Correction.Enabled === false) return { changedOrientation: false, anyChanged: false };

	const rotation = playerState.transform.rotation;
	const angles = computeAlignmentAngles(playerState.alignedUp, rotation.y);
	// Sliding lays the body on its back.
	const pitch = angles.pitch + (playerState.surfaceContact === "sliding" ? -Math.PI / 2 : 0);
	const changedOrientation =
		hasMeaningfulDelta(rotation.x, pitch) ||
		hasMeaningfulDelta(rotation.z, angles.roll);

	if (changedOrientation === false) return { changedOrientation, anyChanged: false };

	// Pivot about the contact cap, not the transform origin.
	const anchor = MultiplyVector3(playerState.collision.rest.groundCapsule.segmentStart, playerState.transform.scale);
	const before = RotateByEuler(anchor, rotation);

	rotation.x = pitch;
	rotation.z = angles.roll;

	playerState.transform.position.add(SubtractVector3(before, RotateByEuler(anchor, rotation)));

	return { changedOrientation, anyChanged: changedOrientation };
}

/**
 * Compute rotation values to orient an entity's up-vector toward a target normal.
 * Returns pitch (X) and roll (Z) in radians, solved in the entity's yawed frame.
 * Matches CreateModelMatrix's Ry·Rx·Rz composition. Yaw is not affected.
 * @param {{ x, y, z }} surfaceNormal
 * @param {number} yaw — the entity's Y rotation in radians.
 * @returns {{ pitch: number, roll: number }}
 */
function computeAlignmentAngles(surfaceNormal, yaw) {
	const n = ResolveVector3Axis(surfaceNormal);
	const cosYaw = Math.cos(yaw);
	const sinYaw = Math.sin(yaw);
	const localX = (n.x * cosYaw) - (n.z * sinYaw);
	const localZ = (n.x * sinYaw) + (n.z * cosYaw);
	return { pitch: Math.atan2(localZ, n.y), roll: Math.asin(Clamp(-localX, -1, 1)) };
}

// Sole grounding authority; jump veto clears on descent, not on action alone.
const ResolveGrounded = (entity) =>
	entity.surfaceContact === "walkable" &&
	!(entity.action === "Jumping" && entity.velocity.y > EPSILON) &&
	entity.buoyancyForce <= CONFIG.PHYSICS.Gravity.Strength.value;

/* === EXPORTS === */

export { ApplySurfaceCorrection, ApplyGroundSnap, ApplyPlayerSurfaceOrientation, ResolveGrounded, CORRECTION_DISABLED };
