import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { CATEGORY_SLUGS, normalizeCategory } from './categories';
import { getYouTubeId } from './youtube-id';

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
		// Shows the red BREAKING strip on the homepage for 48 hours after publishing
		breaking: z.boolean().default(false),
		// Optional YouTube preview embedded at the top of the article
		youtubeUrl: z.string().optional(),
	}),
});

// "TV & Live" posts from the CMS: a short write-up plus a YouTube video or live stream
const tv = defineCollection({
	loader: glob({ base: './src/content/tv', pattern: '**/*.{md,mdx}' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		pubDate: z.coerce.date(),
		youtubeUrl: z.string().refine((url) => getYouTubeId(url) !== null, {
			message: 'youtubeUrl must be a YouTube video or live-stream link',
		}),
		// While true the stream plays in full on the site (no redirect) and is pinned at the top
		isLive: z.boolean().default(false),
		thumbnail: z.string().optional(),
		author: z.string().default('TownScribe TV'),
	}),
});

export const collections = { blog, tv };
