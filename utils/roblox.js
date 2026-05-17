/**
 * Roblox / Melonly helpers.
 *
 * Flow:
 *   1. Melonly API  → GET /api/v1/server/members/discord/{discordId}
 *                     Returns: { id, roles, createdAt, serverId }
 *                     The `id` field is the member's linked Roblox user ID.
 *
 *   2. Roblox Users API     → username / displayName / account created date
 *   3. Roblox Thumbnails API → headshot avatar URL
 *
 * Requires:  MELONLY_API_KEY  in .env
 * Get your key at:  Melonly Dashboard → Panel Settings → API Token
 */
const fetch = require('node-fetch');

const MELONLY_BASE  = 'https://api.melonly.xyz/api/v1';
const ROBLOX_USERS  = 'https://users.roblox.com/v1/users';
const ROBLOX_THUMB  = 'https://thumbnails.roblox.com/v1/users/avatar-headshot';

/**
 * Resolve a Discord user ID → full Roblox account info via the Melonly API.
 * Returns null (never throws) so callers can still create tickets without it.
 *
 * @param {string} discordUserId
 * @returns {Promise<{
 *   id: string,
 *   username: string,
 *   displayName: string,
 *   created: string,
 *   avatarUrl: string|null,
 *   profileUrl: string,
 *   melonlyRoles: string[],
 *   melonlyJoined: string,
 * }|null>}
 */
async function getRobloxInfo(discordUserId) {
    try {
        // ── Step 1: Melonly member lookup (Discord ID → Melonly member record) ─
        const melRes = await fetch(
            `${MELONLY_BASE}/server/members/discord/${discordUserId}`,
            {
                headers: {
                    Authorization: `Bearer ${process.env.MELONLY_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        if (!melRes.ok) return null;
        const melData = await melRes.json();

        // `id` is the Roblox user ID stored by Melonly upon verification
        const robloxId     = melData.id;
        const melonlyRoles = melData.roles ?? [];
        const melonlyJoinedAt = melData.createdAt
            ? new Date(melData.createdAt * 1000).toLocaleDateString('en-US', {
                month: 'long', day: 'numeric', year: 'numeric',
              })
            : 'Unknown';

        if (!robloxId) return null;

        // ── Step 2: Roblox user info ─────────────────────────────────────────
        const userRes = await fetch(`${ROBLOX_USERS}/${robloxId}`);
        if (!userRes.ok) return null;
        const user = await userRes.json();

        // ── Step 3: Avatar headshot ──────────────────────────────────────────
        const thumbRes = await fetch(
            `${ROBLOX_THUMB}?userIds=${robloxId}&size=180x180&format=Png&isCircular=false`
        );
        let avatarUrl = null;
        if (thumbRes.ok) {
            const thumb = await thumbRes.json();
            avatarUrl   = thumb?.data?.[0]?.imageUrl ?? null;
        }

        // ── Format account age ───────────────────────────────────────────────
        const created    = new Date(user.created);
        const createdStr = created.toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
        });
        const yearsAgo = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24 * 365));

        return {
            id:             String(robloxId),
            username:       user.name,
            displayName:    user.displayName,
            created:        `${createdStr} (${yearsAgo} year${yearsAgo !== 1 ? 's' : ''} ago)`,
            avatarUrl,
            profileUrl:     `https://www.roblox.com/users/${robloxId}/profile`,
            melonlyRoles,
            melonlyJoined:  melonlyJoinedAt,
        };
    } catch (err) {
        console.error('[getRobloxInfo] Error:', err?.message ?? err);
        return null;
    }
}

module.exports = { getRobloxInfo };
