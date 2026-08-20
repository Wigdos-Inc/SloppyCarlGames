// Tracks textures and handles animation states

// Called by Level.js and Cutscene.js.
// Uses builder/NewTexture.js to build custom textures and sprites
// Render.js reads fromSurface/toSurface/blendRatio and composites on the GPU.

import { BeginTextureBake, AdvanceNoiseBake } from "../../builder/NewTexture.js";
import { Clamp01 } from "../../math/Utilities.js";

function createAnimationStateEntry(textureEntry, textureScale) {
	// Template animation times are expressed in seconds; convert to milliseconds here.
	// blendDurationMs floors at 1ms to keep blendRatio finite at any blendTime.
	const definition = textureEntry.definition;
	return {
		phase          : "hold",
		elapsedMs      : 0,
		holdDurationMs : (definition.animation.holdTime * 1000) / definition.holdTimeSpeed,
		blendDurationMs: Math.max(1, (definition.animation.blendTime * 1000) / definition.blendTimeSpeed),
		blendRatio     : 0,
		fromSurface    : textureEntry.source,
		toSurface      : null,
		readySurface   : null,
		pendingSurface : null,
		bakeJob        : BeginTextureBake(definition, textureScale),
	};
}

function InitializeTextureAnimation(sceneGraph) {
	const animationState = {
		byTextureID: {},
		textureScale: sceneGraph.world.textureScale,
	};

	for (const textureID in sceneGraph.visualResources.textureRegistry) {
		const textureEntry = sceneGraph.visualResources.textureRegistry[textureID];
		if (!textureEntry.definition) continue;
		if (textureEntry.definition.animation.able !== true) continue;
		animationState.byTextureID[textureID] = createAnimationStateEntry(textureEntry, animationState.textureScale);
	}

	sceneGraph.visualResources.textureAnimation = animationState;
	return animationState;
}

function updateTextureAnimationEntry(textureEntry, stateEntry, deltaMilliseconds, textureScale) {
	const cycleMs = stateEntry.holdDurationMs + stateEntry.blendDurationMs;

	// An empty toSurface takes the finished bake; otherwise it parks as the next cycle's lookahead.
	if (stateEntry.bakeJob !== null) {
		const budget = Math.max(1, Math.ceil((stateEntry.bakeJob.speckCount * deltaMilliseconds) / cycleMs));
		if (AdvanceNoiseBake(stateEntry.bakeJob, budget)) {
			if (stateEntry.toSurface === null) stateEntry.toSurface = stateEntry.bakeJob.canvas;
			else stateEntry.readySurface = stateEntry.bakeJob.canvas;
			stateEntry.bakeJob = null;
		}
	}

	if (stateEntry.bakeJob === null && stateEntry.readySurface === null) {
		stateEntry.bakeJob = BeginTextureBake(textureEntry.definition, textureScale);
	}

	stateEntry.elapsedMs += deltaMilliseconds;

	if (stateEntry.phase === "hold") {
		// A blend needs two surfaces; the bootstrap bake fills the second one.
		if (stateEntry.toSurface === null) return;
		if (stateEntry.elapsedMs < stateEntry.holdDurationMs) return;
		stateEntry.phase = "blend";
		stateEntry.elapsedMs = 0;
	}

	stateEntry.blendRatio = Clamp01(stateEntry.elapsedMs / stateEntry.blendDurationMs);

	// Settles on toSurface until the lookahead lands, stretching the cycle instead of spiking.
	if (stateEntry.blendRatio < 1 || stateEntry.readySurface === null) return;

	stateEntry.fromSurface    = stateEntry.toSurface;
	stateEntry.toSurface      = stateEntry.readySurface;
	stateEntry.pendingSurface = stateEntry.toSurface;
	stateEntry.readySurface   = null;
	stateEntry.phase          = "hold";
	stateEntry.elapsedMs      = 0;
	stateEntry.blendRatio     = 0;
}

function AddTextureAnimationEntries(sceneGraph) {
	const animationState = sceneGraph.visualResources.textureAnimation;
	for (const textureID in sceneGraph.visualResources.textureRegistry) {
		if (animationState.byTextureID[textureID]) continue;
		const textureEntry = sceneGraph.visualResources.textureRegistry[textureID];
		if (!textureEntry.definition) continue;
		if (textureEntry.definition.animation.able !== true) continue;
		animationState.byTextureID[textureID] = createAnimationStateEntry(textureEntry, animationState.textureScale);
	}
}

function UpdateTextureAnimation(sceneGraph, deltaMilliseconds) {
	const animationState = sceneGraph.visualResources.textureAnimation;
	for (const textureID in animationState.byTextureID) {
		updateTextureAnimationEntry(
			sceneGraph.visualResources.textureRegistry[textureID],
			animationState.byTextureID[textureID],
			deltaMilliseconds,
			animationState.textureScale
		);
	}
}

export { InitializeTextureAnimation, UpdateTextureAnimation, AddTextureAnimationEntries };
