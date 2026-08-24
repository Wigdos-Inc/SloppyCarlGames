let uiDataPromise = null;
let sampleHtmlPromise = null;

function loadUiData() {
	if (!uiDataPromise) {
		uiDataPromise = fetch(new URL("./ui.json", import.meta.url))
			.then((response) => response.json());
	}

	return uiDataPromise;
}

function loadSampleHtml() {
	if (!sampleHtmlPromise) {
		sampleHtmlPromise = fetch(new URL("./sample.html", import.meta.url))
			.then((response) => response.text());
	}

	return sampleHtmlPromise;
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
	"setting-scatter-density": "scatterDensity",
	"setting-scatter-quality": "scatterQuality",
	"setting-particles": "particles",
	"setting-sim-distance": "simDistance",
	"setting-animations": "animations",
	"setting-frame-rate": "frameRate",
	"setting-resolution": "resolution",
	"setting-performance-preset": "performancePreset",
};

// Scatter quality and sim distance are always-on grades; the rest can be switched off.
const TIER_LEVELS = ["Disabled", "Low", "Medium", "High"];
const GRADED_LEVELS = ["Low", "Medium", "High"];
const DISTANCE_LEVELS = ["Low", "Medium", "High", "Ultra"];
const PRESET_LEVELS = ["Low", "Medium", "High", "Custom"];
const TIER_LEVELS_BY_ID = {
	"setting-scatter-density": TIER_LEVELS,
	"setting-scatter-quality": GRADED_LEVELS,
	"setting-particles": TIER_LEVELS,
	"setting-sim-distance": DISTANCE_LEVELS,
	"setting-animations": TIER_LEVELS,
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
			if (key) {
				const tierLevels = TIER_LEVELS_BY_ID[definition.id];
				if (tierLevels) {
					const index = tierLevels.indexOf(settings[key]);
					if (index !== -1) definition.value = String(index);
				} else if (definition.id === "setting-performance-preset") {
					const index = PRESET_LEVELS.indexOf(settings[key]);
					if (index !== -1) definition.value = String(index);
				} else {
					definition.value = String(settings[key] ?? definition.value);
				}
			}
			if (Array.isArray(definition.children)) applyValue(definition.children);
		});
	};

	applyValue(payload.elements);
}

async function processSamplePayload() {
	// HTML-authored screen: convert, then apply through the normal path.
	const payload = ENGINE.UI.ConvertHTML(await loadSampleHtml(), { screenId: "Sample", rootId: "engine-ui-root" });

	ENGINE.Log("GAME", "Sending Sample UI Payload (converted from HTML).", "log", "UI");
	ENGINE.UI.ApplyMenuUI(payload);

	window.addEventListener(
		"UI_RENDERED",
		() => document.getElementById("sample-close").addEventListener("click", () => ENGINE.UI.ClearUI(payload.rootId)),
		{ once: true }
	);
}

function injectVersionIntoPayload(payload, screenId) {
	if (screenId === "TitleScreen" && payload.elements?.[0]?.children) {
		const logoWrap = payload.elements[0].children.find(el => el.id === "logo-wrap");
		if (logoWrap?.children?.[1]) {
			logoWrap.children[1].text = `Engine - v${ENGINE.Meta.Version}`;
		}
	}
}

async function processPayload(payloadId) {
	if (payloadId === "Sample") return processSamplePayload();

	const uiData = await loadUiData();
	const entry = resolvePayloadEntry(uiData, payloadId);
	if (!entry) {
		ENGINE.Log("GAME", `Missing UI payload: ${payloadId}`, "error", "UI");
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
	injectVersionIntoPayload(payload, payloadId);

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