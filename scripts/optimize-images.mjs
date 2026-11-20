#!/usr/bin/env node
// Shrinks oversized images in place, keeping the same file name and format
// so existing article links keep working.
//
//   node scripts/optimize-images.mjs                 # every image under public/
//   node scripts/optimize-images.mjs a.jpg b.png     # only these files
//   node scripts/optimize-images.mjs --check         # report only, change nothing
//
// An image is rewritten only when it is wider than MAX_WIDTH or larger than
// MIN_BYTES, and the new file is kept only if it is at least 10% smaller.

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import sharp from 'sharp';

const MAX_WIDTH = 1600;
const MIN_BYTES = 400 * 1024;
const EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const SKIP_DIRS = new Set(['admin']);

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const explicit = args.filter((a) => !a.startsWith('--'));

async function walk(dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) out.push(...(await walk(path)));
		} else if (EXTS.has(extname(entry.name).toLowerCase())) {
			out.push(path);
		}
	}
	return out;
}

function encoder(image, ext) {
	switch (ext) {
		case '.png':
			return image.png({ compressionLevel: 9, palette: true, quality: 85, effort: 10 });
		case '.webp':
			return image.webp({ quality: 80, effort: 5 });
		default:
			return image.jpeg({ quality: 80, mozjpeg: true, progressive: true });
	}
}

const kb = (n) => `${Math.round(n / 1024)} KB`;

const files = explicit.length
	? explicit.filter((f) => EXTS.has(extname(f).toLowerCase()))
	: await walk('public');

let saved = 0;
let changed = 0;
let oversized = 0;

for (const file of files) {
	const before = (await stat(file)).size;
	let meta;
	try {
		meta = await sharp(file).metadata();
	} catch (err) {
		console.warn(`skip (unreadable): ${file} — ${err.message}`);
		continue;
	}
	const tooWide = (meta.width ?? 0) > MAX_WIDTH;
	if (!tooWide && before < MIN_BYTES) continue;
	oversized++;

	if (checkOnly) {
		console.log(`oversized: ${file} (${meta.width}px, ${kb(before)})`);
		continue;
	}

	const input = await readFile(file);
	const pipeline = sharp(input, { animated: meta.pages > 1 })
		.rotate() // apply EXIF orientation before metadata is stripped
		.resize({ width: MAX_WIDTH, withoutEnlargement: true });
	const output = await encoder(pipeline, extname(file).toLowerCase()).toBuffer();

	if (output.length <= before * 0.9) {
		await writeFile(file, output);
		saved += before - output.length;
		changed++;
		console.log(`optimized: ${file} ${kb(before)} → ${kb(output.length)}`);
	}
}

if (checkOnly) {
	console.log(`${oversized} oversized image(s) found.`);
} else {
	console.log(`${changed} image(s) optimized, ${(saved / 1024 / 1024).toFixed(1)} MB saved.`);
}
