// Small helpers for testGame to assert presence of the engine and access features
export function initEngine(engine) {
    const globalObj = typeof window !== "undefined" ? window : globalThis;
    const eng = engine || (typeof ENGINE !== "undefined" && ENGINE) || globalObj.ENGINE;
    if (!eng) {
        throw new Error("ENGINE is required for testGame to run.");
    }

    // Expose a small, opinionated set of helpers on `window` so testGame modules
    // can use a single concise API instead of repeating defensive checks.
    globalObj._TESTGAME_ENGINE = eng;
    globalObj.engine = eng;

    globalObj.engineRequire = function (path) {
        if (!path) return eng;
        const parts = Array.isArray(path) ? path : String(path).split('.');
        let cur = eng;
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            if (cur == null || typeof cur !== 'object' || !(p in cur)) {
                throw new Error(`Required engine path not found: ${parts.join('.')}`);
            }
            cur = cur[p];
        }
        return cur;
    };

    globalObj.engineOptional = function (path) {
        if (!path) return eng;
        const parts = Array.isArray(path) ? path : String(path).split('.');
        let cur = eng;
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            if (cur == null || typeof cur !== 'object' || !(p in cur)) {
                return undefined;
            }
            cur = cur[p];
        }
        return cur;
    };

    globalObj.engineCall = function (path, ...args) {
        const fn = globalObj.engineRequire(path);
        if (typeof fn !== 'function') {
            throw new Error(`Engine path is not callable: ${path}`);
        }
        return fn(...args);
    };

    return eng;
}

export function getEngine() {
    if (typeof window !== 'undefined' && window._TESTGAME_ENGINE) return window._TESTGAME_ENGINE;
    if (typeof ENGINE !== 'undefined') return ENGINE;
    return null;
}
