// Renderer and displayer of all visual elements.

// End of any visual pipeline to display contents to Game (document.body)

/* === CONSTANTS === */
// Element ids and defaults for engine rendering.

const defaultUiRootId = "engine-ui-root";

/* === IMPORTS === */
// UI element builder.

import { UIElement } from "../builder/NewUI.js";
import { CONFIG } from "../core/config.js";
import { Log } from "../core/meta.js";
import {
	CrossVector3,
	DotVector3,
	NormalizeUnitVector3,
	SubtractVector3,
} from "../math/Vector3.js";
import { CNUtoWorldUnit } from "../math/Utilities.js";
import { BuildGeometry, GenerateUVs } from "../builder/NewObject.js";

/* === INTERNALS === */
// DOM helpers for rendering payloads.

function ensureRoot(rootId, rootStyles) {
	// Resolve or create the UI root container.
	const resolvedRootId = rootId || defaultUiRootId;
	let root = document.getElementById(resolvedRootId);
	if (!root) {
		root = document.createElement("div");
		root.id = resolvedRootId;
		root.style.userSelect = "none";
		root.style.webkitUserSelect = "none";
		root.style.msUserSelect = "none";
		document.body.appendChild(root);
	}

	// Apply root styles when provided.
	if (rootStyles && typeof rootStyles === "object") {
		Object.assign(root.style, rootStyles);
	}

	return root;
}


/* === PAYLOADS === */
// Renders payloads built by the UI builder.

function RenderPayload(payload) {
	const root = ensureRoot(payload.rootId, payload.rootStyles);

	// Replace existing contents by default.
	if (payload.replace !== false) root.innerHTML = "";

	// Append pre-built elements when provided.
	root.appendChild(payload.elements);
}

/* === LEVEL === */
// WebGL level renderer for fully constructed 3D scene graphs.

const levelRendererCache = new Map();
const boundingBoxTypeColors = {
	Terrain: { r: 0.95, g: 0.85, b: 0.2, a: 1 },
	Scatter: { r: 0.2, g: 0.8, b: 0.2, a: 1 },
	Entity: { r: 0.2, g: 0.6, b: 1, a: 1 },
	EntityPart: { r: 0.45, g: 0.75, b: 1, a: 1 },
	Obstacle: { r: 1, g: 0.35, b: 0.35, a: 1 },
	Player: { r: 0.9, g: 0.95, b: 1, a: 1 },
	PlayerPart: { r: 0.75, g: 0.85, b: 1, a: 1 },
	Boss: { r: 0.95, g: 0.2, b: 0.9, a: 1 },
	BossPart: { r: 1, g: 0.45, b: 0.95, a: 1 },
};

function createIdentityMatrix() {
	return [
		1, 0, 0, 0,
		0, 1, 0, 0,
		0, 0, 1, 0,
		0, 0, 0, 1,
	];
}

function multiplyMatrix4(a, b) {
	const out = new Array(16);
	for (let col = 0; col < 4; col += 1) {
		for (let row = 0; row < 4; row += 1) {
			out[col * 4 + row] =
				a[0 * 4 + row] * b[col * 4 + 0] +
				a[1 * 4 + row] * b[col * 4 + 1] +
				a[2 * 4 + row] * b[col * 4 + 2] +
				a[3 * 4 + row] * b[col * 4 + 3];
		}
	}
	return out;
}

function createPerspectiveMatrix(fovDegrees, aspect, near, far) {
	const safeAspect = aspect > 0 ? aspect : 1;
	const fov = (fovDegrees * Math.PI) / 180;
	const f = 1 / Math.tan(fov / 2);
	const nf = 1 / (near - far);

	return [
		f / safeAspect, 0, 0, 0,
		0, f, 0, 0,
		0, 0, (far + near) * nf, -1,
		0, 0, (2 * far * near) * nf, 0,
	];
}

function createLookAtMatrix(eye, target, up) {
	const zAxis = NormalizeUnitVector3(SubtractVector3(eye, target));
	const xAxis = NormalizeUnitVector3(CrossVector3(up, zAxis));
	const yAxis = CrossVector3(zAxis, xAxis);

	return [
		xAxis.x, yAxis.x, zAxis.x, 0,
		xAxis.y, yAxis.y, zAxis.y, 0,
		xAxis.z, yAxis.z, zAxis.z, 0,
		-DotVector3(xAxis, eye), -DotVector3(yAxis, eye), -DotVector3(zAxis, eye), 1,
	];
}

function createTranslationMatrix(position) {
	return [
		1, 0, 0, 0,
		0, 1, 0, 0,
		0, 0, 1, 0,
		position.x, position.y, position.z, 1,
	];
}

function createScaleMatrix(scale) {
	return [
		scale.x, 0, 0, 0,
		0, scale.y, 0, 0,
		0, 0, scale.z, 0,
		0, 0, 0, 1,
	];
}

function createRotationX(radians) {
	const c = Math.cos(radians);
	const s = Math.sin(radians);
	return [
		1, 0, 0, 0,
		0, c, s, 0,
		0, -s, c, 0,
		0, 0, 0, 1,
	];
}

function createRotationY(radians) {
	const c = Math.cos(radians);
	const s = Math.sin(radians);
	return [
		c, 0, -s, 0,
		0, 1, 0, 0,
		s, 0, c, 0,
		0, 0, 0, 1,
	];
}

function createRotationZ(radians) {
	const c = Math.cos(radians);
	const s = Math.sin(radians);
	return [
		c, s, 0, 0,
		-s, c, 0, 0,
		0, 0, 1, 0,
		0, 0, 0, 1,
	];
}

function CreateModelMatrix(transform) {
	const source = transform && typeof transform === "object" ? transform : {};
	const position = source.position || { x: 0, y: 0, z: 0 };
	const rotation = source.rotation || { x: 0, y: 0, z: 0 };
	const scale = source.scale || { x: 1, y: 1, z: 1 };
	const pivot = source.pivot || { x: 0, y: 0, z: 0 };

	let matrix = createIdentityMatrix();
	matrix = multiplyMatrix4(matrix, createTranslationMatrix(position));
	matrix = multiplyMatrix4(matrix, createTranslationMatrix(pivot));
	matrix = multiplyMatrix4(matrix, createRotationY(rotation.y || 0));
	matrix = multiplyMatrix4(matrix, createRotationX(rotation.x || 0));
	matrix = multiplyMatrix4(matrix, createRotationZ(rotation.z || 0));
	matrix = multiplyMatrix4(matrix, createScaleMatrix(scale));
	matrix = multiplyMatrix4(matrix, createTranslationMatrix({ x: -pivot.x, y: -pivot.y, z: -pivot.z }));
	return matrix;
}

