// Player-facing settings, persisted in localStorage.

const KEY = "lsm-settings";
const DEFAULTS = { toonLines: true, comic: true, music: true };

export function LoadSettings() {
	const raw = localStorage.getItem(KEY);
	return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
}

export function SaveSettings(settings) {
	localStorage.setItem(KEY, JSON.stringify(settings));
}

export function ApplySettings(settings) {
	ENGINE.Config.Rendering.Filters.ToonLines = settings.toonLines;
	ENGINE.Config.Rendering.Filters.Comic = settings.comic;
	ENGINE.Config.Volume.Music = settings.music ? 1 : 0;
	ENGINE.Audio.UpdateActiveAudioVolumes();
}
