// Shared, entity-agnostic animation runtime.
//
// Per-frame DISPLAY transforms/colors: rest pose + sampled per-part offsets, composed under a
// whole-model pose channel that eases toward the body's orientation independently of the part tracks.
// Visual-only — writes displayTransform/displayColor, never true transforms/colors/model/physics bounds.
// Driven per frame from the handler layer (Level.js for the player); ResolveEntityAnimation is entity-generic.

import { CONFIG, PERFORMANCE_SCALING } from "../../core/config.js";
import { Log, EPSILON } from "../../core/meta.js";
import { ComposeTransform } from "../../builder/NewEntity.js";
import { AddVector3, MultiplyVector3, LerpVector3, CloneVector3, CrossVector3, ResolveVector3Axis, RotateByEuler, RotateTowardVector3, ToVector3, WORLD_NORMALS } from "../../math/Vector3.js";
import { EulerFromBasis } from "../../math/Matrix.js";
import { Lerp, Clamp } from "../../math/Utilities.js";
import { ApplyEasing } from "../../math/Curves.js";

/* === IDENTITY OFFSETS (module-scoped constants; consumed read-only by lerpOffset) === */

const identityOffsetPart  = Object.freeze({ position: Object.freeze(ToVector3(0)), rotation: Object.freeze(ToVector3(0)), scale: Object.freeze(ToVector3(1)) });
const identityOffsetDecal = Object.freeze({ position: Object.freeze(ToVector3(0)), rotation: 0, scale: Object.freeze(ToVector3(1)) });

/* === RUNTIME STATE (core-owned; not authored) === */

function buildRestLocals(model) {
	const restLocals = {};
	model.defaultPose.parts.forEach((part) => { restLocals[part.id] = part.localTransform; });
	return restLocals;
}

function buildDecalIndex(model) {
	const decalIndex = new Map();
	model.parts.forEach((part) => part.mesh.customTextures.forEach((decal) => { if (decal.id) decalIndex.set(decal.id, decal); }));
	return decalIndex;
}

/* === MODEL POSE (whole-model transform, eased independently of per-part tracks) === */

// Seeded from the body so a freshly built model starts already settled on its surface.
function buildModelPose(entity) {
	return {
		position: entity.transform.position.clone(),
		rotation: entity.transform.rotation.clone(),
		scale   : entity.transform.scale,
	};
}

// The basis round-trip lands an ulp off rather than bit-exact, so settling needs a tolerance.
const poseSettled = (a, b) => Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON && Math.abs(a.z - b.z) <= EPSILON;

// Eased in basis space; interpolating Euler triples tears at the pitch pole, which walls sit on.
function stepModelRotation(current, target, maxStep) {
	const up      = RotateTowardVector3(RotateByEuler(WORLD_NORMALS.Up,      current), RotateByEuler(WORLD_NORMALS.Up,      target), maxStep);
	const forward = RotateTowardVector3(RotateByEuler(WORLD_NORMALS.Forward, current), RotateByEuler(WORLD_NORMALS.Forward, target), maxStep);
	const right   = ResolveVector3Axis(CrossVector3(up, forward));
	return EulerFromBasis(right, up, CrossVector3(right, up), current.z);
}

/**
 * Advance the whole-model pose toward the body's orientation.
 * @returns {object|null} — the display root, or null once the pose matches the body.
 */
function resolveModelPose(entity, runtime, deltaSeconds) {
	const pose = runtime.modelPose;
	const rate = entity.underwater ? entity.modelTurnRate.water : entity.modelTurnRate.air;
	pose.rotation.set(stepModelRotation(pose.rotation, entity.transform.rotation, rate * deltaSeconds));

	if (poseSettled(pose.rotation, entity.transform.rotation)) return null;

	pose.position.set(entity.transform.position);
	pose.scale = entity.transform.scale;
	return pose;
}

// Shared hierarchy walk: visit() composes/writes each part's world transform, then recursion continues.
// resolvePoseStep and resolveAnimationStep differ only in what visit() does per part.
function walkModelParts(model, root, visit) {
	const walk = (partId, parentWorld) => {
		const part = model.index[partId];
		const world = visit(partId, part, parentWorld);
		part.children.forEach((childId) => walk(childId, world));
	};
	model.roots.forEach((rootId) => walk(rootId, root));
}

