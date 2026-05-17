/**
 * Roblox helpers.
 *
 * Flow:
 *   1. Bloxlink API → resolve Discord user ID → Roblox user ID
 *   2. Roblox Users API → username / display name / created date
 *   3. Roblox Thumbnails API → headshot avatar URL
 *
 * Requires:  BLOXLINK_API_KEY  in .env
 * Get your key at:  https://blox.link/dashboard/developer
 */
const fetch = require('node-fetch');
const cfg   = require('../config.json');

const BLOXLINK_BASE = 'https://api.blox.link/v4/public';
const ROBLOX_USERS  = 'https://users.roblox.com/v1/users';
const ROBLOX_THUMB  = 'https://thumbnails.roblox.com/v1/users/avatar-headshot';

/**
 * Resolve a Discord user ID → Roblox account info via Bloxlink.
 * Returns null (never throws) so callers can still create tickets.
 *
 * @param {string} discordUserId
 * @returns {Promise<{id:string, username:string, displayName:string, created:string, avatarUrl:string}|null>}
 */
async function getRobloxInfo(discordUserId) {
    try {
        // ── Step 1: Bloxlink lookup ──────────────────────────────────────────
        const bloxRes = await fetch(
            `${BLOXLINK_BASE}/guilds/${cfg.guildId}/discord-to-roblox/${discordUserId}`,
            { headers: { Authorization: process.env.BLOXLINK_API_KEY } }
        );
        if (!bloxRes.ok) return null;
        const bloxData = await bloxRes.json();
        const robloxId = bloxData.robloxID ?? bloxData.resolved?.roblox?.id;
        if (!robloxId) return null;

        // ── Step 2: User info ────────────────────────────────────────────────
        const userRes  = await fetch(`${ROBLOX_USERS}/${robloxId}`);
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

        const created = new Date(user.created);
        const createdStr = created.toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric'
        });
        const yearsAgo = Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24 * 365));

        return {
            id:          String(robloxId),
            username:    user.name,
            displayName: user.displayName,
            created:     `${createdStr} (${yearsAgo} year${yearsAgo !== 1 ? 's' : ''} ago)`,
            avatarUrl,
            profileUrl:  `https://www.roblox.com/users/${robloxId}/profile`,
        };
    } catch {
        return null;
    }
}

module.exports = { getRobloxInfo };
