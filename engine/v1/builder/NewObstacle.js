// Creates Obstacles the player has to avoid or use an ability on (can be destrucible)

// Used by NewLevel.js and handlers/Cutscene.js
// Uses NewObject.js for 3D objects

import { BuildObject } from "./NewObject.js";
import { ResolveObjectSource } from "./NewTemplate.js";
import { Log } from "../core/meta.js";
import { Unit } from "../math/Utilities.js";
import { MultiplyVector3, Vector3Sq, WORLD_NORMALS } from "../math/Vector3.js";

function createEnvelopeObb(bounds) {
	return {
		type: "obb",
		center: bounds.min.clone().add(bounds.max).scale(0.5),
		halfExtents: bounds.max.clone().subtract(bounds.min).scale(0.5),
		axes: [WORLD_NORMALS.Right, WORLD_NORMALS.Up, WORLD_NORMALS.Forward],
	};
}

function createEnvelopeSphere(bounds) {
	return {
		type: "sphere",
		center: bounds.min.clone().add(bounds.max).scale(0.5),
		radius: new Unit(Math.max(0.0001, Math.sqrt(Vector3Sq(bounds.max.clone().subtract(bounds.min).scale(0.5)))), "cnu"),
	};
}

function createEnvelopeCapsule(bounds) {
	const dim = bounds.max.clone().subtract(bounds.min);
	const radius = Math.max(0.0001, Math.max(dim.x, dim.z) * 0.5);
	const halfHeight = Math.max(0, (dim.y * 0.5) - radius);
	const segmentStart = bounds.min.clone().add(bounds.max).scale(0.5);
	const segmentEnd = segmentStart.clone();
	segmentStart.y -= halfHeight;
	segmentEnd.y += halfHeight;
	return {
		type: "capsule",
		radius: new Unit(radius, "cnu"),
		halfHeight: new Unit(halfHeight, "cnu"),
		segmentStart, segmentEnd,
	};
}

function mergeAabb(accumulator, bounds) {
	if (!accumulator) {
		return {
			min: bounds.min.clone(),
			max: bounds.max.clone(),
		};
	}

	accumulator.min.min(bounds.min);
	accumulator.max.max(bounds.max);

	return accumulator;
}

function createDetailedBoundsFromParts(source, parts, bounds) {
	if (source.collisionShape === "triangle-soup") {
		const triangles = [];
		for (let index = 0; index < parts.length; index++) {
			if (parts[index].detailedBounds.type === "triangle-soup") triangles.push(...parts[index].detailedBounds.triangles);
		}
		return { type: "triangle-soup", triangles };
	}

	if (source.collisionShape === "aabb") return { type: "aabb", min: bounds.min.clone(), max: bounds.max.clone() };
	if (source.collisionShape === "sphere") return createEnvelopeSphere(bounds);
	if (source.collisionShape === "capsule") return createEnvelopeCapsule(bounds);

	if (parts.length === 1) return parts[0].detailedBounds;
	return createEnvelopeObb(bounds);
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
				// Single-part obstacles render the base texture only; decals (texture.custom) are suppressed.
				texture       : { generated: source.texture.generated, custom: [] },
				detail        : source.detail,
				role          : "obstacle",
				collisionShape: source.collisionShape,
				mode          : source.mode,
				nullable      : source.nullable,
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
	const rootScale = source.scale; // Vector3

	const parts = source.parts.map((part, partIndex) => {
		const combinedScale = MultiplyVector3(rootScale, part.localScale);

		// Compute world-space position
		const worldPos = source.position.clone();
		worldPos.add(part.localPosition);
		worldPos.y += part.dimensions.y * combinedScale.y * 0.5;

		const { mesh: partMesh } = BuildObject(
			{
				...part,
				id: part.id,
				shape: part.shape,
				complexity: part.complexity,
				dimensions: part.dimensions,
				position: worldPos,
				rotation: source.rotation.clone().add(part.localRotation),
				scale: combinedScale,
				pivot: source.pivot,
				primitiveOptions: part.primitiveOptions,
				texture: part.texture,
				detail: { scatter: part.detail.scatter.length > 0 ? part.detail.scatter : (partIndex === 0 ? source.detail.scatter: []) },
				role          : "obstacle",
				collisionShape: source.collisionShape,
				mode          : source.mode,
				nullable      : source.nullable,
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
	parts.forEach((part) => worldAabb = mergeAabb(worldAabb, part.worldAabb));

	const mesh = parts[0];
	const detailedBounds = createDetailedBoundsFromParts(source, parts, worldAabb);

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

export { BuildObstacle, BuildObstacles };