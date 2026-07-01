// Entry point for the test game. Importing Bootup auto-starts the engine.

console.log("Importing Engine");

import { StartEngine } from "../Bootup.js";
import entitiesData from "./levels/entities.json" with { type: "json" };
import levelsData   from "./levels/levels.json"   with { type: "json" };
StartEngine();

// Initialize testGame engine helpers (throws if ENGINE missing).
const { initEngine } = await import("./engineHelpers.js");
initEngine(ENGINE);

// Import other testGame modules after engine helpers are initialized.
await import("./menus/ui.js");
await import("./cutscene/cutscene.js");
const { RequestLevelCreate } = await import("./levels/level.js");
const { RequestLvl1Stage2Create } = await import("./levels/lvl1_stage2.js");

// Use the engine default built-in splash sequence.
const resolveStartupSplashPayload = () => ({ outputType: "default" });

const handleSplashRequest = () => ENGINE.Startup.ProvideSplashScreenPayload(resolveStartupSplashPayload());

// Proactively provide a splash payload; Bootup opens the acceptance window during init.
ENGINE.Startup.ProvideSplashScreenPayload(resolveStartupSplashPayload());


const SETTINGS_KEY = "settings";
const SAVE_KEY = "saveData";

const DEFAULT_SETTINGS = {
	master: 0.5,
	music: 1,
	voice: 1,
	menuSfx: 1,
	gameSfx: 1,
	cutscene: 1,
	skipIntro: true,
	debugMode: true,
	mouseSensitivity: 50,
	keyboardSensitivity: 50,
};

const saveSettings = (settings) => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

function loadSettings() {
	const raw = localStorage.getItem(SETTINGS_KEY);
	if (!raw) return null;

	// Fill any keys missing from stale saved data and persist once, so downstream reads are complete.
	const settings = JSON.parse(raw);
	let added = false;
	for (const key in DEFAULT_SETTINGS) {
		if (!(key in settings)) {
			settings[key] = DEFAULT_SETTINGS[key];
			added = true;
		}
	}
	if (added) saveSettings(settings);
	return settings;
}

function normalizeStep(value, step) {
	if (typeof value !== "number" || Number.isNaN(value)) return null;
	const normalized = Math.round(value / step) * step;
	return ENGINE.Math.Other.Clamp(Number(normalized.toFixed(2)), 0, 1);
}

const toPercent = (value) => Math.round(value * 100);

const buildSliderGradient = (percent) => `linear-gradient(90deg, rgba(123,85,255,0.5) 0%, rgba(74,220,255,0.35) ${percent}%, rgba(255,255,255,0.15) ${percent}%)`;

function updateSliderVisual(targetId, value) {
	const input = document.getElementById(targetId);
	if (!input) return;

	const stepped = normalizeStep(value, 0.1);
	if (stepped === null) return;

	const percent = toPercent(stepped);
	input.value = String(stepped);
	input.style.background = buildSliderGradient(percent);

	const percentElement = document.getElementById(`${targetId}-percent`);
	if (percentElement) percentElement.textContent = `${percent}%`;
}

function updateSensitivitySliderVisual(targetId, value) {
	const input = document.getElementById(targetId);
	if (!input) return;
	const stepped = Math.round(ENGINE.Math.Other.Clamp(value, 0, 100) / 5) * 5;
	input.value = String(stepped);
	input.style.background = buildSliderGradient(stepped);

	const percentElement = document.getElementById(`${targetId}-percent`);
	if (percentElement) percentElement.textContent = `${stepped}%`;
}

function updateToggleVisual(toggleId, isOn) {
	const toggle = document.getElementById(toggleId);
	if (!toggle) return;

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
	if (!targetId) return null;
	if (targetId === "setting-skip-intro-label" || targetId === "setting-skip-intro-knob") return "setting-skip-intro";
	if (targetId === "setting-debug-mode-label" || targetId === "setting-debug-mode-knob") return "setting-debug-mode";
	return targetId;
}

function getSettingsSnapshot() {
	const stored = loadSettings();
	if (stored) return stored;

	const cfg = ENGINE.CONFIG;
	return {
		master: cfg.VOLUME.Master,
		music: cfg.VOLUME.Music,
		voice: cfg.VOLUME.Voice,
		menuSfx: cfg.VOLUME.MenuSfx,
		gameSfx: cfg.VOLUME.GameSfx,
		cutscene: cfg.VOLUME.Cutscene,
		skipIntro: cfg.DEBUG.SKIP.Intro,
		debugMode: cfg.DEBUG.ALL,
		mouseSensitivity: cfg.CAMERA.Sensitivity.Mouse,
		keyboardSensitivity: cfg.CAMERA.Sensitivity.Keyboard,
	};
}

