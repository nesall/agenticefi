import { build } from 'vite';
import { resolve } from 'node:path';

// Reuse the project's existing build dependency. Runtime workers need no TS loader.
await build({
	configFile: false,
	logLevel: 'warn',
	resolve: { alias: [{ find: /^#lib\//, replacement: resolve('src/lib') + '/' }] },
	build: {
		ssr: resolve('src/lib/server/investigation/analyticalWorker.ts'),
		target: 'node22',
		outDir: '.analytical-worker',
		emptyOutDir: false,
		rolldownOptions: {
			output: { format: 'cjs', entryFileNames: 'entry.cjs', codeSplitting: false }
		}
	}
});
