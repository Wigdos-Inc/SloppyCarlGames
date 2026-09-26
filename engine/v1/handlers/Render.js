// Renderer and displayer of all visual elements.

// End of any visual pipeline to display contents to Game (document.body)

/* === IMPORTS === */
// UI element builder.

import { UIElement } from "../builder/NewUI.js";
import { TransformPointByMatrix } from "../builder/NewObject.js";
import { CONFIG, PERFORMANCE_SCALING, SKY_STOP_LIMIT } from "../core/config.js";
import { Log } from "../core/meta.js";
import { CreateIdentityMatrix, CreateRenderMatrix, MultiplyMatrix4 } from "../math/Matrix.js";
import { AddVector3, CloneVector3, CrossVector3, DivideVector3, DotVector3, MultiplyVector3, ResolveVector3Axis, ScaleVector3, SubtractVector3, ToVector3, Vector3Length, Vector3Matches, Vector3Sq, Vector3ToArray } from "../math/Vector3.js";
import { Clamp } from "../math/Utilities.js";
import { GetSimDistanceValue } from "../physics/Collision.js";

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

// One engine-owned <style> tag per root; null clears it.
function ApplyRootStylesheet(rootId, stylesheet) {
	const tagId = `engine-ui-style-${rootId}`;
	let tag = document.getElementById(tagId);

	if (stylesheet === null) {
		if (tag) tag.parentNode.removeChild(tag);
		return;
	}

	if (!tag) {
		tag = document.createElement("style");
		tag.id = tagId;
		document.head.appendChild(tag);
	}

	tag.textContent = stylesheet;
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
const identityRenderMatrix = new Float32Array(CreateIdentityMatrix());
const boundingBoxTypeColors = {
	Terrain: { r: 0.95, g: 0.85, b: 0.2, a: 1 },
	Scatter: { r: 0.2, g: 0.8, b: 0.2, a: 1 },
	Entity: { r: 0.2, g: 0.6, b: 1, a: 1 },
	EntityPart: { r: 0.45, g: 0.75, b: 1, a: 1 },
	Obstacle: { r: 1, g: 0.35, b: 0.35, a: 1 },
	Void: { r: 0.35, g: 1, b: 0.85, a: 1 },
	Player: { r: 0.9, g: 0.95, b: 1, a: 1 },
	PlayerPart: { r: 0.75, g: 0.85, b: 1, a: 1 },
	Boss: { r: 0.95, g: 0.2, b: 0.9, a: 1 },
	BossPart: { r: 1, g: 0.45, b: 0.95, a: 1 },
	Particle: { r: 0.6, g: 0.4, b: 1, a: 1 },
	ParticlePart: { r: 0.75, g: 0.6, b: 1, a: 1 },
};

const detailedBoundsTypeColors = {
	Terrain: { r: 1, g: 0.75, b: 0.15, a: 1 },
	Obstacle: { r: 1, g: 0.35, b: 0.35, a: 1 },
	Entity: { r: 0.15, g: 0.95, b: 0.95, a: 1 },
	Player: { r: 0.85, g: 0.95, b: 1, a: 1 },
	Boss: { r: 1, g: 0.35, b: 0.85, a: 1 },
	Particle: { r: 0.6, g: 0.4, b: 1, a: 1 },
	Void: { r: 0.35, g: 1, b: 0.85, a: 1 },
	VoidWall: { r: 0.2, g: 0.5, b: 1, a: 1 },
	VoidOpenFace: { r: 1, g: 0.2, b: 0.55, a: 1 },
};

function createPerspectiveMatrix(fovDegrees, aspect, near, far) {
	const f = 1 / Math.tan(((fovDegrees * Math.PI) / 180) / 2);
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

function resolveProgramLocations(names, resolver) {
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
		attributes: resolveProgramLocations(options.attributeNames || {}, (name) => gl.getAttribLocation(program, name)),
		uniforms: resolveProgramLocations(options.uniformNames, (name) => gl.getUniformLocation(program, name)),
	};
}

// Shared by the sky quad and every fogged surface.
const skySampleGLSL = `
	uniform mat4 u_view;
	uniform vec4 u_skyStops[${SKY_STOP_LIMIT}];
	uniform int u_skyStopCount;
	uniform vec3 u_waterTint;
	uniform float u_underwater;

	// Stop 0 = horizon, last = zenith, evenly spaced; everything below the horizon takes stop 0. Alpha is ignored.
	vec3 sampleSky(float elevation) {
		float span = float(u_skyStopCount - 1);
		float t = clamp(elevation, 0.0, 1.0) * span;
		int lower = int(min(floor(t), span - 1.0));
		vec3 sky = mix(u_skyStops[lower].rgb, u_skyStops[lower + 1].rgb, t - float(lower));
		return mix(sky, u_waterTint, clamp(u_underwater, 0.0, 1.0));
	}

	// Column 1 of the view matrix is world-up expressed in view space.
	float viewRayElevation(vec3 viewRay) {
		return dot(normalize(viewRay), u_view[1].xyz);
	}

	// Callers holding the ray length already reuse it instead of normalizing again.
	float viewRayElevation(vec3 viewRay, float viewDist) {
		return dot(viewRay, u_view[1].xyz) / viewDist;
	}
`;

function createFoggedTextureFragmentShader(
	sharedDeclarations, shadedExpression, premultiplied = false,
	varyings = "in vec2 v_uv;",
	texelComputation = "vec4 texel = texture(u_texture, v_uv);"
) {
	// premultiplied path: scale colorShift and fog by alpha to stay in premultiplied space.
	const shiftExpr    = premultiplied ? "shaded.rgb + u_colorShift * shaded.a" : "shaded.rgb + u_colorShift";
	const fogColorExpr = premultiplied ? "fogColor * shaded.a"                  : "fogColor";
	return `#version 300 es
		precision highp float;
		uniform sampler2D u_texture;
		uniform float u_fogFull;
		uniform vec3 u_colorShift;
		${skySampleGLSL}
		${sharedDeclarations}
		${varyings}
		in vec3 v_viewPos;
		out vec4 fragColor;
		void main() {
			${texelComputation}
			vec4 shaded = ${shadedExpression};
			if (shaded.a <= 0.01) {
				discard;
			}

			float viewDist = length(v_viewPos);
			// Cubed ramp; near geometry stays clear, fog still saturates at the reach.
			float fog = clamp(viewDist / u_fogFull, 0.0, 1.0);
			fog *= fog * fog;
			vec3 shifted = ${shiftExpr};
			vec3 fogColor = sampleSky(viewRayElevation(v_viewPos, viewDist));
			vec3 finalColor = mix(shifted, ${fogColorExpr}, fog);
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
		out vec3 v_viewPos;
		void main() {
			vec4 world = u_model * vec4(a_position, 1.0);
			vec4 viewPos = u_view * world;
			gl_Position = u_projection * viewPos;
			v_uv = a_uv;
			v_viewPos = viewPos.xyz;
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
			projection  : "u_projection",
			view        : "u_view",
			model       : "u_model",
			texture     : "u_texture",
			tint        : "u_tint",
			fogFull     : "u_fogFull",
			colorShift  : "u_colorShift",
			underwater  : "u_underwater",
			skyStops    : "u_skyStops[0]",
			skyStopCount: "u_skyStopCount",
			waterTint   : "u_waterTint",
		},
		createError    : "WebGL program creation failed",
		linkErrorPrefix: "Program link error",
	});
}

function createEntityTriplanarProgram(gl) {
	// Object-space triplanar for noise entity parts; adds a position varying for derivative-based normals.
	const vertexShaderSource = `#version 300 es
		in vec3 a_position;
		in vec2 a_uv;
		uniform mat4 u_projection;
		uniform mat4 u_view;
		uniform mat4 u_model;
		out vec2 v_uv;
		out vec3 v_viewPos;
		out vec3 v_objPos;
		void main() {
			vec4 world = u_model * vec4(a_position, 1.0);
			vec4 viewPos = u_view * world;
			gl_Position = u_projection * viewPos;
			v_uv = a_uv;
			v_viewPos = viewPos.xyz;
			v_objPos = a_position;
		}
	`;

	return createLinkedProgram(gl, {
		vertexShaderSource: vertexShaderSource,
		fragmentShaderSource: createFoggedTextureFragmentShader(
			"uniform vec4 u_tint; uniform float u_texScale;",
			"vec4(texel.rgb * u_tint.rgb, texel.a * u_tint.a)",
			false,
			"in vec3 v_objPos;",
			`vec3 n = normalize(cross(dFdx(v_objPos), dFdy(v_objPos)));
			vec3 w = abs(n); w = w / (w.x + w.y + w.z);
			w = pow(w, vec3(4.0)); w = w / (w.x + w.y + w.z);
			vec4 tx = texture(u_texture, v_objPos.zy * u_texScale);
			vec4 ty = texture(u_texture, v_objPos.xz * u_texScale);
			vec4 tz = texture(u_texture, v_objPos.xy * u_texScale);
			vec4 texel = tx * w.x + ty * w.y + tz * w.z;`
		),
		attributeNames: {
			position: "a_position",
			uv      : "a_uv",
		},
		uniformNames: {
			projection  : "u_projection",
			view        : "u_view",
			model       : "u_model",
			texture     : "u_texture",
			tint        : "u_tint",
			fogFull     : "u_fogFull",
			colorShift  : "u_colorShift",
			underwater  : "u_underwater",
			texScale    : "u_texScale",
			skyStops    : "u_skyStops[0]",
			skyStopCount: "u_skyStopCount",
			waterTint   : "u_waterTint",
		},
		createError    : "WebGL triplanar program creation failed",
		linkErrorPrefix: "Triplanar program link error",
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

// Shared by both scatter vertex shaders; decals must cull in lockstep with their blade.
const scatterCullGLSL = `
	vec3 instanceOrigin = instanceModel[3].xyz;
	float instanceDistance = length((u_view * vec4(instanceOrigin, 1.0)).xyz);
	float fade = 1.0 - smoothstep(u_cullRadius * (1.0 - float(${PERFORMANCE_SCALING.SimDistance.Fractions.Scatter.Fade})), u_cullRadius, instanceDistance);
	float cullHash = fract(sin(dot(instanceOrigin, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
	if (cullHash > fade) {
		gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
		return;
	}
	// Dissolve over the last quarter of each instance's own margin.
	float instanceAlpha = clamp((fade - cullHash) * 4.0, 0.0, 1.0);
`;

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
		uniform float u_cullRadius;
		out vec2 v_uv;
		out vec3 v_viewPos;
		out vec4 v_tint;
		void main() {
			mat4 instanceModel = mat4(a_instanceRow0, a_instanceRow1, a_instanceRow2, a_instanceRow3);
			${scatterCullGLSL}
			vec4 world = instanceModel * vec4(a_position, 1.0);
			vec4 viewPos = u_view * world;
			gl_Position = u_projection * viewPos;
			v_uv = a_uv;
			v_viewPos = viewPos.xyz;
			v_tint = vec4(a_instanceTint.rgb, a_instanceTint.a * instanceAlpha);
		}
	`;

	return createLinkedProgram(gl, {
		vertexShaderSource: vertexShaderSource,
		fragmentShaderSource: createFoggedTextureFragmentShader(
			"in vec4 v_tint;",
			"vec4(texel.rgb * v_tint.rgb, texel.a * v_tint.a)"
		),
		uniformNames: {
			projection  : "u_projection",
			view        : "u_view",
			texture     : "u_texture",
			fogFull     : "u_fogFull",
			colorShift  : "u_colorShift",
			underwater  : "u_underwater",
			cullRadius  : "u_cullRadius",
			skyStops    : "u_skyStops[0]",
			skyStopCount: "u_skyStopCount",
			waterTint   : "u_waterTint",
		},
		linkErrorPrefix: "Scatter shader link error",
	});
}

// Decal shape enum; keep in sync with decalSurfaceUvGLSL and builder/NewObject.js.
const DECAL_SHAPE_CODES = {
	Flat    : 0, // any non-curved primitive — no projection
	Sphere  : 1, // buildSphere   (NewObject.js ~L490)
	Cylinder: 2, // buildCylinder (NewObject.js ~L439)
	Capsule : 3, // buildCapsule  (NewObject.js ~L563)
};

// Cylinder caps are flat disks (unlike capsule ends) — decals there skip radial projection.
function ResolveDecalShapeCode(shape, side) {
	const key = shape.charAt(0).toUpperCase() + shape.slice(1), codes = DECAL_SHAPE_CODES;
	if (key === "cylinder") return side === "top" || side === "bottom" ? codes.Flat : codes.Cylinder;
	if (typeof codes[key] === "number") return codes[key];
	return codes.Flat;
}

// Exact mirror of DecalSurfaceUv.
const decalSurfaceUvGLSL = `
	const int SHAPE_FLAT = 0;
	const int SHAPE_SPHERE = 1;
	const int SHAPE_CYLINDER = 2;
	const int SHAPE_CAPSULE = 3;

	// Orthonormal: right from u, up derived.
	void decalSurfaceFrame(vec3 centreDir, vec3 u, vec3 v, out vec3 right, out vec3 up) {
		right = normalize(u - centreDir * dot(u, centreDir));
		up = cross(centreDir, right);
		if (dot(up, v) < 0.0) up = -up;
	}

	// Tube height, continued onto the cap.
	float decalMeridianArc(vec3 point, float capRadius, float cylinderHalf, int shape) {
		if (shape == SHAPE_CYLINDER || abs(point.y) <= cylinderHalf) return point.y;
		vec3 n = normalize(point - vec3(0.0, sign(point.y) * cylinderHalf, 0.0));
		return sign(point.y) * cylinderHalf + capRadius * asin(clamp(n.y, -1.0, 1.0));
	}

	// Pole vertex: no azimuth, takes the fallback.
	float decalAxisAngle(float z, float x, float fallback) {
		return x == 0.0 && z == 0.0 ? fallback : atan(z, x);
	}

	vec2 decalSurfaceUv(int shape, vec3 point, mat4 placement, vec3 r, float rounding) {
		vec3 centre = placement[3].xyz;
		// Floored: zero scale stays finite.
		float width = max(length(placement[0].xyz), 1e-6), height = max(length(placement[1].xyz), 1e-6);
		vec3 u = placement[0].xyz / width, v = placement[1].xyz / height;

		if (shape == SHAPE_FLAT) {
			vec3 offset = point - centre;
			return vec2(dot(offset, u) / width, dot(offset, v) / height);
		}

		float capRadius = r.y * rounding;
		float cylinderHalf = r.y - capRadius;
		bool onCap = shape == SHAPE_CAPSULE && abs(centre.y) > cylinderHalf;
		vec3 right, up;

		// Sphere or capsule cap: azimuthal equidistant, capped at one turn.
		if (shape == SHAPE_SPHERE || onCap) {
			vec3 origin = vec3(0.0, onCap ? clamp(centre.y, -cylinderHalf, cylinderHalf) : 0.0, 0.0);
			float radius = onCap ? capRadius : length(centre);
			vec3 centreDir = normalize(centre - origin), n = normalize(point - origin);
			decalSurfaceFrame(centreDir, u, v, right, up);
			vec2 bearing = vec2(dot(n, right), dot(n, up));
			float span = length(bearing);
			float turn = 6.283185307179586 * radius;
			return (span > 1e-12 ? radius * acos(clamp(dot(n, centreDir), -1.0, 1.0)) * bearing / span : vec2(0.0))
			     / vec2(min(width, turn), min(height, turn));
		}

		// Axis-anchored unroll: (rho * dTheta, meridian arc).
		vec3 centreDir = normalize(centre - vec3(0.0, centre.y, 0.0));
		vec3 meridian = normalize(vec3(0.0, 1.0, 0.0) - centreDir * centreDir.y);
		vec3 azimuth = cross(centreDir, meridian);
		decalSurfaceFrame(centreDir, u, v, right, up);
		float rho = max(length(vec2(centre.x, centre.z)), 1e-6);
		float centreAngle = decalAxisAngle(centre.z, centre.x, 0.0);
		float dTheta = decalAxisAngle(point.z, point.x, centreAngle) - centreAngle;
		if (dTheta >  3.141592653589793) dTheta -= 6.283185307179586;
		if (dTheta < -3.141592653589793) dTheta += 6.283185307179586;
		float arc = rho * dTheta;
		float rise = decalMeridianArc(point, capRadius, cylinderHalf, shape) - decalMeridianArc(centre, capRadius, cylinderHalf, shape);
		return vec2((arc * dot(right, azimuth) + rise * dot(right, meridian)) / min(width, 6.283185307179586 * rho),
		            (arc * dot(up, azimuth) + rise * dot(up, meridian)) / height);
	}
`;

/* === DECAL GEOMETRY === */
// Capsule cap share; every other shape ignores it.
function DecalRounding(shape, primitiveOptions) {
	return shape === "capsule" ? primitiveOptions.rounding : 0;
}

// Capsule ray origin: on the axis within the band, cap centre beyond it.
function CapsuleBand(halfExtents, rounding, pointY) {
	const capRadius    = halfExtents.y * rounding;
	const cylinderHalf = halfExtents.y - capRadius;
	return { capRadius, cylinderHalf, originY: Math.abs(pointY) <= cylinderHalf ? pointY : Math.sign(pointY) * cylinderHalf };
}

// Orthonormal: right from u, up derived.
function decalSurfaceFrame(centreDir, u, v) {
	const right = ResolveVector3Axis(SubtractVector3(u, ScaleVector3(centreDir, DotVector3(u, centreDir))));
	const up    = CrossVector3(centreDir, right);
	return { right, up: DotVector3(up, v) < 0 ? ScaleVector3(up, -1) : up };
}

// Pole vertex: no azimuth, takes the fallback.
const decalAxisAngle = (z, x, fallback) => (x === 0 && z === 0 ? fallback : Math.atan2(z, x));

// Tube height, continued onto the cap.
function decalMeridianArc(point, capRadius, cylinderHalf, shapeCode) {
	if (shapeCode === DECAL_SHAPE_CODES.Cylinder || Math.abs(point.y) <= cylinderHalf) return point.y;
	const normal = ResolveVector3Axis(SubtractVector3(point, { x: 0, y: Math.sign(point.y) * cylinderHalf, z: 0 }));
	return Math.sign(point.y) * cylinderHalf + capRadius * Math.asin(Clamp(normal.y, -1, 1));
}

// Mirrored by decalSurfaceUvGLSL. referenceArc: seam branch to unwrap into; 0 for none.
function DecalSurfaceUv(point, placement, shapeCode, halfExtents, rounding, referenceArc) {
	const centre = { x: placement[12], y: placement[13], z: placement[14] };
	// Floored: zero scale stays finite.
	const width = Math.max(Vector3Length({ x: placement[0], y: placement[1], z: placement[2] }), 1e-6);
	const height = Math.max(Vector3Length({ x: placement[4], y: placement[5], z: placement[6] }), 1e-6);
	const u = { x: placement[0] / width,  y: placement[1] / width,  z: placement[2] / width  };
	const v = { x: placement[4] / height, y: placement[5] / height, z: placement[6] / height };

	if (shapeCode === DECAL_SHAPE_CODES.Flat) {
		const offset = SubtractVector3(point, centre);
		const along  = DotVector3(offset, u);
		return { u: along / width, v: DotVector3(offset, v) / height, arc: along };
	}

	const band  = CapsuleBand(halfExtents, rounding, centre.y);
	const onCap = shapeCode === DECAL_SHAPE_CODES.Capsule && Math.abs(centre.y) > band.cylinderHalf;

	// Sphere or capsule cap: azimuthal equidistant, capped at one turn.
	if (shapeCode === DECAL_SHAPE_CODES.Sphere || onCap) {
		const origin    = { x: 0, y: onCap ? band.originY : 0, z: 0 };
		const radius    = onCap ? band.capRadius : Vector3Length(centre);
		const centreDir = ResolveVector3Axis(SubtractVector3(centre, origin));
		const normal    = ResolveVector3Axis(SubtractVector3(point, origin));
		const frame     = decalSurfaceFrame(centreDir, u, v);
		const bearingU  = DotVector3(normal, frame.right), bearingV = DotVector3(normal, frame.up);
		const bearing   = Math.hypot(bearingU, bearingV);
		const geodesic  = radius * Math.acos(Clamp(DotVector3(normal, centreDir), -1, 1));
		const arc  = bearing > 1e-12 ? geodesic * bearingU / bearing : 0;
		const turn = 2 * Math.PI * radius;
		return { u: arc / Math.min(width, turn), v: (bearing > 1e-12 ? geodesic * bearingV / bearing : 0) / Math.min(height, turn), arc };
	}

	// Axis-anchored unroll: (rho * dTheta, meridian arc).
	const centreDir = ResolveVector3Axis(SubtractVector3(centre, { x: 0, y: centre.y, z: 0 }));
	const meridian  = ResolveVector3Axis(SubtractVector3({ x: 0, y: 1, z: 0 }, ScaleVector3(centreDir, centreDir.y)));
	const azimuth   = CrossVector3(centreDir, meridian);
	const frame     = decalSurfaceFrame(centreDir, u, v);
	const rho  = Math.max(Math.hypot(centre.x, centre.z), 1e-6);
	const centreAngle = decalAxisAngle(centre.z, centre.x, 0);
	let dTheta = decalAxisAngle(point.z, point.x, centreAngle) - centreAngle;
	if (dTheta >  Math.PI) dTheta -= 2 * Math.PI;
	if (dTheta < -Math.PI) dTheta += 2 * Math.PI;
	// Antipodal seam: shift into the reference branch.
	const piArc = Math.PI * rho;
	let arc = rho * dTheta;
	while (arc - referenceArc >  piArc) arc -= 2 * piArc;
	while (arc - referenceArc < -piArc) arc += 2 * piArc;
	const rise = decalMeridianArc(point, band.capRadius, band.cylinderHalf, shapeCode) - decalMeridianArc(centre, band.capRadius, band.cylinderHalf, shapeCode);
	return {
		u: (arc * DotVector3(frame.right, azimuth) + rise * DotVector3(frame.right, meridian)) / Math.min(width, 2 * piArc),
		v: (arc * DotVector3(frame.up, azimuth)    + rise * DotVector3(frame.up, meridian))    / height,
		arc,
	};
}

// Flat host: the placed quad is exact.
const flatDecalCorners = [{ x: -0.5, y: -0.5, z: 0 }, { x: -0.5, y: 0.5, z: 0 }, { x: 0.5, y: -0.5, z: 0 }, { x: 0.5, y: 0.5, z: 0 }];
const flatDecalOrder   = [0, 1, 2, 2, 1, 3];

function flatDecalFacets(placement) {
	const positions = new Float32Array(flatDecalOrder.length * 3);
	const uvs       = new Float32Array(flatDecalOrder.length * 2);
	flatDecalOrder.forEach((corner, slot) => {
		const point = TransformPointByMatrix(flatDecalCorners[corner], placement);
		positions[slot * 3] = point.x; positions[slot * 3 + 1] = point.y; positions[slot * 3 + 2] = point.z;
		uvs[slot * 2] = flatDecalCorners[corner].x; uvs[slot * 2 + 1] = flatDecalCorners[corner].y;
	});
	return { positions, uvs };
}

// Whole facets, each padded by its own uv extent; the fragment shader does the exact cut.
function SelectDecalFacets(geometry, placement, shapeCode, halfExtents, rounding, margin) {
	if (shapeCode === DECAL_SHAPE_CODES.Flat) return flatDecalFacets(placement);

	const half = 0.5 * margin;
	const { positions, indices } = geometry;
	const vertexCount = positions.length / 3;
	const points  = new Array(vertexCount);
	const baseUvs = new Array(vertexCount);
	const pointAt = (index) => points[index] || (points[index] = { x: positions[index * 3], y: positions[index * 3 + 1], z: positions[index * 3 + 2] });
	// First vertices map with referenceArc 0, so they cache per index.
	const baseUvAt = (index) => baseUvs[index] || (baseUvs[index] = DecalSurfaceUv(pointAt(index), placement, shapeCode, halfExtents, rounding, 0));

	const keptPoints = [], keptUvs = [];
	const tri = [null, null, null], us = [0, 0, 0], vs = [0, 0, 0];
	for (let offset = 0; offset < indices.length; offset += 3) {
		tri[0] = pointAt(indices[offset]);
		tri[1] = pointAt(indices[offset + 1]);
		tri[2] = pointAt(indices[offset + 2]);
		// Degenerate capsule pole triangles.
		if (Vector3Length(CrossVector3(SubtractVector3(tri[1], tri[0]), SubtractVector3(tri[2], tri[0]))) < 1e-14) continue;

		// Unwrap into the first vertex's branch.
		const base = baseUvAt(indices[offset]);
		us[0] = base.u; vs[0] = base.v;
		for (let corner = 1; corner < 3; corner++) {
			const mapped = DecalSurfaceUv(tri[corner], placement, shapeCode, halfExtents, rounding, base.arc);
			us[corner] = mapped.u;
			vs[corner] = mapped.v;
		}

		const minU = Math.min(us[0], us[1], us[2]), maxU = Math.max(us[0], us[1], us[2]);
		const minV = Math.min(vs[0], vs[1], vs[2]), maxV = Math.max(vs[0], vs[1], vs[2]);
		const extentU = maxU - minU, extentV = maxV - minV;
		if (minU > half + extentU || maxU < -half - extentU) continue;
		if (minV > half + extentV || maxV < -half - extentV) continue;

		for (let corner = 0; corner < 3; corner++) {
			keptPoints.push(tri[corner].x, tri[corner].y, tri[corner].z);
			keptUvs.push(us[corner], vs[corner]);
		}
	}
	return { positions: new Float32Array(keptPoints), uvs: new Float32Array(keptUvs) };
}

// Cut per fragment, so animation only moves u_placement.
const decalFragmentDeclarations = `uniform vec4 u_tint;
		uniform mat4 u_placement;
		uniform int u_shape;
		uniform vec3 u_halfExtents;
		uniform float u_rounding;
		${decalSurfaceUvGLSL}`;

// The exact [-0.5, 0.5] cut.
const decalFragmentCut = `vec2 decalUv = decalSurfaceUv(u_shape, v_partLocal, u_placement, u_halfExtents, u_rounding);
			if (abs(decalUv.x) > 0.5 || abs(decalUv.y) > 0.5) discard;
			vec4 texel = texture(u_texture, vec2(decalUv.x + 0.5, 0.5 - decalUv.y));`;

function createDecalProgram(gl) {
	// Host facets in part-local space.
	const vertexShaderSource = `#version 300 es
		in vec3 a_position;
		uniform mat4 u_projection;
		uniform mat4 u_view;
		uniform mat4 u_partWorld;
		out vec3 v_partLocal;
		out vec3 v_viewPos;

		void main() {
			vec4 viewPos = u_view * u_partWorld * vec4(a_position, 1.0);
			gl_Position = u_projection * viewPos;
			v_partLocal = a_position;
			v_viewPos = viewPos.xyz;
		}
	`;

	return createLinkedProgram(gl, {
		vertexShaderSource: vertexShaderSource,
		fragmentShaderSource: createFoggedTextureFragmentShader(
			decalFragmentDeclarations,
			"vec4(texel.rgb * u_tint.rgb * u_tint.a, texel.a * u_tint.a)",
			true,
			"in vec3 v_partLocal;",
			decalFragmentCut
		),
		attributeNames: {
			position: "a_position",
		},
		uniformNames: {
			projection  : "u_projection",
			view        : "u_view",
			placement   : "u_placement",
			partWorld   : "u_partWorld",
			shape       : "u_shape",
			halfExtents : "u_halfExtents",
			rounding    : "u_rounding",
			texture     : "u_texture",
			tint        : "u_tint",
			fogFull     : "u_fogFull",
			colorShift  : "u_colorShift",
			underwater  : "u_underwater",
			skyStops    : "u_skyStops[0]",
			skyStopCount: "u_skyStopCount",
			waterTint   : "u_waterTint",
		},
		createError    : "decal shader program creation failed",
		linkErrorPrefix: "decal shader link error",
	});
}

function createScatterDecalProgram(gl) {
	// Instanced variant of the decal shader: u_partWorld becomes per-instance row attributes.
	const vertexShaderSource = `#version 300 es
		layout(location = 0) in vec3 a_position;
		layout(location = 2) in vec4 a_instanceRow0;
		layout(location = 3) in vec4 a_instanceRow1;
		layout(location = 4) in vec4 a_instanceRow2;
		layout(location = 5) in vec4 a_instanceRow3;
		uniform mat4 u_projection;
		uniform mat4 u_view;
		uniform float u_cullRadius;
		out vec3 v_partLocal;
		out vec3 v_viewPos;
		out float v_cullAlpha;

		void main() {
			mat4 instanceModel = mat4(a_instanceRow0, a_instanceRow1, a_instanceRow2, a_instanceRow3);
			${scatterCullGLSL}
			vec4 viewPos = u_view * instanceModel * vec4(a_position, 1.0);
			gl_Position = u_projection * viewPos;
			v_partLocal = a_position;
			v_viewPos = viewPos.xyz;
			v_cullAlpha = instanceAlpha;
		}
	`;

	return createLinkedProgram(gl, {
		vertexShaderSource: vertexShaderSource,
		fragmentShaderSource: createFoggedTextureFragmentShader(
			`${decalFragmentDeclarations}\n\t\tin float v_cullAlpha;`,
			"vec4(texel.rgb * u_tint.rgb * u_tint.a, texel.a * u_tint.a) * v_cullAlpha",
			true,
			"in vec3 v_partLocal;",
			decalFragmentCut
		),
		uniformNames: {
			projection  : "u_projection",
			view        : "u_view",
			placement   : "u_placement",
			shape       : "u_shape",
			halfExtents : "u_halfExtents",
			rounding    : "u_rounding",
			texture     : "u_texture",
			tint        : "u_tint",
			fogFull     : "u_fogFull",
			colorShift  : "u_colorShift",
			underwater  : "u_underwater",
			cullRadius  : "u_cullRadius",
			skyStops    : "u_skyStops[0]",
			skyStopCount: "u_skyStopCount",
			waterTint   : "u_waterTint",
		},
		createError    : "scatter decal shader program creation failed",
		linkErrorPrefix: "scatter decal shader link error",
	});
}

// Fullscreen backdrop; the view ray is the exact inverse of the projection in use.
function createSkyProgram(gl) {
	const vertexShaderSource = `#version 300 es
		in vec2 a_position;
		uniform vec2 u_rayScale;
		out vec3 v_viewPos;
		void main() {
			v_viewPos = vec3(a_position * u_rayScale, -1.0);
			gl_Position = vec4(a_position, 0.0, 1.0);
		}
	`;

	const fragmentShaderSource = `#version 300 es
		precision highp float;
		${skySampleGLSL}
		in vec3 v_viewPos;
		out vec4 fragColor;
		void main() {
			fragColor = vec4(sampleSky(viewRayElevation(v_viewPos)), 1.0);
		}
	`;

	return createLinkedProgram(gl, {
		vertexShaderSource, fragmentShaderSource,
		attributeNames : { position: "a_position" },
		uniformNames   : {
			view        : "u_view",
			rayScale    : "u_rayScale",
			skyStops    : "u_skyStops[0]",
			skyStopCount: "u_skyStopCount",
			waterTint   : "u_waterTint",
			underwater  : "u_underwater",
		},
		createError    : "sky program creation failed",
		linkErrorPrefix: "sky shader link error",
	});
}

// Crossfades two baked surfaces; fog/tint are applied later by the textured programs, not here.
function createBlendProgram(gl) {
	const vertexShaderSource = `#version 300 es
		in vec2 a_position;
		out vec2 v_uv;
		void main() {
			v_uv = a_position * 0.5 + 0.5;
			gl_Position = vec4(a_position, 0.0, 1.0);
		}
	`;

	const fragmentShaderSource = `#version 300 es
		precision highp float;
		uniform sampler2D u_from;
		uniform sampler2D u_to;
		uniform float u_ratio;
		in vec2 v_uv;
		out vec4 fragColor;
		void main() {
			fragColor = mix(texture(u_from, v_uv), texture(u_to, v_uv), u_ratio);
		}
	`;

	return createLinkedProgram(gl, {
		vertexShaderSource, fragmentShaderSource,
		attributeNames : { position: "a_position" },
		uniformNames   : { from: "u_from", to: "u_to", ratio: "u_ratio" },
		createError    : "texture blend program creation failed",
		linkErrorPrefix: "texture blend shader link error",
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

// Shared position/uv/index + per-instance model-matrix rows, optional trailing tint row.
function buildInstancedVao(gl, positionBuffer, uvBuffer, indexBuffer, instanceBuffer, includeTint) {
	const vao = gl.createVertexArray();
	gl.bindVertexArray(vao);

	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

	// Null for de-indexed decal geometry.
	if (uvBuffer !== null) {
		gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
	}
	if (indexBuffer !== null) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

	gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
	const stride = 80;
	const rowCount = includeTint ? 5 : 4;
	for (let row = 0; row < rowCount; row++) {
		const location = 2 + row;
		gl.enableVertexAttribArray(location);
		gl.vertexAttribPointer(location, 4, gl.FLOAT, false, stride, row * 16);
		gl.vertexAttribDivisor(location, 1);
	}

	gl.bindVertexArray(null);
	return vao;
}

function buildScatterInstanceBuffers(renderer, sceneGraph) {
	if (sceneGraph.scatterBatches.size === 0) {
		renderer.scatterInstances = [];
		renderer.scatterDecalBatches = [];
		renderer.scatterInstancesBuilt = true;
		return;
	}

	const gl = renderer.gl;
	const results = [];
	let totalInstances = 0;

	sceneGraph.scatterBatches.forEach((batch, batchKey) => {
		if (batch.instanceCount === 0) return;

		const geo = ensureSharedGeometry(renderer, sceneGraph, batch.primitiveKey);
		if (!geo) return;

		const instanceCount = batch.instanceCount;
		const instanceData = batch.instanceData;

		const instanceBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.STATIC_DRAW);

		// Model matrix rows 0-3 + per-instance tint row 4.
		const vao = buildInstancedVao(gl, geo.positionBuffer, geo.uvBuffer, geo.indexBuffer, instanceBuffer, true);

		// Scatter decals are static: built once, shared by every instance.
		const primitiveGeometry = sceneGraph.visualResources.primitiveGeometry[batch.primitiveKey];
		const dim = batch.dimensions;
		const rounding = DecalRounding(batch.primitive, batch.primitiveOptions);
		const decalDraws = batch.customTextures.map((decalEntry, index) => {
			const shapeCode = ResolveDecalShapeCode(batch.primitive, decalEntry.side);
			const placement = BuildDecalPlacementMatrix(dim, decalEntry.displayTransform, decalEntry.side);
			const facets    = SelectDecalFacets(primitiveGeometry, placement, shapeCode, DivideVector3(dim, ToVector3(2)), rounding, 1);

			const positionBuffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, facets.positions, gl.STATIC_DRAW);
			return {
				shapeCode,
				placement  : new Float32Array(placement),
				vao        : buildInstancedVao(gl, positionBuffer, null, null, instanceBuffer, false),
				vertexCount: facets.positions.length / 3,
				textureKey : `${batchKey}::customTexture::${index}`,
			};
		});

		totalInstances += instanceCount;
		results.push({
			key: batchKey, vao,
			indexCount: geo.indexCount,
			instanceCount,
			textureID: batch.textureID,
			decalDraws,
			dimensions: batch.dimensions,
			rounding,
		});
	});

	renderer.scatterInstances = results;
	renderer.scatterDecalBatches = results.filter((batch) => batch.decalDraws.length > 0);
	renderer.scatterInstancesBuilt = true;
	Log(
		"ENGINE",
		`Scatter instancing ready: ${results.length} batch(es), ${totalInstances} total instance(s), ${results.length} draw call(s)`,
		"log",
		"Level"
	);
}

const isBoundingBoxDebugEnabled = (type) => !!(CONFIG.DEBUG.ALL && CONFIG.DEBUG.LEVELS.BoundingBox[type]);
const isGridDebugEnabled = () => !!(CONFIG.DEBUG.ALL && CONFIG.DEBUG.LEVELS.BoundingBox.Grid.Visible);
const isDetailedBoundsDebugEnabled = (type) => !!(CONFIG.DEBUG.ALL && CONFIG.DEBUG.LEVELS.DetailedBounds[type]);

function bindDebugLinePass(renderer, gl, projection, view) {
	gl.useProgram(renderer.debugLineShader.program);
	gl.uniformMatrix4fv(renderer.debugLineShader.uniforms.projection, false, projection);
	gl.uniformMatrix4fv(renderer.debugLineShader.uniforms.view, false, view);
	gl.uniformMatrix4fv(renderer.debugLineShader.uniforms.model, false, identityRenderMatrix);
	gl.bindBuffer(gl.ARRAY_BUFFER, renderer.debugLineBuffer);
	gl.enableVertexAttribArray(renderer.debugLineShader.attributes.position);
	gl.vertexAttribPointer(renderer.debugLineShader.attributes.position, 3, gl.FLOAT, false, 0, 0);
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

function createGridLineVertices(bounds, step) {
	const wMin = bounds.min.toWorldUnit();
	const wMax = bounds.max.toWorldUnit();

	const min = Vector3ToArray(wMin), max = Vector3ToArray(wMax);
	const a = [0, 0, 0], b = [0, 0, 0];
	const lines = [];

	// Sweep axis s over faces of axis k; lines run along axis l.
	for (let s = 0; s < 3; s++) {
		for (let k = 0; k < 3; k++) {
			if (k === s) continue;
			const l = 3 - s - k;
			a[l] = min[l];
			b[l] = max[l];
			for (const side of [min[k], max[k]]) {
				a[k] = b[k] = side;
				for (let v = min[s]; v <= max[s] + step * 0.001; v += step) {
					a[s] = b[s] = v;
					lines.push(a[0], a[1], a[2], b[0], b[1], b[2]);
				}
			}
		}
	}

	if (lines.length === 0) return null;
	return new Float32Array(lines);
}

function drawBoundingBoxes(renderer, sceneGraph, projection, view) {
	if (sceneGraph.debugBoundingBoxes.length === 0) return;

	const gl = renderer.gl;
	if (!renderer.debugLineShader) renderer.debugLineShader = createLineProgram(gl);
	if (!renderer.debugLineShader) return;
	if (!renderer.debugLineBuffer) renderer.debugLineBuffer = gl.createBuffer();
	if (!renderer.debugLineBuffer) return;

	bindDebugLinePass(renderer, gl, projection, view);

	sceneGraph.debugBoundingBoxes.forEach((record) => {
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
	if (sceneGraph.debugBoundingBoxes.length === 0) return;

	const gl = renderer.gl;
	if (!renderer.debugLineShader || !renderer.debugLineBuffer) return;

	bindDebugLinePass(renderer, gl, projection, view);
	gl.uniform4f(renderer.debugLineShader.uniforms.color, 0.5, 0.5, 0.5, 0.6);

	sceneGraph.debugBoundingBoxes.forEach((record) => {
		if (!isBoundingBoxDebugEnabled(record.type)) return;

		const vertices = createGridLineVertices(record, CONFIG.DEBUG.LEVELS.BoundingBox.Grid.Scale.toWorldUnit());
		if (!vertices) return;

		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
		gl.drawArrays(gl.LINES, 0, vertices.length / 3);
	});
}

function createObbLineVertices(bounds) {
	const c = bounds.center.toWorldUnit();
	const s = MultiplyVector3({ x: bounds.axes[0], y: bounds.axes[1], z: bounds.axes[2] }, bounds.halfExtents.toWorldUnit());

	const sign = (v, on) => on ? v : ScaleVector3(v, -1);

	// Bits of i pick each axis side: 4 = x, 2 = y, 1 = z.
	const corners = [];
	for (let i = 0; i < 8; i++) corners.push(Vector3ToArray(AddVector3(AddVector3(AddVector3(c, sign(s.x, i & 4)), sign(s.y, i & 2)), sign(s.z, i & 1))));
	return buildBoxWireframe(...corners);
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

		lines.push(...bottomBase, ...topBase);
		lines.push(...bottomBase, start.x + c1 * radius, start.y, start.z + s1 * radius);
		lines.push(...topBase, end.x + c1 * radius, end.y, end.z + s1 * radius);
		lines.push(...bottomBase, ...bottomMid);
		lines.push(...bottomMid, ...bottomPole);
		lines.push(...topBase, ...topMid);
		lines.push(...topMid, ...topPole);
		lines.push(...bottomMid, ...[start.x + c1 * ringRadius, start.y - ringOffset, start.z + s1 * ringRadius]);
		lines.push(...topMid, ...[end.x + c1 * ringRadius, end.y + ringOffset, end.z + s1 * ringRadius]);
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
		case "aabb"         : vertices = createMinMaxBoxLineVertices(bounds);    break;
		case "triangle-soup":
		case "voidWall"     : vertices = createTriangleSoupLineVertices(bounds); break;
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
		if (!isDetailedBoundsDebugEnabled(record.toggle)) return;

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
	Particle: { r: 0.7, g: 0.4, b: 1, a: 1 },
};

const isTrailDebugEnabled = (type) => !!(CONFIG.DEBUG.ALL && CONFIG.DEBUG.LEVELS.Trails[type]);

function classifyEntityTrailType(entity) {
	if (entity.type.includes("player"))      return "Player";
	if (entity.type.includes("boss"))        return "Boss";
	if (entity.type.includes("collectible")) return "Collectible";
	if (entity.type.includes("projectile"))  return "Projectile";
	if (entity.type.includes("particle"))    return "Particle";
	return "Enemies";
}

function drawVelocityTrails(renderer, sceneGraph, projection, view) {
	if (!CONFIG.DEBUG.ALL) return;
	if (!Object.values(CONFIG.DEBUG.LEVELS.Trails).some(Boolean)) return;
	if (sceneGraph.entities.length === 0) return;

	const gl = renderer.gl;
	if (!renderer.debugLineShader || !renderer.debugLineBuffer) return;

	bindDebugLinePass(renderer, gl, projection, view);
	const trailScale = 0.15;

	sceneGraph.entities.forEach(entity => {
		const trailType = classifyEntityTrailType(entity);
		if (!isTrailDebugEnabled(trailType)) return;

		const vel = entity.velocity;
		if (Vector3Sq(vel) < 0.01) return;

		const pos = entity.transform.position.toWorldUnit();
		const end = AddVector3(pos, ScaleVector3(vel, trailScale));

		// Convert CNU positions to world units for rendering.
		const vertices = new Float32Array([pos.x, pos.y, pos.z, end.x, end.y, end.z]);
		const color = trailTypeColors[trailType];

		gl.uniform4f(renderer.debugLineShader.uniforms.color, color.r, color.g, color.b, color.a);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
		gl.drawArrays(gl.LINES, 0, 2);
	});
}

function createMeshBuffers(gl, mesh, shader) {
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
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.geometry.positions), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(shader.attributes.position);
	gl.vertexAttribPointer(shader.attributes.position, 3, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.geometry.uvs), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(shader.attributes.uv);
	gl.vertexAttribPointer(shader.attributes.uv, 2, gl.FLOAT, false, 0, 0);

	// 32-bit: a carved host can exceed the 65535-index ceiling, and a wrap would be silent.
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mesh.geometry.indices), gl.STATIC_DRAW);

	gl.bindVertexArray(null);

	return {
		position: positionBuffer,
		uv: uvBuffer,
		index: indexBuffer,
		indexCount: mesh.geometry.indices.length,
		vao,
	};
}

// Snapshot covers every field CreateRenderMatrix reads.
function renderMatrixFor(mesh) {
	const cache     = mesh.renderMatrixCache;
	const transform = mesh.displayTransform;
	if (Vector3Matches(cache.position, transform.position) &&
		Vector3Matches(cache.pivot,    transform.pivot)    &&
		Vector3Matches(cache.rotation, transform.rotation) &&
		Vector3Matches(cache.scale,    transform.scale)
	) {
		return cache.matrix;
	}

	cache.matrix.set(CreateRenderMatrix(transform));
	cache.position.set(transform.position);
	cache.pivot.set(transform.pivot);
	cache.rotation.set(transform.rotation);
	cache.scale = CloneVector3(transform.scale);
	return cache.matrix;
}

const getMeshBufferKey = (mesh) => `${mesh.id}|${mesh.primitive}|${mesh.dimensions.x}|${mesh.dimensions.y}|${mesh.dimensions.z}|${mesh.complexity}|${mesh.geometry.indices.length}`;

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

// Decals specifically upload premultiplied; reallocate=false reuses storage via texSubImage2D.
function uploadTextureImage(gl, textureID, source, reallocate) {
	const isDecal = textureID.includes("::customTexture::");
	if (isDecal) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
	if (reallocate) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
	else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
	if (isDecal) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
}

function ensureSceneTexture(renderer, sceneGraph, textureID) {
	const gl = renderer.gl;
	renderer.drawnTextures.add(textureID);
	if (renderer.textures.has(textureID)) return renderer.textures.get(textureID);

	const texture = gl.createTexture();
	if (!texture) return renderer.fallbackTexture;

	const wrapMode = (textureID.includes("::face=") || textureID.includes("::customTexture::"))
		? gl.CLAMP_TO_EDGE
		: gl.REPEAT;
	gl.bindTexture(gl.TEXTURE_2D, texture);
	uploadTextureImage(gl, textureID, sceneGraph.visualResources.textureRegistry[textureID].source, true);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapMode);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

	renderer.textures.set(textureID, texture);
	return texture;
}

function ensureFullscreenQuad(renderer, cacheKey, shader, label) {
	if (renderer[cacheKey]) return renderer[cacheKey];

	const gl = renderer.gl;
	const positionBuffer = gl.createBuffer();
	const indexBuffer = gl.createBuffer();
	if (!positionBuffer || !indexBuffer) {
		Log("ENGINE", `${label} quad buffer creation failed`, "error", "Render");
		return null;
	}

	const vao = gl.createVertexArray();
	gl.bindVertexArray(vao);

	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(shader.attributes.position);
	gl.vertexAttribPointer(shader.attributes.position, 2, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 2, 1, 3]), gl.STATIC_DRAW);

	gl.bindVertexArray(null);

	renderer[cacheKey] = { vao, position: positionBuffer, index: indexBuffer, indexCount: 6 };
	return renderer[cacheKey];
}

const ensureBlendQuad = (renderer) => ensureFullscreenQuad(renderer, "blendQuad", renderer.blendShader, "Blend");
const ensureSkyQuad   = (renderer) => ensureFullscreenQuad(renderer, "skyQuad",   renderer.skyShader,   "Sky");

// Entries past u_skyStopCount are never sampled, so only the live stops are written.
function fillSkyStops(renderer, stops) {
	const data = renderer.skyStopData;
	for (let index = 0; index < stops.length; index++) {
		const stop = stops[index];
		const offset = index * 4;
		data[offset]     = stop.r;
		data[offset + 1] = stop.g;
		data[offset + 2] = stop.b;
		data[offset + 3] = stop.a;
	}
	return data;
}

// Both surfaces upload here, so a rollover queued before first draw is consumed too.
function ensureAnimatedSources(renderer, textureID, stateEntry) {
	const existing = renderer.animatedSources.get(textureID);
	if (existing !== undefined) return existing;

	const gl = renderer.gl;
	const createFrom = (source) => {
		const texture = gl.createTexture();
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		uploadTextureImage(gl, textureID, source, true);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		return texture;
	};

	const sources = { from: createFrom(stateEntry.fromSurface), to: createFrom(stateEntry.toSurface) };
	stateEntry.pendingSurface = null;
	renderer.animatedSources.set(textureID, sources);
	return sources;
}

function blendAnimatedTextures(renderer, sceneGraph) {
	const gl = renderer.gl;
	const byTextureID = sceneGraph.visualResources.textureAnimation.byTextureID;
	const quad = ensureBlendQuad(renderer);
	if (!quad) return;

	gl.disable(gl.DEPTH_TEST);
	gl.disable(gl.BLEND);
	gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.blendFramebuffer);
	gl.useProgram(renderer.blendShader.program);
	gl.uniform1i(renderer.blendShader.uniforms.from, 0);
	gl.uniform1i(renderer.blendShader.uniforms.to, 1);
	gl.bindVertexArray(quad.vao);

	for (const textureID in byTextureID) {
		// Absent from cache = never drawn, so nothing samples its target.
		const target = renderer.textures.get(textureID);
		if (target === undefined) continue;

		// In the cache but not last frame's draws = currently hidden.
		if (!renderer.drawnTextures.has(textureID)) continue;

		const stateEntry = byTextureID[textureID];
		if (stateEntry.toSurface === null) continue;

		const sources = ensureAnimatedSources(renderer, textureID, stateEntry);

		// Outgoing "from" becomes the new "to"; same dimensions, so storage is reused.
		if (stateEntry.pendingSurface !== null) {
			const recycled = sources.from;
			sources.from = sources.to;
			sources.to = recycled;
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, sources.to);
			uploadTextureImage(gl, textureID, stateEntry.pendingSurface, false);
			stateEntry.pendingSurface = null;
		}

		if (stateEntry.phase !== "blend") continue;

		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
		gl.viewport(0, 0, stateEntry.toSurface.width, stateEntry.toSurface.height);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, sources.from);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, sources.to);
		gl.uniform1f(renderer.blendShader.uniforms.ratio, stateEntry.blendRatio);
		gl.drawElements(gl.TRIANGLES, quad.indexCount, gl.UNSIGNED_SHORT, 0);
	}

	gl.bindVertexArray(null);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.activeTexture(gl.TEXTURE0);
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

	// alpha: false — stops the white page bleeding through via framebuffer alpha.
	const gl = canvas.getContext("webgl2", { alpha: false });
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

	const decalShader = createDecalProgram(gl);
	if (!decalShader) {
		Log("ENGINE", "Failed to create decal shader.", "error", "Render");
		return null;
	}

	const scatterDecalShader = createScatterDecalProgram(gl);
	if (!scatterDecalShader) {
		Log("ENGINE", "Failed to create scatter decal shader.", "error", "Render");
		return null;
	}

	const entityTriplanarShader = createEntityTriplanarProgram(gl);
	if (!entityTriplanarShader) {
		Log("ENGINE", "Failed to create entity triplanar shader.", "error", "Render");
		return null;
	}

	const skyShader = createSkyProgram(gl);
	if (!skyShader) {
		Log("ENGINE", "Failed to create sky shader.", "error", "Render");
		return null;
	}

	const blendShader = createBlendProgram(gl);
	if (!blendShader) {
		Log("ENGINE", "Failed to create texture blend shader.", "error", "Render");
		return null;
	}

	const blendFramebuffer = gl.createFramebuffer();
	if (!blendFramebuffer) {
		Log("ENGINE", "Failed to create texture blend framebuffer.", "error", "Render");
		return null;
	}

	const renderer = {
		rootId, root, canvas, gl, shader,
		scatterShader,
		decalShader,
		scatterDecalShader,
		entityTriplanarShader,
		skyShader,
		blendShader,
		blendFramebuffer,
		blendQuad: null,
		skyQuad: null,
		skyStopData: new Float32Array(SKY_STOP_LIMIT * 4),
		animatedSources: new Map(),
		drawnTextures: new Set(),
		meshBuffers: new Map(),
		textures: new Map(),
		geometryRegistry: new Map(),
		scatterInstances: null,
		scatterDecalBatches: null,
		scatterInstancesBuilt: false,
		voidWallUvMeshes: null,
		voidWallTriplanarMeshes: null,
		voidWallMeshesBuilt: false,
		fallbackTexture: createFallbackTexture(gl),
		loggedScatterSubmission: false,
		debugLineShader: null,
		debugLineBuffer: null,
		decalGeometry: new WeakMap(),
	};

	levelRendererCache.set(rootId, renderer);
	return renderer;
}

