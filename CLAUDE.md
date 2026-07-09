# Engine V1 — Development Instructions

This project's active codebase is `engine/v1/`. All rule documents live in `engine/v1/docs/rules/`. Read the rules that govern any module you touch before making changes. Read only the rules relevant to the module being edited — not all rules at once — unless doing a broad review.

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

- Keep messages short and descriptive: `Log("ENGINE", "converting player position to world units", "debug", "Camera")`.
- Source is either "ENGINE" or "GAME"
- Use a channel that matches the subsystem being worked on. Check config.js to ensure the channel is supported. A non-supported channel is silently ignored.
- Avoid logging inside hot loops unless temporarily needed to isolate a bug.
- Remove debug-only logs after the issue is resolved unless they provide ongoing diagnostic value.

## Custom Agents and Skills

**Custom agents** run in an isolated context window, invoked via the `Agent` tool with `subagent_type`. They have no access to the current conversation — pass all necessary context in the `prompt` parameter. ERA and DRYAD can run in parallel.

**Skills** load inline into the current conversation, invoked via the `Skill` tool. They share the current conversation's context and tool calls appear in the main thread.

### Custom Agents — `Agent` tool, `subagent_type: "<name>"`

- **`era`** — Engine Rules Auditor. Audits engine/v1/ for rule violations. Add "fixes authorized" to the prompt to allow edits; "rule updates authorized" to allow rule doc edits.
- **`dryad`** — DRY Agent for Deduplication. Identifies duplication, unnecessary complexity, and performance issues. Add "implementation authorized" to allow edits.
- **`ed`** — Engine Developer. Full implementation authority. Pass a concrete task description as the prompt. ED is hard-blocked from destructive or risky shell commands (git mutations like `checkout`/`reset`/`restore`, and bulk/in-place data rewrites or file deletes) — it returns any such operation to you with an explanation instead of running it. Prefer to perform risky data/JSON operations (reverts, wholesale transforms, deletions) yourself rather than delegating them to ED, and never ask ED to undo work via git.

### Skills — `Skill` tool, `skill: "<name>"`

- **`argus`** — Automated Runtime Game-testing & User Simulation. Browser-based testing via MCP chrome-devtools. Invoked by main Claude after ED completes — never by ED itself.
- **`sage`** — System Analysis for Game Engines. Designated as 'engine librarian'. Writes and maintains engine documentation (`system_map/`, `structure.txt`, rule doc descriptive content) and is the sole writer for the status logs (`engine/v1/docs/changelog`, `engine/v1/docs/status/DEFERRED.md`, `engine/v1/docs/status/AGENT_LOG.md`). Also answers Q&A questions about the engine. Invoke with a question, `init map`, `update map for <system>`, or `log <raw facts>` to record a change/deferral/agent outcome — see "Status Logging" below.
- **`rigor`** — Rig Iteration & Geometric Output Review. Authors and edits entity/character model JSON, then visually verifies the result in the Simulator App. Runs inline, retaining full context across iteration passes. Invoke when entity model JSON needs to be authored, adjusted, or visually inspected.

## Autonomous Agent and Skill Use

Use judgment — small fixes, debugging, and code migrations do not warrant agents. Feature additions, refactors, and research can warrant agents.

**When to invoke autonomously:**

- **ED** — When new functionality is being implemented (new features, non-trivial extensions to existing systems or notable refactors). Invoke via `Agent` tool with `subagent_type: "ed"`.
- **DRYAD** — When any task involves performance, deduplication, line count reduction, or efficiency concerns. Invoke via `Agent` tool with `subagent_type: "dryad"`. Large additions or refactors should always be reviewed.
- **ERA** — When the task involves rule adherence, compliance review, or you are uncertain whether a change satisfies engine rules. Invoke via `Agent` tool with `subagent_type: "era"`. Large additions or refactors should always be reviewed.
- **ARGUS** — When browser-based verification is needed (changes that may cause runtime errors, behavioral changes, or visual changes). Invoke via `Skill` tool with `skill: "argus"`. Invoked by main Claude after ED's turn ends — never by ED itself. See post-ED rules below.
- **SAGE** — When researching systems in the codebase. Invoke via `Skill` tool with `skill: "sage"`. Invoked by main Claude during codebase exploration.
- **RIGOR** — When entity/character model JSON needs to be authored, iterated on, or visually verified in the Simulator App. Invoke via `Skill` tool with `skill: "rigor"`.

