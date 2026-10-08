// Chapter flow, the per-frame loop, and every gameplay rule (the engine provides none of it).
import { BuildLevelPayload, GHOSTS, TRASH } from "./level.js";
import { ROOMS, RoomAt, RoomById } from "./mansion.js";
import { GHOST_SPECIES } from "./blueprints.js";
import * as Hud from "./hud.js";
import * as Menus from "./menus.js";
import { PlaySfx, PlayMusic, PreloadAudio, AssetUrl, AssetExists, AudioDuration } from "./assets.js";
import { StartHum, StopHum, SetHumLoad } from "./synth.js";
import { LoadSettings, ApplySettings } from "./settings.js";
import * as W from "./world.js";
import { Flip } from "./build.js";

const MAX_HEALTH = 5;
const INVULN_SECONDS = 1.6;
const VACUUM = { range: 7.5, trashRange: 5.5, halfAngle: (30 * Math.PI) / 180, reachY: 2.8 };
const MANSION = { x: [0.9, 43.1], z: [0.9, 31.1] };
const HOVER = 0.45;
const DEG = Math.PI / 180;

let run = null;
let starting = false;
let paused = false;
let pausedBySelf = false;
let last = performance.now();
const keys = new Set();
let mouseVacuum = false;

const QUIPS = {
	parlor: "Smells like old cigars and older regret.",
	bathroom: "Oh no. Oh no no no.",
	library: "Shhh. The dust is sleeping.",
	kitchen: "Something in that pot is breathing.",
	dining: "Reservations for one ectoplasm.",
};
const TAUNTS = ["BOO!", "RENT IS DUE!", "GET OUT OF MY HOUSE!", "NICE HAT, NERD!", "WOOOOO!", "YOU MISSED A SPOT!"];

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

function norm2(x, z) {
	const l = Math.hypot(x, z) || 1;
	return { x: x / l, z: z / l };
}

/* === INPUT === */

function applyMovementInput() {
	const input = ENGINE.Level.Player.Input;
	input.forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
	input.right = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
	input.jump = keys.has("Space");
}

function resetInput() {
	keys.clear();
	mouseVacuum = false;
	const input = ENGINE.Level.Player.Input;
	input.forward = 0;
	input.right = 0;
	input.jump = false;
}

export function HandleGameInput(detail) {
	if (!run || run.over) return;
	if (detail.type === "keydown") keys.add(detail.code);
	else if (detail.type === "keyup") keys.delete(detail.code);
	else return;
	applyMovementInput();
}

// The camera swallows pointerdown in level mode, so the vacuum trigger listens on window directly.
window.addEventListener("pointerdown", (event) => { if (event.button === 0 && run && !paused) mouseVacuum = true; });
window.addEventListener("pointerup", (event) => { if (event.button === 0) mouseVacuum = false; });
window.addEventListener("blur", () => { if (run) resetInput(); });

const vacuumHeld = () => mouseVacuum || keys.has("KeyJ") || keys.has("KeyK") || keys.has("KeyE");

/* === SCENE MEMBERSHIP (pooled entities) === */

function hide(entity) {
	const entities = W.Scene().entities;
	const index = entities.indexOf(entity);
	if (index >= 0) entities.splice(index, 1);
}

function show(entity) {
	const entities = W.Scene().entities;
	if (!entities.includes(entity)) entities.push(entity);
}

/* === RUN SETUP === */

function createRun() {
	const player = W.Player();
	const ghosts = GHOSTS.map((def) => {
		const entity = W.FindEntity(def.id);
		hide(entity);
		const cfg = GHOST_SPECIES[def.species];
		return {
			def, cfg, entity,
			state: "dormant", t: 0, stamina: cfg.stamina,
			pos: { ...Flip(def.at[0], def.at[1]), y: HOVER },
			target: Flip(def.at[0], def.at[1]),
			yaw: 0, bob: rand(0, 6), orbit: rand(0, Math.PI * 2), stalkFor: 2, dashDir: { x: 0, z: 1 }, fx: 0, calm: 0,
		};
	});
	const trash = TRASH.map((def) => {
		const entity = W.FindEntity(def.id);
		const p = entity.transform.position;
		return { def, entity, state: "idle", progress: 0, t: 0, base: { x: p.x, y: p.y, z: p.z }, from: null };
	});
	return {
		score: 0, ghostsCaught: 0, ghostTotal: GHOSTS.length, trashCleaned: 0, trashTotal: TRASH.length,
		health: MAX_HEALTH, maxHealth: MAX_HEALTH, time: 0, invuln: 0, over: false,
		visited: new Set(), room: null, bossReady: false, bossOut: false,
		ghosts, trash,
		nozzle: player.model.parts.find((part) => part.id === "nozzleMouth").mesh,
		vacuumOn: false, fxTimer: 0, hintTimer: 0, musicLeft: 0,
	};
}

