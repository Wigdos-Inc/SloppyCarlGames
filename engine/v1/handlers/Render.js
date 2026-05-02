// Renderer and displayer of all visual elements.

// End of any visual pipeline to display contents to Game (document.body)

/* === IMPORTS === */
// UI element builder.

import { UIElement } from "../builder/NewUI.js";
import { CONFIG } from "../core/config.js";
import { Log } from "../core/meta.js";
import { CreateIdentityMatrix, CreateModelMatrix } from "../math/Matrix.js";
import {
	AddVector3,
	CrossVector3,
	DotVector3,
	ResolveVector3Axis,
	ScaleVector3,
	SubtractVector3,
	Vector3Sq,
} from "../math/Vector3.js";
import { CNUtoWorldUnit } from "../math/Utilities.js";

/* === INTERNALS === */
// DOM helpers for rendering payloads.

function ensureRoot(rootId, rootStyles) {
	let root = document.getElementById(rootId);
	if (!root) {
		root = document.createElement("div");
		root.id = rootId;
		root.style.userSelect = "none";
		root.style.webkitUserSelect = "none";
		root.style.msUserSelect = "none";
		document.body.appendChild(root);
	}

	// Apply root styles when provided (rootStyles normalized by upstream validation).
	Object.assign(root.style, rootStyles);

	return root;
}


/* === PAYLOADS === */
// Renders payloads built by the UI builder.

