// Entry point for the test game. Importing Bootup auto-starts the engine.

console.log("Importing Engine");

const { ENGINE } = await import("../Bootup.js");
await import("./menus/ui.js");
await import("./cutscene/cutscene.js");

const SETTINGS_KEY = "settings";
const SAVE_KEY = "saveData";

function safeParse(json) {
	try {
		return JSON.parse(json);
	} catch (error) {
		return null;
	}
}

function loadSettings() {
	const raw = localStorage.getItem(SETTINGS_KEY);
	return raw ? safeParse(raw) : null;
}

function saveSettings(settings) {
	localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function normalizeStep(value, step) {
	if (typeof value !== "number" || Number.isNaN(value)) {
		return null;
	}
	const normalized = Math.round(value / step) * step;
	return clamp(Number(normalized.toFixed(2)), 0, 1);
}

function toPercent(value) {
	if (typeof value !== "number") {
		return 0;
	}
	return Math.round(value * 100);
}

function buildSliderGradient(percent) {
	const fill = `linear-gradient(90deg, rgba(123,85,255,0.5) 0%, rgba(74,220,255,0.35) ${percent}%, rgba(255,255,255,0.15) ${percent}%)`;
	return fill;
}

function updateSliderVisual(targetId, value) {
	const input = document.getElementById(targetId);
	if (!input) {
		return;
	}

	const stepped = normalizeStep(value, 0.1);
	if (stepped === null) {
		return;
	}

	const percent = toPercent(stepped);
	input.value = String(stepped);
	input.style.background = buildSliderGradient(percent);

	const percentElement = document.getElementById(`${targetId}-percent`);
	if (percentElement) {
		percentElement.textContent = `${percent}%`;
	}
}

function updateToggleVisual(toggleId, isOn) {
	const toggle = document.getElementById(toggleId);
	if (!toggle) {
		return;
	}

	const label = document.getElementById(`${toggleId}-label`);
	const knob = document.getElementById(`${toggleId}-knob`);
	const onGradient = "linear-gradient(90deg, rgba(123,85,255,0.5), rgba(74,220,255,0.35))";
	const offGradient = "rgba(12, 10, 22, 0.7)";

	toggle.style.background = isOn ? onGradient : offGradient;
	if (label) {
		label.textContent = isOn ? "ON" : "OFF";
		label.style.left = isOn ? "14px" : "auto";
		label.style.right = isOn ? "auto" : "14px";
		label.style.opacity = isOn ? "1" : "0.75";
	}
	if (knob) {
		knob.style.left = isOn ? "62px" : "4px";
	}
}

function resolveSettingsTargetId(targetId) {
	if (!targetId) {
		return null;
	}

	if (targetId === "setting-skip-intro-label" || targetId === "setting-skip-intro-knob") {
		return "setting-skip-intro";
	}

	if (targetId === "setting-debug-mode-label" || targetId === "setting-debug-mode-knob") {
		return "setting-debug-mode";
	}

	return targetId;
}

function getSettingsSnapshot() {
	const stored = loadSettings();
	if (stored) {
		return stored;
	}

	const volume = ENGINE && ENGINE.Config ? ENGINE.Config.VOLUME : null;
	const debug = ENGINE && ENGINE.Config ? ENGINE.Config.DEBUG : null;
	const cutscene = ENGINE && ENGINE.Config ? ENGINE.Config.CUTSCENE : null;

	return {
		master: volume ? volume.Master : 0.5,
		music: volume ? volume.Music : 1,
		voice: volume ? volume.Voice : 1,
		menuSfx: volume ? volume.MenuSfx : 1,
		gameSfx: volume ? volume.GameSfx : 1,
		cutscene: volume ? volume.Cutscene : 1,
		skipIntro: cutscene ? cutscene.SkipIntro : false,
		debugMode: debug ? debug.ALL : false,
	};
}

function syncSettingsUi(settings) {
	if (!settings) {
		return;
	}

	updateSliderVisual("setting-master", settings.master);
	updateSliderVisual("setting-music", settings.music);
	updateSliderVisual("setting-voice", settings.voice);
	updateSliderVisual("setting-menu-sfx", settings.menuSfx);
	updateSliderVisual("setting-game-sfx", settings.gameSfx);
	updateSliderVisual("setting-cutscenes-volume", settings.cutscene);

	updateToggleVisual("setting-skip-intro", Boolean(settings.skipIntro));
	updateToggleVisual("setting-debug-mode", Boolean(settings.debugMode));
}

function applySettings(settings) {
	if (!ENGINE || !ENGINE.Config || !settings) {
		return;
	}

	const volume = ENGINE.Config.VOLUME;
	if (volume) {
		if (typeof settings.master === "number") {
			volume.Master = settings.master;
		}
		if (typeof settings.music === "number") {
			volume.Music = settings.music;
		}
		if (typeof settings.voice === "number") {
			volume.Voice = settings.voice;
		}
		if (typeof settings.menuSfx === "number") {
			volume.MenuSfx = settings.menuSfx;
		}
		if (typeof settings.gameSfx === "number") {
			volume.GameSfx = settings.gameSfx;
		}
		if (typeof settings.cutscene === "number") {
			volume.Cutscene = settings.cutscene;
		}
	}

	const cutscene = ENGINE.Config.CUTSCENE;
	if (cutscene) {
		if (typeof settings.skipIntro === "boolean") {
			cutscene.SkipIntro = settings.skipIntro;
		}
	}

	const debug = ENGINE.Config.DEBUG;
	if (debug && typeof settings.debugMode === "boolean") {
		debug.ALL = settings.debugMode;
	}

	if (ENGINE.Audio && typeof ENGINE.Audio.UpdateActiveAudioVolumes === "function") {
		ENGINE.Audio.UpdateActiveAudioVolumes();
	}

	syncSettingsUi(settings);
}

function loadSave() {
	const raw = localStorage.getItem(SAVE_KEY);
	return raw ? safeParse(raw) : null;
}

function saveProgress(saveData) {
	localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
}

function deleteSaveData() {
	localStorage.removeItem(SAVE_KEY);
	if (ENGINE && typeof ENGINE.Log === "function") {
		ENGINE.Log("GAME", "Save data deleted.", "log", "Game");
	}
}

function startGame(saveData) {
	const payload = saveData || { levelIndex: 0, stageIndex: 0 };
	saveProgress(payload);
	if (ENGINE && typeof ENGINE.Log === "function") {
		ENGINE.Log(
			"GAME",
			`Start game: level=${payload.levelIndex} stage=${payload.stageIndex}`,
			"log",
			"Game"
		);
	}
}

function handleStartGame(event) {
	const payload = event && event.detail ? event.detail.payload : null;
	if (payload && typeof payload.levelIndex === "number") {
		startGame(payload);
		return;
	}
	startGame({ levelIndex: 0, stageIndex: 0 });
}

function handleLoadGame() {
	const saveData = loadSave() || { levelIndex: 0, stageIndex: 0 };
	startGame(saveData);
}

function handleDeleteSave() {
	deleteSaveData();
}

function handleSettingsInput(payload) {
	if (!payload || !payload.targetId) {
		return;
	}

	const resolvedTargetId = resolveSettingsTargetId(payload.targetId);
	if (!resolvedTargetId) {
		return;
	}

	const settings = loadSettings() || {
		master: 0.5,
		music: 1,
		voice: 1,
		menuSfx: 1,
		gameSfx: 1,
		cutscene: 1,
		skipIntro: true,
		debugMode: true,
	};

	const value = typeof payload.value === "string" ? Number(payload.value) : payload.value;
	let changedKey = null;
	let changedValue = null;
	let nextValue = value;

	if (resolvedTargetId === "setting-master" && typeof value === "number") {
		nextValue = normalizeStep(value, 0.1);
		if (nextValue !== null) {
			settings.master = nextValue;
			changedKey = "master";
			changedValue = nextValue;
			updateSliderVisual("setting-master", nextValue);
		}
	}
	if (resolvedTargetId === "setting-music" && typeof value === "number") {
		nextValue = normalizeStep(value, 0.1);
		if (nextValue !== null) {
			settings.music = nextValue;
			changedKey = "music";
			changedValue = nextValue;
			updateSliderVisual("setting-music", nextValue);
		}
	}
	if (resolvedTargetId === "setting-voice" && typeof value === "number") {
		nextValue = normalizeStep(value, 0.1);
		if (nextValue !== null) {
			settings.voice = nextValue;
			changedKey = "voice";
			changedValue = nextValue;
			updateSliderVisual("setting-voice", nextValue);
		}
	}
	if (resolvedTargetId === "setting-menu-sfx" && typeof value === "number") {
		nextValue = normalizeStep(value, 0.1);
		if (nextValue !== null) {
			settings.menuSfx = nextValue;
			changedKey = "menuSfx";
			changedValue = nextValue;
			updateSliderVisual("setting-menu-sfx", nextValue);
		}
	}
	if (resolvedTargetId === "setting-game-sfx" && typeof value === "number") {
		nextValue = normalizeStep(value, 0.1);
		if (nextValue !== null) {
			settings.gameSfx = nextValue;
			changedKey = "gameSfx";
			changedValue = nextValue;
			updateSliderVisual("setting-game-sfx", nextValue);
		}
	}
	if (resolvedTargetId === "setting-cutscenes-volume" && typeof value === "number") {
		nextValue = normalizeStep(value, 0.1);
		if (nextValue !== null) {
			settings.cutscene = nextValue;
			changedKey = "cutscene";
			changedValue = nextValue;
			updateSliderVisual("setting-cutscenes-volume", nextValue);
		}
	}
	if (resolvedTargetId === "setting-skip-intro" && payload.type === "click") {
		settings.skipIntro = !settings.skipIntro;
		changedKey = "skipIntro";
		changedValue = settings.skipIntro;
		updateToggleVisual("setting-skip-intro", settings.skipIntro);
	}
	if (resolvedTargetId === "setting-debug-mode" && payload.type === "click") {
		settings.debugMode = !settings.debugMode;
		changedKey = "debugMode";
		changedValue = settings.debugMode;
		updateToggleVisual("setting-debug-mode", settings.debugMode);
	}

	if (!changedKey) {
		return;
	}

	saveSettings(settings);
	applySettings(settings);

	if (ENGINE && typeof ENGINE.Log === "function") {
		ENGINE.Log(
			"GAME",
			`Settings change: ${changedKey}=${changedValue}`,
			"log",
			"Settings"
		);
	}
}

function handleUserInput(event) {
	const payload = event && event.detail ? event.detail.payload : null;
	handleSettingsInput(payload);
}

window.addEventListener("USER_INPUT", handleUserInput);
window.addEventListener("START_GAME", handleStartGame);
window.addEventListener("LOAD_GAME", handleLoadGame);
window.addEventListener("DELETE_SAVE_DATA", handleDeleteSave);
window.addEventListener("ENGINE_UI_RENDERED", (event) => {
	const screenId = event && event.detail ? event.detail.screenId : null;
	if (screenId === "Settings") {
		syncSettingsUi(getSettingsSnapshot());
	}
});

const initialSettings = loadSettings();
if (initialSettings) {
	applySettings(initialSettings);
} else {
	syncSettingsUi(getSettingsSnapshot());
}

void ENGINE;
