const fetch = require('node-fetch');

const MELONLY_BASE = 'https://api.melonly.xyz/api/v1';
const ROBLOX_USERS = 'https://users.roblox.com/v1/users';
const ROBLOX_THUMB = 'https://thumbnails.roblox.com/v1/users/avatar-headshot';

// Roblox IDs are positive integers well under 10 billion (as of 2025).
// Discord snowflakes (~7.6 × 10^18) are rejected even though they are numeric.
const MAX_ROBLOX_ID = 10_000_000_000;

function isValidRobloxId(val) {
    if (val === null || val === undefined) return false;
    const str = String(val).trim();
    if (!/^\d+$/.test(str)) return false;
    const n = Number(str);
    return n > 0 && n < MAX_ROBLOX_ID;
}

async function lookupViaMelonly(discordUserId) {
    const apiKey = process.env.MELONLY_API_KEY;
    if (!apiKey) {
        console.warn('[Melonly] MELONLY_API_KEY is not set.');
        return null;
    }

    const url = `${MELONLY_BASE}/verification/discord/${discordUserId}/roblox`;
    let res;
    try {
        res = await fetch(url, {
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        });
    } catch (err) {
        console.warn(`[Melonly] Network error: ${err?.message}`);
        return null;
    }

    if (!res.ok) {
        if (res.status === 401) {
            console.error('[Melonly] API key is invalid or expired — update MELONLY_API_KEY in .env');
        } else if (res.status !== 404) {
            console.warn(`[Melonly] HTTP ${res.status} for Discord ${discordUserId}`);
        }
        return null;
    }

    const data = await res.json();

    if (isValidRobloxId(data?.robloxId)) return String(data.robloxId);

    console.warn(`[Melonly] No valid Roblox ID in response for Discord ${discordUserId}:`, JSON.stringify(data));
    return null;
}

/**
 * Resolve a Discord user ID → full Roblox account info via Melonly.
 * Returns null (never throws) so ticket creation always succeeds even without it.
 *
 * @param {string} discordUserId
 * @returns {Promise<{id,username,displayName,created,avatarUrl,profileUrl}|null>}
 */
async function getRobloxInfo(discordUserId) {
    try {
        const robloxId = await lookupViaMelonly(discordUserId);

        if (!robloxId) {
            console.warn(`[Roblox lookup] Melonly lookup failed for Discord ${discordUserId} — user may not be verified.`);
            return null;
        }

        const userRes = await fetch(`${ROBLOX_USERS}/${robloxId}`);
        if (!userRes.ok) {
            console.warn(`[Roblox] HTTP ${userRes.status} for Roblox ID ${robloxId}`);
            return null;
        }
        const user = await userRes.json();

        const thumbRes = await fetch(
            `${ROBLOX_THUMB}?userIds=${robloxId}&size=420x420&format=Png&isCircular=false`
        );
        let avatarUrl = null;
        if (thumbRes.ok) {
            const thumb = await thumbRes.json();
            avatarUrl = thumb?.data?.[0]?.imageUrl ?? null;
        } else {
            console.warn(`[Roblox] Thumbnail HTTP ${thumbRes.status} for ID ${robloxId}`);
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
