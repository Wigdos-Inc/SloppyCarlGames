// Provides all UI data to Engine on startup
// Tells Engine which to use after each Event

import { ENGINE } from "../../Bootup.js";

const engineEvent = "ENGINE_EVENT";
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

async function processPayload(payloadId) {
	const uiData = await loadUiData();
	const payload = resolvePayload(uiData, payloadId);
	if (!payload) {
		if (ENGINE && typeof ENGINE.Log === "function") {
			ENGINE.Log("GAME", `Missing UI payload: ${payloadId}`, "warn", "UI");
		}
		return;
	}

	if (payload.music && payload.music.src) {
		payload.music = {
			...payload.music,
			src: new URL(payload.music.src, import.meta.url).href,
		};
	}

	if (!payload.screenId) {
		payload.screenId = payloadId;
	}

	if (ENGINE && ENGINE.UI && typeof ENGINE.UI.ApplyMenuUI === "function") {
		ENGINE.UI.ApplyMenuUI(payload);
	}
}

function handleEngineEvent(event) {
	if (!event || !event.detail || !event.detail.name) {
		return;
	}

	processPayload(event.detail.name);
}

window.addEventListener(engineEvent, handleEngineEvent);