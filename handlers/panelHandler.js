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
    Routes,
} = require('discord.js');

const cfg = require('../config.json');
const { getRobloxInfo } = require('../utils/roblox');
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

    // ── Staff Report — modal with User Select + reason ────────────────────────
    // Discord now supports UserSelect (type 5) inside a Label (type 18) in modals.
    // discord.js builders don't expose this yet so we send the raw REST payload.
    if (value === 'staffreport') {
        await interaction.client.rest.post(
            Routes.interactionCallback(interaction.id, interaction.token),
            {
                body: {
                    type: 9,   // InteractionResponseType.Modal
                    data: {
                        custom_id: 'modal_staff_report',
                        title: 'Staff Report',
                        components: [
                            {
                                type: 18,  // ComponentType.Label
                                label: 'Who are you reporting?',
                                component: {
                                    type: 5,   // ComponentType.UserSelect
                                    custom_id: 'reported_user',
                                    placeholder: 'Select the staff member to report…',
                                    min_values: 1,
                                    max_values: 1,
                                    required: true,
                                },
                            },
                            {
                                type: 1,  // ComponentType.ActionRow
                                components: [
                                    {
                                        type: 4,   // ComponentType.TextInput
                                        custom_id: 'reason',
                                        label: 'What did they do?',
                                        style: 2,  // TextInputStyle.Paragraph
                                        placeholder: 'Include dates, what happened, and any evidence links.',
                                        required: true,
                                        min_length: 10,
                                        max_length: 1000,
                                    },
                                ],
                            },
                        ],
                    },
                },
            }
        );
        // Tell discord.js this interaction has been replied to
        interaction._replied = true;
    }
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

    const reason = interaction.fields.getTextInputValue('reason');

    // ── Extract the User Select value ────────────────────────────────────────
    // Discord sends Label+UserSelect at the top-level components array.
    // We try multiple approaches since discord.js may or may not parse type-18 Labels.
    let reportedUserId = null;

    // Approach 1: standard getField (works if discord.js handles Label/type-18)
    try {
        const field = interaction.fields.getField('reported_user');
        if (field?.values?.[0]) reportedUserId = field.values[0];
    } catch { /* not found via this path */ }

    // Approach 2: iterate raw fields Collection
    if (!reportedUserId) {
        for (const [, field] of (interaction.fields.fields ?? [])) {
            const cid = field.custom_id ?? field.customId;
            if (cid === 'reported_user' && field.values?.[0]) {
                reportedUserId = field.values[0];
                break;
            }
        }
    }

    // Approach 3: resolved users from the interaction (discord.js v14.16+)
    if (!reportedUserId && interaction.resolved?.users?.size) {
        reportedUserId = interaction.resolved.users.first()?.id;
    }

    if (!reportedUserId) {
        console.error('[StaffReport] Could not extract User Select value from modal submit.');
        return interaction.editReply({
            content: '❌ Could not read the selected staff member. Please try again.',
        });
    }

    // ── Resolve username ─────────────────────────────────────────────────────
    let reportedTag = `<@${reportedUserId}>`;
    try {
        const user = interaction.client.users.cache.get(reportedUserId)
            ?? await interaction.client.users.fetch(reportedUserId);
        reportedTag = user.username;
    } catch { /* keep mention fallback */ }

    await createTicket(interaction, 'staffreport', reason, { userId: reportedUserId, tag: reportedTag });
}

// ─────────────────────────────────────────────────────────────────────────────
// Core ticket creation
// ─────────────────────────────────────────────────────────────────────────────
async function createTicket(interaction, type, reason, reportedInfo) {
    const guild     = interaction.guild;
    const opener    = interaction.user;
    const ticketNum = nextTicketNumber();
    const padNum    = String(ticketNum).padStart(4, '0');
    const isReport  = type === 'staffreport';

    const safeName    = opener.username.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 14);
    const channelName = `${isReport ? 'sr' : 'gen'}-${safeName}-${padNum}`;

    const parentCategory = isReport ? cfg.categories.highRank : cfg.categories.general;

    // ── 1. Create channel ─────────────────────────────────────────────────────
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

    // ── 2. Send initial embed ─────────────────────────────────────────────────
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

    const initialEmbed = buildEmbed({
        opener, roblox: null, robloxFetching: true,
        reason, type, padNum, reportedInfo, claimed: null,
    });
    const buttons = buildButtons(ticketData);

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

    // ── 4. Confirm to user ─────────────────────────────────────────────────────
    await interaction.editReply({
        embeds: [new EmbedBuilder()
            .setColor(cfg.colors.success)
            .setDescription(`Your ticket has been opened: <#${channel.id}>`)
            .setFooter({ text: 'Florida State Roleplay' })
        ],
    });

    // ── 5. Melonly Roblox lookup in background → update embed ─────────────────
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
        msg.edit({ embeds: [updatedEmbed] }).catch(err =>
            console.error('[Ticket] Failed to update embed after Roblox lookup:', err?.message));
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
            value: '*Could not fetch Roblox account — user may not be verified with Melonly.*',
            inline: false,
        });
    } else if (robloxFetching) {
        embed.addFields({
            name:  'Roblox Information',
            value: '*Fetching account details…*',
            inline: false,
        });
    }

    embed.addFields({
        name:  'Ticket Reason',
        value: reason.length > 900 ? reason.substring(0, 900) + '…' : reason,
        inline: false,
    });

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
