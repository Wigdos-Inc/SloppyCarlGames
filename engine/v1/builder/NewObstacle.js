// Creates Obstacles the player has to avoid or use an ability on (can be destrucible)

// Used by NewLevel.js and handlers/Cutscene.js
// Uses NewObject.js for 3D objects

import { BuildObject } from "./NewObject.js";
import { ResolveObjectSource } from "./NewTemplate.js";
import { Log } from "../core/meta.js";
import { CapsuleFromAabb, ObbFromAabb, SphereFromAabb } from "../math/Collision.js";
import { MultiplyVector3 } from "../math/Vector3.js";

function MergeAabb(accumulator, { min, max }) {
	if (!accumulator) return { min: min.clone(), max: max.clone() };
	accumulator.min.min(min);
	accumulator.max.max(max);
	return accumulator;
}

function CreateDetailedBoundsFromParts(source, parts, bounds) {
	switch (source.collisionShape) {
		case "none"         : return null;
		case "triangle-soup":
			const triangles = [];
			for (const part of parts) {
				if (part.detailedBounds.type !== "triangle-soup") continue;
				for (const triangle of part.detailedBounds.triangles) triangles.push(triangle);
			}
			return { type: "triangle-soup", triangles };
		case "aabb"   : return { type: "aabb", min: bounds.min.clone(), max: bounds.max.clone() };
		case "sphere" : return SphereFromAabb(bounds, false);
		case "capsule": return CapsuleFromAabb(bounds);
	}

	return parts.length === 1 ? parts[0].detailedBounds : ObbFromAabb(bounds);
}

function buildObstacleParts(source, index, options) {
	if (source.parts.length === 0) {
		const elevatedPosition = source.position.clone();
		elevatedPosition.y += source.dimensions.y * source.scale.y * 0.5;

		const { mesh: partMesh } = BuildObject(
			{
				id: source.id,
				shape: source.shape,
				complexity: source.complexity,
				dimensions: source.dimensions,
				position: elevatedPosition,
				rotation: source.rotation,
				scale: source.scale,
				pivot: source.pivot,
				primitiveOptions: source.primitiveOptions,
				texture       : { generated: source.texture.generated, custom: [] },
				detail        : source.detail,
				role          : "obstacle",
				collisionShape: source.collisionShape,
				mode          : source.mode,
				nullable      : source.nullable,
				sticky        : source.sticky,
				particle      : source.particle,
				textureScale  : options.textureScale,
				faceTextureStore: options.faceTextureStore,
				scatterContext: options.scatterContext
					? { ...options.scatterContext, indexSeed: 500 + index }
					: null
			}
		);
		return { parts: [partMesh] };
	}

	// Compose world-space transforms by cloning and mutating UnitVector3 instances.
	const parts = source.parts.map((part, partIndex) => {
		const combinedScale = MultiplyVector3(source.scale, part.localScale);

		// Compute world-space position
		const worldPos = source.position.clone();
		worldPos.add(MultiplyVector3(part.localPosition, source.scale));
		worldPos.y += part.dimensions.y * combinedScale.y * 0.5;

		const { mesh: partMesh } = BuildObject(
			{
				...part,
				position: worldPos,
				rotation: source.rotation.clone().add(part.localRotation),
				scale: combinedScale,
				pivot: source.pivot,
				detail: { scatter: part.detail.scatter.length > 0 ? part.detail.scatter : (partIndex === 0 ? source.detail.scatter: []) },
				role          : "obstacle",
				collisionShape: source.collisionShape,
				mode          : source.mode,
				nullable      : source.nullable,
				sticky        : source.sticky,
				textureScale  : options.textureScale,
				faceTextureStore: options.faceTextureStore,
				scatterContext: options.scatterContext
					? { ...options.scatterContext, indexSeed: 700 + (index * 100) + partIndex }
					: null
			}
		);
		return partMesh;
	});

	return { parts };
}

function BuildObstacle(source, index, options) {
	source = ResolveObjectSource(source, "obstacle");
	const { parts } = buildObstacleParts(source, index, options);
	let worldAabb = null;
	parts.forEach((part) => worldAabb = MergeAabb(worldAabb, part.worldAabb));

	const mesh = parts[0];
	const detailedBounds = CreateDetailedBoundsFromParts(source, parts, worldAabb);

	return {
		id: source.id,
		mesh, parts, worldAabb, detailedBounds,
		collisionShape: source.collisionShape,
		destructible  : source.destructible,
		hp            : source.hp,
		static        : source.static,
		scatter       : source.scatter,
		state         : { destroyed: false },
		mode          : source.mode,
		nullable      : source.nullable,
		sticky        : source.sticky,
		performance   : { rendering: true },
	};
}

function BuildObstacles(source, options) {
	const built = source.map((definition, index) => BuildObstacle(definition, index, options));
	if (built.length > 0) {
		const destructibleCount = built.filter((entry) => entry.destructible === true).length;
		Log(
			"ENGINE",
			`Obstacle group created: total=${built.length}, destructible=${destructibleCount}, static=${built.length - destructibleCount}`,
			"log",
			"Level"
		);
	}
	return { built };
}

export { BuildObstacle, BuildObstacles, MergeAabb, CreateDetailedBoundsFromParts };