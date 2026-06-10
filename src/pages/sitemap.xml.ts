import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async ({ site }) => {
  // 1. Fetch your actual blog posts collection dynamically
  const posts = await getCollection('blog');
  
  // Clean trailing slash from base site URL to prevent double slashes
  const baseUrl = site ? site.toString().replace(/\/$/, '') : 'https://news.townscribe.org';
  
  // 2. Base platform utility pages
  const basePages = [
    '',
    '/about',
    '/advertise',
    '/donate',
  ];

  // 3. Complete list of Category Pages mapping perfectly to your routes
  const categories = [
    '/category/news',
    '/category/politics',
    '/category/sports',
    '/category/entertainment',
    '/category/business',
    '/category/articles',
    '/category/pidgin-news',
    '/category/exclusive',
    '/category/technology',
    '/category/health',
    '/category/sport',
    '/category/world',
    '/category/job'
  ];

  // Combine both static sets for uniform processing
  const allStaticRoutes = [...basePages, ...categories];

  // 4. Generate XML tags for base configurations and clean categories
  const pageEntries = allStaticRoutes
    .map(route => `<url><loc>${baseUrl}${route}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`)
    .join('');

  // 5. Generate XML tags for individual blog records
  const blogEntries = posts
    .map(post => {
      // Fallback fallback selector if post.slug is not explicitly assigned by your schema
      const slug = post.slug || post.id || post.data?.slug;
      const postDate = post.data?.pubDate ? new Date(post.data.pubDate).toISOString() : new Date().toISOString();
      
      return `
        <url>
          <loc>${baseUrl}/blog/${slug}</loc>
          <lastmod>${postDate}</lastmod>
          <changefreq>weekly</changefreq>
          <priority>1.0</priority>
        </url>
      `;
    })
    .join('');

  // 6. Assemble complete Document Tree
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      ${pageEntries}
      ${blogEntries}
    </urlset>
  `.trim();

  // 7. Render stream payload straight out to the requesting crawler
  return new Response(sitemapXml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
};
