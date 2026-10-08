// Asset resolution and audio. Optional files listed in ASSETS.md fall back to synthesized placeholders.
import { SYNTH } from "./synth.js";

const BASE = new URL("../assets/", import.meta.url);
const existence = new Map();

export const AssetUrl = (path) => new URL(path, BASE).href;

export function AssetExists(path) {
	if (!existence.has(path)) {
		existence.set(path, fetch(AssetUrl(path), { method: "HEAD" }).then((r) => r.ok).catch(() => false));
	}
	return existence.get(path);
}

const SFX_FILES = ["capture", "trash", "hurt", "ghost_laugh", "heart", "vacuum_start", "victory", "game_over", "door"];

// Resolve which SFX have real files once, so playback never waits on the network.
const sfxReady = {};
export async function PreloadAudio() {
	await Promise.all(SFX_FILES.map(async (name) => { sfxReady[name] = await AssetExists(`audio/${name}.mp3`); }));
}

export function PlaySfx(name) {
	if (sfxReady[name]) {
		void ENGINE.Audio.PlayAudio(AssetUrl(`audio/${name}.mp3`), { category: "Game" });
		return;
	}
	SYNTH[name]?.();
}

export async function PlayMusic(name, path) {
	if (!(await AssetExists(path))) {
		ENGINE.Audio.StopMusic();
		return;
	}
	ENGINE.Audio.PlayMusic(name, AssetUrl(path), { loop: true });
}
