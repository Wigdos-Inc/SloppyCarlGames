// Entity blueprints: ghosts, trash piles, heart pickups. Model front is +Z.
import { rgb } from "./build.js";

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
		color: options.color,
		texture: { generated: { id: options.tex || "none" }, custom: [] },
	};
}

const transform = () => ({
	position: { x: 0, y: 0, z: 0 },
	rotation: { x: 0, y: 0, z: 0 },
	scale: { x: 1, y: 1, z: 1 },
	pivot: { x: 0, y: 0, z: 0 },
});

function blueprint(id, type, parts, extra = {}) {
	return {
		id,
		type,
		hp: 1,
		movement: {
			start: { x: 0, y: 0, z: 0 },
			end: { x: 0, y: 0, z: 0 },
			repeat: false,
			backAndForth: false,
			speed: 0,
			physics: { gravity: false, buoyancy: false, resistance: false, correction: false, collision: extra.collide ?? false },
		},
		velocity: { x: 0, y: 0, z: 0 },
		collisionOverride: { physics: extra.collider || "sphere", hurtbox: null, hitbox: null },
		hardcoded: extra.hardcoded || {},
		animations: {},
		model: { spawnSurfaceId: null, rootTransform: transform(), parts },
	};
}

// Ghosts. `scale` sizes the whole species; hardcoded carries gameplay tuning read by ghosts.js.
export const GHOST_SPECIES = {
	goober:   { body: rgb(0.60, 0.24, 0.80), size: 1.0,  stamina: 2.6, speed: 2.2, dash: 8,  score: 100, name: "Goober" },
	snotling: { body: rgb(0.42, 0.76, 0.28), size: 0.75, stamina: 1.8, speed: 3.4, dash: 10, score: 120, name: "Snotling" },
	grumpus:  { body: rgb(0.86, 0.36, 0.20), size: 1.3,  stamina: 4.0, speed: 1.8, dash: 9,  score: 200, name: "Grumpus" },
	landlord: { body: rgb(0.45, 0.20, 0.62), size: 2.3,  stamina: 14,  speed: 2.4, dash: 11, score: 1000, name: "The Landlord" },
};

function ghostParts(species) {
	const s = GHOST_SPECIES[species].size;
	const body = GHOST_SPECIES[species].body;
	const light = rgb(Math.min(1, body.r * 1.35), Math.min(1, body.g * 1.35), Math.min(1, body.b * 1.35));
	const k = (v) => v * s;
	const parts = [
		part("body", "root", "sphere", [k(1.25), k(1.1), k(1.2)], { anchor: "bottom", color: body, complexity: "low" }),
		part("crest", "body", "sphere", [k(0.75), k(0.6), k(0.7)], { at: [k(0.12), k(0.32), k(-0.05)], color: light, complexity: "low" }),
		part("tail", "body", "cone", [k(0.55), k(0.7), k(0.55)], { at: [k(0.1), k(-0.35), k(-0.55)], rot: [-120, 0, 15], color: body, complexity: "low" }),
		part("armLeft", "body", "sphere", [k(0.3), k(0.24), k(0.3)], { at: [k(0.62), k(-0.12), k(0.15)], color: light, complexity: "low" }),
		part("armRight", "body", "sphere", [k(0.3), k(0.24), k(0.3)], { at: [k(-0.62), k(-0.12), k(0.15)], color: light, complexity: "low" }),
		part("eyeLeft", "body", "sphere", [k(0.34), k(0.4), k(0.24)], { at: [k(0.2), k(0.14), k(0.5)], color: rgb(0.98, 0.98, 0.98), complexity: "high" }),
		part("eyeRight", "body", "sphere", [k(0.34), k(0.4), k(0.24)], { at: [k(-0.2), k(0.14), k(0.5)], color: rgb(0.98, 0.98, 0.98), complexity: "high" }),
		part("pupilLeft", "eyeLeft", "sphere", [k(0.14), k(0.17), k(0.08)], { at: [k(-0.02), k(-0.02), k(0.1)], color: rgb(0.05, 0.04, 0.06), complexity: "high" }),
		part("pupilRight", "eyeRight", "sphere", [k(0.14), k(0.17), k(0.08)], { at: [k(0.02), k(-0.02), k(0.1)], color: rgb(0.05, 0.04, 0.06), complexity: "high" }),
	];
	if (species === "landlord") {
		parts.push(
			part("hatBrim", "body", "cylinder", [k(0.9), k(0.05), k(0.9)], { at: [0, k(0.52), 0], rot: [0, 0, -8], color: rgb(0.08, 0.06, 0.08) }),
			part("hatTop", "hatBrim", "cylinder", [k(0.55), k(0.55), k(0.55)], { anchor: "bottom", attach: "top", color: rgb(0.1, 0.08, 0.1) }),
			part("hatBand", "hatTop", "cylinder", [k(0.57), k(0.08), k(0.57)], { anchor: "bottom", attach: "bottom", at: [0, k(0.04), 0], color: rgb(0.7, 0.12, 0.12) }),
			part("monocle", "eyeRight", "torus", [k(0.42), k(0.04), k(0.48)], { at: [0, 0, k(0.12)], rot: [90, 0, 0], color: rgb(0.85, 0.7, 0.25) }),
			part("mustacheL", "body", "capsule", [k(0.1), k(0.32), k(0.08)], { at: [k(0.13), k(-0.12), k(0.56)], rot: [0, 0, 70], color: rgb(0.12, 0.08, 0.1) }),
			part("mustacheR", "body", "capsule", [k(0.1), k(0.32), k(0.08)], { at: [k(-0.13), k(-0.12), k(0.56)], rot: [0, 0, -70], color: rgb(0.12, 0.08, 0.1) }),
		);
	}
	return parts;
}

