// The player: a box-head robot with a straw hat and a Poltergust 0.5. Model front is +Z.
import { rgb } from "./build.js";

const STEEL = rgb(0.62, 0.66, 0.72);
const SKIN = rgb(0.86, 0.72, 0.52);
const HEAD = rgb(0.93, 0.90, 0.79);
const BODY = rgb(0.60, 0.52, 0.34);
const STRAW = rgb(0.56, 0.42, 0.26);
const RED = rgb(0.80, 0.11, 0.09);

function part(id, parentId, shape, dims, options = {}) {
	return {
		id,
		parentId,
		anchorPoint: options.anchor || "center",
		attachmentPoint: options.attach || "center",
		shape,
		complexity: options.complexity || "medium",
		dimensions: { x: dims[0], y: dims[1], z: dims[2] },
		localPosition: { x: options.at?.[0] || 0, y: options.at?.[1] || 0, z: options.at?.[2] || 0 },
		localRotation: { x: options.rot?.[0] || 0, y: options.rot?.[1] || 0, z: options.rot?.[2] || 0 },
		localScale: { x: 1, y: 1, z: 1 },
		pivot: { x: 0, y: 0, z: 0 },
		addsToBounds: options.bounds ?? true,
		color: options.color,
		texture: { generated: { id: options.tex || "none", ...(options.generated || {}) }, custom: options.decals || [] },
	};
}

export const ROBOT_PARTS = [
	part("torso", "root", "cylinder", [0.62, 0.72, 0.62], { anchor: "bottom", at: [0, 0.78, 0], color: BODY, tex: "wood-stump", generated: { color: rgb(0.44, 0.35, 0.2), density: 0.35, speckSize: 3 }, complexity: "high" }),
	part("belt", "torso", "cylinder", [0.66, 0.08, 0.66], { anchor: "bottom", attach: "bottom", at: [0, 0.04, 0], color: rgb(0.36, 0.28, 0.18) }),
	part("neck", "torso", "cylinder", [0.14, 0.12, 0.14], { anchor: "bottom", attach: "top", color: STEEL, tex: "metal-panel" }),
	part("head", "neck", "cube", [0.64, 0.52, 0.54], { anchor: "bottom", attach: "top", color: HEAD }),
	part("hat", "head", "pyramid", [0.98, 0.44, 0.92], { bounds: false, anchor: "bottom", attach: "top", at: [0, -0.24, 0], color: STRAW, tex: "wood-stump" }),
	part("eyeLeft", "head", "sphere", [0.2, 0.2, 0.12], { attach: "front", at: [-0.15, 0.04, 0.02], color: rgb(0.16, 0.36, 0.20), complexity: "high" }),
	part("eyeRight", "head", "cube", [0.17, 0.17, 0.06], { attach: "front", at: [0.15, 0.04, 0.02], color: rgb(0.12, 0.22, 0.85) }),
	part("pupilRight", "eyeRight", "cube", [0.06, 0.06, 0.02], { attach: "front", at: [0, 0, 0.01], color: rgb(0.05, 0.08, 0.3) }),
	part("nose", "head", "cone", [0.1, 0.16, 0.1], { attach: "front", at: [0, -0.05, 0.08], rot: [90, 0, 0], color: rgb(0.84, 0.78, 0.62) }),
	part("mouthL", "head", "cube", [0.1, 0.022, 0.02], { attach: "front", at: [0.045, -0.15, 0.01], rot: [0, 0, -16], color: rgb(0.1, 0.07, 0.07) }),
	part("mouthR", "head", "cube", [0.1, 0.022, 0.02], { attach: "front", at: [-0.045, -0.15, 0.01], rot: [0, 0, 16], color: rgb(0.1, 0.07, 0.07) }),

	part("legLeft", "torso", "cube", [0.11, 0.78, 0.11], { anchor: "top", attach: "bottom", at: [0.16, 0, 0], color: STEEL, tex: "metal-panel" }),
	part("legRight", "torso", "cube", [0.11, 0.78, 0.11], { anchor: "top", attach: "bottom", at: [-0.16, 0, 0], color: STEEL, tex: "metal-panel" }),
	part("footLeft", "legLeft", "cube", [0.24, 0.12, 0.34], { anchor: "top", attach: "bottom", at: [0, 0.06, 0.07], color: STEEL, tex: "metal-panel" }),
	part("footRight", "legRight", "cube", [0.24, 0.12, 0.34], { anchor: "top", attach: "bottom", at: [0, 0.06, 0.07], color: STEEL, tex: "metal-panel" }),

	part("armLeft", "torso", "cube", [0.09, 0.42, 0.09], { anchor: "top", attach: "left", at: [-0.05, 0.3, 0], rot: [-55, 0, -18], color: STEEL, tex: "metal-panel" }),
	part("armRight", "torso", "cube", [0.09, 0.42, 0.09], { anchor: "top", attach: "right", at: [0.05, 0.3, 0], rot: [-55, 0, 18], color: STEEL, tex: "metal-panel" }),
	part("forearmLeft", "armLeft", "cube", [0.1, 0.34, 0.1], { anchor: "top", attach: "bottom", rot: [-30, 0, 14], color: SKIN, tex: "wood-planks" }),
	part("forearmRight", "armRight", "cube", [0.1, 0.34, 0.1], { anchor: "top", attach: "bottom", rot: [-30, 0, -14], color: SKIN, tex: "wood-planks" }),
	part("handLeft", "forearmLeft", "cube", [0.14, 0.12, 0.14], { anchor: "top", attach: "bottom", color: HEAD }),
	part("handRight", "forearmRight", "cube", [0.14, 0.12, 0.14], { anchor: "top", attach: "bottom", color: HEAD }),

	// Poltergust 0.5: red tank on the back, hose, grey funnel nozzle held out front.
	part("tank", "torso", "cylinder", [0.42, 0.62, 0.42], { bounds: false, attach: "back", at: [0, 0.06, -0.18], color: RED, tex: "metal-panel", complexity: "high" }),
	part("tankCap", "tank", "sphere", [0.42, 0.2, 0.42], { bounds: false, anchor: "center", attach: "top", color: rgb(0.62, 0.07, 0.06) }),
	part("tankBand", "tank", "cylinder", [0.45, 0.06, 0.45], { bounds: false, at: [0, 0.12, 0], color: rgb(0.3, 0.3, 0.32) }),
	part("hose", "torso", "cylinder", [0.11, 0.62, 0.11], { bounds: false, attach: "right", at: [0.05, -0.08, 0.16], rot: [80, 0, 0], color: RED }),
	part("nozzle", "torso", "cone", [0.4, 0.46, 0.4], { bounds: false, attach: "front", at: [0, -0.06, 0.3], rot: [-90, 0, 0], color: rgb(0.55, 0.58, 0.6), tex: "metal-panel", complexity: "low" }),
	part("nozzleMouth", "torso", "cylinder", [0.42, 0.04, 0.42], { bounds: false, attach: "front", at: [0, -0.06, 0.53], rot: [90, 0, 0], color: rgb(0.16, 0.16, 0.18), complexity: "low" }),
];

