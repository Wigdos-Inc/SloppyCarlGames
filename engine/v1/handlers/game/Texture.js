// Tracks textures and handles animation states

// Called by Level.js and Cutscene.js.
// Uses builder/NewTexture.js to build custom textures and sprites
// Uses Animation.js to animate textures

import { BuildTextureSurface } from "../../builder/NewTexture.js";
import { Clamp01 } from "../../math/Utilities.js";

function createAnimationStateEntry(textureEntry) {
	// Template animation times are expressed in seconds; convert to milliseconds here
	const activeCanvas = document.createElement("canvas");
	activeCanvas.width = textureEntry.source.width;
	activeCanvas.height = textureEntry.source.height;

	const activeContext = activeCanvas.getContext("2d");
	activeContext.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
	activeContext.drawImage(textureEntry.source, 0, 0);

	return {
		phase          : "hold",
		elapsedMs      : 0,
		holdDurationMs : (textureEntry.definition.animation.holdTime * 1000) / textureEntry.definition.holdTimeSpeed,
		blendDurationMs: (textureEntry.definition.animation.blendTime * 1000) / textureEntry.definition.blendTimeSpeed,
		fromSurface    : textureEntry.source,
		toSurface      : null,
		activeSurface  : activeCanvas,
	};
}

function blendTextureSurfaces(stateEntry, ratio) {
	const context = stateEntry.activeSurface.getContext("2d");
	context.clearRect(0, 0, stateEntry.activeSurface.width, stateEntry.activeSurface.height);

	context.globalAlpha = 1 - ratio;
	context.drawImage(stateEntry.fromSurface, 0, 0);

	context.globalAlpha = ratio;
	context.drawImage(stateEntry.toSurface, 0, 0);

	context.globalAlpha = 1;
	return stateEntry.activeSurface;
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
		stateEntry.toSurface = BuildTextureSurface(textureEntry.definition, textureEntry.definition.size, textureScale);
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

function AddTextureAnimationEntries(sceneGraph) {
	for (const textureID in sceneGraph.visualResources.textureRegistry) {
		if (sceneGraph.visualResources.textureAnimation.byTextureID[textureID]) continue;
		const textureEntry = sceneGraph.visualResources.textureRegistry[textureID];
		if (!textureEntry.definition) continue;
		if (textureEntry.definition.animation.able !== true) continue;
		sceneGraph.visualResources.textureAnimation.byTextureID[textureID] = createAnimationStateEntry(textureEntry);
	}
}

function UpdateTextureAnimation(sceneGraph, deltaMilliseconds) {
	for (const textureID in sceneGraph.visualResources.textureAnimation.byTextureID) {
		updateTextureAnimationEntry(
			sceneGraph.visualResources.textureRegistry[textureID],
			sceneGraph.visualResources.textureAnimation.byTextureID[textureID],
			deltaMilliseconds,
			sceneGraph.visualResources.textureAnimation.textureScale
		)
	}
}

export { InitializeTextureAnimation, UpdateTextureAnimation, AddTextureAnimationEntries };