/**
 * Convert a CNU-space vector to WebGL world units.
 * Handles UnitVector3 instances (via .toWorldUnit()), plain objects with .type === "CNU",
 * and plain objects without type info (treated as CNU by default).
 */
function toWorldVec3(vec) {
	if (!vec || typeof vec !== "object") {
		return { x: 0, y: 0, z: 0 };
	}
	if (typeof vec.toWorldUnit === "function") {
		return vec.toWorldUnit();
	}
	return { x: CNUtoWorldUnit(vec.x || 0), y: CNUtoWorldUnit(vec.y || 0), z: CNUtoWorldUnit(vec.z || 0) };
}

/**
 * Build a model matrix converting CNU-space transform to WebGL world units.
 * Position and pivot use .toWorldUnit(); scale is multiplied by CNU_SCALE
 * (dimensionless multiplier applied to CNU geometry); rotation stays in radians.
 */
function CreateWorldUnitModelMatrix(transform) {
	const source = transform && typeof transform === "object" ? transform : {};
	const position = source.position ? source.position.toWorldUnit() : { x: 0, y: 0, z: 0 };
	const rotation = source.rotation || { x: 0, y: 0, z: 0 };
	const s = source.scale || { x: 1, y: 1, z: 1 };
	const scale = { x: CNUtoWorldUnit(s.x), y: CNUtoWorldUnit(s.y), z: CNUtoWorldUnit(s.z) };
	const pivot = source.pivot ? source.pivot.toWorldUnit() : { x: 0, y: 0, z: 0 };

	let matrix = createIdentityMatrix();
	matrix = multiplyMatrix4(matrix, createTranslationMatrix(position));
	matrix = multiplyMatrix4(matrix, createTranslationMatrix(pivot));
	matrix = multiplyMatrix4(matrix, createRotationY(rotation.y || 0));
	matrix = multiplyMatrix4(matrix, createRotationX(rotation.x || 0));
	matrix = multiplyMatrix4(matrix, createRotationZ(rotation.z || 0));
	matrix = multiplyMatrix4(matrix, createScaleMatrix(scale));
	matrix = multiplyMatrix4(matrix, createTranslationMatrix({ x: -pivot.x, y: -pivot.y, z: -pivot.z }));
	return matrix;
}

function createShader(gl, type, source) {
	const shader = gl.createShader(type);
	if (!shader) {
		return null;
	}
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

function createProgram(gl) {
	const vertexShaderSource = `#version 300 es
		in vec3 a_position;
		in vec2 a_uv;
		uniform mat4 u_projection;
		uniform mat4 u_view;
		uniform mat4 u_model;
		out vec2 v_uv;
		out float v_depth;
		void main() {
			vec4 world = u_model * vec4(a_position, 1.0);
			vec4 viewPos = u_view * world;
			gl_Position = u_projection * viewPos;
			v_uv = a_uv;
			v_depth = abs(viewPos.z);
		}
	`;

	const fragmentShaderSource = `#version 300 es
		precision highp float;
		uniform sampler2D u_texture;
		uniform vec4 u_tint;
		uniform float u_fogDensity;
		uniform float u_far;
		uniform vec3 u_colorShift;
		uniform float u_underwater;
		in vec2 v_uv;
		in float v_depth;
		out vec4 fragColor;
		void main() {
			vec4 texel = texture(u_texture, v_uv);
			vec4 shaded = vec4(texel.rgb * u_tint.rgb, texel.a * u_tint.a);
			if (shaded.a <= 0.01) {
				discard;
			}

			float normalizedDepth = v_depth / max(1.0, u_far);
			float fog = clamp(normalizedDepth * u_fogDensity, 0.0, 1.0);
			vec3 shifted = shaded.rgb + u_colorShift;
			vec3 fogColor = mix(vec3(0.04, 0.05, 0.08), vec3(0.03, 0.13, 0.2), clamp(u_underwater, 0.0, 1.0));
			vec3 finalColor = mix(shifted, fogColor, fog);
			fragColor = vec4(finalColor, shaded.a);
		}
	`;

	const vertex = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
	const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
	if (!vertex || !fragment) {
		return null;
	}

	const program = gl.createProgram();
	if (!program) {
		return null;
	}

	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		gl.deleteProgram(program);
		return null;
	}

	return {
		program: program,
		attributes: {
			position: gl.getAttribLocation(program, "a_position"),
			uv: gl.getAttribLocation(program, "a_uv"),
		},
		uniforms: {
			projection: gl.getUniformLocation(program, "u_projection"),
			view: gl.getUniformLocation(program, "u_view"),
			model: gl.getUniformLocation(program, "u_model"),
			texture: gl.getUniformLocation(program, "u_texture"),
			tint: gl.getUniformLocation(program, "u_tint"),
			fogDensity: gl.getUniformLocation(program, "u_fogDensity"),
			far: gl.getUniformLocation(program, "u_far"),
			colorShift: gl.getUniformLocation(program, "u_colorShift"),
			underwater: gl.getUniformLocation(program, "u_underwater"),
		},
	};
}

function createLineProgram(gl) {
	const vertexShaderSource = `#version 300 es
		in vec3 a_position;
		uniform mat4 u_projection;
		uniform mat4 u_view;
		uniform mat4 u_model;
		void main() {
			gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
		}
	`;

	const fragmentShaderSource = `#version 300 es
		precision mediump float;
		uniform vec4 u_color;
		out vec4 fragColor;
		void main() {
			fragColor = u_color;
		}
	`;

	const vertex = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
	const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
	if (!vertex || !fragment) {
		return null;
	}

	const program = gl.createProgram();
	if (!program) {
		return null;
	}

	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		gl.deleteProgram(program);
		return null;
	}

	return {
		program: program,
		attributes: {
			position: gl.getAttribLocation(program, "a_position"),
		},
		uniforms: {
			projection: gl.getUniformLocation(program, "u_projection"),
			view: gl.getUniformLocation(program, "u_view"),
			model: gl.getUniformLocation(program, "u_model"),
			color: gl.getUniformLocation(program, "u_color"),
		},
	};
}

