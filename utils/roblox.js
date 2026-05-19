/**
 * Roblox lookup helpers — multi-provider with automatic fallback.
 *
 * Provider chain (first success wins):
 *   1. Melonly  — if MELONLY_API_KEY is set in .env
 *      Tries several endpoint variants since their docs are not publicly accessible.
 *   2. Blox.link — if BLOXLINK_API_KEY is set in .env
 *      Popular Discord-Roblox verification service with a well-documented public API.
 *   3. RoVer    — always attempted as a free, no-auth fallback.
 *      Works if the user verified via the RoVer bot.
 *
 * After a Roblox user ID is found from any provider:
 *   4. Roblox Users API      — username / displayName / account created date
 *   5. Roblox Thumbnails API — headshot avatar URL
 */
const fetch = require('node-fetch');

const MELONLY_BASE  = 'https://api.melonly.xyz/api/v1';
const BLOXLINK_BASE = 'https://api.blox.link/v4/public';
const ROVER_BASE    = 'https://verify.eryn.io/api';
const ROBLOX_USERS  = 'https://users.roblox.com/v1/users';
const ROBLOX_THUMB  = 'https://thumbnails.roblox.com/v1/users/avatar-headshot';

// Roblox user IDs are positive integers well under 10 billion (as of 2025).
// Discord snowflakes (~7.6 × 10^18) must be rejected even though they are numeric.
const MAX_ROBLOX_ID = 10_000_000_000;

function isValidRobloxId(val) {
    if (val === null || val === undefined) return false;
    const str = String(val).trim();
    if (!/^\d+$/.test(str)) return false;
    const n = Number(str);
    return n > 0 && n < MAX_ROBLOX_ID;
}

