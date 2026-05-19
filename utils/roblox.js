/**
 * Roblox / Melonly helpers.
 *
 * Flow:
 *   1. Melonly API  →  GET /api/v1/server/members/discord/{discordId}
 *                      Finds the linked Roblox account for a verified Discord user.
 *   2. Roblox Users API      →  username / displayName / account created date
 *   3. Roblox Thumbnails API →  headshot avatar URL
 *
 * Requires:  MELONLY_API_KEY  in .env
 * Get your key at:  Melonly Dashboard → Panel Settings → API Token
 */
const fetch = require('node-fetch');

const MELONLY_BASE = 'https://api.melonly.xyz/api/v1';
const ROBLOX_USERS = 'https://users.roblox.com/v1/users';
const ROBLOX_THUMB = 'https://thumbnails.roblox.com/v1/users/avatar-headshot';

/**
 * Returns true if the value looks like a valid numeric Roblox ID.
 * Roblox IDs are always positive integers.
 * Rejects MongoDB ObjectIds (24-char hex strings) and other garbage.
 */
function isNumericRobloxId(val) {
    if (val === null || val === undefined) return false;
    const str = String(val).trim();
    return /^\d+$/.test(str) && Number(str) > 0;
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

        // ── Step 1: Melonly → member record ──────────────────────────────────
        const melRes = await fetch(
            `${MELONLY_BASE}/server/members/discord/${discordUserId}`,
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        if (!melRes.ok) {
            console.warn(`[Melonly] HTTP ${melRes.status} for Discord ID ${discordUserId} — user may not be verified.`);
            return null;
        }

        const melData = await melRes.json();

        // Log the full response once so we can see the exact field names
        console.log(`[Melonly] Raw response for ${discordUserId}:`, JSON.stringify(melData));

        // The Melonly API returns their internal MongoDB ObjectId in `id`.
        // The actual Roblox user ID (a positive integer) may be in a different field.
        // We try all known field names and take the first one that looks like a real Roblox ID.
        const candidateFields = ['robloxId', 'roblox_id', 'userId', 'user_id', 'robloxUserId', 'id'];
        let robloxId = null;
        for (const field of candidateFields) {
            if (isNumericRobloxId(melData[field])) {
                robloxId = String(melData[field]);
                console.log(`[Melonly] Found Roblox ID in field '${field}': ${robloxId}`);
                break;
            }
        }

        if (!robloxId) {
            console.warn(`[Melonly] Could not find a numeric Roblox ID in the response. ` +
                `Available fields: ${Object.keys(melData).join(', ')}`);
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
