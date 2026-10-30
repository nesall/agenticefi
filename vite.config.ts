import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
	// Vite's private env modules do not populate process.env, which our server adapter reads.
	// Load local credentials for dev/preview only; production uses its existing service environment.
	if (
		command === 'serve' &&
		!process.env.META_HACKATHON_API_KEY?.trim() &&
		!process.env.META_API_KEY?.trim()
	) {
		const local = loadEnv(mode, process.cwd(), 'META_');
		for (const key of ['META_HACKATHON_API_KEY', 'META_API_KEY']) {
			if (process.env[key] === undefined && local[key] !== undefined) process.env[key] = local[key];
		}
	}
	return {
		plugins: [
			tailwindcss(),
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},

				adapter: adapter()
			})
		]
	};
});