// Scaled target, not client size to prevent per-frame re-allocation.
function syncCanvasSize(renderer) {
	const scale = CONFIG.PERFORMANCE.Resolution / 100;
	const width  = Math.round(renderer.canvas.clientWidth  * scale);
	const height = Math.round(renderer.canvas.clientHeight * scale);

	if (renderer.canvas.width === width && renderer.canvas.height === height) return;
	renderer.canvas.width  = width;
	renderer.canvas.height = height;
}

// displayColor.a is authoritative when present — particle texture opacity is always 1.
const isTranslucentMesh = (mesh) => mesh.displayColor !== null ? mesh.displayColor.a < 1 : mesh.material.transparent;

// The key is omitted rather than set false, so absence means UV.
const meshUsesTriplanar = (mesh) => mesh.geometry.triplanar === true;

function collectRenderableMeshes(sceneGraph) {
	const terrain = [];
	const obstacles = [];
	const entitiesUv = [];
	const entitiesTriplanar = [];
	const entitiesTranslucent = [];

	const collectEntityPart = (mesh) => {
		if (isTranslucentMesh(mesh)) { entitiesTranslucent.push(mesh); return; }
		(meshUsesTriplanar(mesh) ? entitiesTriplanar : entitiesUv).push(mesh);
	};

	// Scatter and triggers are excluded — scatter via instanced path, triggers via post-scatter pass.
	sceneGraph.terrain.forEach((mesh) => {
		if (mesh.meta.mode !== "default" || !mesh.performance.rendering) return;
		terrain.push(mesh);
	});
	sceneGraph.obstacles.forEach((record) => {
		if (record.mode !== "default" || !record.performance.rendering) return;
		record.parts.forEach((part) => obstacles.push(part));
	});
	sceneGraph.entities.forEach((entity) => {
		if (entity.model) {
			entity.model.parts.forEach((part) => collectEntityPart(part.mesh));
			return;
		}
		collectEntityPart(entity.mesh);
	});

	return { terrain, obstacles, entitiesUv, entitiesTriplanar, entitiesTranslucent };
}

