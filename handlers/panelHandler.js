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
const { getRobloxInfo } = require('../utils/roblox');
const { getAllTickets, getTicket, saveTicket, nextTicketNumber } = require('../utils/db');

// In-memory: userId → { userId, tag } of reported user, cleared after modal submit
const pendingReports = new Map();

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

    // ── General Support ───────────────────────────────────────────────────────
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
        );
        return interaction.showModal(modal);
    }

    // ── Staff Report — Step 1: pick the staff member via UserSelectMenu ────────
    if (value === 'staffreport') {
        const embed = new EmbedBuilder()
            .setColor(cfg.colors.foundership)
            .setTitle('🛡️ Staff Report')
            .setDescription(
                'Select the staff member you are reporting from the menu below.\n\n' +
                'Once selected you will be asked to describe what happened.'
            )
            .setFooter({ text: 'Florida State Roleplay  •  Your report is confidential' });

        const row = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId('report_user_select')
                .setPlaceholder('Select a staff member…')
                .setMinValues(1)
                .setMaxValues(1)
        );

        return interaction.reply({
            embeds: [embed],
            components: [row],
            flags: MessageFlags.Ephemeral,
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// User select — staff report step 1 (pick who to report)
// ─────────────────────────────────────────────────────────────────────────────
async function handleUserSelect(interaction) {
    const reportedUser = interaction.users.first();
    if (!reportedUser) return interaction.reply({ content: 'No user selected.', flags: MessageFlags.Ephemeral });

    pendingReports.set(interaction.user.id, {
        userId: reportedUser.id,
        tag:    reportedUser.username,
    });

    const modal = new ModalBuilder()
        .setCustomId('modal_staff_report')
        .setTitle(`Report — ${reportedUser.username}`);

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('reason')
                .setLabel(`Why are you reporting ${reportedUser.username}?`)
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Include dates, what happened, and any evidence links.')
                .setRequired(true)
                .setMinLength(10)
                .setMaxLength(1000)
        ),
    );
    return interaction.showModal(modal);
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal submits
// ─────────────────────────────────────────────────────────────────────────────
async function handleGeneralModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reason = interaction.fields.getTextInputValue('reason');
    await createTicket(interaction, 'general', reason, null);
}

async function handleStaffReportModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reason  = interaction.fields.getTextInputValue('reason');
    const pending = pendingReports.get(interaction.user.id);
    if (!pending) return interaction.editReply({ content: 'Session expired — please try again.' });
    pendingReports.delete(interaction.user.id);
    await createTicket(interaction, 'staffreport', reason, pending);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core ticket creation
// Roblox info is fetched automatically via Melonly (Discord ID → Roblox account).
// No username typing required.
// ─────────────────────────────────────────────────────────────────────────────
async function createTicket(interaction, type, reason, reportedInfo) {
    const guild     = interaction.guild;
    const opener    = interaction.user;
    const ticketNum = nextTicketNumber();
    const padNum    = String(ticketNum).padStart(4, '0');
    const isReport  = type === 'staffreport';

    const safeName    = opener.username.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 14);
    const channelName = `${isReport ? 'sr' : 'gen'}-${safeName}-${padNum}`;

    // Staff reports start in the High Rank category
    const parentCategory = isReport ? cfg.categories.highRank : cfg.categories.general;

    // ── 1. Create channel immediately ─────────────────────────────────────────
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

    // ── 2. Send initial embed with "fetching…" Roblox state ───────────────────
    const ticketData = {
        type,
        openerId:         opener.id,
        openerTag:        opener.username,
        claimedBy:        null,
        claimedByTag:     null,
        escalationLevel:  isReport ? 1 : 0,
        ticketNumber:     ticketNum,
        reason,
        robloxUsername:   null,
        reportedUserId:   reportedInfo?.userId ?? null,
        reportedUserTag:  reportedInfo?.tag    ?? null,
        roblox:           null,
        openedAt:         Date.now(),
        openingMessageId: null,
    };

    const initialEmbed = buildEmbed({ opener, roblox: null, robloxFetching: true, reason, type, padNum, reportedInfo, claimed: null });
    const buttons      = buildButtons(ticketData);

    const notifyRole = isReport ? cfg.roles.highRank : cfg.roles.staff;
    const msg = await channel.send({
        content:    `<@${opener.id}> — <@&${notifyRole}>`,
        embeds:     [initialEmbed],
        components: [buttons],
    });

    await msg.pin().catch(() => {});

    // ── 3. Save to DB ──────────────────────────────────────────────────────────
    ticketData.openingMessageId = msg.id;
    saveTicket(channel.id, ticketData);

    // ── 4. Reply to user ───────────────────────────────────────────────────────
    await interaction.editReply({
        embeds: [new EmbedBuilder()
            .setColor(cfg.colors.success)
            .setDescription(`Your ticket has been opened: <#${channel.id}>`)
            .setFooter({ text: 'Florida State Roleplay' })
        ],
    });

    // ── 5. Auto-fetch Roblox via Melonly in background, then update embed ──────
    getRobloxInfo(opener.id).then(roblox => {
        const ticket = getTicket(channel.id);
        if (ticket) {
            ticket.roblox = roblox;
            if (roblox) ticket.robloxUsername = roblox.username;
            saveTicket(channel.id, ticket);
        }
        const updatedEmbed = buildEmbed({
            opener, roblox, robloxFetching: false, robloxFailed: roblox === null,
            reason, type, padNum, reportedInfo, claimed: null,
        });
        msg.edit({ embeds: [updatedEmbed] }).catch(err => console.error('[Ticket] Failed to edit embed:', err?.message));
    }).catch(err => {
        console.error('[Ticket] Roblox lookup failed:', err?.message ?? err);
        const failEmbed = buildEmbed({
            opener, roblox: null, robloxFetching: false, robloxFailed: true,
            reason, type, padNum, reportedInfo, claimed: null,
        });
        msg.edit({ embeds: [failEmbed] }).catch(() => {});
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Embed builder
// ─────────────────────────────────────────────────────────────────────────────
function buildEmbed({ opener, roblox, robloxFetching = false, robloxFailed = false, reason, type, padNum, reportedInfo, claimed }) {
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

    // ── Roblox Information ────────────────────────────────────────────────────
    if (roblox) {
        embed.addFields({
            name:  'Roblox Information',
            value: `**Username:** [${roblox.username}](${roblox.profileUrl}) (ID: ${roblox.id})\n**Display Name:** ${roblox.displayName}\n**Account Created:** ${roblox.created}`,
            inline: false,
        });
        if (roblox.avatarUrl) embed.setThumbnail(roblox.avatarUrl);
    } else if (robloxFailed) {
        embed.addFields({
            name:  'Roblox Information',
            value: '*Could not fetch Roblox account — the user may not be verified with Melonly.*',
            inline: false,
        });
    } else if (robloxFetching) {
        embed.addFields({
            name:  'Roblox Information',
            value: '*Fetching account details…*',
            inline: false,
        });
    }

    // ── Ticket Reason ─────────────────────────────────────────────────────────
    embed.addFields({
        name:  'Ticket Reason',
        value: reason.length > 900 ? reason.substring(0, 900) + '…' : reason,
        inline: false,
    });

    // ── Reported Staff Member (staff reports only) ────────────────────────────
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

    // ── Claim status ──────────────────────────────────────────────────────────
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
    buildButtons,
};
