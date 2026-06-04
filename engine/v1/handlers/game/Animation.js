// Shared, entity-agnostic animation runtime.
//
// Computes per-frame DISPLAY transforms for an entity's parts and shape decals: the rest pose
// composed with a sampled, soft-corrected, hierarchically-propagated animation offset. Output is
// visual-only — it writes only mesh/decal `displayTransform` and never mutates true transforms,
// model values, or physics bounds. Driven per frame from the handler layer (Level.js for the
// player); the same `ResolveEntityAnimation` serves any entity once a driver wires it.

import { CONFIG } from "../../core/config.js";
import { Log } from "../../core/meta.js";
import { ComposeTransform } from "../../builder/NewEntity.js";
import { AddVector3, MultiplyVector3, LerpVector3, CloneVector3, ToVector3 } from "../../math/Vector3.js";
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
	model.parts.forEach((part) => {
		part.mesh.customTextures.forEach((decal) => { if (decal.id) decalIndex.set(decal.id, decal); });
	});
	return decalIndex;
}

function ensureAnimationRuntime(entity) {
	let runtime = entity.animationRuntime;
	if (runtime === undefined) {
		runtime = {
			lastState        : null,
			currentSetName   : null,
			elapsed          : 0,
			correctionN      : 0,
			correctionCounter: 0,
			displayedOffsets : new Map(),  // targetKey → offset-from-rest (for transition snapshots)
			snapshots        : new Map(),  // targetKey → offset captured at the last transition
			partLocals       : new Map(),  // partId  → persistent animated local transform
			partDisplays     : new Map(),  // mesh    → persistent display transform
			decalDisplays    : new Map(),  // decal   → persistent display transform
			restLocals       : buildRestLocals(entity.model),
			decalIndex       : buildDecalIndex(entity.model),
		};
		entity.animationRuntime = runtime;
	}
	return runtime;
}

/* === CORRECTION FRAME COUNT (config tier + entity type) === */

function resolveCorrectionFrames(entityType) {
	const qualityScale = { low: 0.25, medium: 0.50, high: 1 }[CONFIG.PERFORMANCE.Animations.Quality];
	const isPlayer = entityType === "player";
	const scaled = Math.round((isPlayer ? 8 : 4) * qualityScale);
	return isPlayer ? Clamp(scaled, 4, 8) : Clamp(scaled, 0, 4);
}

/* === SAMPLING (offset-from-rest space) === */

// Extract a keyframe's offset; missing channels default to identity (position/rotation additive 0,
// scale multiplicative 1). Decal rotation is a scalar (Unit), part rotation a vector3 (UnitVector3).
function keyframeOffset(keyframe, isDecal) {
	const value = keyframe.value;
	return {
		position: value.position !== undefined ? value.position : ToVector3(0),
		rotation: isDecal
			? (value.rotation !== undefined ? value.rotation.value : 0)
			: (value.rotation !== undefined ? value.rotation : ToVector3(0)),
		scale: value.scale !== undefined ? value.scale : ToVector3(1),
	};
}

function lerpOffset(from, to, factor, isDecal) {
	return {
		position: LerpVector3(from.position, to.position, factor),
		rotation: isDecal ? Lerp(from.rotation, to.rotation, factor) : LerpVector3(from.rotation, to.rotation, factor),
		scale: LerpVector3(from.scale, to.scale, factor),
	};
}

