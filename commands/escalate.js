const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const cfg = require('../config.json');
const { getTicket, saveTicket } = require('../utils/db');
const { isStaff } = require('../utils/permissions');

const LEVELS = [
    { name: 'Staff',       color: cfg.colors.main,        roleKey: 'staff',       catKey: 'general'     },
    { name: 'High Rank',   color: cfg.colors.highRank,    roleKey: 'highRank',    catKey: 'highRank'    },
    { name: 'Foundership', color: cfg.colors.foundership, roleKey: 'foundership', catKey: 'foundership' },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('escalate')
        .setDescription('Escalate this ticket to the next staff tier.'),

    async execute(interaction) {
        await interaction.deferReply();

        const ticket = getTicket(interaction.channelId);
        if (!ticket) return interaction.editReply({ content: 'This can only be used inside a ticket channel.' });

        const member = interaction.member;
        if (!isStaff(member, interaction.guild)) return interaction.editReply({ content: 'Only staff members can escalate tickets.' });

        if (ticket.escalationLevel >= 2) {
            return interaction.editReply({ content: 'This ticket is already at Foundership level.' });
        }

        const oldLevel = ticket.escalationLevel;
        const newLevel = oldLevel + 1;
        const channel  = interaction.channel;
        const guild    = interaction.guild;

        // Move category
        const newCat = await guild.channels.fetch(cfg.categories[LEVELS[newLevel].catKey]).catch(() => null);
        if (newCat) await channel.setParent(newCat.id, { lockPermissions: false });

        // Remove old tier's role
        await channel.permissionOverwrites.delete(cfg.roles[LEVELS[oldLevel].roleKey]).catch(() => {});

        // Add new tier's role
        await channel.permissionOverwrites.edit(cfg.roles[LEVELS[newLevel].roleKey], {
            ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
            AttachFiles: true, EmbedLinks: true,
        });

        // Claimer keeps individual access
        if (ticket.claimedBy) {
            await channel.permissionOverwrites.edit(ticket.claimedBy, {
                ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
                AttachFiles: true, EmbedLinks: true,
            });
        }

        ticket.escalationLevel = newLevel;
        saveTicket(interaction.channelId, ticket);

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(LEVELS[newLevel].color)
                .setTitle('Ticket Escalated')
                .addFields(
                    { name: 'Escalated By',     value: `<@${interaction.user.id}>`,  inline: true },
                    { name: 'Previous Level',   value: LEVELS[oldLevel].name,         inline: true },
                    { name: 'New Level',        value: LEVELS[newLevel].name,         inline: true },
                )
                .setDescription(`Access has been updated. Only **${LEVELS[newLevel].name}** and above can view this ticket.`)
                .setFooter({ text: 'Florida State Roleplay' })
                .setTimestamp()
            ],
        });
    },
};
