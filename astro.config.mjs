// @ts-check

import mdx from '@astrojs/mdx';
import vercel from '@astrojs/vercel';
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://news.townscribe.org',
	// Every page is pre-built at deploy time; nothing needs a server function.
	output: 'static',
	
	// Force Astro to strictly match and generate routes without trailing slashes
	trailingSlash: 'never',

	adapter: vercel({
		webAnalytics: {
			enabled: true,
		},
	}),
	integrations: [mdx()],
	fonts: [
		{
			provider: fontProviders.local(),
			name: 'Atkinson',
			cssVariable: '--font-atkinson',
			fallbacks: ['sans-serif'],
			options: {
				variants: [
					{
						src: ['./src/assets/fonts/atkinson-regular.woff'],
						weight: 400,
						style: 'normal',
						display: 'swap',
					},
					{
						src: ['./src/assets/fonts/atkinson-bold.woff'],
						weight: 700,
						style: 'normal',
						display: 'swap',
					},
				],
			},
		},
	],
});
