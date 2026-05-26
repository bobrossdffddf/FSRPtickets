/**
 * /panel — sends the support panel to the current channel using Discord Components V2.
 * Restricted to HR (highRank) and above.
 */
const {
    SlashCommandBuilder,
    ContainerBuilder,
    SeparatorBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    PermissionFlagsBits,
    MessageFlags,
    SeparatorSpacingSize,
} = require('discord.js');
const cfg            = require('../config.json');
const { loadImages } = require('../utils/images');
const { isHighRank } = require('../utils/permissions');

const E = {
    fsrp:   '<:FSRP:1500172509826383922>',
    ticket: '<:ticket:1491123553985232946>',
    shield: '<:shield:1491123625762492558>',
    info:   '<:information:1492185664211386561>',
};

function hexToInt(hex) {
    return parseInt(hex.replace('#', ''), 16);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Send the FSRP support panel to this channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const member = interaction.member;
        if (!isHighRank(member, interaction.guild)) {
            return interaction.editReply({ content: 'This command requires the High Rank role or above.' });
        }

        const imgs = loadImages();
        const topBannerUrl    = imgs.topBanner    ?? null;
        const bottomBannerUrl = imgs.bottomBanner ?? imgs.banner ?? null;

        const container = new ContainerBuilder().setAccentColor(hexToInt(cfg.colors.main));

        if (topBannerUrl) {
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems({ media: { url: topBannerUrl } })
            );
        }

        container
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `## ${E.fsrp}  FSRP: Florida State Roleplay | Support Portal\n\n` +
                    `${E.info} **Welcome to FSRP Support.**\n` +
                    `We are here to help! Please create a ticket and a member of our staff team will assist you with any questions or concerns.`
                )
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `${E.ticket}  **General Support**\n` +
                    `> Questions, concerns, partnership inquiries, verifications, and general help.\n\n` +
                    `${E.shield}  **Staff Report**\n` +
                    `> Report a staff member for misconduct, abuse of power, or rule violations.`
                )
            )
            .addSeparatorComponents(
                new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('Select a category below to open a ticket.')
            );

        if (bottomBannerUrl) {
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems({ media: { url: bottomBannerUrl } })
            );
        }

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

        await interaction.channel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [container, row],
        });

        await interaction.editReply({ content: `${E.fsrp} Panel sent successfully.` });
    },
};
