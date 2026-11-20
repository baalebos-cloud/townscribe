import rss from '@astrojs/rss';
import { SITE_DESCRIPTION, SITE_TITLE } from '../consts';
import { categoryLabel } from '../categories';
import { getSortedPosts, postUrl } from '../posts';

// Newest 50 stories — feed readers only need recent items.
export async function GET(context) {
	const posts = (await getSortedPosts()).slice(0, 50);
	return rss({
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		site: context.site,
		items: posts.map((post) => ({
			title: post.data.title,
			description: post.data.description,
			pubDate: post.data.pubDate,
			author: post.data.author,
			categories: [categoryLabel(post.data.category)],
			link: postUrl(post),
		})),
	});
}
