// In-level HUD: built through ENGINE.UI, then updated in place via the DOM.

const HUD_ROOT_ID = "lsm-hud-root";

const heartSvg = (fill) => `data:image/svg+xml;utf8,${encodeURIComponent(
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 30"><path d="M16 28 C 6 20, 1 14, 1 8.5 C 1 4.2, 4.3 1, 8.5 1 C 11.6 1, 14.4 2.8, 16 5.6 C 17.6 2.8, 20.4 1, 23.5 1 C 27.7 1, 31 4.2, 31 8.5 C 31 14, 26 20, 16 28 Z" fill="${fill}" stroke="#1a1012" stroke-width="2.2" stroke-linejoin="round"/><path d="M8 6 C 6 7, 5 9, 5.5 11" stroke="rgba(255,255,255,0.55)" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`
)}`;

const HEART_FULL = heartSvg("#efb6bd");
const HEART_EMPTY = heartSvg("#c9c9cf");

const outline = "-2px -2px 0 #120c10, 2px -2px 0 #120c10, -2px 2px 0 #120c10, 2px 2px 0 #120c10, 0 3px 0 #120c10, 0 0 6px rgba(0,0,0,0.6)";

const textStyles = (size) => ({
	fontFamily: "\"Nunito\", \"Trebuchet MS\", sans-serif",
	fontWeight: "900",
	fontSize: size,
	color: "#ffffff",
	textShadow: outline,
	lineHeight: "1.05",
	letterSpacing: "0.5px",
	whiteSpace: "nowrap",
});

function buildHudPayload(maxHealth, chapterTitle) {
	const hearts = [];
	for (let i = 0; i < maxHealth; i++) {
		hearts.push({ type: "img", id: `lsm-heart-${i}`, src: HEART_FULL, styles: { width: "46px", height: "43px", marginRight: "4px" } });
	}

	return {
		screenId: "LsmHud",
		rootId: HUD_ROOT_ID,
		rootStyles: { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "20" },
		elements: [
			{
				type: "div",
				id: "lsm-vignette",
				styles: {
					position: "fixed", inset: "0", pointerEvents: "none",
					background: "radial-gradient(ellipse at 50% 55%, rgba(0,0,0,0) 55%, rgba(10,4,14,0.55) 85%, rgba(6,2,8,0.9) 100%)",
					boxShadow: "inset 0 0 0 10px #0d0910, inset 0 0 40px 18px rgba(0,0,0,0.75)",
				},
			},
			{
				type: "div",
				id: "lsm-hud-left",
				styles: { position: "fixed", top: "18px", left: "26px", display: "flex", flexDirection: "column", gap: "4px" },
				children: [
					{
						type: "div",
						styles: textStyles("38px"),
						children: [
							{ type: "span", text: "LUIGI'S ", styles: { color: "#86c06c" } },
							{ type: "span", text: "SHITTY ", styles: { color: "#e59a9c" } },
							{ type: "span", text: "MANSION:", styles: { color: "#d9cc9e" } },
						],
					},
					{ type: "div", id: "lsm-chapter", text: chapterTitle, styles: textStyles("34px") },
					{ type: "div", id: "lsm-health-label", text: `HEALTH: ${maxHealth}`, styles: { ...textStyles("34px"), marginTop: "18px" } },
					{ type: "div", id: "lsm-hearts", styles: { display: "flex", marginTop: "2px", filter: "drop-shadow(0 2px 0 rgba(0,0,0,0.6))" }, children: hearts },
				],
			},
			{
				type: "div",
				id: "lsm-hud-right",
				styles: { position: "fixed", top: "18px", right: "30px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px" },
				children: [
					{ type: "div", id: "lsm-score", text: "SCORE: 0", styles: textStyles("38px") },
					{ type: "div", id: "lsm-ghosts", text: "GHOSTS: 0", styles: textStyles("38px") },
					{ type: "div", id: "lsm-trash", text: "", styles: { ...textStyles("22px"), marginTop: "6px", opacity: "0.9" } },
				],
			},
			{
				type: "div",
				id: "lsm-toast",
				text: "",
				styles: {
					...textStyles("40px"),
					position: "fixed", left: "50%", top: "24%", transform: "translateX(-50%)",
					opacity: "0", transition: "opacity 0.35s ease, transform 0.35s ease", textAlign: "center", whiteSpace: "pre-line",
				},
			},
			{
				type: "div",
				id: "lsm-hint",
				text: "",
				styles: {
					...textStyles("20px"),
					position: "fixed", left: "50%", bottom: "28px", transform: "translateX(-50%)",
					opacity: "0.85", textAlign: "center",
				},
			},
			{
				type: "div",
				id: "lsm-boss",
				styles: { position: "fixed", left: "50%", bottom: "70px", transform: "translateX(-50%)", display: "none", flexDirection: "column", alignItems: "center", gap: "6px" },
				children: [
					{ type: "div", text: "THE LANDLORD", styles: textStyles("26px") },
					{
						type: "div",
						styles: { width: "520px", height: "22px", border: "4px solid #120c10", borderRadius: "12px", background: "rgba(20,10,24,0.8)", overflow: "hidden" },
						children: [{ type: "div", id: "lsm-boss-fill", styles: { width: "100%", height: "100%", background: "linear-gradient(90deg, #7a2fb0, #c070ff)", transition: "width 0.1s linear" } }],
					},
				],
			},
			{
				type: "div",
				id: "lsm-hurt",
				styles: {
					position: "fixed", inset: "0", pointerEvents: "none", opacity: "0",
					background: "radial-gradient(ellipse at center, rgba(160,0,40,0) 40%, rgba(170,10,50,0.55) 100%)",
					transition: "opacity 0.25s ease",
				},
			},
		],
	};
}

let toastTimer = null;
const lastText = new Map();

function setText(id, text) {
	if (lastText.get(id) === text) return;
	const el = document.getElementById(id);
	if (!el) return;
	el.textContent = text;
	lastText.set(id, text);
}

// Must run before CreateLevel: ApplyMenuUI flips input routing to UI mode, CreateLevel flips it back.
export function ShowHud(maxHealth, chapterTitle) {
	lastText.clear();
	return ENGINE.UI.ApplyMenuUI(buildHudPayload(maxHealth, chapterTitle));
}

export function UpdateBoss(fraction) {
	const bar = document.getElementById("lsm-boss");
	if (!bar) return;
	bar.style.display = fraction === null ? "none" : "flex";
	if (fraction !== null) document.getElementById("lsm-boss-fill").style.width = `${Math.max(0, fraction) * 100}%`;
}

export function HideHud() {
	ENGINE.UI.ClearUI(HUD_ROOT_ID);
	lastText.clear();
}

export function UpdateHud(state) {
	setText("lsm-score", `SCORE: ${state.score}`);
	setText("lsm-ghosts", `GHOSTS: ${state.ghostsCaught}`);
	setText("lsm-trash", state.trashTotal > 0 ? `TRASH: ${state.trashCleaned}/${state.trashTotal}` : "");
	setText("lsm-health-label", `HEALTH: ${Math.max(0, state.health)}`);
	for (let i = 0; i < state.maxHealth; i++) {
		const key = `lsm-heart-${i}`;
		const src = i < state.health ? HEART_FULL : HEART_EMPTY;
		if (lastText.get(key) === src) continue;
		const el = document.getElementById(key);
		if (el) el.src = src;
		lastText.set(key, src);
	}
}

export function ShowHint(text) {
	setText("lsm-hint", text);
}

export function Toast(text, durationMs = 2200) {
	const el = document.getElementById("lsm-toast");
	if (!el) return;
	el.textContent = text;
	el.style.opacity = "1";
	el.style.transform = "translateX(-50%) translateY(0)";
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => {
		el.style.opacity = "0";
		el.style.transform = "translateX(-50%) translateY(-12px)";
	}, durationMs);
}

export function FlashHurt() {
	const el = document.getElementById("lsm-hurt");
	if (!el) return;
	el.style.opacity = "1";
	setTimeout(() => { el.style.opacity = "0"; }, 180);
}