export async function StartChapter() {
	if (starting) return;
	starting = true;
	ENGINE.UI.ClearUI("engine-ui-root");
	Menus.ClearOverlay();
	ApplySettings(LoadSettings());
	// Engine bug: flat decal quads are wound into their host, so culling discards every cube decal.
	ENGINE.Config.Performance.BackfaceCulling = false;
	await PreloadAudio();
	resetInput();
	paused = false;
	pausedBySelf = false;
	await Hud.ShowHud(MAX_HEALTH, "Chapter 1 - Clean the Mess.");
	const optional = async (path) => (await AssetExists(path)) ? AssetUrl(path) : null;
	const images = { moon: await optional("images/moon_window.jpeg"), crack: await optional("images/wall_crack.png"), portrait: await optional("images/portrait.png") };
	const scene = await ENGINE.Level.CreateLevel(BuildLevelPayload(images), { renderOptions: { rootId: "engine-level-root" } });
	starting = false;
	if (!scene) {
		ENGINE.Log("GAME", "chapter 1 payload rejected; see validation channel", "error", "Level");
		return;
	}
	run = createRun();
	Hud.UpdateBoss(null);
	Hud.ShowHint("WASD move · MOUSE look · hold LEFT CLICK / J to vacuum · SPACE jump");
	startMansionMusic(run);
}

// The intro plays once, then the loop takes over. The engine has no music-ended signal, so the
// handoff runs on a countdown that only advances while the level (and therefore its music) is running.
const MUSIC = { full: "audio/mansion_theme_full.mp3", loop: "audio/mansion_theme_loop.mp3" };

async function startMansionMusic(current) {
	const seconds = (await AssetExists(MUSIC.full)) ? await AudioDuration(MUSIC.full) : 0;
	if (run !== current) return;
	if (!seconds) return void PlayMusic("LSM_MANSION_LOOP", MUSIC.loop);
	await PlayMusic("LSM_MANSION_FULL", MUSIC.full, false);
	current.musicLeft = seconds;
}

function updateMusic(seconds) {
	if (!(run.musicLeft > 0)) return;
	run.musicLeft -= seconds;
	if (run.musicLeft <= 0) PlayMusic("LSM_MANSION_LOOP", MUSIC.loop);
}

function endRun() {
	run = null;
	StopHum();
	resetInput();
	ENGINE.Level.ClearLevel();
	ENGINE.Input.ReleasePointerLock();
	Hud.HideHud();
	Menus.ClearOverlay();
}

export function QuitToTitle() {
	endRun();
	Menus.ShowTitle();
}

export function RestartChapter() {
	endRun();
	StartChapter();
}

export function HandlePause() {
	paused = true;
	resetInput();
	StopHum();
	ENGINE.Audio.PauseMusic();
	if (run && !run.over && !pausedBySelf) Menus.ShowPause();
}

export function HandleResume() {
	paused = false;
	Menus.ClearOverlay();
	ENGINE.Audio.ResumeMusic();
}

function freezeFor(screen) {
	pausedBySelf = true;
	ENGINE.Level.PauseLevel();
	screen();
}

/* === HEALTH === */

function playerCenter(player) {
	const box = player.collision.aabb;
	return { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2 };
}

function hurtPlayer(ghost, player) {
	if (run.invuln > 0 || run.over) return;
	run.health -= ghost.def.boss ? 2 : 1;
	run.invuln = INVULN_SECONDS;
	Hud.FlashHurt();
	PlaySfx("hurt");
	setTimeout(() => PlaySfx("ghost_laugh"), 180);
	Hud.Toast(TAUNTS[Math.floor(Math.random() * TAUNTS.length)], 1300);
	const away = norm2(player.transform.position.x - ghost.pos.x, player.transform.position.z - ghost.pos.z);
	player.velocity.set({ x: away.x * 7, y: 4.5, z: away.z * 7 });
	player.launched = true;
	ghost.state = "recover";
	ghost.t = 0;
	ghost.calm = rand(3, 5);
	if (run.health <= 0) loseChapter();
}

