// Animates entity models on screen without touching their true transforms or physics.

// Used by handlers/game/Level.js to animate the player.
// Used by handlers/game/Simulator.js to animate its entity.
// Uses builder/NewEntity.js to place each part in the world.
// Uses physics/Correction.js for the pivot the shown model turns about.

import { CONFIG, PERFORMANCE_SCALING } from "../../core/config.js";
import { Log, EPSILON } from "../../core/meta.js";
import { ComposeTransform } from "../../builder/NewEntity.js";
import { PoseAnchor } from "../../physics/Correction.js";
import { 
	AddVector3, 
	SubtractVector3, 
	MultiplyVector3, 
	LerpVector3, 
	CloneTransform, 
	CloneVector3, 
	CrossVector3, 
	ResolveVector3Axis, 
	RotateByEuler, 
	RotateTowardVector3, 
	ToVector3, 
	WORLD_NORMALS 
} from "../../math/Vector3.js";
import { EulerFromBasis } from "../../math/Matrix.js";
import { Lerp, Clamp, Unit } from "../../math/Utilities.js";
import { ApplyEasing } from "../../math/Curves.js";

// Offsets that leave a part or decal at rest.
const identityOffsetPart  = Object.freeze({ 
	position: Object.freeze(ToVector3(0)), 
	rotation: Object.freeze(ToVector3(0)), 
	scale   : Object.freeze(ToVector3(1)) 
});
const identityOffsetDecal = Object.freeze({ position: Object.freeze(ToVector3(0)), rotation: 0, scale: Object.freeze(ToVector3(1)) });

/* === RUNTIME STATE === */

function buildRestLocals(model) {
	const restLocals = {};
	model.defaultPose.parts.forEach((part) => restLocals[part.id] = part.localTransform);
	return restLocals;
}

function buildDecalIndex(model) {
	const decalIndex = new Map();
	model.parts.forEach((part) => part.mesh.detail.texture.custom.forEach((decal) => { 
		if (decal.id) decalIndex.set(decal.id, decal); 
	}));
	return decalIndex;
}

// Check the model has caught up to the body, allowing for rounding from the direction math.
const poseSettled = (a, b) => Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON && Math.abs(a.z - b.z) <= EPSILON;

// Turn the model toward the target through its up and forward directions to avoid tearing on walls.
function stepModelRotation(current, target, maxStep) {
	const step    = maxStep.toRadians();
	const up      = RotateTowardVector3(RotateByEuler(WORLD_NORMALS.Up,      current), RotateByEuler(WORLD_NORMALS.Up,      target), step);
	const forward = RotateTowardVector3(RotateByEuler(WORLD_NORMALS.Forward, current), RotateByEuler(WORLD_NORMALS.Forward, target), step);
	const right   = ResolveVector3Axis(CrossVector3(up, forward));
	return EulerFromBasis(right, up, CrossVector3(right, up), current.z);
}

// Turn the whole model toward the body's orientation.
function resolveModelPose(entity, runtime, deltaSeconds) {
	const pose = runtime.modelPose;

	// Water resists turning, even on the ground.
	const rate = entity.physics.medium === "Water" ? entity.modelTurnRate.water : entity.modelTurnRate.air;
	pose.rotation.set(stepModelRotation(pose.rotation, entity.transform.rotation, new Unit(rate.toRadians() * deltaSeconds, "radians")));

	if (poseSettled(pose.rotation, entity.transform.rotation)) return null;

	// Turn about the physics pivot to keep the model from jumping when the body snaps.
	const anchor = PoseAnchor(entity);
	pose.position.set(AddVector3(entity.transform.position, SubtractVector3(RotateByEuler(anchor, entity.transform.rotation), RotateByEuler(anchor, pose.rotation))));
	pose.scale = entity.transform.scale;
	return pose;
}