// Decorated in a side table so the O(n log n) comparator never allocates.
function sortBackToFront(meshes, cameraPosition) {
	const distancesSq = new Map();
	for (const mesh of meshes) {
		distancesSq.set(mesh, Vector3Sq(SubtractVector3(mesh.displayTransform.position, cameraPosition)));
	}
	meshes.sort((a, b) => distancesSq.get(b) - distancesSq.get(a));
}

function applySkyUniforms(gl, shader, passState) {
	gl.uniform4fv(shader.uniforms.skyStops, passState.skyStops);
	gl.uniform1i(shader.uniforms.skyStopCount, passState.skyStopCount);
	gl.uniform3f(shader.uniforms.waterTint, passState.waterTint.r, passState.waterTint.g, passState.waterTint.b);
	gl.uniform1f(shader.uniforms.underwater, passState.underwaterValue);
}

function configureTexturedMeshPass(gl, shader, passState) {
	gl.useProgram(shader.program);
	gl.uniformMatrix4fv(shader.uniforms.projection, false, passState.projection);
	gl.uniformMatrix4fv(shader.uniforms.view, false, passState.view);
	gl.uniform1f(shader.uniforms.fogFull, passState.fogFull);
	gl.uniform3f(shader.uniforms.colorShift, passState.colorShift.r, passState.colorShift.g, passState.colorShift.b);
	applySkyUniforms(gl, shader, passState);
}

