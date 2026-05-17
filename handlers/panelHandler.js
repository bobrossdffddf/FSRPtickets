const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    UserSelectMenuBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');

const cfg = require('../config.json');
const { getRobloxInfoByUsername } = require('../utils/roblox');
const { getAllTickets, saveTicket, nextTicketNumber } = require('../utils/db');

// In-memory: userId → { userId, tag } of reported user, cleared after modal submit
const pendingReports = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Panel dropdown
// ─────────────────────────────────────────────────────────────────────────────
async function handlePanelSelect(interaction) {
    const value = interaction.values[0];

    // Block duplicate tickets
    const hasOpen = Object.values(getAllTickets()).some(t => t.openerId === interaction.user.id);
    if (hasOpen) {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.warning)
                .setTitle('Existing Ticket')
                .setDescription('You already have an open ticket. Please wait for it to be resolved before opening another.')
                .setFooter({ text: 'Florida State Roleplay' })
            ],
            flags: MessageFlags.Ephemeral,
        });
    }

    if (value === 'general') {
        const modal = new ModalBuilder()
            .setCustomId('modal_general_support')
            .setTitle('General Support');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('What do you need assistance with?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Please be as detailed as possible.')
                    .setRequired(true)
                    .setMinLength(10)
                    .setMaxLength(1000)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('roblox_username')
                    .setLabel('Roblox Username')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. Builderman')
                    .setRequired(true)
                    .setMaxLength(20)
            ),
        );
        return interaction.showModal(modal);
    }

    if (value === 'staffreport') {
        const embed = new EmbedBuilder()
            .setColor(cfg.colors.foundership)
            .setTitle('Staff Report')
            .setDescription('Select the staff member you are reporting from the menu below.\n\nOnce selected, you will be asked to provide a reason.')
            .setFooter({ text: 'Florida State Roleplay' });

        const row = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId('report_user_select')
                .setPlaceholder('Select a staff member…')
                .setMinValues(1)
                .setMaxValues(1)
        );
        return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// User select — staff report step 1
// ─────────────────────────────────────────────────────────────────────────────
async function handleUserSelect(interaction) {
    const reportedUser = interaction.users.first();
    if (!reportedUser) return interaction.reply({ content: 'No user selected.', flags: MessageFlags.Ephemeral });

    pendingReports.set(interaction.user.id, {
        userId: reportedUser.id,
        tag:    reportedUser.username,
    });

    const modal = new ModalBuilder()
        .setCustomId(`modal_staff_report_${reportedUser.id}`)
        .setTitle('Staff Report');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('reason')
                .setLabel(`Why are you reporting ${reportedUser.username}?`)
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Include dates, what happened, and any evidence.')
                .setRequired(true)
                .setMinLength(10)
                .setMaxLength(1000)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('roblox_username')
                .setLabel('Your Roblox Username')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('e.g. Builderman')
                .setRequired(true)
                .setMaxLength(20)
        ),
    );
    return interaction.showModal(modal);
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal submits
// ─────────────────────────────────────────────────────────────────────────────
async function handleGeneralModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reason          = interaction.fields.getTextInputValue('reason');
    const robloxUsername  = interaction.fields.getTextInputValue('roblox_username').trim();
    await createTicket(interaction, 'general', reason, null, robloxUsername);
}

async function handleStaffReportModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reason         = interaction.fields.getTextInputValue('reason');
    const robloxUsername = interaction.fields.getTextInputValue('roblox_username').trim();
    const pending        = pendingReports.get(interaction.user.id);
    if (!pending) return interaction.editReply({ content: 'Session expired — please try again.' });
    pendingReports.delete(interaction.user.id);
    await createTicket(interaction, 'staffreport', reason, pending, robloxUsername);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core ticket creation  (fast path — Roblox lookup happens in background)
