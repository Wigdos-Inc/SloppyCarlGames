// Creates Obstacles the player has to avoid or use an ability on (can be destrucible)

// Used by NewLevel.js and handlers/Cutscene.js
// Uses NewObject.js for 3D objects

import { BuildObject } from "./NewObject.js";
import { Log } from "../core/meta.js";
import { MultiplyVector3 } from "../math/Vector3.js";

function createEnvelopeObb(bounds) {
	return {
		type: "obb",
		center: bounds.min.clone().add(bounds.max).scale(0.5),
		halfExtents: bounds.max.clone().subtract(bounds.min).scale(0.5),
		axes: [
			{ x: 1, y: 0, z: 0 },
			{ x: 0, y: 1, z: 0 },
			{ x: 0, y: 0, z: 1 },
		],
	};
}

function mergeAabb(accumulator, bounds) {
	if (!accumulator) {
		return {
			min: bounds.min.clone(),
			max: bounds.max.clone(),
		};
	}

	accumulator.min.set({
		x: Math.min(accumulator.min.x, bounds.min.x),
		y: Math.min(accumulator.min.y, bounds.min.y),
		z: Math.min(accumulator.min.z, bounds.min.z),
	});
	accumulator.max.set({
		x: Math.max(accumulator.max.x, bounds.max.x),
		y: Math.max(accumulator.max.y, bounds.max.y),
		z: Math.max(accumulator.max.z, bounds.max.z),
	});

	return accumulator;
}

function createDetailedBoundsFromParts(source, parts, bounds) {
	if (source.collisionShape === "triangle-soup") {
		const triangles = [];
		for (let index = 0; index < parts.length; index += 1) {
			const detailed = parts[index].detailedBounds;
			if (detailed.type === "triangle-soup") triangles.push(...detailed.triangles);
		}
		return { type: "triangle-soup", triangles };
	}

	if (source.collisionShape === "aabb") {
		return { type: "aabb", min: bounds.min.clone(), max: bounds.max.clone() };
	}

	if (parts.length === 1) return parts[0].detailedBounds;
	return createEnvelopeObb(bounds);
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
				collisionShape: source.collisionShape,
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

		const scatterList = part.detail.scatter.length > 0 
			? part.detail.scatter 
			: (partIndex === 0 ? source.detail.scatter: []);

		const combinedScale = MultiplyVector3(rootScale, part.localScale);

		// Compute world-space position & rotation without mutating source transforms.
		const worldPos = source.position.clone();
		worldPos.add(part.localPosition);
		worldPos.y += part.dimensions.y * combinedScale.y * 0.5;

		const worldRot = source.rotation.clone();
		worldRot.add(part.localRotation);

		return BuildObject(
			{
				...part,
				id: part.id,
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
				collisionShape: source.collisionShape,
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
	const detailedBounds = createDetailedBoundsFromParts(source, parts, bounds);

	return {
		id: source.id,
		mesh: mesh,
		parts: parts,
		bounds: bounds,
		detailedBounds: detailedBounds,
		collisionShape: source.collisionShape,
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

/**
 * Stub: Build a BVH from triangle data for future ray/sphere intersection queries.
 * @param {Float32Array} positions — triangle vertex positions (x,y,z triples).
 * @param {Uint32Array} indices — triangle indices.
 * @returns {null} — TODO: return BVH node tree.
 */
function BuildTriangleBVH(positions, indices) {
	// TODO: Implement BVH construction (midpoint split, SAH, etc.)
	return null;
}

export { BuildObstacle, BuildObstacles, BuildTriangleBVH };