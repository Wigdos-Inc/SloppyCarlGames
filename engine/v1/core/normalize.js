// Normalization of Game Payloads for Engine use
// Exclusively called by validate.js

import { NormalizeVector3 } from "../math/Vector3.js";
import { ToNumber, Unit, UnitVector3 } from "../math/Utilities.js";
import { Log } from "./meta.js";

/* === UI Data === */

function MenuUIPayload(payload) {
	const source = normalizeObject(payload);
	const rawElements = normalizeArray(source.elements);
	const elements = [];

	for (let i = 0; i < rawElements.length; i += 1) {
		const normalized = normalizeElement(rawElements[i], `elements[${i}]`);
		if (normalized) {
			elements.push(normalized);
		}
	}

	return {
		...source,
		screenId: normalizeString(source.screenId, ""),
		rootId: normalizeString(source.rootId, "engine-ui-root"),
		elements,
		music: normalizeMusic(source.music),
	};
}

function normalizeMusic(music) {
	const source = normalizeObject(music);
	if (Object.keys(source).length === 0) {
		return null;
	}

	const name = normalizeString(source.name, "");
	const src = normalizeString(source.src, "");
	if (name.length === 0 || src.length === 0) {
		Log("ENGINE", "UI payload music config ignored: 'name' and 'src' are both required when music is provided.", "warn", "Validation");
		return null;
	}

	return {
		...source,
		name,
		src,
	};
}

function normalizeElement(element, path) {
	const source = normalizeObject(element);
	if (Object.keys(source).length === 0) {
		Log("ENGINE", `UI payload dropped malformed element at '${path}'.`, "warn", "Validation");
		return null;
	}

	const children = [];
	const sourceChildren = normalizeArray(source.children);
	for (let i = 0; i < sourceChildren.length; i += 1) {
			const normalized = normalizeElement(sourceChildren[i], `${path}.children[${i}]`);
			if (normalized) {
				children.push(normalized);
			}
	}

	const attributes = normalizeObject(source.attributes);
	const styles = normalizeObject(source.styles);

	const eventMap = normalizeActionMap(source.events, `${path}.events`);
	const onMap = normalizeActionMap(source.on, `${path}.on`);

	return {
		...source,
		type: normalizeString(source.type, "div"),
		id: normalizeString(source.id, undefined),
		className: normalizeString(source.className, undefined),
		text: typeof source.text === "string" ? source.text : source.text !== undefined ? String(source.text) : undefined,
		attributes,
		styles,
		events: eventMap,
		on: onMap,
		children,
	};
}

function normalizeActionMap(actions, path) {
	const source = normalizeObject(actions);
	if (Object.keys(source).length === 0) {
		return {};
	}

	const normalized = {};
	const keys = Object.keys(source);
	for (let index = 0; index < keys.length; index += 1) {
		const key = keys[index];
		if (typeof key !== "string" || key.length === 0) {
			continue;
		}

		const value = normalizeAction(source[key], `${path}.${key}`);
		if (value !== null) {
			normalized[key] = value;
		}
	}

	return normalized;
}

function normalizeAction(action, path) {
	if (typeof action === "string") {
		const trimmed = action.trim();
		if (trimmed.length === 0) {
			Log("ENGINE", `UI payload dropped empty string action at '${path}'.`, "warn", "Validation");
			return null;
		}
		return trimmed;
	}

	if (Array.isArray(action)) {
		const list = [];
		for (let i = 0; i < action.length; i += 1) {
			const normalized = normalizeAction(action[i], `${path}[${i}]`);
			if (normalized !== null) {
				list.push(normalized);
			}
		}

		if (list.length === 0) {
			Log("ENGINE", `UI payload dropped empty action list at '${path}'.`, "warn", "Validation");
			return null;
		}

		return list;
	}

	if (!action || typeof action !== "object") {
		Log("ENGINE", `UI payload dropped malformed action at '${path}'.`, "warn", "Validation");
		return null;
	}

	if (action.type === "ui") {
		if (!action.payload || typeof action.payload !== "object") {
			Log("ENGINE", `UI payload dropped invalid 'ui' action at '${path}': missing object payload.`, "warn", "Validation");
			return null;
		}
		return { ...action };
	}

	if (action.type === "request") {
		if (typeof action.screenId !== "string" || action.screenId.length === 0) {
			Log("ENGINE", `UI payload dropped invalid 'request' action at '${path}': missing screenId.`, "warn", "Validation");
			return null;
		}
		return { ...action, screenId: action.screenId };
	}

	if (action.type === "event") {
		if (typeof action.name !== "string" || action.name.length === 0) {
			Log("ENGINE", `UI payload dropped invalid 'event' action at '${path}': missing event name.`, "warn", "Validation");
			return null;
		}
		return { ...action, name: action.name };
	}

	if (action.type === "exit") {
		return { ...action };
	}

	if (action.type === "style") {
		if (typeof action.targetId !== "string" || action.targetId.length === 0) {
			Log("ENGINE", `UI payload dropped invalid 'style' action at '${path}': missing targetId.`, "warn", "Validation");
			return null;
		}

		const stylesSource = normalizeObject(action.styles);
		const styles = Object.keys(stylesSource).length > 0 ? { ...stylesSource } : null;
		if (!styles) {
			Log("ENGINE", `UI payload dropped invalid 'style' action at '${path}': missing styles object.`, "warn", "Validation");
			return null;
		}

		styles.classList = normalizeStyleClassList(styles.classList);
		return {
			...action,
			targetId: action.targetId,
			styles,
		};
	}

	Log("ENGINE", `UI payload dropped unsupported action type at '${path}'.`, "warn", "Validation");
	return null;
}

