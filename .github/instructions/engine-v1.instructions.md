---
name: "Engine V1 Development & Debugging Instructions"
description: "Use when developing, debugging, refactoring, or reviewing engine/v1 modules. Enforce engine/v1/rules during implementation and debugging, especially FORBIDDEN_DEFENSIVE_CHECKS, UNIT_INSTANCING, CASING, and concise Log instrumentation."
applyTo: "engine/v1/**/*.js"
---
# Engine V1 Development Rules

- Treat `engine/v1/rules/` as the source of truth whenever you edit engine code.
- Before changing engine behavior, read the rule files that govern the module you are touching.
- Give highest priority to `FORBIDDEN_DEFENSIVE_CHECKS.md`, `UNIT_INSTANCING.md`, and `CASING.md`.
- Follow the rules during both feature development and debugging. Debugging is not an exception path for adding forbidden patterns.
- Never create new modules unless explicitly requested.

## Engine Rule Expectations

- Do not add defensive fallback guards for guaranteed engine-owned symbols. If a guaranteed symbol is missing, fix the upstream contract, initialization, validation, or normalization layer.
- Do not add fallback instancing, `instanceof` checks, or `typeof` checks around `Unit` or `UnitVector3` values in downstream engine modules.
- Preserve existing `Unit` and `UnitVector3` instances. Mutate via `.value`, `.set(...)`, or the built-in conversion methods instead of re-instancing.
- Keep casing compliant: non-exported identifiers use `lowerCamelCase`, exported functions/classes use `UpperCamelCase`, and exported true constants use `FULL_CAPS`.
- When a possible rule violation appears necessary for functionality, inspect the surrounding context before deciding. Prefer fixing the architectural boundary or tightening the rule over forcing a superficial workaround.

## Development And Debugging

- Fix problems at the correct boundary instead of masking them downstream.
- Keep changes narrowly scoped to the actual engine issue.
- When debugging, prefer temporary or targeted instrumentation over broad defensive rewrites.
- If a rule seems to conflict with required functionality, call out the tradeoff clearly and suggest the correct follow-up in code or in the relevant rule document.

## Logging Guidance

- Prefer the engine's `Log(source, message, level, channel)` function for concise instrumentation around important code sections.
- Add logs around meaningful boundaries such as normalization, state transitions, cache updates, event dispatch, branching decisions, and other non-obvious control-flow changes.
- Keep log messages short and descriptive of what the code is doing, for example: `Log("ENGINE", "normalizing camera payload", "debug", "Camera")`.
- Use a source and channel that match the subsystem being worked on so logs stay filterable.
- Avoid noisy logging inside hot loops or trivial one-line operations unless it is temporary and directly useful for isolating a bug.
- When a log is only for short-term debugging, remove it after the issue is resolved unless it provides ongoing diagnostic value.

## Review Heuristics

- Check nearby and upstream context before calling something a true rule violation.
- Distinguish between an actual rule break, an underspecified rule, and a necessary tradeoff to preserve engine functionality.
- If a rule is too weak or ambiguous to judge the code cleanly, say that explicitly and propose stronger wording.