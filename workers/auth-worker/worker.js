// TownScribe auth worker (live name: townscribe-auth).
// Accounts, email verification, sign-in, password reset, profile and bookmarks.
//
// Bindings (unchanged from the existing deployment):
//   DB             D1 database (users, email_verifications, bookmarks)
//   SESSIONS       KV namespace (sessions, password-reset tokens)
//   BREVO_API_KEY  secret, Brevo transactional email key
//
// Password reset needs no new tables or settings: reset tokens live in the
// SESSIONS KV namespace with a 30-minute expiry, stored only as a SHA-256 hash.

export const SITE_URL = 'https://news.townscribe.org';
export const AUTH_URL = 'https://townscribe-auth.jayeolaoluwadamilare.workers.dev';
export const RESET_TTL_SECONDS = 30 * 60;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const RESET_COOLDOWN_SECONDS = 60; // one reset email per address per minute

const CORS = {
	'Access-Control-Allow-Origin': SITE_URL,
	'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
	'Access-Control-Allow-Credentials': 'true',
};

const enc = new TextEncoder();
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// ── Passwords ────────────────────────────────────────────────
async function pbkdf2(password, salt) {
	const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
	const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, 256);
	return toHex(new Uint8Array(bits));
}

export async function hashPassword(password) {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	return `${toHex(salt)}:${await pbkdf2(password, salt)}`;
}

export async function verifyPassword(password, stored) {
	const [saltHex, hashHex] = String(stored || '').split(':');
	if (!saltHex || !hashHex) return false;
	const salt = new Uint8Array(saltHex.match(/.{2}/g).map((b) => parseInt(b, 16)));
	return constantTimeEqual(await pbkdf2(password, salt), hashHex);
}

function constantTimeEqual(a, b) {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

// ── Tokens and sessions ──────────────────────────────────────
const generateId = () => crypto.randomUUID();

export function generateToken(length = 32) {
	return toHex(crypto.getRandomValues(new Uint8Array(length)));
}

export async function sha256Hex(value) {
	return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))));
}

async function createSession(userId, env) {
	const token = generateToken(32);
	await env.SESSIONS.put(`session_${token}`, JSON.stringify({ userId, createdAt: Date.now() }), { expirationTtl: SESSION_TTL_SECONDS });
	return token;
}

async function getSession(token, env) {
	if (!token) return null;
	const data = await env.SESSIONS.get(`session_${token}`);
	if (!data) return null;
	const session = JSON.parse(data);
	// Sessions created before a password reset are signed out.
	const changedAt = Number(await env.SESSIONS.get(`pwd_changed_${session.userId}`));
	if (changedAt && (session.createdAt || 0) < changedAt) {
		await env.SESSIONS.delete(`session_${token}`);
		return null;
	}
	return session;
}

function getTokenFromRequest(request) {
	const authHeader = request.headers.get('Authorization');
	if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.slice(7);
	const match = (request.headers.get('Cookie') || '').match(/ts_session=([^;]+)/);
	return match ? match[1] : null;
}

// ── Email (Brevo) ────────────────────────────────────────────
export function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function sendEmail(to, subject, html, env) {
	const response = await fetch('https://api.brevo.com/v3/smtp/email', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'api-key': env.BREVO_API_KEY },
		body: JSON.stringify({
			sender: { name: 'TownScribe', email: 'noreply@townscribe.org' },
			to: [{ email: to }],
			subject,
			htmlContent: html,
		}),
	});
	if (!response.ok) console.warn('Brevo send failed', response.status, await response.text().catch(() => ''));
	return response.ok;
}

const emailButton = (href, label) =>
	`<a href="${escapeHtml(href)}" style="display:inline-block;background:#dc2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">${label}</a>`;

// ── Helpers ──────────────────────────────────────────────────
function json(data, status = 200, extraHeaders = {}) {
	return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json', ...extraHeaders } });
}

async function readJson(request) {
	try {
		const body = await request.json();
		return body && typeof body === 'object' ? body : {};
	} catch {
		return {};
	}
}

const normalizeEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