function normalizeStyleClassList(classListConfig) {
	const add = [];
	const remove = [];

	const classListArray = normalizeArray(classListConfig);
	if (classListArray.length > 0) {
		for (let index = 0; index < classListArray.length; index += 1) {
			const className = classListArray[index];
			if (typeof className === "string" && className.length > 0) {
				add.push(className);
			}
		}
		return { add, remove };
	}

	const source = normalizeObject(classListConfig);
	if (Object.keys(source).length > 0) {
		const addClasses = normalizeArray(source.add);
		for (let index = 0; index < addClasses.length; index += 1) {
			const className = addClasses[index];
			if (typeof className === "string" && className.length > 0) {
				add.push(className);
			}
		}

		const removeClasses = normalizeArray(source.remove);
		for (let index = 0; index < removeClasses.length; index += 1) {
			const className = removeClasses[index];
			if (typeof className === "string" && className.length > 0) {
				remove.push(className);
			}
		}
	}

	return { add, remove };
}

/* === Level Data === */

function normalizeObject(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeString(value, fallback = "") {
	return (value && typeof value === "string" && value.length > 0) ? value : fallback;
}

function normalizeArray(value) {
	return Array.isArray(value) ? value : [];
}

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value);
}

function isVector3Like(value) {
	// Check if value matches vector structure: { x,y,z }
	return value
		&& typeof value === "object"
		&& !Array.isArray(value)
		&& isFiniteNumber(value.x)
		&& isFiniteNumber(value.y)
		&& isFiniteNumber(value.z);
}

function normalizeGeometryComplexity(value, contextPath) {
	// Check if complexity is provided.
	if (typeof value !== "string") {
		Log("ENGINE", `Object payload ${contextPath} missing complexity; defaulted to 'medium'.`, "warn", "Validation");
		return "medium";
	}

	// Check if complexity matches expected values
	const normalized = value.trim().toLowerCase();
	if (normalized === "low" || normalized === "high" || normalized === "medium") return normalized;

	Log("ENGINE", `Object payload ${contextPath} complexity '${value}' invalid; defaulted to 'medium'.`, "warn", "Validation");
	return "medium";
}

function normalizeShapeAlias(source, contextPath) {
	const shape = normalizeString(source.shape, "");
	if (shape.length > 0) return shape.toLowerCase();

	const primitive = normalizeString(source.primitive, "");
	if (primitive.length > 0) return primitive.toLowerCase();

	Log(
		"ENGINE", 
		`Object payload ${contextPath} missing 'shape' or 'primitive' definition; defaulted to 'cube'.`, 
		"warn", 
		"Validation"
	);
	return "cube";
}

function normalizeVector3WithWarning(value, fallback, contextPath, fieldName) {
	if (!isVector3Like(value)) {
		Log(
			"ENGINE", 
			`Object payload ${contextPath} ${fieldName} malformed or missing; defaulted to (${fallback.x}, ${fallback.y}, ${fallback.z}).`, 
			"warn", 
			"Validation"
		);
	}

	return NormalizeVector3(value, fallback);
}

