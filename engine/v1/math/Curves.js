import { AddVector3, SubtractVector3, ScaleVector3, DotVector3, CrossVector3, LerpVector3, ResolveVector3Axis } from "./Vector3.js";

const easings = {
	linear:    (t) => t,
	easeIn:    (t) => t * t,
	easeOut:   (t) => t * (2 - t),
	easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2),
};

const ApplyEasing = (name, t) => easings[name](t);

// Rounds the corner between unit dirs forward/backward into segments+1 centerline points {x,y,z};
// smoothness 0 -> hard V through the apex, 1 -> quadratic curve, collinear input -> straight (§3.3).
function SampleConnectorCenterline(startCenter, forward, endCenter, backward, smoothness, segments) {
	const toEnd = SubtractVector3(endCenter, startCenter);
	const toStart = SubtractVector3(startCenter, endCenter);
	const qa = AddVector3(startCenter, ScaleVector3(forward, DotVector3(toEnd, forward)));
	const qb = AddVector3(endCenter, ScaleVector3(backward, DotVector3(toStart, backward)));
	const apex = ScaleVector3(AddVector3(qa, qb), 0.5);

	const points = [];
	for (let index = 0; index <= segments; index++) {
		const t = index / segments;
		const polyline = t < 0.5
			? LerpVector3(startCenter, apex, t * 2)
			: LerpVector3(apex, endCenter, (t - 0.5) * 2);
		const oneMinusT = 1 - t;
		const bezier = AddVector3(
			AddVector3(
				ScaleVector3(startCenter, oneMinusT * oneMinusT),
				ScaleVector3(apex, 2 * oneMinusT * t)
			),
			ScaleVector3(endCenter, t * t)
		);
		points.push(LerpVector3(polyline, bezier, smoothness));
	}
	return points;
}

// Twist-free (rotation-minimizing) frames along points from initialNormal, via branch-free double
// reflection (Wang et al. 2008). Returns { tangent, normal, binormal } per point.
function ParallelTransportFrames(points, initialNormal) {
	const tangentAt = (index) => {
		const anchor = Math.min(index, points.length - 2);
		return ResolveVector3Axis(SubtractVector3(points[anchor + 1], points[anchor]));
	};

	let tangent = tangentAt(0);
	let normal = ResolveVector3Axis(SubtractVector3(initialNormal, ScaleVector3(tangent, DotVector3(initialNormal, tangent))));
	const frames = [{ tangent, normal, binormal: CrossVector3(tangent, normal) }];

	for (let index = 1; index < points.length; index++) {
		const nextTangent = tangentAt(index);
		const v1 = SubtractVector3(points[index], points[index - 1]);
		const c1 = DotVector3(v1, v1);
		const reflectedNormal = SubtractVector3(normal, ScaleVector3(v1, (2 / c1) * DotVector3(v1, normal)));
		const reflectedTangent = SubtractVector3(tangent, ScaleVector3(v1, (2 / c1) * DotVector3(v1, tangent)));
		const v2 = SubtractVector3(nextTangent, reflectedTangent);
		const c2 = DotVector3(v2, v2);
		const nextNormal = ResolveVector3Axis(SubtractVector3(reflectedNormal, ScaleVector3(v2, (2 / c2) * DotVector3(v2, reflectedNormal))));
		frames.push({ tangent: nextTangent, normal: nextNormal, binormal: CrossVector3(nextTangent, nextNormal) });
		tangent = nextTangent;
		normal = nextNormal;
	}
	return frames;
}

export { ApplyEasing, SampleConnectorCenterline, ParallelTransportFrames };