/** Pull the first valid Roblox ID out of a plain object by checking known field names. */
function extractRobloxId(obj, label) {
    const candidates = ['robloxId', 'robloxID', 'roblox_id', 'robloxUserId', 'userId', 'user_id'];
    for (const field of candidates) {
        if (isValidRobloxId(obj[field])) {
            const id = String(obj[field]);
            console.log(`[Roblox lookup] ${label}: found ID in field '${field}' = ${id}`);
            return id;
        }
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider 1 — Melonly
// ─────────────────────────────────────────────────────────────────────────────
async function lookupViaMelonly(discordUserId) {
    const apiKey = process.env.MELONLY_API_KEY;
    if (!apiKey) return null;

    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    // Endpoint variants to try in order
    const variants = [
        `/server/members/discord/${discordUserId}`,
        `/users/discord/${discordUserId}`,
        `/verification/discord/${discordUserId}`,
        `/server/users/discord/${discordUserId}`,
    ];

    for (const path of variants) {
        let res;
        try { res = await fetch(`${MELONLY_BASE}${path}`, { headers }); }
        catch { continue; }

        if (!res.ok) {
            if (res.status !== 404) console.warn(`[Melonly] ${path} → HTTP ${res.status}`);
            continue;
        }

        const data = await res.json();
        console.log(`[Melonly] ${path} raw response:`, JSON.stringify(data));

        const id = extractRobloxId(data, `Melonly ${path}`);
        if (id) return id;

        // If the member record has an internal ID, try the user profile endpoint
        if (data.id && typeof data.id === 'string') {
            try {
                const userRes = await fetch(`${MELONLY_BASE}/users/${data.id}`, { headers });
                if (userRes.ok) {
                    const userData = await userRes.json();
                    console.log(`[Melonly] /users/${data.id} raw response:`, JSON.stringify(userData));
                    const uid = extractRobloxId(userData, `Melonly /users/${data.id}`);
                    if (uid) return uid;
                }
            } catch { /* ignore */ }
        }
    }

    console.warn(`[Melonly] No Roblox ID found for Discord ${discordUserId} across all endpoint variants.`);
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider 2 — Blox.link
// ─────────────────────────────────────────────────────────────────────────────
async function lookupViaBloxlink(discordUserId) {
    const apiKey = process.env.BLOXLINK_API_KEY;
    if (!apiKey) return null;

    try {
        const res = await fetch(
            `${BLOXLINK_BASE}/discord-to-roblox/${discordUserId}`,
            { headers: { 'api-key': apiKey } }
        );
        if (!res.ok) {
            console.warn(`[Blox.link] HTTP ${res.status} for Discord ${discordUserId}`);
            return null;
        }
        const data = await res.json();
        console.log(`[Blox.link] raw response:`, JSON.stringify(data));

        const id = extractRobloxId(data, 'Blox.link');
        if (id) return id;

        // Blox.link v4 also nests it under resolved.roblox.id
        if (isValidRobloxId(data?.resolved?.roblox?.id)) {
            return String(data.resolved.roblox.id);
        }
    } catch (err) {
        console.warn(`[Blox.link] Error: ${err?.message}`);
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider 3 — RoVer (free, no API key)
// ─────────────────────────────────────────────────────────────────────────────
async function lookupViaRover(discordUserId) {
    try {
        const res = await fetch(`${ROVER_BASE}/user/${discordUserId}`);
        if (!res.ok) {
            if (res.status !== 404) console.warn(`[RoVer] HTTP ${res.status} for Discord ${discordUserId}`);
            return null;
        }
        const data = await res.json();
        // RoVer returns { status: 'ok', robloxId: 12345678, robloxUsername: '...' }
        if (data.status === 'ok' && isValidRobloxId(data.robloxId)) {
            console.log(`[RoVer] Found Roblox ID ${data.robloxId} for Discord ${discordUserId}`);
            return String(data.robloxId);
        }
    } catch (err) {
        console.warn(`[RoVer] Error: ${err?.message}`);
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Resolve a Discord user ID → full Roblox account info.
 * Returns null (never throws) so ticket creation always succeeds even without it.
 *
 * @param {string} discordUserId
 * @returns {Promise<{id,username,displayName,created,avatarUrl,profileUrl}|null>}
 */
async function getRobloxInfo(discordUserId) {
    try {
        // ── Step 1: find a Roblox user ID via any available provider ─────────
        let robloxId = await lookupViaMelonly(discordUserId)
                    ?? await lookupViaBloxlink(discordUserId)
                    ?? await lookupViaRover(discordUserId);

        if (!robloxId) {
            console.warn(`[Roblox lookup] All providers failed for Discord ${discordUserId} — user may not be verified.`);
            return null;
        }

        // ── Step 2: Roblox user info ─────────────────────────────────────────
        const userRes = await fetch(`${ROBLOX_USERS}/${robloxId}`);
        if (!userRes.ok) {
            console.warn(`[Roblox] HTTP ${userRes.status} for Roblox ID ${robloxId}`);
            return null;
        }
        const user = await userRes.json();

        // ── Step 3: Avatar headshot ──────────────────────────────────────────
        const thumbRes = await fetch(
            `${ROBLOX_THUMB}?userIds=${robloxId}&size=420x420&format=Png&isCircular=false`
        );
        let avatarUrl = null;
        if (thumbRes.ok) {
            const thumb = await thumbRes.json();
            avatarUrl = thumb?.data?.[0]?.imageUrl ?? null;
        } else {
            console.warn(`[Roblox] Thumbnail HTTP ${thumbRes.status} for ID ${robloxId} — continuing without avatar`);
        }

        const created    = new Date(user.created);
        const createdStr = created.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        const yearsAgo   = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24 * 365));

        return {
            id:          robloxId,
            username:    user.name,
            displayName: user.displayName,
            created:     `${createdStr} (${yearsAgo} year${yearsAgo !== 1 ? 's' : ''} ago)`,
            avatarUrl,
            profileUrl:  `https://www.roblox.com/users/${robloxId}/profile`,
        };
    } catch (err) {
        console.error('[getRobloxInfo] Unexpected error:', err?.message ?? err);
        return null;
    }
}

module.exports = { getRobloxInfo };
