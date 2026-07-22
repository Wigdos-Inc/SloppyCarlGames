import { StartEngine } from "../../engine/v1/Bootup.js";
import jsonEntities from "./entities.json" with { type: "json" };
import { validatePlayerEntry, synthesizePlayerEntity, toCharactersJsonEntry, buildPlayerRegistry, PLAYER_TYPE, isPlayerDef } from "./playerMode.js";

// ── Boot ────────────────────────────────────────────────────────────────────

StartEngine();
ENGINE.CONFIG.DEBUG.SKIP.Splash = true;
ENGINE.CONFIG.DEBUG.SKIP.Intro  = true;
ENGINE.CONFIG.DEBUG.LOGGING.All = false;

const { Start, Load, Clear, Exit, Cache, GetModelState, GetFullState } = ENGINE.Simulator;
window.load = Load;

// ── Registries ────────────────────────────────────────────────────────────────
// One user store (localStorage["entities"]) holds every authored/edited definition,
// tagged by `type`. type === "player" => Player mode; any other type => Entity mode.
// Player mode also lists the canonical characters (ENGINE.Blueprints.PlayerCharacters)
// for reference/editing. Entity defs are cached through the engine; player defs are
// synth-cached on load, since the engine has no "player" objectType.

let userDefs;
try   { userDefs = JSON.parse(localStorage.getItem("entities") ?? "[]") ?? []; }
catch { userDefs = []; }

// One-time migration: fold any legacy localStorage["characters"] player drafts into the
// unified store (tagged as players), then drop the old key.
let legacyCharacters;
try   { legacyCharacters = JSON.parse(localStorage.getItem("characters") ?? "[]") ?? []; }
catch { legacyCharacters = []; }
if (legacyCharacters.length > 0) {
    const byId = new Map(userDefs.map(d => [d.id, d]));
    for (const c of legacyCharacters) byId.set(c.id, { ...c, type: PLAYER_TYPE });
    userDefs = [...byId.values()];
    localStorage.setItem("entities", JSON.stringify(userDefs));
    localStorage.removeItem("characters");
}

let entityRegistry;
let playerRegistry;

// Merge seed defs with user edits (user wins by id), then partition by the player tag.
function rebuildRegistries() {
    const merged = [...new Map([...jsonEntities, ...userDefs].map(d => [d.id, d])).values()];
    entityRegistry = merged.filter(d => !isPlayerDef(d)).map(d => ({ objectType: d.type, definition: d }));
    playerRegistry = buildPlayerRegistry(merged.filter(isPlayerDef));
}

// Upsert a saved definition into the user store and refresh both registries.
function persistDef(def) {
    const i = userDefs.findIndex(d => d.id === def.id);
    if (i !== -1) userDefs[i] = def; else userDefs.push(def);
    localStorage.setItem("entities", JSON.stringify(userDefs));
    rebuildRegistries();
}

rebuildRegistries();
Cache(entityRegistry);

// Debug
window.entity = entityRegistry[0]?.definition;

// ── Mode ───────────────────────────────────────────────────────────────────────

let mode = localStorage.getItem("sim_mode") === "player" ? "player" : "entity";

const activeRegistry = () => (mode === "player" ? playerRegistry : entityRegistry);

// ── Session ──────────────────────────────────────────────────────────────────

const sessionKey = "SIMULATOR_STATE";

// ── Overlay DOM refs (populated by buildOverlay) ──────────────────────────────

let overlayEl;
let modeSelectEl;
let sectionLabelEl;
let selectEl;
let textareaEl;
let errorEl;
let copyBtnEl;
let autoRestoreToggle;

// ── Simulator state ───────────────────────────────────────────────────────────

let somethingLoaded = false;

// ── Helpers ──────────────────────────────────────────────────────────────────

function showOverlay(fade) {
    if (fade) overlayEl.classList.add("sim-overlay--fade");
    else      overlayEl.classList.remove("sim-overlay--fade");
    overlayEl.style.display = "flex";
}

const hideOverlay = () => overlayEl.style.display = "none";

function refreshDropdown() {
    const registry = activeRegistry();
    selectEl.innerHTML = "";
    if (registry.length === 0) {
        const opt = document.createElement("option");
        opt.textContent = mode === "player" ? "(no characters)" : "(no entities)";
        opt.disabled = true;
        selectEl.appendChild(opt);
        return;
    }
    registry.forEach(entry => {
        const opt = document.createElement("option");
        opt.value = entry.definition.id;
        opt.textContent = entry.definition.id;
        selectEl.appendChild(opt);
    });
}

function applyModeUI() {
    modeSelectEl.value = mode;
    sectionLabelEl.textContent = mode === "player" ? "Character" : "Entity";
    copyBtnEl.style.display = mode === "player" ? "" : "none";
    refreshDropdown();
}

function setMode(newMode) {
    mode = newMode === "player" ? "player" : "entity";
    localStorage.setItem("sim_mode", mode);
    applyModeUI();
    textareaEl.value = "";
    setError("");
}

