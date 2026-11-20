// Checks the article files and CMS config before building.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CATEGORIES, normalizeCategory } from '../src/categories.ts';
import { getYouTubeId } from '../src/youtube-id.ts';

const BLOG_DIR = 'src/content/blog';
const SLUGS = CATEGORIES.map((c) => c.slug);

const articles = readdirSync(BLOG_DIR)
	.filter((f) => /\.mdx?$/.test(f))
	.map((file) => {
		const text = readFileSync(join(BLOG_DIR, file), 'utf8');
		const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
		return { file, fm };
	});

/** Value of a top-level scalar frontmatter key, quotes stripped. */
function field(fm, key) {
	const m = fm.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
	if (!m) return undefined;
	return m[1].trim().replace(/^(['"])(.*)\1$/, '$2');
}

/** Items of a top-level YAML list (block style). */
function listField(fm, key) {
	const m = fm.match(new RegExp(`^${key}:[ \\t]*\\r?\\n((?:[ \\t]*-[^\\n]*\\r?\\n?)+)`, 'm'));
	if (!m) return [];
	return m[1]
		.split(/\r?\n/)
		.map((l) => l.replace(/^[ \t]*-[ \t]*/, '').trim().replace(/^(['"])(.*)\1$/, '$2'))
		.filter(Boolean);
}

/** Local images must exist in public/ and must not be empty files. */
function checkImage(src, file, problems) {
	if (!src || /^https?:\/\//.test(src)) return;
	const path = join('public', decodeURI(src));
	if (!existsSync(path)) problems.push(`${file}: image not found: ${src}`);
	else if (statSync(path).size === 0) problems.push(`${file}: image is an empty file: ${src}`);
}

test('there are articles to build', () => {
	assert.ok(articles.length > 0);
});

test('category list has unique slugs and includes crime, governance and lifestyle', () => {
	assert.equal(new Set(SLUGS).size, SLUGS.length);
	for (const slug of ['crime', 'governance', 'lifestyle']) assert.ok(SLUGS.includes(slug), slug);
});

test('normalizeCategory fixes legacy spellings', () => {
	assert.equal(normalizeCategory(' News '), 'news');
	assert.equal(normalizeCategory('pigin-news'), 'pidgin-news');
	assert.equal(normalizeCategory('Sports'), 'sport');
	assert.equal(normalizeCategory(undefined), '');
});

test('CMS category dropdown matches src/categories.ts', () => {
	const config = readFileSync('public/admin/config.yml', 'utf8');
	const block = config.slice(config.indexOf('name: "category"'), config.indexOf('name: "heroImage"'));
	const cmsValues = [...block.matchAll(/value:\s*"([^"]+)"/g)].map((m) => m[1]);
	assert.deepEqual(cmsValues, SLUGS);
});

test('CMS has a multi-image gallery field', () => {
	const config = readFileSync('public/admin/config.yml', 'utf8');
	assert.match(config, /name: "gallery"\s*\n\s*widget: "list"/);
	assert.match(config, /field: \{ label: "Image", name: "image", widget: "image"/);
});

test('every article has a title, date and a known category', () => {
	const problems = [];
	for (const { file, fm } of articles) {
		if (!field(fm, 'title')) problems.push(`${file}: missing title`);
		const date = field(fm, 'pubDate');
		if (!date || Number.isNaN(new Date(date).valueOf())) problems.push(`${file}: missing or invalid pubDate`);
		const raw = field(fm, 'category');
		if (raw !== undefined && !SLUGS.includes(normalizeCategory(raw))) {
			problems.push(`${file}: unknown category "${raw}"`);
		}
	}
	assert.deepEqual(problems, []);
});

test('hero and gallery images exist in public/', () => {
	const problems = [];
	for (const { file, fm } of articles) {
		checkImage(field(fm, 'heroImage'), file, problems);
		for (const src of listField(fm, 'gallery')) checkImage(src, file, problems);
	}
	assert.deepEqual(problems, []);
});

test('no stray Python environment or partial downloads are committed', () => {
	assert.equal(existsSync('env'), false, 'env/ should not be in the repo');
	const partial = readdirSync('public').filter((f) => f.endsWith('.crdownload'));
	assert.deepEqual(partial, []);
});

test('getYouTubeId understands common YouTube links', () => {
	assert.equal(getYouTubeId('https://www.youtube.com/watch?v=Dys5AFCCH9c&t=30s'), 'Dys5AFCCH9c');
	assert.equal(getYouTubeId('https://youtu.be/Dys5AFCCH9c?si=abc'), 'Dys5AFCCH9c');
	assert.equal(getYouTubeId('https://www.youtube.com/live/Dys5AFCCH9c?feature=share'), 'Dys5AFCCH9c');
	assert.equal(getYouTubeId('https://youtube.com/shorts/Dys5AFCCH9c'), 'Dys5AFCCH9c');
	assert.equal(getYouTubeId('https://m.youtube.com/embed/Dys5AFCCH9c'), 'Dys5AFCCH9c');
	assert.equal(getYouTubeId('Dys5AFCCH9c'), 'Dys5AFCCH9c');
	assert.equal(getYouTubeId('https://www.youtube.com/@townscribeTV'), null);
	assert.equal(getYouTubeId('not a link'), null);
});

test('CMS has a "TV & Live" collection with a live switch', () => {
	const config = readFileSync('public/admin/config.yml', 'utf8');
	assert.match(config, /name: "tv"\s*\n\s*label: "TV & Live"/);
	assert.match(config, /folder: "src\/content\/tv"/);
	assert.match(config, /name: "isLive", widget: "boolean"/);
});

test('every TV post has a valid YouTube link', () => {
	const dir = 'src/content/tv';
	const problems = [];
	for (const file of existsSync(dir) ? readdirSync(dir).filter((f) => /\.mdx?$/.test(f)) : []) {
		const fm = readFileSync(join(dir, file), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
		if (!getYouTubeId(field(fm, 'youtubeUrl'))) problems.push(`${file}: missing or invalid youtubeUrl`);
		checkImage(field(fm, 'thumbnail'), file, problems);
	}
	assert.deepEqual(problems, []);
});

test('vercel.json: www/apex redirect to news.townscribe.org but serve ads.txt and robots.txt directly', () => {
	const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'));
	for (const host of ['www.townscribe.org', 'townscribe.org']) {
		const rule = cfg.redirects.find((r) => r.has?.some((h) => h.type === 'host' && h.value === host));
		assert.ok(rule, `missing redirect for ${host}`);
		assert.equal(rule.permanent, true);
		assert.match(rule.destination, /^https:\/\/news\.townscribe\.org\//);
		// Vercel source "/:path(<regex>)" — turn it into a JS regex to check which paths redirect
		const inner = rule.source.match(/^\/:path\((.*)\)$/)[1].replace(/\\\\/g, '\\');
		const re = new RegExp(`^/(${inner})$`);
		for (const p of ['/ads.txt', '/robots.txt']) assert.equal(re.test(p), false, `${host}${p} must not redirect (AdSense / crawlers)`);
		for (const p of ['/', '/blog/some-story', '/tv']) assert.equal(re.test(p), true, `${host}${p} should redirect`);
	}
});
