/**
 * /partnership — sends a partnership application prompt to the ticket opener.
 * Staff-only. Must be used inside an active ticket channel.
 */
const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require('discord.js');

const cfg        = require('../config.json');
const { getTicket, saveTicket } = require('../utils/db');
const { isStaff }   = require('../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('partnership')
        .setDescription('Send a partnership application form to the ticket opener.'),

    async execute(interaction) {
        const { channel, member } = interaction;

        if (!isStaff(member, interaction.guild)) {
            return interaction.reply({
                content: 'Only staff can use this command.',
                flags: MessageFlags.Ephemeral,
            });
        }

        const ticket = getTicket(channel.id);
        if (!ticket) {
            return interaction.reply({
                content: 'This command can only be used inside an active ticket channel.',
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferReply();

        const embed = new EmbedBuilder()
            .setColor(cfg.colors.main)
            .setTitle('Partnership Application')
            .setDescription(
                `<@${ticket.openerId}>, to proceed with your partnership request please click the button below.\n\n` +
                `You will be asked to provide:\n` +
                `• Your **server name**\n` +
                `• Your full **server advertisement**\n` +
                `• Your **representatives** in our server (optional)\n\n` +
                `Only you can submit this form.`
            )
            .setFooter({ text: 'Florida State Roleplay  •  Partnerships' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`partnership_apply:${ticket.openerId}`)
                .setLabel('Submit Partnership Application')
                .setStyle(ButtonStyle.Primary),
        );

        await interaction.editReply({ embeds: [embed], components: [row] });

        // Rename channel to partnership-{opener}
        const safeUsername = ticket.openerTag.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 90);
        await channel.edit({ name: `partnership-${safeUsername}` })
            .catch(err => console.error('[Partnership] Failed to rename channel:', err?.message));

        // Escalate to High Rank category (mirrors /escalate level 0 → 1)
        if (ticket.escalationLevel < 1) {
            const hrCat = await interaction.guild.channels.fetch(cfg.categories.highRank).catch(() => null);
            if (hrCat) await channel.setParent(hrCat.id, { lockPermissions: false }).catch(() => {});

            for (const roleId of cfg.ticketRoles.gen) {
                await channel.permissionOverwrites.delete(roleId).catch(() => {});
            }
            for (const roleId of cfg.ticketRoles.hr) {
                await channel.permissionOverwrites.edit(roleId, {
                    ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
                    AttachFiles: true, EmbedLinks: true,
                }).catch(() => {});
            }

            if (ticket.claimedBy) {
                await channel.permissionOverwrites.edit(ticket.claimedBy, {
                    ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
                    AttachFiles: true, EmbedLinks: true,
                }).catch(() => {});
            }

            ticket.escalationLevel = 1;
            saveTicket(channel.id, ticket);
        }
    },
};