window.addEventListener("COLLECTIBLE_PICKED_UP", (event) => {
	if (!run || !event.detail.id.startsWith("heart")) return;
	run.health = Math.min(run.maxHealth, run.health + 1);
	PlaySfx("heart");
	Hud.Toast("+1 HEALTH");
});

/* === ROOMS === */

function enterRoom(room) {
	run.room = room;
	if (room.id === "dining" && run.bossReady && !run.bossOut) summonBoss();
	if (run.visited.has(room.id)) return;
	run.visited.add(room.id);
	if (room.id !== "foyer") Hud.Toast(`${room.name.toUpperCase()}\n${QUIPS[room.id]}`, 2800);
	run.ghosts.filter((g) => g.def.room === room.id && !g.def.boss).forEach((g, i) => wakeGhost(g, room.id === "foyer" ? 2.5 + i : 0.4 + i * 0.5));
}

// Fresh ghosts roam before their first attack; the Foyer's tutorial ghost waits longest.
function wakeGhost(ghost, delay) {
	ghost.state = "waiting";
	ghost.t = -delay;
	ghost.calm = ghost.def.room === "foyer" ? 5 : 1.5;
}

function summonBoss() {
	run.bossOut = true;
	const boss = run.ghosts.find((g) => g.def.boss);
	wakeGhost(boss, 0.8);
	Hud.Toast("THE LANDLORD WANTS HIS RENT!", 3200);
	Hud.UpdateBoss(1);
}

/* === VACUUM === */

function aimDirection(player) {
	const forward = W.CameraForward();
	if (forward && Math.hypot(forward.x, forward.z) > 0.05) return norm2(forward.x, forward.z);
	return norm2(player.facing.x, player.facing.z);
}

// 0 outside the cone, else 1 at the nozzle falling to ~0 at max range.
function coneStrength(nozzle, aim, point, range) {
	const dx = point.x - nozzle.x;
	const dz = point.z - nozzle.z;
	const d = Math.hypot(dx, dz);
	if (d > range || Math.abs(point.y - nozzle.y) > VACUUM.reachY) return 0;
	if (d < 0.6) return 1;
	const cos = (dx * aim.x + dz * aim.z) / d;
	if (cos < Math.cos(VACUUM.halfAngle)) return 0;
	return Math.max(0.05, 1 - d / range);
}

function updateVacuum(dt, player) {
	const on = vacuumHeld() && !run.over;
	if (on !== run.vacuumOn) {
		run.vacuumOn = on;
		if (on) { PlaySfx("vacuum_start"); StartHum(); } else StopHum();
	}
	// Vacuuming slows you, Shift sprints (boost is internal player state; there is no speed API).
	const sprint = !on && (keys.has("ShiftLeft") || keys.has("ShiftRight"));
	Object.assign(player.boost, on
		? { active: true, timer: 1, maxSpeedMultiplier: 0.55, accelMultiplier: 1 }
		: sprint
			? { active: true, timer: 1, maxSpeedMultiplier: 1.55, accelMultiplier: 1.3 }
			: { active: false, timer: 0, maxSpeedMultiplier: 1, accelMultiplier: 1 });
	if (!on) return null;

	const aim = aimDirection(player);
	Object.assign(player.facing, { x: aim.x, y: 0, z: aim.z });
	const nozzle = run.nozzle.transform.position;

	run.fxTimer -= dt;
	if (run.fxTimer <= 0) {
		run.fxTimer = 0.07;
		const r = rand(1.8, VACUUM.range - 0.5);
		const a = rand(-VACUUM.halfAngle, VACUUM.halfAngle) * 0.85;
		const dir = { x: aim.x * Math.cos(a) - aim.z * Math.sin(a), z: aim.x * Math.sin(a) + aim.z * Math.cos(a) };
		const from = { x: nozzle.x + dir.x * r, y: nozzle.y + rand(-0.5, 0.9), z: nozzle.z + dir.z * r };
		const speed = 10;
		const v = { x: (nozzle.x - from.x) / r * speed, y: (nozzle.y - from.y) / r * speed, z: (nozzle.z - from.z) / r * speed };
		ENGINE.Level.SpawnParticles({
			id: "smoke",
			position: from,
			overrides: {
				count: 2, spread: "narrow", physics: "none", velocity: v,
				color: { start: { r: 0.88, g: 0.9, b: 1, a: 0.45 }, variance: 0.06, end: null },
				duration: { mode: "shrink", holdTimeMs: 0, endTimeMs: Math.round((r / speed) * 950), intervalMs: 1000 },
			},
		}, false);
	}
	return { aim, nozzle };
}