// Depth-neutral: with DEPTH_TEST off nothing writes depth, so the pass never occludes later geometry.
function drawSkyPass(renderer, passState) {
	const gl = renderer.gl;
	const quad = ensureSkyQuad(renderer);
	if (!quad) return;

	const shader = renderer.skyShader;
	gl.disable(gl.DEPTH_TEST);
	gl.useProgram(shader.program);
	gl.uniformMatrix4fv(shader.uniforms.view, false, passState.view);
	gl.uniform2f(shader.uniforms.rayScale, 1 / passState.projection[0], 1 / passState.projection[5]);
	applySkyUniforms(gl, shader, passState);
	gl.bindVertexArray(quad.vao);
	gl.drawElements(gl.TRIANGLES, quad.indexCount, gl.UNSIGNED_SHORT, 0);
	gl.bindVertexArray(null);
	gl.enable(gl.DEPTH_TEST);
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
	const disableDepthWriteForPass = options.depthMask === false;

	const shader = options.triplanar ? renderer.entityTriplanarShader : renderer.shader;

	configureTexturedMeshPass(gl, shader, passState);
	if (disableDepthWriteForPass) gl.depthMask(false);

	for (const mesh of meshes) {
		const meshBuffer = ensureMeshBuffer(renderer, mesh, shader);
		if (!meshBuffer) continue;

		const dc = mesh.displayColor;

		gl.bindVertexArray(meshBuffer.vao);
		gl.uniform1i(shader.uniforms.texture, 0);
		gl.uniformMatrix4fv(shader.uniforms.model, false, renderMatrixFor(mesh));
		gl.uniform4f(shader.uniforms.tint,
			dc !== null ? dc.r : mesh.material.color.r,
			dc !== null ? dc.g : mesh.material.color.g,
			dc !== null ? dc.b : mesh.material.color.b,
			dc !== null ? dc.a : mesh.material.opacity);
		if (options.triplanar) gl.uniform1f(shader.uniforms.texScale, mesh.material.textureScale);

		if (mesh.geometry.faceTextureGroups) {
			for (const group of mesh.geometry.faceTextureGroups) {
				const faceTex = ensureSceneTexture(renderer, sceneGraph, group.textureID);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, faceTex);
				gl.drawElements(gl.TRIANGLES, group.indexCount, gl.UNSIGNED_INT, group.indexStart * 4);
			}
			gl.bindVertexArray(null);
			continue;
		}

		const texture = ensureSceneTexture(renderer, sceneGraph, mesh.material.textureID);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.drawElements(gl.TRIANGLES, meshBuffer.indexCount, gl.UNSIGNED_INT, 0);
		gl.bindVertexArray(null);
	}

	if (disableDepthWriteForPass) gl.depthMask(true);
}

