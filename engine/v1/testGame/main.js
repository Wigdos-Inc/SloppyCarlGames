// Entry point for the test game. Importing Bootup auto-starts the engine.

console.log("Importing Engine");

const boot = await import("../Bootup.js");
const { ENGINE } = boot;
// Initialize testGame engine helpers (throws if ENGINE missing).
const { initEngine } = await import("./engineHelpers.js");
initEngine(ENGINE);

// Import other testGame modules after engine helpers are initialized.
await import("./menus/ui.js");
await import("./cutscene/cutscene.js");
const { RequestLevelCreate } = await import("./levels/level.js");

function resolveStartupSplashPayload() {
	// Use engine default built-in splash sequence.
	return { outputType: "default" };
}

function handleSplashRequest() {
	ENGINE.Startup.ProvideSplashScreenPayload(resolveStartupSplashPayload());
}

// Proactively provide a splash payload immediately after creation so the game
// doesn't need to rely on the event delivery timing. This is safe because
// `Bootup` opens the acceptance window during initialization.
window.engineCall('Startup.ProvideSplashScreenPayload', resolveStartupSplashPayload());


const SETTINGS_KEY = "settings";
const SAVE_KEY = "saveData";

function safeParse(json) {
	try { return JSON.parse(json); } 
	catch (error) { return null; }
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

	let volume = null;
	let debug = null;
	let skip = null;
	try {
		const cfg = window.engineOptional('Config');
		if (cfg) {
			volume = cfg.VOLUME;
			debug = cfg.DEBUG;
			skip = debug && debug.SKIP ? debug.SKIP : null;
		}
	} catch (e) {
		// leave defaults if config isn't present
	}

	return {
		master: volume ? volume.Master : 0.5,
		music: volume ? volume.Music : 1,
		voice: volume ? volume.Voice : 1,
		menuSfx: volume ? volume.MenuSfx : 1,
		gameSfx: volume ? volume.GameSfx : 1,
		cutscene: volume ? volume.Cutscene : 1,
		skipIntro: skip ? skip.Intro : false,
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
	if (!settings) return;

	const cfg = window.engineRequire('Config');
	const volume = cfg.VOLUME;
	if (volume) {
		if (typeof settings.master === "number") volume.Master = settings.master;
		if (typeof settings.music === "number") volume.Music = settings.music;
		if (typeof settings.voice === "number") volume.Voice = settings.voice;
		if (typeof settings.menuSfx === "number") volume.MenuSfx = settings.menuSfx;
		if (typeof settings.gameSfx === "number") volume.GameSfx = settings.gameSfx;
		if (typeof settings.cutscene === "number") volume.Cutscene = settings.cutscene;
	}

	const debug = cfg.DEBUG;
	if (debug && debug.SKIP && typeof settings.skipIntro === "boolean") debug.SKIP.Intro = settings.skipIntro;
	if (debug && typeof settings.debugMode === "boolean") debug.ALL = settings.debugMode;

	try {
		window.engineCall('Audio.UpdateActiveAudioVolumes');
	} catch (e) {
		// Audio update is optional for some engine builds
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
	const Log = window.engineOptional('Log');
	if (Log) Log("GAME", "Save data deleted.", "log", "Game");
}

function startGame(saveData) {
	const payload = saveData || { levelIndex: 0, stageIndex: 0 };
	saveProgress(payload);
	const Log = window.engineOptional('Log');
	if (Log) Log(
		"GAME",
		`Start game: level=${payload.levelIndex} stage=${payload.stageIndex}`,
		"log",
		"Game"
	);
}

async function requestLevelLoad(payload) {
	return RequestLevelCreate(payload, {
		source: "testGame",
		renderOptions: {
			rootId: "engine-level-root",
		},
	});
}

function handleLevelRequest(event) {
	const request = event.detail;
	const startPayload = request || { levelIndex: 0, stageIndex: 0 };
	startGame(startPayload);
	void requestLevelLoad(startPayload);
}

function handleLoadGame() {
	const saveData = loadSave() || { levelIndex: 0, stageIndex: 0 };
	startGame(saveData);
	void requestLevelLoad(saveData);
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

	const Log = window.engineOptional('Log');
	if (Log) Log(
		"GAME",
		`Settings change: ${changedKey}=${changedValue}`,
		"log",
		"Settings"
	);
}

function showLevelSelectPanel(panelIndex) {
	const panel1 = document.getElementById("level-panel-1");
	const panel2 = document.getElementById("level-panel-2");
	if (!panel1 || !panel2) {
		return;
	}

	const showFirst = panelIndex === 1;
	panel1.style.display = showFirst ? "flex" : "none";
	panel1.style.opacity = showFirst ? "1" : "0";
	panel1.style.pointerEvents = showFirst ? "auto" : "none";

	panel2.style.display = showFirst ? "none" : "flex";
	panel2.style.opacity = showFirst ? "0" : "1";
	panel2.style.pointerEvents = showFirst ? "none" : "auto";
}

function handleLevelSelectInput(payload) {
	if (!payload || payload.screenId !== "LevelSelect") {
		return;
	}

	if (payload.type === "keydown") {
		if (payload.key === "ArrowLeft") {
			showLevelSelectPanel(1);
		}
		if (payload.key === "ArrowRight") {
			showLevelSelectPanel(2);
		}
		return;
	}

	if (payload.type === "click") {
		if (payload.targetId === "level-nav-prev") {
			showLevelSelectPanel(1);
		}
		if (payload.targetId === "level-nav-next") {
			showLevelSelectPanel(2);
		}
	}
}

function handlePlayerInput(payload) {
	if (!payload) return;
	const input = window.engineOptional('Player.Input');
	if (!input) return;
	const code = payload.code || "";

	if (payload.type === "keydown") {
		if (code === "KeyW") { input.forward = 1; }
		if (code === "KeyS") { input.forward = -1; }
		if (code === "KeyA") { input.right = -1; }
		if (code === "KeyD") { input.right = 1; }
		if (code === "Space") { input.jump = true; }
		if (code === "ShiftLeft" || code === "ShiftRight") { input.boost = true; }
		return;
	}

	if (payload.type === "keyup") {
		if (code === "KeyW" && input.forward > 0) { input.forward = 0; }
		if (code === "KeyS" && input.forward < 0) { input.forward = 0; }
		if (code === "KeyA" && input.right < 0) { input.right = 0; }
		if (code === "KeyD" && input.right > 0) { input.right = 0; }
		if (code === "Space") { input.jump = false; }
		if (code === "ShiftLeft" || code === "ShiftRight") { input.boost = false; }
		return;
	}
}

function handleUserInput(event) {
	const payload = event.detail;
	handleSettingsInput(payload);
	handleLevelSelectInput(payload);
	handlePlayerInput(payload);
}

window.addEventListener("SPLASH_REQUEST", handleSplashRequest);
window.addEventListener("USER_INPUT", handleUserInput);
window.addEventListener("DELETE_SAVE_DATA", handleDeleteSave);
window.addEventListener("LEVEL_REQUEST", handleLevelRequest);
window.addEventListener("LOAD_GAME", handleLoadGame);
window.addEventListener("UI_RENDERED", (event) => {
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
