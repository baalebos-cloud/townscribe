import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { CATEGORY_SLUGS, normalizeCategory } from './categories';

const blog = defineCollection({
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),

	// Field names match the Decap CMS form in public/admin/config.yml
	schema: z.object({
		title: z.string(),
		description: z.string(),
		pubDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(),
		heroImage: z.string().optional(),
		// Extra photos shown as a gallery under the article body
		gallery: z.array(z.string()).optional(),
		author: z.string().default('TownScribe Staff'),
		// Trims, lowercases and fixes legacy spellings, then rejects unknown categories
		category: z.string().default('news').transform(normalizeCategory).pipe(z.enum(CATEGORY_SLUGS)),
		seoTitle: z.string().optional(),
		seoDescription: z.string().optional(),
		seoKeyword: z.string().optional(),
		// Optional YouTube preview embedded at the top of the article
		youtubeUrl: z.string().optional(),
	}),
});

export const collections = { blog };
