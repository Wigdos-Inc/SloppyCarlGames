// Animates textures by crossfading between freshly baked noise surfaces.

// Used by handlers/game/Level.js to run texture animation each frame.
// Used by handlers/Render.js to blend between the surfaces it tracks.
// Uses builder/NewTexture.js to bake new surfaces and find the meshes that use them.

import { BeginTextureBake, AdvanceNoiseBake, ForEachTexturedMesh } from "../../builder/NewTexture.js";
import { Clamp01 } from "../../math/Utilities.js";
import { Vector3SqDistanceToAabb } from "../../math/Vector3.js";
import { CONFIG, PERFORMANCE_SCALING } from "../../core/config.js";

// List the static meshes using each animated texture, leaving entities to their own flag.
function assignOwnerMeshes(sceneGraph, byTextureID) {
	for (const textureID in byTextureID) byTextureID[textureID].ownerMeshes = [];

	ForEachTexturedMesh({ ...sceneGraph, entities: [] }, (mesh) => {
		const { registryID, faceNoiseGroups } = mesh.detail.texture.base;
		const registryEntry = byTextureID[registryID];
		if (registryEntry) registryEntry.ownerMeshes.push(mesh);

		if (faceNoiseGroups === null) return;
		for (const group of faceNoiseGroups) {
			const groupEntry = byTextureID[group.textureID];
			if (groupEntry) groupEntry.ownerMeshes.push(mesh);
		}
	});
}

// Start a texture's animation in its hold phase.
function createEntry(textureEntry, textureScale) {
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
		ownerMeshes    : [],
		bakeJob        : BeginTextureBake(definition, textureScale),
	};
}

// Register newly added animated textures, then refresh the owners of all of them.
function addAnimationEntries(sceneGraph, animationState) {
	for (const textureID in sceneGraph.visualResources.textureRegistry) {
		const textureEntry = sceneGraph.visualResources.textureRegistry[textureID];
		if (animationState.byTextureID[textureID] || !textureEntry.definition || textureEntry.definition.animation.able !== true) continue;
		animationState.byTextureID[textureID] = createEntry(textureEntry, animationState.textureScale);
	}
	assignOwnerMeshes(sceneGraph, animationState.byTextureID);
}

// Start animating the level's textures.
function InitializeTextureAnimation(sceneGraph) {
	const animationState = {
		byTextureID : {},
		textureScale: sceneGraph.world.textureScale,
	};

	addAnimationEntries(sceneGraph, animationState);
	sceneGraph.visualResources.textureAnimation = animationState;
}

// Advance one texture's bake and crossfade.
function updateEntry(textureEntry, stateEntry, deltaMilliseconds, textureScale, bakeAllowed) {
	const cycleMs = stateEntry.holdDurationMs + stateEntry.blendDurationMs;

	// Gate only the bake, keeping the clock running for distant surfaces to crossfade.
	if (bakeAllowed) {
		// Use a finished bake as the next surface, or keep it ready for the one after.
		if (stateEntry.bakeJob !== null) {
			const budget = Math.max(1, Math.ceil((stateEntry.bakeJob.speckCount * deltaMilliseconds) / cycleMs));
			if (AdvanceNoiseBake(stateEntry.bakeJob, budget)) {
				stateEntry.toSurface === null ? stateEntry.toSurface = stateEntry.bakeJob.canvas : stateEntry.readySurface = stateEntry.bakeJob.canvas;
				stateEntry.bakeJob = null;
			}
		}

		if (stateEntry.bakeJob === null && stateEntry.readySurface === null) {
			stateEntry.bakeJob = BeginTextureBake(textureEntry.definition, textureScale);
		}
	}

	stateEntry.elapsedMs += deltaMilliseconds;

	if (stateEntry.phase === "hold") {
		// Blend once the hold ends and a second surface exists.
		if (stateEntry.toSurface === null) return;
		if (stateEntry.elapsedMs < stateEntry.holdDurationMs) return;
		stateEntry.phase = "blend";
		stateEntry.elapsedMs = 0;
	}

	stateEntry.blendRatio = Clamp01(stateEntry.elapsedMs / stateEntry.blendDurationMs);

	// Swap in the next surface once the blend ends and it's baked.
	if (stateEntry.blendRatio < 1 || stateEntry.readySurface === null) return;

	stateEntry.fromSurface    = stateEntry.toSurface;
	stateEntry.toSurface      = stateEntry.readySurface;
	stateEntry.pendingSurface = stateEntry.toSurface;
	stateEntry.readySurface   = null;
	stateEntry.phase          = "hold";
	stateEntry.elapsedMs      = 0;
	stateEntry.blendRatio     = 0;
}

// Keep animated textures and their owners in step with a spawn or despawn.
const SyncTextureAnimation = (sceneGraph) => addAnimationEntries(sceneGraph, sceneGraph.visualResources.textureAnimation);

// Check any static mesh using a texture is within bake reach.
function ownerInReach(ownerMeshes, cameraPosition, sqReach) {
	for (const mesh of ownerMeshes) if (Vector3SqDistanceToAabb(cameraPosition, mesh.display.aabb) <= sqReach) return true;
	return false;
}

// Collect the textures worn by entities within bake reach.
function nearEntityTextures(entities) {
	const near = new Set();
	for (const entity of entities) {
		if (!entity.performance.animatedTexture) continue;
		for (const part of entity.model.parts) {
			const { registryID, faceNoiseGroups } = part.mesh.detail.texture.base;
			near.add(registryID);
			if (faceNoiseGroups !== null) for (const group of faceNoiseGroups) near.add(group.textureID);
		}
	}
	return near;
}

// Advance every animated texture for this frame.
function UpdateTextureAnimation(sceneGraph, deltaMilliseconds) {
	const animationState = sceneGraph.visualResources.textureAnimation;
	const textureIDs     = Object.keys(animationState.byTextureID);
	if (textureIDs.length === 0) return;

	const { Tiers, Fractions } = PERFORMANCE_SCALING.SimDistance;
	const sqReach = (Tiers[CONFIG.Performance.SimDistance].value * Fractions.TextureAnimation.StopBake) ** 2;
	const cameraPosition = sceneGraph.cameraConfig.state.position;
	const nearTextures = nearEntityTextures(sceneGraph.entities);

	for (const textureID of textureIDs) {
		const stateEntry = animationState.byTextureID[textureID];
		const bakeAllowed = nearTextures.has(textureID) || ownerInReach(stateEntry.ownerMeshes, cameraPosition, sqReach);
		updateEntry(
			sceneGraph.visualResources.textureRegistry[textureID],
			stateEntry,
			deltaMilliseconds,
			animationState.textureScale,
			bakeAllowed
		);
	}
}

export { InitializeTextureAnimation, UpdateTextureAnimation, SyncTextureAnimation };