function normalizePrimitiveOptions(source, contextPath) {
	const src = normalizeObject(source);
	const rawPrimitive = source && source.primitiveOptions;
	const rawGeometry = source && source.geometry;
	const rawDetail = source && source.detail;

	if (
		rawPrimitive !== undefined && 
		(typeof rawPrimitive !== "object" || Array.isArray(rawPrimitive) || rawPrimitive === null)
	) {
		Log(
			"ENGINE", 
			`Object payload ${contextPath} primitiveOptions malformed; defaulted to empty object.`, 
			"warn", 
			"Validation"
		);
	}
	if (
		rawGeometry !== undefined && 
		(typeof rawGeometry !== "object" || Array.isArray(rawGeometry) || rawGeometry === null)
	) {
		Log(
			"ENGINE", 
			`Object payload ${contextPath} geometry malformed; geometry aliases ignored.`, 
			"warn", 
			"Validation"
		);
	}
	if (
		rawDetail !== undefined && 
		(typeof rawDetail !== "object" || Array.isArray(rawDetail) || rawDetail === null)
	) {
		Log(
			"ENGINE", 
			`Object payload ${contextPath} detail malformed; detail aliases ignored.`, 
			"warn", 
			"Validation"
		);
	}

	const primitive = normalizeObject(src.primitiveOptions);
	const geometry = normalizeObject(src.geometry);
	const detail = normalizeObject(src.detail);

	return {
		angle: primitive.angle || primitive.rampAngle || geometry.angle || src.angle || src.rampAngle || null,
		thickness: ToNumber(primitive.thickness, ToNumber(geometry.thickness, ToNumber(detail.thickness, ToNumber(src.thickness, 0)))),
		radius: ToNumber(primitive.radius, ToNumber(geometry.radius, ToNumber(detail.radius, ToNumber(src.radius, 0)))),
		subdivisionsX: Math.max(1, Math.floor(ToNumber(primitive.subdivisionsX, ToNumber(geometry.subdivisionsX, ToNumber(src.subdivisionsX, 1))))),
		subdivisionsZ: Math.max(1, Math.floor(ToNumber(primitive.subdivisionsZ, ToNumber(geometry.subdivisionsZ, ToNumber(src.subdivisionsZ, 1))))),
	};
}

function normalizeScatterForDetail(source, detail, contextPath) {
	if (Array.isArray(detail.scatter)) {
		return normalizeScatterRequests(detail.scatter, `${contextPath}.detail.scatter`);
	}

	if (source.scatter !== undefined) {
		if (Array.isArray(source.scatter)) {
			return normalizeScatterRequests(source.scatter, `${contextPath}.scatter`);
		}

		Log("ENGINE", `Object payload ${contextPath} scatter malformed; defaulted to empty array.`, "warn", "Validation");
	}

	return [];
}

function normalizeTerrainObject(definition, index) {
	const source = normalizeObject(definition);
	const position = normalizeVector3WithWarning(source.position, { x: 0, y: 0, z: 0 }, `terrain[${index}]`, "position");
	const dimensions = normalizeVector3WithWarning(source.dimensions || source.size, { x: 1, y: 1, z: 1 }, `terrain[${index}]`, "dimensions");
	const rotation = normalizeVector3WithWarning(source.rotation, { x: 0, y: 0, z: 0 }, `terrain[${index}]`, "rotation");
	const pivot = normalizeVector3WithWarning(source.pivot, { x: 0, y: 0, z: 0 }, `terrain[${index}]`, "pivot");
	const detail = normalizeObject(source.detail);
	const texture = normalizeTextureDescriptor(source, { textureID: "grass-soft", defaultColor: { r: 0.28, g: 0.58, b: 0.42, a: 1 } }, `terrain[${index}]`);
	const shape = normalizeShapeAlias(source, `terrain[${index}]`);
	const complexity = normalizeGeometryComplexity(source.complexity, `terrain[${index}]`);
	const primitiveOptions = normalizePrimitiveOptions(source, `terrain[${index}]`);

	return {
		...source,
		id: normalizeString(source.id, `terrain-${index}`),
		shape: shape,
		complexity: complexity,
		position: new UnitVector3(position.x, position.y, position.z, "cnu"),
		dimensions: new UnitVector3(dimensions.x, dimensions.y, dimensions.z, "cnu"),
		rotation: new UnitVector3(rotation.x, rotation.y, rotation.z, "degrees").toRadians(true),
		scale: NormalizeVector3(source.scale, { x: 1, y: 1, z: 1 }),
		pivot: new UnitVector3(pivot.x, pivot.y, pivot.z, "cnu"),
		primitiveOptions: primitiveOptions,
		texture: texture,
		detail: {
			...detail,
			scatter: normalizeScatterForDetail(source, detail, `terrain[${index}]`),
		},
	};
}