// Rest pose under a leaning root — the animated walk's counterpart when no set is playing.
function resolvePoseStep(model, runtime, root) {
	walkModelParts(model, root, (partId, part, parentWorld) => {
		const world = ComposeTransform(parentWorld, applyPartLocal(runtime, partId, identityOffsetPart));
		writePartDisplay(runtime, part.mesh, world);
		return world;
	});
}

function ensureAnimationRuntime(entity) {
	let runtime = entity.animationRuntime;
	if (runtime === undefined) {
		runtime = {
			lastAction       : null,
			currentSetName   : null,
			elapsed          : 0,
			correctionN      : 0,
			correctionCounter: 0,
			displayedOffsets : new Map(),  // targetKey → offset-from-rest (for transition snapshots)
			snapshots        : new Map(),  // targetKey → offset captured at the last transition
			partLocals       : new Map(),  // partId  → persistent animated local transform
			partDisplays     : new Map(),  // mesh    → persistent display transform
			decalDisplays    : new Map(),  // decal   → persistent display transform
			colorDisplayed   : new Map(),  // targetKey → last applied color (for transition snapshots)
			colorSnapshots   : new Map(),  // targetKey → color at last state transition
			colorDisplays    : new Map(),  // mesh|decalEntry → persistent {r,g,b,a} display color
			restLocals       : buildRestLocals(entity.model),
			decalIndex       : buildDecalIndex(entity.model),
			modelPose        : buildModelPose(entity),
		};
		entity.animationRuntime = runtime;
	}
	return runtime;
}

/* === CORRECTION FRAME COUNT (config tier + entity type) === */

function resolveCorrectionFrames(entityType) {
	const isPlayer = entityType === "player";
	const scaled = Math.round((isPlayer ? 8 : 4) * PERFORMANCE_SCALING.Animation.Entities[CONFIG.PERFORMANCE.Animations]);
	return isPlayer ? Clamp(scaled, 4, 8) : Clamp(scaled, 0, 4);
}

/* === SAMPLING (offset-from-rest space) === */

// Extract a keyframe's offset; missing channels default to identity (position/rotation additive 0,
// scale multiplicative 1). Decal rotation is a scalar (Unit), part rotation a vector3 (UnitVector3).
function keyframeOffset(keyframe, isDecal) {
	return {
		position: keyframe.value.position !== undefined ? keyframe.value.position : ToVector3(0),
		rotation: isDecal
			? (keyframe.value.rotation !== undefined ? keyframe.value.rotation.value : 0)
			: (keyframe.value.rotation !== undefined ? keyframe.value.rotation : ToVector3(0)),
		scale: keyframe.value.scale !== undefined ? keyframe.value.scale : ToVector3(1),
	};
}

function lerpOffset(from, to, factor, isDecal) {
	return {
		position: LerpVector3(from.position, to.position, factor),
		rotation: isDecal ? Lerp(from.rotation, to.rotation, factor) : LerpVector3(from.rotation, to.rotation, factor),
		scale: LerpVector3(from.scale, to.scale, factor),
	};
}

function sampleColorTrack(track, t) {
	if (track === undefined || track.keyframes.length === 0) return null;
	const kfs = track.keyframes;
	const upper = kfs.findIndex((kf) => kf.time >= t);
	if (upper <= 0) return { ...(upper === 0 ? kfs[0] : kfs[kfs.length - 1]).value };
	const from = kfs[upper - 1], to = kfs[upper];
	const span = to.time - from.time;
	const f = ApplyEasing(to.easing, span > 0 ? (t - from.time) / span : 0);
	return { r: Lerp(from.value.r, to.value.r, f), g: Lerp(from.value.g, to.value.g, f),
	         b: Lerp(from.value.b, to.value.b, f), a: Lerp(from.value.a, to.value.a, f) };
}

function lerpColor(from, to, factor) {
	const r = {};
	Object.keys(from).forEach(k => r[k] = Lerp(from[k], to[k], factor));
	return r;
}

// Sample a transform track at normalized time t → offset-from-rest. Linear between the two
// surrounding keyframes, shaped by the destination keyframe's easing across the whole segment.
function sampleTrack(track, t, isDecal) {
	if (track === undefined || track.keyframes.length === 0) return isDecal ? identityOffsetDecal : identityOffsetPart;

	const upperIndex = track.keyframes.findIndex((keyframe) => keyframe.time >= t);
	if (upperIndex <= 0) return keyframeOffset(upperIndex === 0 ? track.keyframes[0] : track.keyframes[track.keyframes.length - 1], isDecal);

	const from = track.keyframes[upperIndex - 1];
	const to = track.keyframes[upperIndex];
	const span = to.time - from.time;
	const eased = ApplyEasing(to.easing, span > 0 ? (t - from.time) / span : 0);
	return lerpOffset(keyframeOffset(from, isDecal), keyframeOffset(to, isDecal), eased, isDecal);
}

