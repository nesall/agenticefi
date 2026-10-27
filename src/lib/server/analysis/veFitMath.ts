import type {
	FitConditioning,
	FitSolverDiagnostic,
	VeFitConfig
} from '../../shared/types/veFitting';

export type FitObservation = {
	rowIndex: number;
	episodeId: number;
	b: number;
	terms: { cellIndex: number; a: number }[];
};
type WeightedObservation = FitObservation & { weight: number };

export function episodeBalanced(rows: readonly FitObservation[]): WeightedObservation[] {
	const counts = new Map<number, number>();
	for (const row of rows) counts.set(row.episodeId, (counts.get(row.episodeId) ?? 0) + 1);
	return rows.map((row) => ({ ...row, weight: 1 / counts.size / counts.get(row.episodeId)! }));
}

/** Fixed-order cyclic Jacobi eigenvalues of a real symmetric matrix. Numerical
 * failure suppresses a group; ridge is never used to pass the rank test.
 */
function eigenvalues(matrix: number[][]): number[] | null {
	const a = matrix.map((row) => [...row]),
		n = a.length;
	for (let sweep = 0; sweep < 50; sweep++) {
		let maximum = 0;
		for (let p = 0; p < n; p++)
			for (let q = p + 1; q < n; q++) {
				const off = a[p][q];
				maximum = Math.max(maximum, Math.abs(off));
				if (Math.abs(off) <= 1e-12) continue;
				const tau = (a[q][q] - a[p][p]) / (2 * off);
				const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.hypot(1, tau));
				const c = 1 / Math.hypot(1, t),
					s = t * c;
				const app = a[p][p],
					aqq = a[q][q];
				a[p][p] = app - t * off;
				a[q][q] = aqq + t * off;
				a[p][q] = 0;
				a[q][p] = 0;
				for (let k = 0; k < n; k++)
					if (k !== p && k !== q) {
						const kp = a[k][p],
							kq = a[k][q];
						a[k][p] = a[p][k] = c * kp - s * kq;
						a[k][q] = a[q][k] = s * kp + c * kq;
					}
			}
		if (maximum <= 1e-12) {
			const values = a.map((row, i) => row[i]).sort((x, y) => x - y);
			return values.every(Number.isFinite) ? values : null;
		}
	}
	return null;
}

/** Connected groups are formed by any shared positive influence, not by the
 * material-evidence threshold. Includes all rows, with episode-balanced weights.
 */
export function influenceConditioning(
	rows: readonly FitObservation[],
	active: readonly number[],
	config: VeFitConfig
): FitConditioning[] {
	const indices = new Map(active.map((cell, i) => [cell, i]));
	const parent = active.map((_, i) => i);
	const root = (i: number): number => {
		while (parent[i] !== i) i = parent[i];
		return i;
	};
	for (const row of rows) {
		const present = row.terms
			.map((t) => indices.get(t.cellIndex))
			.filter((i): i is number => i !== undefined);
		for (const i of present.slice(1)) parent[root(i)] = root(present[0]);
	}
	const groups = new Map<number, number[]>();
	for (const [i, cell] of active.entries()) {
		const r = root(i);
		if (!groups.has(r)) groups.set(r, []);
		groups.get(r)!.push(cell);
	}
	const weighted = episodeBalanced(rows);
	return [...groups.values()].map((cells) => {
		const local = new Map(cells.map((cell, i) => [cell, i])),
			n = cells.length;
		const gram = Array.from({ length: n }, () => Array(n).fill(0) as number[]);
		for (const row of weighted) {
			const terms = row.terms.filter((t) => local.has(t.cellIndex));
			for (const a of terms)
				for (const b of terms)
					gram[local.get(a.cellIndex)!][local.get(b.cellIndex)!] += row.weight * a.a * b.a;
		}
		const scales = gram.map((row, i) => Math.sqrt(row[i]));
		const normalized = gram.map((row, i) =>
			row.map((value, j) => (scales[i] > 0 && scales[j] > 0 ? value / scales[i] / scales[j] : 0))
		);
		const values = eigenvalues(normalized);
		if (!values)
			return {
				cellIndices: cells,
				rank: 0,
				columns: n,
				conditionNumber: null,
				minEigenvalue: null,
				maxEigenvalue: null,
				status: 'numerical-failure'
			};
		const maximum = Math.max(0, values.at(-1)!),
			minimum = Math.max(0, values[0]);
		const rank = values.filter(
			(v) => v > maximum * config.relativeRankTolerance ** 2 && v > 0
		).length;
		const condition = rank === n && minimum > 0 ? Math.sqrt(maximum / minimum) : null;
		return {
			cellIndices: cells,
			rank,
			columns: n,
			conditionNumber: condition,
			minEigenvalue: minimum,
			maxEigenvalue: maximum,
			status:
				rank < n
					? 'rank-deficient'
					: condition === null || !Number.isFinite(condition)
						? 'numerical-failure'
						: condition > config.maxConditionNumber
							? 'ill-conditioned'
							: 'identifiable'
		};
	});
}