function normalizeTrigger(definition, index) {
	const source = normalizeObject(definition);
	const start = NormalizeVector3(source.start, { x: 0, y: 0, z: 0 });
	const end = NormalizeVector3(source.end, start);
	const triggerType = normalizeString(source.type, "");
	const payload = normalizeObject(source.payload);
	if (source.payload !== undefined && Object.keys(payload).length === 0) {
		Log(
			"ENGINE", 
			`Trigger '${normalizeString(source.id, `trigger-${index}`)}' payload was malformed and was normalized to an empty object.`, 
			"warn", 
			"Validation"
		);
	}

	let activateOnce = true;
	if (typeof source.activateOnce === "boolean") {
		activateOnce = source.activateOnce;
	} else if (source.activateOnce !== undefined) {
		Log(
			"ENGINE", 
			`Trigger '${normalizeString(source.id, `trigger-${index}`)}' activateOnce was malformed and defaulted to true.`, 
			"warn", 
			"Validation"
		);
	}

	return {
		...source,
		id: normalizeString(source.id, `trigger-${index}`),
		type: triggerType,
		start: new UnitVector3(start.x, start.y, start.z, "cnu"),
		end: new UnitVector3(end.x, end.y, end.z, "cnu"),
		payload,
		activateOnce,
	};
}

function normalizeObstacle(definition, index) {
	const source = normalizeObject(definition);
	const position = normalizeVector3WithWarning(source.position, { x: 0, y: 0, z: 0 }, `obstacle[${index}]`, "position");
	const dimensions = normalizeVector3WithWarning(source.dimensions || source.size, { x: 1, y: 1, z: 1 }, `obstacle[${index}]`, "dimensions");
	const rotation = normalizeVector3WithWarning(source.rotation, { x: 0, y: 0, z: 0 }, `obstacle[${index}]`, "rotation");
	const pivot = normalizeVector3WithWarning(source.pivot, { x: 0, y: 0, z: 0 }, `obstacle[${index}]`, "pivot");
	const detail = normalizeObject(source.detail);
	const texture = normalizeTextureDescriptor(source, { textureID: "default-grid" }, `obstacle[${index}]`);
	const shape = normalizeShapeAlias(source, `obstacle[${index}]`);
	const complexity = normalizeGeometryComplexity(source.complexity, `obstacle[${index}]`);
	const primitiveOptions = normalizePrimitiveOptions(source, `obstacle[${index}]`);

	// Normalize optional parts for multi-part obstacles so builders can assume canonical shapes
	const parts = Array.isArray(source.parts)
		? source.parts.map((part, pIndex) => {
			const p = normalizeObject(part);
			const dims = NormalizeVector3(p.dimensions || p.size, { x: 1, y: 1, z: 1 });
			const localPosition = NormalizeVector3(p.localPosition, { x: 0, y: 0, z: 0 });
			const localRotation = NormalizeVector3(p.localRotation, { x: 0, y: 0, z: 0 });
			const texture = normalizeTextureDescriptor(p, { textureID: "default-grid" }, `obstacle[${index}].parts[${pIndex}]`);
			return {
				...p,
				id: normalizeString(p.id, `${normalizeString(source.id, `obstacle-${index}`)}-part-${pIndex}`),
				shape: normalizeShapeAlias(p, `obstacle[${index}].parts[${pIndex}]`),
				complexity: normalizeGeometryComplexity(p.complexity, `obstacle[${index}].parts[${pIndex}]`),
				dimensions: new UnitVector3(dims.x, dims.y, dims.z, "cnu"),
				localPosition: new UnitVector3(localPosition.x, localPosition.y, localPosition.z, "cnu"),
				localRotation: new UnitVector3(localRotation.x, localRotation.y, localRotation.z, "degrees").toRadians(true),
				localScale: NormalizeVector3(p.localScale, { x: 1, y: 1, z: 1 }),
				primitiveOptions: normalizePrimitiveOptions(p, `obstacle[${index}].parts[${pIndex}]`),
				texture: texture,
				detail: {
					...normalizeObject(p.detail),
					scatter: normalizeScatterForDetail(p, normalizeObject(p.detail), `obstacle[${index}].parts[${pIndex}]`),
				},
			};
		})
		: [];

	return {
		...source,
		id: normalizeString(source.id, `obstacle-${index}`),
		shape: shape,
		complexity: complexity,
		position: new UnitVector3(position.x, position.y, position.z, "cnu"),
		dimensions: new UnitVector3(dimensions.x, dimensions.y, dimensions.z, "cnu"),
		rotation: new UnitVector3(rotation.x, rotation.y, rotation.z, "degrees").toRadians(true),
		scale: NormalizeVector3(source.scale, { x: 1, y: 1, z: 1 }),
		pivot: new UnitVector3(pivot.x, pivot.y, pivot.z, "cnu"),
		primitiveOptions: primitiveOptions,
		texture: texture,
		detail: {
			...detail,
			scatter: normalizeScatterForDetail(source, detail, `obstacle[${index}]`),
		},
		parts: parts,
	};
}

