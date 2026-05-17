/**
 * /dismiss  — Force-unclaims a ticket.
 * Only usable by members with the High Rank role (1487127238058180810).
 */
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const cfg                   = require('../config.json');
const { getTicket, saveTicket } = require('../utils/db');

const E = {
    alert: '<:Alert:1488257805071810630>',
    cross: '<:_cross_:1488257725983883437>',
    check: '<:check_yes_wb:1492185650449874994>',
    tools: '<:tools:1491123770214191275>',
    fsrp:  '<:FSRP:1500172509826383922>',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dismiss')
        .setDescription('Force-unclaim a ticket. [High Rank+ only]'),

    async execute(interaction) {
        // ── Role gate ─────────────────────────────────────────────────────────
        const member = interaction.member;
        const hasPermission =
            member.roles.cache.has(cfg.roles.highRank) ||
            member.roles.cache.has(cfg.roles.foundership);

        if (!hasPermission) {
            return interaction.reply({
                content: `${E.alert} You do not have permission to use this command. High Rank or above required.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        const ticket = getTicket(interaction.channelId);
        if (!ticket) {
            return interaction.reply({
                content: `${E.alert} This command can only be used inside a ticket channel.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        if (!ticket.claimedBy) {
            return interaction.reply({
                content: `${E.cross} This ticket is not currently claimed.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        const previousClaimer = ticket.claimedByTag ?? ticket.claimedBy;
        const channel = interaction.channel;

        // ── Remove claimer's individual permission overwrite ───────────────────
        await channel.permissionOverwrites.delete(ticket.claimedBy).catch(() => {});

        // ── Update DB ──────────────────────────────────────────────────────────
        const oldClaimerId  = ticket.claimedBy;
        ticket.claimedBy    = null;
        ticket.claimedByTag = null;
        saveTicket(interaction.channelId, ticket);

        // ── Embed ──────────────────────────────────────────────────────────────
        const embed = new EmbedBuilder()
            .setColor(cfg.colors.warning)
            .setTitle(`${E.tools}  Ticket Force-Unclaimed`)
            .setDescription(
                `This ticket has been **force-unclaimed** by ${E.alert} <@${interaction.user.id}>.\n\n` +
                `${E.cross} **Previous Claimer:** <@${oldClaimerId}> (${previousClaimer})\n` +
                `${E.check} The ticket is now available to be claimed by another staff member.`
            )
            .addFields(
                { name: 'Dismissed By',   value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Previous Claim', value: `<@${oldClaimerId}>`,        inline: true },
            )
            .setFooter({ text: 'Florida State Roleplay  •  Ticket System' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
};
