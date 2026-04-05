// Tracks textures and handles animation states

// Called by Level.js and Cutscene.js.
// Uses builder/NewTexture.js to build custom textures and sprites
// Uses Animation.js to animate textures

import { BuildTextureSurface } from "../../builder/NewTexture.js";
import { Clamp01 } from "../../math/Utilities.js";

function createAnimationStateEntry(textureEntry) {
	const definition = textureEntry.definition;
	// Template animation times are expressed in seconds; convert to milliseconds here
	const holdDurationMs = (definition.animation.holdTime * 1000) / definition.holdTimeSpeed;
	const blendDurationMs = (definition.animation.blendTime * 1000) / definition.blendTimeSpeed;
	const activeCanvas = document.createElement("canvas");
	activeCanvas.width = textureEntry.source.width;
	activeCanvas.height = textureEntry.source.height;
	const activeContext = activeCanvas.getContext("2d");
	activeContext.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
	activeContext.drawImage(textureEntry.source, 0, 0);

	return {
		phase: "hold",
		elapsedMs: 0,
		holdDurationMs: holdDurationMs,
		blendDurationMs: blendDurationMs,
		fromSurface: textureEntry.source,
		toSurface: null,
		activeSurface: activeCanvas,
	};
}

function blendTextureSurfaces(stateEntry, ratio) {
	const activeSurface = stateEntry.activeSurface;
	const context = activeSurface.getContext("2d");
	context.clearRect(0, 0, activeSurface.width, activeSurface.height);

	context.globalAlpha = 1 - ratio;
	context.drawImage(stateEntry.fromSurface, 0, 0);

	context.globalAlpha = ratio;
	context.drawImage(stateEntry.toSurface, 0, 0);

	context.globalAlpha = 1;
	return activeSurface;
}

function InitializeTextureAnimation(sceneGraph) {
	const textureRegistry = sceneGraph.visualResources.textureRegistry;
	const animationState = {
		byTextureID: {},
		textureScale: sceneGraph.world.textureScale,
	};

	const textureIDs = Object.keys(textureRegistry);
	for (let index = 0; index < textureIDs.length; index++) {
		const textureID = textureIDs[index];
		const textureEntry = textureRegistry[textureID];
		if (textureEntry.definition.animation.able !== true) continue;

		animationState.byTextureID[textureID] = createAnimationStateEntry(textureEntry);
	}

	sceneGraph.visualResources.textureAnimation = animationState;
	return animationState;
}

function updateTextureAnimationEntry(textureEntry, stateEntry, deltaMilliseconds, textureScale) {
	stateEntry.elapsedMs += deltaMilliseconds;

	if (stateEntry.phase === "hold" && stateEntry.elapsedMs >= stateEntry.holdDurationMs) {
		stateEntry.phase = "blend";
		stateEntry.elapsedMs = 0;
		stateEntry.fromSurface = textureEntry.source;
		stateEntry.toSurface = BuildTextureSurface(
			textureEntry.definition,
			textureEntry.definition.size,
			textureScale
		);
	}

	if (stateEntry.phase === "blend") {
		const blendRatio = Clamp01(stateEntry.elapsedMs / stateEntry.blendDurationMs);
		textureEntry.source = blendTextureSurfaces(stateEntry, blendRatio);
		textureEntry.dirty = true;

		if (blendRatio >= 1) {
			textureEntry.source = stateEntry.toSurface;
			textureEntry.dirty = true;
			stateEntry.phase = "hold";
			stateEntry.elapsedMs = 0;
			stateEntry.fromSurface = stateEntry.toSurface;
			stateEntry.toSurface = null;
		}
	}
}

function UpdateTextureAnimation(sceneGraph, deltaMilliseconds) {
	const animationState = sceneGraph.visualResources.textureAnimation;
	const textureRegistry = sceneGraph.visualResources.textureRegistry;
	const textureIDs = Object.keys(animationState.byTextureID);

	for (let index = 0; index < textureIDs.length; index++) {
		const textureID = textureIDs[index];
		const stateEntry = animationState.byTextureID[textureID];
		const textureEntry = textureRegistry[textureID];
		updateTextureAnimationEntry(textureEntry, stateEntry, deltaMilliseconds, animationState.textureScale);
	}
}

export { InitializeTextureAnimation, UpdateTextureAnimation };