/* === GHOSTS === */

const ghostCenter = (g) => ({ x: g.pos.x, y: g.pos.y + 0.55 * g.cfg.size, z: g.pos.z });

function roamTarget(ghost) {
	const room = RoomById(ghost.def.room);
	return Flip(rand(room.x[0] + 1.6, room.x[1] - 1.6), rand(room.z[0] + 1.6, room.z[1] - 1.6));
}

function moveToward(ghost, tx, tz, speed, dt) {
	const dx = tx - ghost.pos.x;
	const dz = tz - ghost.pos.z;
	const d = Math.hypot(dx, dz);
	if (d < 0.01) return d;
	const step = Math.min(d, speed * dt);
	ghost.pos.x += (dx / d) * step;
	ghost.pos.z += (dz / d) * step;
	return d;
}

function captureGhost(ghost) {
	ghost.state = "captured";
	ghost.t = 0;
	ghost.from = { ...ghost.pos };
	W.Tint(ghost.entity, { r: 1, g: 1, b: 1, a: 0.85 });
}

function finishCapture(ghost) {
	ghost.state = "gone";
	hide(ghost.entity);
	run.ghostsCaught += 1;
	run.score += ghost.cfg.score;
	PlaySfx("capture");
	const n = run.nozzle.transform.position;
	ENGINE.Level.SpawnParticles({ id: "spark", position: { x: n.x, y: n.y, z: n.z }, overrides: {
		count: 30, spread: "max", physics: "simple", velocity: { x: 0, y: 3.5, z: 0 },
		color: { start: { r: ghost.cfg.body.r, g: ghost.cfg.body.g, b: ghost.cfg.body.b, a: 1 }, variance: 0.15, end: { r: 1, g: 1, b: 1 } },
		duration: { mode: "shrink", holdTimeMs: 100, endTimeMs: 800, intervalMs: 1200 },
	} }, false);
	const roomLeft = run.ghosts.some((g) => g.def.room === ghost.def.room && !g.def.boss && g.state !== "gone");
	const roomClear = !ghost.def.boss && !roomLeft && run.ghosts.filter((g) => g.def.room === ghost.def.room && !g.def.boss).length > 0;
	if (roomClear) run.score += 150;
	Hud.Toast(`${ghost.cfg.name.toUpperCase()} CAPTURED! +${ghost.cfg.score}${roomClear ? "\nROOM CLEAR! +150" : ""}`);

	if (ghost.def.boss) return winChapter();
	const regularLeft = run.ghosts.some((g) => !g.def.boss && g.state !== "gone");
	if (!regularLeft && !run.bossReady) {
		run.bossReady = true;
		const current = run;
		setTimeout(() => {
			if (run !== current || run.over || run.bossOut) return;
			if (run.room && run.room.id === "dining") summonBoss();
			else Hud.Toast("Something BIG stirs in the Dining Hall...", 3500);
		}, 1600);
	}
}

