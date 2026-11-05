// Creates Obstacles the player has to avoid or use an ability on (can be destrucible)

// Used by NewLevel.js and handlers/Cutscene.js
// Uses NewObject.js for 3D objects
// Uses math/Collision.js to grid the merged triangle soup of multi-part obstacles.

import { BuildObject } from "./NewObject.js";
import { ResolveObjectSource } from "./NewTemplate.js";
import { Log } from "../core/meta.js";
import { SoupBounds } from "../math/Collision.js";
import { CapsuleFromAabb, ObbFromAabb, PointsAabb, SphereFromAabb } from "../math/Geometry.js";
import { MultiplyVector3 } from "../math/Vector3.js";

// Merge a list of boxes.
function MergeAabb(boxes) {
	const { min, max } = PointsAabb(boxes.flatMap((box) => [box.min, box.max]));
	return { min: boxes[0].min.clone().set(min), max: boxes[0].max.clone().set(max) };
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
			return SoupBounds("triangle-soup", triangles);
		case "aabb"   : return { type: "aabb", min: bounds.min.clone(), max: bounds.max.clone() };
		case "sphere" : return SphereFromAabb(bounds, false);
		case "capsule": return CapsuleFromAabb(bounds);
	}

	return parts.length === 1 ? parts[0].detailedBounds : ObbFromAabb(bounds);
}

function buildObstacleParts(source, options) {
	const { textureScale, faceTextureStore } = options;

	if (source.parts.length === 0) {
		const position = source.position.clone();
		position.y    += source.dimensions.y * source.scale.y * 0.5;
		const texture  = { generated: source.texture.generated, custom: [] };
		const { mesh } = BuildObject({ ...source, position, texture, role: "obstacle", textureScale, faceTextureStore });
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

		const { mesh } = BuildObject({
			...part, position, rotation, scale, pivot, detail, role: "obstacle",
			collisionShape, mode, nullable, sticky, textureScale, faceTextureStore,
		});
		return mesh;
	});
}

function BuildObstacle(source, options) {
	source = ResolveObjectSource(source, "obstacle");
	const parts     = buildObstacleParts(source, options);
	const worldAabb = MergeAabb(parts.map((part) => part.worldAabb));

	const mesh = parts[0];
	const detailedBounds = CreateDetailedBoundsFromParts(source, parts, worldAabb);
	const { id, collisionShape, destructible, hp, scatter, mode, nullable, sticky } = source;

	return {
		id, mesh, parts, worldAabb, detailedBounds, collisionShape, destructible, hp, scatter, mode, nullable, sticky,
		static     : source.static,
		state      : { destroyed: false },
		performance: { rendering: true },
	};
}

function BuildObstacles(source, options) {
	const built = source.map((definition) => BuildObstacle(definition, options));
	if (built.length > 0) {
		const destructibleCount = built.filter((entry) => entry.destructible === true).length;
		Log(
			"ENGINE",
			`
				Obstacle group created: 
				- Total=${built.length}
				- Destructible=${destructibleCount}
				- Static=${built.length - destructibleCount}
			`,
			"log",
			"Level"
		);
	}
	return { built };
}

export { BuildObstacle, BuildObstacles, MergeAabb, CreateDetailedBoundsFromParts };
