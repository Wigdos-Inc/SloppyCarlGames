// Ghost Gallery: the engine Simulator, browsing every model in the game.
import { BuildBlueprints, GHOST_SPECIES } from "./blueprints.js";
import { ROBOT_PARTS, ROBOT_ANIMATIONS } from "./robot.js";

const robot = {
	id: "gallery.robot",
	type: "entity",
	hp: 1,
	movement: { speed: 0, physics: { gravity: false, buoyancy: false, resistance: false, correction: false, collision: false } },
	collisionOverride: { physics: "capsule", hurtbox: null, hitbox: null },
	animations: ROBOT_ANIMATIONS,
	model: { rootTransform: { position: { x: 0, y: 0, z: 0 } }, parts: ROBOT_PARTS },
};

function entries() {
	const blueprints = BuildBlueprints();
	return [
		{ name: "YOU — Unpaid Cleaning Robot (W/S: animations)", objectType: "entity", definition: robot },
		...blueprints.enemies.map((definition) => ({ name: `${GHOST_SPECIES[definition.hardcoded.species].name}`, objectType: "enemy", definition })),
		...blueprints.entities.map((definition) => ({ name: definition.id === "trash.bags" ? "Trash Pile" : "Junk Heap", objectType: "entity", definition })),
		...blueprints.collectibles.map((definition) => ({ name: "Health Heart", objectType: "collectible", definition })),
	];
}

let list = [];
let index = 0;
let caption = null;

// The Simulator owns input while open; a plain DOM caption avoids flipping it into UI-mode routing.
function showCaption() {
	if (!caption) {
		caption = document.createElement("div");
		Object.assign(caption.style, {
			position: "fixed", left: "50%", top: "24px", transform: "translateX(-50%)", zIndex: "30", pointerEvents: "none",
			fontFamily: "\"Nunito\", sans-serif", fontWeight: "900", fontSize: "30px", color: "#fff", textAlign: "center",
			textShadow: "-2px -2px 0 #120c10, 2px -2px 0 #120c10, -2px 2px 0 #120c10, 2px 2px 0 #120c10",
		});
		document.body.appendChild(caption);
	}
	caption.innerHTML = `GHOST GALLERY<br><span style="font-size:22px">${list[index].name}</span><br><span style="font-size:16px;opacity:.8">A / D browse · mouse orbit · Esc back</span>`;
}

async function load() {
	await ENGINE.Simulator.Load({ id: list[index].definition.id });
	showCaption();
}

export async function OpenGallery() {
	list = entries();
	index = 0;
	await ENGINE.Simulator.Cache(list.map(({ definition, objectType }) => ({ definition, objectType })));
	await ENGINE.Simulator.Start();
	await load();
}

export const GalleryOpen = () => caption !== null;

export function HandleGalleryInput(detail) {
	if (!caption || detail.type !== "keydown") return;
	if (detail.code === "KeyD") { index = (index + 1) % list.length; void load(); }
	if (detail.code === "KeyA") { index = (index - 1 + list.length) % list.length; void load(); }
}

window.addEventListener("SIMULATOR_EXITED", () => {
	caption?.remove();
	caption = null;
});
