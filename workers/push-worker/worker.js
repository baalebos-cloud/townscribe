// TownScribe push worker (Cloudflare Worker, ES module)
//
// Routes
//   GET  /vapid-public-key  -> { key }            public signing key for browsers
//   POST /subscribe         <- PushSubscription   saves (one entry per browser)
//   POST /unsubscribe       <- { endpoint }       removes that browser
//   POST /notify            <- { title, body, url, icon }   (Authorization: Bearer NOTIFY_SECRET)
//                           -> { sent, failed, cleaned, total, errors }
//
// Bindings / variables (Cloudflare → Worker → Settings)
//   PUSH_SUBSCRIPTIONS  KV namespace
//   VAPID_PUBLIC_KEY    base64url, 65-byte uncompressed P-256 public key ("B...")
//   VAPID_PRIVATE_KEY   base64url, either the raw 32-byte key (web-push format) or PKCS#8
//   VAPID_SUBJECT       "mailto:you@example.com" or an https URL
//   NOTIFY_SECRET       shared secret used by the GitHub "notify" workflow
//
// Alerts are encrypted per RFC 8291 (Content-Encoding: aes128gcm) and signed per
// RFC 8292 (VAPID). Both are required by Chrome/Firefox/Edge/Safari push services.

const ALLOWED_ORIGINS = ['https://news.townscribe.org'];

const encoder = new TextEncoder();

// ── helpers ──────────────────────────────────────────────────────────────
export function b64urlToBytes(value) {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
	const raw = atob(padded);
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

export function bytesToB64url(bytes) {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts) {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.length;
	}
	return out;
}

async function hkdf(salt, ikm, info, length) {
	const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
	const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
	return new Uint8Array(bits);
}

async function sha256Hex(text) {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** KV key for a subscription: one entry per browser endpoint, so re-subscribing never duplicates. */
export async function keyForEndpoint(endpoint) {
	return `sub_${(await sha256Hex(endpoint)).slice(0, 40)}`;
}

function corsHeaders(request) {
	const origin = request.headers.get('Origin');
	return {
		'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		Vary: 'Origin',
	};
}

function json(request, data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
	});
}

// ── VAPID (RFC 8292) ─────────────────────────────────────────────────────
export async function importVapidPrivateKey(publicKeyB64, privateKeyB64) {
	const priv = b64urlToBytes(privateKeyB64.trim());
	const algorithm = { name: 'ECDSA', namedCurve: 'P-256' };
	if (priv.length === 32) {
		// Raw "d" value (what web-push / most VAPID generators produce): import as JWK
		const pub = b64urlToBytes(publicKeyB64.trim());
		if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY must be a 65-byte uncompressed P-256 key');
		const jwk = {
			kty: 'EC',
			crv: 'P-256',
			d: bytesToB64url(priv),
			x: bytesToB64url(pub.slice(1, 33)),
			y: bytesToB64url(pub.slice(33, 65)),
			ext: true,
		};
		return crypto.subtle.importKey('jwk', jwk, algorithm, false, ['sign']);
	}
	return crypto.subtle.importKey('pkcs8', priv, algorithm, false, ['sign']);
}

export async function vapidAuthorization(endpoint, signingKey, publicKeyB64, subject) {
	const header = { typ: 'JWT', alg: 'ES256' };
	const claims = {
		aud: new URL(endpoint).origin,
		exp: Math.floor(Date.now() / 1000) + 12 * 3600,
		sub: subject,
	};
	const unsigned = `${bytesToB64url(encoder.encode(JSON.stringify(header)))}.${bytesToB64url(encoder.encode(JSON.stringify(claims)))}`;
	// WebCrypto returns the raw r||s signature that JWS ES256 expects
	const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, encoder.encode(unsigned)));
	return `vapid t=${unsigned}.${bytesToB64url(signature)}, k=${publicKeyB64.trim()}`;
}

// ── Payload encryption (RFC 8291, aes128gcm) ─────────────────────────────
export async function encryptPayload(subscription, plaintext) {
	const uaPublic = b64urlToBytes(subscription.keys.p256dh);
	const authSecret = b64urlToBytes(subscription.keys.auth);
	if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('subscription keys are invalid');

	const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
	const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
	const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
	const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

	const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic);
	const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

	const salt = crypto.getRandomValues(new Uint8Array(16));
	const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
	const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

	// Single record: plaintext + 0x02 padding delimiter (last record)
	const record = concat(encoder.encode(plaintext), new Uint8Array([2]));
	const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
	const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record));

	const recordSize = new Uint8Array(4);
	new DataView(recordSize.buffer).setUint32(0, 4096);
	return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

