# TownScribe

News site for **[news.townscribe.org](https://news.townscribe.org)** — Nigerian and world news on politics, governance, crime, business, sport and lifestyle.

The site is a fully **pre-built Astro site** deployed on **Vercel**. Writers publish through **Decap CMS**; reader features (accounts, bookmarks, push alerts, view counts, comments) are served by small Cloudflare Workers and a self-hosted Remark42 instance that live outside this repository.

---

## How it fits together

```
Writer ──► Decap CMS (admin.townscribe.org/admin, sign-in via DecapBridge)
              │  editorial workflow: each article = branch cms/blog/<slug> + pull request
              ▼
GitHub  baalebos-cloud/townscribe
              │  CI (lint, type-check, content tests, build)  ← .github/workflows/ci.yml
              │  image compression on CMS pull requests       ← .github/workflows/optimize-images.yml
              │  merge to main
              ▼
Vercel  astro build ──► static HTML for every page ──► news.townscribe.org
              │
              └─► push alert to subscribers for *new* articles ← .github/workflows/notify.yml

Browser ──► Cloudflare Workers
              ├─ townscribe-auth        accounts, bookmarks, push subscriptions
              ├─ townscribe-push-worker web push delivery (VAPID)
              └─ townscribe-view-counter article view counts
         └─► comments.townscribe.org (Remark42 behind Cloudflare Tunnel)
```

### Tech stack

| Layer | Technology |
|-------|-----------|
| Site generator | Astro 6, `output: 'static'` (every page pre-built at deploy) |
| Hosting | Vercel (`@astrojs/vercel` adapter, Vercel Web Analytics) |
| Content | Markdown in `src/content/blog`, edited through Decap CMS 3 + DecapBridge |
| Reader accounts & bookmarks | Cloudflare Worker + D1 |
| Push notifications | Web Push + VAPID, Cloudflare Worker + KV |
| View counts | Cloudflare Worker |
| Comments | Remark42 (Oracle Cloud VM, exposed via Cloudflare Tunnel) |
| Ads | Google AdSense + Funding Choices |

---

## Project layout

```
src/
  categories.ts         single list of news categories (slugs + labels)
  consts.ts             site title/description, Worker URLs, page size
  posts.ts              helpers: sorted posts, URLs, pagination, related posts
  content.config.ts     article schema (validated at build time)
  content/blog/         articles (one Markdown file each)
  content/tv/           TV & Live posts from the CMS
  youtube.ts            channel feed + combined video list
  youtube-id.ts         YouTube link parsing, preview length
  layouts/
    BaseLayout.astro    page shell: <head>, header, footer
    Page.astro          About, Contact, legal and account pages
    Listing.astro       paginated article grids (/blog, /category/*)
    BlogPost.astro      article page: hero, body, gallery, ads, comments
  components/           BaseHead (all SEO tags), Header, Footer, PostGrid, Pagination, …
  pages/
    index.astro                         homepage (latest 24 stories)
    blog/index.astro, blog/page/[page]  all news, 24 per page
    blog/[...slug].astro                one page per article
    category/[category]/…               category pages, 24 per page
    tv/index.astro, tv/[...slug].astro  TownScribe TV page and TV & Live posts
    sitemap.xml.ts, rss.xml.js          sitemap and RSS feed
public/
  admin/                Decap CMS (index.html + config.yml)
  images/uploads/       new CMS uploads
  *.jpg|png|webp        images uploaded before Nov 2026
scripts/
  optimize-images.mjs   shrinks oversized images in place
tests/                  node:test suites run in CI
```

### Design

All colours, fonts and the page width are tokens at the top of `src/styles/global.css` (light values, then dark values). The site follows the reader's device setting until they press the ☀️/🌙 switch in the header; that choice is saved in their browser (`ts_theme`). Headlines use Archivo, interface text Inter, and article text Source Serif 4 (Google Fonts). Use `var(--red)` only for LIVE, BREAKING and hover states; section labels use `.kicker` (gold). Wrap page content in `.wrap` for the standard width and side gutters.

- **Breaking news:** the CMS "Breaking news" switch puts a red BREAKING strip on the homepage for 48 hours after the story's publish time.
- **Homepage sections** appear automatically for categories with at least four more stories than the top block shows.

### Categories

Categories are defined once in `src/categories.ts`. The CMS dropdown in `public/admin/config.yml` must list the same slugs; `npm test` fails if they drift apart. To add a category, add it in both places — the header menu, category pages and sitemap pick it up automatically.

### TownScribe TV and live programmes

- `/tv` lists the newest videos from the [@townscribeTV](https://www.youtube.com/@townscribeTV) YouTube channel (read from its public RSS feed at build time) together with **TV & Live** posts from the CMS. The homepage shows the latest four.
- Videos play a **15-second preview** on the site (`PREVIEW_SECONDS` in `src/youtube-id.ts`), show a 5-second countdown, then continue on YouTube from the same point.
- **TV & Live** posts (CMS → "TV & Live") have a short write-up and a YouTube link. While **Live now** is switched on, the stream plays in full on the site, gets a red LIVE badge, and a LIVE banner appears at the top of the homepage. Switch it off when the programme ends.
- New uploads appear after the next deploy. `refresh-videos.yml` can rebuild every 3 hours: create a Vercel Deploy Hook for `main` and save its URL as the repository secret `VERCEL_DEPLOY_HOOK_URL`.
- Set `SKIP_YOUTUBE_FEED=1` to build without network access.

### Images

- The **Hero Image** field sets the article's main picture.
- The **Gallery Images** field takes any number of extra photos, shown as a grid under the article.
- New uploads land in `public/images/uploads/`.
- On every CMS pull request, `optimize-images.yml` shrinks new images wider than 1600px or larger than 400 KB and commits the smaller files back to the branch.
- To compress everything by hand: `npm run images:optimize`.

---

## Local development

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev          # http://localhost:4321
```

| Command | What it does |
|---------|--------------|
| `npm run dev` | Local dev server |
| `npm run check` | Type-check Astro and TypeScript files |
| `npm run build` | Production build (output in `.vercel/output/static`) |
| `npm test` | Content tests, plus build-output tests if a build exists |
| `npm run images:optimize` | Compress oversized images in `public/` |

CI runs `check`, `build` and `test` on every pull request and on every push to `main`.

---

## Related services (not in this repo)

- **Auth Worker** — register / verify / login / logout, bookmarks, push subscriptions (Cloudflare D1, Brevo SMTP for email).
- **Push Worker** — stores subscriptions in KV and sends VAPID-signed web pushes; removes expired (410) subscriptions.
- **View-counter Worker** — counts article views.
- **Remark42** — comments, on an Oracle Cloud Free Tier VM reachable only through Cloudflare Tunnel (`comments.townscribe.org`).

Secrets used by GitHub Actions: `NOTIFY_SECRET` (bearer token for the push worker's `/notify` endpoint) and, optionally, `VERCEL_DEPLOY_HOOK_URL` (scheduled rebuilds for new YouTube videos).

---

## Author

**Oluwadare Tobi Jayeola** — DevOps Engineer & Software Engineer
- GitHub: [github.com/baalebos-cloud](https://github.com/baalebos-cloud)
- LinkedIn: [linkedin.com/in/oluwadare-jayeola-6874591b4](https://linkedin.com/in/oluwadare-jayeola-6874591b4)
- Live site: [news.townscribe.org](https://news.townscribe.org)
- Email: jayeolaoluwadamilare@gmail.com

## License

MIT
