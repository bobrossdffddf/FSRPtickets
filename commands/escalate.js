/**
 * /escalate  — escalates a ticket to the next tier.
 *
 * Level 0 (Staff)       → Level 1 (High Rank)
 * Level 1 (High Rank)   → Level 2 (Foundership)
 *
 * When escalated:
 *  • Channel moves to the appropriate category
 *  • The previous tier's role loses ALL channel permission overwrites
 *  • The new tier's role gains view + send permissions
 *  • The claimer (if any) keeps their individual overwrite
 *  • All other staff (not the claimer) lose access
 */
const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    OverwriteType,
} = require('discord.js');
const cfg              = require('../config.json');
const { getTicket, saveTicket } = require('../utils/db');

const E = {
    fsrp:      '<:FSRP:1500172509826383922>',
    alert:     '<:Alert:1488257805071810630>',
    crown:     '<:crown:1491123666296246373>',
    ownership: '<:Ownewrship:1492169279984893973>',
    director:  '<:Director:1492005574119002122>',
    shield:    '<:shield:1491123625762492558>',
    arrow:     '<:602327arrow:1490922152806060203>',
};

const LEVEL_NAMES   = ['Staff',       'High Rank',    'Foundership'];
const LEVEL_COLORS  = [cfg.colors.main, cfg.colors.highRank, cfg.colors.foundership];
const LEVEL_EMOJIS  = [E.shield,      E.director,     E.ownership];
const LEVEL_ROLES   = [cfg.roles.staff, cfg.roles.highRank, cfg.roles.foundership];
const LEVEL_CATS    = [cfg.categories.general, cfg.categories.highRank, cfg.categories.foundership];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('escalate')
        .setDescription('Escalate this ticket to the next staff tier.'),

    async execute(interaction) {
        await interaction.deferReply();

        const ticket = getTicket(interaction.channelId);
        if (!ticket) {
            return interaction.editReply({ content: `${E.alert} This command can only be used inside a ticket channel.` });
        }

        // ── Permission: must be staff, HR, or foundership ─────────────────────
        const member  = interaction.member;
        const isStaff = member.roles.cache.has(cfg.roles.staff) ||
                        member.roles.cache.has(cfg.roles.highRank) ||
                        member.roles.cache.has(cfg.roles.foundership);
        if (!isStaff) {
            return interaction.editReply({ content: `${E.alert} Only staff members can escalate tickets.` });
        }

        if (ticket.escalationLevel >= 2) {
            return interaction.editReply({ content: `${E.ownership} This ticket is already at **Foundership** level — the highest tier.` });
        }

        const oldLevel = ticket.escalationLevel;
        const newLevel = oldLevel + 1;
        const channel  = interaction.channel;
        const guild    = interaction.guild;

        // ── Move to new category ───────────────────────────────────────────────
        const newCategory = await guild.channels.fetch(LEVEL_CATS[newLevel]).catch(() => null);
        if (newCategory) await channel.setParent(newCategory.id, { lockPermissions: false });

        // ── Update permission overwrites ───────────────────────────────────────
        // 1. Remove old tier's role overwrite
        await channel.permissionOverwrites.delete(LEVEL_ROLES[oldLevel]).catch(() => {});

        // 2. If going from staff → HR, also remove staff role entirely (except claimer)
        if (oldLevel === 0) {
            await channel.permissionOverwrites.delete(cfg.roles.staff).catch(() => {});
        }
        if (oldLevel === 1) {
            await channel.permissionOverwrites.delete(cfg.roles.highRank).catch(() => {});
        }

        // 3. Grant new role access
        await channel.permissionOverwrites.edit(LEVEL_ROLES[newLevel], {
            ViewChannel:       true,
            SendMessages:      true,
            ReadMessageHistory: true,
            AttachFiles:       true,
            EmbedLinks:        true,
        });

        // 4. If there's a claimer, ensure they keep access (individual overwrite)
        if (ticket.claimedBy) {
            await channel.permissionOverwrites.edit(ticket.claimedBy, {
                ViewChannel:       true,
                SendMessages:      true,
                ReadMessageHistory: true,
                AttachFiles:       true,
                EmbedLinks:        true,
            });
        }

        // ── Update DB ──────────────────────────────────────────────────────────
        ticket.escalationLevel = newLevel;
        saveTicket(interaction.channelId, ticket);

        // ── Send escalation embed ──────────────────────────────────────────────
        const embed = new EmbedBuilder()
            .setColor(LEVEL_COLORS[newLevel])
            .setTitle(`${E.alert}  Ticket Escalated`)
            .setDescription(
                `${E.arrow} This ticket has been escalated to **${LEVEL_NAMES[newLevel]}**.\n\n` +
                `${LEVEL_EMOJIS[newLevel]} **New Level:** ${LEVEL_NAMES[newLevel]}\n` +
                `${LEVEL_EMOJIS[oldLevel]} **Previous Level:** ${LEVEL_NAMES[oldLevel]}\n\n` +
                `> Access has been updated. Only ${LEVEL_NAMES[newLevel]} members and above may view this ticket.`
            )
            .addFields(
                { name: 'Escalated By',    value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Escalation Level', value: LEVEL_NAMES[newLevel],       inline: true },
            )
            .setFooter({ text: 'Florida State Roleplay  •  Ticket System' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
