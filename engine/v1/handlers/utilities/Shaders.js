// Defines and exports all applicable shaders for Render.js

import { CONFIG, DEBUG_COLORS, FILTER_TUNING, PERFORMANCE_SCALING, SKY_STOP_LIMIT, SPRITE_TUNING } from "../../core/config.js";
import { Log } from "../../core/meta.js";
import { ResolveVector3Axis } from "../../math/Vector3.js";

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

	// Bind every attribute to a fixed slot so inputs the flat shader doesn't read still get a valid location.
	const attributeSlots = Object.values(options.attributeNames || {});
	attributeSlots.forEach((name, slot) => gl.bindAttribLocation(program, slot, name));
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
		attributes: resolveProgramLocations(options.attributeNames || {}, (name) => attributeSlots.indexOf(name)),
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

	// Same, for callers that already have the ray length.
	float viewRayElevation(vec3 viewRay, float viewDist) {
		return dot(viewRay, u_view[1].xyz) / viewDist;
	}
`;

const comicLightDirection = ResolveVector3Axis(FILTER_TUNING.Comic.LightDirection);

// Steps each face's brightness by how directly it faces the light; planes light from both sides.
const comicLightGLSL = `
	uniform float u_comic;
	float comicLight() {
		vec3 normal = normalize(cross(dFdx(v_viewPos), dFdy(v_viewPos)));
		normal = dot(normal, v_viewPos) > 0.0 ? -normal : normal;
		vec3 light = normalize(mat3(u_view) * vec3(${comicLightDirection.x.toFixed(4)}, ${comicLightDirection.y.toFixed(4)}, ${comicLightDirection.z.toFixed(4)}));
		float bands = ${FILTER_TUNING.Comic.Bands.toFixed(1)};
		float band = min(floor(max(dot(normal, light), 0.0) * bands) / (bands - 1.0), 1.0);
		return mix(1.0, mix(${FILTER_TUNING.Comic.ShadowFloor.toFixed(4)}, 1.0, band), u_comic);
	}
`;

function createFoggedTextureFragmentShader(
	sharedDeclarations, shadedExpression, premultiplied = false,
	varyings = "in vec2 v_uv;",
	texelComputation = "vec4 texel = texture(u_texture, v_uv);"
) {
	// Premultiplied textures: color shift and fog are scaled by alpha as well.
	const shiftExpr    = premultiplied ? "shaded.rgb + u_colorShift * shaded.a" : "shaded.rgb + u_colorShift";
	const fogColorExpr = premultiplied ? "fogColor * shaded.a"                  : "fogColor";

	// Flat shading tester: one color, no lighting, texture or fog.
	const flat = DEBUG_COLORS.FlatShading;
	const body = CONFIG.Debug.All && CONFIG.Debug.Levels.Performance.FlatShading
		? `fragColor = vec4(${flat.r.toFixed(4)}, ${flat.g.toFixed(4)}, ${flat.b.toFixed(4)}, 1.0);`
		: `
			// Light steps first, before the decal cut below can discard the pixel.
			float comicShade = comicLight();

			${texelComputation}
			vec4 shaded = ${shadedExpression};
			shaded.rgb *= comicShade;
			if (shaded.a <= 0.01) {
				discard;
			}

			float viewDist = length(v_viewPos);
			// Fog grows with distance cubed: nearby stays clear, full fog at the fog reach.
			float fog = clamp(viewDist / u_fogFull, 0.0, 1.0);
			fog *= fog * fog;
			vec3 shifted = ${shiftExpr};
			vec3 fogColor = sampleSky(viewRayElevation(v_viewPos, viewDist));
			vec3 finalColor = mix(shifted, ${fogColorExpr}, fog);
			fragColor = vec4(finalColor, shaded.a);
		`;

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
		${comicLightGLSL}
		void main() {
			${body}
		}
	`;
}

