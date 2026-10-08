// Furniture, built from engine primitives via Prop(). Origins are floor-level centers.
import { Prop, Decal, ImageDecal, rgb } from "./build.js";

const WOOD = rgb(0.45, 0.29, 0.16);
const DARK_WOOD = rgb(0.27, 0.16, 0.09);
const LIGHT_WOOD = rgb(0.62, 0.45, 0.28);
const METAL = rgb(0.55, 0.58, 0.62);
const BRASS = rgb(0.78, 0.62, 0.26);
const PORCELAIN = rgb(0.90, 0.90, 0.86);
const VELVET = rgb(0.52, 0.12, 0.18);
const GREEN_VELVET = rgb(0.18, 0.36, 0.22);
const GRIME = rgb(0.36, 0.27, 0.12);

const T = { wood: "wood-planks", tile: "default-tiles", stone: "stone-block", metal: "metal-panel", plain: "none" };

export const Chair = (id, origin, yaw, broken = false) => Prop(id, origin, yaw, [
	{ name: "seat", at: [0, 0.42, 0], size: [0.55, 0.08, 0.55], color: WOOD, tex: T.wood },
	{ name: "leg0", shape: "cylinder", at: [0.22, 0, 0.22], size: [0.07, 0.42, 0.07], color: DARK_WOOD, tex: T.wood },
	{ name: "leg1", shape: "cylinder", at: [-0.22, 0, 0.22], size: [0.07, 0.42, 0.07], color: DARK_WOOD, tex: T.wood },
	{ name: "leg2", shape: "cylinder", at: [0.22, 0, -0.22], size: [0.07, 0.42, 0.07], color: DARK_WOOD, tex: T.wood },
	{ name: "leg3", shape: "cylinder", at: [-0.22, 0, -0.22], size: [0.07, 0.42, 0.07], color: DARK_WOOD, tex: T.wood },
	{ name: "back", at: [0, 0.5, -0.24], size: [0.55, broken ? 0.4 : 0.7, 0.07], color: WOOD, tex: T.wood, rot: [broken ? -18 : 0, 0, broken ? 9 : 0] },
]);

export const Table = (id, origin, yaw, length, width, cloth = null) => Prop(id, origin, yaw, [
	{ name: "top", at: [0, 0.82, 0], size: [length, 0.12, width], color: cloth || LIGHT_WOOD, tex: cloth ? T.plain : T.wood },
	{ name: "leg0", at: [length / 2 - 0.2, 0, width / 2 - 0.2], size: [0.14, 0.82, 0.14], color: DARK_WOOD, tex: T.wood },
	{ name: "leg1", at: [-length / 2 + 0.2, 0, width / 2 - 0.2], size: [0.14, 0.82, 0.14], color: DARK_WOOD, tex: T.wood },
	{ name: "leg2", at: [length / 2 - 0.2, 0, -width / 2 + 0.2], size: [0.14, 0.82, 0.14], color: DARK_WOOD, tex: T.wood },
	{ name: "leg3", at: [-length / 2 + 0.2, 0, -width / 2 + 0.2], size: [0.14, 0.82, 0.14], color: DARK_WOOD, tex: T.wood },
]);

export const Barrel = (id, origin, color = rgb(0.80, 0.10, 0.08)) => Prop(id, origin, 0, [
	{ name: "body", shape: "cylinder", at: [0, 0, 0], size: [0.95, 1.25, 0.95], color, tex: T.metal, complexity: "high" },
	{ name: "lid", shape: "cylinder", at: [0, 1.25, 0], size: [0.85, 0.04, 0.85], color: rgb(0.62, 0.06, 0.05), tex: T.metal },
	{ name: "band0", shape: "cylinder", at: [0, 0.22, 0], size: [1.0, 0.07, 1.0], color: rgb(0.55, 0.08, 0.06), tex: T.metal },
	{ name: "band1", shape: "cylinder", at: [0, 0.6, 0], size: [1.0, 0.07, 1.0], color: rgb(0.55, 0.08, 0.06), tex: T.metal },
	{ name: "band2", shape: "cylinder", at: [0, 0.98, 0], size: [1.0, 0.07, 1.0], color: rgb(0.55, 0.08, 0.06), tex: T.metal },
]);

