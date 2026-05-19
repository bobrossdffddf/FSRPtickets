/**
 * Roblox / Melonly helpers.
 *
 * Automatic flow (no username typing required):
 *   1. Melonly API  →  GET /api/v1/server/members/discord/{discordId}
 *                      Returns the member's linked Roblox user ID in `id`.
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
 * Resolve a Discord user ID → full Roblox account info via the Melonly API.
 * Returns null (never throws) so callers can still create the ticket without it.
 *
 * @param {string} discordUserId
 * @returns {Promise<{
 *   id: string,
 *   username: string,
 *   displayName: string,
 *   created: string,
 *   avatarUrl: string|null,
 *   profileUrl: string,
 * }|null>}
 */
async function getRobloxInfo(discordUserId) {
    try {
        const apiKey = process.env.MELONLY_API_KEY;
        if (!apiKey) {
            console.warn('[Melonly] MELONLY_API_KEY not set in .env — skipping Roblox auto-lookup.');
            return null;
        }

        // ── Step 1: Melonly → Roblox ID ──────────────────────────────────────
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

        const melData  = await melRes.json();
        const robloxId = melData.id;
        if (!robloxId) {
            console.warn(`[Melonly] No Roblox ID in response for Discord ID ${discordUserId}`);
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
            avatarUrl   = thumb?.data?.[0]?.imageUrl ?? null;
        } else {
            console.warn(`[Roblox] Thumbnail HTTP ${thumbRes.status} for ID ${robloxId} — continuing without avatar`);
        }

        const created    = new Date(user.created);
        const createdStr = created.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        const yearsAgo   = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24 * 365));

        return {
            id:          String(robloxId),
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
