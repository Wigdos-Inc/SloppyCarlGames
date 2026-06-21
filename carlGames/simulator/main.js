import { StartEngine } from "../../engine/v1/Bootup.js";
import jsonEntities from "./entities.json" with { type: "json" };

// ── Boot ────────────────────────────────────────────────────────────────────

StartEngine();
ENGINE.Config.DEBUG.SKIP.Splash = true;
ENGINE.Config.DEBUG.SKIP.Intro  = true;

const { Start, Load, Clear, Exit, Cache, GetModelState, GetFullState } = ENGINE.Simulator;
window.load = Load;

// ── Entity registry ──────────────────────────────────────────────────────────

let userEntities;
try   { userEntities = JSON.parse(localStorage.getItem("entities") ?? "[]") ?? []; }
catch { userEntities = []; }

const entityRegistry = [...new Map(
    [...jsonEntities, ...userEntities].map(e => [e.id, { objectType: e.type, definition: e }])
).values()];
Cache(entityRegistry);

// Debug
window.entity = entityRegistry[0].definition;

// ── Session ──────────────────────────────────────────────────────────────────

const sessionKey = "SIMULATOR_STATE";

// ── Overlay DOM refs (populated by buildOverlay) ──────────────────────────────

let overlayEl;
let selectEl;
let textareaEl;
let errorEl;
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
    selectEl.innerHTML = "";
    if (entityRegistry.length === 0) {
        const opt = document.createElement("option");
        opt.textContent = "(no entities)";
        opt.disabled = true;
        selectEl.appendChild(opt);
        return;
    }
    entityRegistry.forEach(entry => {
        const opt = document.createElement("option");
        opt.value = entry.definition.id;
        opt.textContent = entry.definition.id;
        selectEl.appendChild(opt);
    });
}

const autoRestoreEnabled = () => localStorage.getItem("sim_auto_restore") !== "false";

async function restoreSessionState() {
    const state = ENGINE.Meta.ReadFromSession(sessionKey);
    if (!state || !state.lastEntityId) return;
    await Load({ id: state.lastEntityId });
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
    await Load({ id });
    ENGINE.Meta.PushToSession(sessionKey, { lastEntityId: id });
    somethingLoaded = true;
    hideOverlay();
}

function handleEdit() {
    const id = selectEl.value;
    if (!id) return;
    const entry = entityRegistry.find(e => e.definition.id === id);
    if (!entry) return;
    textareaEl.value = JSON.stringify(entry.definition, null, 2);
    setError("");
}

async function handleLoadJson() {
    setError("");
    let parsed;
    try { parsed = JSON.parse(textareaEl.value); }
    catch (e) { setError(`JSON parse error: ${e.message}`); return; }

    const validationErrors = validateEntry(parsed);
    if (validationErrors.length > 0) {
        setError(validationErrors.join("\n"));
        return;
    }

    const cacheErrors = [];
    const originalConsoleError = console.error;
    console.error = (...args) => {
        if (typeof args[0] === "string" && args[0].includes("[Validation]")) cacheErrors.push(args[1] ?? args[0]);
        originalConsoleError.apply(console, args);
    };
    await Cache([{ objectType: parsed.type, definition: parsed }]);
    console.error = originalConsoleError;

    if (cacheErrors.length > 0) {
        setError(cacheErrors.join("\n"));
        return;
    }

    await Load({ id: parsed.id });

    const existingIndex = entityRegistry.findIndex(e => e.definition.id === parsed.id);
    if (existingIndex !== -1) entityRegistry[existingIndex] = { objectType: parsed.type, definition: parsed };
    else entityRegistry.push({ objectType: parsed.type, definition: parsed });

    userEntities = entityRegistry
        .filter(e => !jsonEntities.some(j => j.id === e.definition.id))
        .map(e => e.definition);
    localStorage.setItem("entities", JSON.stringify(userEntities));
    refreshDropdown();
    selectEl.value = parsed.id;

    ENGINE.Meta.PushToSession(sessionKey, { lastEntityId: parsed.id });
    somethingLoaded = true;
    hideOverlay();
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

    // Entity section
    const entityLabel = document.createElement("label");
    entityLabel.className = "sim-label";
    entityLabel.textContent = "Entity";

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

    jsonBtnRow.appendChild(loadJsonBtn);

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
    panel.appendChild(entityLabel);
    panel.appendChild(selectEl);
    panel.appendChild(entityBtnRow);
    panel.appendChild(jsonLabel);
    panel.appendChild(textareaEl);
    panel.appendChild(jsonBtnRow);
    panel.appendChild(errorEl);
    panel.appendChild(clearBtnRow);

    overlayEl.appendChild(panel);
    document.body.appendChild(overlayEl);

    refreshDropdown();
}

function setError(msg) {
    errorEl.textContent       = msg;
    errorEl.style.display     = msg !== "" ? "block" : "none";
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