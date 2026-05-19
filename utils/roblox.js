/**
 * Roblox / Melonly helpers.
 *
 * Flow:
 *   1a. Melonly  GET /api/v1/server/members/discord/{discordId}
 *       → returns server member record; may include robloxId directly.
 *   1b. If no Roblox ID found in step 1a, use the internal Melonly `id` to call
 *       GET /api/v1/users/{internalId}  (user profile, which holds the Roblox link).
 *   1c. Fallback: GET /api/v1/users/discord/{discordId}  (direct user lookup).
 *   2.  Roblox Users API      →  username / displayName / account created date
 *   3.  Roblox Thumbnails API →  headshot avatar URL
 *
 * Requires:  MELONLY_API_KEY  in .env
 * Get your key at:  Melonly Dashboard → Panel Settings → API Token
 */
const fetch = require('node-fetch');

const MELONLY_BASE = 'https://api.melonly.xyz/api/v1';
const ROBLOX_USERS = 'https://users.roblox.com/v1/users';
const ROBLOX_THUMB = 'https://thumbnails.roblox.com/v1/users/avatar-headshot';

// Roblox user IDs are positive integers well under 10 billion as of 2025.
// Discord snowflakes (~7.6 × 10^18) and MongoDB ObjectIds (24-char hex)
// must both be rejected.
const MAX_ROBLOX_ID = 10_000_000_000; // 10 billion — generous upper bound

/**
 * Returns true if the value looks like a valid numeric Roblox user ID.
 * Rejects hex strings (MongoDB ObjectIds) and snowflake-sized integers.
 */
function isNumericRobloxId(val) {
    if (val === null || val === undefined) return false;
    const str = String(val).trim();
    if (!/^\d+$/.test(str)) return false;         // must be all digits
    const n = Number(str);
    return n > 0 && n < MAX_ROBLOX_ID;
}

/**
 * Try to extract a Roblox ID from a Melonly API response object.
 * Logs which field was used (or what fields were available if none matched).
 */
function extractRobloxId(data, label) {
    const candidateFields = ['robloxId', 'roblox_id', 'robloxUserId', 'userId', 'user_id', 'id'];
    for (const field of candidateFields) {
        if (isNumericRobloxId(data[field])) {
            const id = String(data[field]);
            console.log(`[Melonly] ${label}: found Roblox ID in field '${field}': ${id}`);
            return id;
        }
    }
    console.warn(`[Melonly] ${label}: no numeric Roblox ID found. Available fields: ${Object.keys(data).join(', ')}`);
    return null;
}

/**
 * Make one authenticated GET request to the Melonly API.
 * Returns parsed JSON on 2xx, null on any non-2xx or error.
 */
async function melonlyGet(path, apiKey, label) {
    let res;
    try {
        res = await fetch(`${MELONLY_BASE}${path}`, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
        });
    } catch (err) {
        console.warn(`[Melonly] ${label}: fetch error — ${err?.message}`);
        return null;
    }

    if (!res.ok) {
        console.warn(`[Melonly] ${label}: HTTP ${res.status}`);
        return null;
    }

    const data = await res.json();
    console.log(`[Melonly] ${label}: raw response:`, JSON.stringify(data));
    return data;
}

/**
 * Resolve a Discord user ID → full Roblox account info via the Melonly API.
 * Returns null (never throws) so callers can still create the ticket without it.
 *
 * @param {string} discordUserId
 * @returns {Promise<{id,username,displayName,created,avatarUrl,profileUrl}|null>}
 */
async function getRobloxInfo(discordUserId) {
    try {
        const apiKey = process.env.MELONLY_API_KEY;
        if (!apiKey) {
            console.warn('[Melonly] MELONLY_API_KEY not set in .env — skipping Roblox auto-lookup.');
            return null;
        }

        // ── Step 1a: server member record ────────────────────────────────────
        let robloxId = null;
        const memberData = await melonlyGet(
            `/server/members/discord/${discordUserId}`, apiKey,
            `member lookup for Discord ${discordUserId}`
        );

        if (memberData) {
            robloxId = extractRobloxId(memberData, 'member record');

            // ── Step 1b: user profile via internal Melonly ID ─────────────────
            if (!robloxId && memberData.id) {
                const userData = await melonlyGet(
                    `/users/${memberData.id}`, apiKey,
                    `user profile for internal ID ${memberData.id}`
                );
                if (userData) robloxId = extractRobloxId(userData, 'user profile');
            }
        }

        // ── Step 1c: direct user endpoint fallback ───────────────────────────
        if (!robloxId) {
            const directData = await melonlyGet(
                `/users/discord/${discordUserId}`, apiKey,
                `direct user lookup for Discord ${discordUserId}`
            );
            if (directData) robloxId = extractRobloxId(directData, 'direct user record');
        }

        if (!robloxId) {
            console.warn(`[Melonly] All lookup attempts failed for Discord ID ${discordUserId} — user may not be verified.`);
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
