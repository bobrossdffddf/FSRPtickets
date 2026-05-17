const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const cfg           = require('../config.json');
const { getTicket } = require('../utils/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('closerequest')
        .setDescription('Send a close request to the ticket opener.'),

    async execute(interaction) {
        const ticket = getTicket(interaction.channelId);
        if (!ticket) return interaction.reply({ content: 'This can only be used inside a ticket channel.', flags: MessageFlags.Ephemeral });

        const member  = interaction.member;
        const isStaff = member.roles.cache.has(cfg.roles.staff) ||
                        member.roles.cache.has(cfg.roles.highRank) ||
                        member.roles.cache.has(cfg.roles.foundership);
        if (!isStaff) return interaction.reply({ content: 'Only staff can send a close request.', flags: MessageFlags.Ephemeral });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('closereq_accept').setLabel('Accept — Close Ticket').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('closereq_deny').setLabel('Deny — Keep Open').setStyle(ButtonStyle.Danger),
        );

        await interaction.reply({
            content: `<@${ticket.openerId}>`,
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.warning)
                .setTitle('Close Request')
                .setDescription(
                    `<@${ticket.openerId}>, a staff member is requesting to close your ticket.\n\n` +
                    `Click **Accept** if your issue has been resolved, or **Deny** if you still need help.`
                )
                .addFields({ name: 'Requested By', value: `<@${interaction.user.id}>`, inline: true })
                .setFooter({ text: 'Florida State Roleplay' })
                .setTimestamp()
            ],
            components: [row],
        });
    },
};