// Sample a transform track at normalized time t → offset-from-rest. Linear between the two
// surrounding keyframes, shaped by the destination keyframe's easing across the whole segment.
function sampleTrack(track, t, isDecal) {
	if (track === undefined || track.keyframes.length === 0) return isDecal ? identityOffsetDecal : identityOffsetPart;

	const keyframes = track.keyframes;
	const upperIndex = keyframes.findIndex((keyframe) => keyframe.time >= t);
	if (upperIndex <= 0) return keyframeOffset(upperIndex === 0 ? keyframes[0] : keyframes[keyframes.length - 1], isDecal);

	const from = keyframes[upperIndex - 1];
	const to = keyframes[upperIndex];
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

// Restore every animated target's render source to its true transform (no active animation).
function clearDisplay(runtime) {
	runtime.partDisplays.forEach((_, mesh) => { mesh.displayTransform = mesh.transform; });
	runtime.decalDisplays.forEach((_, decalEntry) => { decalEntry.displayTransform = decalEntry.localTransform; });
	runtime.partDisplays.clear();
	runtime.decalDisplays.clear();
	runtime.partLocals.clear();
	runtime.displayedOffsets.clear();
}

/* === PER-FRAME STEP === */

function resolveTargetOffset(runtime, track, t, targetKey, correctionActive, factor, isDecal) {
	const sampled = sampleTrack(track, t, isDecal);
	const offset = correctionActive
		? lerpOffset(runtime.snapshots.get(targetKey) || (isDecal ? identityOffsetDecal : identityOffsetPart), sampled, factor, isDecal)
		: sampled;
	runtime.displayedOffsets.set(targetKey, offset);
	return offset;
}

function resolveAnimationStep(model, runtime, set, deltaSeconds) {
	runtime.elapsed += deltaSeconds;

	let t = set.duration > 0 ? runtime.elapsed / set.duration : 1;
	t = set.loop ? t - Math.floor(t) : Math.min(t, 1);

	const correctionActive = runtime.correctionCounter > 0;
	const factor = correctionActive ? (runtime.correctionN - runtime.correctionCounter) / runtime.correctionN : 1;

	const walk = (partId, parentWorld) => {
		const part = model.index[partId];
		const partTrack = set.parts[partId];

		const offset = resolveTargetOffset(runtime, partTrack !== undefined ? partTrack.transform : undefined, t, partId, correctionActive, factor, false);
		const world = ComposeTransform(parentWorld, applyPartLocal(runtime, partId, offset));
		writePartDisplay(runtime, part.mesh, world);

		if (partTrack !== undefined) {
			for (const decalId in partTrack.decals) {
				const decalEntry = runtime.decalIndex.get(decalId);
				const decalOffset = resolveTargetOffset(runtime, partTrack.decals[decalId].transform, t, `${partId}::${decalId}`, correctionActive, factor, true);
				applyDecalDisplay(runtime, decalEntry, decalOffset);
			}
		}

		part.children.forEach((childId) => walk(childId, world));
	};

	model.roots.forEach((rootId) => walk(rootId, model.rootTransform));

	if (correctionActive) runtime.correctionCounter -= 1;
}

/* === ENTRY POINT === */

// Case-insensitive naming-convention match of a state to an animation set key.
function resolveSetName(animations, currentState) {
	const target = currentState.toLowerCase();
	for (const setName in animations) {
		if (setName.toLowerCase() === target) return setName;
	}
	return null;
}

function ResolveEntityAnimation(entity, deltaSeconds) {
	if (CONFIG.PERFORMANCE.Animations.Active !== true) return;

	const runtime = ensureAnimationRuntime(entity);
	const currentState = entity.state;  // current-state string (the player's FSM state)

	if (currentState !== runtime.lastState) {
		const setName = resolveSetName(entity.animations, currentState);
		runtime.snapshots = new Map(runtime.displayedOffsets);
		runtime.lastState = currentState;
		runtime.currentSetName = setName;
		runtime.elapsed = 0;
		runtime.correctionN = resolveCorrectionFrames(entity.type);
		runtime.correctionCounter = runtime.correctionN;
		if (setName === null) Log("Animation", `no set matches state '${currentState}' on '${entity.id}', holding rest`, "warn", "Animation");
	}

	if (runtime.currentSetName === null) {
		clearDisplay(runtime);
		return;
	}

	resolveAnimationStep(entity.model, runtime, entity.animations[runtime.currentSetName], deltaSeconds);
}

export { ResolveEntityAnimation };