// Mesh/Object normalization for builders
function normalizeColorDescriptor(color, contextPath, fallback = { r: 1, g: 1, b: 1, a: 1 }) {
	const source = normalizeObject(color);
	if (Object.keys(source).length === 0) return fallback;
	const r = ToNumber(source.r, fallback.r);
	const g = ToNumber(source.g, fallback.g);
	const b = ToNumber(source.b, fallback.b);
	const a = ToNumber(source.a, fallback.a);
	if ([r, g, b, a].some((v) => !Number.isFinite(v))) {
		Log("ENGINE", `Object payload ${contextPath} color malformed; defaulting to fallback.`, "warn", "Validation");
		return fallback;
	}
	return { r: Math.max(0, Math.min(1, r)), g: Math.max(0, Math.min(1, g)), b: Math.max(0, Math.min(1, b)), a: Math.max(0, Math.min(1, a)) };
}

function normalizeTextureShape(shape) {
	if (typeof shape !== "string") return null;
	const value = shape.trim().toLowerCase();
	return value.length > 0 ? value : null;
}

function normalizeTextureDescriptor(source, options, contextPath) {
	const src = normalizeObject(source);
	const textureFromSource = src.texture && typeof src.texture === "object" ? src.texture : null;
	const baseTextureID = (textureFromSource && typeof textureFromSource.textureID === "string" && textureFromSource.textureID)
		? textureFromSource.textureID
		: (normalizeString(src.textureID, normalizeString(options && options.textureID, "default-grid")));
	const shape = normalizeTextureShape(textureFromSource && textureFromSource.shape);
	const color = normalizeColorDescriptor((textureFromSource && textureFromSource.color) || src.textureColor || src.color || (options && options.defaultColor), contextPath + ".color");
	const opacitySource = textureFromSource && typeof textureFromSource.opacity === "number" ? textureFromSource.opacity : src.textureOpacity;
	const opacity = ToNumber(opacitySource, 1);
	if (!Number.isFinite(opacity)) {
		Log("ENGINE", `Object payload ${contextPath} texture.opacity malformed; defaulted to 1.`, "warn", "Validation");
	}
	const densitySource = textureFromSource && typeof textureFromSource.density === "number" ? textureFromSource.density : src.textureDensity;
	const materialTextureID = shape ? `${baseTextureID}::shape=${shape}` : baseTextureID;

	return {
		textureID: baseTextureID,
		baseTextureID: baseTextureID,
		materialTextureID: materialTextureID,
		shape: shape,
		color: color,
		opacity: Math.max(0, Math.min(1, ToNumber(opacity, 1))),
		density: Math.max(0, ToNumber(densitySource, 1)),
	};
}

function normalizeScatterRequests(source, contextPath) {
	if (!source || !Array.isArray(source)) return [];
	const out = [];
	for (let i = 0; i < source.length; i += 1) {
		const entry = source[i];
		if (!entry || typeof entry !== "object") {
			Log("ENGINE", `Object payload ${contextPath}[${i}] malformed scatter entry dropped.`, "warn", "Validation");
			continue;
		}
		if (typeof entry.typeID !== "string" || entry.typeID.length === 0) {
			Log("ENGINE", `Object payload ${contextPath}[${i}] scatter missing typeID; entry dropped.`, "warn", "Validation");
			continue;
		}
		out.push({ typeID: entry.typeID, density: Math.max(0, ToNumber(entry.density, 0)) });
	}
	return out;
}

