// Builds single 3D objects with their geometry, bounds, collision and textures.

// Used by NewTerrain.js, NewObstacle.js, NewEntity.js, NewLevel.js and handlers/game/Level.js to build objects.
// Used by NewEntity.js and handlers/game/Simulator.js to refit moved objects' boxes.
// Used by NewScatter.js and NewVoid.js to generate UVs.
// Uses NewPrimitive.js to build geometry.
// Uses NewTexture.js to set up textures.
// Uses math/Collision.js to grid triangle-soup collision.

import { BuildGeometry } from "./NewPrimitive.js";
import {
	BuildFaceTextureData, 
	BuildNoiseAnimationOptions, 
	ResolveTextureBlueprint, 
	FREQUENCY_PATTERN_CONFIG, 
	ComputeGeneratedTextureID,
	InitializeDecalDisplay
} from "./NewTexture.js";
import textureTemplates from "./templates/textures.json" with { type: "json" };
import { CONFIG } from "../core/config.js";
import { DeepFreeze } from "../core/meta.js";
import { CreateModelMatrix, CreateRenderMatrixCache, TransformPointByMatrix } from "../math/Matrix.js";
import { SoupBounds } from "../math/Collision.js";
import { AabbCenter, AabbHalfExtents, BoxCorners, CapsuleFromAabb, MeshTriangles, PointsAabb, SphereFromAabb } from "../math/Geometry.js";
import { Clamp, UnitVector3 } from "../math/Utilities.js";
import {
	AbsoluteVector3,
	AddVector3,
	ArrayToVector3,
	DivideVector3,
	MaxVector3,
	ResolveVector3Axis,
	ScaleVector3,
	SubtractVector3,
	ToVector3,
	Vector3ToArray
} from "../math/Vector3.js";

function computeObbFromMesh(mesh) {
	const modelMatrix = CreateModelMatrix(mesh.transform);
	return {
		type: "obb",
		center: mesh.display.aabb.min.clone().set(AabbCenter(mesh.display.aabb)),
		halfExtents: mesh.performance.localBounds.max.clone().set(AabbHalfExtents(mesh.performance.localBounds)).multiply(AbsoluteVector3(mesh.transform.scale)),
		axes: [
			ResolveVector3Axis(ArrayToVector3(modelMatrix, 0)),
			ResolveVector3Axis(ArrayToVector3(modelMatrix, 4)),
			ResolveVector3Axis(ArrayToVector3(modelMatrix, 8))
		],
	};
}

function computeAabbFromMesh(mesh) {
	return {
		type: "aabb",
		min: mesh.display.aabb.min.clone(),
		max: mesh.display.aabb.max.clone(),
	};
}

function computeTriangleSoupFromMesh(mesh) {
	const toUnit = (vertex) => new UnitVector3(vertex.x, vertex.y, vertex.z, "cnu");
	const placed = MeshTriangles(mesh.geometry.positions, mesh.geometry.indices, CreateModelMatrix(mesh.transform));
	const triangles = placed.map(({ a, b, c, normal }) => ({ a: toUnit(a), b: toUnit(b), c: toUnit(c), normal }));
	return SoupBounds("triangle-soup", triangles);
}

function computeDetailedBounds(mesh, collisionShape) {
	switch(collisionShape) {
		case "none"         : return null;
		case "sphere"       : return SphereFromAabb(mesh.display.aabb, false);
		case "capsule"      : return CapsuleFromAabb(mesh.display.aabb);
		case "triangle-soup": return computeTriangleSoupFromMesh(mesh);
		case "aabb"         : return computeAabbFromMesh(mesh);
		case "obb"          : return computeObbFromMesh(mesh);
	}
}

// Build a mesh's collision box and fitted collision shape.
function computePhysics(mesh, collisionShape) {
	const { min, max } = mesh.display.aabb;
	return { 
		collision: { 
			aabb: { min: min.clone(), max: max.clone() }, 
			detailedBounds: computeDetailedBounds(mesh, collisionShape) 
		} 
	};
}

// Read each vertex out of a flat x, y, z position list.
const readVertices = (positions) => Array.from({ length: positions.length / 3 }, (_, index) => ArrayToVector3(positions, index, true));

// Instance a plain box into UnitVector3 corners.
const unitBox = ({ min, max }) => ({ min: new UnitVector3(min.x, min.y, min.z, "cnu"), max: new UnitVector3(max.x, max.y, max.z, "cnu") });

