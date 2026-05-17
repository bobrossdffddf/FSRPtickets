const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const cfg           = require('../config.json');
const { getTicket } = require('../utils/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription('Close this ticket and generate a transcript.'),

    async execute(interaction) {
        const ticket = getTicket(interaction.channelId);
        if (!ticket) return interaction.reply({ content: 'This can only be used inside a ticket channel.', flags: MessageFlags.Ephemeral });

        const member  = interaction.member;
        const isStaff = member.roles.cache.has(cfg.roles.staff) ||
                        member.roles.cache.has(cfg.roles.highRank) ||
                        member.roles.cache.has(cfg.roles.foundership);
        const isOpener = interaction.user.id === ticket.openerId;

        if (!isStaff && !isOpener) {
            return interaction.reply({ content: 'You do not have permission to close this ticket.', flags: MessageFlags.Ephemeral });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirm_close_ticket').setLabel('Confirm Close').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('cancel_close_ticket').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        );

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.warning)
                .setTitle('Close Ticket?')
                .setDescription('A transcript will be saved and the channel will be deleted.\n\nAre you sure?')
                .setFooter({ text: `Requested by ${interaction.user.username}` })
            ],
            components: [row],
            flags: MessageFlags.Ephemeral,
        });
    },
};