function createScatterProgram(gl) {
	// Instanced scatter shader: per-instance model matrix + tint via vertex attributes.
	// Attribute layout:
	//   0 = a_position (vec3)
	//   1 = a_uv (vec2)
	//   2 = a_instanceRow0 (vec4) — model matrix column 0
	//   3 = a_instanceRow1 (vec4) — model matrix column 1
	//   4 = a_instanceRow2 (vec4) — model matrix column 2
	//   5 = a_instanceRow3 (vec4) — model matrix column 3
	//   6 = a_instanceTint (vec4) — per-instance tint/opacity

	const vertexShaderSource = `#version 300 es
		layout(location = 0) in vec3 a_position;
		layout(location = 1) in vec2 a_uv;
		layout(location = 2) in vec4 a_instanceRow0;
		layout(location = 3) in vec4 a_instanceRow1;
		layout(location = 4) in vec4 a_instanceRow2;
		layout(location = 5) in vec4 a_instanceRow3;
		layout(location = 6) in vec4 a_instanceTint;
		uniform mat4 u_projection;
		uniform mat4 u_view;
		out vec2 v_uv;
		out float v_depth;
		out vec4 v_tint;
		void main() {
			mat4 instanceModel = mat4(a_instanceRow0, a_instanceRow1, a_instanceRow2, a_instanceRow3);
			vec4 world = instanceModel * vec4(a_position, 1.0);
			vec4 viewPos = u_view * world;
			gl_Position = u_projection * viewPos;
			v_uv = a_uv;
			v_depth = abs(viewPos.z);
			v_tint = a_instanceTint;
		}
	`;

	const fragmentShaderSource = `#version 300 es
		precision highp float;
		uniform sampler2D u_texture;
		uniform float u_fogDensity;
		uniform float u_far;
		uniform vec3 u_colorShift;
		uniform float u_underwater;
		in vec2 v_uv;
		in float v_depth;
		in vec4 v_tint;
		out vec4 fragColor;
		void main() {
			vec4 texel = texture(u_texture, v_uv);
			vec4 shaded = vec4(texel.rgb * v_tint.rgb, texel.a * v_tint.a);
			if (shaded.a <= 0.01) {
				discard;
			}

			float normalizedDepth = v_depth / max(1.0, u_far);
			float fog = clamp(normalizedDepth * u_fogDensity, 0.0, 1.0);
			vec3 shifted = shaded.rgb + u_colorShift;
			vec3 fogColor = mix(vec3(0.04, 0.05, 0.08), vec3(0.03, 0.13, 0.2), clamp(u_underwater, 0.0, 1.0));
			vec3 finalColor = mix(shifted, fogColor, fog);
			fragColor = vec4(finalColor, shaded.a);
		}
	`;

	const vertex = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
	const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
	if (!vertex || !fragment) {
		return null;
	}

	const program = gl.createProgram();
	if (!program) {
		return null;
	}

	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		Log("ENGINE", `Scatter shader link error: ${gl.getProgramInfoLog(program)}`, "error", "Render");
		gl.deleteProgram(program);
		return null;
	}

	return {
		program: program,
		uniforms: {
			projection: gl.getUniformLocation(program, "u_projection"),
			view: gl.getUniformLocation(program, "u_view"),
			texture: gl.getUniformLocation(program, "u_texture"),
			fogDensity: gl.getUniformLocation(program, "u_fogDensity"),
			far: gl.getUniformLocation(program, "u_far"),
			colorShift: gl.getUniformLocation(program, "u_colorShift"),
			underwater: gl.getUniformLocation(program, "u_underwater"),
		},
	};
}

/* === GEOMETRY REGISTRY === */
// Shared geometry pool: one set of GPU buffers per unique (primitive, dimensions) combo.

function normalizeGeometryComplexity(value) {
	if (typeof value !== "string") {
		return "medium";
	}

	const normalized = value.trim().toLowerCase();
	if (normalized === "low" || normalized === "high") {
		return normalized;
	}

	return "medium";
}

function geometryKey(primitive, dimensions, complexity) {
	const p = typeof primitive === "string" ? primitive.toLowerCase() : "cube";
	const dx = dimensions && typeof dimensions.x === "number" ? dimensions.x : 1;
	const dy = dimensions && typeof dimensions.y === "number" ? dimensions.y : 1;
	const dz = dimensions && typeof dimensions.z === "number" ? dimensions.z : 1;
	const detail = normalizeGeometryComplexity(complexity);
	return `${p}_${dx}_${dy}_${dz}_${detail}`;
}

function ensureSharedGeometry(renderer, primitive, dimensions, complexity) {
	const key = geometryKey(primitive, dimensions, complexity);
	if (renderer.geometryRegistry.has(key)) {
		return renderer.geometryRegistry.get(key);
	}

	const gl = renderer.gl;
	const shape = typeof primitive === "string" ? primitive.toLowerCase() : "cube";
	const size = {
		x: dimensions && typeof dimensions.x === "number" ? dimensions.x : 1,
		y: dimensions && typeof dimensions.y === "number" ? dimensions.y : 1,
		z: dimensions && typeof dimensions.z === "number" ? dimensions.z : 1,
	};

	const geometry = BuildGeometry(shape, size, normalizeGeometryComplexity(complexity));
	const uvs = GenerateUVs(geometry.positions, geometry);

	const positionBuffer = gl.createBuffer();
	const uvBuffer = gl.createBuffer();
	const indexBuffer = gl.createBuffer();
	if (!positionBuffer || !uvBuffer || !indexBuffer) {
		return null;
	}

	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.positions), gl.STATIC_DRAW);

	const resolvedUvs = Array.isArray(uvs) && uvs.length / 2 === geometry.positions.length / 3
		? uvs
		: new Array((geometry.positions.length / 3) * 2).fill(0);
	gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(resolvedUvs), gl.STATIC_DRAW);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geometry.indices), gl.STATIC_DRAW);

	const entry = {
		positionBuffer: positionBuffer,
		uvBuffer: uvBuffer,
		indexBuffer: indexBuffer,
		indexCount: geometry.indices.length,
	};

	renderer.geometryRegistry.set(key, entry);
	return entry;
}