/* === DISPLAY TRANSFORM APPLICATION === */

// Persistent animated local transform per part (rest pose ∘ offset), reused each frame.
function applyPartLocal(runtime, partId, offset) {
	const rest = runtime.restLocals[partId];
	let local = runtime.partLocals.get(partId);
	if (local === undefined) {
		local = { position: rest.position.clone(), rotation: rest.rotation.clone(), scale: CloneVector3(rest.scale) };
		runtime.partLocals.set(partId, local);
	}
	local.position.set(AddVector3(rest.position, offset.position));
	local.rotation.set(AddVector3(rest.rotation, offset.rotation));
	local.scale = MultiplyVector3(rest.scale, offset.scale);
	return local;
}

// Write a part's composed display world transform into its persistent display object, swapping the
// mesh's render source off the shared true-transform reference on first use.
function writePartDisplay(runtime, mesh, world) {
	let display = runtime.partDisplays.get(mesh);
	if (display === undefined) {
		display = {
			position: mesh.transform.position.clone(),
			rotation: mesh.transform.rotation.clone(),
			scale   : CloneVector3(world.scale),
			pivot   : mesh.transform.pivot,  // pivot is not animated — reference the true pivot
		};
		runtime.partDisplays.set(mesh, display);
		mesh.displayTransform = display;
	}
	display.position.set(world.position);
	display.rotation.set(world.rotation);
	display.scale = world.scale;
}

// Decal display is face-local (rest ∘ offset); the renderer composes it onto the part's display
// world matrix, so decals inherit their part's animation automatically.
function applyDecalDisplay(runtime, decalEntry, offset) {
	const rest = decalEntry.localTransform;
	let display = runtime.decalDisplays.get(decalEntry);
	if (display === undefined) {
		display = { position: rest.position.clone(), rotation: rest.rotation.clone(), scale: CloneVector3(rest.scale) };
		runtime.decalDisplays.set(decalEntry, display);
		decalEntry.displayTransform = display;
	}
	display.position.set(AddVector3(rest.position, offset.position));
	display.rotation.value = rest.rotation.value + offset.rotation;
	display.scale = MultiplyVector3(rest.scale, offset.scale);
}

function applyDecalSwap(decalEntry, swapTrack, t) {
	let active = null;
	for (const snap of swapTrack) {
		if (snap.time <= t) active = snap.sourceKey;
		else break;
	}
	decalEntry.activeSourceKey = active;
}

function applyDisplayColor(runtime, target, color) {
	let d = runtime.colorDisplays.get(target);
	if (d === undefined) {
		d = { r: color.r, g: color.g, b: color.b, a: color.a };
		runtime.colorDisplays.set(target, d);
		target.displayColor = d;
	} 
	else { d.r = color.r; d.g = color.g; d.b = color.b; d.a = color.a; }
}

// Decals and colors only — a model-pose lean keeps part displays alive after the set ends.
function clearDecorations(runtime) {
	runtime.decalDisplays.forEach((_, decalEntry) => { decalEntry.displayTransform = decalEntry.localTransform; });
	runtime.decalDisplays.clear();
	runtime.displayedOffsets.clear();
	runtime.colorDisplays.forEach((_, target) => { target.displayColor = null; });
	runtime.colorDisplays.clear();
	runtime.colorDisplayed.clear();
	runtime.decalIndex.forEach((decalEntry) => { decalEntry.activeSourceKey = null; });
}

function clearPartDisplay(runtime) {
	runtime.partDisplays.forEach((_, mesh) => { mesh.displayTransform = mesh.transform; });
	runtime.partDisplays.clear();
	runtime.partLocals.clear();
}

// Restore every animated target's render source to its true transform/color (no active animation).
function clearDisplay(runtime) {
	clearDecorations(runtime);
	clearPartDisplay(runtime);
}

/* === PER-FRAME STEP === */