function Program(gl) {
	const vertexShaderSource = `#version 300 es
		in vec3 a_position;
		in vec2 a_uv;
		uniform mat4 u_projection;
		uniform mat4 u_view;
		uniform mat4 u_model;
		out vec2 v_uv;
		out vec3 v_viewPos;
		out float v_worldY;
		void main() {
			vec4 world = u_model * vec4(a_position, 1.0);
			vec4 viewPos = u_view * world;
			gl_Position = u_projection * viewPos;
			v_uv = a_uv;
			v_viewPos = viewPos.xyz;
			v_worldY = world.y;
		}
	`;

	// u_waterClip: x = water level, y = side kept (+1 above, -1 below, 0 keeps all).
	return createLinkedProgram(gl, {
		vertexShaderSource: vertexShaderSource,
		fragmentShaderSource: createFoggedTextureFragmentShader(
			"uniform vec4 u_tint; uniform vec2 u_waterClip;",
			"vec4(texel.rgb * u_tint.rgb, texel.a * u_tint.a * step(0.0, u_waterClip.y * (v_worldY - u_waterClip.x)))",
			false,
			"in vec2 v_uv; in float v_worldY;"
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
			waterClip   : "u_waterClip",
			fogFull     : "u_fogFull",
			colorShift  : "u_colorShift",
			underwater  : "u_underwater",
			skyStops    : "u_skyStops[0]",
			skyStopCount: "u_skyStopCount",
			waterTint   : "u_waterTint",
			comic       : "u_comic",
		},
		createError    : "WebGL program creation failed",
		linkErrorPrefix: "Program link error",
	});
}

function EntityTriplanarProgram(gl) {
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
			comic       : "u_comic",
		},
		createError    : "WebGL triplanar program creation failed",
		linkErrorPrefix: "Triplanar program link error",
	});
}

function SpriteProgram(gl) {
	const referenceDistance = SPRITE_TUNING.ScreenSizeDistance.toWorldUnit();

	// Turn the plane around its center to follow the camera.
	const vertexShaderSource = `#version 300 es
		in vec3 a_position;
		in vec2 a_uv;
		uniform mat4 u_projection;
		uniform mat4 u_view;
		uniform mat4 u_model;
		uniform vec3 u_cameraPosition;
		uniform float u_follow;
		uniform float u_distanceScaling;
		out vec2 v_uv;
		out vec3 v_viewPos;
		out float v_centerDistance;
		void main() {
			vec3 center = (u_model * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
			float centerDistance = length((u_view * vec4(center, 1.0)).xyz);

			// Follow the camera's orientation, not its position. Passing over or beside a sprite then never turns it.
			vec3 cameraRight = vec3(u_view[0][0], u_view[1][0], u_view[2][0]);
			vec3 cameraBack  = vec3(u_view[0][2], u_view[1][2], u_view[2][2]);

			// Start from the part's own right, up and front, each as long as its scale. Not following keeps them.
			vec3 size = vec3(length(u_model[0].xyz), length(u_model[1].xyz), length(u_model[2].xyz));
			mat3 axes = mat3(u_model);

			// Full: take the camera's right, up and backward, laying the plane flat on the screen.
			if (u_follow > 2.5) {
				vec3 cameraUp = vec3(u_view[0][1], u_view[1][1], u_view[2][1]);
				axes = mat3(cameraRight * size.x, cameraUp * size.y, cameraBack * size.z);
			}

			// Vertical: tilt around the part's right toward the camera's height, measured from where the camera is.
			else if (u_follow > 1.5) {
				vec3 right = u_model[0].xyz / size.x;
				vec3 up    = u_model[1].xyz / size.y;
				vec3 front = cross(right, up);
				vec3 toCamera = u_cameraPosition - center;
				float ahead = dot(toCamera, front);
				float level = length(vec2(ahead, dot(toCamera, right)));

				// Turn to whichever side the camera is on, keeping the image upright. The swap happens at the side, where it's edge-on.
				float side = ahead < 0.0 ? -1.0 : 1.0;

				// Lean toward the camera's height, easing to upright as the camera reaches the side.
				float tilt = level > 1e-5 ? atan(dot(toCamera, up), level) * abs(ahead) / level : sign(dot(toCamera, up)) * 1.5707963;
				vec3 face = front * side * cos(tilt) + up * sin(tilt);
				axes = mat3(right * side * size.x, cross(face, right * side) * size.y, face * size.z);
			}

			// Horizontal: stand on world up and turn around it with the camera. Seen from straight above, it's edge-on.
			else if (u_follow > 0.5) {
				vec3 face = vec3(cameraBack.x, 0.0, cameraBack.z);
				face = length(face) > 1e-5 ? normalize(face) : vec3(0.0, 0.0, 1.0);
				axes = mat3(vec3(face.z, 0.0, -face.x) * size.x, vec3(0.0, size.y, 0.0), face * size.z);
			}

			// Without distance scaling, grow with distance to hold one size on screen.
			vec3 offset = axes * a_position;
			offset *= u_distanceScaling > 0.5 ? 1.0 : centerDistance / ${referenceDistance.toFixed(4)};
			vec4 viewPos = u_view * vec4(center + offset, 1.0);

			gl_Position = u_projection * viewPos;
			v_uv = a_uv;
			v_viewPos = viewPos.xyz;
			v_centerDistance = centerDistance;
		}
	`;

	// Fade out over the end of the fade range, and premultiply generated textures. A negative range never fades.
	const fadeTexel = `float fade = u_fadeRange < 0.0 ? 1.0 : 1.0 - smoothstep(u_fadeRange * ${SPRITE_TUNING.FadeStart.toFixed(4)}, u_fadeRange, v_centerDistance);
			vec4 texel = texture(u_texture, v_uv);
			texel.rgb *= mix(texel.a, 1.0, u_premultiplied);`;

	// Output premultiplied color, blended like decals.
	return createLinkedProgram(gl, {
		vertexShaderSource: vertexShaderSource,
		fragmentShaderSource: createFoggedTextureFragmentShader(
			"uniform vec4 u_tint; uniform float u_fadeRange; uniform float u_premultiplied;",
			"vec4(texel.rgb * u_tint.rgb, texel.a) * (u_tint.a * fade)",
			true,
			"in vec2 v_uv; in float v_centerDistance;",
			fadeTexel
		),
		attributeNames: {
			position: "a_position",
			uv      : "a_uv",
		},
		uniformNames: {
			projection     : "u_projection",
			view           : "u_view",
			model          : "u_model",
			texture        : "u_texture",
			tint           : "u_tint",
			cameraPosition : "u_cameraPosition",
			follow         : "u_follow",
			distanceScaling: "u_distanceScaling",
			fadeRange      : "u_fadeRange",
			premultiplied  : "u_premultiplied",
			fogFull        : "u_fogFull",
			colorShift     : "u_colorShift",
			underwater     : "u_underwater",
			skyStops       : "u_skyStops[0]",
			skyStopCount   : "u_skyStopCount",
			waterTint      : "u_waterTint",
			comic          : "u_comic",
		},
		createError    : "WebGL sprite program creation failed",
		linkErrorPrefix: "Sprite program link error",
	});
}

