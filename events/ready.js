const cfg = require('../config.json');
const { getAllTickets, deleteTicket } = require('../utils/db');
const { buildTicketOverwrites } = require('../utils/permissions');

module.exports = {
    name: 'clientReady',
    once: true,
    async execute(client) {
        console.log(`\n✅  Logged in as ${client.user.tag}`);
        console.log(`🎟️   FSRP Ticket Bot is online and ready.\n`);
        client.user.setPresence({
            activities: [{ name: 'Join A department today!', type: 3 }],
            status: 'online',
        });

        // ── Sync permissions on all active ticket channels ────────────────────
        const guild = client.guilds.cache.get(cfg.guildId)
            ?? await client.guilds.fetch(cfg.guildId).catch(() => null);
        if (!guild) return;

        await guild.roles.fetch();   // populate role cache before position lookups

        const tickets = getAllTickets();
        const entries = Object.entries(tickets);
        if (!entries.length) return;

        console.log(`[Ready] Syncing permissions on ${entries.length} active ticket(s)…`);
        let synced = 0, pruned = 0;

        for (const [channelId, ticket] of entries) {
            const channel = guild.channels.cache.get(channelId)
                ?? await guild.channels.fetch(channelId).catch(() => null);

            if (!channel) {
                deleteTicket(channelId);
                pruned++;
                continue;
            }

            const overwrites = buildTicketOverwrites(guild, ticket.openerId, ticket.claimedBy ?? null);
            await channel.permissionOverwrites.set(overwrites).catch(err =>
                console.error(`[Ready] Failed to update #${channel.name}:`, err.message)
            );
            synced++;
        }

        console.log(`[Ready] Done — ${synced} synced, ${pruned} stale ticket(s) pruned.\n`);
    },
};
