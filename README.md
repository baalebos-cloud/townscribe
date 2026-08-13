# TownScribe

**Serverless publishing platform** — fully edge-native media site running on Cloudflare Workers, KV, D1, and Tunnel. No traditional backend server. Zero cold starts. Built with TypeScript, Astro, and Cloudflare's developer platform.

Live at: **[townscribe.org](https://townscribe.org)**

---

## What it does

TownScribe is a community media platform where readers can browse articles, comment, subscribe to push notifications, and authenticate — all without a traditional backend server. Every dynamic feature runs at the Cloudflare edge using Workers.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend / SSG | Astro (static site generation) |
| Edge runtime | Cloudflare Workers (TypeScript) |
| Key-value storage | Cloudflare KV |
| Edge database | Cloudflare D1 (SQLite at the edge) |
| Origin tunnel | Cloudflare Tunnel (zero-trust) |
| Push notifications | Web Push API + VAPID |
| Transactional email | Brevo SMTP |
| Comments | Remark42 (self-hosted on Oracle Cloud Free Tier) |
| DNS + Security | Cloudflare DNS, WAF, rate limiting, SSL/TLS Full Strict |
| Deployment | Cloudflare Pages (frontend) + Workers (edge logic) |

---

## Architecture

```
townscribe.org
│
├── Cloudflare Edge
│   ├── push-worker/          # Web Push notification delivery
│   │   ├── index.ts          # VAPID signing, KV subscription management
│   │   └── vapid.ts          # VAPID key generation + payload signing
│   │
│   ├── auth-worker/          # User authentication system
│   │   ├── index.ts          # Route handler — register, verify, login, logout
│   │   ├── db.ts             # Cloudflare D1 queries (townscribe-users)
│   │   ├── email.ts          # Brevo SMTP — verification email dispatch
│   │   └── crypto.ts         # PBKDF2 password hashing + token generation
│   │
│   └── Cloudflare Tunnel ───► Remark42 (Oracle Cloud VM)
│                               └── Comments system (self-hosted)
│
├── frontend/                 # Astro static site
│   ├── src/
│   │   ├── pages/            # Article pages, home, about
│   │   ├── components/       # Push subscription UI, comment embed
│   │   └── layouts/          # Base layout with push notification prompt
│   └── public/
│       └── sw.js             # Service Worker — push notification receiver
│
└── DNS (Cloudflare)
    ├── townscribe.org        # Main site (Cloudflare Pages)
    ├── comments.townscribe.org → Cloudflare Tunnel → Remark42
    └── api.townscribe.org    → Auth Worker + Push Worker
```

---

## Key Workers

### Push Notification Worker (`push-worker/index.ts`)

Handles the full Web Push delivery pipeline at the edge:

```typescript
// Subscription storage
await env.PUSH_SUBSCRIPTIONS.put(subscriptionKey, JSON.stringify(subscription));

// VAPID-signed push delivery
const payload = JSON.stringify({ title, body, url });
const signedRequest = await signVapidRequest(subscription.endpoint, payload, env);
const response = await fetch(subscription.endpoint, signedRequest);
```

**How it works:**
1. Browser requests push permission → frontend sends subscription object to Worker
2. Worker stores subscription in Cloudflare KV (`PUSH_SUBSCRIPTIONS`)
3. On new article publish → Worker fetches all subscriptions from KV
4. Signs each push payload with VAPID private key
5. Dispatches to Web Push API endpoint for each subscriber
6. Handles expired subscriptions (410 Gone) by deleting from KV

**Why edge-native:** No server round-trip. Push dispatches happen at Cloudflare's nearest PoP to each subscriber's push service endpoint.

---

### Authentication Worker (`auth-worker/index.ts`)

Complete user authentication without a backend server:

```typescript
// Registration flow
router.post('/register', async (req, env) => {
  const { email, password } = await req.json();
  const hash = await pbkdf2Hash(password);           // PBKDF2 + salt
  const token = crypto.randomUUID();                 // Verification token
  await insertUser(env.DB, email, hash, token);      // D1 insert
  await sendVerificationEmail(email, token, env);    // Brevo SMTP
  return json({ message: 'Verification email sent' });
});

// Session management
router.post('/login', async (req, env) => {
  const { email, password } = await req.json();
  const user = await getUserByEmail(env.DB, email);
  const valid = await verifyPbkdf2(password, user.password_hash);
  if (!valid) return json({ error: 'Invalid credentials' }, 401);
  const sessionId = crypto.randomUUID();
  await createSession(env.DB, user.id, sessionId);   // 30-day session
  return json({ sessionId });
});
```

**Database schema (Cloudflare D1):**
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  verified INTEGER DEFAULT 0,
  verification_token TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  expires_at TEXT NOT NULL
);
```

---

## Cloudflare Tunnel Setup

Remark42 (comment system) runs on an Oracle Cloud Free Tier VM with no public IP exposed:

```
Browser → cloudflare.com → Tunnel → Oracle Cloud VM:8080 (Remark42)
```

**Why Tunnel:** Zero-trust origin exposure. The origin never receives direct internet traffic — all requests pass through Cloudflare's network, enforcing DDoS protection, WAF rules, and SSL/TLS termination before reaching origin.

Tunnel ID: `5b09382c-8642-44a1-ab87-49b304437a0e`

---

## DNS Configuration

```
townscribe.org          A       → Cloudflare Pages
www.townscribe.org      CNAME   → townscribe.org
comments.townscribe.org CNAME   → Cloudflare Tunnel
api.townscribe.org      CNAME   → Workers route
```

SSL/TLS mode: **Full Strict** — origin certificate installed on Oracle VM, edge certificate managed by Cloudflare.

Email authentication: SPF, DKIM, and DMARC configured for jayeolaoluwadamilare@gmail.com sending via Brevo.

---

## Known Issues & Fixes

### DNS Misconfiguration — Production Traffic Loss
**Issue:** Typo in DNS record (`townsrcibe.org` instead of `townscribe.org`) caused traffic loss to the main domain.
**Diagnosis:** Traced through Cloudflare DNS audit log → identified incorrect CNAME target → corrected record.
**Fix:** Corrected CNAME, TTL propagation confirmed within 5 minutes.

### Push Subscription Cleanup
**Issue:** Stale KV subscriptions for expired push endpoints accumulate over time — Web Push API returns 410 Gone but Worker did not handle it.
**Fix:** Added 410/404 response handling in push delivery loop — deletes subscription from KV on receipt of Gone response.

---

## Getting Started (Local Dev)

### Prerequisites
- Node.js 18+
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account (free tier sufficient)

### Clone and install
```bash
git clone https://github.com/baalebos-cloud/townscribe
cd townscribe
npm install
```

### Configure Wrangler
```bash
# Authenticate
wrangler login