function generateSphereUvs(positions) {
	const vertices = readVertices(positions);
	const { min, max } = PointsAabb(vertices);

	const center = ScaleVector3(AddVector3(min, max), 0.5);
	const radius = MaxVector3(ToVector3(0.0001), ScaleVector3(SubtractVector3(max, min), 0.5));

	const uvs = [];
	for (const point of vertices) {
		const { x, y, z } = DivideVector3(SubtractVector3(point, center), radius);
		uvs.push(
			(Math.atan2(z, (x)) + Math.PI) / (Math.PI * 2), 
			Math.acos(Clamp(y, -1, 1)) / Math.PI
		);
	}

	return uvs;
}

function GenerateFaceProjectedUvs(positions, faceGroups, normalize = false) {
	const getProjectedAxesFromNormal = (normal) => {
		const n = AbsoluteVector3(normal);
		if (n.x >= n.y && n.x >= n.z) return ["z", "y"];
		if (n.y >= n.x && n.y >= n.z) return ["x", "z"];
		return                               ["x", "y"];
	};

	const uvs = new Array(positions.length / 3 * 2).fill(0);

	if (!normalize) {
		for (const group of faceGroups) {
			const [uAxis, vAxis] = getProjectedAxesFromNormal(group.normal);
			for (const vertexIndex of group.vertexIndices) {
				const vertex = ArrayToVector3(positions, vertexIndex, true);
				const uvOffset = vertexIndex * 2;
				uvs[uvOffset + 0] = vertex[uAxis];
				uvs[uvOffset + 1] = vertex[vAxis];
			}
		}
		return uvs;
	}

	// Stretch the UVs from 0 to 1 across each face, and record each face's size.
	const faceSpans = [];
	for (const group of faceGroups) {
		const [uAxis, vAxis] = getProjectedAxesFromNormal(group.normal);
		let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;

		for (const vertexIndex of group.vertexIndices) {
			const vertex = ArrayToVector3(positions, vertexIndex, true);
			minU = Math.min(minU, vertex[uAxis]); 
			maxU = Math.max(maxU, vertex[uAxis]);
			minV = Math.min(minV, vertex[vAxis]);
			maxV = Math.max(maxV, vertex[vAxis]);
		}

		const uSpan = Math.max(0.0001, maxU - minU);
		const vSpan = Math.max(0.0001, maxV - minV);
		faceSpans.push({ uSpan, vSpan });

		for (const vertexIndex of group.vertexIndices) {
			const vertex = ArrayToVector3(positions, vertexIndex, true);
			const uvOffset = vertexIndex * 2;
			uvs[uvOffset + 0] = (vertex[uAxis] - minU) / uSpan;
			uvs[uvOffset + 1] = (vertex[vAxis] - minV) / vSpan;
		}
	}

	return { uvs, faceSpans };
}

function GenerateUVs(positions, geometry) {
	if (geometry.uvs)                 return geometry.uvs;
	if (geometry.uvMode === "sphere") return generateSphereUvs(positions);
	return GenerateFaceProjectedUvs(positions, geometry.faceGroups);
}

const computeBounds = (positions) => unitBox(PointsAabb(readVertices(positions)));

// Fit bounds around the geometry. Camera-following sprites use a cube to fit every angle.
function computeMeshBounds(positions, dimensions, sprite) {
	if (sprite === null || sprite.follow === "none") return computeBounds(positions);

	const half = Math.hypot(dimensions.x, dimensions.y) * 0.5;
	return { min: new UnitVector3(-half, -half, -half, "cnu"), max: new UnitVector3(half, half, half, "cnu") };
}

// Fit a world box around local points (x,y,z).
function computeWorldAabb(positions, transform) {
	const matrix = CreateModelMatrix(transform);
	return unitBox(PointsAabb(readVertices(positions), ToVector3(Infinity), ToVector3(-Infinity), (point) => TransformPointByMatrix(point, matrix)));
}

// Place a tube's centerline in the world.
function computeCenterLine(shape, geometry, transform) {
	if (shape !== "tube") return null;

	const matrix = CreateModelMatrix(transform);
	return geometry.centerline.map((point) => {
		const world = TransformPointByMatrix(point, matrix);
		return new UnitVector3(world.x, world.y, world.z, "cnu");
	});
}

