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

// Keys an opaque image's flat background (sampled from its top-left pixel) to transparent.
const cutouts = new Map();
export function CutoutUrl(path, tolerance = 22) {
	if (!cutouts.has(path)) {
		cutouts.set(path, (async () => {
			const image = new Image();
			image.src = AssetUrl(path);
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = image.width;
			canvas.height = image.height;
			const context = canvas.getContext("2d");
			context.drawImage(image, 0, 0);
			const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
			const d = pixels.data;
			const [r, g, b] = [d[0], d[1], d[2]];
			for (let i = 0; i < d.length; i += 4) {
				if (Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b)) < tolerance) d[i + 3] = 0;
			}
			context.putImageData(pixels, 0, 0);
			return canvas.toDataURL("image/png");
		})());
	}
	return cutouts.get(path);
}

// Crops an image to `box` ([x0, y0, x1, y1] in source pixels) and rescales it by `scale`.
export async function CropUrl(path, box, scale) {
	const image = new Image();
	image.src = AssetUrl(path);
	await image.decode();
	const [x0, y0, x1, y1] = box;
	const canvas = document.createElement("canvas");
	canvas.width = Math.round((x1 - x0) * scale);
	canvas.height = Math.round((y1 - y0) * scale);
	const context = canvas.getContext("2d");
	context.imageSmoothingQuality = "high";
	context.drawImage(image, x0, y0, x1 - x0, y1 - y0, 0, 0, canvas.width, canvas.height);
	return canvas.toDataURL("image/png");
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

export async function PlayMusic(name, path, loop = true) {
	if (!(await AssetExists(path))) {
		ENGINE.Audio.StopMusic();
		return false;
	}
	ENGINE.Audio.PlayMusic(name, AssetUrl(path), { loop });
	return true;
}

// Track length in seconds from file metadata; the engine exposes no music duration or end event.
export function AudioDuration(path) {
	return new Promise((resolve) => {
		const probe = new Audio();
		probe.preload = "metadata";
		probe.addEventListener("loadedmetadata", () => resolve(probe.duration), { once: true });
		probe.src = AssetUrl(path);
	});
}
