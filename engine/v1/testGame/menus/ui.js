// Provides all UI data to Engine on startup
// Tells Engine which to use after each Event

import { ENGINE } from "../../Bootup.js";

let uiDataPromise = null;

function loadUiData() {
	if (!uiDataPromise) {
		uiDataPromise = fetch(new URL("./ui.json", import.meta.url))
			.then((response) => response.json())
			.catch(() => null);
	}

	return uiDataPromise;
}

function resolvePayload(uiData, payloadId) {
	if (!uiData || !payloadId) {
		return null;
	}

	if (uiData.menuUI && uiData.menuUI[payloadId]) {
		return uiData.menuUI[payloadId];
	}

	if (uiData.gameUI && uiData.gameUI[payloadId]) {
		return uiData.gameUI[payloadId];
	}

	return null;
}

function resolvePayloadType(uiData, payloadId) {
	if (!uiData || !payloadId) {
		return "unknown";
	}

	if (uiData.menuUI && uiData.menuUI[payloadId]) {
		return "menu";
	}

	if (uiData.gameUI && uiData.gameUI[payloadId]) {
		return "game";
	}

	return "unknown";
}

async function processPayload(payloadId) {
	const uiData = await loadUiData();
	const payload = resolvePayload(uiData, payloadId);
	if (!payload) {
		if (ENGINE && typeof ENGINE.Log === "function") {
			ENGINE.Log("GAME", `Missing UI payload: ${payloadId}`, "warn", "UI");
		}
		return;
	}

	const payloadType = resolvePayloadType(uiData, payloadId);

	if (payload.music && payload.music.src) {
		payload.music = {
			...payload.music,
			src: new URL(payload.music.src, import.meta.url).href,
		};
	}

	if (!payload.screenId) {
		payload.screenId = payloadId;
	}

	if (ENGINE && typeof ENGINE.Log === "function") {
		ENGINE.Log(
			"GAME",
			`Sending ${payloadId} ${payloadType} UI Payload.`,
			"log",
			"UI"
		);
	}

	if (ENGINE && ENGINE.UI && typeof ENGINE.UI.ApplyMenuUI === "function") {
		ENGINE.UI.ApplyMenuUI(payload);
	}
}

function handleUiRequest(event) {
	const payload = event && event.detail ? event.detail.payload : null;
	if (!payload || !payload.screenId) {
		return;
	}

	processPayload(payload.screenId);
}

window.addEventListener("UI_REQUEST", handleUiRequest);