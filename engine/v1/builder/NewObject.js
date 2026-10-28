// Builds single 3D objects with their geometry, bounds, collision and textures.

// Used by NewTerrain.js, NewObstacle.js, NewEntity.js, NewScatter.js, NewLevel.js and handlers/game/Level.js to build objects.
// Used by NewEntity.js and handlers/game/Simulator.js to refit moved objects' boxes.
// Used by NewScatter.js and NewVoid.js to generate UVs.
// Uses NewPrimitive.js to build geometry, NewTexture.js to set up textures and NewScatter.js to scatter detail.

import { BuildGeometry } from "./NewPrimitive.js";
import { BuildScatter } from "./NewScatter.js";
import { 
	BuildFaceTextureData, 
	BuildNoiseAnimationOptions, 
	ResolveTextureBlueprint, 
	FREQUENCY_PATTERN_CONFIG, 
	ComputeGeneratedTextureID, 
	IsTextureTransparent, 
	InitializeDecalDisplay 
} from "./NewTexture.js";
import VISUAL_TEMPLATES from "./templates/textures.json" with { type: "json" };
import { CONFIG } from "../core/config.js";
import { DeepFreeze } from "../core/meta.js";
import { CreateModelMatrix, CreateRenderMatrixCache, TransformPointByMatrix } from "../math/Matrix.js";
import { AabbCenter, AabbHalfExtents, CapsuleFromAabb, SphereFromAabb, TriangleNormal } from "../math/Collision.js";
import { Clamp, UnitVector3 } from "../math/Utilities.js";
import {
	AbsoluteVector3,
	AddVector3,
	ArrayToVector3,
	MaxVector3,
	ResolveVector3Axis,
	ScaleVector3,
	SubtractVector3,
	ToVector3
} from "../math/Vector3.js";

function computeObbFromMesh(mesh) {
	const modelMatrix = CreateModelMatrix(mesh.transform);
	return {
		type: "obb",
		center: mesh.worldAabb.min.clone().set(AabbCenter(mesh.worldAabb)),
		halfExtents: mesh.localBounds.max.clone().set(AabbHalfExtents(mesh.localBounds)).multiply(AbsoluteVector3(mesh.transform.scale)),
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
		min: mesh.worldAabb.min.clone(),
		max: mesh.worldAabb.max.clone(),
	};
}

function computeTriangleSoupFromMesh(mesh) {
	const modelMatrix = CreateModelMatrix(mesh.transform);
	const readVertex = (vertexIndex) => {
		const vertex = TransformPointByMatrix(
			ArrayToVector3(mesh.geometry.positions, vertexIndex, true), 
			modelMatrix
		);
		return new UnitVector3(vertex.x, vertex.y, vertex.z, "cnu");
	};

	const triangles = [];
	const indices = mesh.geometry.indices;
	for (let index = 0; index < indices.length; index += 3) {
		const a = readVertex(indices[index]);
		const b = readVertex(indices[index + 1]);
		const c = readVertex(indices[index + 2]);
		triangles.push({ a, b, c, normal: TriangleNormal(a, b, c) });
	}

	return { type: "triangle-soup", triangles };
}

function computeDetailedBounds(mesh) {
	switch(mesh.collisionShape) {
		case "none"         : return null;
		case "sphere"       : return SphereFromAabb(mesh.worldAabb, false);
		case "capsule"      : return CapsuleFromAabb(mesh.worldAabb);
		case "triangle-soup": return computeTriangleSoupFromMesh(mesh);
		case "aabb"         : return computeAabbFromMesh(mesh);
		case "obb"          : return computeObbFromMesh(mesh);
	}
}