function buildDefaultEntityModel(source, entityId) {
	const rotation = NormalizeVector3(source.rotation, { x: 0, y: 0, z: 0 });
	const dimensions = NormalizeVector3(source.dimensions || source.size, { x: 1, y: 1, z: 1 });
	const shape = normalizeShapeAlias(source, `${entityId}.defaultModelPart`);
	const texture = normalizeTextureDescriptor(source, { textureID: "default-grid", defaultColor: { r: 0.9, g: 0.35, b: 0.35, a: 1 } }, `${entityId}.defaultModelPart`);
	return {
		spawnSurfaceId: source.spawnSurfaceId || null,
		rootTransform: {
			position: new UnitVector3(0, 0, 0, "cnu"),
			rotation: new UnitVector3(rotation.x, rotation.y, rotation.z, "degrees").toRadians(true),
			scale: NormalizeVector3(source.scale, { x: 1, y: 1, z: 1 }),
			pivot: new UnitVector3(0, 0, 0, "cnu"),
		},
		parts: [
			{
				id: `${entityId}-core`,
				parentId: "root",
				anchorPoint: "bottom",
				attachmentPoint: "top",
				localPosition: new UnitVector3(0, 0, 0, "cnu"),
				localRotation: new UnitVector3(0, 0, 0, "radians"),
				localScale: { x: 1, y: 1, z: 1 },
				shape: shape,
				complexity: "medium",
				dimensions: new UnitVector3(dimensions.x, dimensions.y, dimensions.z, "cnu"),
				texture: texture,
				textureID: texture.textureID,
				textureColor: texture.color,
				textureOpacity: texture.opacity,
				pivot: new UnitVector3(0, 0, 0, "cnu"),
				primitiveOptions: normalizePrimitiveOptions(source, `${entityId}.defaultModelPart`),
				detail: { scatter: [] },
			},
		],
	};
}

function normalizeEntityRootTransform(rootTransform, source) {
	const transform = normalizeObject(rootTransform);
	const sourceRotation = NormalizeVector3(source.rotation, { x: 0, y: 0, z: 0 });
	const position = NormalizeVector3(transform.position, { x: 0, y: 0, z: 0 });
	const rotation = NormalizeVector3(transform.rotation, sourceRotation);
	const pivot = NormalizeVector3(transform.pivot, { x: 0, y: 0, z: 0 });

	return {
		...transform,
		position: new UnitVector3(position.x, position.y, position.z, "cnu"),
		rotation: new UnitVector3(rotation.x, rotation.y, rotation.z, "degrees").toRadians(true),
		scale: NormalizeVector3(transform.scale, NormalizeVector3(source.scale, { x: 1, y: 1, z: 1 })),
		pivot: new UnitVector3(pivot.x, pivot.y, pivot.z, "cnu"),
	};
}

function normalizeEntityModelPart(part, entityId, index) {
	const source = normalizeObject(part);
	const dimensions = NormalizeVector3(source.dimensions, { x: 1, y: 1, z: 1 });
	const localPosition = NormalizeVector3(source.localPosition, { x: 0, y: 0, z: 0 });
	const localRotation = NormalizeVector3(source.localRotation, { x: 0, y: 0, z: 0 });
	const texture = normalizeTextureDescriptor(source, { textureID: "default-grid" }, `${entityId}.parts[${index}]`);
	const shape = normalizeShapeAlias(source, `${entityId}.parts[${index}]`);
	const complexity = normalizeGeometryComplexity(source.complexity, `${entityId}.parts[${index}]`);
	const pivot = normalizeVector3WithWarning(source.pivot, { x: 0, y: 0, z: 0 }, `${entityId}.parts[${index}]`, "pivot");
	const primitiveOptions = normalizePrimitiveOptions(source, `${entityId}.parts[${index}]`);

	return {
		...source,
		id: normalizeString(source.id, `${entityId}-part-${index}`),
		shape: shape,
		complexity: complexity,
		parentId: normalizeString(source.parentId, "root"),
		anchorPoint: normalizeString(source.anchorPoint, source.parentId === "root" ? "bottom" : "center"),
		attachmentPoint: normalizeString(source.attachmentPoint, "top"),
		localPosition: new UnitVector3(localPosition.x, localPosition.y, localPosition.z, "cnu"),
		localRotation: new UnitVector3(localRotation.x, localRotation.y, localRotation.z, "degrees").toRadians(true),
		localScale: NormalizeVector3(source.localScale, { x: 1, y: 1, z: 1 }),
		dimensions: new UnitVector3(dimensions.x, dimensions.y, dimensions.z, "cnu"),
		pivot: new UnitVector3(pivot.x, pivot.y, pivot.z, "cnu"),
		rotation: new UnitVector3(0, 0, 0, "radians"),
		scale: { x: 1, y: 1, z: 1 },
		position: new UnitVector3(0, 0, 0, "cnu"),
		primitiveOptions: primitiveOptions,
		texture: texture,
		detail: { scatter: [] },
		textureID: texture.textureID,
		textureColor: texture.color,
		textureOpacity: texture.opacity,
	};
}

