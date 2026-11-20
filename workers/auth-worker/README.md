# TownScribe auth worker

Cloudflare Worker behind sign-in: register, email verification, sign in/out,
**forgot / reset password**, profile and bookmarks. The live copy runs as
**`townscribe-auth`**; this folder is its source of truth, tested in CI
(`npm run test:worker`).

## Deploy (Cloudflare dashboard, no tools needed)

1. Cloudflare → **Workers & Pages** → `townscribe-auth` → **Edit code**.
2. Select all the code in the editor and replace it with the contents of `worker.js`.
3. Click **Deploy**.

No new settings, tables or secrets are needed — it uses the existing bindings:

| Binding | What it is |
|---|---|
| `DB` (D1) | `users`, `email_verifications`, `bookmarks` tables |
| `SESSIONS` (KV) | sign-in sessions, and now password-reset tokens |
| `BREVO_API_KEY` (secret) | Brevo key used for verification and reset emails |

## How password reset works

1. Reader clicks **Forgot password?** in the sign-in box and enters their email.
2. `POST /forgot-password` always gives the same answer (so nobody can probe which
   emails have accounts). If the account exists, Brevo sends a link to
   `https://news.townscribe.org/reset-password?token=…`. One email per address per minute.
3. The token is stored only as a SHA-256 hash in KV, expires after **30 minutes**,
   and works **once**.
4. `POST /reset-password` saves the new password (min. 8 characters), marks the
   email as verified, and signs the account out everywhere else.
5. The reader lands back on the site with the sign-in box open.

## Check it works

After deploying, click **Forgot password?** on the site with your own email. If no
email arrives, check Cloudflare → the worker → **Observability → Logs** for a
`Brevo send failed` line, and Brevo → **Transactional → Logs**.
