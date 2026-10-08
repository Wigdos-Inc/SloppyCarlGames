// Chapter 1 level payload: mansion shell + furniture + pooled entities.
import { rgb, Flip } from "./build.js";
import { BuildShell, ROOMS, RoomById, RoomCenter, WALL_HEIGHT } from "./mansion.js";
import * as F from "./furniture.js";
import { BuildBlueprints } from "./blueprints.js";
import { ROBOT_PARTS, ROBOT_ANIMATIONS } from "./robot.js";

export const SPAWN = { x: 22, y: 0.2, z: 4 };

// Ghost roster per room. The boss is held back until every other ghost is caught.
export const GHOSTS = [
	{ id: "ghost-foyer-0", species: "goober", room: "foyer", at: [24, 10] },
	{ id: "ghost-parlor-0", species: "goober", room: "parlor", at: [5, 5] },
	{ id: "ghost-parlor-1", species: "goober", room: "parlor", at: [9, 11] },
	{ id: "ghost-bath-0", species: "snotling", room: "bathroom", at: [36, 6] },
	{ id: "ghost-bath-1", species: "snotling", room: "bathroom", at: [40, 11] },
	{ id: "ghost-library-0", species: "goober", room: "library", at: [5, 26] },
	{ id: "ghost-library-1", species: "grumpus", room: "library", at: [9, 20] },
	{ id: "ghost-kitchen-0", species: "snotling", room: "kitchen", at: [35, 20] },
	{ id: "ghost-kitchen-1", species: "grumpus", room: "kitchen", at: [39, 26] },
	{ id: "ghost-kitchen-2", species: "goober", room: "kitchen", at: [41, 19] },
	{ id: "ghost-dining-0", species: "goober", room: "dining", at: [18, 19] },
	{ id: "ghost-boss", species: "landlord", room: "dining", at: [22, 24], boss: true },
];

export const TRASH = [
	{ id: "trash-foyer-0", kind: "bags", at: [26.8, 12.2], yaw: 20 },
	{ id: "trash-foyer-1", kind: "junk", at: [16.6, 10.5], yaw: -40 },
	{ id: "trash-parlor-0", kind: "junk", at: [10.5, 3], yaw: 70 },
	{ id: "trash-parlor-1", kind: "bags", at: [12, 9.5], yaw: 0 },
	{ id: "trash-bath-0", kind: "junk", at: [36, 12.6], yaw: 15 },
	{ id: "trash-bath-1", kind: "bags", at: [32.6, 4.2], yaw: -60 },
	{ id: "trash-library-0", kind: "bags", at: [12, 27], yaw: 45 },
	{ id: "trash-library-1", kind: "junk", at: [4.6, 18], yaw: 100 },
	{ id: "trash-dining-0", kind: "bags", at: [16.6, 30.2], yaw: -20 },
	{ id: "trash-dining-1", kind: "junk", at: [28, 17.4], yaw: 30 },
	{ id: "trash-kitchen-0", kind: "bags", at: [39.5, 18], yaw: 60 },
	{ id: "trash-kitchen-1", kind: "junk", at: [34.5, 27.6], yaw: -15 },
];

export const HEARTS = [
	{ id: "heart-parlor", at: [2.4, 13] },
	{ id: "heart-bath", at: [40.5, 2.2] },
	{ id: "heart-library", at: [11.6, 22.5] },
	{ id: "heart-kitchen", at: [42.5, 24.5] },
];

const roomOf = (x, z) => ROOMS.find((room) => x >= room.x[0] && x < room.x[1] && z >= room.z[0] && z < room.z[1]);

function flipObject(object) {
	object.position = { ...object.position, ...Flip(object.position.x, object.position.z) };
	object.rotation = { ...object.rotation, y: object.rotation.y + 180 };
	return object;
}

// Entities are placed relative to their spawn surface's top-center; every one sits on a room floor.
function placement(id, type, blueprintId, x, z, yaw = 0) {
	const room = roomOf(x, z);
	const center = RoomCenter(room);
	return {
		id,
		type,
		blueprintId,
		spawnSurfaceId: `${room.id}-floor`,
		rootTransform: {
			position: { x: center.x - x, y: 0, z: center.z - z },
			rotation: { x: 0, y: yaw + 180, z: 0 },
			scale: { x: 1, y: 1, z: 1 },
			pivot: { x: 0, y: 0, z: 0 },
		},
	};
}