/* === SCATTER INSTANCE BUFFERS === */
// Builds per-batch VAOs and instance buffers from scatterBatches on the sceneGraph.

function buildScatterInstanceBuffers(renderer, sceneGraph) {
	const batches = sceneGraph.scatterBatches;
	if (!batches || batches.size === 0) {
		renderer.scatterInstances = [];
		renderer.scatterInstancesBuilt = true;
		return;
	}

	const gl = renderer.gl;
	const results = [];
	let totalInstances = 0;

	batches.forEach((batch, batchKey) => {
		if (!batch || !Array.isArray(batch.instances) || batch.instances.length === 0) {
			return;
		}

		const geo = ensureSharedGeometry(renderer, batch.primitive, batch.dimensions, batch.complexity);
		if (!geo) {
			return;
		}

		const instanceCount = batch.instances.length;
		// 20 floats per instance: 16 (mat4 model) + 4 (tint rgba)
		const instanceData = new Float32Array(instanceCount * 20);
		for (let i = 0; i < instanceCount; i += 1) {
			const inst = batch.instances[i];
			const offset = i * 20;
			// Copy 16-float model matrix, premultiplied by uniform CNU_SCALE.
			// Uniform scale S applied as: S * M — multiply first 3 rows by CNU_SCALE.
			const m = inst.modelMatrix;
			for (let col = 0; col < 4; col += 1) {
				const cOff = col * 4;
				instanceData[offset + cOff + 0] = CNUtoWorldUnit(m[cOff + 0]);
				instanceData[offset + cOff + 1] = CNUtoWorldUnit(m[cOff + 1]);
				instanceData[offset + cOff + 2] = CNUtoWorldUnit(m[cOff + 2]);
				instanceData[offset + cOff + 3] = m[cOff + 3];
			}
			// Copy 4-float tint
			instanceData[offset + 16] = inst.tint[0];
			instanceData[offset + 17] = inst.tint[1];
			instanceData[offset + 18] = inst.tint[2];
			instanceData[offset + 19] = inst.tint[3];
		}

		const instanceBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.STATIC_DRAW);

		// Create a VAO that binds shared geometry + instance attributes.
		const vao = gl.createVertexArray();
		gl.bindVertexArray(vao);

		// Attribute 0: a_position (vec3) — per-vertex
		gl.bindBuffer(gl.ARRAY_BUFFER, geo.positionBuffer);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

		// Attribute 1: a_uv (vec2) — per-vertex
		gl.bindBuffer(gl.ARRAY_BUFFER, geo.uvBuffer);
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

		// Index buffer
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geo.indexBuffer);

		// Instance attributes from instanceBuffer (stride = 20 floats = 80 bytes)
		gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
		const stride = 80;

		// Attribute 2: a_instanceRow0 (vec4) — offset 0
		gl.enableVertexAttribArray(2);
		gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 0);
		gl.vertexAttribDivisor(2, 1);

		// Attribute 3: a_instanceRow1 (vec4) — offset 16
		gl.enableVertexAttribArray(3);
		gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 16);
		gl.vertexAttribDivisor(3, 1);

		// Attribute 4: a_instanceRow2 (vec4) — offset 32
		gl.enableVertexAttribArray(4);
		gl.vertexAttribPointer(4, 4, gl.FLOAT, false, stride, 32);
		gl.vertexAttribDivisor(4, 1);

		// Attribute 5: a_instanceRow3 (vec4) — offset 48
		gl.enableVertexAttribArray(5);
		gl.vertexAttribPointer(5, 4, gl.FLOAT, false, stride, 48);
		gl.vertexAttribDivisor(5, 1);

		// Attribute 6: a_instanceTint (vec4) — offset 64
		gl.enableVertexAttribArray(6);
		gl.vertexAttribPointer(6, 4, gl.FLOAT, false, stride, 64);
		gl.vertexAttribDivisor(6, 1);

		gl.bindVertexArray(null);

		totalInstances += instanceCount;
		results.push({
			key: batchKey,
			vao: vao,
			indexCount: geo.indexCount,
			instanceCount: instanceCount,
			textureID: batch.textureID,
		});
	});

	renderer.scatterInstances = results;
	renderer.scatterInstancesBuilt = true;
	Log(
		"ENGINE",
		`Scatter instancing ready: ${results.length} batch(es), ${totalInstances} total instance(s), ${results.length} draw call(s)`,
		"log",
		"Level"
	);
}

function isBoundingBoxDebugEnabled(type) {
	if (!CONFIG.DEBUG.ALL) return false;

	const debugMap = CONFIG.DEBUG.LEVELS.BoundingBox;
	return !!(debugMap && debugMap[type] === true);
}

function createBoundingBoxLineVertices(bounds) {
	if (!bounds || !bounds.min || !bounds.max) {
		return null;
	}

	// Convert CNU bounding box coordinates to WebGL world units.
	const min = toWorldVec3(bounds.min);
	const max = toWorldVec3(bounds.max);
	const p000 = [min.x, min.y, min.z];
	const p001 = [min.x, min.y, max.z];
	const p010 = [min.x, max.y, min.z];
	const p011 = [min.x, max.y, max.z];
	const p100 = [max.x, min.y, min.z];
	const p101 = [max.x, min.y, max.z];
	const p110 = [max.x, max.y, min.z];
	const p111 = [max.x, max.y, max.z];

	return new Float32Array([
		...p000, ...p001, ...p001, ...p011, ...p011, ...p010, ...p010, ...p000,
		...p100, ...p101, ...p101, ...p111, ...p111, ...p110, ...p110, ...p100,
		...p000, ...p100, ...p001, ...p101, ...p010, ...p110, ...p011, ...p111,
	]);
}

function isGridDebugEnabled() {
	if (!CONFIG.DEBUG.ALL) return false;
	const grid = CONFIG.DEBUG.LEVELS.BoundingBox.Grid;
	return !!(grid && grid.Visible === true);
}