// Cache while capturing the engine's "[Validation]" console errors, so schema
// failures surface in the overlay instead of only the devtools console.
async function cacheWithCapture(entries) {
    const captured = [];
    const originalConsoleError = console.error;
    console.error = (...args) => {
        if (typeof args[0] === "string" && args[0].includes("[Validation]")) captured.push(args[1] ?? args[0]);
        originalConsoleError.apply(console, args);
    };
    await Cache(entries);
    console.error = originalConsoleError;
    return captured;
}

// Load-by-id used by the dropdown and session restore. Player-tagged entries render
// through a synthesized entity wrapper (the engine has no "player" objectType); entity
// entries were cached at boot and load directly.
async function loadEntry(id) {
    const entry = activeRegistry().find(e => e.definition.id === id);
    if (!entry) return false;
    if (entry.objectType === "player") {
        const synth = synthesizePlayerEntity(entry.definition);
        await Cache([{ objectType: "entity", definition: synth }]);
        await Load({ id: synth.id });
    } else {
        await Load({ id });
    }
    return true;
}

const autoRestoreEnabled = () => localStorage.getItem("sim_auto_restore") !== "false";

async function restoreSessionState() {
    const state = ENGINE.Meta.ReadFromSession(sessionKey);
    if (!state || !state.lastEntityId) return;
    if (state.lastMode) setMode(state.lastMode);
    if (!(await loadEntry(state.lastEntityId))) return;
    somethingLoaded = true;
    hideOverlay();
}

function validateEntry(v) {
    const errors = [];
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
        errors.push("Root must be a JSON object.");
        return errors;
    }
    if (typeof v.type !== "string") errors.push("type: must be a string.");
    if (typeof v.id !== "string" || v.id.trim() === "") errors.push("id: must be a non-empty string.");
    return errors;
}

// ── Button handlers ───────────────────────────────────────────────────────────

async function handleLoad() {
    const id = selectEl.value;
    if (!id) return;
    if (!(await loadEntry(id))) return;
    ENGINE.Meta.PushToSession(sessionKey, { lastEntityId: id, lastMode: mode });
    somethingLoaded = true;
    hideOverlay();
}

function handleEdit() {
    const id = selectEl.value;
    if (!id) return;
    const entry = activeRegistry().find(e => e.definition.id === id);
    if (!entry) return;
    textareaEl.value = JSON.stringify(entry.definition, null, 2);
    setError("");
}

async function handleLoadJson() {
    setError("");
    let parsed;
    try { parsed = JSON.parse(textareaEl.value); }
    catch (e) { setError(`JSON parse error: ${e.message}`); return; }

    if (mode === "player") await handleLoadPlayerJson(parsed);
    else                   await handleLoadEntityJson(parsed);
}

async function handleLoadEntityJson(parsed) {
    if (parsed.type === PLAYER_TYPE) {
        setError(`This definition is tagged "${PLAYER_TYPE}". Switch to Player mode to load it.`);
        return;
    }

    const validationErrors = validateEntry(parsed);
    if (validationErrors.length > 0) {
        setError(validationErrors.join("\n"));
        return;
    }

    const cacheErrors = await cacheWithCapture([{ objectType: parsed.type, definition: parsed }]);
    if (cacheErrors.length > 0) {
        setError(cacheErrors.join("\n"));
        return;
    }

    await Load({ id: parsed.id });
    persistDef(parsed);
    finishJsonLoad(parsed.id);
}

async function handleLoadPlayerJson(parsed) {
    parsed.type = PLAYER_TYPE; // tag so it partitions into Player mode and persists as a player

    const validationErrors = validatePlayerEntry(parsed);
    if (validationErrors.length > 0) {
        setError(validationErrors.join("\n"));
        return;
    }

    const synth = synthesizePlayerEntity(parsed);
    const cacheErrors = await cacheWithCapture([{ objectType: "entity", definition: synth }]);
    if (cacheErrors.length > 0) {
        setError(cacheErrors.join("\n"));
        return;
    }

    await Load({ id: synth.id });
    persistDef(parsed);
    finishJsonLoad(parsed.id);
}

function finishJsonLoad(id) {
    refreshDropdown();
    selectEl.value = id;
    ENGINE.Meta.PushToSession(sessionKey, { lastEntityId: id, lastMode: mode });
    somethingLoaded = true;
    hideOverlay();
}

// Copy the current player character as a characters.json map entry ("id": {...}).
// Uses the textarea if it has content (validated first), else the selected entry.
async function handleCopyPlayer() {
    let def;
    if (textareaEl.value.trim()) {
        try { def = JSON.parse(textareaEl.value); }
        catch (e) { setError(`JSON parse error: ${e.message}`); return; }
        const validationErrors = validatePlayerEntry(def);
        if (validationErrors.length > 0) {
            setError(validationErrors.join("\n"));
            return;
        }
    } else {
        const entry = playerRegistry.find(e => e.definition.id === selectEl.value);
        if (!entry) { setError("Select or paste a character first."); return; }
        def = entry.definition;
    }
    await navigator.clipboard.writeText(toCharactersJsonEntry(def));
    setStatus(`Copied "${def.id}" — paste into characters.json.`);
}

function handleClear() {
    Clear();
    somethingLoaded = false;
    showOverlay(true);
}

