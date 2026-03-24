// Creates Obstacles the player has to avoid or use an ability on (can be destrucible)

// Used by NewLevel.js and handlers/Cutscene.js
// Uses NewObject.js for 3D objects

import { BuildObject } from "./NewObject.js";
import { Log } from "../core/meta.js";
import { AddVector3, MultiplyVector3 } from "../math/Vector3.js";
import { ToNumber, UnitVector3 } from "../math/Utilities.js";

function mergeAabb(accumulator, bounds) {
	if (!accumulator) {
		return {
			min: bounds.min.clone(),
			max: bounds.max.clone(),
		};
	}

	return {
		min: new UnitVector3(
			Math.min(accumulator.min.x, bounds.min.x),
			Math.min(accumulator.min.y, bounds.min.y),
			Math.min(accumulator.min.z, bounds.min.z),
			"cnu"
		),
		max: new UnitVector3(
			Math.max(accumulator.max.x, bounds.max.x),
			Math.max(accumulator.max.y, bounds.max.y),
			Math.max(accumulator.max.z, bounds.max.z),
			"cnu"
		),
	};
}

function buildObstacleParts(source, index, options) {
	if (source.parts.length === 0) {
		const elevatedPosition = source.position.clone();
		elevatedPosition.y += source.dimensions.y * source.scale.y * 0.5;

		const single = BuildObject(
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
				texture: source.texture,
				detail: source.detail,
				role: "obstacle",
			},
			{
				role: "obstacle",
				scatterContext: options.scatterContext
					? {
						...options.scatterContext,
						indexSeed: 500 + index,
					}
					: null,
			}
		);
		return [single];
	}

	// At this point `source` and `source.parts` are expected to be normalized by core/normalize.js
	// Assume `source.position`, `source.rotation`, `source.pivot`, and part.localPosition/localRotation
	// are `UnitVector3` instances. Compose world-space transforms by cloning and mutating UnitVector3 instances.
	const rootScale = source.scale; // Vector3

	return source.parts.map((part, partIndex) => {
		const inheritedTexture = source.texture;
		const partScatterContext = options.scatterContext
			? {
				...options.scatterContext,
				indexSeed: 700 + (index * 100) + partIndex,
			}
			: null;

		const scatterList = part.detail.scatter.length > 0 ? part.detail.scatter : (partIndex === 0 ?  source.detail.scatter: []);

		const combinedScale = MultiplyVector3(rootScale, part.localScale);

		// Compute world-space position & rotation without mutating source transforms.
		const worldPos = source.position.clone();
		worldPos.set(AddVector3(worldPos, part.localPosition));
		worldPos.y += part.dimensions.y * combinedScale.y * 0.5;

		const worldRot = source.rotation.clone();
		worldRot.set(AddVector3(worldRot, part.localRotation));

		return BuildObject(
			{
				...part,
				id: part.id || `${source.id}-part-${partIndex}`,
				shape: part.shape,
				complexity: part.complexity,
				dimensions: part.dimensions,
				position: worldPos,
				rotation: worldRot,
				scale: combinedScale,
				pivot: source.pivot,
				primitiveOptions: part.primitiveOptions,
				texture: part.texture || inheritedTexture,
				detail: { scatter: scatterList },
				role: "obstacle",
			},
			{
				role: "obstacle",
				scatterContext: partScatterContext,
			}
		);
	});
}

function BuildObstacle(source, index, options) {
	const parts = buildObstacleParts(source, index, options);
	let bounds = null;
	parts.forEach((part) => bounds = mergeAabb(bounds, part.worldAabb));

	const mesh = parts[0];

	return {
		id: source.id,
		mesh: mesh,
		parts: parts,
		bounds: bounds,
		destructible: source.destructible,
		hp: source.hp,
		static: source.static,
		scatter: source.scatter,
		state: {
			destroyed: false,
		},
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
	return built;
}

export { BuildObstacle, BuildObstacles };