// Walk the part tree from each root, handing each part's world transform to its children.
function walkModelParts(model, root, visit) {
	const walk = (partId, parentWorld) => {
		const part = model.index[partId];
		const world = visit(partId, part, parentWorld);
		part.children.forEach((childId) => walk(childId, world));
	};
	model.roots.forEach((rootId) => walk(rootId, root));
}

// Show the rest pose under a leaning model.
function resolvePoseStep(model, runtime, root) {
	walkModelParts(model, root, (partId, part, parentWorld) => {
		const world = ComposeTransform(parentWorld, applyPartLocal(runtime, partId, identityOffsetPart));
		writePartDisplay(runtime, part.mesh, world);
		return world;
	});
}

// Build an entity's animation state on first use.
// Note: Level.js builds the player's early for the camera to read its pose.
function EnsureAnimationRuntime(entity) {
	let runtime = entity.display.animationRuntime;
	if (runtime === null) {
		runtime = {
			lastAction       : null,
			currentSetName   : null,
			elapsed          : 0,
			correctionN      : 0,
			correctionCounter: 0,
			displayedOffsets : new Map(),                           // Each target's shown offset from rest
			snapshots        : new Map(),                           // Each target's offset when the action last changed
			partLocals       : new Map(),                           // Each part's animated local transform, reused per frame
			partDisplays     : new Map(),                           // Each mesh's shown transform
			decalDisplays    : new Map(),                           // Each decal's shown transform
			colorDisplayed   : new Map(),                           // Each target's shown color
			colorSnapshots   : new Map(),                           // Each target's color when the action last changed
			partColors       : new Map(),                           // Each mesh's shown color
			decalColors      : new Map(),                           // Each decal's shown color
			restLocals       : buildRestLocals(entity.model),
			decalIndex       : buildDecalIndex(entity.model),
			modelPose        : CloneTransform(entity.transform),
		};
		entity.display.animationRuntime = runtime;
	}
	return runtime;
}

/* === CORRECTION FRAMES === */

// Count the frames a new action blends in over, scaled by animation quality.
function resolveCorrectionFrames(entityType) {
	const isPlayer = entityType === "player";
	const scaled = Math.round((isPlayer ? 8 : 4) * PERFORMANCE_SCALING.Animation.Entities[CONFIG.Performance.Animations]);
	return isPlayer ? Clamp(scaled, 4, 8) : Clamp(scaled, 0, 4);
}

/* === SAMPLING === */

// Read a keyframe's offset from rest, leaving missing channels at rest.
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

// Sample a track's offset from rest at time t, eased by the keyframe it moves toward.
function sampleTrack(track, t, isDecal) {
	if (track === undefined || track.keyframes.length === 0) return isDecal ? identityOffsetDecal : identityOffsetPart;

	const upperIndex = track.keyframes.findIndex((keyframe) => keyframe.time >= t);
	if (upperIndex <= 0) return keyframeOffset(upperIndex === 0 ? track.keyframes[0] : track.keyframes[track.keyframes.length - 1], isDecal);

	const from  = track.keyframes[upperIndex - 1], to = track.keyframes[upperIndex];
	const span  = to.time - from.time;
	return lerpOffset(keyframeOffset(from, isDecal), keyframeOffset(to, isDecal), ApplyEasing(to.easing, span > 0 ? (t - from.time) / span : 0), isDecal);
}

/* === DISPLAY TRANSFORM APPLICATION === */

// Apply an offset to a part's rest transform, reusing one transform per part.
function applyPartLocal(runtime, partId, offset) {
	const rest = runtime.restLocals[partId];
	let local  = runtime.partLocals.get(partId);
	if (local === undefined) {
		local = CloneTransform(rest);
		runtime.partLocals.set(partId, local);
	}

	local.position.set(AddVector3(rest.position, offset.position));
	local.rotation.set(AddVector3(rest.rotation, offset.rotation));
	local.scale = MultiplyVector3(rest.scale, offset.scale);

	return local;
}

