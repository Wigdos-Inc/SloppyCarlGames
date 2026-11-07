# Agent Log

Running log of notable engine-touching work — not custom agents alone. Valid entry
sources are ERA, DRYAD, ARGUS, RIGOR, ED, SAGE, and MAIN (the main/orchestrating
agent acting directly, without spawning a custom agent). SAGE is responsible for
appending an entry here after any of these produces a meaningful finding or change,
including the main agent's own passes. The weekly status task reads this file and
then empties it (back to this header) after summarizing — so entries only need to
cover "since the last weekly report."

## Entry format

`- [YYYY-MM-DD] AGENT: task — outcome (authorized actions taken, if any)`

Examples:

`- [2026-07-09] DRYAD: reviewed NewObject.js tube refactor — found 1 duplicated matrix-multiply, flagged only (no fix authorized)`
`- [2026-07-09] MAIN: applied a flagged low-severity dedup fix directly — extracted a shared helper, no agent spawned`

## Log

(empty — no entries since last weekly report)