function drawWaterPass(renderer, sceneGraph, passState) {
	const meshes = sceneGraph.waterVisual === null ? [] : [sceneGraph.waterVisual.body, sceneGraph.waterVisual.top];
	drawMeshList(renderer, sceneGraph, meshes, passState, { depthMask: false });
}

// Issued as runs of consecutive same-shader meshes so global sort order survives.
function drawSortedRuns(renderer, sceneGraph, meshes, passState) {
	let start = 0;
	while (start < meshes.length) {
		const triplanar = meshUsesTriplanar(meshes[start]);
		let end = start + 1;
		while (end < meshes.length && meshUsesTriplanar(meshes[end]) === triplanar) end++;
		const run = start === 0 && end === meshes.length ? meshes : meshes.slice(start, end);
		drawMeshList(renderer, sceneGraph, run, passState, { depthMask: false, triplanar });
		start = end;
	}
}

// Water is a fixed anchor: far side of the camera draws first, near side last.
function drawTranslucentPass(renderer, sceneGraph, meshes, passState, cameraPosition, waterLevelCnu, underwater) {
	sortBackToFront(meshes, cameraPosition);

	if (waterLevelCnu === null) { drawSortedRuns(renderer, sceneGraph, meshes, passState); return; }

	const above = [];
	const below = [];
	for (const mesh of meshes) (mesh.displayTransform.position.y > waterLevelCnu ? above : below).push(mesh);

	drawSortedRuns(renderer, sceneGraph, underwater ? above : below, passState);
	drawWaterPass(renderer, sceneGraph, passState);
	drawSortedRuns(renderer, sceneGraph, underwater ? below : above, passState);
}