// Fit a mesh's world box around its vertices. 
// Note: A rough box or camera-following sprite places its local box instead.
function computeMeshWorldAabb(mesh, rough) {
	const sprite     = mesh.primitive === "plane" ? mesh.detail.primitiveOptions.sprite : null;
	const fromBounds = rough || (sprite !== null && sprite.follow !== "none");
	return computeWorldAabb(fromBounds ? BoxCorners(mesh.performance.localBounds).flatMap(Vector3ToArray) : mesh.geometry.positions, mesh.transform);
}

// Give a mesh its own base texture record and the registry key it draws with. 
// Note: Image sprites have no template.
function buildBaseTexture(texture, spriteImage) {
	if (spriteImage !== null) return { registryID: `sprite::${spriteImage.path}`, faceNoiseGroups: null };
	const { id: templateID, ...look } = texture;
	return { templateID, ...look, registryID: ComputeGeneratedTextureID(texture), faceNoiseGroups: null };
}

// Build and freeze a part's geometry template, shared by every instance of its blueprint.
function buildEntityPartGeometryTemplate(shape, dimensions, primitiveOptions, texture, sprite) {
	const geometry         = BuildGeometry(shape, dimensions, primitiveOptions);
	const textureBlueprint = sprite === null ? textureTemplates[texture.id] : undefined;

	// Noise parts use triplanar mapping, but sprites keep their own UVs.
	let uvs         = GenerateUVs(geometry.positions, geometry);
	const triplanar = sprite === null && textureBlueprint !== undefined && textureBlueprint.pattern === "noise";

	if (!triplanar && sprite === null) {
		// Scale a sphere's UVs to its real size. Its texture then repeats at the same rate as on flat parts.
		if (geometry.uvMode === "sphere") {
			const uSpan = Math.PI * dimensions.x, vSpan = Math.PI * dimensions.y * 0.5;
			for (let i = 0; i < uvs.length; i += 2) {
				uvs[i + 0] *= uSpan;
				uvs[i + 1] *= vSpan;
			}
		}

		// Repeat frequency patterns as often as their densities ask. Material-only parts have no pattern.
		const frequencyConfigKey = textureBlueprint === undefined ? undefined : FREQUENCY_PATTERN_CONFIG[textureBlueprint.pattern];
		if (frequencyConfigKey !== undefined) {
			const uvScale = textureBlueprint.density * CONFIG.Rendering.Texture[frequencyConfigKey].Density * texture.density;
			for (let i=0; i < uvs.length; i++) uvs[i] *= uvScale;
		}
	}

	const template = {
		positions: new Float32Array(geometry.positions),
		indices  : new Uint16Array(geometry.indices),
		uvs      : new Float32Array(uvs),
	};

	if (triplanar) template.triplanar = true;

	return DeepFreeze(template);
}

