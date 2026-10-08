// Menu screens, authored as ENGINE.UI payloads.
import { AssetUrl, AssetExists, PlayMusic } from "./assets.js";
import { LoadSettings, SaveSettings, ApplySettings } from "./settings.js";

const MENU_ROOT = "engine-ui-root";
export const OVERLAY_ROOT = "lsm-overlay-root";

const FONT = "\"Nunito\", \"Trebuchet MS\", sans-serif";
const outline = "-3px -3px 0 #120c10, 3px -3px 0 #120c10, -3px 3px 0 #120c10, 3px 3px 0 #120c10, 0 5px 0 #120c10";

function button(id, label, eventName) {
	const idle = { background: "rgba(30,14,40,0.55)", border: "3px solid rgba(233,220,170,0.25)", transform: "scale(1)" };
	const hover = { background: "rgba(120,70,150,0.75)", border: "3px solid #e9dcaa", transform: "scale(1.05)" };
	return {
		type: "div",
		id,
		text: label,
		styles: {
			...idle,
			fontFamily: FONT, fontWeight: "900", fontSize: "30px", color: "#fff", textShadow: outline,
			padding: "10px 34px", borderRadius: "14px", cursor: "pointer", textAlign: "center",
			transition: "transform 0.12s ease, background 0.12s ease", userSelect: "none", minWidth: "280px",
		},
		events: {
			click: { type: "event", name: eventName, payload: {} },
			pointerover: { type: "style", targetId: id, styles: hover },
			pointerout: { type: "style", targetId: id, styles: idle },
		},
	};
}

const logo = (size) => ({
	type: "div",
	styles: { fontFamily: FONT, fontWeight: "900", fontSize: size, textShadow: outline, letterSpacing: "1px", lineHeight: "1", textAlign: "center" },
	children: [
		{ type: "span", text: "LUIGI'S ", styles: { color: "#86c06c" } },
		{ type: "span", text: "SHITTY ", styles: { color: "#e59a9c" } },
		{ type: "span", text: "MANSION", styles: { color: "#d9cc9e" } },
	],
});

const backdrop = (children) => ({
	type: "div",
	id: "lsm-backdrop",
	styles: {
		position: "fixed", inset: "0", overflow: "hidden",
		background: "radial-gradient(circle at 78% 22%, #f6efc4 0, #efe2a0 5.5%, rgba(239,226,160,0.25) 7%, rgba(0,0,0,0) 14%), linear-gradient(180deg, #120b24 0%, #2b1840 45%, #4a2a4a 70%, #1a0f14 100%)",
	},
	children: [
		{ type: "div", styles: { position: "absolute", left: "8%", right: "8%", bottom: "0", height: "38%", background: "#0d0812", clipPath: "polygon(0 100%, 0 40%, 10% 40%, 10% 18%, 16% 0, 22% 18%, 22% 40%, 38% 40%, 38% 22%, 50% 6%, 62% 22%, 62% 40%, 78% 40%, 78% 18%, 84% 0, 90% 18%, 90% 40%, 100% 40%, 100% 100%)" } },
		{ type: "div", styles: { position: "absolute", left: "14%", bottom: "14%", width: "26px", height: "36px", background: "#f2c45a", boxShadow: "0 0 18px #f2c45a" } },
		{ type: "div", styles: { position: "absolute", left: "47.5%", bottom: "20%", width: "30px", height: "40px", background: "#f2c45a", boxShadow: "0 0 18px #f2c45a" } },
		{ type: "div", styles: { position: "absolute", right: "15%", bottom: "11%", width: "26px", height: "36px", background: "#6a4a8a", boxShadow: "0 0 12px #6a4a8a" } },
		{ type: "div", styles: { position: "absolute", inset: "0", boxShadow: "inset 0 0 160px 40px rgba(0,0,0,0.85)" } },
		...children,
	],
});

