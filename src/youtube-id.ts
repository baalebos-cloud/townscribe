// Plain YouTube helpers with no Astro imports (safe to use from content.config.ts and tests).

export const YOUTUBE_CHANNEL_ID = 'UC_Itbf2QhCHs009p5zbEy3w';
export const YOUTUBE_CHANNEL_URL = 'https://www.youtube.com/@townscribeTV';

/** Seconds a non-live video plays on the site before sending viewers to YouTube. */
export const PREVIEW_SECONDS = 15;

/** Extracts the 11-character video id from any common YouTube link (watch, youtu.be, shorts, live, embed). */
export function getYouTubeId(url: string | undefined | null): string | null {
	if (!url) return null;
	const clean = url.trim();
	if (/^[\w-]{11}$/.test(clean)) return clean;
	try {
		const u = new URL(clean);
		const host = u.hostname.replace(/^www\.|^m\./, '');
		if (host === 'youtu.be') return u.pathname.slice(1, 12) || null;
		if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
			const v = u.searchParams.get('v');
			if (v) return v.slice(0, 11);
			const m = u.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]{11})/);
			if (m) return m[1];
		}
	} catch {
		// not a URL
	}
	return null;
}

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const thumbUrl = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