function BuildObject(source) {
	const { id, position, rotation, scale, pivot, mode, collisionShape, dimensions, primitiveOptions } = source;
	const { sticky, nullable, particle } = source;
	const shape     = source.shape.toLowerCase();
	const transform = { position, rotation, scale, pivot };
	const sprite    = shape === "plane" ? primitiveOptions.sprite : null;

	// Set the fields every mesh carries. Each mode adds its own below.
	const mesh = {
		id, meta: { sticky, mode, nullable, particle }, transform, dimensions,
		display    : { transform, color: null, aabb: null },
		physics    : null,
		performance: { rendering: true },
	};

	if (mode === "invisible") {
		// Give invisible meshes no geometry, except triangle-soup, which needs one for its collision.
		let geometry = null;
		if (collisionShape === "triangle-soup") {
			geometry                     = BuildGeometry(shape, dimensions, primitiveOptions);
			mesh.performance.localBounds = computeBounds(geometry.positions);
			mesh.display.aabb            = computeWorldAabb(geometry.positions, transform);
		}
		else {
			mesh.performance.localBounds = { min: dimensions.clone().scale(-0.5), max: dimensions.clone().scale(0.5) };
			mesh.display.aabb            = computeWorldAabb(BoxCorners(mesh.performance.localBounds).flatMap(Vector3ToArray), transform);
		}
		mesh.physics         = computePhysics({ ...mesh, geometry }, collisionShape);
		mesh.meta.centerline = geometry === null ? null : computeCenterLine(shape, geometry, transform);
		return { mesh };
	}

	if (mode === "void") {
		const geometry = BuildGeometry(shape, dimensions, primitiveOptions);
		mesh.geometry                = { positions: geometry.positions, indices: geometry.indices, indexCount: geometry.indices.length };
		mesh.performance.localBounds = computeBounds(geometry.positions);
		mesh.display.aabb            = computeWorldAabb(geometry.positions, transform);
		mesh.physics         = computePhysics(mesh, collisionShape);
		mesh.meta.centerline = computeCenterLine(shape, geometry, transform);
		return { mesh };
	}

	const texture     = source.texture.base;
	const spriteImage = sprite === null ? null : sprite.image;
	Object.assign(mesh, {
		primitive: shape,
		role     : source.role,
		detail: {
			scatter: source.detail.scatter,
			texture: { base: buildBaseTexture(texture, spriteImage), custom: source.texture.custom },
			primitiveOptions,
		},
	});
	mesh.performance.renderMatrixCache = CreateRenderMatrixCache(transform);

	// Use the shared part geometry NewEntity passes in, or build it.
	let geometry = null;
	if (source.role === "entity-part") {
		const geometryTemplate = source.geometry ?? buildEntityPartGeometryTemplate(shape, dimensions, primitiveOptions, texture, sprite);
		mesh.geometry                = geometryTemplate;
		mesh.performance.localBounds = computeMeshBounds(geometryTemplate.positions, dimensions, sprite);

		// Set the triplanar scale per mesh, letting each instance's own texture density apply.
		if (geometryTemplate.triplanar) {
			mesh.display.textureScale = textureTemplates[texture.id].density * CONFIG.Rendering.Texture.Noise.Density * texture.density;
		}
	}
	else {
		geometry = BuildGeometry(shape, dimensions, primitiveOptions);
		mesh.geometry = {
			positions: geometry.positions,
			indices  : geometry.indices,
			uvs      : GenerateUVs(geometry.positions, geometry),
		};
		mesh.performance.localBounds = computeMeshBounds(geometry.positions, dimensions, sprite);
		mesh.meta.centerline         = computeCenterLine(shape, geometry, transform);
	}

	// Leave entity parts without collision bounds. Their entity builds its own.
	mesh.display.aabb = computeMeshWorldAabb(mesh, false);
	if (source.role !== "entity-part") mesh.physics = computePhysics(mesh, collisionShape);

	InitializeDecalDisplay(mesh.detail.texture.custom, dimensions);

	// Entity parts skip UV work, they already have their own. Sprites skip as their images must not tile.
	if (source.role === "entity-part" || sprite !== null) return { mesh };

	// Bake noise per face on terrain, obstacles and water.
	const textureBlueprint = textureTemplates[texture.id];
	if (
		["terrain", "obstacle", "water"].includes(source.role) && 
		textureBlueprint.pattern === "noise" && 
		!geometry.uvs && geometry.faceGroups.every(g => g.indexStart !== undefined)
	) {
		const { uvs: normalizedUvs, faceSpans } = GenerateFaceProjectedUvs(geometry.positions, geometry.faceGroups, true);
		mesh.geometry.uvs = normalizedUvs;

		mesh.detail.texture.base.faceNoiseGroups = BuildFaceTextureData(
			source.faceTextureStore, mesh.detail.texture.base.registryID,
			ResolveTextureBlueprint(textureBlueprint, texture), 
			geometry.faceGroups, faceSpans, source.textureScale, 
			BuildNoiseAnimationOptions(textureBlueprint, texture)
		);
		return { mesh };
	}

	// Repeat frequency patterns based on their density. Scatter and material-only parts have no pattern.
	const frequencyConfigKey = textureBlueprint === undefined ? undefined : FREQUENCY_PATTERN_CONFIG[textureBlueprint.pattern];
	if (frequencyConfigKey !== undefined) {
		const uvScale = textureBlueprint.density * CONFIG.Rendering.Texture[frequencyConfigKey].Density * texture.density;
		for (let i = 0; i < mesh.geometry.uvs.length; i++) mesh.geometry.uvs[i] *= uvScale;
	}

	return { mesh };
}

// Refit a moved mesh's display box and collision bounds. 
// Note: A rough refit only places its local box.
function UpdateObjectWorldAabb(mesh, rough) {
	mesh.display.aabb = computeMeshWorldAabb(mesh, rough);
	if (mesh.physics !== null) {
		const detailedBounds = mesh.physics.collision.detailedBounds;
		mesh.physics = computePhysics(mesh, detailedBounds === null ? "none" : detailedBounds.type);
	}
	return mesh.display.aabb;
}

export { BuildObject, UpdateObjectWorldAabb, GenerateUVs, GenerateFaceProjectedUvs };