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
// Raw-JSON panel builders — no discord.js builders, plain API objects only so
// Discord renders them identically to the reference JSONs.
// ─────────────────────────────────────────────────────────────────────────────
function buildGeneralSupportPanelJSON(imgs, secondsLeft, continueEnabled) {
    const topUrl    = imgs.topBanner    ?? null;
    const bottomUrl = imgs.bottomBanner ?? imgs.banner ?? null;

    const inner = [];
    if (topUrl) inner.push({ type: 12, items: [{ media: { url: topUrl } }] });

    inner.push({
        type: 10,
        content: '# <:FSRP:1500172509826383922> General Support Panel \nHello! Welcome to the FSRP General Support Panel. Before we advance your ticket, if any of these describes your ticket please select them:',
    });

    inner.push({ type: 14, spacing: 2 });

    inner.push({
        type: 1,
        components: [
            { style: 2, type: 2, label: 'Staff Application',   emoji: { id: '1491568422205526118', name: 'staff',          animated: false }, custom_id: 'gs_staff_app' },
            { style: 2, type: 2, label: 'Department Inquiry',  emoji: { id: '1500172509826383922', name: 'FSRP',           animated: false }, custom_id: 'gs_dept_inquiry' },
            { style: 2, type: 2, label: 'Appeal a Punishment', emoji: { id: '1492185629214245066', name: 'tts_ban_white',  animated: false }, custom_id: 'gs_punishment_appeal' },
            { style: 2, type: 2, label: 'Bot Issues',          emoji: { id: '1492185927253229778', name: 'developer',      animated: false }, custom_id: 'gs_bot_issues' },
            { style: 4, type: 2, label: 'Continue to ticket',  emoji: { id: '1492185631223320726', name: 'whitesmalldot',  animated: false }, custom_id: 'gs_continue', disabled: !continueEnabled },
        ],
    });

    inner.push({
        type: 10,
        content: secondsLeft > 0
            ? `-# Please wait \`${secondsLeft} Second${secondsLeft !== 1 ? 's' : ''}\` to continue to ticket.`
            : `-# You may now continue to ticket.`,
    });

    inner.push({ type: 14, spacing: 2 });

    if (bottomUrl) inner.push({ type: 12, items: [{ media: { url: bottomUrl } }] });

    return [{ type: 17, components: inner }];
}

function buildStaffReportPanelJSON(imgs, secondsLeft, buttonsEnabled) {
    const topUrl    = imgs.topBanner    ?? null;
    const bottomUrl = imgs.bottomBanner ?? imgs.banner ?? null;

    const inner = [];
    if (topUrl) inner.push({ type: 12, items: [{ media: { url: topUrl } }] });

    inner.push({
        type: 10,
        content: '# <:FSRP:1500172509826383922> Staff Report Panel\nWelcome to the FSRP Staff report panel. By pressing the `Report` button below you agree to all rules and standards. All evidence you have must be real, complete, and with context. All reports with no context will be closed with minimal correspondence. Punishment for false reports lead up to a permanent ban from FSRP and it subsidiaries.\n-# To report memebers of Foundership please create a Foundership Report ticket.',
    });

    inner.push({ type: 14, spacing: 2 });

    inner.push({
        type: 1,
        components: [
            { style: 4, type: 2, label: 'Report',              emoji: { id: '1492185629214245066', name: 'tts_ban_white', animated: false }, custom_id: 'open_staff_report',      disabled: !buttonsEnabled },
            { style: 2, type: 2, label: 'Foundership Report',  emoji: { id: '1492185641075867924', name: 'other_icon',    animated: false }, custom_id: 'open_foundership_report', disabled: !buttonsEnabled },
        ],
    });

    inner.push({
        type: 10,
        content: secondsLeft > 0
            ? `-# Please wait \`${secondsLeft} Second${secondsLeft !== 1 ? 's' : ''}\` to continue to report.`
            : `-# You may now continue to report.`,
    });

    inner.push({ type: 14, spacing: 2 });

    if (bottomUrl) inner.push({ type: 12, items: [{ media: { url: bottomUrl } }] });

    return [{ type: 17, components: inner }];
}

