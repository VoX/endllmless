import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from "vite-plugin-singlefile";

const api = process.env.OPENROUTER_API_KEY ? 'http://localhost:8080' : "https://endless.claw.bitvox.me";

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [preact(), viteSingleFile()],
	server: {
		proxy: {
			'/api': api,
		}
	},
	test: {
		// The reducer is pure data-in/data-out, so the default node environment is
		// enough (no DOM) and we avoid pulling in jsdom/happy-dom.
		environment: 'node',
		globals: true,
		include: ['src/**/*.test.{js,jsx}'],
	},
});
