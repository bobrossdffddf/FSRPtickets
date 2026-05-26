/**
 * /panel — sends the FSRP Support Panel to this channel using raw Discord API JSON.
 * Restricted to HR (highRank) and above.
 */
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    Routes,
} = require('discord.js');
const cfg            = require('../config.json');
const { loadImages } = require('../utils/images');
const { isHighRank } = require('../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Send the FSRP support panel to this channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!isHighRank(interaction.member, interaction.guild)) {
            return interaction.editReply({ content: 'This command requires the High Rank role or above.' });
        }

        const imgs      = loadImages();
        const topUrl    = imgs.topBanner    ?? null;
        const bottomUrl = imgs.bottomBanner ?? imgs.banner ?? null;

        const inner = [];
        if (topUrl) inner.push({ type: 12, items: [{ media: { url: topUrl } }] });

        inner.push({
            type: 10,
            content: '# <:FSRP:1500172509826383922> FSRP Support Panel\nWelcome to the Florida State Roleplay support panel. Use this as a tool to request help, insight, ask questions, or make reports. A member of our staff team will assist you as soon as possible after you create a ticket.',
        });

        inner.push({ type: 14 });

        inner.push({
            type: 10,
            content: '-# Please note that by creating a ticket using the FSRP Ticket bot you agree to follow all server rules and discord TOS. Your ticket can be closed at any time for any reason that our staff sees fit. Abuse of tickets can lead to punishment up to a permanent ban from the server and it subsidiaries.',
        });

        inner.push({ type: 14 });

        inner.push({
            type: 1,
            components: [
                { style: 2, type: 2, label: 'General Support', emoji: { id: '1492185922467401911', name: 'website',       animated: false }, custom_id: 'panel_general_btn' },
                { style: 4, type: 2, label: 'Staff Report',    emoji: { id: '1492185629214245066', name: 'tts_ban_white', animated: false }, custom_id: 'panel_staff_btn'   },
            ],
        });

        inner.push({ type: 14 });

        if (bottomUrl) inner.push({ type: 12, items: [{ media: { url: bottomUrl } }] });

        await interaction.client.rest.post(
            Routes.channelMessages(interaction.channelId),
            {
                body: {
                    flags: 32768,
                    components: [{ type: 17, components: inner }],
                    allowed_mentions: { parse: [] },
                },
            }
        );

        await interaction.editReply({ content: '<:FSRP:1500172509826383922> Panel sent successfully.' });
    },
};
