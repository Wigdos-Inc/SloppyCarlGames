// Builds terrain meshes: single-part objects (legacy path) and flattened multi-part composition.

// Used by NewLevel.js
// Uses NewTemplate.js to resolve templates.
// Uses NewObject.js to build meshes.

import { BuildObject } from "./NewObject.js";
import { ResolveObjectSource } from "./NewTemplate.js";
import { Log } from "../core/meta.js";
import { MultiplyVector3 } from "../math/Vector3.js";

// Lift terrain by half its height, making 'position' match the part's bottom.
function raisePartPosition(pos, dimY, scaleY) {
	pos.y += dimY * scaleY * 0.5;
	return pos;
}

function buildSingleTerrain(source, world, faceTextureStore) {
	raisePartPosition(source.position, source.dimensions.y, source.scale.y);
	const mesh = BuildObject({ ...source, role: "terrain", textureScale: world.textureScale, faceTextureStore }).mesh;
	return [mesh];
}

// Independent flattened meshes: root+local transform composition with per-part grounding.
function buildTerrainParts(source, world, faceTextureStore) {
	const { scale: rootScale, position: rootPos, rotation: rootRot, pivot, collisionShape, mode, nullable, sticky } = source;
	const textureScale = world.textureScale;

	return source.parts.map((part, partIndex) => {
		const { localScale, localPosition, dimensions, localRotation } = part;
		const scale = MultiplyVector3(rootScale, localScale);

		const mesh = BuildObject({
			...part,
			id    : `${source.id}:${part.id}`,
			position: raisePartPosition(rootPos.clone().add(MultiplyVector3(localPosition, rootScale)), dimensions.y, scale.y), 
			rotation: rootRot.clone().add(localRotation), 
			scale, pivot,
			detail: { scatter: part.detail.scatter.length > 0 ? part.detail.scatter : (partIndex === 0 ? source.detail.scatter : []) },
			role  : "terrain",
			collisionShape, mode, nullable, sticky, textureScale, faceTextureStore,
		}).mesh;

		return mesh;
	});
}

function BuildTerrain(objects, world, faceTextureStore) {
	const meshes = [];
	objects.forEach((definition) => {
		const source = ResolveObjectSource(definition, "terrain");
		const built  = source.parts.length === 0
			? buildSingleTerrain(source, world, faceTextureStore)
			: buildTerrainParts(source, world, faceTextureStore);
		for (const mesh of built) meshes.push(mesh);
	});

	const terrain     = meshes.filter((mesh) => mesh.meta.mode !== "void");
	const voidTerrain = meshes.filter((mesh) => mesh.meta.mode === "void");
	if (terrain.length > 0) Log("ENGINE", `Terrain object group created: count=${terrain.length}`, "log", "Level");

	return { terrain, voidTerrain, meshes };
}

export { BuildTerrain };