// ── Routes ───────────────────────────────────────────────────
async function handleRegister(request, env) {
	const { email: rawEmail, password, displayName } = await readJson(request);
	const email = normalizeEmail(rawEmail);
	if (!email || !password || !displayName) return json({ error: 'Email, password and display name are required' }, 400);
	if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
	if (displayName.length < 2) return json({ error: 'Display name must be at least 2 characters' }, 400);

	const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
	if (existing) return json({ error: 'An account with this email already exists' }, 409);

	const userId = generateId();
	const passwordHash = await hashPassword(password);
	await env.DB.prepare('INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)').bind(userId, email, passwordHash, displayName).run();

	const verifyToken = generateToken();
	const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
	await env.DB.prepare('INSERT INTO email_verifications (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').bind(generateId(), userId, verifyToken, expiresAt).run();

	const verifyUrl = `${AUTH_URL}/verify-email?token=${verifyToken}`;
	await sendEmail(
		email,
		'Verify your TownScribe account',
		`<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
			<h2 style="color: #dc2626;">Welcome to TownScribe!</h2>
			<p>Hi ${escapeHtml(displayName)}, thanks for signing up.</p>
			<p>Please verify your email address to activate your account:</p>
			${emailButton(verifyUrl, 'Verify Email')}
			<p style="color:#888;font-size:0.85rem;margin-top:24px;">This link expires in 24 hours.</p>
		</div>`,
		env,
	);
	return json({ success: true, message: 'Account created. Please check your email to verify your account.' }, 201);
}

async function handleLogin(request, env) {
	const { email: rawEmail, password } = await readJson(request);
	const email = normalizeEmail(rawEmail);
	if (!email || !password) return json({ error: 'Email and password are required' }, 400);

	const user = await env.DB.prepare('SELECT id, email, password_hash, display_name, avatar_url, email_verified FROM users WHERE email = ?').bind(email).first();
	if (!user || !(await verifyPassword(password, user.password_hash))) return json({ error: 'Invalid email or password' }, 401);
	if (!user.email_verified) return json({ error: 'Please verify your email before signing in. Check your inbox.' }, 403);

	const token = await createSession(user.id, env);
	return json(
		{ success: true, token, user: { id: user.id, email: user.email, displayName: user.display_name, avatarUrl: user.avatar_url } },
		200,
		{ 'Set-Cookie': `ts_session=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${SESSION_TTL_SECONDS}` },
	);
}

async function handleVerifyEmail(request, env) {
	const token = new URL(request.url).searchParams.get('token');
	if (!token) return new Response('Invalid verification link.', { status: 400, headers: CORS });

	const verification = await env.DB.prepare('SELECT user_id, expires_at FROM email_verifications WHERE token = ?').bind(token).first();
	if (!verification) return new Response('Verification link is invalid or already used.', { status: 400, headers: CORS });
	if (new Date(verification.expires_at) < new Date()) {
		return new Response('Verification link has expired. Please register again.', { status: 400, headers: CORS });
	}
	await env.DB.prepare('UPDATE users SET email_verified = 1, updated_at = datetime("now") WHERE id = ?').bind(verification.user_id).run();
	await env.DB.prepare('DELETE FROM email_verifications WHERE token = ?').bind(token).run();
	return Response.redirect(`${SITE_URL}/?verified=1`, 302);
}

// Always answers the same way, so the form can't be used to find out who has an account.
const FORGOT_REPLY = { success: true, message: 'If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.' };

async function handleForgotPassword(request, env) {
	const email = normalizeEmail((await readJson(request)).email);
	if (!email || !email.includes('@')) return json({ error: 'Please enter your email address.' }, 400);

	const cooldownKey = `reset_cooldown_${await sha256Hex(email)}`;
	if (await env.SESSIONS.get(cooldownKey)) return json(FORGOT_REPLY);
	await env.SESSIONS.put(cooldownKey, '1', { expirationTtl: RESET_COOLDOWN_SECONDS });

	const user = await env.DB.prepare('SELECT id, email, display_name FROM users WHERE email = ?').bind(email).first();
	if (!user) return json(FORGOT_REPLY);

	const token = generateToken(32);
	await env.SESSIONS.put(`reset_${await sha256Hex(token)}`, JSON.stringify({ userId: user.id, createdAt: Date.now() }), { expirationTtl: RESET_TTL_SECONDS });

	const resetUrl = `${SITE_URL}/reset-password?token=${token}`;
	await sendEmail(
		user.email,
		'Reset your TownScribe password',
		`<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
			<h2 style="color: #dc2626;">Reset your password</h2>
			<p>Hi ${escapeHtml(user.display_name || 'there')},</p>
			<p>We received a request to reset the password for your TownScribe account. Click below to choose a new one:</p>
			${emailButton(resetUrl, 'Reset Password')}
			<p style="color:#888;font-size:0.85rem;margin-top:24px;">This link expires in 30 minutes and can be used once. If you didn't ask for this, you can ignore this email — your password won't change.</p>
		</div>`,
		env,
	);
	return json(FORGOT_REPLY);
}