function RenderPayload(payload) {
	const root = ensureRoot(payload.rootId, payload.rootStyles);
	if (payload.replace !== false) root.innerHTML = "";      // Replace existing contents by default.
	root.appendChild(payload.elements);                      // Append pre-built elements when provided.
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

const detailedBoundsTypeColors = {
	Terrain: { r: 1, g: 0.75, b: 0.15, a: 1 },
	Obstacle: { r: 1, g: 0.35, b: 0.35, a: 1 },
	Entity: { r: 0.15, g: 0.95, b: 0.95, a: 1 },
	Player: { r: 0.85, g: 0.95, b: 1, a: 1 },
	Boss: { r: 1, g: 0.35, b: 0.85, a: 1 },
};

function createPerspectiveMatrix(fovDegrees, aspect, near, far) {
	const fov = (fovDegrees * Math.PI) / 180;
	const f = 1 / Math.tan(fov / 2);
	const nf = 1 / (near - far);

	return [
		f / aspect, 0, 0, 0,
		0, f, 0, 0,
		0, 0, (far + near) * nf, -1,
		0, 0, (2 * far * near) * nf, 0,
	];
}

function createLookAtMatrix(eye, target, up) {
	const zAxis = ResolveVector3Axis(SubtractVector3(eye, target));
	const xAxis = ResolveVector3Axis(CrossVector3(up, zAxis));
	const yAxis = CrossVector3(zAxis, xAxis);

	return [
		xAxis.x, yAxis.x, zAxis.x, 0,
		xAxis.y, yAxis.y, zAxis.y, 0,
		xAxis.z, yAxis.z, zAxis.z, 0,
		-DotVector3(xAxis, eye), -DotVector3(yAxis, eye), -DotVector3(zAxis, eye), 1,
	];
}

function createShader(gl, type, source) {
	const shader = gl.createShader(type);
	if (!shader) {
		Log("ENGINE", `Shader creation failed (type ${type})`, "error", "Render");
		return null;
	}
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		Log("ENGINE", `Shader compile error: ${gl.getShaderInfoLog(shader)}`, "error", "Render");
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

function resolveProgramLocations(gl, program, names, resolver) {
	const locations = {};
	for (const key in names) locations[key] = resolver(names[key]);
	return locations;
}

function createLinkedProgram(gl, options) {
	const vertex = createShader(gl, gl.VERTEX_SHADER, options.vertexShaderSource);
	const fragment = createShader(gl, gl.FRAGMENT_SHADER, options.fragmentShaderSource);
	if (!vertex || !fragment) return null;

	const program = gl.createProgram();
	if (!program) {
		if (options.createError) Log("ENGINE", options.createError, "error", "Render");
		return null;
	}

	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		if (options.linkErrorPrefix) {
			Log("ENGINE", `${options.linkErrorPrefix}: ${gl.getProgramInfoLog(program)}`, "error", "Render");
		}
		gl.deleteProgram(program);
		return null;
	}

	return {
		program,
		attributes: resolveProgramLocations(
			gl,
			program,
			options.attributeNames || {},
			(name) => gl.getAttribLocation(program, name)
		),
		uniforms: resolveProgramLocations(
			gl,
			program,
			options.uniformNames,
			(name) => gl.getUniformLocation(program, name)
		),
	};
}

function createFoggedTextureFragmentShader(sharedDeclarations, shadedExpression) {
	return `#version 300 es
		precision highp float;
		uniform sampler2D u_texture;
		uniform float u_fogDensity;
		uniform float u_far;
		uniform vec3 u_colorShift;
		uniform float u_underwater;
		${sharedDeclarations}
		in vec2 v_uv;
		in float v_depth;
		out vec4 fragColor;
		void main() {
			vec4 texel = texture(u_texture, v_uv);
			vec4 shaded = ${shadedExpression};
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

	return createLinkedProgram(gl, {
		vertexShaderSource: vertexShaderSource,
		fragmentShaderSource: createFoggedTextureFragmentShader(
			"uniform vec4 u_tint;",
			"vec4(texel.rgb * u_tint.rgb, texel.a * u_tint.a)"
		),
		attributeNames: {
			position: "a_position",
			uv      : "a_uv",
		},
		uniformNames: {
			projection: "u_projection",
			view      : "u_view",
			model     : "u_model",
			texture   : "u_texture",
			tint      : "u_tint",
			fogDensity: "u_fogDensity",
			far       : "u_far",
			colorShift: "u_colorShift",
			underwater: "u_underwater",
		},
		createError    : "WebGL program creation failed",
		linkErrorPrefix: "Program link error",
	});
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

	return createLinkedProgram(gl, {
		vertexShaderSource: vertexShaderSource,
		fragmentShaderSource: fragmentShaderSource,
		attributeNames: {
			position: "a_position",
		},
		uniformNames: {
			projection: "u_projection",
			view      : "u_view",
			model     : "u_model",
			color     : "u_color",
		},
	});
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

	return createLinkedProgram(gl, {
		vertexShaderSource: vertexShaderSource,
		fragmentShaderSource: createFoggedTextureFragmentShader(
			"in vec4 v_tint;",
			"vec4(texel.rgb * v_tint.rgb, texel.a * v_tint.a)"
		),
		uniformNames: {
			projection: "u_projection",
			view      : "u_view",
			texture   : "u_texture",
			fogDensity: "u_fogDensity",
			far       : "u_far",
			colorShift: "u_colorShift",
			underwater: "u_underwater",
		},
		linkErrorPrefix: "Scatter shader link error",
	});
}

/* === GEOMETRY REGISTRY === */
// Shared geometry pool: one set of GPU buffers per unique (primitive, dimensions) combo.

function ensureSharedGeometry(renderer, sceneGraph, primitiveKey) {
	if (renderer.geometryRegistry.has(primitiveKey)) return renderer.geometryRegistry.get(primitiveKey);

	const gl = renderer.gl;
	const geometry = sceneGraph.visualResources.primitiveGeometry[primitiveKey];

	const positionBuffer = gl.createBuffer();
	const uvBuffer = gl.createBuffer();
	const indexBuffer = gl.createBuffer();
	if (!positionBuffer || !uvBuffer || !indexBuffer) return null;

	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.positions), gl.STATIC_DRAW);

	gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.uvs), gl.STATIC_DRAW);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geometry.indices), gl.STATIC_DRAW);

	const entry = {
		positionBuffer: positionBuffer,
		uvBuffer: uvBuffer,
		indexBuffer: indexBuffer,
		indexCount: geometry.indices.length,
	};

	renderer.geometryRegistry.set(primitiveKey, entry);
	return entry;
}

/* === SCATTER INSTANCE BUFFERS === */
// Builds per-batch VAOs and instance buffers from scatterBatches on the sceneGraph.

function buildScatterInstanceBuffers(renderer, sceneGraph) {
	const batches = sceneGraph.scatterBatches;
	if (batches.size === 0) {
		renderer.scatterInstances = [];
		renderer.scatterInstancesBuilt = true;
		return;
	}

	const gl = renderer.gl;
	const results = [];
	let totalInstances = 0;

	batches.forEach((batch, batchKey) => {
		if (batch.instanceCount === 0) return;

		const geo = ensureSharedGeometry(renderer, sceneGraph, batch.primitiveKey);
		if (!geo) return;

		const instanceCount = batch.instanceCount;
		const instanceData = batch.instanceData;

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
	return !!(CONFIG.DEBUG.ALL && CONFIG.DEBUG.LEVELS.BoundingBox[type]);
}
function isGridDebugEnabled() {
	return !!(CONFIG.DEBUG.ALL && CONFIG.DEBUG.LEVELS.BoundingBox.Grid.Visible);
}

function isDetailedBoundsDebugEnabled(type) {
	return !!(CONFIG.DEBUG.ALL && CONFIG.DEBUG.LEVELS.DetailedBounds[type]);
}

function bindDebugLinePass(renderer, gl, projection, view) {
	const shader = renderer.debugLineShader;
	gl.useProgram(shader.program);
	gl.uniformMatrix4fv(shader.uniforms.projection, false, new Float32Array(projection));
	gl.uniformMatrix4fv(shader.uniforms.view, false, new Float32Array(view));
	gl.uniformMatrix4fv(shader.uniforms.model, false, new Float32Array(CreateIdentityMatrix()));
	gl.bindBuffer(gl.ARRAY_BUFFER, renderer.debugLineBuffer);
	gl.enableVertexAttribArray(shader.attributes.position);
	gl.vertexAttribPointer(shader.attributes.position, 3, gl.FLOAT, false, 0, 0);
}

function buildBoxWireframe(p000, p001, p010, p011, p100, p101, p110, p111) {
	return new Float32Array([
		...p000, ...p001, ...p001, ...p011, ...p011, ...p010, ...p010, ...p000,
		...p100, ...p101, ...p101, ...p111, ...p111, ...p110, ...p110, ...p100,
		...p000, ...p100, ...p001, ...p101, ...p010, ...p110, ...p011, ...p111,
	]);
}

function createMinMaxBoxLineVertices(bounds) {
	const min = bounds.min.toWorldUnit();
	const max = bounds.max.toWorldUnit();
	return buildBoxWireframe(
		[min.x, min.y, min.z], [min.x, min.y, max.z],
		[min.x, max.y, min.z], [min.x, max.y, max.z],
		[max.x, min.y, min.z], [max.x, min.y, max.z],
		[max.x, max.y, min.z], [max.x, max.y, max.z]
	);
}

function createGridLineVertices(bounds, spacing) {
	const wMin = bounds.min.toWorldUnit();
	const wMax = bounds.max.toWorldUnit();
	const step = CNUtoWorldUnit(spacing);

	const lines = [];

	// --- Top face (Y = maxY) ---
	for (let x = wMin.x; x <= wMax.x + step * 0.001; x += step) lines.push(x, wMax.y, wMin.z, x, wMax.y, wMax.z);
	for (let z = wMin.z; z <= wMax.z + step * 0.001; z += step) lines.push(wMin.x, wMax.y, z, wMax.x, wMax.y, z);

	// --- Bottom face (Y = minY) ---
	for (let x = wMin.x; x <= wMax.x + step * 0.001; x += step) lines.push(x, wMin.y, wMin.z, x, wMin.y, wMax.z);
	for (let z = wMin.z; z <= wMax.z + step * 0.001; z += step) lines.push(wMin.x, wMin.y, z, wMax.x, wMin.y, z);

	// --- Front face (Z = maxZ) ---
	for (let x = wMin.x; x <= wMax.x + step * 0.001; x += step) lines.push(x, wMin.y, wMax.z, x, wMax.y, wMax.z);
	for (let y = wMin.y; y <= wMax.y + step * 0.001; y += step) lines.push(wMin.x, y, wMax.z, wMax.x, y, wMax.z);

	// --- Back face (Z = minZ) ---
	for (let x = wMin.x; x <= wMax.x + step * 0.001; x += step) lines.push(x, wMin.y, wMin.z, x, wMax.y, wMin.z);
	for (let y = wMin.y; y <= wMax.y + step * 0.001; y += step) lines.push(wMin.x, y, wMin.z, wMax.x, y, wMin.z);

	// --- Right face (X = maxX) ---
	for (let z = wMin.z; z <= wMax.z + step * 0.001; z += step) lines.push(wMax.x, wMin.y, z, wMax.x, wMax.y, z);
	for (let y = wMin.y; y <= wMax.y + step * 0.001; y += step) lines.push(wMax.x, y, wMin.z, wMax.x, y, wMax.z);

	// --- Left face (X = minX) ---
	for (let z = wMin.z; z <= wMax.z + step * 0.001; z += step) lines.push(wMin.x, wMin.y, z, wMin.x, wMax.y, z);
	for (let y = wMin.y; y <= wMax.y + step * 0.001; y += step) lines.push(wMin.x, y, wMin.z, wMin.x, y, wMax.z);

	if (lines.length === 0) return null;
	return new Float32Array(lines);
}

function drawBoundingBoxes(renderer, sceneGraph, projection, view) {
	const records = sceneGraph.debugBoundingBoxes;
	if (records.length === 0) return;

	const gl = renderer.gl;
	if (!renderer.debugLineShader) renderer.debugLineShader = createLineProgram(gl);
	if (!renderer.debugLineShader) return;
	if (!renderer.debugLineBuffer) renderer.debugLineBuffer = gl.createBuffer();
	if (!renderer.debugLineBuffer) return;

	bindDebugLinePass(renderer, gl, projection, view);

	records.forEach((record) => {
		if (!isBoundingBoxDebugEnabled(record.type)) return;

		const vertices = createMinMaxBoxLineVertices(record);
		if (!vertices) return;

		const color = boundingBoxTypeColors[record.type];
		gl.uniform4f(renderer.debugLineShader.uniforms.color, color.r, color.g, color.b, color.a);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
		gl.drawArrays(gl.LINES, 0, vertices.length / 3);
	});
}

function drawGridOverlay(renderer, sceneGraph, projection, view) {
	if (!isGridDebugEnabled()) return;

	const records = sceneGraph.debugBoundingBoxes;
	if (records.length === 0) return;

	const gl = renderer.gl;
	if (!renderer.debugLineShader || !renderer.debugLineBuffer) return;

	const gridConfig = CONFIG.DEBUG.LEVELS.BoundingBox.Grid;
	const spacing = gridConfig.Scale;

	bindDebugLinePass(renderer, gl, projection, view);
	const shader = renderer.debugLineShader;
	gl.uniform4f(shader.uniforms.color, 0.5, 0.5, 0.5, 0.6);

	records.forEach((record) => {
		if (!isBoundingBoxDebugEnabled(record.type)) return;

		const vertices = createGridLineVertices(record, spacing);
		if (!vertices) return;

		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
		gl.drawArrays(gl.LINES, 0, vertices.length / 3);
	});
}

function createObbLineVertices(bounds) {
	const center = bounds.center.toWorldUnit();
	const half = bounds.halfExtents.toWorldUnit();
	const axisX = bounds.axes[0];
	const axisY = bounds.axes[1];
	const axisZ = bounds.axes[2];

	const sx = ScaleVector3(axisX, half.x);
	const sy = ScaleVector3(axisY, half.y);
	const sz = ScaleVector3(axisZ, half.z);

	const add = (base, dx, dy, dz) => {
		const vector = AddVector3(AddVector3(AddVector3(base, dx), dy), dz);
		return [vector.x, vector.y, vector.z];
	}

	const p000 = add(center, ScaleVector3(sx, -1), ScaleVector3(sy, -1), ScaleVector3(sz, -1));
	const p001 = add(center, ScaleVector3(sx, -1), ScaleVector3(sy, -1), sz);
	const p010 = add(center, ScaleVector3(sx, -1), sy, ScaleVector3(sz, -1));
	const p011 = add(center, ScaleVector3(sx, -1), sy, sz);
	const p100 = add(center, sx, ScaleVector3(sy, -1), ScaleVector3(sz, -1));
	const p101 = add(center, sx, ScaleVector3(sy, -1), sz);
	const p110 = add(center, sx, sy, ScaleVector3(sz, -1));
	const p111 = add(center, sx, sy, sz);

	return buildBoxWireframe(p000, p001, p010, p011, p100, p101, p110, p111);
}

function createCapsuleLineVertices(bounds, longitudinalSegments = 8) {
	const start = bounds.segmentStart.toWorldUnit();
	const end = bounds.segmentEnd.toWorldUnit();
	const radius = bounds.radius.toWorldUnit();
	const lines = [];
	const ringOffset = radius * Math.SQRT1_2;
	const ringRadius = radius * Math.SQRT1_2;
	const bottomPole = [start.x, start.y - radius, start.z];
	const topPole = [end.x, end.y + radius, end.z];

	for (let i = 0; i < longitudinalSegments; i++) {
		const t0 = (i / longitudinalSegments) * Math.PI * 2;
		const t1 = ((i + 1) / longitudinalSegments) * Math.PI * 2;
		const c0 = Math.cos(t0);
		const s0 = Math.sin(t0);
		const c1 = Math.cos(t1);
		const s1 = Math.sin(t1);
		const bottomBase = [start.x + c0 * radius, start.y, start.z + s0 * radius];
		const topBase = [end.x + c0 * radius, end.y, end.z + s0 * radius];
		const bottomMid = [start.x + c0 * ringRadius, start.y - ringOffset, start.z + s0 * ringRadius];
		const topMid = [end.x + c0 * ringRadius, end.y + ringOffset, end.z + s0 * ringRadius];
		const bottomMidNext = [start.x + c1 * ringRadius, start.y - ringOffset, start.z + s1 * ringRadius];
		const topMidNext = [end.x + c1 * ringRadius, end.y + ringOffset, end.z + s1 * ringRadius];

		lines.push(...bottomBase, ...topBase);
		lines.push(...bottomBase, start.x + c1 * radius, start.y, start.z + s1 * radius);
		lines.push(...topBase, end.x + c1 * radius, end.y, end.z + s1 * radius);
		lines.push(...bottomBase, ...bottomMid);
		lines.push(...bottomMid, ...bottomPole);
		lines.push(...topBase, ...topMid);
		lines.push(...topMid, ...topPole);
		lines.push(...bottomMid, ...bottomMidNext);
		lines.push(...topMid, ...topMidNext);
	}

	return new Float32Array(lines);
}

function createSphereLineVertices(bounds, radialSegments = 16) {
	const center = bounds.center.toWorldUnit();
	const r = bounds.radius.toWorldUnit();
	const lines = [];

	// Three orthogonal circle rings (XY, XZ, YZ planes).
	for (let i = 0; i < radialSegments; i++) {
		const t0 = (i / radialSegments) * Math.PI * 2;
		const t1 = ((i + 1) / radialSegments) * Math.PI * 2;
		const c0 = Math.cos(t0), s0 = Math.sin(t0);
		const c1 = Math.cos(t1), s1 = Math.sin(t1);

		// XZ ring (horizontal).
		lines.push(center.x + c0 * r, center.y, center.z + s0 * r, center.x + c1 * r, center.y, center.z + s1 * r);
		// XY ring (front).
		lines.push(center.x + c0 * r, center.y + s0 * r, center.z, center.x + c1 * r, center.y + s1 * r, center.z);
		// YZ ring (side).
		lines.push(center.x, center.y + c0 * r, center.z + s0 * r, center.x, center.y + c1 * r, center.z + s1 * r);
	}

	return new Float32Array(lines);
}

function createTriangleSoupLineVertices(bounds) {
	const lines = [];
	bounds.triangles.forEach((triangle) => {
		const a = triangle.a.toWorldUnit();
		const b = triangle.b.toWorldUnit();
		const c = triangle.c.toWorldUnit();
		lines.push(
			a.x, a.y, a.z, b.x, b.y, b.z,
			b.x, b.y, b.z, c.x, c.y, c.z,
			c.x, c.y, c.z, a.x, a.y, a.z
		);
	});
	return new Float32Array(lines);
}

function drawDetailedBoundsShape(gl, shader, bounds) {
	let vertices = null;
	switch(bounds.type) {
		case "capsule"      : vertices = createCapsuleLineVertices(bounds);      break;
		case "obb"          : vertices = createObbLineVertices(bounds);          break;
		case "sphere"       : vertices = createSphereLineVertices(bounds);       break;
		case "aabb"         : vertices = createMinMaxBoxLineVertices(bounds);     break;
		case "triangle-soup": vertices = createTriangleSoupLineVertices(bounds); break;
		case "compound"     :
			bounds.parts.forEach((part) => drawDetailedBoundsShape(gl, shader, part));
			return;
		case "compound-sphere":
			bounds.spheres.forEach((sphere) => drawDetailedBoundsShape(gl, shader, sphere));
			return;
		default: return;
	}

	gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
	gl.drawArrays(gl.LINES, 0, vertices.length / 3);
}

function drawDetailedBounds(renderer, sceneGraph, projection, view) {
	const records = sceneGraph.debug.detailedBounds;
	if (records.length === 0) return;

	const gl = renderer.gl;
	if (!renderer.debugLineShader) renderer.debugLineShader = createLineProgram(gl);
	if (!renderer.debugLineShader) return;
	if (!renderer.debugLineBuffer) renderer.debugLineBuffer = gl.createBuffer();
	if (!renderer.debugLineBuffer) return;

	bindDebugLinePass(renderer, gl, projection, view);
	const shader = renderer.debugLineShader;

	records.forEach((record) => {
		if (!isDetailedBoundsDebugEnabled(record.type)) return;

		const color = detailedBoundsTypeColors[record.type];
		gl.uniform4f(shader.uniforms.color, color.r, color.g, color.b, color.a);
		drawDetailedBoundsShape(gl, shader, record.bounds);
	});
}

const trailTypeColors = {
	Player: { r: 0, g: 1, b: 1, a: 1 },
	Boss: { r: 1, g: 0.2, b: 0.9, a: 1 },
	Enemies: { r: 1, g: 0.6, b: 0.2, a: 1 },
	Collectible: { r: 0.2, g: 1, b: 0.4, a: 1 },
	Projectile: { r: 1, g: 1, b: 0.2, a: 1 },
};

function isTrailDebugEnabled(type) {
	return !!(CONFIG.DEBUG.ALL && CONFIG.DEBUG.LEVELS.Trails[type]);
}

function classifyEntityTrailType(entity) {
	const type = entity.type;
	if (type.includes("player")) { return "Player"; }
	if (type.includes("boss")) { return "Boss"; }
	if (type.includes("collectible")) { return "Collectible"; }
	if (type.includes("projectile")) { return "Projectile"; }
	return "Enemies";
}

function drawVelocityTrails(renderer, sceneGraph, projection, view) {
	if (!CONFIG.DEBUG.ALL) return;
	const trailMap = CONFIG.DEBUG.LEVELS.Trails;
	
	// Quick check: any trail flag enabled?
	const anyEnabled = Object.values(trailMap).some(Boolean);
	if (!anyEnabled) return;

	const entities = sceneGraph.entities;
	if (entities.length === 0) return;

	const gl = renderer.gl;
	if (!renderer.debugLineShader || !renderer.debugLineBuffer) return;

	bindDebugLinePass(renderer, gl, projection, view);
	const shader = renderer.debugLineShader;
	const trailScale = 0.15;

	for (let i = 0; i < entities.length; i++) {
		const entity = entities[i];

		const trailType = classifyEntityTrailType(entity);
		if (!isTrailDebugEnabled(trailType)) continue;

		const vel = entity.velocity;
		if (Vector3Sq(vel) < 0.01) continue;

		const pos = entity.transform.position;
		const end = AddVector3(pos, ScaleVector3(vel, trailScale));

		// Convert CNU positions to world units for rendering.
		const vertices = new Float32Array([
			CNUtoWorldUnit(pos.x), CNUtoWorldUnit(pos.y), CNUtoWorldUnit(pos.z),
			CNUtoWorldUnit(end.x), CNUtoWorldUnit(end.y), CNUtoWorldUnit(end.z),
		]);
		const color = trailTypeColors[trailType];

		gl.uniform4f(shader.uniforms.color, color.r, color.g, color.b, color.a);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
		gl.drawArrays(gl.LINES, 0, 2);
	}
}

function createMeshBuffers(gl, mesh, shader) {
	const geometry = mesh.geometry;

	const positionBuffer = gl.createBuffer();
	const uvBuffer = gl.createBuffer();
	const indexBuffer = gl.createBuffer();
	if (!positionBuffer || !uvBuffer || !indexBuffer) {
		Log("ENGINE", "WebGL buffer creation failed", "error", "Render");
		return null;
	}

	const vao = gl.createVertexArray();
	gl.bindVertexArray(vao);

	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.positions), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(shader.attributes.position);
	gl.vertexAttribPointer(shader.attributes.position, 3, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.uvs), gl.STATIC_DRAW);
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
	const dim = mesh.dimensions;
	return `${mesh.id}|${mesh.primitive}|${dim.x}|${dim.y}|${dim.z}|${mesh.complexity}`;
}

function createFallbackTexture(gl) {
	const texture = gl.createTexture();
	if (!texture) return null;
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
	const gl = renderer.gl;
	const entry = sceneGraph.visualResources.textureRegistry[textureID];

	if (renderer.textures.has(textureID)) {
		const cachedTexture = renderer.textures.get(textureID);
		if (entry.dirty === true) {
			gl.bindTexture(gl.TEXTURE_2D, cachedTexture);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.source);
			entry.dirty = false;
		}
		return cachedTexture;
	}

	const texture = gl.createTexture();
	if (!texture) return renderer.fallbackTexture;

	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.source);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	entry.dirty = false;

	renderer.textures.set(textureID, texture);
	return texture;
}

function ensureLevelRenderer(rootId, rootStyles) {
	const existing = levelRendererCache.get(rootId);
	if (existing) return existing;

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
	if (!shader) return null;

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
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
}

function collectRenderableMeshes(sceneGraph) {
	const terrain = sceneGraph.terrain;
	const obstacleRecords = sceneGraph.obstacles;
	const obstacleMeshes = [];
	const entities = sceneGraph.entities;
	const entityMeshes = [];

	obstacleRecords.forEach((record) => record.parts.forEach((part) => obstacleMeshes.push(part)));

	entities.forEach((entity) => {
		if (entity.model) {
			entity.model.parts.forEach((part) => entityMeshes.push(part.mesh));
			return;
		}
		entityMeshes.push(entity.mesh);
	});

	// Scatter and triggers are excluded — scatter via instanced path, triggers via post-scatter pass.
	return terrain.concat(obstacleMeshes, entityMeshes);
}

function resolveWaterVisualMeshes(sceneGraph) {
	const waterVisual = sceneGraph.waterVisual;
	if (!waterVisual) return [];

	return [waterVisual.body, waterVisual.top];
}

function configureTexturedMeshPass(gl, shader, passState) {
	gl.useProgram(shader.program);
	gl.uniformMatrix4fv(shader.uniforms.projection, false, new Float32Array(passState.projection));
	gl.uniformMatrix4fv(shader.uniforms.view, false, new Float32Array(passState.view));
	gl.uniform1f(shader.uniforms.fogDensity, passState.fogDensity);
	gl.uniform1f(shader.uniforms.far, passState.farValue);
	gl.uniform3f(shader.uniforms.colorShift, passState.colorShift.r, passState.colorShift.g, passState.colorShift.b);
	gl.uniform1f(shader.uniforms.underwater, passState.underwaterValue);
}

function ensureMeshBuffer(renderer, mesh, shader) {
	const meshBufferKey = getMeshBufferKey(mesh);

	let meshBuffer = renderer.meshBuffers.get(meshBufferKey);
	if (!meshBuffer) {
		meshBuffer = createMeshBuffers(renderer.gl, mesh, shader);
		if (!meshBuffer) return null;
		renderer.meshBuffers.set(meshBufferKey, meshBuffer);
	}

	return meshBuffer;
}

function drawMeshList(renderer, sceneGraph, meshes, passState, options = {}) {
	if (meshes.length === 0) return;

	const gl = renderer.gl;
	const shader = renderer.shader;
	const disableDepthWriteForPass = options.depthMask === false;
	const skipDepthWrite = options.skipDepthWrite || (() => false);

	configureTexturedMeshPass(gl, shader, passState);
	if (disableDepthWriteForPass) gl.depthMask(false);

	for (const mesh of meshes) {
		const meshBuffer = ensureMeshBuffer(renderer, mesh, shader);
		if (!meshBuffer) continue;

		const color = mesh.material.color;
		const texture = ensureSceneTexture(renderer, sceneGraph, mesh.material.textureID);
		const disableDepthWriteForMesh = disableDepthWriteForPass === false && skipDepthWrite(mesh) === true;

		gl.bindVertexArray(meshBuffer.vao);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.uniform1i(shader.uniforms.texture, 0);
		gl.uniformMatrix4fv(shader.uniforms.model, false, new Float32Array(CreateModelMatrix(mesh.transform)));
		gl.uniform4f(shader.uniforms.tint, color.r, color.g, color.b, mesh.material.opacity);
		if (disableDepthWriteForMesh) gl.depthMask(false);
		gl.drawElements(gl.TRIANGLES, meshBuffer.indexCount, gl.UNSIGNED_SHORT, 0);
		if (disableDepthWriteForMesh) gl.depthMask(true);
		gl.bindVertexArray(null);
	}

	if (disableDepthWriteForPass) gl.depthMask(true);
}

function drawWaterPass(renderer, sceneGraph, projection, view, fogDensity, farValue, colorShift, underwaterValue) {
	const waterMeshes = resolveWaterVisualMeshes(sceneGraph);
	drawMeshList(
		renderer,
		sceneGraph,
		waterMeshes,
		{ projection, view, fogDensity, farValue, colorShift, underwaterValue },
		{ depthMask: false }
	);
}

function drawScene(renderer, sceneGraph) {
	const gl = renderer.gl;

	syncCanvasSize(renderer);
	gl.viewport(0, 0, renderer.canvas.width, renderer.canvas.height);
	gl.enable(gl.DEPTH_TEST);
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	gl.clearColor(0.04, 0.05, 0.08, 1);
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

	const cameraState = sceneGraph.cameraConfig.state;

	const projection = createPerspectiveMatrix(
		cameraState.fov,
		renderer.canvas.width / renderer.canvas.height,
		cameraState.near.value,
		cameraState.far.value
	);
	const view = createLookAtMatrix(
		cameraState.position,
		cameraState.target,
		cameraState.up
	);

	const waterLevelWorldUnits = sceneGraph.world.waterLevel ? sceneGraph.world.waterLevel.toWorldUnit() : null;
	const underwater = waterLevelWorldUnits !== null && cameraState.position.y < waterLevelWorldUnits;
	const fogDensity = underwater ? 0.85 : 0.2;
	const colorShift = underwater ? { r: -0.06, g: 0.02, b: 0.08 } : { r: 0, g: 0, b: 0 };
	const farValue = cameraState.far.value;
	const underwaterValue = underwater ? 1 : 0;
	const passState = { projection, view, fogDensity, farValue, colorShift, underwaterValue };

	if (
		underwater &&
		sceneGraph.effects.underwater &&
		typeof sceneGraph.effects.underwater.particleHook === "function"
	) {
		sceneGraph.effects.underwater.particleHook(cameraState, sceneGraph);
	}

	// === PASS A: Non-scatter meshes (terrain, obstacles, triggers, entities) ===
	const meshes = collectRenderableMeshes(sceneGraph);
	drawMeshList(renderer, sceneGraph, meshes, passState);

	// === PASS B: Instanced scatter rendering ===
	if (!renderer.scatterInstancesBuilt) buildScatterInstanceBuffers(renderer, sceneGraph);

	if (renderer.scatterInstances.length > 0) {
		const scatterShader = renderer.scatterShader;
		gl.useProgram(scatterShader.program);
		gl.uniformMatrix4fv(scatterShader.uniforms.projection, false, new Float32Array(projection));
		gl.uniformMatrix4fv(scatterShader.uniforms.view, false, new Float32Array(view));
		gl.uniform1f(scatterShader.uniforms.fogDensity, fogDensity);
		gl.uniform1f(scatterShader.uniforms.far, farValue);
		gl.uniform3f(scatterShader.uniforms.colorShift, colorShift.r, colorShift.g, colorShift.b);
		gl.uniform1f(scatterShader.uniforms.underwater, underwaterValue);

		for (let batchIndex = 0; batchIndex < renderer.scatterInstances.length; batchIndex++) {
			const batch = renderer.scatterInstances[batchIndex];
			const texture = ensureSceneTexture(renderer, sceneGraph, batch.textureID);

			gl.bindVertexArray(batch.vao);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.uniform1i(scatterShader.uniforms.texture, 0);
			gl.drawElementsInstanced(gl.TRIANGLES, batch.indexCount, gl.UNSIGNED_SHORT, 0, batch.instanceCount);
			gl.bindVertexArray(null);
		}
	}

	// === PASS C: Trigger overlay (no depth write — color filter over all solid geometry) ===
	if (sceneGraph.debug.showTriggerVolumes) {
		drawMeshList(renderer, sceneGraph, sceneGraph.triggers, passState, { depthMask: false });
	}

	// === PASS D: Water overlay (translucent; top brighter than body) ===
	drawWaterPass(renderer, sceneGraph, projection, view, fogDensity, farValue, colorShift, underwaterValue);

	drawBoundingBoxes(renderer, sceneGraph, projection, view);
	drawGridOverlay(renderer, sceneGraph, projection, view);
	drawDetailedBounds(renderer, sceneGraph, projection, view);
	drawVelocityTrails(renderer, sceneGraph, projection, view);
}

function RenderLevel(sceneGraph, options) {
	const renderer = ensureLevelRenderer(options.rootId, options.rootStyles);
	if (!renderer) return;

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