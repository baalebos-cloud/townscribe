import { type CollectionEntry, getCollection } from 'astro:content';
import { PAGE_SIZE } from './consts';

export type Post = CollectionEntry<'blog'>;

/** All articles, newest first. */
export async function getSortedPosts(): Promise<Post[]> {
	const posts = await getCollection('blog');
	return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export function postUrl(post: Post): string {
	return `/blog/${post.id}`;
}

export function pageCount(total: number, size = PAGE_SIZE): number {
	return Math.max(1, Math.ceil(total / size));
}

/** Slice of `items` for 1-based `page`. */
export function pageSlice<T>(items: T[], page: number, size = PAGE_SIZE): T[] {
	return items.slice((page - 1) * size, page * size);
}

/** Up to `limit` posts from the same category, newest first, topped up with latest posts. */
export function relatedPosts(all: Post[], current: { id: string; category: string }, limit = 4): Post[] {
	const others = all.filter((p) => p.id !== current.id);
	const sameCategory = others.filter((p) => p.data.category === current.category);
	const picked = sameCategory.slice(0, limit);
	if (picked.length < limit) {
		for (const p of others) {
			if (picked.length >= limit) break;
			if (!picked.includes(p)) picked.push(p);
		}
	}
	return picked;
}