function updateGhost(ghost, dt, player, vac) {
	if (ghost.state === "dormant" || ghost.state === "gone") return;
	ghost.t += dt;
	const cfg = ghost.cfg;
	const pp = player.transform.position;
	const toPlayer = Math.hypot(pp.x - ghost.pos.x, pp.z - ghost.pos.z);

	if (ghost.state === "waiting") {
		if (ghost.t < 0) return;
		show(ghost.entity);
		ghost.state = "appear";
		ghost.t = 0;
		const c = ghostCenter(ghost);
		ENGINE.Level.SpawnParticles({ id: "smoke", position: c, overrides: {
			count: 14, spread: "max", physics: "none", velocity: { x: 0, y: 1.2, z: 0 },
			color: { start: { r: cfg.body.r, g: cfg.body.g, b: cfg.body.b, a: 0.7 }, variance: 0.1, end: null },
			duration: { mode: "fade", holdTimeMs: 150, endTimeMs: 900, intervalMs: 1000 },
		} }, false);
		PlaySfx("ghost_laugh");
	}

	let squash = 0;
	let tint = null;
	const strength = vac && ghost.state !== "appear" && ghost.state !== "captured" ? coneStrength(vac.nozzle, vac.aim, ghostCenter(ghost), VACUUM.range) : 0;

	if (strength > 0 && ghost.state !== "caught") {
		ghost.state = "caught";
		ghost.t = 0;
	}

	switch (ghost.state) {
		case "appear": {
			const k = Math.min(1, ghost.t / 0.7);
			W.SetScale(ghost.entity, Math.max(0.01, easeOutBack(k)));
			if (k >= 1) { ghost.state = "roam"; ghost.t = 0; ghost.target = roamTarget(ghost); }
			break;
		}
		case "roam": {
			if (moveToward(ghost, ghost.target.x, ghost.target.z, cfg.speed * 0.7, dt) < 0.3 || ghost.t > 5) {
				ghost.target = roamTarget(ghost);
				ghost.t = 0;
			}
			ghost.calm -= dt;
			const sameRoom = run.room && run.room.id === ghost.def.room;
			if (ghost.calm <= 0 && ((sameRoom && toPlayer < 11) || toPlayer < 6)) {
				ghost.state = "stalk";
				ghost.t = 0;
				ghost.stalkFor = rand(1.6, 3.2) * (ghost.def.boss ? 0.7 : 1);
			}
			break;
		}
		case "stalk": {
			ghost.orbit += dt * 0.9;
			const radius = ghost.def.boss ? 4.5 : 3.2;
			moveToward(ghost, pp.x + Math.cos(ghost.orbit) * radius, pp.z + Math.sin(ghost.orbit) * radius, cfg.speed * 1.3, dt);
			if (ghost.t > ghost.stalkFor) { ghost.state = "windup"; ghost.t = 0; }
			if (toPlayer > 16) { ghost.state = "roam"; ghost.t = 0; }
			break;
		}
		case "windup": {
			tint = Math.floor(ghost.t * 14) % 2 ? { r: 1, g: 0.35, b: 0.35, a: 1 } : null;
			ghost.pos.x += rand(-1, 1) * 0.04;
			ghost.pos.z += rand(-1, 1) * 0.04;
			squash = 0.12 * Math.sin(ghost.t * 40);
			if (ghost.t > (ghost.def.boss ? 0.6 : 0.85)) {
				ghost.dashDir = norm2(pp.x - ghost.pos.x, pp.z - ghost.pos.z);
				ghost.state = "dash";
				ghost.t = 0;
			}
			break;
		}
		case "dash": {
			ghost.pos.x += ghost.dashDir.x * cfg.dash * dt;
			ghost.pos.z += ghost.dashDir.z * cfg.dash * dt;
			squash = -0.15;
			if (ghost.t > 0.55) { ghost.state = "recover"; ghost.t = 0; ghost.calm = rand(2.5, 4.5) * (ghost.def.boss ? 0.5 : 1); }
			break;
		}
		case "recover": {
			const away = norm2(ghost.pos.x - pp.x, ghost.pos.z - pp.z);
			ghost.pos.x += away.x * cfg.speed * 0.9 * dt;
			ghost.pos.z += away.z * cfg.speed * 0.9 * dt;
			ghost.stamina = Math.min(cfg.stamina, ghost.stamina + dt * 0.35);
			if (ghost.t > 1.6) { ghost.state = "roam"; ghost.t = 0; ghost.target = roamTarget(ghost); }
			break;
		}
		case "caught": {
			if (strength <= 0) {
				ghost.state = "recover";
				ghost.t = 0;
				W.Tint(ghost.entity, null);
				break;
			}
			const n = vac.nozzle;
			const toward = norm2(n.x - ghost.pos.x, n.z - ghost.pos.z);
			const side = { x: -toward.z, z: toward.x };
			const resist = cfg.speed * 1.15 * (ghost.stamina / cfg.stamina);
			const pull = 1.6 + 2.6 * strength;
			const wiggle = Math.sin(ghost.t * 7 + ghost.bob) * cfg.speed * 0.9;
			ghost.pos.x += (toward.x * (pull - resist) + side.x * wiggle) * dt;
			ghost.pos.z += (toward.z * (pull - resist) + side.z * wiggle) * dt;
			ghost.stamina -= dt * (0.8 + 1.2 * strength);
			squash = 0.18 * Math.sin(ghost.t * 26);
			tint = Math.floor(ghost.t * 10) % 2 ? { r: 1, g: 1, b: 1, a: 1 } : null;
			ghost.fx -= dt;
			if (ghost.fx <= 0) {
				ghost.fx = 0.18;
				const c = ghostCenter(ghost);
				ENGINE.Level.SpawnParticles({ id: "spark", position: c, overrides: {
					count: 4, spread: "wide", physics: "none", velocity: { x: toward.x * 4, y: 0.5, z: toward.z * 4 },
					color: { start: { r: 1, g: 1, b: 1, a: 1 }, variance: 0.05, end: { r: cfg.body.r, g: cfg.body.g, b: cfg.body.b } },
					duration: { mode: "shrink", holdTimeMs: 0, endTimeMs: 350, intervalMs: 500 },
				} }, false);
			}
			if (ghost.stamina <= 0 || (Math.hypot(n.x - ghost.pos.x, n.z - ghost.pos.z) < 1.0 && ghost.stamina < cfg.stamina * 0.5)) captureGhost(ghost);
			if (ghost.def.boss) Hud.UpdateBoss(ghost.stamina / cfg.stamina);
			break;
		}
		case "captured": {
			const k = Math.min(1, ghost.t / 0.45);
			const n = run.nozzle.transform.position;
			ghost.pos.x = lerp(ghost.from.x, n.x, k * k);
			ghost.pos.z = lerp(ghost.from.z, n.z, k * k);
			ghost.pos.y = lerp(ghost.from.y, n.y - 0.3 * ghost.cfg.size, k * k);
			W.SetScale(ghost.entity, Math.max(0.02, 1 - k * 0.98));
			W.SetPos(ghost.entity, ghost.pos.x, ghost.pos.y, ghost.pos.z);
			if (k >= 1) finishCapture(ghost);
			return;
		}
	}

	ghost.pos.x = clamp(ghost.pos.x, MANSION.x[0], MANSION.x[1]);
	ghost.pos.z = clamp(ghost.pos.z, MANSION.z[0], MANSION.z[1]);
	ghost.bob += dt * 2.3;
	ghost.pos.y = HOVER * (ghost.def.boss ? 0.8 : 1) + Math.sin(ghost.bob) * 0.16;
	W.SetPos(ghost.entity, ghost.pos.x, ghost.pos.y, ghost.pos.z);

	const face = ghost.state === "recover" ? Math.atan2(ghost.pos.x - pp.x, ghost.pos.z - pp.z) : Math.atan2(pp.x - ghost.pos.x, pp.z - ghost.pos.z);
	let turn = face - ghost.yaw;
	turn = Math.atan2(Math.sin(turn), Math.cos(turn));
	ghost.yaw += turn * Math.min(1, dt * 6);
	W.SetYaw(ghost.entity, ghost.yaw);
	if (ghost.state !== "appear") Object.assign(ghost.entity.transform.scale, { x: 1 + squash, y: 1 - squash, z: 1 + squash });
	W.TintPart(ghost.entity, "body", tint);

	// Only a telegraphed dash hurts, so every hit is dodgeable.
	if (ghost.state === "dash") {
		const c = ghostCenter(ghost);
		const pc = playerCenter(player);
		if (W.Dist3D(c, pc) < ghost.cfg.size * 0.62 + 0.55) hurtPlayer(ghost, player);
	}
}

