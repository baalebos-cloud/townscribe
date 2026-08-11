# 🚀 TownScribe Media & Automated Content Pipeline

**TownScribe** is a modern, performance-focused blog and automated publishing engine. Built on top of **Astro** for blazingly fast content rendering, it features an integrated, event-driven CI/CD workflow via **n8n** and **Buffer** that automatically cross-posts new articles to social media channels as soon as Markdown files are committed to source control.

---

## ✨ Features

* **⚡ High Performance:** Built with Astro for 100/100 Lighthouse performance scores and static site generation (SSG).
* **🤖 Automated Social Publishing:** An integrated n8n automation pipeline listens for GitHub commits and automatically broadcasts new posts to social channels via Buffer.
* **📁 Content Collections:** Type-safe Markdown & MDX content handling using Astro Content Collections.
* **🔍 Full SEO & Syndication Support:** Built-in canonical URLs, Open Graph meta tags, XML sitemap generation, and automated RSS feeds.
* **🎯 Smart Path Filtering:** Pipeline selectively publishes updates only when files inside the `src/content/blog/` path are added or modified.

---

## 🏗 System Architecture & Workflow

```text
[ Developer Commit ] ──► [ GitHub Repo ] ──(Webhook Trigger)──► [ n8n Workflow Engine ]
                                                                        │
                                                                 (Path Filter)
                                                                        │
                                                           ┌────────────┴────────────┐
                                                           ▼                         ▼
                                                   [ src/content/blog ]     [ Other File Changes ]
                                                           │                         │
                                                           ▼                         ▼
                                                   [ Execute Buffer ]       [ Discard Execution ]
                                                           │
                                              ┌────────────┼────────────┐
                                              ▼            ▼            ▼
                                          [Twitter/X]  [Instagram]  [Facebook]

```

### Automation Pipeline Flow

1. **Source Control Trigger:** Pushing a commit to `baalebos-cloud/townscribe` triggers an n8n webhook.
2. **Conditional Path Filtering:** n8n evaluates the path of changed files. Code, dependency, or UI updates are safely discarded.
3. **Multi-Channel Distribution:** When a new Markdown article (`src/content/blog/*`) passes the filter, n8n constructs a formatted update and pushes it to Buffer to schedule or immediately post across all linked social handles.

---

## 📁 Project Structure

```text
.
├── public/                     # Static assets (favicons, images, public files)
├── src/
│   ├── assets/                 # Processed asset files
│   ├── components/             # Reusable Astro / UI components
│   ├── content/
│   │   └── blog/               # Markdown/MDX blog posts (Triggers n8n Pipeline)
│   ├── layouts/                # Page layouts (BlogPost, BaseLayout)
│   └── pages/                  # File-based router pages (.astro, .md)
├── astro.config.mjs            # Astro configuration
├── package.json
└── tsconfig.json

```

---

## 🚀 Getting Started Locally

### Prerequisites

* **Node.js**: `v18.14.0` or higher
* **npm** or your preferred package manager

### Installation

1. **Clone the repository:**
```sh
git clone https://github.com/baalebos-cloud/townscribe.git
cd townscribe

```


2. **Install dependencies:**
```sh
npm install

```


3. **Start the local development server:**
```sh
npm run dev

```


Open your browser and navigate to `http://localhost:4321`.

---

## 🧞 Command Line Interface

| Command | Action |
| --- | --- |
| `npm install` | Installs project dependencies |
| `npm run dev` | Starts local dev server at `localhost:4321` |
| `npm run build` | Builds static site production bundle to `./dist/` |
| `npm run preview` | Previews the production build locally prior to deployment |
| `npm run astro ...` | Executes Astro CLI commands (`astro add`, `astro check`) |

---

## ⚙️ Automation Setup (n8n + Buffer)

To connect this repository to your n8n publishing pipeline:

1. **GitHub Webhook:** Configure a repository webhook in GitHub pointing to your n8n instance URL (`/webhook/github-trigger`).
2. **Filter Node Configuration:** Set the n8n Filter node condition to check if commit file paths contain `src/content/blog`.
3. **Buffer Credentials:** Add your Buffer API Personal Access Key under n8n Credentials and select your target Organization and Social Channels (`townscribenews`).
4. **Publish Workflow:** Activate the workflow in n8n (`Published / Active`).

---

## 📄 License & Credits

* Base blog template built on top of [Astro Starter Kit: Blog](https://github.com/withastro/astro/tree/main/examples/blog) and inspired by [Bear Blog](https://github.com/HermanMartinus/bearblog/).
