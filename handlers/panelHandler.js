const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    SeparatorBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    SeparatorSpacingSize,
    ChannelType,
    PermissionFlagsBits,
    MessageFlags,
    Routes,
} = require('discord.js');

const cfg               = require('../config.json');
const { getRobloxInfo } = require('../utils/roblox');
const { loadImages }    = require('../utils/images');
const { getAllTickets, getTicket, saveTicket, nextTicketNumber } = require('../utils/db');
const { buildTicketOverwrites } = require('../utils/permissions');

function hexToInt(hex) {
    return parseInt(hex.replace('#', ''), 16);
}

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
// Container builder for ticket messages (Components V2)
// ─────────────────────────────────────────────────────────────────────────────
function buildContainer({ opener, roblox, robloxFetching = false, robloxFailed = false, reason, type, padNum, reportedInfo, reportedRoblox = null, reportedRobloxFetching = false, claimed, noPing = false }) {
    const isReport    = type === 'staffreport';
    const imgs        = loadImages();
    const topBannerUrl    = imgs.topBanner    ?? null;
    const bottomBannerUrl = imgs.bottomBanner ?? imgs.banner ?? null;

    const E_ticket = '<:ticket:1491123553985232946>';
    const E_shield = '<:shield:1491123625762492558>';

    // ── Part 1: header + intro ────────────────────────────────────────────────
    let headerContent = `## ${isReport ? E_shield : E_ticket}  ${isReport ? 'Staff Report' : 'General Support'} — Ticket #${padNum}\n\n`;
    if (noPing) headerContent += `> ⚠️ **TEST MODE** — No notifications sent.\n\n`;
    headerContent += `Hi, <@${opener.id}>! Thank you for contacting **Florida State Roleplay** Support.\n`;
    headerContent += `Our staff team will be with you shortly. Please provide any additional details if needed.`;

    // ── Part 2: opener Roblox block ───────────────────────────────────────────
    let robloxContent;
    if (robloxFetching) {
        robloxContent = `**Roblox Account:** *Fetching details…*`;
    } else if (roblox) {
        robloxContent  = `**Roblox Account:** [${roblox.username}](${roblox.profileUrl}) (\`${roblox.id}\`) · ${roblox.displayName}\n`;
        robloxContent += `**Account Created:** ${roblox.created}`;
    } else {
        robloxContent = `**Roblox Account:** *Not found — user may not be verified with Melonly.*`;
    }

    // ── Part 3: reason, reported info, claimed, footer ───────────────────────
    const safeReason = reason.length > 900 ? reason.substring(0, 900) + '…' : reason;
    let bodyContent = `**Ticket Reason:**\n> ${safeReason.replace(/\n/g, '\n> ')}\n\n`;

    if (isReport && reportedInfo) {
        const val = reportedInfo.userId
            ? `<@${reportedInfo.userId}> (${reportedInfo.tag})`
            : reportedInfo.tag;
        bodyContent += `**Reported Staff Member:** ${val}\n`;
        if (reportedRobloxFetching) {
            bodyContent += `**Their Roblox Account:** *Fetching details…*\n\n`;
        } else if (reportedRoblox) {
            bodyContent += `**Their Roblox Account:** [${reportedRoblox.username}](${reportedRoblox.profileUrl}) (\`${reportedRoblox.id}\`) · ${reportedRoblox.displayName}\n`;
            bodyContent += `**Account Created:** ${reportedRoblox.created}\n\n`;
        } else {
            bodyContent += `**Their Roblox Account:** *Not found — may not be verified.*\n\n`;
        }
    }

    bodyContent += `**Claimed By:** ${claimed ? `<@${claimed}>` : '*Unclaimed*'}\n\n`;
    bodyContent += `-# Florida State Roleplay  •  Ticket #${padNum}`;

    // ── Assemble container ────────────────────────────────────────────────────
    const container = new ContainerBuilder()
        .setAccentColor(hexToInt(isReport ? cfg.colors.foundership : cfg.colors.main));

    if (topBannerUrl) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems({ media: { url: topBannerUrl } })
        );
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent));

    // Roblox block: show avatar thumbnail when available, plain text otherwise
    if (roblox?.avatarUrl) {
        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(robloxContent))
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(roblox.avatarUrl))
        );
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(robloxContent));
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(bodyContent));

    if (bottomBannerUrl) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems({ media: { url: bottomBannerUrl } })
        );
    }

    return container;
}

