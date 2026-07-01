// Boot-time assertion: throws if ENGINE is not present when testGame initializes.
export function initEngine(engine) {
    const globalObj = typeof window !== "undefined" ? window : globalThis;
    const eng = engine || (typeof ENGINE !== "undefined" && ENGINE) || globalObj.ENGINE;
    if (!eng) {
        throw new Error("ENGINE is required for testGame to run.");
    }

    // engineOptional: safe dotted-path traversal used for runtime-state checks
    // (e.g. Level.Player.Input which may not exist between levels).
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

    return eng;
}
