// Tracks textures and handles animation states

// Called by Level.js.
// Uses builder/NewTexture.js to build custom textures and sprites
// Render.js reads fromSurface/toSurface/blendRatio and composites on the GPU.

import { BeginTextureBake, AdvanceNoiseBake, ForEachTexturedMesh } from "../../builder/NewTexture.js";
import { Clamp01 } from "../../math/Utilities.js";
import { Vector3SqDistanceToAabb } from "../../math/Vector3.js";
import { GetSimDistanceValue } from "../../physics/Collision.js";
import { PERFORMANCE_SCALING } from "../../core/config.js";

// Rebuilds the static meshes that use each animated texture. Entities report through their own flag instead.
function assignOwnerMeshes(sceneGraph, byTextureID) {
	for (const textureID in byTextureID) byTextureID[textureID].ownerMeshes = [];

	ForEachTexturedMesh({ ...sceneGraph, entities: [] }, (mesh) => {
		const materialEntry = byTextureID[mesh.material.textureID];
		if (materialEntry) materialEntry.ownerMeshes.push(mesh);

		const groups = mesh.geometry.faceTextureGroups;
		if (!groups) return;
		for (const group of groups) {
			const groupEntry = byTextureID[group.textureID];
			if (groupEntry) groupEntry.ownerMeshes.push(mesh);
		}
	});
}

function createAnimationStateEntry(textureEntry, textureScale) {
	// Template times are seconds; blend floors at 1ms to keep blendRatio finite.
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

// Registers newly added animated textures, then refreshes owners for all of them.
function addAnimationEntries(sceneGraph, animationState) {
	for (const textureID in sceneGraph.visualResources.textureRegistry) {
		if (animationState.byTextureID[textureID]) continue;
		const textureEntry = sceneGraph.visualResources.textureRegistry[textureID];
		if (!textureEntry.definition) continue;
		if (textureEntry.definition.animation.able !== true) continue;
		animationState.byTextureID[textureID] = createAnimationStateEntry(textureEntry, animationState.textureScale);
	}
	assignOwnerMeshes(sceneGraph, animationState.byTextureID);
}

function InitializeTextureAnimation(sceneGraph) {
	const animationState = {
		byTextureID: {},
		textureScale: sceneGraph.world.textureScale,
	};

	addAnimationEntries(sceneGraph, animationState);

	sceneGraph.visualResources.textureAnimation = animationState;
	return animationState;
}

function updateTextureAnimationEntry(textureEntry, stateEntry, deltaMilliseconds, textureScale, bakeAllowed) {
	const cycleMs = stateEntry.holdDurationMs + stateEntry.blendDurationMs;

	// Only baking is gated; the clock runs so distant surfaces still crossfade.
	if (bakeAllowed) {
		// Empty toSurface takes the bake; otherwise it parks as lookahead.
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
	}

	stateEntry.elapsedMs += deltaMilliseconds;

	if (stateEntry.phase === "hold") {
		// A blend needs two surfaces.
		if (stateEntry.toSurface === null) return;
		if (stateEntry.elapsedMs < stateEntry.holdDurationMs) return;
		stateEntry.phase = "blend";
		stateEntry.elapsedMs = 0;
	}

	stateEntry.blendRatio = Clamp01(stateEntry.elapsedMs / stateEntry.blendDurationMs);

	// Hold on toSurface until the lookahead lands.
	if (stateEntry.blendRatio < 1 || stateEntry.readySurface === null) return;

	stateEntry.fromSurface    = stateEntry.toSurface;
	stateEntry.toSurface      = stateEntry.readySurface;
	stateEntry.pendingSurface = stateEntry.toSurface;
	stateEntry.readySurface   = null;
	stateEntry.phase          = "hold";
	stateEntry.elapsedMs      = 0;
	stateEntry.blendRatio     = 0;
}

// Keeps animated textures and their owners in step with a spawn or despawn.
function SyncTextureAnimation(sceneGraph) {
	addAnimationEntries(sceneGraph, sceneGraph.visualResources.textureAnimation);
}

// A shared face texture is near if any static mesh using it is.
function isOwnerWithinReach(ownerMeshes, cameraPosition, sqReach) {
	for (const mesh of ownerMeshes) if (Vector3SqDistanceToAabb(cameraPosition, mesh.worldAabb) <= sqReach) return true;
	return false;
}

// Textures worn by entities flagged within bake reach.
function nearEntityTextureIDs(entities) {
	const near = new Set();
	for (const entity of entities) {
		if (!entity.performance.animatedTexture) continue;
		for (const { mesh } of entity.model.parts) {
			near.add(mesh.material.textureID);
			const groups = mesh.geometry.faceTextureGroups;
			if (groups) for (const group of groups) near.add(group.textureID);
		}
	}
	return near;
}

function UpdateTextureAnimation(sceneGraph, deltaMilliseconds) {
	const animationState = sceneGraph.visualResources.textureAnimation;
	const textureIDs = Object.keys(animationState.byTextureID);
	if (textureIDs.length === 0) return;

	const reach = GetSimDistanceValue().value * PERFORMANCE_SCALING.SimDistance.Fractions.TextureAnimation.StopBake;
	const sqReach = reach * reach;
	const nearEntityTextures = nearEntityTextureIDs(sceneGraph.entities);

	for (const textureID of textureIDs) {
		const stateEntry = animationState.byTextureID[textureID];
		const bakeAllowed = nearEntityTextures.has(textureID) || isOwnerWithinReach(stateEntry.ownerMeshes, sceneGraph.cameraConfig.state.position, sqReach);
		updateTextureAnimationEntry(
			sceneGraph.visualResources.textureRegistry[textureID],
			stateEntry,
			deltaMilliseconds,
			animationState.textureScale,
			bakeAllowed
		);
	}
}

export { InitializeTextureAnimation, UpdateTextureAnimation, SyncTextureAnimation };
