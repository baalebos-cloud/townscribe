// Tests for workers/push-worker/worker.js using Node's built-in WebCrypto.
// A fake "browser" subscribes, the worker sends an alert, and the test checks
// the VAPID signature and decrypts the payload exactly as a browser would.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { b64urlToBytes, bytesToB64url, keyForEndpoint } from '../workers/push-worker/worker.js';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

function concat(...parts) {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

async function hkdf(salt, ikm, info, len) {
	const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
	return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

/** VAPID keys in both formats a worker may be configured with. */
async function makeVapidKeys() {
	const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
	const publicRaw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
	const jwk = await subtle.exportKey('jwk', pair.privateKey);
	const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
	return { pair, publicB64: bytesToB64url(publicRaw), rawPrivateB64: jwk.d, pkcs8B64: bytesToB64url(pkcs8) };
}

/** A browser-side subscription: ECDH key pair + 16-byte auth secret. */
async function makeBrowser(endpoint) {
	const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
	const publicRaw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
	const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
	return { pair, auth, subscription: { endpoint, expirationTime: null, keys: { p256dh: bytesToB64url(publicRaw), auth: bytesToB64url(auth) } } };
}

/** RFC 8291 decryption, as done by the browser. */
async function decrypt(browser, body) {
	const salt = body.slice(0, 16);
	const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
	const idlen = body[20];
	const asPublic = body.slice(21, 21 + idlen);
	const ciphertext = body.slice(21 + idlen);
	assert.equal(rs, 4096);
	assert.equal(idlen, 65);
	const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
	const ecdh = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, browser.pair.privateKey, 256));
	const uaPublic = b64urlToBytes(browser.subscription.keys.p256dh);
	const ikm = await hkdf(browser.auth, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
	const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
	const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
	const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
	const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext));
	assert.equal(plain[plain.length - 1], 2, 'last-record delimiter');
	return new TextDecoder().decode(plain.slice(0, -1));
}

function memoryKV() {
	const store = new Map();
	return {
		store,
		async get(k) {
			return store.has(k) ? store.get(k) : null;
		},
		async put(k, v) {
			store.set(k, v);
		},
		async delete(k) {
			store.delete(k);
		},
		async list({ prefix = '', cursor } = {}) {
			const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
			const start = cursor ? Number(cursor) : 0;
			const page = all.slice(start, start + 2); // tiny pages to exercise pagination
			const done = start + 2 >= all.length;
			return { keys: page.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : String(start + 2) };
		},
	};
}

async function setup(privateFormat = 'raw') {
	const vapid = await makeVapidKeys();
	const env = {
		PUSH_SUBSCRIPTIONS: memoryKV(),
		VAPID_PUBLIC_KEY: vapid.publicB64,
		VAPID_PRIVATE_KEY: privateFormat === 'raw' ? vapid.rawPrivateB64 : vapid.pkcs8B64,
		VAPID_SUBJECT: 'mailto:alerts@example.com',
		NOTIFY_SECRET: 'test-secret',
	};
	return { vapid, env };
}

const call = (env, method, path, body, headers = {}) =>
	worker.fetch(
		new Request(`https://push.test${path}`, {
			method,
			headers: { 'Content-Type': 'application/json', Origin: 'https://news.townscribe.org', ...headers },
			body: body ? JSON.stringify(body) : undefined,
		}),
		env,
	);

for (const format of ['raw', 'pkcs8']) {
	test(`delivers an encrypted, VAPID-signed alert (${format} private key)`, async () => {
		const { vapid, env } = await setup(format);
		const browser = await makeBrowser('https://fcm.googleapis.com/fcm/send/abc123');
		assert.equal((await call(env, 'POST', '/subscribe', browser.subscription)).status, 200);

		const captured = [];
		const realFetch = globalThis.fetch;
		globalThis.fetch = async (url, init) => {
			captured.push({ url, init });
			return new Response(null, { status: 201 });
		};
		try {
			const res = await call(env, 'POST', '/notify', { title: 'Hello', body: 'World', url: 'https://news.townscribe.org/blog/x' }, { Authorization: 'Bearer test-secret' });
			const result = await res.json();
			assert.deepEqual({ sent: result.sent, failed: result.failed, cleaned: result.cleaned }, { sent: 1, failed: 0, cleaned: 0 });
		} finally {
			globalThis.fetch = realFetch;
		}

		assert.equal(captured.length, 1);
		const { url, init } = captured[0];
		assert.equal(url, browser.subscription.endpoint);
		assert.equal(init.headers['Content-Encoding'], 'aes128gcm');
		assert.equal(init.headers.TTL, '86400');

		// VAPID header: "vapid t=<jwt>, k=<public key>", JWT signed with the VAPID key
		const m = init.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
		assert.ok(m, init.headers.Authorization);
		assert.equal(m[2], vapid.publicB64);
		const [h, p, s] = m[1].split('.');
		const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
		assert.equal(claims.aud, 'https://fcm.googleapis.com');
		assert.equal(claims.sub, 'mailto:alerts@example.com');
		assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600);
		const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapid.pair.publicKey, b64urlToBytes(s), enc.encode(`${h}.${p}`));
		assert.ok(ok, 'JWT signature must verify with the VAPID public key');

		// Payload decrypts on the browser side
		const payload = JSON.parse(await decrypt(browser, new Uint8Array(init.body)));
		assert.deepEqual(payload, { title: 'Hello', body: 'World', url: 'https://news.townscribe.org/blog/x' });
	});
}