function createGridLineVertices(bounds, spacing) {
	if (!bounds || !bounds.min || !bounds.max || spacing <= 0) {
		return null;
	}

	const wMin = toWorldVec3(bounds.min);
	const wMax = toWorldVec3(bounds.max);
	const minX = wMin.x;
	const minY = wMin.y;
	const minZ = wMin.z;
	const maxX = wMax.x;
	const maxY = wMax.y;
	const maxZ = wMax.z;
	const step = CNUtoWorldUnit(spacing);

	const lines = [];

	// --- Top face (Y = maxY) ---
	for (let x = minX; x <= maxX + step * 0.001; x += step) {
		lines.push(x, maxY, minZ, x, maxY, maxZ);
	}
	for (let z = minZ; z <= maxZ + step * 0.001; z += step) {
		lines.push(minX, maxY, z, maxX, maxY, z);
	}

	// --- Bottom face (Y = minY) ---
	for (let x = minX; x <= maxX + step * 0.001; x += step) {
		lines.push(x, minY, minZ, x, minY, maxZ);
	}
	for (let z = minZ; z <= maxZ + step * 0.001; z += step) {
		lines.push(minX, minY, z, maxX, minY, z);
	}

	// --- Front face (Z = maxZ) ---
	for (let x = minX; x <= maxX + step * 0.001; x += step) {
		lines.push(x, minY, maxZ, x, maxY, maxZ);
	}
	for (let y = minY; y <= maxY + step * 0.001; y += step) {
		lines.push(minX, y, maxZ, maxX, y, maxZ);
	}

	// --- Back face (Z = minZ) ---
	for (let x = minX; x <= maxX + step * 0.001; x += step) {
		lines.push(x, minY, minZ, x, maxY, minZ);
	}
	for (let y = minY; y <= maxY + step * 0.001; y += step) {
		lines.push(minX, y, minZ, maxX, y, minZ);
	}

	// --- Right face (X = maxX) ---
	for (let z = minZ; z <= maxZ + step * 0.001; z += step) {
		lines.push(maxX, minY, z, maxX, maxY, z);
	}
	for (let y = minY; y <= maxY + step * 0.001; y += step) {
		lines.push(maxX, y, minZ, maxX, y, maxZ);
	}

	// --- Left face (X = minX) ---
	for (let z = minZ; z <= maxZ + step * 0.001; z += step) {
		lines.push(minX, minY, z, minX, maxY, z);
	}
	for (let y = minY; y <= maxY + step * 0.001; y += step) {
		lines.push(minX, y, minZ, minX, y, maxZ);
	}

	if (lines.length === 0) {
		return null;
	}

	return new Float32Array(lines);
}

function drawBoundingBoxes(renderer, sceneGraph, projection, view) {
	const records = sceneGraph.debugBoundingBoxes;
	if (records.length === 0) {
		return;
	}

	const gl = renderer.gl;
	if (!renderer.debugLineShader) {
		renderer.debugLineShader = createLineProgram(gl);
	}
	if (!renderer.debugLineShader) {
		return;
	}
	if (!renderer.debugLineBuffer) {
		renderer.debugLineBuffer = gl.createBuffer();
	}
	if (!renderer.debugLineBuffer) {
		return;
	}

	const shader = renderer.debugLineShader;
	gl.useProgram(shader.program);
	gl.uniformMatrix4fv(shader.uniforms.projection, false, new Float32Array(projection));
	gl.uniformMatrix4fv(shader.uniforms.view, false, new Float32Array(view));
	gl.uniformMatrix4fv(shader.uniforms.model, false, new Float32Array(createIdentityMatrix()));

	gl.bindBuffer(gl.ARRAY_BUFFER, renderer.debugLineBuffer);
	gl.enableVertexAttribArray(shader.attributes.position);
	gl.vertexAttribPointer(shader.attributes.position, 3, gl.FLOAT, false, 0, 0);

	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		if (!record || !isBoundingBoxDebugEnabled(record.type)) {
			continue;
		}

		const vertices = createBoundingBoxLineVertices(record);
		if (!vertices) {
			continue;
		}

		const color = boundingBoxTypeColors[record.type] || { r: 1, g: 1, b: 1, a: 1 };
		gl.uniform4f(shader.uniforms.color, color.r, color.g, color.b, color.a);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
		gl.drawArrays(gl.LINES, 0, vertices.length / 3);
	}
}

function drawGridOverlay(renderer, sceneGraph, projection, view) {
	if (!isGridDebugEnabled()) {
		return;
	}

	const records = sceneGraph.debugBoundingBoxes;
	if (records.length === 0) {
		return;
	}

	const gl = renderer.gl;
	if (!renderer.debugLineShader || !renderer.debugLineBuffer) {
		return;
	}

	const gridConfig = CONFIG.DEBUG.LEVELS.BoundingBox.Grid;
	const spacing = gridConfig.Scale;

	const shader = renderer.debugLineShader;
	gl.useProgram(shader.program);
	gl.uniformMatrix4fv(shader.uniforms.projection, false, new Float32Array(projection));
	gl.uniformMatrix4fv(shader.uniforms.view, false, new Float32Array(view));
	gl.uniformMatrix4fv(shader.uniforms.model, false, new Float32Array(createIdentityMatrix()));

	gl.bindBuffer(gl.ARRAY_BUFFER, renderer.debugLineBuffer);
	gl.enableVertexAttribArray(shader.attributes.position);
	gl.vertexAttribPointer(shader.attributes.position, 3, gl.FLOAT, false, 0, 0);

	gl.uniform4f(shader.uniforms.color, 0.5, 0.5, 0.5, 0.6);

	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		if (!record || !isBoundingBoxDebugEnabled(record.type)) {
			continue;
		}

		const vertices = createGridLineVertices(record, spacing);
		if (!vertices) {
			continue;
		}

		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
		gl.drawArrays(gl.LINES, 0, vertices.length / 3);
	}
}

const trailTypeColors = {
	Player: { r: 0, g: 1, b: 1, a: 1 },
	Boss: { r: 1, g: 0.2, b: 0.9, a: 1 },
	Enemies: { r: 1, g: 0.6, b: 0.2, a: 1 },
	Collectible: { r: 0.2, g: 1, b: 0.4, a: 1 },
	Projectile: { r: 1, g: 1, b: 0.2, a: 1 },
};

function isTrailDebugEnabled(type) {
	if (!CONFIG.DEBUG.ALL) return false;
	const trailMap = CONFIG.DEBUG.LEVELS.Trails;
	return !!(trailMap && trailMap[type] === true);
}

function classifyEntityTrailType(entity) {
	const type = String(entity.type).toLowerCase();
	if (type.includes("player")) { return "Player"; }
	if (type.includes("boss")) { return "Boss"; }
	if (type.includes("collectible")) { return "Collectible"; }
	if (type.includes("projectile")) { return "Projectile"; }
	return "Enemies";
}

