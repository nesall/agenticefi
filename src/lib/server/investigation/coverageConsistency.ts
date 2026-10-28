/** Presentation boundary only: never replace unavailable or contradictory evidence with zero. */
export function assertCoverageSupport(coverage: unknown, fitSupported?: unknown): void {
	if (coverage === null || coverage === undefined) return;
	if (typeof coverage !== 'object' || Array.isArray(coverage))
		throw new Error('Analytical coverage is invalid.');
	const value = coverage as Record<string, unknown>;
	for (const field of ['trainingRows', 'holdoutRows', 'supportedCells', 'totalCells'])
		if (typeof value[field] !== 'number' || !Number.isSafeInteger(value[field]) || value[field] < 0)
			throw new Error('Analytical coverage contains unavailable or invalid counts.');
	if ((value.supportedCells as number) > (value.totalCells as number))
		throw new Error('Analytical supported-cell count exceeds table dimensions.');
	if (fitSupported !== undefined && fitSupported !== value.supportedCells)
		throw new Error(
			'Analytical coverage and fit supported-cell counts disagree; results withheld.'
		);
}
