// Place any global data in this file.
// You can import this data from anywhere in your site by using the `import` keyword.

export const SITE_TITLE = 'Townscribe Media';
export const SITE_DESCRIPTION =
	'TownScribe Media — Nigerian and world news on politics, governance, crime, business, sport and lifestyle.';

// Cloudflare Worker endpoints used by the browser
export const AUTH_API = 'https://townscribe-auth.jayeolaoluwadamilare.workers.dev';
// Sends news alerts; also the source of the alert signing (VAPID) key
export const PUSH_API = 'https://townscribe-push-worker.jayeolaoluwadamilare.workers.dev';
export const VIEW_COUNTER_API = 'https://townscribe-view-counter.jayeolaoluwadamilare.workers.dev';
export const COMMENTS_HOST = 'https://comments.townscribe.org';

export const DEFAULT_IMAGE = '/townscribe-img.jpg';

// Number of articles per listing page (home, /blog, categories)
export const PAGE_SIZE = 24;

// Official TownScribe social accounts (header, footer, menu, article pages, search-engine data)
export const SOCIAL_LINKS = [
	{ id: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/share/1CieW6ZMmJ/' },
	{ id: 'whatsapp', label: 'WhatsApp Channel', url: 'https://www.whatsapp.com/channel/0029Vb865S8EquiIRgAM9A1q' },
	{ id: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/townscribenews' },
	{ id: 'x', label: 'X (Twitter)', url: 'https://x.com/townscribenews' },
	{ id: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@townscribeTV' },
] as const;

export type SocialId = (typeof SOCIAL_LINKS)[number]['id'];
export const WHATSAPP_CHANNEL_URL = SOCIAL_LINKS.find((s) => s.id === 'whatsapp')!.url;

// Site developer credit (footer link + "creator" in the site's structured data for search engines)
export const DEVELOPER = {
	name: 'Oluwadare Jayeola',
	url: 'https://github.com/baalebos-cloud',
	sameAs: ['https://github.com/baalebos-cloud', 'https://www.linkedin.com/in/oluwadare-jayeola-6874591b4'],
} as const;
