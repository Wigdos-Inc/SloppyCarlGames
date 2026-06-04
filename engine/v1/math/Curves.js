// Easing curves for animation timeline segments.
// Each function shapes a normalized segment position t (0..1); callers supply a canonical
// easing name (validated enum at normalization) so the lookup is guaranteed.

const easings = {
	linear:    (t) => t,
	easeIn:    (t) => t * t,
	easeOut:   (t) => t * (2 - t),
	easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2),
};

function ApplyEasing(name, t) {
	return easings[name](t);
}

export { ApplyEasing };