async function handleResetPassword(request, env) {
	const { token, password } = await readJson(request);
	if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
		return json({ error: 'This reset link is invalid. Please request a new one.' }, 400);
	}
	if (typeof password !== 'string' || password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);

	const key = `reset_${await sha256Hex(token)}`;
	const data = await env.SESSIONS.get(key);
	if (!data) return json({ error: 'This reset link has expired or was already used. Please request a new one.' }, 400);
	await env.SESSIONS.delete(key); // one use only

	const { userId } = JSON.parse(data);
	const passwordHash = await hashPassword(password);
	// Opening the emailed link proves the reader owns the address, so the account counts as verified.
	await env.DB.prepare('UPDATE users SET password_hash = ?, email_verified = 1, updated_at = datetime("now") WHERE id = ?').bind(passwordHash, userId).run();
	// Sign out every existing session for this account.
	await env.SESSIONS.put(`pwd_changed_${userId}`, String(Date.now()), { expirationTtl: SESSION_TTL_SECONDS });
	return json({ success: true, message: 'Your password has been changed. You can now sign in.' });
}

async function handleMe(request, env) {
	const session = await getSession(getTokenFromRequest(request), env);
	if (!session) return json({ error: 'Unauthorized' }, 401);
	const user = await env.DB.prepare('SELECT id, email, display_name, avatar_url, email_verified, created_at FROM users WHERE id = ?').bind(session.userId).first();
	if (!user) return json({ error: 'User not found' }, 404);
	return json({
		id: user.id,
		email: user.email,
		displayName: user.display_name,
		avatarUrl: user.avatar_url,
		emailVerified: !!user.email_verified,
		createdAt: user.created_at,
	});
}

async function handleLogout(request, env) {
	const token = getTokenFromRequest(request);
	if (token) await env.SESSIONS.delete(`session_${token}`);
	return json({ success: true }, 200, { 'Set-Cookie': 'ts_session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0' });
}

async function handleSaveBookmark(request, env) {
	const session = await getSession(getTokenFromRequest(request), env);
	if (!session) return json({ error: 'Unauthorized' }, 401);
	const { slug, title, image, category } = await readJson(request);
	if (!slug || !title) return json({ error: 'Slug and title are required' }, 400);
	const id = generateId();
	try {
		await env.DB.prepare('INSERT INTO bookmarks (id, user_id, article_slug, article_title, article_image, article_category) VALUES (?, ?, ?, ?, ?, ?)')
			.bind(id, session.userId, slug, title, image || '', category || '')
			.run();
		return json({ success: true, id });
	} catch {
		return json({ error: 'Article already bookmarked' }, 409);
	}
}

async function handleDeleteBookmark(request, env) {
	const session = await getSession(getTokenFromRequest(request), env);
	if (!session) return json({ error: 'Unauthorized' }, 401);
	const slug = new URL(request.url).searchParams.get('slug');
	if (!slug) return json({ error: 'Slug is required' }, 400);
	await env.DB.prepare('DELETE FROM bookmarks WHERE user_id = ? AND article_slug = ?').bind(session.userId, slug).run();
	return json({ success: true });
}

async function handleGetBookmarks(request, env) {
	const session = await getSession(getTokenFromRequest(request), env);
	if (!session) return json({ error: 'Unauthorized' }, 401);
	const { results } = await env.DB.prepare(
		'SELECT id, article_slug, article_title, article_image, article_category, saved_at FROM bookmarks WHERE user_id = ? ORDER BY saved_at DESC',
	)
		.bind(session.userId)
		.all();
	return json({ bookmarks: results });
}

async function handleUpdateProfile(request, env) {
	const session = await getSession(getTokenFromRequest(request), env);
	if (!session) return json({ error: 'Unauthorized' }, 401);
	const { displayName, avatarUrl } = await readJson(request);
	if (!displayName || displayName.length < 2) return json({ error: 'Display name must be at least 2 characters' }, 400);
	await env.DB.prepare('UPDATE users SET display_name = ?, avatar_url = ?, updated_at = datetime("now") WHERE id = ?').bind(displayName, avatarUrl || '', session.userId).run();
	return json({ success: true });
}

const ROUTES = {
	'POST /register': handleRegister,
	'POST /login': handleLogin,
	'POST /logout': handleLogout,
	'GET /verify-email': handleVerifyEmail,
	'POST /forgot-password': handleForgotPassword,
	'POST /reset-password': handleResetPassword,
	'GET /me': handleMe,
	'PUT /profile': handleUpdateProfile,
	'GET /bookmarks': handleGetBookmarks,
	'POST /bookmarks': handleSaveBookmark,
	'DELETE /bookmarks': handleDeleteBookmark,
};

export default {
	async fetch(request, env) {
		if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
		const handler = ROUTES[`${request.method} ${new URL(request.url).pathname}`];
		if (!handler) return json({ error: 'Not found' }, 404);
		try {
			return await handler(request, env);
		} catch (err) {
			console.error('auth worker error', err);
			return json({ error: 'Something went wrong. Please try again.' }, 500);
		}
	},
};