function resolveColorValue(runtime, track, t, targetKey, correctionActive, factor) {
	const sampled = sampleColorTrack(track, t);
	if (sampled === null) return null;
	const color = (correctionActive && runtime.colorSnapshots.has(targetKey))
		? lerpColor(runtime.colorSnapshots.get(targetKey), sampled, factor)
		: sampled;
	runtime.colorDisplayed.set(targetKey, color);
	return color;
}

function resolveTargetOffset(runtime, track, t, targetKey, correctionActive, factor, isDecal) {
	const sampled = sampleTrack(track, t, isDecal);
	const offset = correctionActive
		? lerpOffset(runtime.snapshots.get(targetKey) || (isDecal ? identityOffsetDecal : identityOffsetPart), sampled, factor, isDecal)
		: sampled;
	runtime.displayedOffsets.set(targetKey, offset);
	return offset;
}

function resolveAnimationStep(model, runtime, set, deltaSeconds, root) {
	runtime.elapsed += deltaSeconds;

	let t = set.duration > 0 ? runtime.elapsed / set.duration : 1;
	t = set.loop ? t - Math.floor(t) : Math.min(t, 1);

	const correctionActive = runtime.correctionCounter > 0;
	const factor = correctionActive ? (runtime.correctionN - runtime.correctionCounter) / runtime.correctionN : 1;

	walkModelParts(model, root, (partId, part, parentWorld) => {
		const partTrack = set.parts[partId];

		const offset = resolveTargetOffset(runtime, partTrack !== undefined ? partTrack.transform : undefined, t, partId, correctionActive, factor, false);
		const world = ComposeTransform(parentWorld, applyPartLocal(runtime, partId, offset));
		writePartDisplay(runtime, part.mesh, world);

		const partColor = resolveColorValue(runtime, partTrack !== undefined ? partTrack.color : undefined, t, partId, correctionActive, factor);
		if (partColor !== null) applyDisplayColor(runtime, part.mesh, partColor);

		if (partTrack !== undefined) {
			for (const decalId in partTrack.decals) {
				const decalEntry = runtime.decalIndex.get(decalId);
				const decalTarget = partTrack.decals[decalId];
				const decalOffset = resolveTargetOffset(runtime, decalTarget.transform, t, `${partId}::${decalId}`, correctionActive, factor, true);
				applyDecalDisplay(runtime, decalEntry, decalOffset);
				const decalColor = resolveColorValue(runtime, decalTarget.color, t, `${partId}::${decalId}::color`, correctionActive, factor);
				if (decalColor !== null) applyDisplayColor(runtime, decalEntry, decalColor);
				if (decalTarget.swap !== undefined) applyDecalSwap(decalEntry, decalTarget.swap, t);
			}
		}

		return world;
	});

	if (correctionActive) runtime.correctionCounter -= 1;
}

/* === ENTRY POINT === */

// Case-insensitive naming-convention match of an action to an animation set key.
function resolveSetName(animations, currentAction) {
	for (const setName in animations) if (setName.toLowerCase() === currentAction.toLowerCase()) return setName;
	return null;
}

function ResolveEntityAnimation(entity, deltaSeconds) {
	if (CONFIG.PERFORMANCE.Animations === "Disabled") return;

	const runtime = ensureAnimationRuntime(entity);
	if (entity.action !== runtime.lastAction) {
		const setName = resolveSetName(entity.animations, entity.action);
		runtime.snapshots = new Map(runtime.displayedOffsets);
		runtime.colorSnapshots = new Map(runtime.colorDisplayed);
		runtime.decalIndex.forEach((decalEntry) => decalEntry.activeSourceKey = null);
		runtime.lastAction = entity.action;
		runtime.currentSetName = setName;
		runtime.elapsed = 0;
		runtime.correctionN = resolveCorrectionFrames(entity.type);
		runtime.correctionCounter = runtime.correctionN;
		if (setName === null) Log("ENGINE", `no set matches action '${entity.action}' on '${entity.id}', holding rest`, "warn", "Animation");
	}

	const leaning = resolveModelPose(entity, runtime, deltaSeconds);

	if (runtime.currentSetName === null) {
		// A lean outlives the set, so decals and colors reset while the part displays carry it.
		if (leaning === null) clearDisplay(runtime);
		else {
			clearDecorations(runtime);
			resolvePoseStep(entity.model, runtime, leaning);
		}
		return;
	}

	resolveAnimationStep(entity.model, runtime, entity.animations[runtime.currentSetName], deltaSeconds, leaning !== null ? leaning : entity.model.rootTransform);
}

export { ResolveEntityAnimation };
