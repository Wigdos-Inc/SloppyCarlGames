# Engine V1 — Development Instructions

This project's active codebase is `engine/v1/`. All rule documents live in `engine/v1/docs/rules/`. Read the rules that govern any module you touch before making changes. Read only the rules relevant to the module being edited — not all rules at once — unless doing a broad review.

Custom agents load this file but not the main session's memory. Anything an agent must follow belongs here or in the rule docs.

## Game Dev Sessions

A game dev agent or session works outside the engine. It gets its engine information from the `sage` agent, not from engine source, and is exempt from most of this file. One rule it keeps strictly: **no unnecessary checks, above all on the engine.** The engine is a stable presence. Never check that `ENGINE`, an API path, a return value or an event field exists, and never wrap engine calls in fallbacks. (testGame currently does this wrong. Don't copy it.)

## Rule Priority

1. `FORBIDDEN_DEFENSIVE_CHECKS.md` — highest priority. No defensive guards on guaranteed engine-owned symbols.
2. `UNIT_INSTANCING.md` — Instance `Unit`/`UnitVector3` once at entry; never re-instance; assume pre-instanced downstream.
3. `CASING.md` — `lowerCamelCase` (non-exported), `UpperCamelCase` (exported), `FULL_CAPS` (exported constants).
4. `ENGINE_SEMANTICS.md` — comment quality, structure as defense, tuning constants, no re-exports, constant chains, `last`/`next` naming.
5. `MODULE_GROUPS.md`, `ENGINE_GAME_COMMUNICATION.md` and `CNU_VS_WORLDUNITS.md` as supporting context.

These rules apply during both feature development and debugging. Debugging is not an exception path.

## Development Principles

- Fix problems at the correct boundary (`validate.js` / `normalize.js` for incoming payloads; `builder/templates/Instance.js` for engine data; builder contracts for scene/entity; `ini.js` / boot for initialization). Do not mask downstream.
- Keep changes narrowly scoped to the actual issue. "Put it in X" authorizes X only.
- Never create new engine modules unless explicitly requested.
- When a rule appears to conflict with required functionality, call out the tradeoff clearly before proceeding. Do not silently violate rules.
- Comments follow `ENGINE_SEMANTICS.md` §1. `camera/Modes.js` is the reference for correct comments.

## Engine Conventions

- **Logging is never cut for performance.** Don't remove, gate or reduce logs as a perf fix, or offer it as an option. What gets logged is settled at 1.0.
- **Engine-owned assets are guaranteed.** Anything under `engine/v1/assets/` referenced by engine JSON loads. Don't filter, drop or fall back on load failure.
- **ENGINE-exposed utilities get no type guards.** Exposure is not a boundary. If a game passes bad input, it throws.
- **`API_CONFIG` only grows on the author's explicit request.** Feel-tuning constants go in `config.js` outside `API_CONFIG` (§3). Functional constants (sample counts, thresholds, tolerances) stay inline.
- **No backwards compatibility before 1.0.** Game-facing names, events and payloads change like internal ones.
- **Helpers must read at a glance.** No generic helpers driven by callbacks. Inline a function exported for a single caller. Never add a parameter to avoid an import.
- **Check your own side effects.** When a change can alter values flowing onward (sign, precision, shape, null vs missing), trace the consumers before reporting. If that can't be closed cheaply, keep the output identical to before. Never report a risk as "unchecked".

## Logging

Use `Log(source, message, level, channel)` from `core/meta.js` for instrumentation.

- Keep messages short and descriptive: `Log("ENGINE", "converting player position to world units", "debug", "Player")`.
- Source is either "ENGINE" or "GAME".
- Use a channel that matches the subsystem. Channels are listed in `CONFIG.Debug.Logging.Channel` in `config.js`. An unlisted channel doesn't print and logs an error instead.
- Avoid logging inside hot loops unless temporarily needed to isolate a bug.
- Remove temporary debug logs after the issue is resolved unless they provide ongoing diagnostic value.

## Custom Agents and Skills

**Custom agents** run in an isolated context window, invoked via the `Agent` tool with `subagent_type`. They have no access to the current conversation — pass all necessary context in the `prompt` parameter. ERA and DRYAD can run in parallel.

**Skills** load inline into the current conversation, invoked via the `Skill` tool. They share the current conversation's context and tool calls appear in the main thread.

### Custom Agents — `Agent` tool, `subagent_type: "<name>"`

- **`era`** — Engine Rules Auditor. Audits engine/v1/ for rule violations. Add "fixes authorized" to the prompt to allow edits; "rule updates authorized" to allow rule doc edits.
- **`dryad`** — DRY Agent for Deduplication. Identifies duplication, unnecessary complexity, and performance issues. Add "implementation authorized" to allow edits.
- **`sage`** — Read-only engine Q&A for agents building games on CNE (ENGINE API, payloads, events). Never logs or edits; the `sage` skill below remains the docs/log writer.
- **`ed`** — Engine Developer. Full implementation authority. Pass a concrete task description as the prompt.

### Skills — `Skill` tool, `skill: "<name>"`

- **`argus`** — Automated Runtime Game-testing & User Simulation. Functional browser testing of testGame via MCP chrome-devtools. Invoked conditionally by main Claude after ED completes — never by ED itself.
- **`sage`** — System Analysis for Game Engines. Designated as 'engine librarian'. Writes and maintains engine documentation (`system_map/`, `structure.txt`, rule doc descriptive content) and is the sole writer for the status logs (`engine/v1/docs/changelog`, `engine/v1/docs/status/DEFERRED.md`, `engine/v1/docs/status/AGENT_LOG.md`). Also answers Q&A questions about the engine. Invoke with a question, `update documentation`, or `log <raw facts>` to record a change/deferral/agent outcome — see "Status Logging" below.
- **`rigor`** — Rig Iteration & Geometric Output Review. Authors and edits entity/character model JSON, then iterates with the author on Simulator App screenshots.

## Agent and Skill Use

Agents are expensive. Most work — fixes, debugging, migrations, lookups, logging changes, and anything confined to `engine/v1/testGame/` — is done directly.

- **ED** — only for a big pass: a **lot** of code **and** multiple engine systems. Both must hold. File count is never the argument, and neither is how delicate the change feels. Never for testGame-only work. On a genuine borderline, ask.
- **ERA / DRYAD** — only after an ED pass, or when the user asks. Never after your own direct edits, and don't offer them afterwards.
- **ARGUS** — functional runtime verification in testGame after significant engine work. Never for visual or content-only changes. Visual sign-off is always the author's.
- **SAGE** — for researching systems in the codebase, initiating docs updates, and logging.
- **RIGOR** — when entity/character model JSON needs to be authored or iterated on in the Simulator App.

**After an ED pass:**

1. If ED changed a significant amount of code (new functions, structural changes), run ERA and DRYAD on it, in parallel.
2. ARGUS:
   - If the change carries no risk of runtime errors or behavior changes, skip it.
   - If ERA or DRYAD flagged genuine issues, report them first. Offer ARGUS only once they're resolved.
   - Otherwise, ask the user before running ARGUS.

**When ARGUS returns bugs:**
- Investigate all reported issues.
- Very simple, self-contained fixes may be applied directly.
- Fixes needing a lot of code across multiple systems go to ED (a full ED pass with ERA/DRYAD follow-up).
- After resolving issues, report to the user: what ARGUS tested, what was found, what was resolved and how, and any bigger architectural issues that were not fixed.
- If no unresolved architectural issues remain but ARGUS did not complete its full test scope (it was blocked), suggest letting ARGUS continue testing now that the blocker is resolved.

## Status Logging

Three files track history outside of git:

- `engine/v1/docs/changelog` — completed engine changes. What changed and where, nothing else. No reasoning, and nothing outside `engine/v1/`. Emptied after a SAGE docs update run.
- `engine/v1/docs/status/DEFERRED.md` — engine work raised or started and consciously postponed. Not general backlog ideas; those go in `engine/v1/docs/todo`.
- `engine/v1/docs/status/AGENT_LOG.md` — findings, outcomes and reasoning (why, rejected alternatives, root causes, measurements) for all SloppyCarlGames work, including testGame and main-agent passes (`MAIN`). Emptied every friday at 9 PM.

SAGE is the only agent that writes to these files. The main agent never edits them directly.

**Resolved DEFERRED entries get deleted, not annotated.** SAGE sweeps `## Pending` on every `log` call and deletes what the pass resolved. Any agent may also delete a resolved entry at any time — there is no "I don't have access" here. An entry that has been resolved and left standing is a bug in the log, so if you notice one, remove it; do not report it to the user as something you cannot touch. Verify against source before deleting.

**What qualifies as deferred.** Only pass something to SAGE as a deferral if it was actually raised and postponed during the pass. Missing-but-out-of-scope qualifies. **Explicitly disabled does not** — a hardcoded `false`, a flag left off, or a capability a design deliberately withholds is a decision already made, not work waiting to happen. `buoyancy: false` in `physicsFlagsFor` is disabled, not deferred. If you cannot point to where something was considered and pushed off, it is not a deferral: treat an unexplained absence as intentional until source proves otherwise, and if it still looks wrong, ask rather than logging it. A speculative entry is worse than no entry — it bloats the file and reads as a real obligation.

**When to log:** once per real checkpoint — a shipped change, an agent run (log each agent's actions), or a discussion that settles a significant design decision. Batch a multi-turn discussion into one log when it resolves. Don't log individual Q&A turns, trivial fixes, one-line crash fixes, or reviews of the author's own drafts. Do this automatically; don't wait for the user to ask.

**How to log:** invoke SAGE via `Skill` tool with `skill: "sage"` and argument `log <raw facts>`. Pass the facts as they actually happened — what was done, by which agent if any, the outcome, and anything deferred and why. Let SAGE decide which file(s) apply and how to phrase/format the entry; do not pre-format entries yourself.

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

**Engine and game source only** — `.js` and payload/data `.json` under `engine/v1/`. Never count documentation: nothing under `engine/v1/docs/`, and no `.md` file anywhere. Doc line counts carry no information and must not appear in the table or the summary.

**Summarize the engine work, not the paperwork.** The end-of-pass summary is about what changed in the engine — what was built, what broke, what was decided. A docs/logging pass is a footnote at most; if a pass touched only docs, say so in one line and skip the table entirely.

Report this at the end of any response where source files were edited.

**A SAGE call is never the last thing in a pass.** SAGE runs inline, so its output lands in the response as if it were yours. Left last, its docs report becomes the entire summary and buries the engine work. Call SAGE, then write the engine summary and the source line-count table *after* it, and cut SAGE's report down to a line or two on the way past. If a response would otherwise end on documentation, it is wrong — fix it before sending, not next pass.

**Never report on documentation content.** What went into the changelog, which DEFERRED entries were deleted and on what evidence, which stale line anchors were corrected, how many pending entries remain — none of this reaches the user. It is bookkeeping, it lives in the files, and reporting it wastes the user's time. State that logging happened, in one line, and move on.

## Node.js Bash Checks — Limitations

`node --check <file>` (syntax checking) works on any engine module and should be used after edits.
Please separate these checks from any other bash commands, and do them per module so I can grant project-wide permission. Ensure to use a local path for these commands, NOT the global one.

There is no `"type": "module"` package.json, so `node --check` parses engine files as CommonJS and misses module-only errors such as a stray top-level `return`. After multi-line edits, or before a browser run, also copy each changed file to a `.mjs` file in the scratchpad and `node --check` that copy.

**Importing or executing engine modules in Node does not work** and must not be attempted. Two permanent blockers:
1. **Browser APIs** — `localStorage`, `sessionStorage`, WebGL (`gl.*`), `createImageBitmap`, etc. are referenced at module scope throughout the engine.
2. **Module load cycle** — `config.js` (and others) instantiate `Unit` at the top level while `Utilities.js` hasn't finished initializing, causing a TDZ crash on any import chain that reaches `config.js` or modules with similar dependencies.

Do not write Node harnesses or attempt `node -e "import(...)"` on engine modules — it will always fail and wastes tokens.

## testGame

`engine/v1/testGame/` is a game, not an engine module. It is exempt from engine module group rules. It interacts with the engine exclusively through the `ENGINE` API exposed by `ini.js`. Do not treat testGame code as engine code.

## Conclusions & Responses

If you can't find evidence that supports a claim, don't make that claim. Just tell me you don't know, what you looked through, and what you think might be going on. But don't present a guess as a real finding.

Prefer asking questions about intended design or actions taken instead of assuming.
