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

## Autonomous Subagent Use

These commands can be invoked as subagents (via the Agent tool) without explicit user request. Use judgment — small fixes, debugging, and code migrations do not warrant subagents.

**When to spawn autonomously:**

- **ED** — When new functionality is being implemented (new features, non-trivial extensions to existing systems). Spawn ED as the implementing agent for that work.
- **DRYAD** — When the task involves performance, deduplication, line count reduction, or efficiency concerns. Spawn DRYAD to review the relevant scope.
- **ERA** — When the task involves rule adherence, compliance review, or you are uncertain whether a change satisfies engine rules.

**Post-ED audit requirement:**

After any ED pass that results in a significant amount of new or edited code — judged by scope (new functions, structural changes, multi-file edits) rather than a fixed line count — spawn both ERA and DRYAD as auditing agents on the changed code. Return their findings to the user after the regular response so the user can evaluate them. When spawning these audits after an ED pass, full edit authorization is granted: fix all significant findings rather than just reporting them.

**What does not require subagents:**

Small isolated fixes, debugging sessions, logging changes, code migrations (e.g. moving a declaration between files), and one-off lookups. These are handled directly.

## testGame

`engine/v1/testGame/` is a game, not an engine module. It is exempt from engine module group rules. It interacts with the engine exclusively through the `ENGINE` API exposed by `ini.js`. Do not treat testGame code as engine code.
