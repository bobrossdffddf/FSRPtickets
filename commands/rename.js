/**
 * /rename <name>  — Renames the current ticket channel.
 * Usable by staff or the ticket opener.
 */
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const cfg            = require('../config.json');
const { getTicket }  = require('../utils/db');

const E = {
    alert: '<:Alert:1488257805071810630>',
    check: '<:check_yes_wb:1492185650449874994>',
    pin:   '<:pin:1491123495810367651>',
    fsrp:  '<:FSRP:1500172509826383922>',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rename')
        .setDescription('Rename this ticket channel.')
        .addStringOption(opt =>
            opt.setName('name')
               .setDescription('The new channel name (no spaces, use hyphens)')
               .setRequired(true)
               .setMaxLength(90)
        ),

    async execute(interaction) {
        const ticket = getTicket(interaction.channelId);
        if (!ticket) {
            return interaction.reply({
                content: `${E.alert} This command can only be used inside a ticket channel.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        // ── Permission: staff or opener ───────────────────────────────────────
        const member  = interaction.member;
        const isStaff = member.roles.cache.has(cfg.roles.staff) ||
                        member.roles.cache.has(cfg.roles.highRank) ||
                        member.roles.cache.has(cfg.roles.foundership);
        if (!isStaff && interaction.user.id !== ticket.openerId) {
            return interaction.reply({
                content: `${E.alert} Only staff members or the ticket opener can rename this ticket.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferReply();

        const rawName   = interaction.options.getString('name', true);
        const safeName  = rawName
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9\-]/g, '')
            .substring(0, 90);

        const oldName = interaction.channel.name;
        await interaction.channel.setName(safeName);

        const embed = new EmbedBuilder()
            .setColor(cfg.colors.neutral)
            .setTitle(`${E.pin}  Ticket Renamed`)
            .setDescription(
                `${E.check} This ticket has been successfully renamed.\n\n` +
                `**Before:** \`${oldName}\`\n` +
                `**After:**  \`${safeName}\``
            )
            .addFields({ name: 'Renamed By', value: `<@${interaction.user.id}>`, inline: true })
            .setFooter({ text: 'Florida State Roleplay  •  Ticket System' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
