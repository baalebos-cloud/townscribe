import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
	// Keeps your modern content loader configuration intact
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	
	// Combines all your target schema properties, default fallbacks, and the video parameter
	schema: z.object({
		title: z.string(),
		description: z.string(),
		pubDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(),
		heroImage: z.string().optional(),
		author: z.string().default('TownScribe Staff'),
		category: z.string().default('world'),
		seoTitle: z.string().optional(),
		seoDescription: z.string().optional(),
		
		// 👇 Automated YouTube redirect timeline engine parameter hook
		youtubeUrl: z.string().optional(), 
	}),
});

export const collections = { blog };