// ─────────────────────────────────────────────────────────────────────────────
async function createTicket(interaction, type, reason, reportedInfo, robloxUsername) {
    const guild     = interaction.guild;
    const opener    = interaction.user;
    const ticketNum = nextTicketNumber();
    const padNum    = String(ticketNum).padStart(4, '0');
    const isReport  = type === 'staffreport';

    const safeName    = opener.username.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 14);
    const channelName = `${isReport ? 'sr' : 'gen'}-${safeName}-${padNum}`;

    // ── 1. Create the channel immediately ─────────────────────────────────────
    const channel = await guild.channels.create({
        name:   channelName,
        type:   ChannelType.GuildText,
        parent: cfg.categories.general,
        topic:  `Ticket #${padNum} | ${isReport ? 'Staff Report' : 'General Support'} | ${opener.username}`,
        permissionOverwrites: [
            { id: guild.id,              deny:  [PermissionFlagsBits.ViewChannel] },
            { id: opener.id,             allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
            { id: cfg.roles.staff,       allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
            { id: cfg.roles.highRank,    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
            { id: cfg.roles.foundership, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
        ],
    });

    // ── 2. Send initial embed instantly ───────────────────────────────────────
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('unclaim_ticket').setLabel('Unclaim').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger),
    );

    const initialEmbed = buildEmbed({
        opener, roblox: null, robloxUsername, reason, type, padNum, reportedInfo, claimed: null,
    });

    const msg = await channel.send({
        content:    `<@${opener.id}> — <@&${cfg.roles.staff}>`,
        embeds:     [initialEmbed],
        components: [buttons],
    });

    await msg.pin().catch(() => {});

    // ── 3. Save to DB ──────────────────────────────────────────────────────────
    saveTicket(channel.id, {
        type,
        openerId:        opener.id,
        openerTag:       opener.username,
        claimedBy:       null,
        claimedByTag:    null,
        escalationLevel: 0,
        ticketNumber:    ticketNum,
        reason,
        robloxUsername,
        reportedUserId:  reportedInfo?.userId ?? null,
        reportedUserTag: reportedInfo?.tag    ?? null,
        roblox:          null,
        openedAt:        Date.now(),
        openingMessageId: msg.id,
    });

    // ── 4. Reply to user immediately ──────────────────────────────────────────
    await interaction.editReply({
        embeds: [new EmbedBuilder()
            .setColor(cfg.colors.success)
            .setDescription(`Your ticket has been opened: <#${channel.id}>`)
            .setFooter({ text: 'Florida State Roleplay' })
        ],
    });

    // ── 5. Look up Roblox in background, then edit the embed ──────────────────
    if (robloxUsername) {
        getRobloxInfoByUsername(robloxUsername).then(roblox => {
            // Update DB with Roblox info
            const { getTicket } = require('../utils/db');
            const ticket = getTicket(channel.id);
            if (ticket) {
                ticket.roblox = roblox;
                saveTicket(channel.id, ticket);
            }

            const updatedEmbed = buildEmbed({
                opener, roblox, robloxUsername, reason, type, padNum, reportedInfo, claimed: null,
                robloxFailed: roblox === null,
            });
            msg.edit({ embeds: [updatedEmbed] }).catch(err => console.error('[Ticket] Failed to edit embed:', err?.message));
        }).catch(err => {
            console.error('[Ticket] Roblox lookup promise rejected:', err?.message ?? err);
            // Edit the embed to show lookup failed rather than leaving "Fetching…"
            const failEmbed = buildEmbed({
                opener, roblox: null, robloxUsername, reason, type, padNum, reportedInfo, claimed: null,
                robloxFailed: true,
            });
            msg.edit({ embeds: [failEmbed] }).catch(() => {});
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Embed builder — clean, matches screenshot style
// ─────────────────────────────────────────────────────────────────────────────
function buildEmbed({ opener, roblox, robloxUsername, reason, type, padNum, reportedInfo, claimed, robloxFailed = false }) {
    const isReport  = type === 'staffreport';
    const typeLabel = isReport ? 'Staff Report' : 'General Support';

    const embed = new EmbedBuilder()
        .setColor(isReport ? cfg.colors.foundership : cfg.colors.main)
        .setTitle(typeLabel)
        .setDescription(
            `Hi, <@${opener.id}>! Thank you for contacting the **Florida State Roleplay** Staff Team. ` +
            `We are always happy to assist you with your ticket. Our staff team is here to help with any ` +
            `questions or concerns you may have. To ensure you receive the best assistance, please provide ` +
            `additional details regarding your ticket.`
        )
        .setFooter({ text: `Florida State Roleplay  •  Ticket #${padNum}` })
        .setTimestamp();

    // Roblox Information
    if (roblox) {
        embed.addFields({
            name:  'Roblox Information',
            value: `**Username:** ${roblox.username} (${roblox.id})\n**Display Name:** ${roblox.displayName}\n**Created:** ${roblox.created}`,
            inline: false,
        });
        if (roblox.avatarUrl) embed.setThumbnail(roblox.avatarUrl);
    } else if (robloxUsername && robloxFailed) {
        embed.addFields({
            name:  'Roblox Information',
            value: `**Username:** ${robloxUsername}\n*Could not fetch account details — the username may be incorrect or Roblox is unavailable.*`,
            inline: false,
        });
    } else if (robloxUsername) {
        embed.addFields({
            name:  'Roblox Information',
            value: `**Username:** ${robloxUsername}\n*Fetching account details…*`,
            inline: false,
        });
    }

    // Ticket Reason
    embed.addFields({
        name:  'Ticket Reason',
        value: reason.length > 900 ? reason.substring(0, 900) + '…' : reason,
        inline: false,
    });

    // Staff report — reported member
    if (isReport && reportedInfo) {
        embed.addFields({
            name:  'Reported Staff Member',
            value: `<@${reportedInfo.userId}> (${reportedInfo.tag})`,
            inline: false,
        });
    }

    // Claim status
    embed.addFields({
        name:  'Claimed By',
        value: claimed ? `<@${claimed}>` : '*Unclaimed*',
        inline: false,
    });

    return embed;
}

module.exports = {
    handlePanelSelect,
    handleUserSelect,
    handleGeneralModal,
    handleStaffReportModal,
    buildEmbed,
};