function syncSettingsUi(settings) {
	updateSliderVisual("setting-master", settings.master);
	updateSliderVisual("setting-music", settings.music);
	updateSliderVisual("setting-voice", settings.voice);
	updateSliderVisual("setting-menu-sfx", settings.menuSfx);
	updateSliderVisual("setting-game-sfx", settings.gameSfx);
	updateSliderVisual("setting-cutscenes-volume", settings.cutscene);

	updateToggleVisual("setting-skip-intro", Boolean(settings.skipIntro));
	updateToggleVisual("setting-debug-mode", Boolean(settings.debugMode));

	updateSensitivitySliderVisual("setting-sensitivity-mouse", settings.mouseSensitivity);
	updateSensitivitySliderVisual("setting-sensitivity-keyboard", settings.keyboardSensitivity);
}

function applySettings(settings) {
	const cfg = ENGINE.CONFIG;
	cfg.VOLUME.Master = settings.master;
	cfg.VOLUME.Music = settings.music;
	cfg.VOLUME.Voice = settings.voice;
	cfg.VOLUME.MenuSfx = settings.menuSfx;
	cfg.VOLUME.GameSfx = settings.gameSfx;
	cfg.VOLUME.Cutscene = settings.cutscene;
	cfg.DEBUG.SKIP.Intro = settings.skipIntro;
	cfg.DEBUG.ALL = settings.debugMode;
	cfg.CAMERA.Sensitivity.Mouse = settings.mouseSensitivity;
	cfg.CAMERA.Sensitivity.Keyboard = settings.keyboardSensitivity;

	ENGINE.Audio.UpdateActiveAudioVolumes();

	syncSettingsUi(settings);
}

function loadSave() {
	const raw = localStorage.getItem(SAVE_KEY);
	return raw ? JSON.parse(raw) : null;
}

const saveProgress = (saveData) => localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));

function deleteSaveData() {
	localStorage.removeItem(SAVE_KEY);
	ENGINE.Log("GAME", "Save data deleted.", "log", "Game");
}

function startGame(saveData) {
	const payload = saveData || { levelIndex: 0, stageIndex: 0 };
	saveProgress(payload);
	ENGINE.Log(
		"GAME",
		`Start game: level=${payload.levelIndex} stage=${payload.stageIndex}`,
		"log",
		"Game"
	);
}