// Write a part's shown world transform, moving its mesh off the true transform on first use.
function writePartDisplay(runtime, mesh, world) {
	let display = runtime.partDisplays.get(mesh);
	if (display === undefined) {
		display = CloneTransform(mesh.transform);
		runtime.partDisplays.set(mesh, display);
		mesh.display.transform = display;
	}
	display.position.set(world.position);
	display.rotation.set(world.rotation);
	display.scale = world.scale;
}

// Apply an offset to a decal's rest transform on its face.
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

// Keep one display color per target and update it in place.
function applyDisplayColor(colors, target, color) {
	let d = colors.get(target);
	if (d === undefined) {
		d = { r: color.r, g: color.g, b: color.b, a: color.a };
		colors.set(target, d);
	}
	else {
		d.r = color.r;
		d.g = color.g;
		d.b = color.b;
		d.a = color.a;
	}
	return d;
}

// Reset decals and colors to their true values.
function clearDecorations(runtime) {
	runtime.decalDisplays.forEach((_, decalEntry) => { decalEntry.displayTransform = decalEntry.localTransform; });
	runtime.decalDisplays.clear();
	runtime.displayedOffsets.clear();
	runtime.partColors.forEach((_, mesh) => { mesh.display.color = null; });
	runtime.decalColors.forEach((_, decalEntry) => { decalEntry.displayColor = null; });
	runtime.partColors.clear();
	runtime.decalColors.clear();
	runtime.colorDisplayed.clear();
	runtime.decalIndex.forEach((decalEntry) => { decalEntry.activeSourceKey = null; });
}

// Reset parts to their true transforms.
function clearPartDisplay(runtime) {
	runtime.partDisplays.forEach((_, mesh) => { mesh.display.transform = mesh.transform; });
	runtime.partDisplays.clear();
	runtime.partLocals.clear();
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
		if (partColor !== null) part.mesh.display.color = applyDisplayColor(runtime.partColors, part.mesh, partColor);

		if (partTrack !== undefined) {
			for (const decalId in partTrack.decals) {
				const decalEntry = runtime.decalIndex.get(decalId);
				const decalTarget = partTrack.decals[decalId];

				const decalOffset = resolveTargetOffset(runtime, decalTarget.transform, t, `${partId}::${decalId}`, correctionActive, factor, true);
				applyDecalDisplay(runtime, decalEntry, decalOffset);

				const decalColor = resolveColorValue(runtime, decalTarget.color, t, `${partId}::${decalId}::color`, correctionActive, factor);
				if (decalColor !== null) decalEntry.displayColor = applyDisplayColor(runtime.decalColors, decalEntry, decalColor);
				if (decalTarget.swap !== undefined) applyDecalSwap(decalEntry, decalTarget.swap, t);
			}
		}

		return world;
	});

	if (correctionActive) runtime.correctionCounter -= 1;
}

/* === ENTRY POINT === */

// Find the animation set named after the action, ignoring case.
function resolveSetName(animations, currentAction) {
	for (const setName in animations) if (setName.toLowerCase() === currentAction.toLowerCase()) return setName;
	return null;
}

// Animate an entity's model for this frame.
function ResolveEntityAnimation(entity, deltaSeconds) {
	if (CONFIG.Performance.Animations === "Disabled") return;

	const runtime = EnsureAnimationRuntime(entity);
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
		if (setName === null) {
			Log("ENGINE", `no set matches action '${entity.action}' on '${entity.id}', holding rest`, "warn", "Level");
		}
	}

	const leaning = resolveModelPose(entity, runtime, deltaSeconds);

	if (runtime.currentSetName === null) {
		// Reset decals and colors with no animation playing, holding any lean on the rest pose.
		clearDecorations(runtime);
		leaning === null ? clearPartDisplay(runtime) : resolvePoseStep(entity.model, runtime, leaning);
		return;
	}

	resolveAnimationStep(entity.model, runtime, entity.animations[runtime.currentSetName], deltaSeconds, leaning ?? entity.model.rootTransform);
}

export { EnsureAnimationRuntime, ResolveEntityAnimation };
