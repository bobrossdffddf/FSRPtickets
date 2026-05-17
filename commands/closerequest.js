/**
 * /closerequest  — Sends a close request to the ticket opener.
 * The opener can Accept (close) or Deny (keep open).
 * Usable by claimer or staff.
 */
const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const cfg           = require('../config.json');
const { getTicket } = require('../utils/db');

const E = {
    alert:  '<:Alert:1488257805071810630>',
    bell:   '<:bell:1492185923964637364>',
    cross:  '<:_cross_:1488257725983883437>',
    check:  '<:check_yes_wb:1492185650449874994>',
    ticket: '<:ticket:1491123553985232946>',
    fsrp:   '<:FSRP:1500172509826383922>',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('closerequest')
        .setDescription('Ask the ticket opener if this ticket can be closed.'),

    async execute(interaction) {
        const ticket = getTicket(interaction.channelId);
        if (!ticket) {
            return interaction.reply({
                content: `${E.alert} This command can only be used inside a ticket channel.`,
                ephemeral: true,
            });
        }

        // ── Permission: staff or claimer ──────────────────────────────────────
        const member  = interaction.member;
        const isStaff = member.roles.cache.has(cfg.roles.staff) ||
                        member.roles.cache.has(cfg.roles.highRank) ||
                        member.roles.cache.has(cfg.roles.foundership);
        if (!isStaff) {
            return interaction.reply({
                content: `${E.alert} Only staff members can send a close request.`,
                ephemeral: true,
            });
        }

        const embed = new EmbedBuilder()
            .setColor(cfg.colors.warning)
            .setTitle(`${E.bell}  Close Request`)
            .setDescription(
                `<@${ticket.openerId}> — a staff member is requesting to close your ticket.\n\n` +
                `${E.check} Click **Accept** if your issue has been resolved and you are happy to close the ticket.\n` +
                `${E.cross} Click **Deny** if your issue is still ongoing and you need further assistance.\n\n` +
                `*If no response is given, the ticket may be closed after an extended period of inactivity.*`
            )
            .addFields(
                { name: 'Requested By', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Ticket',       value: `#${String(ticket.ticketNumber).padStart(4, '0')}`, inline: true },
            )
            .setFooter({ text: 'Florida State Roleplay  •  Ticket System' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('closereq_accept')
                .setLabel('Accept — Close Ticket')
                .setStyle(ButtonStyle.Success)
                .setEmoji({ id: '1492185650449874994', name: 'check_yes_wb' }),
            new ButtonBuilder()
                .setCustomId('closereq_deny')
                .setLabel('Deny — Keep Open')
                .setStyle(ButtonStyle.Danger)
                .setEmoji({ id: '1488257725983883437', name: '_cross_' }),
        );

        await interaction.reply({ content: `<@${ticket.openerId}>`, embeds: [embed], components: [row] });
    },
};