export const Sofa = (id, origin, yaw, color = VELVET) => Prop(id, origin, yaw, [
	{ name: "base", at: [0, 0, 0], size: [2.6, 0.5, 1.0], color, tex: T.plain },
	{ name: "cushion", at: [0, 0.5, 0.06], size: [2.2, 0.16, 0.86], color: rgb(color.r * 1.15, color.g * 1.15, color.b * 1.15), tex: T.plain },
	{ name: "back", at: [0, 0.5, -0.42], size: [2.6, 0.7, 0.24], color, tex: T.plain },
	{ name: "armL", at: [-1.2, 0.5, 0], size: [0.24, 0.35, 1.0], color, tex: T.plain },
	{ name: "armR", at: [1.2, 0.5, 0], size: [0.24, 0.35, 1.0], color, tex: T.plain },
]);

export const Armchair = (id, origin, yaw, color = GREEN_VELVET) => Prop(id, origin, yaw, [
	{ name: "base", at: [0, 0, 0], size: [1.1, 0.5, 1.0], color, tex: T.plain },
	{ name: "back", at: [0, 0.5, -0.4], size: [1.1, 0.8, 0.22], color, tex: T.plain },
	{ name: "armL", at: [-0.48, 0.5, 0], size: [0.18, 0.32, 1.0], color, tex: T.plain },
	{ name: "armR", at: [0.48, 0.5, 0], size: [0.18, 0.32, 1.0], color, tex: T.plain },
]);

export const Bookshelf = (id, origin, yaw, width = 3) => {
	const parts = [
		{ name: "frame", at: [0, 0, 0], size: [width, 3.4, 0.7], color: DARK_WOOD, tex: T.wood },
	];
	const bookColors = [rgb(0.55, 0.12, 0.10), rgb(0.14, 0.28, 0.45), rgb(0.22, 0.40, 0.20), rgb(0.62, 0.50, 0.20), rgb(0.35, 0.18, 0.38)];
	[0.25, 1.05, 1.85, 2.65].forEach((y, row) => {
		parts.push({ name: `books${row}`, at: [0, y, 0.32], size: [width - 0.3, 0.6, 0.08], color: bookColors[(row + Math.round(width)) % bookColors.length], tex: T.tile });
	});
	return Prop(id, origin, yaw, parts);
};

export const Fireplace = (id, origin, yaw) => Prop(id, origin, yaw, [
	{ name: "body", at: [0, 0, -0.2], size: [3.2, 2.4, 0.8], color: rgb(0.52, 0.48, 0.46), tex: T.stone },
	{ name: "hole", at: [0, 0, 0.21], size: [1.8, 1.4, 0.02], color: rgb(0.06, 0.04, 0.04), tex: T.plain },
	{ name: "mantel", at: [0, 2.4, -0.1], size: [3.6, 0.18, 1.0], color: DARK_WOOD, tex: T.wood },
	{ name: "log0", shape: "cylinder", at: [0, 0.12, 0.35], size: [0.22, 1.1, 0.22], color: rgb(0.3, 0.18, 0.08), tex: T.wood, rot: [0, 0, 90],
		particle: { id: "smoke", position: { x: 0, y: 0.6, z: 0 }, overrides: { color: { start: { r: 0.25, g: 0.22, b: 0.24, a: 0.55 }, variance: 0.1, end: null } } } },
]);

export const Candelabra = (id, origin) => Prop(id, origin, 0, [
	{ name: "base", shape: "cylinder", at: [0, 0, 0], size: [0.22, 0.05, 0.22], color: BRASS, tex: T.metal },
	{ name: "stem", shape: "cylinder", at: [0, 0.05, 0], size: [0.05, 0.45, 0.05], color: BRASS, tex: T.metal },
	{ name: "candle", shape: "cylinder", at: [0, 0.5, 0], size: [0.07, 0.2, 0.07], color: rgb(0.95, 0.92, 0.8), tex: T.plain,
		particle: { id: "spark", position: { x: 0, y: 0.2, z: 0 }, overrides: { count: 2, physics: "none", spread: "narrow", velocity: { x: 0, y: 0.25, z: 0 }, color: { start: { r: 1, g: 0.75, b: 0.25, a: 1 }, variance: 0.05, end: { r: 1, g: 0.3, b: 0.05 } } } } },
]);

