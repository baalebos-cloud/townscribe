// Tests for workers/auth-worker/worker.js: register → verify → sign in, and the
// forgot/reset password flow, against in-memory stand-ins for D1, KV and Brevo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { escapeHtml, hashPassword, sha256Hex, verifyPassword } from '../workers/auth-worker/worker.js';

function memoryKV() {
	const store = new Map();
	return {
		store,
		async get(k) {
			return store.has(k) ? store.get(k) : null;
		},
		async put(k, v, opts) {
			store.set(k, v);
			if (opts) store.set(`__ttl_${k}`, opts.expirationTtl);
		},
		async delete(k) {
			store.delete(k);
		},
	};
}

/** Just enough of D1 for the queries the worker runs. */
function memoryD1() {
	const users = new Map(); // id -> row
	const verifications = new Map(); // token -> row
	const byEmail = (email) => [...users.values()].find((u) => u.email === email) || null;
	const stmt = (sql, args) => ({
		bind: (...a) => stmt(sql, a),
		async first() {
			if (sql.startsWith('SELECT') && sql.includes('FROM users WHERE email')) return byEmail(args[0]);
			if (sql.startsWith('SELECT') && sql.includes('FROM users WHERE id')) return users.get(args[0]) || null;
			if (sql.includes('FROM email_verifications')) return verifications.get(args[0]) || null;
			throw new Error(`unexpected first(): ${sql}`);
		},
		async run() {
			if (sql.startsWith('INSERT INTO users')) {
				const [id, email, password_hash, display_name] = args;
				users.set(id, { id, email, password_hash, display_name, avatar_url: '', email_verified: 0 });
			} else if (sql.startsWith('INSERT INTO email_verifications')) {
				const [, user_id, token, expires_at] = args;
				verifications.set(token, { user_id, expires_at });
			} else if (sql.startsWith('UPDATE users SET email_verified')) {
				users.get(args[0]).email_verified = 1;
			} else if (sql.startsWith('UPDATE users SET password_hash')) {
				Object.assign(users.get(args[1]), { password_hash: args[0], email_verified: 1 });
			} else if (sql.startsWith('DELETE FROM email_verifications')) {
				verifications.delete(args[0]);
			} else throw new Error(`unexpected run(): ${sql}`);
			return { success: true };
		},
	});
	return { users, verifications, byEmail, prepare: (sql) => stmt(sql, []) };
}

function setup() {
	const env = { DB: memoryD1(), SESSIONS: memoryKV(), BREVO_API_KEY: 'test-key' };
	const emails = [];
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
		assert.equal(init.headers['api-key'], 'test-key');
		emails.push(JSON.parse(init.body));
		return new Response('{}', { status: 201 });
	};
	const restore = () => (globalThis.fetch = realFetch);
	const call = async (method, path, body, headers = {}) => {
		const res = await worker.fetch(
			new Request(`https://auth.test${path}`, {
				method,
				headers: { 'Content-Type': 'application/json', Origin: 'https://news.townscribe.org', ...headers },
				body: body ? JSON.stringify(body) : undefined,
				redirect: 'manual',
			}),
			env,
		);
		const text = await res.text();
		let data = null;
		try {
			data = JSON.parse(text);
		} catch {}
		return { status: res.status, data, headers: res.headers };
	};
	return { env, emails, call, restore };
}

async function verifiedUser(t, email = 'Reader@Example.com', password = 'old-password-1') {
	await t.call('POST', '/register', { email, password, displayName: 'Ada <b>Reader</b>' });
	const link = t.emails.at(-1).htmlContent.match(/verify-email\?token=([0-9a-f]+)/)[1];
	assert.equal((await t.call('GET', `/verify-email?token=${link}`)).status, 302);
	t.emails.length = 0;
	return { email, password };
}

const resetTokenFrom = (mail) => mail.htmlContent.match(/https:\/\/news\.townscribe\.org\/reset-password\?token=([0-9a-f]{64})/)[1];

test('passwords hash and verify', async () => {
	const stored = await hashPassword('correct horse');
	assert.ok(await verifyPassword('correct horse', stored));
	assert.ok(!(await verifyPassword('wrong horse', stored)));
	assert.ok(!(await verifyPassword('x', '')));
});