const panel = (children, extra = {}) => ({
	type: "div",
	styles: { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", ...extra },
	children,
});

const caption = (text, size = "22px", color = "#f3eadf") => ({ type: "div", text, styles: { fontFamily: FONT, fontWeight: "800", fontSize: size, color, textShadow: "0 2px 0 #120c10, 0 0 8px rgba(0,0,0,0.8)", textAlign: "center" } });

function ghostArt() {
	return {
		type: "div",
		styles: { position: "absolute", right: "9%", top: "30%", width: "190px", height: "170px", borderRadius: "48% 52% 40% 44%", background: "radial-gradient(circle at 35% 30%, #e8c8ff 0, #a35bd8 35%, #6d2aa0 100%)", boxShadow: "0 0 50px rgba(170,90,230,0.6)", animation: "lsm-bob 2.6s ease-in-out infinite" },
		children: [
			{ type: "div", styles: { position: "absolute", left: "38px", top: "48px", width: "38px", height: "46px", borderRadius: "50%", background: "#fff", border: "3px solid #120c10" }, children: [{ type: "div", styles: { position: "absolute", left: "16px", top: "16px", width: "14px", height: "16px", borderRadius: "50%", background: "#120c10" } }] },
			{ type: "div", styles: { position: "absolute", left: "88px", top: "52px", width: "38px", height: "46px", borderRadius: "50%", background: "#fff", border: "3px solid #120c10" }, children: [{ type: "div", styles: { position: "absolute", left: "16px", top: "16px", width: "14px", height: "16px", borderRadius: "50%", background: "#120c10" } }] },
		],
	};
}

async function heroArt() {
	if (await AssetExists("images/title_art.png")) {
		return { type: "img", src: AssetUrl("images/title_art.png"), styles: { position: "absolute", left: "6%", bottom: "4%", height: "70%", filter: "drop-shadow(0 18px 24px rgba(0,0,0,0.7))" } };
	}
	// Placeholder robot: box head, hat, cylinder body.
	const block = (styles, children) => ({ type: "div", styles: { position: "absolute", border: "4px solid #120c10", ...styles }, children });
	return {
		type: "div",
		styles: { position: "absolute", left: "10%", bottom: "6%", width: "260px", height: "420px", animation: "lsm-bob 3.2s ease-in-out infinite" },
		children: [
			block({ left: "40px", top: "0", width: "0", height: "0", border: "none", borderLeft: "110px solid transparent", borderRight: "110px solid transparent", borderBottom: "70px solid #7a5a3a" }),
			block({ left: "50px", top: "66px", width: "160px", height: "130px", background: "#e9e2c6" }, [
				block({ left: "24px", top: "34px", width: "34px", height: "34px", borderRadius: "50%", background: "#2f5a2f" }),
				block({ left: "96px", top: "34px", width: "34px", height: "34px", background: "#2a3fd0" }),
				block({ left: "60px", top: "82px", width: "36px", height: "6px", background: "#120c10", border: "none", borderRadius: "3px" }),
			]),
			block({ left: "70px", top: "206px", width: "120px", height: "150px", borderRadius: "12px", background: "#8d7a52" }),
			block({ left: "180px", top: "250px", width: "90px", height: "26px", background: "#7a8a9a", transform: "rotate(-12deg)" }),
			block({ left: "20px", top: "232px", width: "56px", height: "92px", borderRadius: "10px", background: "#c8312c" }),
			block({ left: "84px", top: "352px", width: "20px", height: "60px", background: "#8a95a3" }),
			block({ left: "156px", top: "352px", width: "20px", height: "60px", background: "#8a95a3" }),
		],
	};
}

const KEYFRAMES = "@keyframes lsm-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-14px) } } @keyframes lsm-flicker { 0%,100% { opacity: 1 } 47% { opacity: 1 } 50% { opacity: 0.55 } 53% { opacity: 1 } }";

export async function ShowTitle() {
	ENGINE.UI.ClearUI(OVERLAY_ROOT);
	ENGINE.UI.ApplyMenuUI({
		screenId: "LsmTitle",
		rootId: MENU_ROOT,
		stylesheet: KEYFRAMES,
		elements: [backdrop([
			await heroArt(),
			ghostArt(),
			{
				type: "div",
				styles: { position: "absolute", left: "50%", top: "9%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", animation: "lsm-flicker 5s infinite" },
				children: [
					(await AssetExists("images/logo.png")) ? { type: "img", src: AssetUrl("images/logo.png"), styles: { maxHeight: "220px", maxWidth: "70vw" } } : logo("86px"),
					caption("Chapter 1 - Clean the Mess.", "38px", "#ffffff"),
				],
			},
			panel([
				button("lsm-start", "START", "LSM_START"),
				button("lsm-howto", "HOW TO PLAY", "LSM_HOWTO"),
				button("lsm-gallery", "GHOST GALLERY", "LSM_GALLERY"),
				button("lsm-settings", "SETTINGS", "LSM_SETTINGS"),
			], { top: "64%" }),
			{ type: "div", text: `CarlNet Engine v${ENGINE.Meta.Version}  ·  a Wigdos bootleg`, styles: { position: "absolute", bottom: "14px", right: "20px", fontFamily: FONT, fontWeight: "800", fontSize: "14px", color: "rgba(255,255,255,0.45)" } },
		])],
	});
	PlayMusic("LSM_TITLE", "audio/title_theme.mp3");
}

export function ShowHowToPlay() {
	const row = (keys, text) => ({
		type: "div",
		styles: { display: "flex", gap: "18px", alignItems: "center", width: "640px" },
		children: [
			{ type: "div", text: keys, styles: { fontFamily: FONT, fontWeight: "900", fontSize: "20px", color: "#120c10", background: "#e9dcaa", borderRadius: "8px", padding: "6px 12px", minWidth: "170px", textAlign: "center", border: "3px solid #120c10" } },
			caption(text, "22px"),
		],
	});
	ENGINE.UI.ApplyMenuUI({
		screenId: "LsmHowTo",
		rootId: MENU_ROOT,
		stylesheet: KEYFRAMES,
		elements: [backdrop([
			panel([
				logo("54px"),
				caption("Somebody has to clean this dump. Unfortunately, it's you.", "24px", "#e9dcaa"),
				row("W A S D", "Walk around the mansion"),
				row("MOUSE / ARROWS", "Look around (click the game to lock the mouse)"),
				row("SPACE", "Jump"),
				row("LEFT CLICK / J", "Hold to run the Poltergust 0.5 (vacuum)"),
				row("SHIFT", "Sprint"),
				row("ESC / P", "Pause"),
				caption("Point the nozzle at ghosts and hold. They pull away — keep them in the cone until they pop.", "20px"),
				caption("Vacuum trash for points, grab hearts to heal. Ghosts flash red before they dash at you — dodge!", "20px"),
				button("lsm-back", "BACK", "LSM_TITLE"),
			]),
		])],
	});
}

export function ShowSettings() {
	const settings = LoadSettings();
	const toggle = (id, label, on) => ({
		type: "div",
		id,
		text: `${label}: ${on ? "ON" : "OFF"}`,
		styles: { fontFamily: FONT, fontWeight: "900", fontSize: "26px", color: on ? "#bff5a8" : "#f3b0b0", textShadow: outline, cursor: "pointer", padding: "8px 24px", borderRadius: "12px", background: "rgba(30,14,40,0.55)", minWidth: "420px", textAlign: "center" },
		events: { click: { type: "event", name: "LSM_SETTING_TOGGLE", payload: { key: id } } },
	});
	ENGINE.UI.ApplyMenuUI({
		screenId: "LsmSettings",
		rootId: MENU_ROOT,
		elements: [backdrop([
			panel([
				logo("54px"),
				caption("Settings", "34px", "#fff"),
				toggle("toonLines", "TOON OUTLINES", settings.toonLines),
				toggle("comic", "COMIC SHADING", settings.comic),
				toggle("music", "MUSIC", settings.music),
				button("lsm-back", "BACK", "LSM_TITLE"),
			]),
		])],
	});
}

window.addEventListener("LSM_SETTING_TOGGLE", (event) => {
	const settings = LoadSettings();
	const key = event.detail.key;
	settings[key] = !settings[key];
	SaveSettings(settings);
	ApplySettings(settings);
	ShowSettings();
});

function overlay(screenId, children, tint) {
	ENGINE.UI.ApplyMenuUI({
		screenId,
		rootId: OVERLAY_ROOT,
		rootStyles: { position: "fixed", inset: "0", zIndex: "40" },
		elements: [{
			type: "div",
			styles: { position: "fixed", inset: "0", background: tint, display: "flex", alignItems: "center", justifyContent: "center" },
			children: [panel(children, { position: "relative", left: "auto", top: "auto", transform: "none" })],
		}],
	});
}

export function ShowPause() {
	overlay("LsmPause", [
		logo("48px"),
		caption("PAUSED", "56px", "#fff"),
		button("lsm-resume", "RESUME", "LSM_RESUME"),
		button("lsm-restart", "RESTART CHAPTER", "LSM_RESTART"),
		button("lsm-quit", "QUIT TO TITLE", "LSM_QUIT"),
	], "rgba(12,6,20,0.72)");
}

export function ShowGameOver(stats) {
	overlay("LsmGameOver", [
		caption("YOU GOT SPOOKED", "72px", "#e59a9c"),
		caption("The ghosts have reclaimed the mansion. And the mess.", "24px"),
		caption(`SCORE: ${stats.score}   ·   GHOSTS: ${stats.ghostsCaught}/${stats.ghostTotal}   ·   TRASH: ${stats.trashCleaned}/${stats.trashTotal}`, "26px", "#fff"),
		button("lsm-retry", "TRY AGAIN", "LSM_RESTART"),
		button("lsm-quit", "QUIT TO TITLE", "LSM_QUIT"),
	], "rgba(40,4,12,0.78)");
}

export function ShowVictory(stats) {
	overlay("LsmVictory", [
		logo("48px"),
		caption("CHAPTER 1 CLEAR!", "72px", "#bff5a8"),
		caption("The mansion is marginally less disgusting. Good job.", "24px"),
		caption(`SCORE: ${stats.score}`, "44px", "#fff"),
		caption(`Ghosts ${stats.ghostsCaught}/${stats.ghostTotal}  ·  Trash ${stats.trashCleaned}/${stats.trashTotal}  ·  Time ${stats.time}`, "24px"),
		caption(stats.rank, "34px", "#e9dcaa"),
		button("lsm-again", "PLAY AGAIN", "LSM_RESTART"),
		button("lsm-quit", "QUIT TO TITLE", "LSM_QUIT"),
	], "rgba(8,20,14,0.78)");
}

export function ClearOverlay() {
	ENGINE.UI.ClearUI(OVERLAY_ROOT);
}

export function HandleMenuInput() {}
