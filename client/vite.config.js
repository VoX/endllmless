import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from "vite-plugin-singlefile";

const api = process.env.OPENAI_API_KEY ? 'http://localhost:8080' : "https://endless.bitvox.me";

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [preact(), viteSingleFile()],
	server: {
		proxy: {
			'/wordcombine': api,
		}
	}
});