function furniture(images) {
	const CEIL = WALL_HEIGHT - 1.8;
	const RED_RUG = rgb(0.50, 0.10, 0.12);
	return [
		// Foyer
		...F.BoardedDoor("foyer-door", [22, 0, 0.32], 0),
		...F.Rug("foyer-rug", [22, 0, 7.5], 0, 5, 8, RED_RUG),
		...F.Chandelier("foyer-chandelier", [22, CEIL, 7.5]),
		...F.Clock("foyer-clock", [14.62, 0, 12.6], 90),
		...F.Barrel("foyer-barrel", [16.8, 0, 3.2]),
		...F.Chair("foyer-chair", [26.6, 0, 8.8], -30, true),
		...F.Table("foyer-side", [28.9, 0, 4.2], 90, 1.4, 0.7),
		...F.Painting("foyer-portrait", [29.76, 1.7, 9.5], -90, 1.4, 1.8, rgb(0.20, 0.30, 0.22), images.portrait ? { image: images.portrait } : "robot"),

		// Parlor
		...F.Fireplace("parlor-fire", [1.0, 0, 7.5], 90),
		...F.Sofa("parlor-sofa", [5.6, 0, 7.5], -90),
		...F.Table("parlor-coffee", [3.4, 0, 7.5], 90, 1.6, 0.8),
		...F.Armchair("parlor-arm0", [3.6, 0, 3.4], 40),
		...F.Armchair("parlor-arm1", [3.6, 0, 11.6], 140),
		...F.Piano("parlor-piano", [11, 0, 14.25], 180),
		...F.Rug("parlor-rug", [4.8, 0, 7.5], 0, 5, 6, rgb(0.16, 0.30, 0.20)),
		...F.Painting("parlor-portrait", [7, 2.0, 14.76], 180, 1.2, 1.4, rgb(0.16, 0.14, 0.26), "ghost"),

		// Bathroom
		...F.Bathtub("bath-tub", [42.9, 0, 11.4], 90),
		...F.Toilet("bath-toilet", [43.1, 0, 3.6], -90),
		...F.Sink("bath-sink", [33.6, 0, 0.66], 0),
		...F.Barrel("bath-barrel", [31.2, 0, 13.8], rgb(0.30, 0.45, 0.62)),

		// Library
		...F.Bookshelf("lib-shelf0", [3.4, 0, 31.4], 180, 4),
		...F.Bookshelf("lib-shelf1", [10.6, 0, 31.4], 180, 4),
		...F.Bookshelf("lib-shelf2", [0.76, 0, 18.4], 90, 3.6),
		...F.Bookshelf("lib-shelf3", [0.76, 0, 28.6], 90, 3.6),
		...F.Table("lib-table", [8, 0, 23.5], 0, 2.6, 1.3),
		...F.Chair("lib-chair0", [8, 0, 22.4], 0),
		...F.Chair("lib-chair1", [8.6, 0, 24.7], 190, true),
		...F.Globe("lib-globe", [11.6, 0, 18.6]),
		...F.Armchair("lib-arm", [3.8, 0, 22.2], 60, rgb(0.42, 0.16, 0.12)),

		// Dining hall
		...F.Table("dining-table", [22, 0, 24], 0, 9, 2.2, rgb(0.86, 0.84, 0.78)),
		...[18.8, 21, 23, 25.2].flatMap((x, i) => [
			...F.Chair(`dining-chairN${i}`, [x, 0, 25.5], 180, i === 2),
			...F.Chair(`dining-chairS${i}`, [x, 0, 22.5], 0),
		]),
		...F.Chair("dining-chairW", [16.9, 0, 24], 90),
		...F.Chair("dining-chairE", [27.1, 0, 24], -90),
		...F.Candelabra("dining-candle0", [19.4, 0.94, 24]),
		...F.Candelabra("dining-candle1", [22, 0.94, 24]),
		...F.Candelabra("dining-candle2", [24.6, 0.94, 24]),
		...F.Chandelier("dining-chandelier0", [19, CEIL, 24]),
		...F.Chandelier("dining-chandelier1", [25, CEIL, 24]),
		...F.Clock("dining-clock", [29.38, 0, 29.5], -90),
		...F.Painting("dining-portrait", [22, 1.7, 31.55], 180, 1.8, 2.2, rgb(0.30, 0.16, 0.14), "landlord"),

		// Window frames on every pane (front z=0, back z=32, west x=0, east x=44).
		...[7, 17.5, 26.5, 37].flatMap((x, i) => F.WindowFrame(`win-front-${i}`, [x, 1.4, 0.2], 0)),
		...[7, 18.5, 25.5, 37].flatMap((x, i) => F.WindowFrame(`win-back-${i}`, [x, 1.4, 31.8], 180)),
		...F.WindowFrame("win-west", [0.2, 1.4, 23.5], 90),
		...F.WindowFrame("win-east", [43.8, 1.4, 7.5], -90),

		// Kitchen
		...F.Counter("kitchen-counter0", [35.4, 0, 31.4], 180, 8.6),
		...F.Stove("kitchen-stove", [41.6, 0, 31.4], 180),
		...F.Fridge("kitchen-fridge", [43.3, 0, 29.2], -90),
		...F.Counter("kitchen-counter1", [43.4, 0, 22], -90, 5),
		...F.Table("kitchen-table", [36.5, 0, 22.5], 0, 2.2, 1.2),
		...F.Chair("kitchen-chair0", [35.6, 0, 21.3], 0),
		...F.Chair("kitchen-chair1", [37.4, 0, 23.7], 180),
		...F.Barrel("kitchen-barrel0", [31.4, 0, 16.4], rgb(0.24, 0.5, 0.24)),
		...F.Barrel("kitchen-barrel1", [32.6, 0, 16.1]),
	];
}

