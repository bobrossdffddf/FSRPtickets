/**
 * Roblox lookup — uses the public Roblox API directly (no API key needed).
 *
 * getRobloxInfoByUsername(username)
 *   POST https://users.roblox.com/v1/usernames/users  → resolve username → user ID
 *   GET  https://users.roblox.com/v1/users/{id}       → full user info
 *   GET  https://thumbnails.roblox.com/...             → headshot avatar URL
 */
const fetch = require('node-fetch');

const ROBLOX_USERS     = 'https://users.roblox.com/v1/users';
const ROBLOX_USERNAMES = 'https://users.roblox.com/v1/usernames/users';
const ROBLOX_THUMB     = 'https://thumbnails.roblox.com/v1/users/avatar-headshot';

/**
 * Look up a Roblox user by username.
 * Returns null on any failure so callers can handle gracefully.
 *
 * @param {string} username  — exact Roblox username (case-insensitive)
 * @returns {Promise<{id, username, displayName, created, avatarUrl, profileUrl}|null>}
 */
async function getRobloxInfoByUsername(username) {
    try {
        const trimmed = username.trim();
        console.log(`[Roblox] Looking up username: "${trimmed}"`);

        // ── Step 1: username → user ID ────────────────────────────────────────
        const searchRes = await fetch(ROBLOX_USERNAMES, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ usernames: [trimmed], excludeBannedUsers: false }),
        });
        if (!searchRes.ok) {
            const body = await searchRes.text().catch(() => '');
            console.warn(`[Roblox] Step 1 HTTP ${searchRes.status} for "${trimmed}": ${body}`);
            return null;
        }
        const searchData = await searchRes.json();
        console.log(`[Roblox] Step 1 response:`, JSON.stringify(searchData));

        const match = searchData?.data?.[0];
        if (!match) {
            console.warn(`[Roblox] No user found for username "${trimmed}"`);
            return null;
        }
        const robloxId = match.id;
        console.log(`[Roblox] Resolved "${trimmed}" → ID ${robloxId}`);

        // ── Step 2: full user info ────────────────────────────────────────────
        const userRes = await fetch(`${ROBLOX_USERS}/${robloxId}`);
        if (!userRes.ok) {
            console.warn(`[Roblox] Step 2 HTTP ${userRes.status} for ID ${robloxId}`);
            return null;
        }
        const user = await userRes.json();
        console.log(`[Roblox] Step 2 user: ${user.name} (${user.displayName})`);

        // ── Step 3: headshot avatar ───────────────────────────────────────────
        const thumbRes = await fetch(
            `${ROBLOX_THUMB}?userIds=${robloxId}&size=420x420&format=Png&isCircular=false`
        );
        let avatarUrl = null;
        if (thumbRes.ok) {
            const thumb = await thumbRes.json();
            avatarUrl   = thumb?.data?.[0]?.imageUrl ?? null;
            console.log(`[Roblox] Step 3 avatar: ${avatarUrl}`);
        } else {
            console.warn(`[Roblox] Step 3 HTTP ${thumbRes.status} — continuing without avatar`);
        }

        const created    = new Date(user.created);
        const createdStr = created.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        const yearsAgo   = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24 * 365));

        const result = {
            id:          String(robloxId),
            username:    user.name,
            displayName: user.displayName,
            created:     `${createdStr} (${yearsAgo} year${yearsAgo !== 1 ? 's' : ''} ago)`,
            avatarUrl,
            profileUrl:  `https://www.roblox.com/users/${robloxId}/profile`,
        };
        console.log(`[Roblox] Success:`, JSON.stringify(result));
        return result;
    } catch (err) {
        console.error('[getRobloxInfoByUsername] Unexpected error:', err?.message ?? err);
        return null;
    }
}

module.exports = { getRobloxInfoByUsername };
