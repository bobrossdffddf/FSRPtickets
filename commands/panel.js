/**
 * /panel  — sends the support panel embed to the current channel.
 * Only usable by staff+.
 */
const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    PermissionFlagsBits,
} = require('discord.js');
const cfg = require('../config.json');

const E = {
    fsrp:   '<:FSRP:1500172509826383922>',
    ticket: '<:ticket:1491123553985232946>',
    shield: '<:shield:1491123625762492558>',
    info:   '<:information:1492185664211386561>',
    bell:   '<:bell:1492185923964637364>',
    FHP:    '<:FHP:1502769420605587527>',
    PD:     '<:PD:1502770159633436832>',
    FD:     '<:FD:1502770440324776077>',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Send the FSRP support panel to this channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const embed = new EmbedBuilder()
            .setColor(cfg.colors.main)
            .setTitle(`${E.fsrp}  Florida State Roleplay — Support`)
            .setDescription(
                `${E.info} **Welcome to FSRP Support.**\n` +
                `Our staff team is here to assist you with any questions or concerns.\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `${E.ticket}  **General Support**\n` +
                `> Questions, concerns, partnership inquiries, verifications, and general help.\n\n` +
                `${E.shield}  **Staff Report**\n` +
                `> Report a staff member for misconduct, abuse of power, or rule violations.\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `${E.bell} Select a category below to open a ticket. Please be detailed in your request.`
            )
            .setThumbnail('https://i.imgur.com/placeholder.png')   // swap for FSRP logo URL
            .setFooter({ text: 'Florida State Roleplay  •  Support System' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('ticket_panel_select')
                .setPlaceholder('Select a support category…')
                .addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel('General Support')
                        .setDescription('Questions, concerns, partnerships, and general help.')
                        .setValue('general')
                        .setEmoji({ id: '1491123553985232946', name: 'ticket' }),
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Staff Report')
                        .setDescription('Report a staff member for misconduct or rule violations.')
                        .setValue('staffreport')
                        .setEmoji({ id: '1491123625762492558', name: 'shield' }),
                )
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        await interaction.editReply({ content: `${E.fsrp} Panel sent successfully.` });
    },
};
