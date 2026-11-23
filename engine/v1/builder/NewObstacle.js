// Creates Obstacles the player has to avoid or use an ability on (can be destrucible)

// Used by NewLevel.js and handlers/game/Level.js to build obstacles.
// Uses NewTemplate.js to resolve templates.
// Uses NewObject.js for 3D objects

import { BuildObject } from "./NewObject.js";
import { ResolveObjectSource } from "./NewTemplate.js";
import { Log } from "../core/meta.js";
import { MultiplyVector3 } from "../math/Vector3.js";

function buildObstacleParts(source, options) {
	const { textureScale, faceTextureStore } = options;

	if (source.parts.length === 0) {
		const position = source.position.clone();
		position.y    += source.dimensions.y * source.scale.y * 0.5;
		const texture  = { base: source.texture.base, custom: [] };
		const mesh     = BuildObject({ ...source, position, texture, role: "obstacle", textureScale, faceTextureStore }).mesh;
		return [mesh];
	}

	// Compose world-space transforms by cloning and mutating UnitVector3 instances.
	const { scale: rootScale, position: rootPos, rotation: rootRot, pivot, collisionShape, mode, nullable, sticky } = source;
	return source.parts.map((part, partIndex) => {
		const scale    = MultiplyVector3(rootScale, part.localScale);
		const position = rootPos.clone().add(MultiplyVector3(part.localPosition, rootScale));
		position.y    += part.dimensions.y * scale.y * 0.5;
		const rotation = rootRot.clone().add(part.localRotation);
		const detail   = { scatter: part.detail.scatter.length > 0 ? part.detail.scatter : (partIndex === 0 ? source.detail.scatter : []) };

		const mesh = BuildObject({
			...part, id: `${source.id}:${part.id}`, position, rotation, scale, pivot, detail, role: "obstacle",
			collisionShape, mode, nullable, sticky, textureScale, faceTextureStore,
		}).mesh;
		return mesh;
	});
}

// Build every obstacle from its parts.
function BuildObstacles(definitions, options) {
	const groups = {}, meshes = [], entries = [], voidParts = [];
	for (const definition of definitions) {
		const source = ResolveObjectSource(definition, "obstacle");
		const { id, destructible, hp } = source;

		// Group only the non-void parts. 
		// Note: An obstacle made only of voids gets an empty group.
		const group = groups[id] = { id, destructible, hp, parts: [] };
		for (const mesh of buildObstacleParts(source, options)) {
			mesh.meta.group = id;
			meshes.push(mesh);
			if (mesh.meta.mode === "void") voidParts.push(mesh);
			else {
				entries.push(mesh);
				group.parts.push(mesh);
			}
		}
	}

	const all = Object.values(groups);
	if (all.length > 0) {
		const destructibleCount = all.filter((group) => group.destructible === true).length;
		Log(
			"ENGINE",
			`
				Obstacle group created:
				- Total: ${all.length}
				- Parts: ${entries.length}
				- Destructible: ${destructibleCount}
				- Static: ${all.length - destructibleCount}
			`,
			"log",
			"Level"
		);
	}
	return { entries, groups, voidParts, meshes };
}

export { BuildObstacles };