// ── Overlay builder ───────────────────────────────────────────────────────────

function buildOverlay() {
    // Root overlay
    overlayEl = document.createElement("div");
    overlayEl.id = "sim-overlay";
    overlayEl.style.display = "none";

    // Panel
    const panel = document.createElement("div");
    panel.className = "sim-panel";

    // Header row: auto-restore toggle on left, title on right
    const header = document.createElement("div");
    header.className = "sim-header";

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "sim-toggle-label";

    autoRestoreToggle = document.createElement("input");
    autoRestoreToggle.type = "checkbox";
    autoRestoreToggle.checked = autoRestoreEnabled();
    autoRestoreToggle.addEventListener("change", () => {
        localStorage.setItem("sim_auto_restore", autoRestoreToggle.checked ? "true" : "false");
    });

    toggleLabel.appendChild(autoRestoreToggle);
    toggleLabel.appendChild(document.createTextNode(" Auto-restore session"));

    const titleEl = document.createElement("span");
    titleEl.className = "sim-title";
    titleEl.textContent = "Simulator";

    header.appendChild(toggleLabel);
    header.appendChild(titleEl);

    // Mode section
    const modeLabel = document.createElement("label");
    modeLabel.className = "sim-label";
    modeLabel.textContent = "Mode";

    modeSelectEl = document.createElement("select");
    [["entity", "Entity"], ["player", "Player (character)"]].forEach(([value, text]) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = text;
        modeSelectEl.appendChild(opt);
    });
    modeSelectEl.addEventListener("change", () => setMode(modeSelectEl.value));

    // Entity / Character section
    sectionLabelEl = document.createElement("label");
    sectionLabelEl.className = "sim-label";

    selectEl = document.createElement("select");

    const entityBtnRow = document.createElement("div");
    entityBtnRow.className = "sim-btn-row";

    const loadBtn = document.createElement("button");
    loadBtn.className = "sim-btn";
    loadBtn.textContent = "Load";
    loadBtn.addEventListener("click", handleLoad);

    const editBtn = document.createElement("button");
    editBtn.className = "sim-btn";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", handleEdit);

    entityBtnRow.appendChild(loadBtn);
    entityBtnRow.appendChild(editBtn);

    // JSON section
    const jsonLabel = document.createElement("label");
    jsonLabel.className = "sim-label";
    jsonLabel.textContent = "JSON";

    textareaEl = document.createElement("textarea");
    textareaEl.spellcheck = false;

    const jsonBtnRow = document.createElement("div");
    jsonBtnRow.className = "sim-btn-row";

    const loadJsonBtn = document.createElement("button");
    loadJsonBtn.className = "sim-btn";
    loadJsonBtn.textContent = "Load JSON";
    loadJsonBtn.addEventListener("click", handleLoadJson);

    copyBtnEl = document.createElement("button");
    copyBtnEl.className = "sim-btn";
    copyBtnEl.textContent = "Copy Player JSON";
    copyBtnEl.addEventListener("click", handleCopyPlayer);

    jsonBtnRow.appendChild(loadJsonBtn);
    jsonBtnRow.appendChild(copyBtnEl);

    errorEl = document.createElement("div");
    errorEl.className = "sim-error";

    // Clear section
    const clearBtnRow = document.createElement("div");
    clearBtnRow.className = "sim-btn-row";

    const clearBtn = document.createElement("button");
    clearBtn.className = "sim-btn";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", handleClear);

    clearBtnRow.appendChild(clearBtn);

    // Assemble panel
    panel.appendChild(header);
    panel.appendChild(modeLabel);
    panel.appendChild(modeSelectEl);
    panel.appendChild(sectionLabelEl);
    panel.appendChild(selectEl);
    panel.appendChild(entityBtnRow);
    panel.appendChild(jsonLabel);
    panel.appendChild(textareaEl);
    panel.appendChild(jsonBtnRow);
    panel.appendChild(errorEl);
    panel.appendChild(clearBtnRow);

    overlayEl.appendChild(panel);
    document.body.appendChild(overlayEl);

    applyModeUI();
}

function setError(msg) {
    errorEl.classList.remove("sim-error--ok");
    errorEl.textContent   = msg;
    errorEl.style.display = msg !== "" ? "block" : "none";
}

function setStatus(msg) {
    errorEl.classList.add("sim-error--ok");
    errorEl.textContent   = msg;
    errorEl.style.display = "block";
}

// ── Init ──────────────────────────────────────────────────────────────────────

buildOverlay();
setError("");

document.addEventListener("pointerlockchange", () => {
    if (ENGINE.Input.IsPointerLocked() && !somethingLoaded) ENGINE.Input.ReleasePointerLock();
});

// ── Engine event listeners ────────────────────────────────────────────────────

window.addEventListener("UI_REQUEST", async () => {
    await Start();
    showOverlay(false);
    if (autoRestoreEnabled()) await restoreSessionState();
});

window.addEventListener("SIMULATOR_EXITED", () => {
    somethingLoaded = false;
    showOverlay(false);
    setTimeout(async () => {
        await Start();
    }, 50);
});