function normalizeEntityModel(model, source, entityId) {
	const modelSource = normalizeObject(model);
	const partDefinitions = normalizeArray(modelSource.parts);
	if (partDefinitions.length === 0) {
		return buildDefaultEntityModel(source, entityId);
	}

	return {
		...modelSource,
		spawnSurfaceId: modelSource.spawnSurfaceId || source.spawnSurfaceId || null,
		rootTransform: normalizeEntityRootTransform(modelSource.rootTransform, source),
		parts: partDefinitions.map((part, index) => normalizeEntityModelPart(part, entityId, index)),
	};
}

function normalizeEntityData(source, entityId) {
	const movementSource = normalizeObject(source.movement);
	const movementStart = NormalizeVector3(movementSource.start, { x: 0, y: 0, z: 0 });
	const movementEnd = NormalizeVector3(movementSource.end, movementStart);

	return {
		...source,
		id: entityId,
		type: normalizeString(source.type, "entity"),
		movement: {
			...movementSource,
			start: new UnitVector3(movementStart.x, movementStart.y, movementStart.z, "cnu"),
			end: new UnitVector3(movementEnd.x, movementEnd.y, movementEnd.z, "cnu"),
			repeat: movementSource.repeat !== false,
			backAndForth: movementSource.backAndForth !== false,
			speed: new Unit(Math.max(0, ToNumber(movementSource.speed, 0)), "cnu"),
			jump: new Unit(Math.max(0, ToNumber(movementSource.jump, 0)), "cnu"),
			jumpInterval: Math.max(0, ToNumber(movementSource.jumpInterval, 0)),
			jumpOnSight: movementSource.jumpOnSight === true,
			disappear: movementSource.disappear === true,
			chase: movementSource.chase === true,
			physics: movementSource.physics === true,
		},
		hp: Math.max(0, ToNumber(source.hp, 1)),
		attacks: normalizeArray(source.attacks),
		hardcoded: normalizeObject(source.hardcoded),
		platform: source.platform || null,
		animations: normalizeObject(source.animations),
		velocity: new UnitVector3(
			ToNumber(source.velocity && source.velocity.x, 0),
			ToNumber(source.velocity && source.velocity.y, 0),
			ToNumber(source.velocity && source.velocity.z, 0),
			"cnu"
		),
		model: normalizeEntityModel(source.model, source, entityId),
	};
}

function normalizeEntity(definition, index) {
	const source = normalizeObject(definition);
	const entityId = normalizeString(source.id, `entity-${index}`);
	return normalizeEntityData(source, entityId);
}

function normalizeBlueprintEntry(definition, index, prefix) {
	const source = normalizeObject(definition);
	const entityId = normalizeString(source.id, `${prefix}-${index}`);
	return normalizeEntityData(source, entityId);
}

function normalizeBlueprintList(list, prefix) {
	const source = Array.isArray(list) ? list : [];
	const normalized = [];
	for (let index = 0; index < source.length; index += 1) {
		normalized.push(normalizeBlueprintEntry(source[index], index, prefix));
	}
	return normalized;
}