test('re-subscribing the same browser keeps one entry; duplicates from old random keys are cleaned', async () => {
	const { env } = await setup();
	const browser = await makeBrowser('https://updates.push.services.mozilla.com/wpush/v2/xyz');
	await call(env, 'POST', '/subscribe', browser.subscription);
	await call(env, 'POST', '/subscribe', browser.subscription);
	assert.equal(env.PUSH_SUBSCRIPTIONS.store.size, 1);
	assert.ok(env.PUSH_SUBSCRIPTIONS.store.has(await keyForEndpoint(browser.subscription.endpoint)));

	// Simulate legacy entries saved under random names by the old worker
	env.PUSH_SUBSCRIPTIONS.store.set('sub_legacy-1', JSON.stringify(browser.subscription));
	env.PUSH_SUBSCRIPTIONS.store.set('sub_legacy-2', JSON.stringify(browser.subscription));

	const realFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = async () => {
		calls++;
		return new Response(null, { status: 201 });
	};
	try {
		const result = await (await call(env, 'POST', '/notify', { title: 't', body: 'b', url: '/' }, { Authorization: 'Bearer test-secret' })).json();
		assert.equal(calls, 1, 'one alert per browser');
		assert.equal(result.sent, 1);
		assert.equal(result.cleaned, 2);
		assert.equal(env.PUSH_SUBSCRIPTIONS.store.size, 1);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('expired subscriptions are removed, rejections are counted as failed (not sent)', async () => {
	const { env } = await setup();
	const gone = await makeBrowser('https://fcm.googleapis.com/fcm/send/gone');
	const rejected = await makeBrowser('https://web.push.apple.com/rejected');
	const good = await makeBrowser('https://fcm.googleapis.com/fcm/send/good');
	for (const b of [gone, rejected, good]) await call(env, 'POST', '/subscribe', b.subscription);

	const realFetch = globalThis.fetch;
	globalThis.fetch = async (url) => {
		if (url.endsWith('/gone')) return new Response('', { status: 410 });
		if (url.endsWith('/rejected')) return new Response('BadJwtToken', { status: 403 });
		return new Response(null, { status: 201 });
	};
	const warn = console.warn;
	console.warn = () => {};
	try {
		const result = await (await call(env, 'POST', '/notify', { title: 't', body: 'b', url: '/' }, { Authorization: 'Bearer test-secret' })).json();
		assert.deepEqual({ sent: result.sent, failed: result.failed, cleaned: result.cleaned, total: result.total }, { sent: 1, failed: 1, cleaned: 1, total: 3 });
		assert.deepEqual(result.errors, { 'HTTP 403': 1 });
		assert.equal(env.PUSH_SUBSCRIPTIONS.store.size, 2);
	} finally {
		globalThis.fetch = realFetch;
		console.warn = warn;
	}
});

test('unsubscribe removes the browser; bad input and wrong secret are rejected', async () => {
	const { env } = await setup();
	const browser = await makeBrowser('https://fcm.googleapis.com/fcm/send/bye');
	await call(env, 'POST', '/subscribe', browser.subscription);
	assert.equal((await call(env, 'POST', '/unsubscribe', { endpoint: browser.subscription.endpoint })).status, 200);
	assert.equal(env.PUSH_SUBSCRIPTIONS.store.size, 0);

	assert.equal((await call(env, 'POST', '/subscribe', { endpoint: 'http://insecure' })).status, 400);
	assert.equal((await call(env, 'POST', '/notify', { title: 'x' }, { Authorization: 'Bearer wrong' })).status, 401);

	const res = await call(env, 'GET', '/vapid-public-key');
	assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://news.townscribe.org');
	assert.equal((await res.json()).key, env.VAPID_PUBLIC_KEY);
});