const decalMarginSafety = 1.15; // back/elastic easings overshoot their keyframe extremes

// Widest animated footprint in rest-footprint units; 1 when untracked.
function decalAnimationMargin(entity, partId, decalEntry) {
	if (entity === null) return 1;

	let scale = 1, offset = 0;
	for (const setName in entity.animations) {
		const partTrack = entity.animations[setName].parts[partId];
		if (partTrack === undefined) continue;
		const target = partTrack.decals[decalEntry.id];
		if (target === undefined || target.transform === undefined) continue;
		for (const keyframe of target.transform.keyframes) {
			const value = keyframe.value;
			if (value.scale !== undefined)    scale  = Math.max(scale, Math.abs(value.scale.x), Math.abs(value.scale.y));
			if (value.position !== undefined) offset = Math.max(offset, Vector3Length(value.position));
		}
	}
	if (scale === 1 && offset === 0) return 1;

	// Position offset in rest half-extents.
	const rest = decalEntry.localTransform.scale;
	return (scale + offset / (Math.min(Math.abs(rest.x), Math.abs(rest.y)) / 2)) * decalMarginSafety;
}

// One VAO per (mesh, decal), never rebuilt.
function ensureDecalGeometry(renderer, mesh, decalEntry, index, entity, partId) {
	let meshDecals = renderer.decalGeometry.get(mesh);
	if (meshDecals === undefined) {
		meshDecals = [];
		renderer.decalGeometry.set(mesh, meshDecals);
	}
	if (meshDecals[index] !== undefined) return meshDecals[index];

	const gl = renderer.gl;
	const positionBuffer = gl.createBuffer();
	if (!positionBuffer) {
		Log("ENGINE", "Decal geometry buffer creation failed", "error", "Render");
		return null;
	}

	const dim    = mesh.dimensions;
	const facets = SelectDecalFacets(
		mesh.geometry,
		BuildDecalPlacementMatrix(dim, decalEntry.localTransform, decalEntry.side),
		ResolveDecalShapeCode(mesh.shape, decalEntry.side),
		{ x: dim.x / 2, y: dim.y / 2, z: dim.z / 2 },
		DecalRounding(mesh.shape, mesh.detail.primitiveOptions),
		decalAnimationMargin(entity, partId, decalEntry)
	);

	const vao = gl.createVertexArray();
	gl.bindVertexArray(vao);
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, facets.positions, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(renderer.decalShader.attributes.position);
	gl.vertexAttribPointer(renderer.decalShader.attributes.position, 3, gl.FLOAT, false, 0, 0);
	gl.bindVertexArray(null);

	meshDecals[index] = { vao, position: positionBuffer, vertexCount: facets.positions.length / 3 };
	return meshDecals[index];
}

