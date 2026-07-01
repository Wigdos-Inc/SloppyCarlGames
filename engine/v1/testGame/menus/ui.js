let uiDataPromise = null;

function loadUiData() {
	if (!uiDataPromise) {
		uiDataPromise = fetch(new URL("./ui.json", import.meta.url))
			.then((response) => response.json());
	}

	return uiDataPromise;
}

function resolvePayloadEntry(uiData, payloadId) {
	if (uiData.menuUI[payloadId]) return { payload: uiData.menuUI[payloadId], type: "menu" };
	if (uiData.levelUI[payloadId]) return { payload: uiData.levelUI[payloadId], type: "level" };
	return null;
}

const SETTING_KEY_BY_ID = {
	"setting-master": "master",
	"setting-music": "music",
	"setting-voice": "voice",
	"setting-menu-sfx": "menuSfx",
	"setting-game-sfx": "gameSfx",
	"setting-cutscenes-volume": "cutscene",
	"setting-sensitivity-mouse": "mouseSensitivity",
	"setting-sensitivity-keyboard": "keyboardSensitivity",
};

function loadSettings() {
	const raw = localStorage.getItem("settings");
	return raw ? JSON.parse(raw) : null;
}

function applySettingsToPayload(payload) {
	if (payload.screenId !== "Settings") return;

	const settings = loadSettings();
	if (!settings) return;

	const applyValue = (definitions) => {
		definitions.forEach((definition) => {
			const key = SETTING_KEY_BY_ID[definition.id];
			if (key) definition.value = String(settings[key] ?? definition.value);
			if (Array.isArray(definition.children)) applyValue(definition.children);
		});
	};

	applyValue(payload.elements);
}

async function processPayload(payloadId) {
	const uiData = await loadUiData();
	const entry = resolvePayloadEntry(uiData, payloadId);
	if (!entry) {
		ENGINE.Log("GAME", `Missing UI payload: ${payloadId}`, "warn", "UI");
		return;
	}

	const { payload, type: payloadType } = entry;

	if (payload.music && payload.music.src) {
		payload.music = {
			...payload.music,
			src: new URL(payload.music.src, import.meta.url).href,
		};
	}

	if (!payload.screenId) payload.screenId = payloadId;

	applySettingsToPayload(payload);

	ENGINE.Log(
		"GAME",
		`Sending ${payloadId} ${payloadType} UI Payload.`,
		"log",
		"UI"
	);

	ENGINE.UI.ApplyMenuUI(payload);
}

function handleUiRequest(event) {
	if (!event.detail) return;
	processPayload(event.detail.screenId);
}

window.addEventListener("UI_REQUEST", handleUiRequest);