function generateSphereUvs(positions) {
	const min = ToVector3(Infinity);
	const max = ToVector3(-Infinity);

	const vertexCount = positions.length / 3;
	for (let index = 0; index < vertexCount; index++) {
		const { x, y, z } = ArrayToVector3(positions, index, true);
		if (x < min.x) min.x = x;
		if (y < min.y) min.y = y;
		if (z < min.z) min.z = z;
		if (x > max.x) max.x = x;
		if (y > max.y) max.y = y;
		if (z > max.z) max.z = z;
	}

	const center = ScaleVector3(AddVector3(min, max), 0.5);
	const radius = MaxVector3(0.0001, ScaleVector3(SubtractVector3(max, min), 0.5));

	const uvs = [];
	for (let index = 0; index < vertexCount; index++) {
		const point = ArrayToVector3(positions, index, true);
		const theta = Math.atan2(((point.z - center.z) / radius.z), ((point.x - center.x) / radius.x));
		uvs.push(
			(theta + Math.PI) / (Math.PI * 2), 
			Math.acos(Clamp((point.y - center.y) / radius.y, -1, 1)) / Math.PI
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
	}

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

function computeBounds(positions) {
	const bounds = {
		min: new UnitVector3(positions[0], positions[1], positions[2], "cnu"),
		max: new UnitVector3(positions[0], positions[1], positions[2], "cnu")
	};

	for (let index = 1; index < positions.length / 3; index++) {
		const local = ArrayToVector3(positions, index, true);
		bounds.min.min(local);
		bounds.max.max(local);
	}

	return bounds;
}

// Fit bounds around the geometry. Camera-following sprites use a cube to fit every angle.
function computeMeshBounds(positions, dimensions, sprite) {
	if (sprite === null || sprite.follow === "none") return computeBounds(positions);

	const half = Math.hypot(dimensions.x, dimensions.y) * 0.5;
	return { min: new UnitVector3(-half, -half, -half, "cnu"), max: new UnitVector3(half, half, half, "cnu") };
}

// Fit a world box around local points (x,y,z).
function computeWorldAabb(positions, transform) {
	const matrix = CreateModelMatrix(transform);
	const first  = TransformPointByMatrix(ArrayToVector3(positions, 0, true), matrix);
	const bounds = {
		min: new UnitVector3(first.x, first.y, first.z, "cnu"),
		max: new UnitVector3(first.x, first.y, first.z, "cnu")
	};

	for (let index = 1; index < positions.length / 3; index++) {
		const world = TransformPointByMatrix(ArrayToVector3(positions, index, true), matrix);
		bounds.min.min(world);
		bounds.max.max(world);
	}

	return bounds;
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

// List a box's 8 corners as flat x, y, z values.
function boxCorners({ min, max }) {
	return [
		min.x, min.y, min.z,  max.x, min.y, min.z,  min.x, max.y, min.z,  max.x, max.y, min.z,
		min.x, min.y, max.z,  max.x, min.y, max.z,  min.x, max.y, max.z,  max.x, max.y, max.z,
	];
}

// Fit a mesh's world box around its vertices. A rough box or camera-following sprite uses its bounds.
function computeMeshWorldAabb(mesh, rough) {
	const fromBounds = rough || (mesh.sprite !== null && mesh.sprite.follow !== "none");
	return computeWorldAabb(fromBounds ? boxCorners(mesh.geometry.bounds) : mesh.geometry.positions, mesh.transform);
}

// Build and freeze a part's geometry template, shared by every instance of its blueprint.
function buildEntityPartGeometryTemplate(shape, dimensions, complexity, primitiveOptions, texture, sprite) {
	const geometry = BuildGeometry(shape, dimensions, complexity, primitiveOptions);
	const textureBlueprint = VISUAL_TEMPLATES.textures[texture.id];

	// Noise parts use triplanar mapping, but sprites keep their own UVs.
	let uvs = GenerateUVs(geometry.positions, geometry);
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
		bounds   : computeMeshBounds(geometry.positions, dimensions, sprite),
	};

	if (triplanar) template.triplanar = true;

	return DeepFreeze(template);
}

function BuildObject(source) {
	const { id, complexity, position, rotation, scale, pivot, mode, collisionShape, dimensions, primitiveOptions } = source;
	const { trigger, platform, parentId, sticky, nullable, particle } = source;
	const shape = source.shape.toLowerCase();
	const transform = { position, rotation, scale, pivot };
	const sprite = shape === "plane" ? primitiveOptions.sprite : null;

	// Set the fields every mesh carries. Each mode adds its own below.
	const mesh = {
		id, type: "mesh3d",
		meta: { trigger, platform, parentId, sticky, mode, nullable, particle },
		transform, dimensions, collisionShape, sprite,
		worldAabb     : null,
		detailedBounds: null,
		customTextures: [],
		performance   : { rendering: true },
	};

	if (mode === "invisible") {
		// Give invisible meshes no geometry, except triangle-soup, which needs one for its collision.
		let geometry = null;
		if (collisionShape === "triangle-soup") {
			geometry         = BuildGeometry(shape, dimensions, complexity, primitiveOptions);
			mesh.localBounds = computeBounds(geometry.positions);
			mesh.worldAabb   = computeWorldAabb(geometry.positions, transform);
		}
		else {
			mesh.localBounds = { min: dimensions.clone().scale(-0.5), max: dimensions.clone().scale(0.5) };
			mesh.worldAabb   = computeWorldAabb(boxCorners(mesh.localBounds), transform);
		}
		mesh.detailedBounds = computeDetailedBounds({ ...mesh, geometry });
		mesh.centerline     = geometry === null ? null : computeCenterLine(shape, geometry, transform);
		return { mesh };
	}

	if (mode === "void") {
		const geometry = BuildGeometry(shape, dimensions, complexity, primitiveOptions);
		mesh.geometry       = { positions: geometry.positions, indices: geometry.indices, indexCount: geometry.indices.length };
		mesh.localBounds    = computeBounds(geometry.positions);
		mesh.worldAabb      = computeWorldAabb(geometry.positions, transform);
		mesh.detailedBounds = computeDetailedBounds(mesh);
		mesh.centerline     = computeCenterLine(shape, geometry, transform);
		return { mesh };
	}

	// Read material and detail from the generated texture or a sprite's image.
	const texture = source.texture.generated;
	const spriteImage = sprite === null ? null : sprite.image;
	Object.assign(mesh, {
		shape, complexity,
		displayTransform : transform,
		renderMatrixCache: CreateRenderMatrixCache(transform),
		displayColor     : null,
		primitive        : shape,
		role             : source.role,
		material: {
			textureID  : spriteImage !== null ? `sprite::${spriteImage.path}` : ComputeGeneratedTextureID(texture),
			color      : { r: 1, g: 1, b: 1, a: 1 },
			opacity    : 1,
			transparent: IsTextureTransparent(texture),
		},
		detail: {
			scatter: source.detail.scatter,
			texture, complexity, primitiveOptions,
		},
		customTextures: source.texture.custom,
	});

	// Share geometry between the same part across same-entity-instances.
	let geometry = null;
	if (source.role === "entity-part") {
		let geometryTemplate = source.geometryCache === null ? undefined : source.geometryCache.get(source.geometryCacheKey);
		if (geometryTemplate === undefined) {
			geometryTemplate = buildEntityPartGeometryTemplate(shape, dimensions, complexity, primitiveOptions, texture, sprite);
			if (source.geometryCache !== null) source.geometryCache.set(source.geometryCacheKey, geometryTemplate);
		}
		mesh.geometry = geometryTemplate;

		// Set the triplanar scale per mesh, letting each instance's own texture density apply.
		if (geometryTemplate.triplanar) {
			mesh.material.textureScale = VISUAL_TEMPLATES.textures[texture.id].density * CONFIG.Rendering.Texture.Noise.Density * texture.density;
		}
	}
	else {
		geometry = BuildGeometry(shape, dimensions, complexity, primitiveOptions);
		mesh.geometry = {
			positions: geometry.positions,
			indices  : geometry.indices,
			uvs      : GenerateUVs(geometry.positions, geometry),
			bounds   : computeMeshBounds(geometry.positions, dimensions, sprite),
		};
		mesh.localBounds = mesh.geometry.bounds;
		mesh.centerline  = computeCenterLine(shape, geometry, transform);
	}

	mesh.worldAabb      = computeMeshWorldAabb(mesh, false);
	mesh.detailedBounds = computeDetailedBounds(mesh);

	InitializeDecalDisplay(mesh.customTextures, dimensions);

	const scatterContext = source.scatterContext;
	if (scatterContext && mesh.detail.scatter.length > 0) {
		const generatedScatter = BuildScatter({
			objectMesh       : mesh,
			scatterMultiplier: scatterContext.scatterMultiplier,
			world            : scatterContext.world,
			indexSeed        : scatterContext.indexSeed,
			explicitScatter  : mesh.detail.scatter,
			openFaces        : [],
		});

		if (generatedScatter.length > 0) {
			mesh.meta.scatter = { count: generatedScatter.length };
			scatterContext.scatterAccumulator?.push(...generatedScatter);
			scatterContext.onScatterGenerated?.(mesh, generatedScatter);
		}
	}

	// Entity parts skip UV work, they already have their own. Sprites skip as their images must not tile.
	if (source.role === "entity-part" || sprite !== null) return { mesh };

	// Bake noise per face on terrain, obstacles and water.
	const textureBlueprint = VISUAL_TEMPLATES.textures[texture.id];
	if (
		["terrain", "obstacle", "water"].includes(source.role) && 
		textureBlueprint.pattern === "noise" && 
		!geometry.uvs && geometry.faceGroups.every(g => g.indexStart !== undefined)
	) {
		const { uvs: normalizedUvs, faceSpans } = GenerateFaceProjectedUvs(geometry.positions, geometry.faceGroups, true);
		mesh.geometry.uvs = normalizedUvs;

		mesh.geometry.faceTextureGroups = BuildFaceTextureData(
			source.faceTextureStore, mesh.material.textureID, 
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

// Refit a moved mesh's world box and collision bounds. A rough box only places its local bounds.
function UpdateObjectWorldAabb(mesh, rough) {
	mesh.worldAabb      = computeMeshWorldAabb(mesh, rough);
	mesh.detailedBounds = computeDetailedBounds(mesh);
	return mesh.worldAabb;
}

export { BuildObject, UpdateObjectWorldAabb, GenerateUVs, GenerateFaceProjectedUvs };