export const Chandelier = (id, origin) => Prop(id, origin, 0, [
	{ name: "chain", shape: "cylinder", at: [0, 0.9, 0], size: [0.05, 0.9, 0.05], color: DARK_WOOD, tex: T.metal },
	{ name: "ring", shape: "torus", at: [0, 0.75, 0], size: [1.8, 0.14, 1.8], color: BRASS, tex: T.metal },
	{ name: "hub", shape: "sphere", at: [0, 0.65, 0], size: [0.35, 0.35, 0.35], color: BRASS, tex: T.metal },
	...[0, 1, 2, 3, 4, 5].map((i) => {
		const a = (i / 6) * Math.PI * 2;
		return { name: `bulb${i}`, shape: "sphere", at: [Math.cos(a) * 0.85, 0.82, Math.sin(a) * 0.85], size: [0.16, 0.2, 0.16], color: rgb(1, 0.86, 0.5), tex: T.plain };
	}),
]);

export const Rug = (id, origin, yaw, w, d, color) => Prop(id, origin, yaw, [
	{ name: "rug", at: [0, 0.01, 0], size: [w, 0.03, d], color, tex: T.plain },
	{ name: "trim", at: [0, 0, 0], size: [w + 0.3, 0.02, d + 0.3], color: BRASS, tex: T.plain },
]);

export const Clock = (id, origin, yaw) => Prop(id, origin, yaw, [
	{ name: "case", at: [0, 0, 0], size: [0.8, 2.6, 0.5], color: DARK_WOOD, tex: T.wood },
	{ name: "face", shape: "cylinder", at: [0, 2.0, 0.26], size: [0.55, 0.04, 0.55], color: PORCELAIN, tex: T.plain, rot: [90, 0, 0] },
	{ name: "pendulum", at: [0, 0.7, 0.26], size: [0.12, 0.8, 0.02], color: BRASS, tex: T.metal },
	{ name: "crown", shape: "pyramid", at: [0, 2.6, 0], size: [0.9, 0.35, 0.55], color: DARK_WOOD, tex: T.wood },
]);

export const Piano = (id, origin, yaw) => Prop(id, origin, yaw, [
	{ name: "body", at: [0, 0.3, 0], size: [2.0, 1.1, 0.7], color: rgb(0.06, 0.05, 0.06), tex: T.plain },
	{ name: "keys", at: [0, 0.8, 0.45], size: [1.8, 0.08, 0.3], color: PORCELAIN, tex: T.tile },
	{ name: "legL", at: [-0.85, 0, 0.3], size: [0.12, 0.8, 0.12], color: rgb(0.06, 0.05, 0.06), tex: T.plain },
	{ name: "legR", at: [0.85, 0, 0.3], size: [0.12, 0.8, 0.12], color: rgb(0.06, 0.05, 0.06), tex: T.plain },
	{ name: "lid", at: [0, 1.4, -0.05], size: [2.0, 0.06, 0.65], color: rgb(0.08, 0.07, 0.08), tex: T.plain, rot: [-25, 0, 0] },
]);

export const Bathtub = (id, origin, yaw) => Prop(id, origin, yaw, [
	{ name: "tub", at: [0, 0.15, 0], size: [2.2, 0.65, 1.0], color: PORCELAIN, tex: T.plain },
	{ name: "sludge", at: [0, 0.8, 0], size: [1.9, 0.02, 0.75], color: rgb(0.32, 0.36, 0.14), tex: T.plain },
	...[[-0.9, -0.35], [0.9, -0.35], [-0.9, 0.35], [0.9, 0.35]].map(([x, z], i) => ({ name: `foot${i}`, shape: "sphere", at: [x, 0, z], size: [0.2, 0.2, 0.2], color: BRASS, tex: T.metal })),
]);

export const Toilet = (id, origin, yaw) => Prop(id, origin, yaw, [
	{ name: "bowl", shape: "cylinder", at: [0, 0, 0.1], size: [0.55, 0.45, 0.65], color: PORCELAIN, tex: T.plain },
	{ name: "seat", shape: "cylinder", at: [0, 0.45, 0.1], size: [0.6, 0.05, 0.7], color: rgb(0.45, 0.32, 0.18), tex: T.wood },
	{ name: "tank", at: [0, 0.45, -0.28], size: [0.6, 0.6, 0.25], color: PORCELAIN, tex: T.plain },
	{ name: "puddle", shape: "cylinder", at: [0.3, 0, 0.6], size: [1.3, 0.015, 0.9], color: GRIME, tex: T.plain },
]);