/* === TRASH === */

function updateTrash(item, dt, vac) {
	if (item.state === "gone") return;
	if (item.state === "fly") {
		item.t += dt;
		const k = Math.min(1, item.t / 0.32);
		const n = run.nozzle.transform.position;
		W.SetPos(item.entity, lerp(item.from.x, n.x, k * k), lerp(item.from.y, n.y - 0.2, k * k), lerp(item.from.z, n.z, k * k));
		W.SetScale(item.entity, Math.max(0.02, 1 - k));
		if (k >= 1) {
			item.state = "gone";
			hide(item.entity);
			run.trashCleaned += 1;
			run.score += 50;
			PlaySfx("trash");
			Hud.Toast(run.trashCleaned === run.trashTotal ? "SPOTLESS! ALL TRASH CLEANED +500" : "TRASH +50", 1400);
			if (run.trashCleaned === run.trashTotal) run.score += 500;
		}
		return;
	}
	const b = item.base;
	const strength = vac ? coneStrength(vac.nozzle, vac.aim, { x: b.x, y: b.y + 0.4, z: b.z }, VACUUM.trashRange) : 0;
	if (strength > 0) {
		item.progress += dt * (0.55 + 1.1 * strength);
		const j = 0.05 * Math.min(1, item.progress);
		W.SetPos(item.entity, b.x + rand(-j, j), b.y + rand(0, j), b.z + rand(-j, j));
		if (item.progress >= 1) {
			item.state = "fly";
			item.t = 0;
			item.from = { ...b };
			const n = vac.nozzle;
			ENGINE.Level.SpawnParticles({ id: "dust", position: { x: b.x, y: b.y + 0.3, z: b.z }, overrides: {
				count: 10, spread: "wide", physics: "none", velocity: { x: (n.x - b.x) * 1.5, y: 1, z: (n.z - b.z) * 1.5 },
				color: { start: { r: 0.45, g: 0.4, b: 0.3, a: 0.8 }, variance: 0.15, end: null },
				duration: { mode: "shrink", holdTimeMs: 0, endTimeMs: 500, intervalMs: 600 },
			} }, false);
		}
	} else if (item.progress > 0) {
		item.progress = Math.max(0, item.progress - dt * 0.6);
		W.SetPos(item.entity, b.x, b.y, b.z);
	}
}

