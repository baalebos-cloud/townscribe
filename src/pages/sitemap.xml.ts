import type { APIRoute } from 'astro';
import { CATEGORIES } from '../categories';
import { PAGE_SIZE } from '../consts';
import { getSortedPosts, pageCount, postUrl } from '../posts';
import { getTvPosts, tvPostUrl } from '../youtube';

// Pre-built at deploy time and served at /sitemap.xml (referenced from robots.txt).
export const GET: APIRoute = async ({ site }) => {
	const base = (site?.toString() ?? 'https://news.townscribe.org').replace(/\/$/, '');
	const posts = await getSortedPosts();
	const tvPosts = await getTvPosts();

	const xmlEscape = (value: string) =>
		value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

	const url = (path: string, opts: { lastmod?: Date; changefreq: string; priority: string }) =>
		`<url><loc>${xmlEscape(base + path)}</loc>${opts.lastmod ? `<lastmod>${opts.lastmod.toISOString()}</lastmod>` : ''}<changefreq>${opts.changefreq}</changefreq><priority>${opts.priority}</priority></url>`;

	const staticPages = ['', '/blog', '/tv', '/about', '/contact', '/privacy-policy', '/terms-of-service'].map((path) =>
		url(path, { changefreq: path === '' || path === '/blog' || path === '/tv' ? 'hourly' : 'monthly', priority: path === '' ? '1.0' : '0.5' }),
	);

	const categoryPages = CATEGORIES.flatMap((category) => {
		const count = posts.filter((p) => p.data.category === category.slug).length;
		const pages = [url(`/category/${category.slug}`, { changefreq: 'daily', priority: '0.7' })];
		for (let n = 2; n <= pageCount(count, PAGE_SIZE); n++) {
			pages.push(url(`/category/${category.slug}/page/${n}`, { changefreq: 'daily', priority: '0.3' }));
		}
		return pages;
	});

	const articlePages = posts.map((post) =>
		url(postUrl(post), { lastmod: post.data.updatedDate ?? post.data.pubDate, changefreq: 'weekly', priority: '0.8' }),
	);

	const tvPages = tvPosts.map((post) => url(tvPostUrl(post), { lastmod: post.data.pubDate, changefreq: 'daily', priority: '0.7' }));

	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...staticPages, ...categoryPages, ...tvPages, ...articlePages].join('\n')}\n</urlset>\n`;

	return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