// Builds the full component list for a ticket message (container + buttons)
function buildTicketComponents(ticketData, embedParams) {
    const container = buildContainer({ ...embedParams, noPing: ticketData.noPing });
    const buttons   = buildButtons(ticketData);
    return [container, buttons];
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel dropdown (regular — pings enabled)
// ─────────────────────────────────────────────────────────────────────────────
async function handlePanelSelect(interaction) {
    await _handleSelect(interaction, false);
}

// Panel dropdown (test — no pings)
async function handleTestPanelSelect(interaction) {
    await _handleSelect(interaction, true);
}

async function _handleSelect(interaction, noPing) {
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
            .setCustomId(noPing ? 'modal_general_support_test' : 'modal_general_support')
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
    if (value === 'staffreport') {
        await interaction.client.rest.post(
            Routes.interactionCallback(interaction.id, interaction.token),
            {
                body: {
                    type: 9,   // InteractionResponseType.Modal
                    data: {
                        custom_id: noPing ? 'modal_staff_report_test' : 'modal_staff_report',
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
        interaction._replied = true;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal submits
// ─────────────────────────────────────────────────────────────────────────────
async function handleGeneralModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reason = interaction.fields.getTextInputValue('reason');
    await createTicket(interaction, 'general', reason, null, false);
}

async function handleGeneralTestModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reason = interaction.fields.getTextInputValue('reason');
    await createTicket(interaction, 'general', reason, null, true);
}

async function handleStaffReportModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reason = interaction.fields.getTextInputValue('reason');
    const reportedInfo = await _extractReportedUser(interaction);
    if (!reportedInfo) return;
    await createTicket(interaction, 'staffreport', reason, reportedInfo, false);
}

async function handleStaffReportTestModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const reason = interaction.fields.getTextInputValue('reason');
    const reportedInfo = await _extractReportedUser(interaction);
    if (!reportedInfo) return;
    await createTicket(interaction, 'staffreport', reason, reportedInfo, true);
}

async function _extractReportedUser(interaction) {
    let reportedUserId = null;

    try {
        const field = interaction.fields.getField('reported_user');
        if (field?.values?.[0]) reportedUserId = field.values[0];
    } catch { /* not found via this path */ }

    if (!reportedUserId) {
        for (const [, field] of (interaction.fields.fields ?? [])) {
            const cid = field.custom_id ?? field.customId;
            if (cid === 'reported_user' && field.values?.[0]) {
                reportedUserId = field.values[0];
                break;
            }
        }
    }

    if (!reportedUserId && interaction.resolved?.users?.size) {
        reportedUserId = interaction.resolved.users.first()?.id;
    }

    if (!reportedUserId) {
        console.error('[StaffReport] Could not extract User Select value from modal submit.');
        await interaction.editReply({
            content: '❌ Could not read the selected staff member. Please try again.',
        });
        return null;
    }

    let reportedTag = `<@${reportedUserId}>`;
    try {
        const user = interaction.client.users.cache.get(reportedUserId)
            ?? await interaction.client.users.fetch(reportedUserId);
        reportedTag = user.username;
    } catch { /* keep mention fallback */ }

    return { userId: reportedUserId, tag: reportedTag };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core ticket creation
// noPing = true → no @user or @role mentions in the opening message
// ─────────────────────────────────────────────────────────────────────────────
async function createTicket(interaction, type, reason, reportedInfo, noPing = false) {
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
        permissionOverwrites: buildTicketOverwrites(guild, opener.id),
    });

    // ── 2. Build ticket data ──────────────────────────────────────────────────
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
        reportedRoblox:   null,
        openedAt:         Date.now(),
        openingMessageId: null,
        noPing,
    };

    const initialParams = {
        opener, roblox: null, robloxFetching: true,
        reason, type, padNum, reportedInfo,
        reportedRoblox: null, reportedRobloxFetching: isReport && !!reportedInfo?.userId,
        claimed: null,
    };

    // Discord's allowedMentions doesn't trigger notifications in Components V2 text.
    // Send a plain message first so @user and @role are actually notified, then delete it.
    if (!noPing) {
        const notifyRole = isReport ? cfg.roles.highRank : cfg.roles.staff;
        const pingMsg = await channel.send({
            content: `<@${opener.id}> <@&${notifyRole}>`,
            allowedMentions: { parse: ['users', 'roles'] },
        }).catch(() => null);
        pingMsg?.delete().catch(() => {});
    }

    const msg = await channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: buildTicketComponents(ticketData, initialParams),
        allowedMentions: { parse: [] },
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

    // ── 5. Roblox lookups in background → update container ────────────────────
    const lookups = [
        getRobloxInfo(opener.id),
        isReport && reportedInfo?.userId ? getRobloxInfo(reportedInfo.userId) : Promise.resolve(null),
    ];

    Promise.all(lookups).then(([roblox, reportedRoblox]) => {
        const ticket = getTicket(channel.id);
        if (ticket) {
            ticket.roblox = roblox;
            if (roblox) ticket.robloxUsername = roblox.username;
            ticket.reportedRoblox = reportedRoblox;
            saveTicket(channel.id, ticket);
        }
        const updatedParams = {
            opener, roblox, robloxFetching: false, robloxFailed: roblox === null,
            reason, type, padNum, reportedInfo, reportedRoblox, reportedRobloxFetching: false,
            claimed: null,
        };
        msg.edit({
            flags: MessageFlags.IsComponentsV2,
            components: buildTicketComponents(ticketData, updatedParams),
            allowedMentions: { parse: [] },
        }).catch(err => console.error('[Ticket] Failed to update container after Roblox lookup:', err?.message));
    }).catch(err => {
        console.error('[Ticket] Roblox lookup failed:', err?.message ?? err);
        const failParams = {
            opener, roblox: null, robloxFetching: false, robloxFailed: true,
            reason, type, padNum, reportedInfo, reportedRoblox: null, reportedRobloxFetching: false,
            claimed: null,
        };
        msg.edit({
            flags: MessageFlags.IsComponentsV2,
            components: buildTicketComponents(ticketData, failParams),
            allowedMentions: { parse: [] },
        }).catch(() => {});
    });
}

module.exports = {
    handlePanelSelect,
    handleTestPanelSelect,
    handleGeneralModal,
    handleGeneralTestModal,
    handleStaffReportModal,
    handleStaffReportTestModal,
    buildContainer,
    buildTicketComponents,
    buildButtons,
};
