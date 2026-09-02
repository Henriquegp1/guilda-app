import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		// Remove underline para evitar bloqueios de CDN
		appDir: 'app_ext',
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: undefined,
			precompress: false,
			strict: true
		}),
		paths: {
			// Essencial para Twitch: base vazia + relative faz o app ser "portátil"
			base: '',
			relative: true
		}
	}
};

export default config;