async function requestLevelLoad(payload) {
	const loadOptions = {
		source: "testGame",
		renderOptions: { rootId: "engine-level-root" },
	};

	if (payload.levelIndex === 0 && payload.stageIndex === 1) return RequestLvl1Stage2Create(payload, loadOptions);
	return RequestLevelCreate(payload, loadOptions);
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

const VOLUME_SLIDER_MAP = [
	{ id: "setting-master",           key: "master" },
	{ id: "setting-music",            key: "music" },
	{ id: "setting-voice",            key: "voice" },
	{ id: "setting-menu-sfx",         key: "menuSfx" },
	{ id: "setting-game-sfx",         key: "gameSfx" },
	{ id: "setting-cutscenes-volume", key: "cutscene" },
];

const SENSITIVITY_SLIDER_MAP = [
	{ id: "setting-sensitivity-mouse",    key: "mouseSensitivity" },
	{ id: "setting-sensitivity-keyboard", key: "keyboardSensitivity" },
];

const TOGGLE_MAP = [
	{ id: "setting-skip-intro", key: "skipIntro" },
	{ id: "setting-debug-mode", key: "debugMode" },
];

function handleSettingsInput(payload) {
	if (!payload.targetId) return;

	const resolvedTargetId = resolveSettingsTargetId(payload.targetId);
	if (!resolvedTargetId) return;

	const settings = loadSettings() || { ...DEFAULT_SETTINGS };

	const value = typeof payload.value === "string" ? Number(payload.value) : payload.value;
	let changedKey = null;
	let changedValue = null;

	const volumeEntry = VOLUME_SLIDER_MAP.find((entry) => entry.id === resolvedTargetId);
	if (volumeEntry && typeof value === "number") {
		const nextValue = normalizeStep(value, 0.1);
		if (nextValue !== null) {
			settings[volumeEntry.key] = nextValue;
			changedKey = volumeEntry.key;
			changedValue = nextValue;
			updateSliderVisual(volumeEntry.id, nextValue);
		}
	}

	const sensitivityEntry = SENSITIVITY_SLIDER_MAP.find((entry) => entry.id === resolvedTargetId);
	if (sensitivityEntry && typeof value === "number") {
		const stepped = Math.round(ENGINE.Math.Other.Clamp(value, 0, 100) / 5) * 5;
		settings[sensitivityEntry.key] = stepped;
		changedKey = sensitivityEntry.key;
		changedValue = stepped;
		updateSensitivitySliderVisual(sensitivityEntry.id, stepped);
	}

	const toggleEntry = TOGGLE_MAP.find((entry) => entry.id === resolvedTargetId);
	if (toggleEntry && payload.type === "click") {
		settings[toggleEntry.key] = !settings[toggleEntry.key];
		changedKey = toggleEntry.key;
		changedValue = settings[toggleEntry.key];
		updateToggleVisual(toggleEntry.id, settings[toggleEntry.key]);
	}

	if (!changedKey) return;

	saveSettings(settings);
	applySettings(settings);

	ENGINE.Log(
		"GAME",
		`Settings change: ${changedKey}=${changedValue}`,
		"log",
		"Settings"
	);
}

function showLevelSelectPanel(panelIndex) {
	const panel1 = document.getElementById("level-panel-1");
	const panel2 = document.getElementById("level-panel-2");
	if (!panel1 || !panel2) return;

	const showFirst = panelIndex === 1;
	panel1.style.display = showFirst ? "flex" : "none";
	panel1.style.opacity = showFirst ? "1" : "0";
	panel1.style.pointerEvents = showFirst ? "auto" : "none";

	panel2.style.display = showFirst ? "none" : "flex";
	panel2.style.opacity = showFirst ? "0" : "1";
	panel2.style.pointerEvents = showFirst ? "none" : "auto";
}

function handleLevelSelectInput(payload) {
	if (payload.screenId !== "LevelSelect") return;

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
	const input = window.engineOptional('Level.Player.Input');
	if (!input) return;
	const code = payload.code;

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

const fallTestState = {
	startTime: null,
	startPosition: null,
	landed: false,
};

function handleEntitySpawn(event) {
	const detail = event.detail;
	if (detail.id !== "cnu-fall-cube") return;

	fallTestState.startTime = performance.now();
	fallTestState.startPosition = { x: detail.position.x, y: detail.position.y, z: detail.position.z };
	fallTestState.landed = false;

	ENGINE.Log(
		"GAME",
		[
			"CNU fall test: cube spawned",
			`- startPosition.y: ${detail.position.y.toFixed(4)} CNU`,
			`- startVelocity.y: ${detail.velocity.y.toFixed(4)} CNU/s`,
		].join("\n"),
		"log",
		"Level"
	);
}

function handleEntityCollision(event) {
	const detail = event.detail;
	if (detail.id !== "cnu-fall-cube") return;
	if (fallTestState.landed || fallTestState.startTime === null) return;

	fallTestState.landed = true;
	const endTime = performance.now();
	const elapsedSeconds = (endTime - fallTestState.startTime) / 1000;
	const deltaHeight = fallTestState.startPosition.y - detail.position.y;
	const gravityStrength = ENGINE.CONFIG.PHYSICS.Gravity.Strength;

	ENGINE.Log(
		"GAME",
		[
			"CNU fall test: cube landed",
			`- endPosition.y: ${detail.position.y.toFixed(4)} CNU`,
			`- endVelocity.y: ${detail.velocity.y.toFixed(4)} CNU/s`,
		].join("\n"),
		"log",
		"Level"
	);
	ENGINE.Log(
		"GAME",
		[
			"CNU fall test: summary",
			`- deltaHeight: ${deltaHeight.toFixed(4)} CNU`,
			`- elapsedTime: ${elapsedSeconds.toFixed(4)} s`,
			`- gravityStrength: ${gravityStrength} CNU/s²`,
		].join("\n"),
		"log",
		"Level"
	);
}

function cacheSimulatorEntries() {
	const entries = [];
	const seen = new Set();

	["enemies", "npcs", "collectibles", "projectiles", "entities"].forEach((bucket) => {
		entitiesData[bucket].forEach((definition) => entries.push({ definition, objectType: definition.type }));
	});

	levelsData.levels.forEach((level) => {
		level.stages.forEach((stage) => {
			stage.terrain.objects.forEach((definition) => {
				if (seen.has(definition.id)) return;
				seen.add(definition.id);
				entries.push({ definition, objectType: "terrain" });
			});
			stage.obstacles.forEach((definition) => {
				if (seen.has(definition.id)) return;
				seen.add(definition.id);
				entries.push({ definition, objectType: "obstacle" });
			});
		});
	});

	void ENGINE.Simulator.Cache(entries);
}

window.addEventListener("SPLASH_REQUEST", handleSplashRequest);
window.addEventListener("UI_REQUEST", cacheSimulatorEntries, { once: true });
window.addEventListener("USER_INPUT", handleUserInput);
window.addEventListener("DELETE_SAVE_DATA", deleteSaveData);
window.addEventListener("LEVEL_REQUEST", handleLevelRequest);
window.addEventListener("LOAD_GAME", handleLoadGame);
window.addEventListener("ENTITY_SPAWN", handleEntitySpawn);
window.addEventListener("ENTITY_COLLISION", handleEntityCollision);
window.addEventListener("UI_RENDERED", (event) => {
	if (event.detail.screenId === "Settings") syncSettingsUi(getSettingsSnapshot());
});

const initialSettings = loadSettings();
if (initialSettings) applySettings(initialSettings);
else syncSettingsUi(getSettingsSnapshot());

void ENGINE;
