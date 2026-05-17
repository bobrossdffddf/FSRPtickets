/**
 * Melonly → Roblox lookup
 *
 * Step 1: GET https://api.melonly.xyz/api/v1/server/members/discord/{discordId}
 *         Auth: Bearer MELONLY_API_KEY
 *         Returns: { id, roles, createdAt, serverId }
 *         → `id` is the member's linked Roblox user ID
 *
 * Step 2: Roblox Users API    → username, displayName, created
 * Step 3: Roblox Thumbnails   → headshot avatar URL
 *
 * Get your Melonly API key:  melonly.xyz → Dashboard → Panel Settings → API Token
 */
const fetch = require('node-fetch');

const MELONLY_BASE = 'https://api.melonly.xyz/api/v1';
const ROBLOX_USERS = 'https://users.roblox.com/v1/users';
const ROBLOX_THUMB = 'https://thumbnails.roblox.com/v1/users/avatar-headshot';

async function getRobloxInfo(discordUserId) {
    try {
        // ── Step 1: Melonly member lookup ─────────────────────────────────────
        const melRes = await fetch(
            `${MELONLY_BASE}/server/members/discord/${discordUserId}`,
            { headers: { Authorization: `Bearer ${process.env.MELONLY_API_KEY}` } }
        );

        if (!melRes.ok) {
            console.warn(`[Melonly] HTTP ${melRes.status} for Discord ID ${discordUserId}`);
            return null;
        }

        const melData  = await melRes.json();
        console.log(`[Melonly] Raw response for ${discordUserId}:`, JSON.stringify(melData));

        const robloxId = melData.id;
        if (!robloxId) {
            console.warn('[Melonly] No id field in response — user may not be verified.');
            return null;
        }

        // ── Step 2: Roblox user info ──────────────────────────────────────────
        const userRes = await fetch(`${ROBLOX_USERS}/${robloxId}`);
        if (!userRes.ok) {
            console.warn(`[Roblox] HTTP ${userRes.status} for Roblox ID ${robloxId}`);
            return null;
        }
        const user = await userRes.json();

        // ── Step 3: Avatar headshot ───────────────────────────────────────────
        const thumbRes = await fetch(`${ROBLOX_THUMB}?userIds=${robloxId}&size=180x180&format=Png&isCircular=false`);
        let avatarUrl  = null;
        if (thumbRes.ok) {
            const thumb = await thumbRes.json();
            avatarUrl   = thumb?.data?.[0]?.imageUrl ?? null;
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
        console.error('[getRobloxInfo] Error:', err?.message ?? err);
        return null;
    }
}

module.exports = { getRobloxInfo };
