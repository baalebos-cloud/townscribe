// Checks the generated site. Run after `npm run build`.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CATEGORIES } from '../src/categories.ts';

const OUT = ['.vercel/output/static', 'dist/client', 'dist'].find((d) => existsSync(join(d, 'index.html')));
const PAGE_SIZE = 24;

const read = (path) => readFileSync(join(OUT, path), 'utf8');
const count = (html, re) => (html.match(re) ?? []).length;

test('build output exists', () => {
	assert.ok(OUT, 'run `npm run build` first');
});

const articleDirs = OUT ? readdirSync(join(OUT, 'blog')).filter((d) => d !== 'page' && existsSync(join(OUT, 'blog', d, 'index.html'))) : [];
const articleCount = readdirSync('src/content/blog').filter((f) => /\.mdx?$/.test(f)).length;

test('every article has a built page', { skip: !OUT }, () => {
	assert.equal(articleDirs.length, articleCount);
});

test('article pages have exactly one title, description, canonical and robots tag', { skip: !OUT }, () => {
	const problems = [];
	for (const dir of articleDirs) {
		const html = read(join('blog', dir, 'index.html'));
		const counts = {
			title: count(html, /<title>/g),
			description: count(html, /<meta name="description"/g),
			canonical: count(html, /rel="canonical"/g),
			robots: count(html, /<meta name="robots"/g),
		};
		for (const [tag, n] of Object.entries(counts)) if (n !== 1) problems.push(`${dir}: ${n} ${tag} tags`);
		if (!html.includes('"@type":"NewsArticle"')) problems.push(`${dir}: missing NewsArticle JSON-LD`);
	}
	assert.deepEqual(problems.slice(0, 10), []);
});

test('no fake reaction counters and no trailing-slash article links', { skip: !OUT }, () => {
	const html = read(join('blog', articleDirs[0], 'index.html'));
	assert.equal(count(html, /reaction-btn/g), 0);
	assert.equal(count(html, /href="\/blog\/[^"]+\/"/g), 0);
});

test('sitemap lists every article and robots.txt points to it', { skip: !OUT }, () => {
	const sitemap = read('sitemap.xml');
	assert.match(sitemap, /^<\?xml/);
	assert.equal(count(sitemap, /<loc>https:\/\/news\.townscribe\.org\/blog\/[^<]+<\/loc>/g) >= articleCount, true);
	assert.match(read('robots.txt'), /Sitemap: https:\/\/news\.townscribe\.org\/sitemap\.xml/);
	assert.equal(existsSync(join(OUT, 'sitemap-index.xml')), false);
});

test('every category has a page, including crime, governance and lifestyle', { skip: !OUT }, () => {
	for (const { slug } of CATEGORIES) {
		assert.ok(existsSync(join(OUT, 'category', slug, 'index.html')), `missing /category/${slug}`);
	}
});

test('listing pages are paginated', { skip: !OUT }, () => {
	const home = read('index.html');
	const homeCards = count(home, /<li[^>]*>\s*<a href="\/blog\//g);
	assert.ok(homeCards > 0 && homeCards <= PAGE_SIZE, `homepage shows ${homeCards} cards`);
	const pages = Math.ceil(articleCount / PAGE_SIZE);
	if (pages > 1) assert.ok(existsSync(join(OUT, 'blog', 'page', String(pages), 'index.html')));
	const news = read(join('category', 'news', 'index.html'));
	assert.ok(count(news, /<li[^>]*>\s*<a href="\/blog\//g) <= PAGE_SIZE);
});

test('standalone pages do not carry article widgets', { skip: !OUT }, () => {
	for (const page of ['about', 'contact', 'privacy-policy', 'terms-of-service', 'profile', 'bookmarks']) {
		const html = read(join(page, 'index.html'));
		assert.equal(count(html, /id="remark42"/g), 0, `${page} has comments`);
		assert.equal(count(html, /Related News/g), 0, `${page} has related news`);
	}
	assert.match(read(join('profile', 'index.html')), /<meta name="robots" content="noindex/);
});

test('search-console verification file is published', { skip: !OUT }, () => {
	assert.ok(existsSync(join(OUT, 'u77yi2vlztxiq8zuij3uduneujlc8d.html')));
});
