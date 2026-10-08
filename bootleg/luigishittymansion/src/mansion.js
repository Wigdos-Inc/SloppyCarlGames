// Mansion shell: floors, ceilings, walls, doorways, windows. Furniture lives in furniture.js.
import { Box, Wall, Decal, ImageDecal, rgb } from "./build.js";

export const WALL_HEIGHT = 5;
export const WALL_THICKNESS = 0.4;
export const DOOR = { width: 2.6, top: 3.3 };
export const WINDOW = { width: 2.2, bottom: 1.4, top: 3.6 };

// Mansion footprint: x 0..44, z 0..32. Row A is the front (z 0..15).
export const ROOMS = [
	{ id: "parlor",   name: "The Parlor",      x: [0, 14],  z: [0, 15],  floor: "wood",  wall: rgb(0.47, 0.50, 0.24), ceiling: rgb(0.28, 0.19, 0.12) },
	{ id: "foyer",    name: "The Foyer",       x: [14, 30], z: [0, 15],  floor: "wood",  wall: rgb(0.50, 0.53, 0.26), ceiling: rgb(0.30, 0.20, 0.13) },
	{ id: "bathroom", name: "The Bathroom",    x: [30, 44], z: [0, 15],  floor: "tile",  wall: rgb(0.42, 0.55, 0.50), ceiling: rgb(0.30, 0.30, 0.28) },
	{ id: "library",  name: "The Library",     x: [0, 14],  z: [15, 32], floor: "wood",  wall: rgb(0.40, 0.23, 0.20), ceiling: rgb(0.24, 0.15, 0.10) },
	{ id: "dining",   name: "The Dining Hall", x: [14, 30], z: [15, 32], floor: "wood",  wall: rgb(0.52, 0.30, 0.34), ceiling: rgb(0.28, 0.18, 0.14) },
	{ id: "kitchen",  name: "The Kitchen",     x: [30, 44], z: [15, 32], floor: "tile",  wall: rgb(0.55, 0.52, 0.36), ceiling: rgb(0.32, 0.28, 0.22) },
];

export const TEXTURES = {
	wood: "wood-planks",
	tile: "default-tiles",
	wall: "stone-block",
	trim: "wood-planks",
};

const FLOOR_COLORS = { wood: rgb(0.56, 0.38, 0.22), tile: rgb(0.78, 0.76, 0.70) };
const TRIM = rgb(0.30, 0.19, 0.11);
// Wall color is the base; the noise secondary is the bare plaster showing through torn wallpaper.
const WALLPAPER = { generated: { id: "stone-block", color: rgb(0.74, 0.64, 0.44), density: 0.35, speckSize: 1.4 }, custom: [] };
const EXTERIOR = rgb(0.36, 0.33, 0.30);

export const RoomCenter = (room) => ({ x: (room.x[0] + room.x[1]) / 2, z: (room.z[0] + room.z[1]) / 2 });
export const RoomById = (id) => ROOMS.find((room) => room.id === id);
export const RoomAt = (x, z) => ROOMS.find((room) => x >= room.x[0] && x < room.x[1] && z >= room.z[0] && z < room.z[1]) || null;

function roomShell(room) {
	const width = room.x[1] - room.x[0];
	const depth = room.z[1] - room.z[0];
	const center = RoomCenter(room);
	return [
		Box(`${room.id}-floor`, [center.x, -0.5, center.z], [width, 0.5, depth], FLOOR_COLORS[room.floor], TEXTURES[room.floor], {
			texture: { generated: { id: TEXTURES[room.floor] }, custom: floorStains(room) },
		}),
		Box(`${room.id}-ceiling`, [center.x, WALL_HEIGHT, center.z], [width, 0.4, depth], room.ceiling, TEXTURES.wood),
	];
}

const door = (at) => ({ at, width: DOOR.width, top: DOOR.top });
const pane = (at) => ({ at, width: WINDOW.width, bottom: WINDOW.bottom, top: WINDOW.top });

function walls() {
	const H = WALL_HEIGHT;
	const T = WALL_THICKNESS;
	const wall = (id, axis, line, from, to, color, gaps) => Wall(id, axis, line, from, to, { height: H, thickness: T, color, texture: WALLPAPER, gaps, trimColor: TRIM });
	const room = (id) => RoomById(id).wall;

	return [
		// Exterior: front (z=0) has the boarded front door and windows; back (z=32) windows.
		...wall("ext-front-w", "x", T / 2, 0, 14, room("parlor"), [pane(7)]),
		...wall("ext-front-c", "x", T / 2, 14, 30, room("foyer"), [pane(17.5), door(22), pane(26.5)]),
		...wall("ext-front-e", "x", T / 2, 30, 44, room("bathroom"), [pane(37)]),
		...wall("ext-back-w", "x", 32 - T / 2, 0, 14, room("library"), [pane(7)]),
		...wall("ext-back-c", "x", 32 - T / 2, 14, 30, room("dining"), [pane(18.5), pane(25.5)]),
		...wall("ext-back-e", "x", 32 - T / 2, 30, 44, room("kitchen"), [pane(37)]),
		...wall("ext-west-a", "z", T / 2, 0, 15, room("parlor"), []),
		...wall("ext-west-b", "z", T / 2, 15, 32, room("library"), [pane(23.5)]),
		...wall("ext-east-a", "z", 44 - T / 2, 0, 15, room("bathroom"), [pane(7.5)]),
		...wall("ext-east-b", "z", 44 - T / 2, 15, 32, room("kitchen"), []),

		// Interior partitions.
		...wall("int-x14-a", "z", 14, 0, 15, room("parlor"), [door(7.5)]),
		...wall("int-x30-a", "z", 30, 0, 15, room("bathroom"), [door(7.5)]),
		...wall("int-x14-b", "z", 14, 15, 32, room("library"), [door(23.5)]),
		...wall("int-x30-b", "z", 30, 15, 32, room("kitchen"), [door(23.5)]),
		...wall("int-z15-w", "x", 15, 0, 14, room("parlor"), [door(7)]),
		...wall("int-z15-c", "x", 15, 14, 30, room("foyer"), [{ at: 22, width: 4, top: 3.8 }]),
		...wall("int-z15-e", "x", 15, 30, 44, room("bathroom"), [door(37)]),
	];
}