function drawVelocityTrails(renderer, sceneGraph, projection, view) {
	if (!CONFIG.DEBUG.ALL) return;
	const trailMap = CONFIG.DEBUG.LEVELS.Trails;
	if (!trailMap) {
		return;
	}
	// Quick check: any trail flag enabled?
	const anyEnabled = Object.values(trailMap).some(Boolean);
	if (!anyEnabled) {
		return;
	}

	const entities = sceneGraph.entities;
	if (entities.length === 0) {
		return;
	}

	const gl = renderer.gl;
	if (!renderer.debugLineShader) {
		return;
	}
	if (!renderer.debugLineBuffer) {
		return;
	}

	const shader = renderer.debugLineShader;
	gl.useProgram(shader.program);
	gl.uniformMatrix4fv(shader.uniforms.projection, false, new Float32Array(projection));
	gl.uniformMatrix4fv(shader.uniforms.view, false, new Float32Array(view));
	gl.uniformMatrix4fv(shader.uniforms.model, false, new Float32Array(createIdentityMatrix()));

	gl.bindBuffer(gl.ARRAY_BUFFER, renderer.debugLineBuffer);
	gl.enableVertexAttribArray(shader.attributes.position);
	gl.vertexAttribPointer(shader.attributes.position, 3, gl.FLOAT, false, 0, 0);

	const TRAIL_SCALE = 0.15;

	for (let i = 0; i < entities.length; i += 1) {
		const entity = entities[i];


		const trailType = classifyEntityTrailType(entity);
		if (!isTrailDebugEnabled(trailType)) {
			continue;
		}

		const vel = entity.velocity;
		const speedSq = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;
		if (speedSq < 0.01) {
			continue;
		}

		const pos = entity.transform.position;
		const endX = pos.x + vel.x * TRAIL_SCALE;
		const endY = pos.y + vel.y * TRAIL_SCALE;
		const endZ = pos.z + vel.z * TRAIL_SCALE;

		// Convert CNU positions to world units for rendering.
		const vertices = new Float32Array([
			CNUtoWorldUnit(pos.x), CNUtoWorldUnit(pos.y), CNUtoWorldUnit(pos.z),
			CNUtoWorldUnit(endX), CNUtoWorldUnit(endY), CNUtoWorldUnit(endZ),
		]);
		const color = trailTypeColors[trailType] || { r: 1, g: 1, b: 1, a: 1 };

		gl.uniform4f(shader.uniforms.color, color.r, color.g, color.b, color.a);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
		gl.drawArrays(gl.LINES, 0, 2);
	}
}

function createMeshBuffers(gl, mesh, shader) {
	const geometry = mesh && mesh.geometry ? mesh.geometry : null;
	if (!geometry || !Array.isArray(geometry.positions) || !Array.isArray(geometry.indices)) {
		return null;
	}

	const positionBuffer = gl.createBuffer();
	const uvBuffer = gl.createBuffer();
	const indexBuffer = gl.createBuffer();
	if (!positionBuffer || !uvBuffer || !indexBuffer) {
		return null;
	}

	const vao = gl.createVertexArray();
	gl.bindVertexArray(vao);

	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.positions), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(shader.attributes.position);
	gl.vertexAttribPointer(shader.attributes.position, 3, gl.FLOAT, false, 0, 0);

	const uvs = Array.isArray(geometry.uvs) && geometry.uvs.length / 2 === geometry.positions.length / 3
		? geometry.uvs
		: new Array((geometry.positions.length / 3) * 2).fill(0);
	gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(shader.attributes.uv);
	gl.vertexAttribPointer(shader.attributes.uv, 2, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geometry.indices), gl.STATIC_DRAW);

	gl.bindVertexArray(null);

	return {
		position: positionBuffer,
		uv: uvBuffer,
		index: indexBuffer,
		indexCount: geometry.indices.length,
		vao: vao,
	};
}

function getMeshBufferKey(mesh) {
	if (!mesh || !mesh.geometry) {
		return null;
	}

	const meshId = typeof mesh.id === "string" && mesh.id.length > 0 ? mesh.id : "mesh";
	const primitive = typeof mesh.primitive === "string"
		? mesh.primitive.toLowerCase()
		: (typeof mesh.shape === "string" ? mesh.shape.toLowerCase() : "cube");
	const complexity = typeof mesh.complexity === "string"
		? mesh.complexity.toLowerCase()
		: (mesh.detail && typeof mesh.detail.complexity === "string" ? mesh.detail.complexity.toLowerCase() : "medium");
	const dims = mesh.dimensions && typeof mesh.dimensions === "object" ? mesh.dimensions : null;
	const dx = dims && typeof dims.x === "number" ? dims.x : 1;
	const dy = dims && typeof dims.y === "number" ? dims.y : 1;
	const dz = dims && typeof dims.z === "number" ? dims.z : 1;

	return `${meshId}|${primitive}|${dx}|${dy}|${dz}|${complexity}`;
}

function createFallbackTexture(gl) {
	const texture = gl.createTexture();
	if (!texture) {
		return null;
	}
	gl.bindTexture(gl.TEXTURE_2D, texture);
	const pixel = new Uint8Array([255, 255, 255, 255]);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	return texture;
}

function ensureSceneTexture(renderer, sceneGraph, textureID) {
	const id = textureID || "default-grid";
	if (renderer.textures.has(id)) {
		return renderer.textures.get(id);
	}

	const gl = renderer.gl;
	const visualResources = sceneGraph.visualResources;
	const textureRegistry = visualResources.textureRegistry;
	const entry = textureRegistry[id];

	const texture = gl.createTexture();
	if (!texture) {
		return renderer.fallbackTexture;
	}

	gl.bindTexture(gl.TEXTURE_2D, texture);
	if (entry && entry.source) {
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.source);
	} else {
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([200, 200, 200, 255]));
	}
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

	renderer.textures.set(id, texture);
	return texture;
}

