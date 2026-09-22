# Entity AI — Pathfinding (Detail)

Companion document to `entity-ai-scope.md` Section 6. Fully resolved; no open items other than the one explicitly noted at the end.

---

## Node generation

- Terrain automatically generates pathfinding nodes on its own surface at **build time**.
- Node placement maintains a clearance distance from obstructions. Where clearance can't be met due to multiple surrounding obstructions, a node is placed at the midpoint between the nearest obstruction pair — this naturally produces layered generation in tight spaces.
- Node adjacency is determined by a visibility check: a straight line between two nearby nodes with nothing obstructing it means they're linked. Computed once at build time.
- Because walkability is a real, queryable build-time classification (see the engine's slope-eligibility tiers), nodes can be placed on any surface that qualifies as walkable — gentle ramps included, not just flat ground. Same linking rules apply regardless of incline.

## Node data model

Every node (including connector/gap nodes) carries:

- `connections` — array of adjacent traversable nodes.
- `type` — `"main"` or `"connector"`. `"main"` further splits into `"open"` (density scales down with performance tier, reducible) and `"corner"` (never reduced by performance settings — exists specifically to route around obstructions, so thinning it risks breaking navigability rather than just degrading quality).
- `parent` — the parent node, if applicable (see Parent/subnode corridors below).
- `parentTerrainPart` — the specific terrain part this node sits on.
- `parentTerrainChunk` — the walkable chunk this node belongs to (see Chunks below).
- `subnodes` — array, may be empty.
- `id` — named after the terrain piece it's on.
- Positional data.
- `maxEntitySize` — the largest entity size that can actually fit through this node, derived from its actual clearance at placement time.

## Walkable chunks and cross-terrain traversal

- Terrain pieces that are physically walkable between each other (touching, or within normal walking range) are first collected into **"walkable chunks."**
- Node generation and adjacency linking then run per chunk, treating each chunk as a unit.

## Gaps between chunks (jump-dependent traversal)

- Nodes may be placed in the empty space between two separate chunks, carrying metadata for the gap distance.
- A pathfinding entity checks whether a jump at its predicted speed/capability can cross that specific distance.
  - If yes: the edge exists in that entity's traversal graph.
  - If no: the edge simply does not exist for that entity — this also correctly handles entities with no jump ability at all, or entities explicitly authored to be chunk-locked (never leaving their own chunk).
- Jump-reachable cross-chunk traversal is a confirmed, included part of the finished system — not excluded or deferred.

## Parent node / subnode corridors

- A tight space (e.g. a narrow alleyway) is represented as a straight line of single-width **subnodes**, forming a "forced path" between two **parent nodes** at the entry and exit of that tight space.
- Subnodes have a lighter connection contract than regular nodes — they don't appear as nodes in the general search graph and carry less metadata.
- The two parent nodes reference each other directly in their own `connections` arrays, as if they were simply adjacent — even though a subnode chain physically separates them. Once that parent-to-parent edge is chosen as part of a path, the actual subnode chain is what the entity walks.
- This is a **corridor-collapsing technique**: a tight passage becomes one cheap edge for high-level path search, only unpacked into its full subnode chain when actually used. (This is the same general technique used in hierarchical pathfinding systems — collapsing corridors into portal-to-portal edges for cheap search.)
- Forced corridors aren't limited to auto-detected tight spaces. Terrain pieces (single- or multi-part) may also **author an explicit array of custom paths** — each with a start coordinate, end coordinate, and a minimum entity size. At build time, the engine scans for obstructions along that authored route and generates a subnode path around them, producing a guaranteed safe A-to-B corridor. This lets a level author manually guarantee a route through complex geometry rather than relying purely on automatic generation.

## Value assignment

- A node's value (0–100) is calculated from two factors: its distance from the direct start-to-destination line, and its distance to the destination itself.
- For a parent-node edge specifically, the value is calculated using the *other* parent's position (not the subnode geometry) as the input to that same formula — so if the far parent sits much closer to the destination (and/or closer to the direct line), that edge is favored and its subnode corridor becomes part of the resulting path.
- This is a **heuristic/positional scoring model, not a cost-accumulation shortest-path model** — it does not track distance already spent reaching a node along the current chain. This is intentional: it biases toward natural-looking, direct-feeling routes over provably-shortest ones.

## Pathfinding types

Entities declare a pathfinding type:

- **Direct** — straight A-to-B, no node graph involved at all.
- **Simple** — the single highest-value chain through the node graph.
- **Dynamic** — like Simple, but randomly chosen from the top 3 highest-value chains.
- **Random** — the chain is built live, node-by-node, "as the entity decides." Anti-backtrack rule: if moving to a node would force an immediate return to the previous node, that previous node is blocked from reselection for the remainder of that path. If every option from the current node is net-negative, the least-negative option is taken.
- **Custom** — handler-based (not event-based; see the main scope document's Section 5.4/7.1 reasoning). The engine needs a concrete return value to act on the same tick, which a handler provides and an event cannot reliably provide.

## Pathfinding algorithm (Simple / Dynamic)

1. Gather nodes within radius of both the start point and the end point. This gathering should be **chunk-scoped** (filter by chunk membership before doing any distance checks) rather than a naive scan of every node in the level — this is an explicit requirement, not an optional optimization.
2. Progressively assign values to the gathered nodes per the Value Assignment rules above.
3. Simple picks the single highest-value chain. Dynamic randomly picks among the top 3 highest-value chains.

Random (above) is constructed live per its own anti-backtrack rule, not selected from pre-scored chains like Simple/Dynamic.

## Performance gating

- **simDistance**: entities outside simDistance do not run full pathfinding. They fall back to Direct, Random, or standing still entirely.
- **Directional caching** (caching a computed path for reuse in the reverse direction) is explicitly **not** a base requirement — the base pathfinding request is already cheap by construction (radius-bounded, heuristic-only, no cost-accumulation, fully build-time node graph). A single entity's own A-to-B then B-to-A, spaced across a patrol cycle, is not a real load concern.
  - Where caching *would* matter is a different axis entirely: many entities sharing the same A/B pair concurrently (cache-across-entities, not cache-across-direction). Not decided whether this is worth pursuing — flagged as a possible future consideration only, not a requirement for this feature.

## Patrol and Chase movement (cross-reference)

- **Patrol**: given an authored patrol area/waypoints, checks direct line-of-sight between consecutive points first (if the entity has collision enabled). Falls back to node-based pathfinding only if that direct line is blocked.
- **Chase**: forces Direct movement while the target remains within direct sight/sense range, overriding whatever pathfinding type the entity has authored. Falls back to the entity's authored pathfinding type when the target is out of that direct range but still being actively pursued.
- **Re-path triggers** (only relevant for node-based pathfinding types — Direct has no re-path concept, since it always aims at the live target position by definition):
  1. **Deviation-threshold trigger** — re-path when the target has moved beyond a threshold distance from the position the current path was originally aimed at.
  2. **Obstruction trigger** — re-path when the current chain becomes physically blocked, independent of target movement (a moving obstacle can block even a stationary target's path).

  Not a pure timer — a timer doesn't track either real cause of staleness (target moved / path became invalid) directly, it only guesses at a cadence.

---

## Open item

None specific to pathfinding itself. (See the main scope document for the one open item in the whole feature — Ally's behavior set beyond Follow.)
