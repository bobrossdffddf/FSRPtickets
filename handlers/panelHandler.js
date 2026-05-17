/**
 * Panel interaction handler.
 *
 * Handles:
 *   ticket_panel_select   → show modal (general) or user-select (staff report)
 *   report_user_select    → store selected user, show reason modal
 *   modal_general_support → create general ticket
 *   modal_staff_report_*  → create staff-report ticket
 */
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
} = require('discord.js');
const cfg              = require('../config.json');
const { getRobloxInfo }    = require('../utils/roblox');
const { getTicket, saveTicket, nextTicketNumber } = require('../utils/db');

// ── Emoji constants ────────────────────────────────────────────────────────────
const E = {
    fsrp:    '<:FSRP:1500172509826383922>',
    ticket:  '<:ticket:1491123553985232946>',
    shield:  '<:shield:1491123625762492558>',
    user:    '<:User:1491123529918447910>',
    roblox:  '<:roblox:1492185913701302355>',
    staff:   '<:staff:1492185925415997612>',
    alert:   '<:Alert:1488257805071810630>',
    cross:   '<:_cross_:1488257725983883437>',
    check:   '<:check_yes_wb:1492185650449874994>',
    info:    '<:information:1492185664211386561>',
    tools:   '<:tools:1491123770214191275>',
    pin:     '<:pin:1491123495810367651>',
    bell:    '<:bell:1492185923964637364>',
    crown:   '<:crown:1491123666296246373>',
    mod:     '<:mod:1492008719351812287>',
    ban:     '<:_ban_:1488257829054840832>',
    link:    '<:link:1492185648709242953>',
    megaphone: '<:megaphone:1492185636248092802>',
    locked:  '<:locked:1492185928607862944>',
    FHP:     '<:FHP:1502769420605587527>',
    PD:      '<:PD:1502770159633436832>',
    FD:      '<:FD:1502770440324776077>',
    911:     '<:911:1502769071622586518>',
};

// In-memory map: userId → reportedUserId (ephemeral, cleared after ticket creation)
const pendingReports = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Panel dropdown select
// ─────────────────────────────────────────────────────────────────────────────
async function handlePanelSelect(interaction) {
    const value = interaction.values[0];

    // Check for duplicate open ticket
    const guild    = interaction.guild;
    const existing = guild.channels.cache.find(
        ch => ch.name.startsWith('gen-') || ch.name.startsWith('sr-')
    );
    // We check DB instead (more reliable)
    const hasOpen = Object.values(require('../utils/db').getAllTickets())
        .some(t => t.openerId === interaction.user.id);

    if (hasOpen) {
        return interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.warning)
                .setTitle(`${E.alert}  Existing Ticket Found`)
                .setDescription(
                    `${E.cross} You already have an open ticket.\n\n` +
                    `Please resolve your current ticket before opening a new one.\n` +
                    `If you cannot find it, ask a staff member for assistance.`
                )
                .setFooter({ text: 'Florida State Roleplay  •  Ticket System' })
            ],
            ephemeral: true,
        });
    }

    if (value === 'general') {
        // ── Show reason modal ──────────────────────────────────────────────────
        const modal = new ModalBuilder()
            .setCustomId('modal_general_support')
            .setTitle('General Support — FSRP');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('What do you need assistance with?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder(
                        'Please be as detailed as possible. Include any relevant information such as usernames, dates, and what happened.'
                    )
                    .setRequired(true)
                    .setMinLength(20)
                    .setMaxLength(1000)
            )
        );

        await interaction.showModal(modal);

    } else if (value === 'staffreport') {
        // ── Show user-select (Components V2 — UserSelectMenu) ─────────────────
        const embed = new EmbedBuilder()
            .setColor(cfg.colors.foundership)
            .setTitle(`${E.shield}  Staff Report — Step 1 of 2`)
            .setDescription(
                `${E.mod} Select the **staff member** you wish to report from the dropdown below.\n\n` +
                `${E.info} After selecting, you will be asked to provide a reason for your report.\n\n` +
                `${E.alert} **Please ensure your report is legitimate.** False reports may result in moderation action.`
            )
            .setFooter({ text: 'Florida State Roleplay  •  Ticket System' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId('report_user_select')
                .setPlaceholder('Select the staff member to report…')
                .setMinValues(1)
                .setMaxValues(1)
        );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// User select (staff report — Step 1)
// ─────────────────────────────────────────────────────────────────────────────
async function handleUserSelect(interaction) {
    const reportedUser = interaction.users.first();
    if (!reportedUser) return interaction.reply({ content: `${E.alert} No user selected.`, ephemeral: true });

    // Store for modal phase
    pendingReports.set(interaction.user.id, {
        userId: reportedUser.id,
        tag:    reportedUser.tag ?? reportedUser.username,
    });

    // Show reason modal
    const modal = new ModalBuilder()
        .setCustomId(`modal_staff_report_${reportedUser.id}`)
        .setTitle('Staff Report — Reason');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('reason')
                .setLabel(`Why are you reporting ${reportedUser.username}?`)
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder(
                    'Describe the incident in detail. Include timestamps, witnesses, and any evidence (screenshots can be shared in the ticket).'
                )
                .setRequired(true)
                .setMinLength(20)
                .setMaxLength(1000)
        )
    );

    await interaction.showModal(modal);
}