function ensureLevelRenderer(rootId, rootStyles) {
	const existing = levelRendererCache.get(rootId);
	if (existing) {
		return existing;
	}

	const root = ensureRoot(rootId, {
		position: "fixed",
		inset: "0",
		zIndex: "0",
		...rootStyles,
	});

	const canvas = document.createElement("canvas");
	canvas.id = `${rootId}-canvas`;
	canvas.style.width = "100%";
	canvas.style.height = "100%";
	canvas.style.display = "block";
	root.innerHTML = "";
	root.appendChild(canvas);

	const gl = canvas.getContext("webgl2");
	if (!gl) {
		Log("ENGINE", "WebGL2 is not supported by this browser.", "error", "Render");
		return null;
	}

	const shader = createProgram(gl);
	if (!shader) {
		return null;
	}

	const scatterShader = createScatterProgram(gl);
	if (!scatterShader) {
		Log("ENGINE", "Failed to create instanced scatter shader.", "error", "Render");
		return null;
	}

	const renderer = {
		rootId: rootId,
		root: root,
		canvas: canvas,
		gl: gl,
		shader: shader,
		scatterShader: scatterShader,
		meshBuffers: new Map(),
		textures: new Map(),
		geometryRegistry: new Map(),
		scatterInstances: null,
		scatterInstancesBuilt: false,
		fallbackTexture: createFallbackTexture(gl),
		loggedScatterSubmission: false,
		debugLineShader: null,
		debugLineBuffer: null,
	};

	levelRendererCache.set(rootId, renderer);
	return renderer;
}

function syncCanvasSize(renderer) {
	const canvas = renderer.canvas;
	const width = Math.max(1, canvas.clientWidth || canvas.offsetWidth || window.innerWidth || 1);
	const height = Math.max(1, canvas.clientHeight || canvas.offsetHeight || window.innerHeight || 1);
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
}

function collectRenderableMeshes(sceneGraph) {
	const terrain = sceneGraph.terrain;
	const obstacles = sceneGraph.obstacles;
	const triggers = sceneGraph.triggers;
	const showTriggers = !!(sceneGraph.debug.showTriggerVolumes === true);
	const entities = sceneGraph.entities;
	const entityMeshes = [];

	entities.forEach((entity) => {
		if (entity.model && Array.isArray(entity.model.parts)) {
			entity.model.parts.forEach((part) => {
				if (part.mesh) {
					entityMeshes.push(part.mesh);
				}
			});
			return;
		}

		if (entity.mesh) {
			entityMeshes.push(entity.mesh);
		}
	});

	const triggerMeshes = showTriggers ? triggers : [];
	// Scatter is excluded — rendered via instanced path.
	return terrain.concat(obstacles, triggerMeshes, entityMeshes);
}

function resolveWaterVisualMeshes(sceneGraph) {
	const waterVisual = sceneGraph.waterVisual;
	if (!waterVisual) {
		return [];
	}

	const meshes = [];
	if (waterVisual.body && waterVisual.body.geometry) {
		meshes.push(waterVisual.body);
	}
	if (waterVisual.top && waterVisual.top.geometry) {
		meshes.push(waterVisual.top);
	}

	return meshes;
}

function drawWaterPass(renderer, sceneGraph, projection, view, fogDensity, farValue, colorShift, underwaterValue) {
	const waterMeshes = resolveWaterVisualMeshes(sceneGraph);
	if (waterMeshes.length === 0) {
		return;
	}

	const gl = renderer.gl;
	const shader = renderer.shader;
	gl.useProgram(shader.program);
	gl.uniformMatrix4fv(shader.uniforms.projection, false, new Float32Array(projection));
	gl.uniformMatrix4fv(shader.uniforms.view, false, new Float32Array(view));
	gl.uniform1f(shader.uniforms.fogDensity, fogDensity);
	gl.uniform1f(shader.uniforms.far, farValue);
	gl.uniform3f(shader.uniforms.colorShift, colorShift.r, colorShift.g, colorShift.b);
	gl.uniform1f(shader.uniforms.underwater, underwaterValue);

	gl.depthMask(false);
	for (let index = 0; index < waterMeshes.length; index += 1) {
		const mesh = waterMeshes[index];
		const meshBufferKey = getMeshBufferKey(mesh);
		if (!meshBufferKey) {
			continue;
		}

		let meshBuffer = renderer.meshBuffers.get(meshBufferKey);
		if (!meshBuffer) {
			meshBuffer = createMeshBuffers(gl, mesh, shader);
			if (!meshBuffer) {
				continue;
			}
			renderer.meshBuffers.set(meshBufferKey, meshBuffer);
		}

		const model = CreateWorldUnitModelMatrix(mesh.transform);
		const color = mesh.material && mesh.material.color
			? mesh.material.color
			: { r: 0.25, g: 0.5, b: 0.75, a: 1 };
		const opacity = mesh.material && typeof mesh.material.opacity === "number"
			? mesh.material.opacity
			: (typeof color.a === "number" ? color.a : 0.2);
		const texture = renderer.fallbackTexture;

		gl.bindVertexArray(meshBuffer.vao);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.uniform1i(shader.uniforms.texture, 0);
		gl.uniformMatrix4fv(shader.uniforms.model, false, new Float32Array(model));
		gl.uniform4f(shader.uniforms.tint, color.r, color.g, color.b, opacity);
		gl.drawElements(gl.TRIANGLES, meshBuffer.indexCount, gl.UNSIGNED_SHORT, 0);
		gl.bindVertexArray(null);
	}
	gl.depthMask(true);
}