/** Convex box-constrained Huber + ridge, with projected accelerated gradients and
 * monotone restart. Projection occurs within optimization, never after fitting.
 */
export function solveBoundedVe(
	rows: readonly FitObservation[],
	active: readonly number[],
	bound: number,
	config: VeFitConfig
): { values: number[]; diagnostic: FitSolverDiagnostic } {
	const positions = new Map(active.map((cell, i) => [cell, i])),
		n = active.length;
	const data = episodeBalanced(rows).map((row) => ({
		...row,
		terms: row.terms
			.filter((t) => positions.has(t.cellIndex))
			.map((t) => ({ i: positions.get(t.cellIndex)!, a: t.a }))
	}));
	const ridge = config.ridgePenalty / n;
	const lipschitz =
		data.reduce((sum, row) => sum + row.weight * row.terms.reduce((s, t) => s + t.a * t.a, 0), 0) +
		2 * ridge;
	const project = (v: number) => Math.max(-bound, Math.min(bound, v));
	const evaluate = (x: number[]) => {
		const gradient = x.map((v) => 2 * ridge * v);
		let objective = ridge * x.reduce((sum, v) => sum + v * v, 0);
		for (const row of data) {
			const residual = row.terms.reduce((sum, t) => sum + t.a * x[t.i], 0) - row.b;
			const absolute = Math.abs(residual),
				h = config.huberThreshold;
			objective +=
				row.weight * (absolute <= h ? 0.5 * residual * residual : h * (absolute - 0.5 * h));
			const derivative = Math.max(-h, Math.min(h, residual));
			for (const t of row.terms) gradient[t.i] += row.weight * t.a * derivative;
		}
		return { objective, gradient };
	};
	let x = Array(n).fill(0) as number[],
		y = [...x],
		acceleration = 1;
	let state = evaluate(x),
		projectedGradient: number | null = null;
	if (!(lipschitz > 0) || !Number.isFinite(lipschitz))
		return {
			values: x,
			diagnostic: {
				status: 'numerical-failure',
				iterations: 0,
				objective: null,
				projectedGradient: null
			}
		};
	for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
		let extrapolated = evaluate(y);
		let next = y.map((value, i) => project(value - extrapolated.gradient[i] / lipschitz));
		let nextState = evaluate(next);
		if (nextState.objective > state.objective) {
			acceleration = 1;
			extrapolated = state;
			next = x.map((value, i) => project(value - extrapolated.gradient[i] / lipschitz));
			nextState = evaluate(next);
		}
		if (
			!Number.isFinite(nextState.objective) ||
			nextState.gradient.some((v) => !Number.isFinite(v))
		)
			return {
				values: x,
				diagnostic: {
					status: 'numerical-failure',
					iterations: iteration,
					objective: null,
					projectedGradient: null
				}
			};
		projectedGradient = Math.max(
			...next.map((value, i) => Math.abs(value - project(value - nextState.gradient[i])))
		);
		if (projectedGradient <= config.gradientTolerance)
			return {
				values: next,
				diagnostic: {
					status: 'converged',
					iterations: iteration,
					objective: nextState.objective,
					projectedGradient
				}
			};
		const nextAcceleration = (1 + Math.sqrt(1 + 4 * acceleration ** 2)) / 2;
		y = next.map((value, i) => value + ((acceleration - 1) / nextAcceleration) * (value - x[i]));
		x = next;
		state = nextState;
		acceleration = nextAcceleration;
	}
	return {
		values: x,
		diagnostic: {
			status: 'iteration-limit',
			iterations: config.maxIterations,
			objective: state.objective,
			projectedGradient
		}
	};
}
