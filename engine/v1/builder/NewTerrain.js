// Builds terrain meshes: single-part objects (legacy path) and flattened multi-part composition.

// Used by NewLevel.js
// Uses NewTemplate.js for template resolution and NewObject.js for meshes

import { BuildObject } from "./NewObject.js";
import { ResolveObjectSource } from "./NewTemplate.js";
import { Log } from "../core/meta.js";
import { MultiplyVector3 } from "../math/Vector3.js";

function buildSingleTerrain(source, world, faceTextureStore) {
	source.position.y += source.dimensions.y * source.scale.y * 0.5;

	const { mesh } = BuildObject(
		{
			...source,
			id            : source.id,
			role          : "terrain",
			collisionShape: source.collisionShape,
			mode          : source.mode,
			textureScale  : world.textureScale,
			faceTextureStore,
		}
	);

	return [mesh];
}

// Independent flattened meshes: root+local transform composition with per-part grounding.
function buildTerrainParts(source, world, faceTextureStore) {
	return source.parts.map((part, partIndex) => {
		const combinedScale = MultiplyVector3(source.scale, part.localScale);

		const worldPos = source.position.clone().add(part.localPosition);
		worldPos.y += part.dimensions.y * combinedScale.y * 0.5;

		const { mesh } = BuildObject(
			{
				...part,
				id            : `${source.id}:${part.id}`,
				position      : worldPos,
				rotation      : source.rotation.clone().add(part.localRotation),
				scale         : combinedScale,
				pivot         : source.pivot,
				detail        : { scatter: part.detail.scatter.length > 0 ? part.detail.scatter : (partIndex === 0 ? source.detail.scatter : []) },
				role          : "terrain",
				collisionShape: source.collisionShape,
				mode          : source.mode,
				nullable      : source.nullable,
				textureScale  : world.textureScale,
				faceTextureStore,
			}
		);

		return mesh;
	});
}

function BuildTerrain(objects, world, faceTextureStore) {
	const meshes = [];
	objects.forEach((definition) => {
		const source = ResolveObjectSource(definition, "terrain");
		const built = source.parts.length === 0
			? buildSingleTerrain(source, world, faceTextureStore)
			: buildTerrainParts(source, world, faceTextureStore);
		meshes.push(...built);
	});

	const terrain     = meshes.filter((mesh) => mesh.meta.mode !== "void");
	const voidTerrain = meshes.filter((mesh) => mesh.meta.mode === "void");
	if (terrain.length > 0) Log("ENGINE", `Terrain object group created: count=${terrain.length}`, "log", "Level");

	return { terrain, voidTerrain, meshes };
}

export { BuildTerrain };