function LevelPayload(payload) {
	const source = normalizeObject(payload);
	const terrain = normalizeObject(source.terrain);
	const blueprintSource = normalizeObject(source.entityBlueprints);
	const metaSource = normalizeObject(source.meta);
	const terrainObjects = normalizeArray(terrain.objects);
	const terrainTriggers = normalizeArray(terrain.triggers);
	const obstacles = normalizeArray(source.obstacles);
	const entities = normalizeArray(source.entities);

	return {
		...source,
		terrain: {
			...terrain,
			objects: terrainObjects.map((entry, index) => normalizeTerrainObject(entry, index)),
			triggers: terrainTriggers.map((entry, index) => normalizeTrigger(entry, index)),
		},
		obstacles: obstacles.map((entry, index) => normalizeObstacle(entry, index)),
		entities: entities.map((entry, index) => normalizeEntity(entry, index)),
		entityBlueprints: {
			...blueprintSource,
			enemies: normalizeBlueprintList(blueprintSource.enemies, "enemy-blueprint"),
			npcs: normalizeBlueprintList(blueprintSource.npcs, "npc-blueprint"),
			collectibles: normalizeBlueprintList(blueprintSource.collectibles, "collectible-blueprint"),
			projectiles: normalizeBlueprintList(blueprintSource.projectiles, "projectile-blueprint"),
			entities: normalizeBlueprintList(blueprintSource.entities, "entity-blueprint"),
		},
		meta: {
			...metaSource,
			levelId: normalizeString(metaSource.levelId, normalizeString(source.id, "unknown")),
			stageId: normalizeString(metaSource.stageId, normalizeString(source.id, "unknown")),
		},
		world: worldConfig(source.world),
		camera: cameraConfig(source.camera),
		player: playerConfig(source.player),
	};
}

function worldConfig(world) {
	const source = normalizeObject(world);
	const length = Math.max(1, ToNumber(source.length, 100));
	const width = Math.max(1, ToNumber(source.width, 100));
	const height = Math.max(1, ToNumber(source.height, 40));
	const deathBarrierY = ToNumber(source.deathBarrierY, -25);
	const resolvedWaterLevel = resolveWaterLevel(source, deathBarrierY, height);

	return {
		length: new Unit(length, "cnu"),
		width: new Unit(width, "cnu"),
		height: new Unit(height, "cnu"),
		deathBarrierY: new Unit(deathBarrierY, "cnu"),
		waterLevel: resolvedWaterLevel === null ? null : new Unit(resolvedWaterLevel, "cnu"),
		textureScale: Math.max(0.05, ToNumber(source.textureScale, 1)),
		scatterScale: Math.max(0.05, ToNumber(source.scatterScale, 1)),
	};
}

function resolveWaterLevel(source, deathBarrierY, worldHeight) {
	if (!Object.prototype.hasOwnProperty.call(source, "waterLevel")) return null;

	const level = Number(source.waterLevel);
	if (!Number.isFinite(level)) {
		Log("ENGINE", "World waterLevel was malformed and has been normalized to null.", "warn", "Validation");
		return null;
	}

	if (level < deathBarrierY || level > worldHeight) {
		Log("ENGINE", "World waterLevel was outside world bounds and has been normalized to null.", "warn", "Validation");
		return null;
	}

	return level;
}

function cameraConfig(camera) {
	const source = normalizeObject(camera);
	const openStart = NormalizeVector3(
		source.levelOpening && source.levelOpening.startPosition,
		{ x: 0, y: 40, z: 80 }
	);
	const openEnd = NormalizeVector3(
		source.levelOpening && source.levelOpening.endPosition,
		{ x: 0, y: 40, z: 80 }
	);

	return {
		mode: "stationary",
		levelOpening: {
			startPosition: new UnitVector3(openStart.x, openStart.y, openStart.z, "cnu"),
			endPosition: new UnitVector3(openEnd.x, openEnd.y, openEnd.z, "cnu"),
		},
		distance: new Unit(ToNumber(source.distance, 10), "cnu"),
		sensitivity: ToNumber(source.sensitivity, 0.12),
		heightOffset: new Unit(ToNumber(source.heightOffset, 3), "cnu"),
	};
}

function playerConfig(player) {
	const fallback = {
		character: "carl",
		spawnPosition: { x: 0, y: 0, z: 0 },
		scale: { x: 1, y: 1, z: 1 }
	}

	const source = normalizeObject(player);
	const spawnPos = NormalizeVector3(source.spawnPosition, fallback.spawnPosition);
	const resolvedCharacter = typeof source.character === "string" && source.character.length > 0
		? source.character.toLowerCase()
		: fallback.character;

	return {
		character: resolvedCharacter,
		spawnPosition: new UnitVector3(spawnPos.x, spawnPos.y, spawnPos.z, "cnu"),
		scale: NormalizeVector3(source.scale, { x: 1, y: 1, z: 1 })
	}
}

export default { 
	MenuUIPayload, 
	LevelPayload,
};