const decal = Decal;

// Grime on the floors: brown puddles and scuffs, denser in the bathroom and kitchen.
const STAINS = { foyer: 5, parlor: 4, bathroom: 9, library: 3, dining: 5, kitchen: 8 };
function floorStains(room) {
	const width = room.x[1] - room.x[0];
	const depth = room.z[1] - room.z[0];
	let s = room.x[0] * 31 + room.z[0] * 7 + 3;
	const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
	const out = [];
	for (let i = 0; i < STAINS[room.id]; i++) {
		const size = 0.5 + r() * 1.3;
		const brown = room.floor === "tile" ? rgb(0.42, 0.33, 0.14, 0.75) : rgb(0.22, 0.14, 0.07, 0.6);
		out.push(decal(r() < 0.6 ? "circle" : "pill", brown, "top", (r() - 0.5) * (width - 2), (r() - 0.5) * (depth - 2), r() * 360, size, size * (0.5 + r() * 0.5)));
	}
	return out;
}

// Night sky backdrops behind every window; `side` is the face looking into the house.
function windowBackdrops(images) {
	const sky = rgb(0.07, 0.08, 0.20);
	const moon = rgb(0.96, 0.92, 0.66);
	const star = rgb(0.85, 0.85, 1);
	const out = [];
	const backdrop = (id, pos, dims, side, withMoon) => out.push(Box(id, pos, dims, sky, "none", { texture: {
		generated: { id: "none" },
		custom: images.moon ? [ImageDecal(images.moon, side, 0, 0.2, 0, 2.8, 2.6)] : [
			...(withMoon ? [decal("circle", moon, side, 0.55, 0.75, 0, 1.0, 1.0), decal("circle", sky, side, 0.85, 0.95, 0, 0.9, 0.9)] : []),
			decal("circle", star, side, -0.8, 1.2, 0, 0.08, 0.08),
			decal("circle", star, side, -0.3, 0.4, 0, 0.06, 0.06),
			decal("circle", star, side, 0.9, -0.6, 0, 0.07, 0.07),
		],
	} }));
	[7, 17.5, 26.5, 37].forEach((x, i) => backdrop(`sky-front-${i}`, [x, 0.8, -1.2], [3.2, 3.6, 0.2], "front", i === 1));
	[7, 18.5, 25.5, 37].forEach((x, i) => backdrop(`sky-back-${i}`, [x, 0.8, 33.2], [3.2, 3.6, 0.2], "back", i % 2 === 0));
	backdrop("sky-west-0", [-1.2, 0.8, 23.5], [0.2, 3.6, 3.2], "right", true);
	backdrop("sky-east-0", [45.2, 0.8, 7.5], [0.2, 3.6, 3.2], "left", false);
	return out;
}

// Cracks: a few thin dark pills forking from a point, on both faces of a wall piece.
function addCracks(piece, seed, crackImage) {
	const along = piece.dimensions.x > piece.dimensions.z ? "x" : "z";
	const sides = along === "x" ? ["front", "back"] : ["left", "right"];
	const length = along === "x" ? piece.dimensions.x : piece.dimensions.z;
	const ink = rgb(0.10, 0.08, 0.07);
	let s = seed;
	const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
	const cx = (r() - 0.5) * (length - 1.5);
	const cy = -0.5 + r() * 1.6;
	const custom = piece.texture.custom;
	sides.forEach((side) => {
		const base = r() * 360;
		if (crackImage) {
			custom.push(ImageDecal(crackImage, side, cx, cy, base, 1.6, 1.6));
			return;
		}
		for (let i = 0; i < 4; i++) {
			const angle = base + i * 70 + r() * 30;
			const len = 0.45 + r() * 0.6;
			const rad = (angle * Math.PI) / 180;
			custom.push(decal("pill", ink, side, cx + Math.cos(rad) * len * 0.5, cy + Math.sin(rad) * len * 0.5, angle, len, 0.045));
		}
	});
}

// images: optional { moon, crack } URLs that replace the shape-decal placeholders.
export function BuildShell(images) {
	const objects = [];
	ROOMS.forEach((room) => objects.push(...roomShell(room)));
	const wallPieces = walls();
	wallPieces.filter((piece) => Math.max(piece.dimensions.x, piece.dimensions.z) > 3.5 && piece.dimensions.y > 4).forEach((piece, i) => {
		if (i % 2 === 0) addCracks(piece, i * 131 + 17, images.crack);
	});
	objects.push(...wallPieces);
	objects.push(...windowBackdrops(images));
	// A ground skirt under the whole house so nothing falls into the void through seams.
	objects.push(Box("ground-skirt", [22, -3, 16], [60, 2, 50], EXTERIOR, TEXTURES.tile));
	return objects;
}