/* === OUTCOMES === */

function rankFor(score) {
	if (score >= 3800) return "RANK S — Professional Ghost Janitor";
	if (score >= 3200) return "RANK A — Tidy Robot";
	if (score >= 2600) return "RANK B — Acceptable Mess";
	return "RANK C — Still Kinda Shitty";
}

function stats() {
	const seconds = Math.floor(run.time);
	return {
		score: run.score, ghostsCaught: run.ghostsCaught, ghostTotal: run.ghostTotal,
		trashCleaned: run.trashCleaned, trashTotal: run.trashTotal,
		time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
		rank: rankFor(run.score),
	};
}

function winChapter() {
	run.over = true;
	StopHum();
	Hud.UpdateBoss(null);
	// Par is 7 minutes; trash matters more than speed for the top ranks.
	run.score += Math.max(0, Math.round(420 - run.time)) + run.health * 100;
	Hud.Toast("CHAPTER CLEAR!", 3000);
	ENGINE.Audio.StopMusic();
	PlaySfx("victory");
	const current = run;
	setTimeout(() => run === current && freezeFor(() => Menus.ShowVictory(stats())), 2200);
}

function loseChapter() {
	run.over = true;
	StopHum();
	ENGINE.Audio.StopMusic();
	PlaySfx("game_over");
	Hud.Toast("YOU GOT SPOOKED", 2500);
	const current = run;
	setTimeout(() => run === current && freezeFor(() => Menus.ShowGameOver(stats())), 1800);
}

/* === FRAME === */

function update(dt) {
	const player = W.Player();
	run.time += dt;
	run.invuln = Math.max(0, run.invuln - dt);

	const p = player.transform.position;
	const design = Flip(p.x, p.z);
	const room = RoomAt(design.x, design.z);
	if (room && room !== run.room) enterRoom(room);

	const vac = updateVacuum(dt, player);
	let load = 0;
	run.ghosts.forEach((ghost) => {
		updateGhost(ghost, dt, player, vac);
		if (ghost.state === "caught") load = 1;
	});
	run.trash.forEach((item) => updateTrash(item, dt, vac));
	SetHumLoad(load);

	run.hintTimer += dt;
	if (run.hintTimer > 14) Hud.ShowHint("");
	if (run.ghosts.some((g) => g.state === "caught")) Hud.ShowHint("KEEP IT IN THE CONE!");
	else if (run.hintTimer > 14) Hud.ShowHint("");

	Hud.UpdateHud(run);
}

function tick(now) {
	requestAnimationFrame(tick);
	const elapsed = (now - last) / 1000;
	last = now;
	if (!run || run.over || paused || !W.Scene()) return;
	// Music follows wall-clock time; gameplay clamps long frames.
	updateMusic(elapsed);
	update(Math.min(0.05, elapsed));
}

requestAnimationFrame(tick);

if (new URLSearchParams(location.search).has("dev")) window.LSM = { get run() { return run; }, keys };

export { ROOMS };