export async function sendPush(subscription, payload, env, signingKey) {
	const body = await encryptPayload(subscription, JSON.stringify(payload));
	const response = await fetch(subscription.endpoint, {
		method: 'POST',
		headers: {
			Authorization: await vapidAuthorization(subscription.endpoint, signingKey, env.VAPID_PUBLIC_KEY, env.VAPID_SUBJECT),
			'Content-Encoding': 'aes128gcm',
			'Content-Type': 'application/octet-stream',
			TTL: '86400',
			Urgency: 'high',
		},
		body,
	});
	return response;
}

async function listAllKeys(kv) {
	const names = [];
	let cursor;
	do {
		const page = await kv.list({ prefix: 'sub_', cursor });
		names.push(...page.keys.map((k) => k.name));
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
	return names;
}

// ── routes ───────────────────────────────────────────────────────────────
async function handleSubscribe(request, env) {
	let subscription;
	try {
		subscription = await request.json();
	} catch {
		return json(request, { error: 'Invalid JSON' }, 400);
	}
	const valid =
		typeof subscription?.endpoint === 'string' &&
		subscription.endpoint.startsWith('https://') &&
		typeof subscription?.keys?.p256dh === 'string' &&
		typeof subscription?.keys?.auth === 'string';
	if (!valid) return json(request, { error: 'Not a valid push subscription' }, 400);

	const record = { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } };
	await env.PUSH_SUBSCRIPTIONS.put(await keyForEndpoint(subscription.endpoint), JSON.stringify(record));
	return json(request, { success: true });
}

async function handleUnsubscribe(request, env) {
	let endpoint;
	try {
		({ endpoint } = await request.json());
	} catch {
		return json(request, { error: 'Invalid JSON' }, 400);
	}
	if (typeof endpoint !== 'string') return json(request, { error: 'endpoint is required' }, 400);
	await env.PUSH_SUBSCRIPTIONS.delete(await keyForEndpoint(endpoint));
	return json(request, { success: true });
}

async function handleNotify(request, env) {
	if (request.headers.get('Authorization') !== `Bearer ${env.NOTIFY_SECRET}`) {
		return new Response('Unauthorized', { status: 401 });
	}
	const { title, body, url, icon, image } = await request.json();
	const payload = { title, body, url, icon, image };

	const signingKey = await importVapidPrivateKey(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
	const names = await listAllKeys(env.PUSH_SUBSCRIPTIONS);

	let sent = 0;
	let failed = 0;
	let cleaned = 0;
	const errors = {};
	const seenEndpoints = new Set();
	const note = (reason) => {
		errors[reason] = (errors[reason] || 0) + 1;
	};

	// Send in small batches to stay well inside Worker limits
	for (let i = 0; i < names.length; i += 25) {
		await Promise.all(
			names.slice(i, i + 25).map(async (name) => {
				const raw = await env.PUSH_SUBSCRIPTIONS.get(name);
				if (!raw) return;
				let subscription;
				try {
					subscription = JSON.parse(raw);
				} catch {
					await env.PUSH_SUBSCRIPTIONS.delete(name);
					cleaned++;
					return;
				}
				// Older entries were saved under random names: drop duplicates of the same browser
				if (!subscription?.endpoint || seenEndpoints.has(subscription.endpoint)) {
					await env.PUSH_SUBSCRIPTIONS.delete(name);
					cleaned++;
					return;
				}
				seenEndpoints.add(subscription.endpoint);
				try {
					const response = await sendPush(subscription, payload, env, signingKey);
					if (response.ok) {
						sent++;
					} else if (response.status === 404 || response.status === 410) {
						await env.PUSH_SUBSCRIPTIONS.delete(name);
						cleaned++;
					} else {
						failed++;
						const detail = (await response.text().catch(() => '')).slice(0, 160);
						note(`HTTP ${response.status}`);
						console.warn(`[push] ${response.status} from ${new URL(subscription.endpoint).host}: ${detail}`);
					}
				} catch (err) {
					failed++;
					note(err?.message || 'error');
					console.error('[push] send failed:', err);
				}
			}),
		);
	}

	return json(request, { sent, failed, cleaned, total: names.length, errors });
}

export default {
	async fetch(request, env) {
		if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(request) });

		const { pathname } = new URL(request.url);
		try {
			if (request.method === 'GET' && pathname === '/vapid-public-key') return json(request, { key: env.VAPID_PUBLIC_KEY });
			if (request.method === 'POST' && pathname === '/subscribe') return await handleSubscribe(request, env);
			if (request.method === 'POST' && pathname === '/unsubscribe') return await handleUnsubscribe(request, env);
			if (request.method === 'POST' && pathname === '/notify') return await handleNotify(request, env);
		} catch (err) {
			console.error('[push] request failed:', err);
			return json(request, { error: err?.message || 'Server error' }, 500);
		}
		return new Response('Not Found', { status: 404 });
	},
};