// Face rotation matrices (column-major), aligning quad +Z to the face normal; exact trig at 0/90/180°.
const DECAL_FACE_ROTATIONS = {
	front:  [1, 0,  0, 0,  0, 1,  0, 0,  0,  0, 1, 0,  0, 0, 0, 1], // identity
	back:   [-1, 0, 0, 0,  0, 1,  0, 0,  0,  0,-1, 0,  0, 0, 0, 1], // 180° Y
	top:    [1, 0,  0, 0,  0, 0, -1, 0,  0,  1, 0, 0,  0, 0, 0, 1], // −90° X
	bottom: [1, 0,  0, 0,  0, 0,  1, 0,  0, -1, 0, 0,  0, 0, 0, 1], // +90° X
	right:  [0, 0, -1, 0,  0, 1,  0, 0,  1,  0, 0, 0,  0, 0, 0, 1], // +90° Y
	left:   [0, 0,  1, 0,  0, 1,  0, 0, -1,  0, 0, 0,  0, 0, 0, 1], // −90° Y
};

// Shared decal blend/depth state: additive-over-straight blend + polygon offset to avoid z-fighting.
function beginDecalState(gl, shader, passState) {
	configureTexturedMeshPass(gl, shader, passState);
	gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
	gl.enable(gl.POLYGON_OFFSET_FILL);
	gl.polygonOffset(-1, -1);
	gl.depthMask(false);
}

function endDecalState(gl) {
	gl.depthMask(true);
	gl.disable(gl.POLYGON_OFFSET_FILL);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // restore frame-init straight-alpha blend
}

// displayTransform to render, localTransform to export.
export function BuildDecalPlacementMatrix(dim, transform, side) {
	const pos = transform.position;
	const sc  = transform.scale;

	// Face center + local offset combined into a single translation in part-local CNU space.
	const faceTranslations = {
		front:  [pos.x,             pos.y,             pos.z + dim.z / 2],
		back:   [pos.x,             pos.y,             pos.z - dim.z / 2],
		top:    [pos.x,             pos.y + dim.y / 2, pos.z            ],
		bottom: [pos.x,             pos.y - dim.y / 2, pos.z            ],
		right:  [pos.x + dim.x / 2, pos.y,             pos.z            ],
		left:   [pos.x - dim.x / 2, pos.y,             pos.z            ],
	};

	const [tx, ty, tz] = faceTranslations[side];
	const c = Math.cos(transform.rotation.value), s = Math.sin(transform.rotation.value);
	// Part-local placement: T(face_center+local_offset) × R_face × R_z(rotation) × S(scale). Part world applied separately as u_partWorld.
	const tMatrix  = [1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 1, 0,  tx, ty, tz, 1];
	const rzMatrix = [c, s, 0, 0,  -s, c, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1];
	const sMatrix  = [sc.x, 0, 0, 0,  0, sc.y, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1];

	return MultiplyMatrix4(tMatrix, MultiplyMatrix4(DECAL_FACE_ROTATIONS[side], MultiplyMatrix4(rzMatrix, sMatrix)));
}

function drawDecalPass(renderer, sceneGraph, passState) {
	const gl = renderer.gl;
	const decalShader = renderer.decalShader;

	beginDecalState(gl, decalShader, passState);

	const drawDecalsForMesh = (mesh, entity = null, partId = null) => {
		if (mesh.customTextures.length === 0) return;

		// Mesh-level uniforms: identical for every decal on this mesh — set once.
		gl.uniformMatrix4fv(decalShader.uniforms.partWorld, false, renderMatrixFor(mesh));
		const dim = mesh.dimensions;
		gl.uniform3f(decalShader.uniforms.halfExtents, dim.x / 2, dim.y / 2, dim.z / 2);
		gl.uniform1f(decalShader.uniforms.rounding, DecalRounding(mesh.shape, mesh.detail.primitiveOptions));
		gl.uniform1i(decalShader.uniforms.texture, 0);

		mesh.customTextures.forEach((decalEntry, index) => {
			const geometry = ensureDecalGeometry(renderer, mesh, decalEntry, index, entity, partId);
			gl.bindVertexArray(geometry.vao);
			gl.uniform1i(decalShader.uniforms.shape, ResolveDecalShapeCode(mesh.shape, decalEntry.side));
			gl.uniformMatrix4fv(decalShader.uniforms.placement, false, new Float32Array(BuildDecalPlacementMatrix(dim, decalEntry.displayTransform, decalEntry.side)));
			if (decalEntry.mutable === true && decalEntry.activeSourceKey === null) {
				const tint = decalEntry.displayColor !== null ? decalEntry.displayColor : decalEntry.texture.primary;
				gl.uniform4f(decalShader.uniforms.tint, tint.r, tint.g, tint.b, tint.a);
			}
			else gl.uniform4f(decalShader.uniforms.tint, 1, 1, 1, 1);

			const baseKey = `${mesh.id}::customTexture::${index}`;
			const textureKey = decalEntry.activeSourceKey !== null ? `${baseKey}::${decalEntry.activeSourceKey}` : baseKey;
			const texture = ensureSceneTexture(renderer, sceneGraph, textureKey);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.drawArrays(gl.TRIANGLES, 0, geometry.vertexCount);
		});
	};

	sceneGraph.entities.forEach((entity) => {
		if (!entity.model) return;
		entity.model.parts.forEach((part) => drawDecalsForMesh(part.mesh, entity, part.id));
	});
	sceneGraph.obstacles.forEach((obstacle) => {
		if (!obstacle.performance.rendering) return;
		obstacle.parts.forEach((part) => drawDecalsForMesh(part));
	});
	sceneGraph.terrain.forEach((mesh) => { if (mesh.performance.rendering) drawDecalsForMesh(mesh); });

	gl.bindVertexArray(null);
	endDecalState(gl);
}

