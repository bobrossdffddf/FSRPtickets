const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const cfg           = require('../config.json');
const { getTicket } = require('../utils/db');
const { isStaff }   = require('../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rename')
        .setDescription('Rename this ticket channel.')
        .addStringOption(opt =>
            opt.setName('name')
               .setDescription('New channel name')
               .setRequired(true)
               .setMaxLength(90)
        ),

    async execute(interaction) {
        const ticket = getTicket(interaction.channelId);
        if (!ticket) return interaction.reply({ content: 'This can only be used inside a ticket channel.', flags: MessageFlags.Ephemeral });

        const member = interaction.member;
        if (!isStaff(member, interaction.guild) && interaction.user.id !== ticket.openerId) {
            return interaction.reply({ content: 'Only staff or the ticket opener can rename this ticket.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply();

        const safeName = interaction.options.getString('name', true)
            .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '').substring(0, 90);

        const oldName = interaction.channel.name;
        await interaction.channel.setName(safeName);

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.neutral)
                .setTitle('Channel Renamed')
                .addFields(
                    { name: 'Before', value: `\`${oldName}\``,  inline: true },
                    { name: 'After',  value: `\`${safeName}\``, inline: true },
                )
                .setFooter({ text: `Renamed by ${interaction.user.username}` })
                .setTimestamp()
            ],
        });
    },
};