export const Sink = (id, origin, yaw) => Prop(id, origin, yaw, [
	{ name: "pedestal", shape: "cylinder", at: [0, 0, 0], size: [0.25, 0.8, 0.25], color: PORCELAIN, tex: T.plain },
	{ name: "basin", at: [0, 0.8, 0], size: [0.7, 0.15, 0.5], color: PORCELAIN, tex: T.plain },
	{ name: "mirror", at: [0, 1.3, -0.24], size: [0.7, 0.9, 0.04], color: rgb(0.62, 0.74, 0.78), tex: T.plain },
]);

export const Counter = (id, origin, yaw, length) => Prop(id, origin, yaw, [
	{ name: "base", at: [0, 0, 0], size: [length, 0.9, 0.7], color: rgb(0.40, 0.52, 0.46), tex: T.wood },
	{ name: "top", at: [0, 0.9, 0.02], size: [length + 0.06, 0.07, 0.76], color: rgb(0.86, 0.84, 0.78), tex: T.tile },
]);

export const Stove = (id, origin, yaw) => Prop(id, origin, yaw, [
	{ name: "body", at: [0, 0, 0], size: [1.0, 0.95, 0.75], color: rgb(0.25, 0.25, 0.27), tex: T.metal },
	{ name: "burner0", shape: "cylinder", at: [-0.25, 0.95, 0.15], size: [0.3, 0.03, 0.3], color: rgb(0.08, 0.08, 0.08), tex: T.plain },
	{ name: "burner1", shape: "cylinder", at: [0.25, 0.95, -0.15], size: [0.3, 0.03, 0.3], color: rgb(0.08, 0.08, 0.08), tex: T.plain },
	{ name: "pot", shape: "cylinder", at: [-0.25, 0.98, 0.15], size: [0.42, 0.38, 0.42], color: rgb(0.45, 0.47, 0.5), tex: T.metal,
		particle: { id: "smoke", position: { x: 0, y: 0.45, z: 0 }, overrides: { color: { start: { r: 0.42, g: 0.52, b: 0.24, a: 0.5 }, variance: 0.08, end: null } } } },
]);

export const Fridge = (id, origin, yaw) => Prop(id, origin, yaw, [
	{ name: "body", at: [0, 0, 0], size: [0.95, 2.1, 0.8], color: rgb(0.84, 0.86, 0.80), tex: T.metal },
	{ name: "handle", at: [0.38, 1.0, 0.42], size: [0.06, 0.6, 0.06], color: METAL, tex: T.metal },
]);

// Portrait subjects painted with shape decals on the canvas face.
const PORTRAITS = {
	robot: (w, h) => [
		Decal("square", rgb(0.93, 0.90, 0.79), "front", 0, -0.06 * h, 0, 0.55 * w, 0.4 * h),
		Decal("triangle", rgb(0.50, 0.36, 0.22), "front", 0, 0.25 * h, 0, 0.8 * w, 0.26 * h),
		Decal("circle", rgb(0.16, 0.36, 0.20), "front", -0.12 * w, -0.02 * h, 0, 0.13 * w, 0.13 * w),
		Decal("square", rgb(0.12, 0.22, 0.85), "front", 0.12 * w, -0.02 * h, 0, 0.12 * w, 0.12 * w),
		Decal("pill", rgb(0.1, 0.07, 0.07), "front", 0, -0.17 * h, 0, 0.18 * w, 0.03 * h),
	],
	ghost: (w, h) => [
		Decal("circle", rgb(0.6, 0.24, 0.8), "front", 0, -0.05 * h, 0, 0.7 * w, 0.62 * w),
		Decal("circle", rgb(1, 1, 1), "front", -0.13 * w, 0, 0, 0.18 * w, 0.22 * w),
		Decal("circle", rgb(1, 1, 1), "front", 0.13 * w, 0, 0, 0.18 * w, 0.22 * w),
		Decal("circle", rgb(0.05, 0.04, 0.06), "front", -0.12 * w, -0.02 * h, 0, 0.08 * w, 0.1 * w),
		Decal("circle", rgb(0.05, 0.04, 0.06), "front", 0.14 * w, -0.02 * h, 0, 0.08 * w, 0.1 * w),
	],
	landlord: (w, h) => [
		Decal("circle", rgb(0.45, 0.2, 0.62), "front", 0, -0.12 * h, 0, 0.7 * w, 0.6 * w),
		Decal("square", rgb(0.1, 0.08, 0.1), "front", 0, 0.3 * h, 0, 0.34 * w, 0.28 * h),
		Decal("pill", rgb(0.1, 0.08, 0.1), "front", 0, 0.16 * h, 0, 0.62 * w, 0.06 * h),
		Decal("pill", rgb(0.7, 0.12, 0.12), "front", 0, 0.2 * h, 0, 0.34 * w, 0.04 * h),
		Decal("circle", rgb(1, 1, 1), "front", -0.12 * w, -0.06 * h, 0, 0.16 * w, 0.2 * w),
		Decal("circle", rgb(0.85, 0.7, 0.25), "front", 0.12 * w, -0.06 * h, 0, 0.2 * w, 0.24 * w),
		Decal("circle", rgb(1, 1, 1), "front", 0.12 * w, -0.06 * h, 0, 0.15 * w, 0.19 * w),
		Decal("pill", rgb(0.12, 0.08, 0.1), "front", -0.08 * w, -0.2 * h, 25, 0.18 * w, 0.05 * h),
		Decal("pill", rgb(0.12, 0.08, 0.1), "front", 0.08 * w, -0.2 * h, -25, 0.18 * w, 0.05 * h),
	],
};