export function BuildLevelPayload(images) {
	const entities = [
		...GHOSTS.map((g) => placement(g.id, "enemy", `ghost.${g.species}`, g.at[0], g.at[1])),
		...TRASH.map((t) => placement(t.id, "entity", `trash.${t.kind}`, t.at[0], t.at[1], t.yaw)),
		...HEARTS.map((h) => placement(h.id, "collectible", "pickup.heart", h.at[0], h.at[1])),
	];

	return {
		id: "lsm-chapter1",
		title: "Chapter 1 - Clean the Mess.",
		world: {
			length: 60,
			width: 50,
			height: 20,
			deathBarrierY: -10,
			water: { level: null, tint: rgb(0.03, 0.13, 0.2) },
			skybox: { mode: "gradient", color: [rgb(0.10, 0.06, 0.14), rgb(0.06, 0.05, 0.16), rgb(0.02, 0.02, 0.06)] },
			textureScale: 12,
			scatterScale: 1,
		},
		camera: {
			activeSet: "custom",
			situations: { slowMovement: "orbitCam", fastMovement: "orbitCam", slope: "orbitCam" },
			distance: { min: 2.5, default: 4.6, max: 7 },
			heightOffset: 1.7,
			aimHeight: 0.85,
			pitchLimit: { top: 30, bottom: 45 },
		},
		player: {
			character: "chara_prop",
			spawnPosition: { ...SPAWN, ...Flip(SPAWN.x, SPAWN.z) },
			scale: { x: 1, y: 1, z: 1 },
			modelParts: ROBOT_PARTS,
			animations: ROBOT_ANIMATIONS,
			metaOverrides: { list: ["maxSpeed 5.5", "airFloatiness 2"], maxSpeed: 5.5, airFloatiness: 2 },
		},
		terrain: { objects: [...BuildShell(images), ...furniture(images)].map(flipObject), triggers: [] },
		obstacles: [],
		entities,
		entityBlueprints: BuildBlueprints(),
		meta: { levelId: "lsm-mansion", stageId: "chapter-1" },
	};
}

export { ROOMS, RoomById };
