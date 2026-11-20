// YouTube helpers: link parsing, the channel's public upload feed, and the
// combined list of videos shown on /tv and the homepage.
import { getCollection, type CollectionEntry } from 'astro:content';

import { YOUTUBE_CHANNEL_ID, getYouTubeId, thumbUrl, watchUrl } from './youtube-id';

export { PREVIEW_SECONDS, YOUTUBE_CHANNEL_URL, getYouTubeId, thumbUrl, watchUrl } from './youtube-id';

export interface Video {
	id: string;
	title: string;
	published: Date;
	thumbnail: string;
	/** Where "Watch" sends people: an article/TV page on our site, or YouTube */
	href: string;
	/** Full YouTube link for the redirect after the preview */
	youtubeUrl: string;
	live: boolean;
	summary?: string;
}

const decode = (s: string) =>
	s
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'");

/** Cuts text at a word boundary and adds an ellipsis. */
function shorten(text: string, max: number): string {
	const clean = text.replace(/\s+/g, ' ').trim();
	if (clean.length <= max) return clean;
	return clean.slice(0, clean.lastIndexOf(' ', max)).replace(/[,.;:!?-]+$/, '') + '…';
}

let feedCache: Promise<Video[]> | undefined;

/**
 * Latest uploads from the channel's public RSS feed (no API key needed).
 * Fetched once per build. If YouTube is unreachable the build still succeeds
 * with an empty list. Set SKIP_YOUTUBE_FEED=1 to build offline.
 */
export function getChannelVideos(): Promise<Video[]> {
	feedCache ??= (async () => {
		if (process.env.SKIP_YOUTUBE_FEED) return [];
		try {
			const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`, {
				signal: AbortSignal.timeout(10_000),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const xml = await res.text();
			return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap(([, entry]) => {
				const id = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
				if (!id) return [];
				const title = decode(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
				const published = new Date(entry.match(/<published>([^<]+)<\/published>/)?.[1] ?? 0);
				const summary = shorten(decode(entry.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] ?? ''), 200);
				return [{ id, title, published, thumbnail: thumbUrl(id), href: `/tv?v=${id}`, youtubeUrl: watchUrl(id), live: false, summary }];
			});
		} catch (err) {
			console.warn(`[youtube] could not load channel feed: ${(err as Error).message}`);
			return [];
		}
	})();
	return feedCache;
}

export type TvPost = CollectionEntry<'tv'>;

export async function getTvPosts(): Promise<TvPost[]> {
	const posts = await getCollection('tv');
	return posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export const tvPostUrl = (post: TvPost) => `/tv/${post.id}`;

function tvPostToVideo(post: TvPost): Video | null {
	const id = getYouTubeId(post.data.youtubeUrl);
	if (!id) return null;
	return {
		id,
		title: post.data.title,
		published: post.data.pubDate,
		thumbnail: post.data.thumbnail || thumbUrl(id),
		href: tvPostUrl(post),
		youtubeUrl: post.data.youtubeUrl.trim(),
		live: post.data.isLive,
		summary: post.data.description,
	};
}

/** Live programmes first, then CMS TV posts and channel uploads merged newest-first (no duplicates). */
export async function getAllVideos(): Promise<Video[]> {
	const [posts, feed] = await Promise.all([getTvPosts(), getChannelVideos()]);
	const fromCms = posts.map(tvPostToVideo).filter((v): v is Video => v !== null);
	const seen = new Set(fromCms.map((v) => v.id));
	const merged = [...fromCms, ...feed.filter((v) => !seen.has(v.id))];
	return merged.sort((a, b) => Number(b.live) - Number(a.live) || b.published.valueOf() - a.published.valueOf());
}