const ghost = (species) => blueprint(`ghost.${species}`, "enemy", ghostParts(species), { hardcoded: { species } });

const BAG_GREEN = rgb(0.16, 0.30, 0.20);
const BAG_BLUE = rgb(0.12, 0.16, 0.32);
const CARDBOARD = rgb(0.74, 0.58, 0.38);
const PAPER = rgb(0.92, 0.92, 0.88);

const trashA = () => blueprint("trash.bags", "entity", [
	part("bagA", "root", "sphere", [0.95, 0.75, 0.85], { anchor: "bottom", color: BAG_GREEN, complexity: "low" }),
	part("bagATie", "bagA", "cone", [0.2, 0.22, 0.2], { anchor: "bottom", attach: "top", at: [0, -0.04, 0], color: BAG_GREEN, complexity: "low" }),
	part("bagB", "bagA", "sphere", [0.8, 0.62, 0.75], { at: [-0.62, -0.06, 0.2], color: BAG_BLUE, complexity: "low" }),
	part("box", "bagA", "cube", [0.5, 0.36, 0.42], { at: [0.55, -0.2, 0.3], rot: [0, 28, 6], color: CARDBOARD, tex: "wood-planks" }),
	part("paperA", "bagA", "cube", [0.32, 0.03, 0.24], { at: [0.1, -0.36, 0.6], rot: [0, 40, 0], color: PAPER }),
	part("paperB", "bagA", "cube", [0.28, 0.03, 0.22], { at: [-0.5, -0.36, 0.55], rot: [8, -30, 0], color: PAPER }),
	part("can", "bagA", "cylinder", [0.12, 0.22, 0.12], { at: [0.3, -0.27, -0.45], rot: [90, 30, 0], color: rgb(0.7, 0.15, 0.15), tex: "metal-panel" }),
], { collide: true, collider: "aabb" });

const trashB = () => blueprint("trash.junk", "entity", [
	part("box", "root", "cube", [0.6, 0.45, 0.5], { anchor: "bottom", rot: [0, 12, 0], color: CARDBOARD, tex: "wood-planks" }),
	part("boxB", "box", "cube", [0.45, 0.35, 0.4], { at: [0.05, 0.4, 0], rot: [0, -25, 4], color: rgb(0.66, 0.5, 0.32), tex: "wood-planks" }),
	part("bag", "box", "sphere", [0.7, 0.55, 0.65], { at: [-0.55, -0.05, 0.15], color: BAG_GREEN, complexity: "low" }),
	part("bottle", "box", "cylinder", [0.12, 0.34, 0.12], { at: [0.48, -0.06, 0.25], rot: [0, 0, 70], color: rgb(0.25, 0.55, 0.3), tex: "metal-panel" }),
	part("paper", "box", "cube", [0.3, 0.03, 0.25], { at: [0.2, -0.22, 0.45], rot: [0, 20, 0], color: PAPER }),
	part("plate", "box", "cylinder", [0.36, 0.03, 0.36], { at: [-0.2, -0.22, -0.42], color: PAPER }),
], { collide: true, collider: "aabb" });

const heart = () => blueprint("pickup.heart", "collectible", [
	part("lobeL", "root", "sphere", [0.32, 0.32, 0.2], { anchor: "bottom", at: [0.11, 0.62, 0], color: rgb(0.95, 0.42, 0.55), complexity: "high" }),
	part("lobeR", "lobeL", "sphere", [0.32, 0.32, 0.2], { at: [-0.22, 0, 0], color: rgb(0.95, 0.42, 0.55), complexity: "high" }),
	part("point", "lobeL", "cone", [0.42, 0.36, 0.2], { at: [-0.11, -0.2, 0], rot: [0, 0, 180], color: rgb(0.95, 0.42, 0.55) }),
], { collider: "aabb" });

export function BuildBlueprints() {
	return {
		enemies: Object.keys(GHOST_SPECIES).map(ghost),
		npcs: [],
		collectibles: [heart()],
		projectiles: [],
		entities: [trashA(), trashB()],
	};
}
