// Payload authoring helpers. Object positions are bottom-center (y = base, x/z = center).

export const rgb = (r, g, b, a = 1) => ({ r, g, b, a });
export const v3 = (x, y, z) => ({ x, y, z });

export function Obj(id, shape, pos, dims, color, textureId, extra = {}) {
	const { rotation, texture, ...rest } = extra;
	return {
		id,
		shape,
		complexity: rest.complexity || "medium",
		dimensions: v3(dims[0], dims[1], dims[2]),
		position: v3(pos[0], pos[1], pos[2]),
		rotation: rotation ? v3(rotation[0], rotation[1], rotation[2]) : v3(0, 0, 0),
		scale: v3(1, 1, 1),
		color,
		texture: texture || { generated: { id: textureId }, custom: [] },
		...rest,
	};
}

export const Box = (id, pos, dims, color, textureId = "default-tiles", extra) => Obj(id, "cube", pos, dims, color, textureId, extra);

// h/v are offsets across a face; each side maps them onto different local axes.
function decalTransform(side, h, v, rotation, sx, sy) {
	const position = side === "left" || side === "right" ? { x: 0, y: v, z: h }
		: side === "top" ? { x: h, y: 0, z: -v }
		: side === "bottom" ? { x: h, y: 0, z: v }
		: { x: h, y: v, z: 0 };
	return { position, rotation, scale: { x: sx, y: sy, z: 1 } };
}

export const Decal = (shape, color, side, h, v, rotation, sx, sy) =>
	({ decalType: "shape", shape, color, side, localTransform: decalTransform(side, h, v, rotation, sx, sy) });

export const ImageDecal = (imagePath, side, h, v, rotation, sx, sy) =>
	({ decalType: "image", imagePath, sourceType: "url", side, localTransform: decalTransform(side, h, v, rotation, sx, sy) });

// Standard Y rotation (degrees), matching the engine's Euler yaw.
export function RotateY(x, z, degrees) {
	const r = (degrees * Math.PI) / 180;
	const c = Math.cos(r);
	const s = Math.sin(r);
	return [x * c + z * s, -x * s + z * c];
}

// A prop is a list of primitives authored around a local origin (floor level, center), placed as a unit.
// Part: { shape, at: [x,y,z], size: [x,y,z], color, tex, rot: [x,y,z], ...objectFields }
// Pyramids are built base-at-origin, so the bottom-center lift would float them by half their height.
export function Prop(id, origin, yaw, parts) {
	return parts.map((part, index) => {
		const [lx, ly, lz] = part.at || [0, 0, 0];
		const [dx, dz] = RotateY(lx, lz, yaw);
		const rot = part.rot || [0, 0, 0];
		const { shape = "cube", at, size, color, tex = "default-tiles", rot: _rot, name, ...fields } = part;
		const lift = shape === "pyramid" ? -size[1] / 2 : 0;
		return Obj(`${id}-${name || index}`, shape, [origin[0] + dx, origin[1] + ly + lift, origin[2] + dz], size, color, tex, {
			rotation: [rot[0], rot[1] + yaw, rot[2]],
			...fields,
		});
	});
}

// Wall along X (axis "x") or Z (axis "z") from `from` to `to`.
// Gaps: { at, width, top, bottom = 0 } — a door has bottom 0, a window a raised sill.
export function Wall(id, axis, line, from, to, { height, thickness, baseY = 0, color, textureId, texture, gaps = [], trimColor }) {
	const pieces = [];
	const sorted = [...gaps].sort((a, b) => a.at - b.at);
	let cursor = from;
	let index = 0;

	const push = (start, end, y0, h, pieceColor) => {
		const length = end - start;
		if (length <= 0.01 || h <= 0.01) return;
		const mid = (start + end) / 2;
		const pos = axis === "x" ? [mid, y0, line] : [line, y0, mid];
		const dims = axis === "x" ? [length, h, thickness] : [thickness, h, length];
		pieces.push(Box(`${id}-${index++}`, pos, dims, pieceColor, textureId, texture ? { texture: structuredClone(texture) } : undefined));
	};

	sorted.forEach((gap) => {
		const start = gap.at - gap.width / 2;
		const end = gap.at + gap.width / 2;
		const bottom = gap.bottom || 0;
		push(cursor, start, baseY, height, color);
		push(start, end, baseY, bottom, trimColor || color);
		push(start, end, baseY + gap.top, height - gap.top, trimColor || color);
		cursor = end;
	});
	push(cursor, to, baseY, height, color);
	return pieces;
}