# Create KV namespace
wrangler kv:namespace create PUSH_SUBSCRIPTIONS

# Create D1 database
wrangler d1 create townscribe-users
```

### Environment variables (`wrangler.toml`)
```toml
[vars]
BREVO_API_KEY = "your_brevo_api_key"
VAPID_PUBLIC_KEY = "your_vapid_public_key"
VAPID_PRIVATE_KEY = "your_vapid_private_key"
VAPID_SUBJECT = "mailto:jayeolaoluwadamilare@gmail.com"

[[kv_namespaces]]
binding = "PUSH_SUBSCRIPTIONS"
id = "your_kv_namespace_id"

[[d1_databases]]
binding = "DB"
database_name = "townscribe-users"
database_id = "your_d1_database_id"
```

### Run locally
```bash
# Frontend
cd frontend && npm run dev

# Workers (local dev)
wrangler dev push-worker/index.ts
wrangler dev auth-worker/index.ts
```

### Deploy
```bash
wrangler deploy push-worker/index.ts
wrangler deploy auth-worker/index.ts
```

---

## Author

**Oluwadare Tobi Jayeola** — DevOps Engineer & Software Engineer
- GitHub: [github.com/baalebos-cloud](https://github.com/baalebos-cloud)
- LinkedIn: [linkedin.com/in/oluwadare-jayeola-6874591b4](https://linkedin.com/in/oluwadare-jayeola-6874591b4)
- Live site: [townscribe.org](https://townscribe.org)
- Email: jayeolaoluwadamilare@gmail.com

---

## License

MIT