// Instanced counterpart of drawDecalPass — placement/shape are precomputed in buildScatterInstanceBuffers.
function drawScatterDecalPass(renderer, sceneGraph, passState) {
	if (renderer.scatterDecalBatches.length === 0) return;

	const gl = renderer.gl;
	const shader = renderer.scatterDecalShader;

	beginDecalState(gl, shader, passState);
	gl.uniform1f(shader.uniforms.cullRadius, passState.cullRadius);
	gl.uniform1i(shader.uniforms.texture, 0);
	gl.uniform4f(shader.uniforms.tint, 1, 1, 1, 1);
	gl.activeTexture(gl.TEXTURE0);

	renderer.scatterDecalBatches.forEach((batch) => {
		const dim = batch.dimensions;
		gl.uniform3f(shader.uniforms.halfExtents, dim.x / 2, dim.y / 2, dim.z / 2);
		gl.uniform1f(shader.uniforms.rounding, batch.rounding);

		batch.decalDraws.forEach((draw) => {
			gl.bindVertexArray(draw.vao);
			gl.uniform1i(shader.uniforms.shape, draw.shapeCode);
			gl.uniformMatrix4fv(shader.uniforms.placement, false, draw.placement);
			gl.bindTexture(gl.TEXTURE_2D, ensureSceneTexture(renderer, sceneGraph, draw.textureKey));
			gl.drawArraysInstanced(gl.TRIANGLES, 0, draw.vertexCount, batch.instanceCount);
		});
	});

	gl.bindVertexArray(null);
	endDecalState(gl);
}

// Flatten every void entry's relation voidWallMeshes into one list (used for textured draws).
function gatherVoidWallMeshes(entries) {
	const meshes = [];
	for (const entry of entries) {
		for (const id in entry.relations) meshes.push(...entry.relations[id].voidWallMeshes);
	}
	return meshes;
}

// Void walls are fixed at level build, so the shader split is resolved once.
function ensureVoidWallMeshes(renderer, sceneGraph) {
	if (renderer.voidWallMeshesBuilt) return;
	const meshes = gatherVoidWallMeshes(sceneGraph.voids.terrain);
	meshes.push(...gatherVoidWallMeshes(sceneGraph.voids.obstacles));
	renderer.voidWallUvMeshes        = meshes.filter((mesh) => !meshUsesTriplanar(mesh));
	renderer.voidWallTriplanarMeshes = meshes.filter(meshUsesTriplanar);
	renderer.voidWallMeshesBuilt     = true;
}

function drawVoidWalls(renderer, sceneGraph, passState) {
	ensureVoidWallMeshes(renderer, sceneGraph);
	drawMeshList(renderer, sceneGraph, renderer.voidWallUvMeshes,        passState);
	drawMeshList(renderer, sceneGraph, renderer.voidWallTriplanarMeshes, passState, { triplanar: true });
}

function drawScene(renderer, sceneGraph) {
	const gl = renderer.gl;

	syncCanvasSize(renderer);
	
	// Writes animated textures off-screen; viewport/depth/blend below restore what it touched.
	blendAnimatedTextures(renderer, sceneGraph);
	renderer.drawnTextures.clear(); // Cleared after the blend, so this frame's binds feed the next one.
	gl.viewport(0, 0, renderer.canvas.width, renderer.canvas.height);
	gl.enable(gl.DEPTH_TEST);
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	if (CONFIG.DEBUG.LEVELS.BackfaceCulling) gl.enable(gl.CULL_FACE);
	else gl.disable(gl.CULL_FACE);
	gl.clearColor(0.04, 0.05, 0.08, 1);
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

	const cameraState = sceneGraph.cameraConfig.state;

	const projection = new Float32Array(createPerspectiveMatrix(
		cameraState.fov,
		renderer.canvas.width / renderer.canvas.height,
		cameraState.near.value,
		cameraState.far.value
	));
	const view = new Float32Array(createLookAtMatrix(cameraState.position, cameraState.target, cameraState.up));

	const waterLevelCnu = sceneGraph.world.water.level === null ? null : sceneGraph.world.water.level.value;
	const underwater = waterLevelCnu !== null && cameraState.position.y < waterLevelCnu;
	const colorShift = underwater ? { r: -0.06, g: 0.02, b: 0.08 } : { r: 0, g: 0, b: 0 };
	const underwaterValue = underwater ? 1 : 0;
	const simDistance = GetSimDistanceValue().toWorldUnit();
	const worldInstances = PERFORMANCE_SCALING.SimDistance.Fractions.WorldInstances;
	const fogPercent = underwater ? CONFIG.RENDERING.Fog.Water : CONFIG.RENDERING.Fog.Air;
	const fogFull = simDistance * worldInstances.Cull * worldInstances.Fog * (fogPercent / 100);
	const cullRadius = simDistance * PERFORMANCE_SCALING.SimDistance.Fractions.Scatter.Cull;
	const skyStops = sceneGraph.world.skybox.stops;
	const passState = {
		projection, view, fogFull, colorShift, underwaterValue, cullRadius,
		skyStops    : fillSkyStops(renderer, skyStops),
		skyStopCount: skyStops.length,
		waterTint   : sceneGraph.world.water.tint,
	};

	drawSkyPass(renderer, passState);

	if (
		underwater &&
		sceneGraph.effects.underwater &&
		typeof sceneGraph.effects.underwater.particleHook === "function"
	) {
		sceneGraph.effects.underwater.particleHook(cameraState, sceneGraph);
	}

	const { terrain, obstacles, entitiesUv, entitiesTriplanar, entitiesTranslucent } = collectRenderableMeshes(sceneGraph);

	// === PASS 2.5: Void walls (textured interior surfaces inside void holes) ===
	drawVoidWalls(renderer, sceneGraph, passState);

	// === PASS A: hosts ship pre-carved from the builder; entities unaffected ===
	drawMeshList(renderer, sceneGraph, terrain,           passState);
	drawMeshList(renderer, sceneGraph, obstacles,         passState);
	drawMeshList(renderer, sceneGraph, entitiesUv,        passState);
	drawMeshList(renderer, sceneGraph, entitiesTriplanar, passState, { triplanar: true });

	// === PASS E: Decal quads (custom textures, alpha-blended on top of geometry) ===
	drawDecalPass(renderer, sceneGraph, passState);

	// === PASS B: Instanced scatter rendering ===
	if (!renderer.scatterInstancesBuilt) buildScatterInstanceBuffers(renderer, sceneGraph);

	if (renderer.scatterInstances.length > 0) {
		configureTexturedMeshPass(gl, renderer.scatterShader, passState);
		gl.uniform1f(renderer.scatterShader.uniforms.cullRadius, passState.cullRadius);

		renderer.scatterInstances.forEach(batch => {
			gl.bindVertexArray(batch.vao);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, ensureSceneTexture(renderer, sceneGraph, batch.textureID));
			gl.uniform1i(renderer.scatterShader.uniforms.texture, 0);
			gl.drawElementsInstanced(gl.TRIANGLES, batch.indexCount, gl.UNSIGNED_SHORT, 0, batch.instanceCount);
			gl.bindVertexArray(null);
		});
	}

	// === PASS B2: Instanced scatter decals (custom textures baked per batch) ===
	drawScatterDecalPass(renderer, sceneGraph, passState);

	// === PASS C: Trigger overlay (no depth write — color filter over all solid geometry) ===
	if (sceneGraph.debug.showTriggerVolumes) drawMeshList(renderer, sceneGraph, sceneGraph.triggers, passState, { depthMask: false });

	// === PASS D: Translucent meshes, water-anchored (sorted back-to-front, no depth write) ===
	drawTranslucentPass(renderer, sceneGraph, entitiesTranslucent, passState, cameraState.position, waterLevelCnu, underwater);

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

const GetElement = (elementId) => UIElement.get(elementId).element;
const SetElementText = (elementId, text) => UIElement.get(elementId).setText(text, true);
const SetElementSource = (elementId, src) => UIElement.get(elementId).setSource(src, true);
const SetElementStyle = (elementId, styles) => UIElement.get(elementId).setStyle(styles, true);
const FadeElement = (elementId, targetOpacity, durationSeconds) => UIElement.get(elementId).fadeTo(targetOpacity, durationSeconds);
const RemoveRoot = (rootId) => UIElement.removeRoot(rootId);
const ClearLevelRenderer = (rootId) => levelRendererCache.delete(rootId);

/* === EXPORTS === */
// Public render helpers for engine modules.

export {
	RenderPayload,
	ApplyRootStylesheet,
	RenderLevel,
	GetElement,
	SetElementText,
	SetElementSource,
	SetElementStyle,
	FadeElement,
	RemoveRoot,
	ClearLevelRenderer,
	DECAL_SHAPE_CODES,
	DECAL_FACE_ROTATIONS,
	ResolveDecalShapeCode,
	DecalSurfaceUv,
	SelectDecalFacets,
	CapsuleBand,
	DecalRounding
};