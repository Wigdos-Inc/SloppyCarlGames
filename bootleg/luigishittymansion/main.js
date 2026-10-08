// Luigi's Shitty Mansion — entry point.
import { StartEngine } from "../../engine/v1/Bootup.js";

StartEngine();

const params = new URLSearchParams(location.search);
const DEV = params.has("dev");

ENGINE.Config.Debug.Skip.Intro = true;
ENGINE.Config.Debug.Skip.Splash = DEV;
// Debug.All doubles as a KeyR respawn hotkey and the log gate; ship with it off.
ENGINE.Config.Debug.All = DEV;

ENGINE.Startup.ProvideSplashScreenPayload({ outputType: "default" });

const { ShowTitle, ShowHowToPlay, ShowSettings, HandleMenuInput } = await import("./src/menus.js");
const { OpenGallery, HandleGalleryInput } = await import("./src/gallery.js");
const { StartChapter, HandleGameInput, HandlePause, HandleResume, QuitToTitle, RestartChapter } = await import("./src/game.js");

window.addEventListener("UI_REQUEST", (event) => {
	if (event.detail.screenId !== "TitleScreen") return;
	if (DEV && params.has("play")) return StartChapter();
	ShowTitle();
});

window.addEventListener("LSM_START", () => StartChapter());
window.addEventListener("LSM_HOWTO", () => ShowHowToPlay());
window.addEventListener("LSM_GALLERY", () => OpenGallery());
window.addEventListener("LSM_SETTINGS", () => ShowSettings());
window.addEventListener("LSM_TITLE", () => ShowTitle());
window.addEventListener("LSM_RESTART", () => RestartChapter());
window.addEventListener("LSM_QUIT", () => QuitToTitle());
window.addEventListener("LSM_RESUME", () => ENGINE.Level.ResumeLevel());
window.addEventListener("LEVEL_PAUSED", () => HandlePause());
window.addEventListener("LEVEL_RESUMED", () => HandleResume());

window.addEventListener("USER_INPUT", (event) => {
	HandleMenuInput(event.detail);
	HandleGalleryInput(event.detail);
	HandleGameInput(event.detail);
});
