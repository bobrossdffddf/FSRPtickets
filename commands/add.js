const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const cfg           = require('../config.json');
const { getTicket } = require('../utils/db');
const { isStaff }   = require('../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('add')
        .setDescription('Add a user to this ticket channel.')
        .addUserOption(opt =>
            opt.setName('user')
               .setDescription('The user to add')
               .setRequired(true)
        ),

    async execute(interaction) {
        const ticket = getTicket(interaction.channelId);
        if (!ticket) return interaction.reply({ content: 'This can only be used inside a ticket channel.', flags: MessageFlags.Ephemeral });

        const member = interaction.member;
        if (!isStaff(member, interaction.guild) && interaction.user.id !== ticket.openerId) {
            return interaction.reply({ content: 'Only staff or the ticket opener can add users.', flags: MessageFlags.Ephemeral });
        }

        const target = interaction.options.getUser('user', true);

        if (target.bot) {
            return interaction.reply({ content: 'You cannot add bots to a ticket.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply();

        await interaction.channel.permissionOverwrites.edit(target.id, {
            ViewChannel:        true,
            SendMessages:       true,
            ReadMessageHistory: true,
            AttachFiles:        true,
            EmbedLinks:         true,
        });

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.success)
                .setDescription(`<@${target.id}> has been added to this ticket.`)
                .setFooter({ text: `Added by ${interaction.user.username}` })
                .setTimestamp()
            ],
        });
    },
};
