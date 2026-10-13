// Single Object (shape) Generator

// Called by anything that wants any 3D object or wants to build models.

import { BuildGeometry } from "./NewPrimitive.js";
import { BuildScatter } from "./NewScatter.js";
import { BuildFaceTextureData, BuildNoiseAnimationOptions, ResolveTextureBlueprint, FREQUENCY_PATTERN_CONFIG, ComputeGeneratedTextureID, IsTextureTransparent, InitializeDecalDisplay } from "./NewTexture.js";
import VISUAL_TEMPLATES from "./templates/textures.json" with { type: "json" };
import { CONFIG } from "../core/config.js";
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
	// One matrix for the whole buffer — the transform is fixed across the sweep.
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

	// normalize = true: per-face [0,1] UVs; also collect uSpan/vSpan per group.
	const faceSpans = [];
	for (const group of faceGroups) {
		const [uAxis, vAxis] = getProjectedAxesFromNormal(group.normal);
		let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;

		for (const vertexIndex of group.vertexIndices) {
			const vertex = ArrayToVector3(positions, vertexIndex, true);
			const u = vertex[uAxis];
			const v = vertex[vAxis];
			if (u < minU) minU = u;
			if (u > maxU) maxU = u;
			if (v < minV) minV = v;
			if (v > maxV) maxV = v;
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
	if (geometry.uvs) return geometry.uvs;
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

function computeWorldAabbFromGeometry(positions, transform) {
	// One matrix for the whole buffer — the transform is fixed across the sweep.
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

// A tube's centerline in world space.
function computeWorldCenterline(shape, geometry, transform) {
	// Early return on non-tubes.
	if (shape !== "tube") return null;

	const matrix = CreateModelMatrix(transform);
	return geometry.centerline.map((point) => {
		const world = TransformPointByMatrix(point, matrix);
		return new UnitVector3(world.x, world.y, world.z, "cnu");
	});
}

function computeWorldAabbFromBounds(localBounds, transform) {
	const mn = localBounds.min, mx = localBounds.max;
	const corners = [
		{ x: mn.x, y: mn.y, z: mn.z }, { x: mx.x, y: mn.y, z: mn.z },
		{ x: mn.x, y: mx.y, z: mn.z }, { x: mx.x, y: mx.y, z: mn.z },
		{ x: mn.x, y: mn.y, z: mx.z }, { x: mx.x, y: mn.y, z: mx.z },
		{ x: mn.x, y: mx.y, z: mx.z }, { x: mx.x, y: mx.y, z: mx.z },
	];
	const matrix = CreateModelMatrix(transform);
	const first  = TransformPointByMatrix(corners[0], matrix);
	const bounds = {
		min: new UnitVector3(first.x, first.y, first.z, "cnu"),
		max: new UnitVector3(first.x, first.y, first.z, "cnu")
	};
	for (let i = 1; i < 8; i++) {
		const w = TransformPointByMatrix(corners[i], matrix);
		bounds.min.min(w);
		bounds.max.max(w);
	}
	return bounds;
}

// Builds+Freezes the geometry template for (blueprintId::partId), shared by ref across same-blueprint instances.
function buildEntityPartGeometryTemplate(shape, dimensions, complexity, primitiveOptions, texture) {
	const geometry = BuildGeometry(shape, dimensions, complexity, primitiveOptions);

	let uvs = GenerateUVs(geometry.positions, geometry);

	const textureBlueprint = VISUAL_TEMPLATES.textures[texture.id];

	// Noise parts use triplanar mapping. Default UVs stay so the UV buffer layout is unchanged.
	const triplanar = textureBlueprint !== undefined && textureBlueprint.pattern === "noise";

	if (!triplanar) {
		// Sphere pre-scale: de-tile-lock curved parts by scaling normalized UVs to physical span.
		if (geometry.uvMode === "sphere") {
			const uSpan = Math.PI * dimensions.x;
			const vSpan = Math.PI * dimensions.y * 0.5;
			for (let i = 0; i < uvs.length; i += 2) {
				uvs[i + 0] *= uSpan;
				uvs[i + 1] *= vSpan;
			}
		}

		// Frequency patterns: scale UVs by composed frequency. textureBlueprint absent for material-only parts.
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
		bounds   : computeBounds(geometry.positions),
	};
	// Only set the triplanar flag when true. Unflagged meshes use UVs.
	if (triplanar) template.triplanar = true;

	// Typed arrays NOT frozen — Object.freeze throws on non-empty Float32Array/Uint16Array.
	Object.freeze(template.bounds);
	Object.freeze(template.bounds.min);
	Object.freeze(template.bounds.max);
	Object.freeze(template);

	return template;
}

function BuildObject(source) {
	const shape = source.shape.toLowerCase();
	const complexity = source.complexity;

	const primitiveOptions = source.primitiveOptions;
	const transform = {
		position: source.position,         // UnitVector3
		rotation: source.rotation,         // UnitVector3
		scale   : source.scale,            // Vector3
		pivot   : source.pivot,            // UnitVector3
	};

	if (source.mode === "invisible") {
		let localBounds, worldAabb, tempGeometry = null;
		if (source.collisionShape === "triangle-soup") {
			const geom   = BuildGeometry(shape, source.dimensions, complexity, primitiveOptions);
			localBounds  = computeBounds(geom.positions);
			worldAabb    = computeWorldAabbFromGeometry(geom.positions, transform);
			tempGeometry = geom;
		}
		else {
			localBounds = {
				min: source.dimensions.clone().scale(-0.5),
				max: source.dimensions.clone().scale(0.5),
			};
			worldAabb = computeWorldAabbFromBounds(localBounds, transform);
		}
		return {
			mesh: {
				id            : source.id,
				type          : "mesh3d",
				meta          : { trigger: source.trigger, platform: source.platform, parentId: source.parentId, sticky: source.sticky, mode: source.mode, nullable: source.nullable, particle: source.particle },
				transform,
				dimensions    : source.dimensions,
				collisionShape: source.collisionShape,
				localBounds, worldAabb,
				detailedBounds: computeDetailedBounds({ collisionShape: source.collisionShape, geometry: tempGeometry, localBounds, worldAabb, transform }),
				centerline    : tempGeometry === null ? null : computeWorldCenterline(shape, tempGeometry, transform),
				customTextures: [],
			},
		};
	}

	if (source.mode === "void") {
		const geometry    = BuildGeometry(shape, source.dimensions, complexity, primitiveOptions);
		const localBounds = computeBounds(geometry.positions);
		const worldAabb   = computeWorldAabbFromGeometry(geometry.positions, transform);
		return {
			mesh: {
				id            : source.id,
				type          : "mesh3d",
				meta          : { trigger: source.trigger, platform: source.platform, parentId: source.parentId, sticky: source.sticky, mode: source.mode, nullable: source.nullable, particle: source.particle },
				transform,
				dimensions    : source.dimensions,
				collisionShape: source.collisionShape,
				localBounds, worldAabb,
				detailedBounds: computeDetailedBounds({ collisionShape: source.collisionShape, geometry, localBounds, worldAabb, transform }),
				geometry      : { positions: geometry.positions, indices: geometry.indices, indexCount: geometry.indices.length },
				centerline    : computeWorldCenterline(shape, geometry, transform),
				customTextures: [],
			},
		};
	}

	// Material and detail read from the generated base texture. Decals go in mesh.customTextures.
	const texture  = source.texture.generated;

	// Entity parts share one geometry per (blueprintId::partId). A null cache builds uncached (player model).
	if (source.role === "entity-part") {
		const materialTextureID = ComputeGeneratedTextureID(texture);

		// Memoization gate (mirrors the face-texture dedup gate): undefined === genuine cache miss.
		let geometryTemplate = source.geometryCache === null ? undefined : source.geometryCache.get(source.geometryCacheKey);
		if (geometryTemplate === undefined) {
			geometryTemplate = buildEntityPartGeometryTemplate(
				shape, source.dimensions, complexity, primitiveOptions, texture
			);
			if (source.geometryCache !== null) source.geometryCache.set(source.geometryCacheKey, geometryTemplate);
		}

		const partMesh = {
			id        : source.id,
			type      : "mesh3d",
			shape, complexity, transform,
			displayTransform : transform,
			renderMatrixCache: CreateRenderMatrixCache(transform),
			displayColor     : null,
			primitive        : shape,
			role             : source.role,
			geometry         : geometryTemplate,
			material         : {
				textureID  : materialTextureID,
				color      : { r: 1, g: 1, b: 1, a: 1 },
				opacity    : 1,
				transparent: IsTextureTransparent(texture),
			},
			meta: {
				trigger  : source.trigger,
				platform : source.platform,
				parentId : source.parentId,
				sticky   : source.sticky,
				mode     : source.mode,
				nullable : source.nullable,
				particle : source.particle,
			},
			detail: {
				scatter: source.detail.scatter,
				texture, complexity, primitiveOptions,
			},
			worldAabb      : computeWorldAabbFromGeometry(geometryTemplate.positions, transform),
			dimensions     : source.dimensions,
			collisionShape : source.collisionShape,
			customTextures : source.texture.custom,
			detailedBounds : null,
			performance    : { rendering: true },
		};
		// Triplanar scale is set per mesh, so each instance's texture.density applies even on shared geometry.
		if (geometryTemplate.triplanar) {
			partMesh.material.textureScale = VISUAL_TEMPLATES.textures[texture.id].density * CONFIG.Rendering.Texture.Noise.Density * texture.density;
		}
		partMesh.detailedBounds = computeDetailedBounds(partMesh);

		InitializeDecalDisplay(partMesh.customTextures);

		const scatterContext = source.scatterContext;
		if (scatterContext && partMesh.detail.scatter.length > 0) {
			const generatedScatter = BuildScatter({
				objectMesh       : partMesh,
				scatterMultiplier: scatterContext.scatterMultiplier,
				world            : scatterContext.world,
				indexSeed        : scatterContext.indexSeed,
				explicitScatter  : partMesh.detail.scatter,
				openFaces        : [],
			});

			if (generatedScatter.length > 0) {
				partMesh.meta.scatter = { count: generatedScatter.length };
				scatterContext.scatterAccumulator?.push(...generatedScatter);
				scatterContext.onScatterGenerated?.(partMesh, generatedScatter);
			}
		}

		return { mesh: partMesh };
	}

	const geometry = BuildGeometry(shape, source.dimensions, complexity, primitiveOptions);
	const bounds   = computeBounds(geometry.positions);

	const mesh = {
		id        : source.id,
		type      : "mesh3d",
		shape, complexity, transform,
		displayTransform : transform,
		renderMatrixCache: CreateRenderMatrixCache(transform),
		displayColor     : null,
		primitive : shape,
		role      : source.role,
		geometry  : {
			positions: geometry.positions,
			indices  : geometry.indices,
			uvs      : GenerateUVs(geometry.positions, geometry),
			bounds,
		},
		material: {
			textureID  : ComputeGeneratedTextureID(texture),
			color      : { r: 1, g: 1, b: 1, a: 1 },
			opacity    : 1,
			transparent: IsTextureTransparent(texture),
		},
		meta: {
			trigger  : source.trigger,
			platform : source.platform,
			parentId : source.parentId,
			sticky   : source.sticky,
			mode     : source.mode,
			nullable : source.nullable,
			particle : source.particle,
		},
		detail: {
			scatter: source.detail.scatter,
			texture, complexity, primitiveOptions,
		},
		localBounds   : bounds,
		worldAabb     : computeWorldAabbFromGeometry(geometry.positions, transform),
		centerline    : computeWorldCenterline(shape, geometry, transform),
		dimensions     : source.dimensions,
		collisionShape : source.collisionShape,
		customTextures : source.texture.custom,
		detailedBounds : null,
		performance    : { rendering: true },
	};
	mesh.detailedBounds = computeDetailedBounds(mesh);

	InitializeDecalDisplay(mesh.customTextures);

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

	// Per-face noise (terrain/obstacle/water). Entity parts use buildEntityPartGeometryTemplate.
	const textureBlueprint = VISUAL_TEMPLATES.textures[texture.id];
	const roleSupportsPerFace = source.role === "terrain" || source.role === "obstacle" || source.role === "water";
	if (roleSupportsPerFace && textureBlueprint.pattern === "noise" && !geometry.uvs && geometry.faceGroups.every(g => g.indexStart !== undefined)) {
		const textureScale = source.textureScale;
		const { uvs: normalizedUvs, faceSpans } = GenerateFaceProjectedUvs(geometry.positions, geometry.faceGroups, true);
		mesh.geometry.uvs = normalizedUvs;

		const resolvedBlueprint = ResolveTextureBlueprint(textureBlueprint, texture);

		const animationOptions = BuildNoiseAnimationOptions(textureBlueprint, texture);

		const { faceTextureGroups } = BuildFaceTextureData(
			source.faceTextureStore, mesh.material.textureID, resolvedBlueprint, geometry.faceGroups, faceSpans, textureScale, animationOptions
		);

		mesh.geometry.faceTextureGroups = faceTextureGroups;
		return { mesh };
	}

	// Frequency patterns: scale UVs by composed frequency. textureBlueprint absent for scatter/material-only parts.
	const frequencyConfigKey = textureBlueprint === undefined ? undefined : FREQUENCY_PATTERN_CONFIG[textureBlueprint.pattern];
	if (frequencyConfigKey !== undefined) {
		// visible periods per CNU = blueprint.density × cfg.Density × part.density
		const uvScale = textureBlueprint.density * CONFIG.Rendering.Texture[frequencyConfigKey].Density * texture.density;
		for (let i = 0; i < mesh.geometry.uvs.length; i++) mesh.geometry.uvs[i] *= uvScale;
	}

	return { mesh };
}

function UpdateObjectWorldAabb(mesh) {
	mesh.worldAabb = computeWorldAabbFromGeometry(mesh.geometry.positions, mesh.transform);
	mesh.detailedBounds = computeDetailedBounds(mesh);
	return mesh.worldAabb;
}

export { BuildObject, UpdateObjectWorldAabb, GenerateUVs, GenerateFaceProjectedUvs };