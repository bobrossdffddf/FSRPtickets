/**
 * /test — Admin-only panel that creates tickets WITHOUT pinging anyone.
 * Useful for testing the ticket flow without spamming staff/user mentions.
 */
const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');
const cfg            = require('../config.json');
const { loadImages } = require('../utils/images');

const E = {
    fsrp:   '<:FSRP:1500172509826383922>',
    ticket: '<:ticket:1491123553985232946>',
    shield: '<:shield:1491123625762492558>',
    info:   '<:information:1492185664211386561>',
    bell:   '<:bell:1492185923964637364>',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('test')
        .setDescription('[Admin] Send a no-ping test panel to this channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply({ content: 'This command requires Administrator permission.' });
        }

        const imgs = loadImages();
        const thumbnailUrl    = imgs.thumbnail  || (cfg.images?.panelThumbnail?.startsWith('REPLACE')  ? null : cfg.images?.panelThumbnail);
        const footerIconUrl   = imgs.footerIcon || (cfg.images?.panelFooterIcon?.startsWith('REPLACE') ? null : cfg.images?.panelFooterIcon);
        const topBannerUrl    = imgs.topBanner    ?? null;
        const bottomBannerUrl = imgs.bottomBanner ?? imgs.banner ?? null;

        const embed = new EmbedBuilder()
            .setColor(cfg.colors.main)
            .setTitle(`${E.fsrp}  Florida State Roleplay — Support (Test Mode)`)
            .setDescription(
                `${E.info} **Welcome to FSRP Support.**\n` +
                `Our staff team is here to assist you with any questions or concerns.\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                `${E.ticket}  **General Support**\n` +
                `> Questions, concerns, partnership inquiries, verifications, and general help.\n\n` +
                `${E.shield}  **Staff Report**\n` +
                `> Report a staff member for misconduct, abuse of power, or rule violations.\n\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `${E.bell} Select a category below to open a ticket. Please be detailed in your request.\n\n` +
                `⚠️ **TEST MODE — No pings will be sent.**`
            )
            .setFooter({
                text: 'Florida State Roleplay  •  Support System  •  TEST MODE',
                ...(footerIconUrl ? { iconURL: footerIconUrl } : {}),
            })
            .setTimestamp();

        if (thumbnailUrl)    embed.setThumbnail(thumbnailUrl);
        if (bottomBannerUrl) embed.setImage(bottomBannerUrl);

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('ticket_test_select')
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

        const embeds = [];
        if (topBannerUrl) {
            embeds.push(new EmbedBuilder().setImage(topBannerUrl).setColor(cfg.colors.main));
        }
        embeds.push(embed);

        await interaction.channel.send({ embeds, components: [row] });
        await interaction.editReply({ content: `${E.fsrp} Test panel sent. Tickets from this panel will not ping anyone.` });
    },
};
