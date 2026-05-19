const {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    MessageFlags,
} = require('discord.js');
const cfg           = require('../config.json');
const { getTicket } = require('../utils/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription('Close this ticket and generate a transcript.'),

    async execute(interaction) {
        const ticket = getTicket(interaction.channelId);
        if (!ticket) return interaction.reply({ content: 'This can only be used inside a ticket channel.', flags: MessageFlags.Ephemeral });

        const member   = interaction.member;
        const isStaff  = member.roles.cache.has(cfg.roles.staff) ||
                         member.roles.cache.has(cfg.roles.highRank) ||
                         member.roles.cache.has(cfg.roles.foundership);
        const isOpener = interaction.user.id === ticket.openerId;

        if (!isStaff && !isOpener) {
            return interaction.reply({ content: 'You do not have permission to close this ticket.', flags: MessageFlags.Ephemeral });
        }

        // Show the close-reason modal — same as the button flow
        const modal = new ModalBuilder()
            .setCustomId('modal_close_ticket')
            .setTitle('Close Ticket');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('close_reason')
                    .setLabel('Reason for closing')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('e.g. Resolved, User did not respond, Duplicate ticket, Invalid/spam…')
                    .setRequired(true)
                    .setMinLength(3)
                    .setMaxLength(500)
            ),
        );

        return interaction.showModal(modal);
    },
};
