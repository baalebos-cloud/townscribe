# TownScribe push worker

Cloudflare Worker that stores news-alert subscriptions and sends alerts. The live
copy runs as **`townscribe-push-worker`** on Cloudflare; this folder is its source
of truth, tested in CI (`npm run test:worker`).

## Deploy (Cloudflare dashboard, no tools needed)

1. Cloudflare → **Workers & Pages** → `townscribe-push-worker` → **Edit code**.
2. Select all the code in the editor and replace it with the contents of `worker.js`.
3. Click **Deploy**.

Nothing else changes: it uses the same KV binding and variables.

| Setting | Value |
|---|---|
| KV binding `PUSH_SUBSCRIPTIONS` | existing namespace |
| `VAPID_PUBLIC_KEY` | public key (starts with `B`), also served at `/vapid-public-key` |
| `VAPID_PRIVATE_KEY` (secret) | raw 32-byte key from web-push, or PKCS#8 — both work |
| `VAPID_SUBJECT` | `mailto:…` or an `https://` URL |
| `NOTIFY_SECRET` (secret) | same value as the GitHub secret `NOTIFY_SECRET` |

## Check it works

After the next article is published, open the **Notify subscribers** run in GitHub
Actions. The summary shows `Sent` / `Failed`. The worker's reply also includes an
`errors` breakdown (for example `"HTTP 403": 1`), and each rejection is logged in
Cloudflare → the worker → **Observability → Logs**.