export const Painting = (id, origin, yaw, w, h, color, subject = null) => Prop(id, origin, yaw, [
	{ name: "frame", at: [0, 0, 0], size: [w + 0.2, h + 0.2, 0.08], color: BRASS, tex: T.wood },
	{ name: "canvas", at: [0, 0.1, 0.03], size: [w, h, 0.04], color, tex: T.stone,
		texture: { generated: { id: "none" }, custom: subject ? PORTRAITS[subject](w, h) : [] } },
]);

// portrait.png (446×559) carries its own ornate frame inside transparent margins: the board matches
// the opaque frame (86.5% × 85.2% of the image) and the full-size decal's margins simply don't draw.
const PORTRAIT_IMAGE = { aspect: 446 / 559, frame: [0.865, 0.852], offset: [-0.012, -0.0125] };
export const FramedImage = (id, origin, yaw, w, image) => {
	const h = w / PORTRAIT_IMAGE.aspect;
	const [bw, bh] = [w * PORTRAIT_IMAGE.frame[0], h * PORTRAIT_IMAGE.frame[1]];
	return Prop(id, origin, yaw, [
		{ name: "board", at: [0, 0, 0], size: [bw, bh, 0.06], color: DARK_WOOD, tex: T.plain,
			texture: { generated: { id: "none" }, custom: [ImageDecal(image, "front", PORTRAIT_IMAGE.offset[0] * w, PORTRAIT_IMAGE.offset[1] * h, 0, w, h)] } },
	]);
};

export const Globe = (id, origin) => Prop(id, origin, 0, [
	{ name: "stand", shape: "cylinder", at: [0, 0, 0], size: [0.4, 0.8, 0.4], color: DARK_WOOD, tex: T.wood },
	{ name: "ball", shape: "sphere", at: [0, 0.8, 0], size: [0.7, 0.7, 0.7], color: rgb(0.3, 0.5, 0.62), tex: T.stone },
]);

export const BoardedDoor = (id, origin, yaw) => Prop(id, origin, yaw, [
	{ name: "door", at: [0, 0, 0], size: [2.6, 3.3, 0.25], color: rgb(0.32, 0.2, 0.11), tex: T.wood },
	{ name: "board0", at: [0, 1.0, 0.16], size: [2.9, 0.25, 0.07], color: LIGHT_WOOD, tex: T.wood, rot: [0, 0, 14] },
	{ name: "board1", at: [0, 2.1, 0.16], size: [2.9, 0.25, 0.07], color: LIGHT_WOOD, tex: T.wood, rot: [0, 0, -11] },
	{ name: "knob", shape: "sphere", at: [0.95, 1.5, 0.16], size: [0.14, 0.14, 0.14], color: BRASS, tex: T.metal },
]);

// The window photo carries its own frame and mullions, so only the sill is geometry then.
export const WindowFrame = (id, origin, yaw, width, height, photo) => Prop(id, origin, yaw, [
	{ name: "sill", at: [0, -0.08, 0], size: [width + 0.4, 0.12, 0.6], color: DARK_WOOD, tex: T.wood },
	...(photo ? [] : [
		{ name: "mullionV", at: [0, 0, 0], size: [0.1, height, 0.1], color: DARK_WOOD, tex: T.wood },
		{ name: "mullionH", at: [0, height / 2 - 0.1, 0], size: [width, 0.1, 0.1], color: DARK_WOOD, tex: T.wood },
	]),
]);