**Post-ED audit requirement:**

After any ED pass that results in a significant amount of new or edited code — judged by scope (new functions, structural changes, multi-file edits) rather than a fixed line count — invoke both ERA and DRYAD as custom agents on the changed code. ERA and DRYAD can run in parallel.

After ERA and DRYAD return, apply the following ARGUS rules:
- If ERA and DRYAD both returned clean (no genuine violations): invoke ARGUS via the `Skill` tool to verify the change in the browser.
- If ERA and/or DRYAD flagged genuine issues: report the findings to the user and note that ARGUS will run once those findings have been reviewed. Do not invoke ARGUS until the issues are resolved.
- If browser verification is not warranted for the change (no risk of runtime errors, behavioral changes, or visual changes), skip ARGUS regardless of audit results.

**When ARGUS returns bugs:**
- Investigate all reported issues.
- Very simple, self-contained fixes may be applied autonomously.
- Fixes that may affect multiple modules or systems must be handled by ED (treated as a full ED pass with ERA/DRYAD follow-up).
- After resolving issues, report to the user: what ARGUS tested, what was found, what was resolved and how, and any bigger architectural issues that were not fixed.
- If no unresolved architectural issues remain but ARGUS did not complete its full test scope (it was blocked), suggest letting ARGUS continue testing now that the blocker is resolved.

**What does not require agents:**

Small isolated fixes (may still call ARGUS), debugging sessions, logging changes, code migrations (e.g. moving a declaration between files), and one-off lookups. These are handled directly.

## Status Logging

Three files track engine history outside of git: `engine/v1/docs/changelog` (completed changes, what/why/where), `engine/v1/docs/status/DEFERRED.md` (work raised or started and consciously postponed — not general backlog ideas, those go in `engine/v1/docs/todo`), and `engine/v1/docs/status/AGENT_LOG.md` (custom-agent runs that produced a real finding, fix, or outcome).

SAGE is the only agent that writes to these files. The main agent never edits them directly.

**When to check:** at the end of any pass that involved a code change, a custom-agent invocation, or a substantive design discussion — even if no code changed. Decide whether anything meaningful happened that belongs in one or more of the three files. Do not log routine invocations, trivial fixes, or discussions that didn't reach a decision. Do this automatically; don't wait for the user to ask.

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

Report this at the end of any response where files were edited.

## Node.js Bash Checks — Limitations

`node --check <file>` (syntax checking) works on any engine module and should be used after edits.

**Importing or executing engine modules in Node does not work** and must not be attempted. Two permanent blockers:
1. **Browser APIs** — `localStorage`, `sessionStorage`, WebGL (`gl.*`), `createImageBitmap`, etc. are referenced at module scope throughout the engine.
2. **Module load cycle** — `config.js` (and others) instantiate `Unit` at the top level while `Utilities.js` hasn't finished initializing, causing a TDZ crash on any import chain that reaches `config.js` or modules with similar dependencies.

These are structural, not fixable with shims. **ARGUS (browser) is the only runtime verification path.** Do not write Node harnesses or attempt `node -e "import(...)"` on engine modules — it will always fail and wastes tokens.

## testGame

`engine/v1/testGame/` is a game, not an engine module. It is exempt from engine module group rules. It interacts with the engine exclusively through the `ENGINE` API exposed by `ini.js`. Do not treat testGame code as engine code.

## Conclusions & Responses

If you can't find evidence that supports a claim, don't make that claim. Just tell me you don't know, what you looked through, and what you think might be going on. But don't present a guess as a real finding.

Prefer asking questions about intended design or actions taken instead of assuming.
