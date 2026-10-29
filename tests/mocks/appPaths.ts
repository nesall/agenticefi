/** Isolated component SSR tests have no SvelteKit virtual runtime or base path. */
export function resolve(path: string, params: Record<string, string> = {}): string {
	return path.replace(/\[([^\]]+)\]/g, (_, key: string) => encodeURIComponent(params[key]));
}
