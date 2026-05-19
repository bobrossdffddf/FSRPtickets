const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');

const cfg = require('../config.json');
const { getRobloxInfoByUsername } = require('../utils/roblox');
const { getAllTickets, getTicket, saveTicket, nextTicketNumber } = require('../utils/db');

// ─────────────────────────────────────────────────────────────────────────────
// Button row builder  (single Claim/Unclaim toggle + Close)
// ─────────────────────────────────────────────────────────────────────────────
function buildButtons(ticket) {
    const isClaimed = !!(ticket && ticket.claimedBy);
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('toggle_claim_ticket')
            .setLabel(isClaimed ? 'Unclaim' : 'Claim')
            .setStyle(isClaimed ? ButtonStyle.Secondary : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('close_ticket')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger),
    );
}

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
                    .setLabel('Roblox Username (optional)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. Builderman  —  leave blank to skip')
                    .setRequired(false)
                    .setMaxLength(20)
            ),
        );
        return interaction.showModal(modal);
    }

    // ── Staff Report — show full modal immediately (no user-select step) ────────
    if (value === 'staffreport') {
        const modal = new ModalBuilder()
            .setCustomId('modal_staff_report')
            .setTitle('Staff Report');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reported_staff')
                    .setLabel('Who are you reporting?')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Their Discord username (e.g. JohnDoe)')
                    .setRequired(true)
                    .setMaxLength(64)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('What did they do?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Include dates, what happened, and any evidence links.')
                    .setRequired(true)
                    .setMinLength(10)
                    .setMaxLength(1000)
            ),
        );
        return interaction.showModal(modal);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal submits
// ─────────────────────────────────────────────────────────────────────────────
async function handleGeneralModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reason         = interaction.fields.getTextInputValue('reason');
    const robloxUsername = interaction.fields.getTextInputValue('roblox_username').trim();
    await createTicket(interaction, 'general', reason, null, robloxUsername || null);
}

async function handleStaffReportModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reportedStaff  = interaction.fields.getTextInputValue('reported_staff').trim();
    const reason         = interaction.fields.getTextInputValue('reason');
    const reportedInfo   = { userId: null, tag: reportedStaff };
    await createTicket(interaction, 'staffreport', reason, reportedInfo, null);
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

    // Staff reports start in the High Rank category; general support in general
    const parentCategory = isReport ? cfg.categories.highRank : cfg.categories.general;

    // ── 1. Create the channel immediately ─────────────────────────────────────
    const channel = await guild.channels.create({
        name:   channelName,
        type:   ChannelType.GuildText,
        parent: parentCategory,
        topic:  `Ticket #${padNum} | ${isReport ? 'Staff Report' : 'General Support'} | ${opener.username}`,
        permissionOverwrites: [
            { id: guild.id,              deny:  [PermissionFlagsBits.ViewChannel] },
            { id: opener.id,             allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
            { id: cfg.roles.staff,       allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
            { id: cfg.roles.highRank,    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
            { id: cfg.roles.foundership, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
        ],
    });

    // ── 2. Build initial embed + buttons and send ──────────────────────────────
    const ticketData = {
        type,
        openerId:        opener.id,
        openerTag:       opener.username,
        claimedBy:       null,
        claimedByTag:    null,
        escalationLevel: isReport ? 1 : 0,   // staff reports start at HR level (1)
        ticketNumber:    ticketNum,
        reason,
        robloxUsername,
        reportedUserId:  reportedInfo?.userId ?? null,
        reportedUserTag: reportedInfo?.tag    ?? null,
        roblox:          null,
        openedAt:        Date.now(),
        openingMessageId: null,  // set below
    };

    const initialEmbed = buildEmbed({
        opener, roblox: null, robloxUsername, reason, type, padNum, reportedInfo, claimed: null,
    });

    const buttons = buildButtons(ticketData);

    const msg = await channel.send({
        content:    `<@${opener.id}> — <@&${cfg.roles.highRank}>`,
        embeds:     [initialEmbed],
        components: [buttons],
    });

    await msg.pin().catch(() => {});

    // ── 3. Save to DB ──────────────────────────────────────────────────────────
    ticketData.openingMessageId = msg.id;
    saveTicket(channel.id, ticketData);

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
            const ticket = getTicket(channel.id);
            if (ticket) {
                ticket.roblox = roblox;
                saveTicket(channel.id, ticket);
            }

            const updatedEmbed = buildEmbed({
                opener, roblox, robloxUsername, reason, type, padNum, reportedInfo, claimed: null,
                robloxFailed: roblox === null,
            });
            // Keep existing buttons (ticket is still unclaimed at this point)
            msg.edit({ embeds: [updatedEmbed] }).catch(err => console.error('[Ticket] Failed to edit embed:', err?.message));
        }).catch(err => {
            console.error('[Ticket] Roblox lookup promise rejected:', err?.message ?? err);
            const failEmbed = buildEmbed({
                opener, roblox: null, robloxUsername, reason, type, padNum, reportedInfo, claimed: null,
                robloxFailed: true,
            });
            msg.edit({ embeds: [failEmbed] }).catch(() => {});
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Embed builder
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
        const reportedValue = reportedInfo.userId
            ? `<@${reportedInfo.userId}> (${reportedInfo.tag})`
            : reportedInfo.tag;
        embed.addFields({
            name:  'Reported Staff Member',
            value: reportedValue,
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
    handleGeneralModal,
    handleStaffReportModal,
    buildEmbed,
    buildButtons,
};