function LineProgram(gl) {
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
	// Random cutoff per instance, capped at 0.75 so every instance is fully solid up close.
	float cullHash = fract(sin(dot(instanceOrigin, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 0.75;
	if (cullHash > fade) {
		gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
		return;
	}
	// Dissolve over the last quarter of each instance's own margin.
	float instanceAlpha = clamp((fade - cullHash) * 4.0, 0.0, 1.0);
`;

function ScatterProgram(gl) {
	// Draw scatter instances, each with its own model matrix and tint from vertex attributes.
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
			comic       : "u_comic",
		},
		linkErrorPrefix: "Scatter shader link error",
	});
}

// Exact mirror of DecalSurfaceUv in Render.js.
const decalSurfaceUvGLSL = `
	const int SHAPE_FLAT = 0;
	const int SHAPE_SPHERE = 1;
	const int SHAPE_CYLINDER = 2;
	const int SHAPE_CAPSULE = 3;

	// The decal's right and up directions, laid flat on the surface at its center.
	void decalSurfaceFrame(vec3 centerDir, vec3 u, vec3 v, out vec3 right, out vec3 up) {
		right = normalize(u - centerDir * dot(u, centerDir));
		up = cross(centerDir, right);
		if (dot(up, v) < 0.0) up = -up;
	}

	// Tube height, continued onto the cap.
	float decalMeridianArc(vec3 point, float capRadius, float cylinderHalf, int shape) {
		if (shape == SHAPE_CYLINDER || abs(point.y) <= cylinderHalf) return point.y;
		vec3 n = normalize(point - vec3(0.0, sign(point.y) * cylinderHalf, 0.0));
		return sign(point.y) * cylinderHalf + capRadius * asin(clamp(n.y, -1.0, 1.0));
	}

	// Angle around the vertical axis. A point on the axis itself uses the fallback angle.
	float decalAxisAngle(float z, float x, float fallback) {
		return x == 0.0 && z == 0.0 ? fallback : atan(z, x);
	}

	vec2 decalSurfaceUv(int shape, vec3 point, mat4 placement, vec3 r, float rounding) {
		vec3 center = placement[3].xyz;
		// Floored: zero scale stays finite.
		float width = max(length(placement[0].xyz), 1e-6), height = max(length(placement[1].xyz), 1e-6);
		vec3 u = placement[0].xyz / width, v = placement[1].xyz / height;

		if (shape == SHAPE_FLAT) {
			vec3 offset = point - center;
			return vec2(dot(offset, u) / width, dot(offset, v) / height);
		}

		float capRadius = r.y * rounding;
		float cylinderHalf = r.y - capRadius;
		bool onCap = shape == SHAPE_CAPSULE && abs(center.y) > cylinderHalf;
		vec3 right, up;

		// Sphere or capsule cap: unrolls the surface outward from the decal's center.
		if (shape == SHAPE_SPHERE || onCap) {
			vec3 origin = vec3(0.0, onCap ? clamp(center.y, -cylinderHalf, cylinderHalf) : 0.0, 0.0);
			float radius = onCap ? capRadius : length(center);
			vec3 centerDir = normalize(center - origin), n = normalize(point - origin);
			decalSurfaceFrame(centerDir, u, v, right, up);
			vec2 bearing = vec2(dot(n, right), dot(n, up));
			float span = length(bearing);
			float turn = 6.283185307179586 * radius;
			return (span > 1e-12 ? radius * acos(clamp(dot(n, centerDir), -1.0, 1.0)) * bearing / span : vec2(0.0))
			     / vec2(min(width, turn), min(height, turn));
		}

		// Tube side: unrolls the surface flat, distance around by distance along.
		vec3 centerDir = normalize(center - vec3(0.0, center.y, 0.0));
		vec3 meridian = normalize(vec3(0.0, 1.0, 0.0) - centerDir * centerDir.y);
		vec3 azimuth = cross(centerDir, meridian);
		decalSurfaceFrame(centerDir, u, v, right, up);
		float rho = max(length(vec2(center.x, center.z)), 1e-6);
		float centerAngle = decalAxisAngle(center.z, center.x, 0.0);
		float dTheta = decalAxisAngle(point.z, point.x, centerAngle) - centerAngle;
		if (dTheta >  3.141592653589793) dTheta -= 6.283185307179586;
		if (dTheta < -3.141592653589793) dTheta += 6.283185307179586;
		float arc = rho * dTheta;
		float rise = decalMeridianArc(point, capRadius, cylinderHalf, shape) - decalMeridianArc(center, capRadius, cylinderHalf, shape);
		return vec2((arc * dot(right, azimuth) + rise * dot(right, meridian)) / min(width, 6.283185307179586 * rho),
		            (arc * dot(up, azimuth) + rise * dot(up, meridian)) / height);
	}
`;

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

function DecalProgram(gl) {
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
			comic       : "u_comic",
		},
		createError    : "decal shader program creation failed",
		linkErrorPrefix: "decal shader link error",
	});
}

function ScatterDecalProgram(gl) {
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
			comic       : "u_comic",
		},
		createError    : "scatter decal shader program creation failed",
		linkErrorPrefix: "scatter decal shader link error",
	});
}

// Fullscreen backdrop; the view ray is the exact inverse of the projection in use.
function SkyProgram(gl) {
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
function BlendProgram(gl) {
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

const fullscreenVertexGLSL = `#version 300 es
	in vec2 a_position;
	void main() {
		gl_Position = vec4(a_position, 0.0, 1.0);
	}
`;

// Ink lines on edges and creases, faded by fog.
function InkProgram(gl) {
	const { Lines } = FILTER_TUNING;

	const fragmentShaderSource = `#version 300 es
		precision highp float;
		uniform sampler2D u_depth;
		uniform mat4 u_view;
		uniform vec2 u_rayScale;
		uniform float u_near;
		uniform float u_far;
		uniform float u_fogFull;
		uniform float u_cameraY;
		uniform vec2 u_waterClip;
		out vec4 fragColor;

		// Distance from the camera along its view direction, read from the depth buffer.
		float viewDepth(ivec2 pixel) {
			ivec2 clamped = clamp(pixel, ivec2(0), textureSize(u_depth, 0) - 1);
			float ndc = texelFetch(u_depth, clamped, 0).r * 2.0 - 1.0;
			return 2.0 * u_near * u_far / (u_far + u_near - ndc * (u_far - u_near));
		}

		void main() {
			ivec2 pixel = ivec2(gl_FragCoord.xy);
			float z = viewDepth(pixel);

			// How sharply the surface bends here: high at outlines and creases, zero on flat ground.
			ivec2 across = ivec2(${Lines.Width}, 0);
			ivec2 down = ivec2(0, ${Lines.Width});
			float neighbors = 1.0 / viewDepth(pixel + across) + 1.0 / viewDepth(pixel - across) + 1.0 / viewDepth(pixel + down) + 1.0 / viewDepth(pixel - down);
			float bend = abs(neighbors * z - 4.0);

			// No lines on anything seen through the water surface.
			vec2 ndc = gl_FragCoord.xy / vec2(textureSize(u_depth, 0)) * 2.0 - 1.0;
			float worldY = u_cameraY + dot(vec3(ndc * u_rayScale * z, -z), u_view[1].xyz);
			float keep = step(0.0, u_waterClip.y * (worldY - u_waterClip.x));

			float fog = clamp(z / u_fogFull, 0.0, 1.0);
			float ink = smoothstep(${Lines.Threshold.toFixed(6)}, ${(Lines.Threshold * 2).toFixed(6)}, bend) * (1.0 - fog * fog * fog) * keep;
			fragColor = vec4(${Lines.Color.r.toFixed(4)}, ${Lines.Color.g.toFixed(4)}, ${Lines.Color.b.toFixed(4)}, ink);
		}
	`;

	return createLinkedProgram(gl, {
		vertexShaderSource: fullscreenVertexGLSL,
		fragmentShaderSource,
		attributeNames : { position: "a_position" },
		uniformNames   : {
			depth     : "u_depth",
			view      : "u_view",
			rayScale  : "u_rayScale",
			near      : "u_near",
			far       : "u_far",
			fogFull   : "u_fogFull",
			cameraY   : "u_cameraY",
			waterClip : "u_waterClip",
		},
		createError    : "ink program creation failed",
		linkErrorPrefix: "ink shader link error",
	});
}

// Copies the filtered scene onto the canvas, adding comic color on geometry when enabled.
function FilterProgram(gl) {
	const { Posterize, Halftone } = FILTER_TUNING.Comic;

	const fragmentShaderSource = `#version 300 es
		precision highp float;
		uniform sampler2D u_color;
		uniform sampler2D u_depth;
		uniform float u_comic;
		out vec4 fragColor;

		void main() {
			ivec2 pixel = ivec2(gl_FragCoord.xy);
			vec3 color = texelFetch(u_color, pixel, 0).rgb;
			float depth = texelFetch(u_depth, pixel, 0).r;

			// Fewer color steps and halftone dots in darker tones, skipping the sky.
			if (u_comic > 0.5 && depth < 1.0) {
				float levels = ${Posterize.Levels.toFixed(1)};
				color = mix(color, floor(color * levels + 0.5) / levels, ${Posterize.Strength.toFixed(4)});
				float shade = clamp(1.0 - dot(color, vec3(0.299, 0.587, 0.114)) / ${Halftone.Below.toFixed(4)}, 0.0, 1.0);
				float radius = sqrt(shade) * 0.5;
				vec2 cell = mat2(0.7071, 0.7071, -0.7071, 0.7071) * gl_FragCoord.xy / ${Halftone.CellSize.toFixed(1)};
				float inDot = 1.0 - smoothstep(radius - 0.08, radius, length(fract(cell) - 0.5));
				color *= 1.0 - inDot * ${Halftone.Strength.toFixed(4)};
			}

			fragColor = vec4(color, 1.0);

			// Copied so the debug overlays drawn afterwards still hide behind geometry.
			gl_FragDepth = depth;
		}
	`;

	return createLinkedProgram(gl, {
		vertexShaderSource: fullscreenVertexGLSL,
		fragmentShaderSource,
		attributeNames : { position: "a_position" },
		uniformNames   : { color: "u_color", depth: "u_depth", comic: "u_comic" },
		createError    : "filter program creation failed",
		linkErrorPrefix: "filter shader link error",
	});
}

export default {
	Program,
	EntityTriplanarProgram,
	SpriteProgram,
	LineProgram,
	ScatterProgram,
	DecalProgram,
	ScatterDecalProgram,
	SkyProgram,
	BlendProgram,
	InkProgram,
	FilterProgram,
};
