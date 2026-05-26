const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const cfg           = require('../config.json');
const { getTicket } = require('../utils/db');
const { isStaff }   = require('../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Remove a user from this ticket channel.')
        .addUserOption(opt =>
            opt.setName('user')
               .setDescription('The user to remove')
               .setRequired(true)
        ),

    async execute(interaction) {
        const ticket = getTicket(interaction.channelId);
        if (!ticket) return interaction.reply({ content: 'This can only be used inside a ticket channel.', flags: MessageFlags.Ephemeral });

        const member = interaction.member;
        if (!isStaff(member, interaction.guild) && interaction.user.id !== ticket.openerId) {
            return interaction.reply({ content: 'Only staff or the ticket opener can remove users.', flags: MessageFlags.Ephemeral });
        }

        const target = interaction.options.getUser('user', true);

        if (target.id === ticket.openerId) {
            return interaction.reply({ content: 'You cannot remove the ticket opener.', flags: MessageFlags.Ephemeral });
        }

        if (target.bot) {
            return interaction.reply({ content: 'You cannot remove bots from a ticket.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply();

        await interaction.channel.permissionOverwrites.delete(target.id).catch(() => {});

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.warning)
                .setDescription(`<@${target.id}> has been removed from this ticket.`)
                .setFooter({ text: `Removed by ${interaction.user.username}` })
                .setTimestamp()
            ],
        });
    },
};
