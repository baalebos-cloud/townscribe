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
    sitemap.xml.ts, rss.xml.js          sitemap and RSS feed
public/
  admin/                Decap CMS (index.html + config.yml)
  images/uploads/       new CMS uploads
  *.jpg|png|webp        images uploaded before Nov 2026
scripts/
  optimize-images.mjs   shrinks oversized images in place
tests/                  node:test suites run in CI
```

### Categories

Categories are defined once in `src/categories.ts`. The CMS dropdown in `public/admin/config.yml` must list the same slugs; `npm test` fails if they drift apart. To add a category, add it in both places — the header menu, category pages and sitemap pick it up automatically.

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

Secrets used by GitHub Actions: `NOTIFY_SECRET` (bearer token for the push worker's `/notify` endpoint).

---

## Author

**Oluwadare Tobi Jayeola** — DevOps Engineer & Software Engineer
- GitHub: [github.com/baalebos-cloud](https://github.com/baalebos-cloud)
- LinkedIn: [linkedin.com/in/oluwadare-jayeola-6874591b4](https://linkedin.com/in/oluwadare-jayeola-6874591b4)
- Live site: [news.townscribe.org](https://news.townscribe.org)
- Email: jayeolaoluwadamilare@gmail.com

## License

MIT
