# Engine V1 — Development Instructions

This project's active codebase is `engine/v1/`. All rule documents live in `engine/v1/rules/`. Read the rules that govern any module you touch before making changes. Read only the rules relevant to the module being edited — not all rules at once — unless doing a broad review.

## Rule Priority

1. `FORBIDDEN_DEFENSIVE_CHECKS.md` — highest priority. No defensive guards on guaranteed engine-owned symbols.
2. `UNIT_INSTANCING.md` — second highest. Instance `Unit`/`UnitVector3` once at entry; never re-instance; assume pre-instanced downstream.
3. `CASING.md` — third. `lowerCamelCase` (non-exported), `UpperCamelCase` (exported), `FULL_CAPS` (exported constants).
4. `MODULE_GROUPS.md` and `ENGINE_GAME_COMMUNICATION.md` as supporting context.

These rules apply during both feature development and debugging. Debugging is not an exception path.

## Development Principles

- Fix problems at the correct boundary (`validate.js` / `normalize.js` for payloads; builder contracts for scene/entity; `ini.js` / boot for initialization). Do not mask downstream.
- Keep changes narrowly scoped to the actual issue.
- Never create new engine modules unless explicitly requested.
- When a rule appears to conflict with required functionality, call out the tradeoff clearly before proceeding. Do not silently violate rules.

## Logging

Use `Log(source, message, level, channel)` from `core/meta.js` for instrumentation.

- Keep messages short and descriptive: `Log("Camera", "converting player position to world units", "debug", "Camera")`.
- Use a source and channel that match the subsystem being worked on.
- Avoid logging inside hot loops unless temporarily needed to isolate a bug.
- Remove debug-only logs after the issue is resolved unless they provide ongoing diagnostic value.

## Available Commands

- `/project:era` — Engine Rules Auditor. Use for rule compliance reviews and violation detection or cleanup.
- `/project:dryad` — DRY Agent for Deduplication. Use for deduplication reviews and simplification.
- `/project:ed` — Engine Developer. Use for scoped engine feature work and bug fixes.
- `/project:argus` — Automated Runtime Game-testing & User Simulation. Use for browser-based game testing, feature verification, and runtime error detection via MCP tools.
- `/project:sage` — System Analysis for Game Engines. Use to answer questions about the engine: how systems work, where to find things, and what specific modules do (UNDER DEVELOPMENT).

## Autonomous Subagent Use

These commands can be invoked as subagents (via the Agent tool) without explicit user request. Use judgment — small fixes, debugging, and code migrations do not warrant subagents. Feature additions, refactors and research can warrant subagents.

**When to spawn autonomously:**

- **ED** — When new functionality is being implemented (new features, non-trivial extensions to existing systems or notable refactors). Spawn ED as the implementing agent for that work.
- **DRYAD** — When any task involves performance, deduplication, line count reduction, or efficiency concerns. Spawn DRYAD to ensure concise and efficient code. Large additions or refactors should always be reviewed.
- **ERA** — When the task involves rule adherence, compliance review, or you are uncertain whether a change satisfies engine rules. Large additions or refactors should always be reviewed.
- **ARGUS** — When browser-based verification of a feature or fix is needed (changes that may cause runtime errors, behavioral changes, or visual changes). Spawned by main Claude after ED's turn ends — never by ED itself. See post-ED rules below.

**Post-ED audit requirement:**

After any ED pass that results in a significant amount of new or edited code — judged by scope (new functions, structural changes, multi-file edits) rather than a fixed line count — spawn both the ERA and DRYAD skills through subagents on the changed code.

After ERA and DRYAD return, apply the following ARGUS rules:
- If ERA and DRYAD both returned clean (no genuine violations): spawn ARGUS immediately to verify the change in the browser.
- If ERA and/or DRYAD flagged genuine issues: report the findings to the user and note that ARGUS will run once those findings have been reviewed. Do not spawn ARGUS until the issues are resolved.
- If browser verification is not warranted for the change (no risk of runtime errors, behavioral changes, or visual changes), skip ARGUS regardless of audit results.

If ARGUS returns unsolved issues, report back to the user, offering to have ED resolve them.

**What does not require subagents:**

Small isolated fixes (may still call ARGUS), debugging sessions, logging changes, code migrations (e.g. moving a declaration between files), and one-off lookups. These are handled directly.

## Response Formatting

**Code line references:** Always use markdown link syntax for file and line references so they are clickable in the IDE:
- File only: `[filename.js](engine/v1/path/filename.js)`
- Specific line: `[filename.js:42](engine/v1/path/filename.js#L42)`
- Line range: `[filename.js:42-51](engine/v1/path/filename.js#L42-L51)`
Never use bare backtick paths for file references — always link them.

**Line count deltas:** When reporting changes across one or more files (especially after DRYAD, ERA, or ED passes), include a line count table:

| File | Before | After | Δ |
|---|---|---|---|
| `path/to/file.js` | 120 | 105 | −15 |
| **Total** | | | **−15** |

Report this at the end of any response where files were edited.

## Node.js Bash Checks — Limitations

`node --check <file>` (syntax checking) works on any engine module and should be used after edits.

**Importing or executing engine modules in Node does not work** and must not be attempted. Two permanent blockers:
1. **Browser APIs** — `localStorage`, `sessionStorage`, WebGL (`gl.*`), `createImageBitmap`, etc. are referenced at module scope throughout the engine.
2. **Module load cycle** — `config.js` (and others) instantiate `Unit` at the top level while `Utilities.js` hasn't finished initializing, causing a TDZ crash on any import chain that reaches `config.js` or modules with similar dependencies.

These are structural, not fixable with shims. **ARGUS (browser) is the only runtime verification path.** Do not write Node harnesses or attempt `node -e "import(...)"` on engine modules — it will always fail and wastes tokens.

## testGame

`engine/v1/testGame/` is a game, not an engine module. It is exempt from engine module group rules. It interacts with the engine exclusively through the `ENGINE` API exposed by `ini.js`. Do not treat testGame code as engine code.