// ─────────────────────────────────────────────────────────────────────────────
// General support modal submit → create ticket
// ─────────────────────────────────────────────────────────────────────────────
async function handleGeneralModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const reason = interaction.fields.getTextInputValue('reason');
    await createTicket(interaction, 'general', reason, null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Staff report modal submit → create ticket
// ─────────────────────────────────────────────────────────────────────────────
async function handleStaffReportModal(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const reason       = interaction.fields.getTextInputValue('reason');
    const pending      = pendingReports.get(interaction.user.id);
    if (!pending) {
        return interaction.editReply({ content: `${E.alert} Session expired. Please try again.` });
    }
    pendingReports.delete(interaction.user.id);
    await createTicket(interaction, 'staffreport', reason, pending);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core ticket creation
// ─────────────────────────────────────────────────────────────────────────────
async function createTicket(interaction, type, reason, reportedInfo) {
    const guild      = interaction.guild;
    const opener     = interaction.user;
    const member     = await guild.members.fetch(opener.id).catch(() => null);
    const ticketNum  = nextTicketNumber();
    const padNum     = String(ticketNum).padStart(4, '0');

    const isGeneral      = type === 'general';
    const channelPrefix  = isGeneral ? 'gen' : 'sr';
    const safeName       = opener.username.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 12);
    const channelName    = `${channelPrefix}-${safeName}-${padNum}`;
    const categoryId     = cfg.categories.general;

    // ── Fetch Roblox info ──────────────────────────────────────────────────────
    const roblox = await getRobloxInfo(opener.id);

    // ── Create channel ─────────────────────────────────────────────────────────
    const channel = await guild.channels.create({
        name:   channelName,
        type:   ChannelType.GuildText,
        parent: categoryId,
        topic:  `Ticket #${padNum} | ${type === 'general' ? 'General Support' : 'Staff Report'} | Opened by ${opener.tag}`,
        permissionOverwrites: [
            // @everyone — no view
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            // Ticket opener — view + send
            {
                id:    opener.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks,
                ],
            },
            // Staff role — view + send (general support only)
            {
                id:    cfg.roles.staff,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.ManageMessages,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks,
                ],
            },
            // High Rank — always has access
            {
                id:    cfg.roles.highRank,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.ManageMessages,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks,
                ],
            },
            // Foundership — always has access
            {
                id:    cfg.roles.foundership,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.ManageMessages,
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks,
                ],
            },
        ],
    });

    // ── Build opening embed ────────────────────────────────────────────────────
    const embed = buildOpeningEmbed(opener, member, roblox, reason, type, ticketNum, padNum, reportedInfo);

    // ── Buttons row ────────────────────────────────────────────────────────────
    const buttonsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('claim_ticket')
            .setLabel('Claim')
            .setStyle(ButtonStyle.Success)
            .setEmoji({ id: '1492185650449874994', name: 'check_yes_wb' }),
        new ButtonBuilder()
            .setCustomId('unclaim_ticket')
            .setLabel('Unclaim')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('close_ticket')
            .setLabel('Close Ticket')
            .setStyle(ButtonStyle.Danger)
            .setEmoji({ id: '1488257725983883437', name: '_cross_' }),
    );

    const msg = await channel.send({
        content: `<@${opener.id}> ${E.bell} — <@&${cfg.roles.staff}>`,
        embeds:  [embed],
        components: [buttonsRow],
    });

    // ── Pin the opening message ────────────────────────────────────────────────
    await msg.pin().catch(() => {});

    // ── Save to DB ─────────────────────────────────────────────────────────────
    saveTicket(channel.id, {
        type,
        openerId:        opener.id,
        openerTag:       opener.tag ?? opener.username,
        claimedBy:       null,
        claimedByTag:    null,
        escalationLevel: 0,
        ticketNumber:    ticketNum,
        reason,
        reportedUserId:  reportedInfo?.userId ?? null,
        reportedUserTag: reportedInfo?.tag ?? null,
        roblox,
        openedAt:        Date.now(),
        openingMessageId: msg.id,
    });

    // ── Reply to opener ────────────────────────────────────────────────────────
    await interaction.editReply({
        embeds: [new EmbedBuilder()
            .setColor(cfg.colors.success)
            .setTitle(`${E.check}  Ticket Created`)
            .setDescription(
                `Your ticket has been created: <#${channel.id}>\n\n` +
                `${E.staff} A staff member will be with you shortly.\n` +
                `${E.info} Please provide any additional details in the ticket channel.`
            )
            .setFooter({ text: 'Florida State Roleplay  •  Ticket System' })
        ],
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Opening embed builder
// ─────────────────────────────────────────────────────────────────────────────
function buildOpeningEmbed(opener, member, roblox, reason, type, ticketNum, padNum, reportedInfo) {
    const isReport = type === 'staffreport';
    const color    = isReport ? cfg.colors.foundership : cfg.colors.main;
    const typeLabel = isReport ? 'Staff Report' : 'General Support';

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${isReport ? E.shield : E.ticket}  ${typeLabel}  •  Ticket #${padNum}`)
        .setDescription(
            `${E.fsrp} Welcome to **Florida State Roleplay** Support!\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `${E.staff} A staff member will be with you **shortly**.\n` +
            `${E.info} Please do not ping staff — they will respond when available.\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        )
        .setTimestamp();

    // ── Roblox info ────────────────────────────────────────────────────────────
    if (roblox) {
        embed.addFields(
            {
                name:  `${E.roblox}  Roblox Information`,
                value: [
                    `${E.user} **Username:** \`${roblox.username}\` (${roblox.id})`,
                    `**Display Name:** ${roblox.displayName}`,
                    `**Account Created:** ${roblox.created}`,
                    `${E.link} [View Profile](${roblox.profileUrl})`,
                ].join('\n'),
                inline: false,
            }
        );
        if (roblox.avatarUrl) embed.setThumbnail(roblox.avatarUrl);
    } else {
        embed.addFields({
            name:  `${E.roblox}  Roblox Information`,
            value: `${E.alert} Not linked via Bloxlink — no Roblox account found.`,
            inline: false,
        });
    }

    // ── Ticket info ────────────────────────────────────────────────────────────
    embed.addFields(
        {
            name:   `${E.user}  Opened By`,
            value:  `<@${opener.id}>\n\`${opener.tag ?? opener.username}\``,
            inline: true,
        },
        {
            name:   `${E.ticket}  Ticket Type`,
            value:  typeLabel,
            inline: true,
        },
        {
            name:   `${E.pin}  Ticket #`,
            value:  `\`${padNum}\``,
            inline: true,
        }
    );

    // ── Reason ─────────────────────────────────────────────────────────────────
    embed.addFields({
        name:  `${E.info}  Reason`,
        value: reason.length > 800 ? reason.substring(0, 800) + '…' : reason,
        inline: false,
    });

    // ── Staff report extra fields ──────────────────────────────────────────────
    if (isReport && reportedInfo) {
        embed.addFields({
            name:  `${E.mod}  Reported Staff Member`,
            value: `<@${reportedInfo.userId}>\n\`${reportedInfo.tag}\``,
            inline: false,
        });
    }

    embed
        .addFields({
            name:  `${E.tools}  Claim Status`,
            value: `${E.alert} Unclaimed — awaiting staff response.`,
            inline: false,
        })
        .setFooter({ text: 'Florida State Roleplay  •  Ticket System  •  Use /close to close this ticket' });

    return embed;
}

module.exports = {
    handlePanelSelect,
    handleUserSelect,
    handleGeneralModal,
    handleStaffReportModal,
};
