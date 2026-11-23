// Finds loop surfaces: terrain that curves smoothly inward from floor to ceiling.

// Used by builder/NewLevel.js to find a level's loops once its terrain chunks are assembled.
// Uses math/Geometry.js to group linked triangles.
// Uses math/Utilities.js to convert angles and instance loop radii.

import { CAMERA_TUNING, CONFIG } from "../../core/config.js";
import { EPSILON, Log } from "../../core/meta.js";
import { FindRoot, JoinRoots, MakeRoots } from "../../math/Geometry.js";
import { DegreesToRadians, Unit } from "../../math/Utilities.js";
import { AngleBetweenVector3, CrossVector3, DotVector3, ResolveVector3Axis, WORLD_NORMALS } from "../../math/Vector3.js";

// Estimate a loop's radius.
function foldRadius(a, b, fold) {
	const edge = ResolveVector3Axis(CrossVector3(a.normal, b.normal));
	const width = (facet) => {
		const reach = [facet.a, facet.b, facet.c].map((point) => DotVector3(point, CrossVector3(edge, facet.normal)));
		return Math.max(...reach) - Math.min(...reach);
	};
	return (width(a) + width(b)) / (4 * Math.tan(fold * 0.5));
}

// Find each medium's loop surfaces in the terrain chunks, and map each tube's centerline by its surface id.
function FindLoops({ pieces, owner, facets, links }, meshes) {
	const started      = performance.now();
	const loopSurfaces = { Air: new Map(), Water: new Map() };
	const loopIncline  = CAMERA_TUNING.Loops.MinCurveThreshold.toRadians();
	const incline      = facets.map((facet) => AngleBetweenVector3(facet.normal, WORLD_NORMALS.Up));

	for (const medium in loopSurfaces) {
		// Join inwards-curving facets up to the medium's ground angle limit.
		const limit  = DegreesToRadians(CONFIG.Physics.Correction.MaxAngleDelta[medium].Ground);
		const smooth = links.filter((l) => l.concave && l.fold <= limit);
		const roots  = MakeRoots(facets.length);

		smooth.forEach(({ a, b }) => JoinRoots(roots, a, b));

		// Only count steep facets on curves with both a floor and ceiling.
		const floors = new Set(), ceilings = new Set();
		incline.forEach((angle, index) => {
			if (angle <= limit) floors.add(FindRoot(roots, index));
			if (angle >= loopIncline) ceilings.add(FindRoot(roots, index));
		});
		const steep = (index) => incline[index] > limit && floors.has(FindRoot(roots, index)) && ceilings.has(FindRoot(roots, index));

		// Group the steep facets. Groups that reach the ceiling count as loops.
		const steepRoots = MakeRoots(facets.length);
		smooth.forEach(({ a, b }) => { if (steep(a) && steep(b)) JoinRoots(steepRoots, a, b); });
		const loopRoots = new Set();
		incline.forEach((angle, index) => {
			if (angle >= loopIncline && steep(index)) loopRoots.add(FindRoot(steepRoots, index));
		});

		// Collect each loop's fold radii.
		const foldRadii = new Map();
		smooth.forEach(({ a, b, fold }) => {
			if (fold <= EPSILON || !steep(a) || !steep(b)) return;
			const root = FindRoot(steepRoots, a);
			if (!foldRadii.has(root)) foldRadii.set(root, []);
			foldRadii.get(root).push(foldRadius(facets[a], facets[b], fold));
		});

		// Take the median fold radius. A loop without folds counts as infinitely wide.
		const loopRadius = (root) => {
			const radii = (foldRadii.get(root) || [Infinity]).sort((x, y) => x - y);
			return radii[Math.floor(radii.length / 2)];
		};

		// Store each surface's tightest loop radius.
		incline.forEach((_, index) => {
			const root = FindRoot(steepRoots, index);
			if (!steep(index) || !loopRoots.has(root)) return;

			const id = pieces[owner[index]].id;
			loopSurfaces[medium].set(id, Math.min(loopSurfaces[medium].get(id) ?? Infinity, loopRadius(root)));
		});
		loopSurfaces[medium].forEach((radius, id) => loopSurfaces[medium].set(id, new Unit(radius, "cnu")));
	}

	// Map centerlines by surface id to tell apart looping tubes vs bending tubes.
	const tubeCenterlines = new Map(
		meshes
			.filter((mesh) => mesh.meta.centerline !== null)
			.map((mesh) => [mesh.id, [mesh.meta.centerline]])
		);
	Log(
		"ENGINE",
		`
			Loop surfaces:
			- Air: ${loopSurfaces.Air.size}
			- Water: ${loopSurfaces.Water.size}
			- Tubes: ${tubeCenterlines.size}
			- Ms: ${(performance.now() - started).toFixed(1)}
		`,
		"log",
		"Level"
	);

	return { loopSurfaces, tubeCenterlines };
}

export { FindLoops };