// ─────────────────────────────────────────────────────────────────────────────
// Countdown — edits ephemeral panel every second via raw REST.
// Both build functions return plain arrays so no .toJSON() needed.
// ─────────────────────────────────────────────────────────────────────────────
async function _runCountdown(interaction, buildFn, buildArgs, totalSeconds) {
    for (let i = totalSeconds - 1; i >= 1; i--) {
        await new Promise(r => setTimeout(r, 1000));
        const components = buildFn(...buildArgs, i, false);
        await interaction.client.rest.patch(
            `/webhooks/${interaction.applicationId}/${interaction.token}/messages/@original`,
            { body: { flags: 32768, components } }
        ).catch(() => {});
    }
    await new Promise(r => setTimeout(r, 1000));
    const components = buildFn(...buildArgs, 0, true);
    await interaction.client.rest.patch(
        `/webhooks/${interaction.applicationId}/${interaction.token}/messages/@original`,
        { body: { flags: 32768, components } }
    ).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Main panel buttons — both use raw REST so the payload is sent verbatim
// ─────────────────────────────────────────────────────────────────────────────
async function handlePanelGeneralBtn(interaction) {
    const imgs = loadImages();
    await interaction.client.rest.post(
        Routes.interactionCallback(interaction.id, interaction.token),
        {
            body: {
                type: 4,
                data: {
                    flags: 32832,
                    components: buildGeneralSupportPanelJSON(imgs, 5, false),
                    allowed_mentions: { parse: [] },
                },
            },
        }
    );
    interaction._replied = true;

    _runCountdown(interaction, buildGeneralSupportPanelJSON, [imgs], 5)
        .catch(err => console.error('[Panel] General countdown error:', err?.message));
}

async function handlePanelStaffBtn(interaction) {
    const imgs = loadImages();
    await interaction.client.rest.post(
        Routes.interactionCallback(interaction.id, interaction.token),
        {
            body: {
                type: 4,
                data: {
                    flags: 32832,
                    components: buildStaffReportPanelJSON(imgs, 5, false),
                    allowed_mentions: { parse: [] },
                },
            },
        }
    );
    interaction._replied = true;

    _runCountdown(interaction, buildStaffReportPanelJSON, [imgs], 5)
        .catch(err => console.error('[Panel] Staff countdown error:', err?.message));
}

// ─────────────────────────────────────────────────────────────────────────────
// General Support sub-embed handlers
// Send exact raw JSON payloads — no builders — so Discord renders them
// identically to the reference JSON the user provided.
// flags 32832 = Ephemeral (64) | IsComponentsV2 (32768)
// ─────────────────────────────────────────────────────────────────────────────
async function handleGsDeptInquiry(interaction) {
    await interaction.client.rest.post(
        Routes.interactionCallback(interaction.id, interaction.token),
        {
            body: {
                type: 4,
                data: {
                    flags: 32832,
                    components: [
                        {
                            type: 17,
                            components: [
                                {
                                    type: 10,
                                    content: "# <:FSRP:1500172509826383922> Department Inquiry\nFor all Department Inquiry's please go to the respective department and create a ticket there. If they are unable to ",
                                },
                                {
                                    type: 1,
                                    components: [
                                        { type: 2, style: 5, label: 'Tampa Police Department',              emoji: { id: '1502770159633436832', name: 'PD',      animated: false }, url: 'https://discord.gg/yrREHPeSkr' },
                                        { type: 2, style: 5, label: 'Florida Highway Patrol',               emoji: { id: '1502769420605587527', name: 'FHP',     animated: false }, url: 'https://discord.gg/g8mRfrC2m8' },
                                        { type: 2, style: 5, label: "Hillsborough County Sheriff's Office", emoji: { id: '1502769894200971315', name: 'Sheriff', animated: false }, url: 'https://discord.gg/keM4WeSP78' },
                                        { type: 2, style: 5, label: 'Tampa Fire Department',                emoji: { id: '1502770440324776077', name: 'FD',      animated: false }, url: 'https://discord.gg/d2GKpYAP3s' },
                                        { type: 2, style: 5, label: ' Florida Department of Transportation', emoji: { id: '1503571429445206176', name: 'FDOT',   animated: false }, url: 'https://discord.gg/92bSrq2u4u' },
                                    ],
                                },
                                {
                                    type: 1,
                                    components: [
                                        { type: 2, style: 5, label: 'Florida Department of Communications', emoji: { id: '1502769071622586518', name: '911', animated: false }, url: 'https://discord.gg/5CXA3pz3yU' },
                                    ],
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

async function handleGsStaffApp(interaction) {
    await interaction.client.rest.post(
        Routes.interactionCallback(interaction.id, interaction.token),
        {
            body: {
                type: 4,
                data: {
                    flags: 32832,
                    components: [
                        {
                            type: 1,
                            components: [
                                { type: 2, style: 5, label: 'Staff Application', emoji: { id: '1492185648709242953', name: 'link', animated: false }, url: 'https://melonly.xyz/forms/7455364220285095936' },
                            ],
                        },
                    ],
                },
            },
        }
    );
    interaction._replied = true;
}

async function handleGsPunishmentAppeal(interaction) {
    await interaction.client.rest.post(
        Routes.interactionCallback(interaction.id, interaction.token),
        {
            body: {
                type: 4,
                data: {
                    flags: 32832,
                    components: [
                        {
                            type: 1,
                            components: [
                                { type: 2, style: 5, label: 'Punishment Appeal', emoji: { id: '1492185629214245066', name: 'tts_ban_white', animated: false }, url: 'https://melon.ly/form/7455341798160863232' },
                            ],
                        },
                    ],
                },
            },
        }
    );
    interaction._replied = true;
}

async function handleGsBotIssues(interaction) {
    await interaction.client.rest.post(
        Routes.interactionCallback(interaction.id, interaction.token),
        {
            body: {
                type: 4,
                data: {
                    flags: 32832,
                    components: [
                        {
                            type: 17,
                            components: [
                                {
                                    type: 10,
                                    content: '# <:FSRP:1500172509826383922> Bot Issues\nPlease direct all bot issues to <@848356730256883744> our bot developer. His DM\'s are open. If they are not open please create a ticket.',
                                },
                                {
                                    type: 1,
                                    components: [
                                        { type: 2, style: 5, label: 'Contact Wacko', emoji: { id: '1491568474697371749', name: 'developer', animated: false }, url: 'https://discord.com/users/717462002235965492' },
                                    ],
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

// Continue to ticket — opens the general support modal
async function handleGsContinue(interaction) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Staff Report panel — show modals (triggered after countdown)
// ─────────────────────────────────────────────────────────────────────────────
async function handleOpenStaffReportBtn(interaction) {
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

    await interaction.client.rest.post(
        Routes.interactionCallback(interaction.id, interaction.token),
        {
            body: {
                type: 9,
                data: {
                    custom_id: 'modal_staff_report',
                    title: 'Staff Report',
                    components: [
                        {
                            type: 18,
                            label: 'Who are you reporting?',
                            component: {
                                type: 5,
                                custom_id: 'reported_user',
                                placeholder: 'Select the staff member to report…',
                                min_values: 1,
                                max_values: 1,
                                required: true,
                            },
                        },
                        {
                            type: 1,
                            components: [{
                                type: 4,
                                custom_id: 'reason',
                                label: 'What did they do?',
                                style: 2,
                                placeholder: 'Include dates, what happened, and any evidence links.',
                                required: true,
                                min_length: 10,
                                max_length: 1000,
                            }],
                        },
                    ],
                },
            },
        }
    );
    interaction._replied = true;
}

async function handleOpenFoundershipReportBtn(interaction) {
    await interaction.client.rest.post(
        Routes.interactionCallback(interaction.id, interaction.token),
        {
            body: {
                type: 9,
                data: {
                    custom_id: 'modal_foundership_report',
                    title: 'Foundership Report',
                    components: [
                        {
                            type: 18,
                            label: 'Who are you reporting?',
                            component: {
                                type: 5,
                                custom_id: 'reported_user',
                                placeholder: 'Select the foundership member to report…',
                                min_values: 1,
                                max_values: 1,
                                required: true,
                            },
                        },
                        {
                            type: 1,
                            components: [{
                                type: 4,
                                custom_id: 'reason',
                                label: 'What did they do?',
                                style: 2,
                                placeholder: 'Include dates, what happened, and any evidence links.',
                                required: true,
                                min_length: 10,
                                max_length: 1000,
                            }],
                        },
                    ],
                },
            },
        }
    );
    interaction._replied = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel dropdown (legacy — used by /test command)
// ─────────────────────────────────────────────────────────────────────────────
async function handlePanelSelect(interaction) {
    await _handleSelect(interaction, false);
}

async function handleTestPanelSelect(interaction) {
    await _handleSelect(interaction, true);
}

async function _handleSelect(interaction, noPing) {
    const value = interaction.values[0];

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
                    type: 9,
                    data: {
                        custom_id: noPing ? 'modal_staff_report_test' : 'modal_staff_report',
                        title: 'Staff Report',
                        components: [
                            {
                                type: 18,
                                label: 'Who are you reporting?',
                                component: {
                                    type: 5,
                                    custom_id: 'reported_user',
                                    placeholder: 'Select the staff member to report…',
                                    min_values: 1,
                                    max_values: 1,
                                    required: true,
                                },
                            },
                            {
                                type: 1,
                                components: [
                                    {
                                        type: 4,
                                        custom_id: 'reason',
                                        label: 'What did they do?',
                                        style: 2,
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
// Foundership report modal submit — DMs report to a specific user only
// ─────────────────────────────────────────────────────────────────────────────
const FOUNDERSHIP_DM_TARGET = '998003655657660477';

async function handleFoundershipReportModal(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const reason = interaction.fields.getTextInputValue('reason');
    const reportedInfo = await _extractReportedUser(interaction);
    if (!reportedInfo) return;

    const opener = interaction.user;

    let openerRoblox = null, reportedRoblox = null;
    try {
        [openerRoblox, reportedRoblox] = await Promise.all([
            getRobloxInfo(opener.id),
            reportedInfo.userId ? getRobloxInfo(reportedInfo.userId) : Promise.resolve(null),
        ]);
    } catch { /* best-effort */ }

    const reportedMention = reportedInfo.userId
        ? `<@${reportedInfo.userId}> (${reportedInfo.tag})`
        : reportedInfo.tag;

    const safeReason = reason.length > 1000 ? reason.substring(0, 1000) + '…' : reason;

    const dmEmbed = new EmbedBuilder()
        .setColor(cfg.colors.foundership)
        .setTitle('New Foundership Report')
        .addFields(
            { name: 'Reported By',   value: `<@${opener.id}> (${opener.username})`, inline: true },
            { name: 'Reported User', value: reportedMention,                          inline: true },
            { name: 'Reason',        value: safeReason,                               inline: false },
        )
        .setFooter({ text: 'Florida State Roleplay  •  Foundership Report' })
        .setTimestamp();

    if (openerRoblox) {
        dmEmbed.addFields({
            name:   'Reporter Roblox',
            value:  `[${openerRoblox.username}](${openerRoblox.profileUrl}) (\`${openerRoblox.id}\`)`,
            inline: true,
        });
    }
    if (reportedRoblox) {
        dmEmbed.addFields({
            name:   'Reported Roblox',
            value:  `[${reportedRoblox.username}](${reportedRoblox.profileUrl}) (\`${reportedRoblox.id}\`)`,
            inline: true,
        });
    }

    try {
        const targetUser = await interaction.client.users.fetch(FOUNDERSHIP_DM_TARGET);
        await targetUser.send({ embeds: [dmEmbed] });
    } catch (err) {
        console.error('[FoundershipReport] Failed to DM report:', err?.message);
        return interaction.editReply({
            content: '❌ Failed to submit your report. Please try again or contact an administrator.',
        });
    }

    await interaction.editReply({ content: '✅ Your foundership report has been submitted. Thank you.' });
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
        permissionOverwrites: buildTicketOverwrites(guild, opener.id, null, isReport),
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
    // Main panel button handlers
    handlePanelGeneralBtn,
    handlePanelStaffBtn,
    // General Support sub-embed handlers
    handleGsDeptInquiry,
    handleGsStaffApp,
    handleGsPunishmentAppeal,
    handleGsBotIssues,
    handleGsContinue,
    // Staff Report panel handlers
    handleOpenStaffReportBtn,
    handleOpenFoundershipReportBtn,
    // Modal handlers
    handleFoundershipReportModal,
    handleGeneralModal,
    handleGeneralTestModal,
    handleStaffReportModal,
    handleStaffReportTestModal,
    // Legacy dropdown (used by /test)
    handlePanelSelect,
    handleTestPanelSelect,
    // Builders (used by buttonHandler)
    buildContainer,
    buildTicketComponents,
    buildButtons,
};