const swing = (partId, axis, amount, duration = 1) => ({
	[partId]: {
		transform: {
			keyframes: [
				{ time: 0, value: { rotation: { x: 0, y: 0, z: 0, [axis]: amount } } },
				{ time: 0.5, value: { rotation: { x: 0, y: 0, z: 0, [axis]: -amount } }, easing: "easeInOut" },
				{ time: 1, value: { rotation: { x: 0, y: 0, z: 0, [axis]: amount } }, easing: "easeInOut" },
			],
		},
	},
});

const bob = (partId, height) => ({
	[partId]: {
		transform: {
			keyframes: [
				{ time: 0, value: { position: { x: 0, y: 0, z: 0 } } },
				{ time: 0.25, value: { position: { x: 0, y: height, z: 0 } }, easing: "easeOut" },
				{ time: 0.5, value: { position: { x: 0, y: 0, z: 0 } }, easing: "easeIn" },
				{ time: 0.75, value: { position: { x: 0, y: height, z: 0 } }, easing: "easeOut" },
				{ time: 1, value: { position: { x: 0, y: 0, z: 0 } }, easing: "easeIn" },
			],
		},
	},
});

const pose = (parts) => ({ duration: 0.4, loop: true, parts });
const still = (rotations) => Object.fromEntries(Object.entries(rotations).map(([id, rotation]) => [id, {
	transform: { keyframes: [{ time: 0, value: { rotation } }, { time: 1, value: { rotation } }] },
}]));

export const ROBOT_ANIMATIONS = {
	Idle: {
		duration: 2.4,
		loop: true,
		parts: {
			head: { transform: { keyframes: [
				{ time: 0, value: { rotation: { x: 0, y: 0, z: 0 } } },
				{ time: 0.5, value: { rotation: { x: 0, y: 0, z: 4 } }, easing: "easeInOut" },
				{ time: 1, value: { rotation: { x: 0, y: 0, z: 0 } }, easing: "easeInOut" },
			] } },
			...bob("torso", 0.015),
		},
	},
	Running: {
		duration: 0.62,
		loop: true,
		parts: {
			...swing("legLeft", "x", 32),
			...swing("legRight", "x", -32),
			...bob("torso", 0.05),
			hat: { transform: { keyframes: [
				{ time: 0, value: { rotation: { x: 0, y: 0, z: -4 } } },
				{ time: 0.5, value: { rotation: { x: 0, y: 0, z: 4 } }, easing: "easeInOut" },
				{ time: 1, value: { rotation: { x: 0, y: 0, z: -4 } }, easing: "easeInOut" },
			] } },
		},
	},
	Stopping: pose(still({ legLeft: { x: -12, y: 0, z: 0 }, legRight: { x: 18, y: 0, z: 0 } })),
	Jumping: pose(still({ legLeft: { x: -28, y: 0, z: 0 }, legRight: { x: 14, y: 0, z: 0 }, hat: { x: -8, y: 0, z: 0 } })),
	Falling: pose(still({ legLeft: { x: 16, y: 0, z: 0 }, legRight: { x: -16, y: 0, z: 0 }, hat: { x: 10, y: 0, z: 0 } })),
	Sliding: pose(still({ legLeft: { x: -20, y: 0, z: 0 }, legRight: { x: -20, y: 0, z: 0 } })),
	Stunned: pose(still({ head: { x: 0, y: 0, z: 18 } })),
	Dead: pose(still({ head: { x: 30, y: 0, z: 0 } })),
};