function drawScene(renderer, sceneGraph) {
	const gl = renderer.gl;
	const shader = renderer.shader;

	syncCanvasSize(renderer);
	gl.viewport(0, 0, renderer.canvas.width, renderer.canvas.height);
	gl.enable(gl.DEPTH_TEST);
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	gl.clearColor(0.04, 0.05, 0.08, 1);
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

	const cameraState = sceneGraph.cameraConfig.state;

	// Camera is already in world-unit space from Camera.js.
	const camPos = cameraState.position;
	const camTarget = cameraState.target;
	const camNear = cameraState.near.value;
	const camFar = cameraState.far.value;

	const projection = createPerspectiveMatrix(
		cameraState.fov || 60,
		renderer.canvas.width / renderer.canvas.height,
		camNear,
		camFar
	);
	const view = createLookAtMatrix(
		camPos,
		camTarget,
		cameraState.up || { x: 0, y: 1, z: 0 }
	);

	const waterLevelWorldUnits = sceneGraph.world.waterLevel ? sceneGraph.world.waterLevel.toWorldUnit() : null;
	const underwater = waterLevelWorldUnits !== null && cameraState.position.y < waterLevelWorldUnits;
	const fogDensity = underwater ? 0.85 : 0.2;
	const colorShift = underwater ? { r: -0.06, g: 0.02, b: 0.08 } : { r: 0, g: 0, b: 0 };
	const farValue = camFar;
	const underwaterValue = underwater ? 1 : 0;

	if (
		underwater &&
		sceneGraph.effects.underwater &&
		typeof sceneGraph.effects.underwater.particleHook === "function"
	) {
		sceneGraph.effects.underwater.particleHook(cameraState, sceneGraph);
	}

	// === PASS A: Non-scatter meshes (terrain, obstacles, triggers, entities) ===
	gl.useProgram(shader.program);
	gl.uniformMatrix4fv(shader.uniforms.projection, false, new Float32Array(projection));
	gl.uniformMatrix4fv(shader.uniforms.view, false, new Float32Array(view));
	gl.uniform1f(shader.uniforms.fogDensity, fogDensity);
	gl.uniform1f(shader.uniforms.far, farValue);
	gl.uniform3f(shader.uniforms.colorShift, colorShift.r, colorShift.g, colorShift.b);
	gl.uniform1f(shader.uniforms.underwater, underwaterValue);

	const meshes = collectRenderableMeshes(sceneGraph);
	for (let index = 0; index < meshes.length; index += 1) {
		const mesh = meshes[index];
		const isTriggerMesh = mesh && mesh.role === "trigger";
		const meshBufferKey = getMeshBufferKey(mesh);
		if (!meshBufferKey) {
			continue;
		}

		let meshBuffer = renderer.meshBuffers.get(meshBufferKey);
		if (!meshBuffer) {
			meshBuffer = createMeshBuffers(gl, mesh, shader);
			if (!meshBuffer) {
				continue;
			}
			renderer.meshBuffers.set(meshBufferKey, meshBuffer);
		}

		const model = CreateWorldUnitModelMatrix(mesh.transform);
		const color = mesh.material && mesh.material.color
			? mesh.material.color
			: { r: 0.8, g: 0.8, b: 0.8, a: 1 };
		const opacity = mesh.material && typeof mesh.material.opacity === "number"
			? mesh.material.opacity
			: (typeof color.a === "number" ? color.a : 1);
		const textureID = mesh.material && mesh.material.textureID ? mesh.material.textureID : "default-grid";
		const texture = ensureSceneTexture(renderer, sceneGraph, textureID) || renderer.fallbackTexture;

		gl.bindVertexArray(meshBuffer.vao);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.uniform1i(shader.uniforms.texture, 0);
		gl.uniformMatrix4fv(shader.uniforms.model, false, new Float32Array(model));
		gl.uniform4f(shader.uniforms.tint, color.r, color.g, color.b, opacity);
		if (isTriggerMesh) {
			gl.depthMask(false);
		}
		gl.drawElements(gl.TRIANGLES, meshBuffer.indexCount, gl.UNSIGNED_SHORT, 0);
		if (isTriggerMesh) {
			gl.depthMask(true);
		}
		gl.bindVertexArray(null);
	}

	// === PASS B: Instanced scatter rendering ===
	if (!renderer.scatterInstancesBuilt) {
		buildScatterInstanceBuffers(renderer, sceneGraph);
	}

	if (renderer.scatterInstances && renderer.scatterInstances.length > 0) {
		const scatterShader = renderer.scatterShader;
		gl.useProgram(scatterShader.program);
		gl.uniformMatrix4fv(scatterShader.uniforms.projection, false, new Float32Array(projection));
		gl.uniformMatrix4fv(scatterShader.uniforms.view, false, new Float32Array(view));
		gl.uniform1f(scatterShader.uniforms.fogDensity, fogDensity);
		gl.uniform1f(scatterShader.uniforms.far, farValue);
		gl.uniform3f(scatterShader.uniforms.colorShift, colorShift.r, colorShift.g, colorShift.b);
		gl.uniform1f(scatterShader.uniforms.underwater, underwaterValue);

		for (let batchIndex = 0; batchIndex < renderer.scatterInstances.length; batchIndex += 1) {
			const batch = renderer.scatterInstances[batchIndex];
			const texture = ensureSceneTexture(renderer, sceneGraph, batch.textureID) || renderer.fallbackTexture;

			gl.bindVertexArray(batch.vao);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.uniform1i(scatterShader.uniforms.texture, 0);
			gl.drawElementsInstanced(gl.TRIANGLES, batch.indexCount, gl.UNSIGNED_SHORT, 0, batch.instanceCount);
			gl.bindVertexArray(null);
		}
	}

	// === PASS C: Water overlay (translucent; top brighter than body) ===
	drawWaterPass(renderer, sceneGraph, projection, view, fogDensity, farValue, colorShift, underwaterValue);

	drawBoundingBoxes(renderer, sceneGraph, projection, view);
	drawGridOverlay(renderer, sceneGraph, projection, view);
	drawVelocityTrails(renderer, sceneGraph, projection, view);
}

function RenderLevel(sceneGraph, options) {
	const resolvedOptions = options && typeof options === "object" ? options : {};
	const rootId = resolvedOptions.rootId || "engine-level-root";
	const renderer = ensureLevelRenderer(rootId, resolvedOptions.rootStyles);
	if (!renderer) {
		return;
	}

	drawScene(renderer, sceneGraph);
}

/* === ELEMENTS === */
// Utility helpers for updating rendered elements.

function GetElement(elementId) {
	return UIElement.get(elementId).element;
}

function SetElementText(elementId, text) {
	UIElement.get(elementId).setText(text);
}

function SetElementSource(elementId, src) {
	UIElement.get(elementId).setSource(src);
}

function SetElementStyle(elementId, styles) {
	UIElement.get(elementId).setStyle(styles);
}

function FadeElement(elementId, targetOpacity, durationSeconds) {
	return UIElement.get(elementId).fadeTo(targetOpacity, durationSeconds);
}

function RemoveRoot(rootId) {
	UIElement.removeRoot(rootId);
}

/* === EXPORTS === */
// Public render helpers for engine modules.

export {
	RenderPayload,
	RenderLevel,
	GetElement,
	SetElementText,
	SetElementSource,
	SetElementStyle,
	FadeElement,
	RemoveRoot,
};