/**
 * /close  — closes a ticket: generates transcript, posts to transcripts channel, deletes channel.
 * Must be run inside a ticket channel. Claimer/staff only.
 */
const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
} = require('discord.js');
const cfg               = require('../config.json');
const { getTicket }     = require('../utils/db');
const { generateTranscript } = require('../utils/transcript');

const E = {
    fsrp:  '<:FSRP:1500172509826383922>',
    cross: '<:_cross_:1488257725983883437>',
    check: '<:check_yes_wb:1492185650449874994>',
    alert: '<:Alert:1488257805071810630>',
    bell:  '<:bell:1492185923964637364>',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription('Close this ticket and generate a transcript.'),

    async execute(interaction) {
        const ticket = getTicket(interaction.channelId);
        if (!ticket) {
            return interaction.reply({ content: `${E.alert} This command can only be used inside a ticket channel.`, ephemeral: true });
        }

        // ── Permission check: opener, claimer, or staff role ──────────────────
        const member  = interaction.member;
        const isStaff = member.roles.cache.has(cfg.roles.staff) ||
                        member.roles.cache.has(cfg.roles.highRank) ||
                        member.roles.cache.has(cfg.roles.foundership);
        const isOpener   = interaction.user.id === ticket.openerId;
        const isClaimer  = interaction.user.id === ticket.claimedBy;

        if (!isStaff && !isOpener && !isClaimer) {
            return interaction.reply({ content: `${E.alert} You do not have permission to close this ticket.`, ephemeral: true });
        }

        // ── Confirmation embed ────────────────────────────────────────────────
        const confirmEmbed = new EmbedBuilder()
            .setColor(cfg.colors.warning)
            .setTitle(`${E.alert}  Confirm Ticket Closure`)
            .setDescription(
                `Are you sure you want to close this ticket?\n\n` +
                `${E.check} A transcript will be generated and saved.\n` +
                `${E.cross} The ticket channel will be **permanently deleted**.\n\n` +
                `This action **cannot** be undone.`
            )
            .setFooter({ text: `Requested by ${interaction.user.tag}` })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('confirm_close_ticket')
                .setLabel('Close Ticket')
                .setStyle(ButtonStyle.Danger)
                .setEmoji({ id: '1488257725983883437', name: '_cross_' }),
            new ButtonBuilder()
                .setCustomId('cancel_close_ticket')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary),
        );

        await interaction.reply({ embeds: [confirmEmbed], components: [row] });
    },
};
