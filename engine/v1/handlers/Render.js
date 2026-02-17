// Renderer and displayer of all visual elements.

// End of any visual pipeline to display contents to Game (document.body)

/* === CONSTANTS === */
// Element ids and defaults for engine rendering.

const defaultUiRootId = "engine-ui-root";

/* === IMPORTS === */
// UI element builder.

import { UIElement } from "../builder/NewUI.js";
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

	let matrix = createIdentityMatrix();
	matrix = multiplyMatrix4(matrix, createTranslationMatrix(position));
	matrix = multiplyMatrix4(matrix, createRotationY(rotation.y || 0));
	matrix = multiplyMatrix4(matrix, createRotationX(rotation.x || 0));
	matrix = multiplyMatrix4(matrix, createRotationZ(rotation.z || 0));
	matrix = multiplyMatrix4(matrix, createScaleMatrix(scale));
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

function createMeshBuffers(gl, mesh) {
	const geometry = mesh && mesh.geometry ? mesh.geometry : null;
	if (!geometry || !Array.isArray(geometry.positions) || !Array.isArray(geometry.indices)) {
		return null;
	}

	const positionBuffer = gl.createBuffer();
	const indexBuffer = gl.createBuffer();
	if (!positionBuffer || !indexBuffer) {
		return null;
	}

	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.positions), gl.STATIC_DRAW);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geometry.indices), gl.STATIC_DRAW);

	return {
		position: positionBuffer,
		index: indexBuffer,
		indexCount: geometry.indices.length,
	};
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
	const entities = Array.isArray(sceneGraph && sceneGraph.entities) ? sceneGraph.entities : [];
	const entityMeshes = entities
		.map((entity) => (entity && entity.mesh ? entity.mesh : null))
		.filter(Boolean);
	return terrain.concat(entityMeshes);
}

function drawScene(renderer, sceneGraph) {
	const gl = renderer.gl;
	const shader = renderer.shader;

	syncCanvasSize(renderer);
	gl.viewport(0, 0, renderer.canvas.width, renderer.canvas.height);
	gl.enable(gl.DEPTH_TEST);
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

	const meshes = collectRenderableMeshes(sceneGraph);
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

		gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer.position);
		gl.enableVertexAttribArray(shader.attributes.position);
		gl.vertexAttribPointer(shader.attributes.position, 3, gl.FLOAT, false, 0, 0);

		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshBuffer.index);
		gl.uniformMatrix4fv(shader.uniforms.model, false, new Float32Array(model));
		gl.uniform4f(shader.uniforms.color, color.r, color.g, color.b, color.a);
		gl.drawElements(gl.TRIANGLES, meshBuffer.indexCount, gl.UNSIGNED_SHORT, 0);
	}
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