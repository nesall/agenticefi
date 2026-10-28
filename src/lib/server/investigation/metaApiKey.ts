/** Server-only credential resolution. The project-specific name takes precedence. */
export function metaApiKey(
	env: Record<string, string | undefined> = process.env
): string | undefined {
	return env.META_HACKATHON_API_KEY?.trim() || env.META_API_KEY?.trim() || undefined;
}
