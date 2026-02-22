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
	crossVector3,
	dotVector3,
	normalizeUnitVector3,
	subtractVector3,
} from "../math/Vector3.js";

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
	// Guard against invalid payloads.
	if (!payload || typeof payload !== "object") {
		return;
	}

	const rootId = payload.rootId || defaultUiRootId;
	const root = ensureRoot(rootId, payload.rootStyles);

	// Replace existing contents by default.
	if (payload.replace !== false) {
		root.innerHTML = "";
	}

	// Append pre-built elements when provided.
	const elements = payload.elements;
	if (elements && typeof elements === "object" && "nodeType" in elements) {
		root.appendChild(elements);
	}
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
	for (let row = 0; row < 4; row += 1) {
		for (let col = 0; col < 4; col += 1) {
			out[row * 4 + col] =
				a[row * 4 + 0] * b[0 * 4 + col] +
				a[row * 4 + 1] * b[1 * 4 + col] +
				a[row * 4 + 2] * b[2 * 4 + col] +
				a[row * 4 + 3] * b[3 * 4 + col];
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
	const zAxis = normalizeUnitVector3(subtractVector3(eye, target));
	const xAxis = normalizeUnitVector3(crossVector3(up, zAxis));
	const yAxis = crossVector3(zAxis, xAxis);

	return [
		xAxis.x, yAxis.x, zAxis.x, 0,
		xAxis.y, yAxis.y, zAxis.y, 0,
		xAxis.z, yAxis.z, zAxis.z, 0,
		-dotVector3(xAxis, eye), -dotVector3(yAxis, eye), -dotVector3(zAxis, eye), 1,
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

function createModelMatrix(transform) {
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
	const vertexShaderSource = `
		attribute vec3 a_position;
		attribute vec2 a_uv;
		uniform mat4 u_projection;
		uniform mat4 u_view;
		uniform mat4 u_model;
		varying vec2 v_uv;
		varying float v_depth;
		void main() {
			vec4 world = u_model * vec4(a_position, 1.0);
			vec4 viewPos = u_view * world;
			vec4 clip = u_projection * viewPos;
			gl_Position = clip;
			v_uv = a_uv;
			v_depth = abs(viewPos.z);
		}
	`;

	const fragmentShaderSource = `
		precision highp float;
		uniform sampler2D u_texture;
		uniform vec4 u_tint;
		uniform float u_fogDensity;
		uniform float u_far;
		uniform vec3 u_colorShift;
		uniform float u_underwater;
		varying vec2 v_uv;
		varying float v_depth;
		void main() {
			vec4 texel = texture2D(u_texture, v_uv);
			vec4 shaded = vec4(texel.rgb * u_tint.rgb, texel.a * u_tint.a);
			if (shaded.a <= 0.01) {
				discard;
			}

			float normalizedDepth = v_depth / max(1.0, u_far);
			float fog = clamp(normalizedDepth * u_fogDensity, 0.0, 1.0);
			vec3 shifted = shaded.rgb + u_colorShift;
			vec3 fogColor = mix(vec3(0.04, 0.05, 0.08), vec3(0.03, 0.13, 0.2), clamp(u_underwater, 0.0, 1.0));
			vec3 finalColor = mix(shifted, fogColor, fog);
			gl_FragColor = vec4(finalColor, shaded.a);
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
	const vertexShaderSource = `
		attribute vec3 a_position;
		uniform mat4 u_projection;
		uniform mat4 u_view;
		uniform mat4 u_model;
		void main() {
			gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
		}
	`;

	const fragmentShaderSource = `
		precision mediump float;
		uniform vec4 u_color;
		void main() {
			gl_FragColor = u_color;
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

function isBoundingBoxDebugEnabled(type) {
	if (!(CONFIG && CONFIG.DEBUG && CONFIG.DEBUG.ALL)) {
		return false;
	}

	const debugMap = CONFIG.DEBUG && CONFIG.DEBUG.LEVELS ? CONFIG.DEBUG.LEVELS.BoundingBox : null;
	return !!(debugMap && debugMap[type] === true);
}

function createBoundingBoxLineVertices(bounds) {
	if (!bounds || !bounds.min || !bounds.max) {
		return null;
	}

	const min = bounds.min;
	const max = bounds.max;
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

function drawBoundingBoxes(renderer, sceneGraph, projection, view) {
	const records = Array.isArray(sceneGraph && sceneGraph.debugBoundingBoxes)
		? sceneGraph.debugBoundingBoxes
		: [];
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

function createMeshBuffers(gl, mesh) {
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

	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.positions), gl.STATIC_DRAW);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geometry.indices), gl.STATIC_DRAW);

	const uvs = Array.isArray(geometry.uvs) && geometry.uvs.length / 2 === geometry.positions.length / 3
		? geometry.uvs
		: new Array((geometry.positions.length / 3) * 2).fill(0);
	gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);

	return {
		position: positionBuffer,
		uv: uvBuffer,
		index: indexBuffer,
		indexCount: geometry.indices.length,
	};
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
	const visualResources = sceneGraph && sceneGraph.visualResources ? sceneGraph.visualResources : null;
	const textureRegistry = visualResources && visualResources.textureRegistry ? visualResources.textureRegistry : null;
	const entry = textureRegistry && textureRegistry[id] ? textureRegistry[id] : null;

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

	const gl = canvas.getContext("webgl");
	if (!gl) {
		return null;
	}

	const shader = createProgram(gl);
	if (!shader) {
		return null;
	}

	const renderer = {
		rootId: rootId,
		root: root,
		canvas: canvas,
		gl: gl,
		shader: shader,
		meshBuffers: new Map(),
		textures: new Map(),
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
	const terrain = Array.isArray(sceneGraph && sceneGraph.terrain) ? sceneGraph.terrain : [];
	const obstacles = Array.isArray(sceneGraph && sceneGraph.obstacles)
		? sceneGraph.obstacles
			.map((obstacle) => (obstacle && obstacle.mesh ? obstacle.mesh : obstacle))
			.filter(Boolean)
		: [];
	const triggers = Array.isArray(sceneGraph && sceneGraph.triggers) ? sceneGraph.triggers : [];
	const scatter = Array.isArray(sceneGraph && sceneGraph.scatter) ? sceneGraph.scatter : [];
	const showTriggers = sceneGraph && sceneGraph.debug ? sceneGraph.debug.showTriggerVolumes === true : false;
	const entities = Array.isArray(sceneGraph && sceneGraph.entities) ? sceneGraph.entities : [];
	const entityMeshes = [];

	entities.forEach((entity) => {
		if (entity && entity.model && Array.isArray(entity.model.parts)) {
			entity.model.parts.forEach((part) => {
				if (part && part.mesh) {
					entityMeshes.push(part.mesh);
				}
			});
			return;
		}

		if (entity && entity.mesh) {
			entityMeshes.push(entity.mesh);
		}
	});

	const triggerMeshes = showTriggers ? triggers : [];
	return terrain.concat(obstacles, scatter, triggerMeshes, entityMeshes);
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

	const cameraState = sceneGraph && sceneGraph.cameraConfig && sceneGraph.cameraConfig.state
		? sceneGraph.cameraConfig.state
		: {
			position: { x: 0, y: 40, z: 80 },
			target: { x: 0, y: 0, z: 0 },
			up: { x: 0, y: 1, z: 0 },
			fov: 60,
			near: 0.1,
			far: 500,
		};

	const projection = createPerspectiveMatrix(
		cameraState.fov || 60,
		renderer.canvas.width / renderer.canvas.height,
		cameraState.near || 0.1,
		cameraState.far || 500
	);
	const view = createLookAtMatrix(
		cameraState.position,
		cameraState.target,
		cameraState.up || { x: 0, y: 1, z: 0 }
	);

	gl.useProgram(shader.program);
	gl.uniformMatrix4fv(shader.uniforms.projection, false, new Float32Array(projection));
	gl.uniformMatrix4fv(shader.uniforms.view, false, new Float32Array(view));

	const underwater = sceneGraph && sceneGraph.world
		? cameraState.position.y < (sceneGraph.world.waterLevel || -9999)
		: false;
	const fogDensity = underwater ? 0.85 : 0.2;
	const colorShift = underwater ? { r: -0.06, g: 0.02, b: 0.08 } : { r: 0, g: 0, b: 0 };
	gl.uniform1f(shader.uniforms.fogDensity, fogDensity);
	gl.uniform1f(shader.uniforms.far, cameraState.far || 500);
	gl.uniform3f(shader.uniforms.colorShift, colorShift.r, colorShift.g, colorShift.b);
	gl.uniform1f(shader.uniforms.underwater, underwater ? 1 : 0);

	if (
		underwater &&
		sceneGraph &&
		sceneGraph.effects &&
		sceneGraph.effects.underwater &&
		typeof sceneGraph.effects.underwater.particleHook === "function"
	) {
		sceneGraph.effects.underwater.particleHook(cameraState, sceneGraph);
	}

	const meshes = collectRenderableMeshes(sceneGraph);
	if (!renderer.loggedScatterSubmission) {
		const scatterSubmissionCount = meshes.filter((mesh) => mesh && mesh.role === "scatter").length;
		Log("ENGINE", `Scatter draw submission count: ${scatterSubmissionCount}`, "log", "Level");
		renderer.loggedScatterSubmission = true;
	}
	for (let index = 0; index < meshes.length; index += 1) {
		const mesh = meshes[index];
		if (!mesh || !mesh.id) {
			continue;
		}

		let meshBuffer = renderer.meshBuffers.get(mesh.id);
		if (!meshBuffer) {
			meshBuffer = createMeshBuffers(gl, mesh);
			if (!meshBuffer) {
				continue;
			}
			renderer.meshBuffers.set(mesh.id, meshBuffer);
		}

		const model = createModelMatrix(mesh.transform);
		const color = mesh.material && mesh.material.color
			? mesh.material.color
			: { r: 0.8, g: 0.8, b: 0.8, a: 1 };
		const opacity = mesh.material && typeof mesh.material.opacity === "number"
			? mesh.material.opacity
			: (typeof color.a === "number" ? color.a : 1);
		const textureID = mesh.material && mesh.material.textureID ? mesh.material.textureID : "default-grid";
		const texture = ensureSceneTexture(renderer, sceneGraph, textureID) || renderer.fallbackTexture;

		gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer.position);
		gl.enableVertexAttribArray(shader.attributes.position);
		gl.vertexAttribPointer(shader.attributes.position, 3, gl.FLOAT, false, 0, 0);

		gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer.uv);
		gl.enableVertexAttribArray(shader.attributes.uv);
		gl.vertexAttribPointer(shader.attributes.uv, 2, gl.FLOAT, false, 0, 0);

		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshBuffer.index);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.uniform1i(shader.uniforms.texture, 0);
		gl.uniformMatrix4fv(shader.uniforms.model, false, new Float32Array(model));
		gl.uniform4f(shader.uniforms.tint, color.r, color.g, color.b, opacity);
		gl.drawElements(gl.TRIANGLES, meshBuffer.indexCount, gl.UNSIGNED_SHORT, 0);
	}

	drawBoundingBoxes(renderer, sceneGraph, projection, view);
}

function RenderLevel(sceneGraph, options) {
	if (typeof document === "undefined") {
		return;
	}

	if (!sceneGraph || typeof sceneGraph !== "object") {
		return;
	}

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