test('register → verify → sign in still works, and names are escaped in the email', async () => {
	const t = setup();
	try {
		const reg = await t.call('POST', '/register', { email: 'Reader@Example.com', password: 'pass-word-1', displayName: 'Ada <b>Reader</b>' });
		assert.equal(reg.status, 201);
		assert.equal(t.emails.length, 1);
		assert.ok(t.emails[0].htmlContent.includes('Ada &lt;b&gt;Reader&lt;/b&gt;'));
		assert.equal((await t.call('POST', '/login', { email: 'reader@example.com', password: 'pass-word-1' })).status, 403, 'unverified');

		const token = t.emails[0].htmlContent.match(/verify-email\?token=([0-9a-f]+)/)[1];
		const verify = await t.call('GET', `/verify-email?token=${token}`);
		assert.equal(verify.status, 302);
		assert.equal(verify.headers.get('Location'), 'https://news.townscribe.org/?verified=1');

		const login = await t.call('POST', '/login', { email: 'reader@example.com', password: 'pass-word-1' });
		assert.equal(login.status, 200);
		assert.equal((await t.call('GET', '/me', null, { Authorization: `Bearer ${login.data.token}` })).data.email, 'reader@example.com');
	} finally {
		t.restore();
	}
});

test('forgot password emails a one-time reset link; the new password works and the old one does not', async () => {
	const t = setup();
	try {
		const { email, password } = await verifiedUser(t);
		const before = await t.call('POST', '/login', { email, password });
		assert.equal(before.status, 200);

		const forgot = await t.call('POST', '/forgot-password', { email: '  READER@example.com ' });
		assert.equal(forgot.status, 200);
		assert.equal(t.emails.length, 1);
		assert.equal(t.emails[0].to[0].email, 'reader@example.com');
		assert.equal(t.emails[0].subject, 'Reset your TownScribe password');
		const token = resetTokenFrom(t.emails[0]);

		// Only a hash of the token is stored, with a 30-minute expiry
		const key = `reset_${await sha256Hex(token)}`;
		assert.ok(t.env.SESSIONS.store.has(key));
		assert.ok(![...t.env.SESSIONS.store.keys()].some((k) => k.includes(token)));
		assert.equal(t.env.SESSIONS.store.get(`__ttl_${key}`), 1800);

		assert.equal((await t.call('POST', '/reset-password', { token, password: 'short' })).status, 400);
		const reset = await t.call('POST', '/reset-password', { token, password: 'new-password-2' });
		assert.equal(reset.status, 200);
		assert.equal((await t.call('POST', '/reset-password', { token, password: 'another-pass-3' })).status, 400, 'link is single-use');

		assert.equal((await t.call('POST', '/login', { email, password })).status, 401);
		assert.equal((await t.call('POST', '/login', { email, password: 'new-password-2' })).status, 200);

		// Sessions from before the reset are signed out
		assert.equal((await t.call('GET', '/me', null, { Authorization: `Bearer ${before.data.token}` })).status, 401);
	} finally {
		t.restore();
	}
});

test('forgot password does not reveal whether an account exists, and is rate limited', async () => {
	const t = setup();
	try {
		await verifiedUser(t);
		const unknown = await t.call('POST', '/forgot-password', { email: 'nobody@example.com' });
		const known = await t.call('POST', '/forgot-password', { email: 'reader@example.com' });
		assert.equal(unknown.status, 200);
		assert.deepEqual(unknown.data, known.data);
		assert.equal(t.emails.length, 1, 'only the real account gets an email');

		await t.call('POST', '/forgot-password', { email: 'reader@example.com' });
		assert.equal(t.emails.length, 1, 'second request within a minute sends nothing');
		assert.equal((await t.call('POST', '/forgot-password', {})).status, 400);
	} finally {
		t.restore();
	}
});

test('resetting also verifies an account that never clicked the verification email', async () => {
	const t = setup();
	try {
		await t.call('POST', '/register', { email: 'new@example.com', password: 'first-pass-1', displayName: 'New Reader' });
		t.emails.length = 0;
		await t.call('POST', '/forgot-password', { email: 'new@example.com' });
		const token = resetTokenFrom(t.emails[0]);
		assert.equal((await t.call('POST', '/reset-password', { token, password: 'second-pass-2' })).status, 200);
		assert.equal((await t.call('POST', '/login', { email: 'new@example.com', password: 'second-pass-2' })).status, 200);
	} finally {
		t.restore();
	}
});

test('bad reset tokens are rejected; CORS and unknown routes behave', async () => {
	const t = setup();
	try {
		assert.equal((await t.call('POST', '/reset-password', { token: 'abc', password: 'whatever-123' })).status, 400);
		assert.equal((await t.call('POST', '/reset-password', { token: 'a'.repeat(64), password: 'whatever-123' })).status, 400);
		const res = await t.call('POST', '/nope', {});
		assert.equal(res.status, 404);
		assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://news.townscribe.org');
		assert.equal(escapeHtml(`"<x>'&`), '&quot;&lt;x&gt;&#39;&amp;');
	} finally {
		t.restore();
	}
});
