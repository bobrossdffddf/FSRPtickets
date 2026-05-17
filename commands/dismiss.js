const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const cfg = require('../config.json');
const { getTicket, saveTicket } = require('../utils/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dismiss')
        .setDescription('Force-unclaim this ticket. [High Rank+ only]'),

    async execute(interaction) {
        const member = interaction.member;
        const hasPermission = member.roles.cache.has(cfg.roles.highRank) ||
                              member.roles.cache.has(cfg.roles.foundership);

        if (!hasPermission) {
            return interaction.reply({ content: 'High Rank or above required to use this command.', flags: MessageFlags.Ephemeral });
        }

        const ticket = getTicket(interaction.channelId);
        if (!ticket) return interaction.reply({ content: 'This can only be used inside a ticket channel.', flags: MessageFlags.Ephemeral });
        if (!ticket.claimedBy) return interaction.reply({ content: 'This ticket is not currently claimed.', flags: MessageFlags.Ephemeral });

        const previousClaimer = ticket.claimedBy;
        await interaction.channel.permissionOverwrites.delete(ticket.claimedBy).catch(() => {});

        ticket.claimedBy    = null;
        ticket.claimedByTag = null;
        saveTicket(interaction.channelId, ticket);

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.warning)
                .setTitle('Ticket Force-Unclaimed')
                .addFields(
                    { name: 'Dismissed By',   value: `<@${interaction.user.id}>`, inline: true },
                    { name: 'Previous Claim', value: `<@${previousClaimer}>`,     inline: true },
                )
                .setDescription('The ticket has been unclaimed and is available for another staff member.')
                .setFooter({ text: 'Florida State Roleplay' })
                .setTimestamp()
            ],
        });
    },
};
