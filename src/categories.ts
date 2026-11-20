// Single source of truth for news categories.
// The CMS select list in public/admin/config.yml must use the same slugs —
// tests/content.test.mjs fails the build if the two drift apart.

export const CATEGORIES = [
	{ slug: 'news', label: 'News' },
	{ slug: 'politics', label: 'Politics' },
	{ slug: 'governance', label: 'Governance' },
	{ slug: 'crime', label: 'Crime' },
	{ slug: 'business', label: 'Business' },
	{ slug: 'world', label: 'World' },
	{ slug: 'sport', label: 'Sport' },
	{ slug: 'entertainment', label: 'Entertainment' },
	{ slug: 'lifestyle', label: 'Lifestyle' },
	{ slug: 'health', label: 'Health' },
	{ slug: 'technology', label: 'Technology' },
	{ slug: 'articles', label: 'Articles' },
	{ slug: 'pidgin-news', label: 'Pidgin News' },
	{ slug: 'job', label: 'Job' },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]['slug'];

export const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug) as [CategorySlug, ...CategorySlug[]];

// Old or misspelled values that already exist in published articles.
const ALIASES: Record<string, CategorySlug> = {
	'pigin-news': 'pidgin-news',
	'pidgin news': 'pidgin-news',
	pidgin: 'pidgin-news',
	sports: 'sport',
};

export function normalizeCategory(value: unknown): string {
	const cleaned = String(value ?? '').trim().toLowerCase();
	return ALIASES[cleaned] ?? cleaned;
}

export function categoryLabel(slug: string): string {
	return CATEGORIES.find((c) => c.slug === slug)?.label ?? slug;
}
