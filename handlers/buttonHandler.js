const {
    EmbedBuilder,
    AttachmentBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    Routes,
} = require('discord.js');

const fs   = require('fs');
const path = require('path');

const cfg = require('../config.json');
const { getTicket, saveTicket, deleteTicket } = require('../utils/db');
const { loadSettings } = require('../utils/settings');

// ─────────────────────────────────────────────────────────────────────────────
// Partnerships persistence
// ─────────────────────────────────────────────────────────────────────────────
const PARTNERSHIPS_FILE = path.join(__dirname, '../data/partnerships.json');

function _readPartnerships() {
    try { return JSON.parse(fs.readFileSync(PARTNERSHIPS_FILE, 'utf8')); }
    catch { return {}; }
}

function _savePartnerships(data) {
    fs.writeFileSync(PARTNERSHIPS_FILE, JSON.stringify(data, null, 2));
}
const { isStaff, isHighRank } = require('../utils/permissions');
const { generateTranscript } = require('../utils/transcript');
const { buildTicketComponents, buildButtons } = require('./panelHandler');
const { addEntry, refreshIndexMessage } = require('../utils/transcriptIndex');

// ─────────────────────────────────────────────────────────────────────────────
// Helper — rebuild the pinned embed + buttons and edit the message in-place
// ─────────────────────────────────────────────────────────────────────────────
async function _refreshPinnedEmbed(channel, ticket) {
    if (!ticket.openingMessageId) return;

    const params = {
        opener:        { id: ticket.openerId, username: ticket.openerTag },
        roblox:        ticket.roblox,
        robloxFetching: false,
        robloxFailed:  !ticket.roblox,
        reason:        ticket.reason,
        type:          ticket.type,
        padNum:        String(ticket.ticketNumber).padStart(4, '0'),
        reportedInfo:  ticket.reportedUserId
            ? { userId: ticket.reportedUserId, tag: ticket.reportedUserTag }
            : (ticket.reportedUserTag ? { userId: null, tag: ticket.reportedUserTag } : null),
        reportedRoblox: ticket.reportedRoblox ?? null,
        claimed:       ticket.claimedBy,
    };

    // Use REST directly — message.edit() includes a `content` field in the body
    // which Discord rejects for IS_COMPONENTS_V2 messages.
    const components = buildTicketComponents(ticket, params)
        .map(c => (typeof c.toJSON === 'function' ? c.toJSON() : c));

    // MessageFlags values are BigInts in discord.js v14; raw REST bodies must
    // receive a plain integer or Discord serialises it as a string and rejects it.
    await channel.client.rest.patch(
        Routes.channelMessage(channel.id, ticket.openingMessageId),
        { body: { flags: Number(MessageFlags.IsComponentsV2), components } },
    ).catch(err => console.error('[Ticket] Failed to refresh pinned container:', err?.message));
}

// ─────────────────────────────────────────────────────────────────────────────
// Button handler
// ─────────────────────────────────────────────────────────────────────────────
async function handleButton(interaction) {
    const { customId, channel, user, member } = interaction;

    // ── Toggle Claim / Unclaim ────────────────────────────────────────────────
    if (customId === 'toggle_claim_ticket') {
        const ticket = getTicket(channel.id);
        if (!ticket) return interaction.reply({ content: 'Not a ticket channel.', flags: MessageFlags.Ephemeral });

        if (!isStaff(member, interaction.guild)) return interaction.reply({ content: 'Only staff can claim tickets.', flags: MessageFlags.Ephemeral });

        await interaction.deferReply();

        // ── Currently unclaimed → claim ───────────────────────────────────────
        if (!ticket.claimedBy) {
            await channel.permissionOverwrites.edit(user.id, {
                ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
                AttachFiles: true, EmbedLinks: true, ManageMessages: true,
            });

            ticket.claimedBy    = user.id;
            ticket.claimedByTag = user.username;
            saveTicket(channel.id, ticket);

            await _refreshPinnedEmbed(channel, ticket);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(cfg.colors.success)
                    .setDescription(`<@${user.id}> has claimed this ticket.`)
                    .setFooter({ text: 'Florida State Roleplay' })
                ],
            });

        // ── Currently claimed → unclaim ───────────────────────────────────────
        } else {
            if (ticket.claimedBy !== user.id) {
                return interaction.editReply({
                    content: 'Only the person who claimed this ticket can unclaim it.',
                });
            }

            const previousClaimer = ticket.claimedBy;
            await channel.permissionOverwrites.delete(previousClaimer).catch(() => {});

            ticket.claimedBy    = null;
            ticket.claimedByTag = null;
            saveTicket(channel.id, ticket);

            await _refreshPinnedEmbed(channel, ticket);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(cfg.colors.neutral)
                    .setDescription(`<@${previousClaimer}> has been unclaimed from this ticket.`)
                    .setFooter({ text: 'Florida State Roleplay' })
                ],
            });
        }
    }

    // ── Close — show reason modal ─────────────────────────────────────────────
    else if (customId === 'close_ticket') {
        const ticket = getTicket(channel.id);
        if (!ticket) return interaction.reply({ content: 'Not a ticket channel.', flags: MessageFlags.Ephemeral });

        if (!isStaff(member, interaction.guild) && user.id !== ticket.openerId) {
            return interaction.reply({ content: 'You do not have permission to close this ticket.', flags: MessageFlags.Ephemeral });
        }

        const modal = new ModalBuilder()
            .setCustomId('modal_close_ticket')
            .setTitle('Close Ticket');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('close_reason')
                    .setLabel('Reason for closing')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('e.g. Resolved, User did not respond, Duplicate ticket, Invalid/spam…')
                    .setRequired(true)
                    .setMinLength(3)
                    .setMaxLength(500)
            ),
        );

        return interaction.showModal(modal);
    }

    // ── Close request — Accept ────────────────────────────────────────────────
    else if (customId === 'closereq_accept') {
        const ticket = getTicket(channel.id);
        if (!ticket) return interaction.reply({ content: 'Not a ticket channel.', flags: MessageFlags.Ephemeral });
        if (user.id !== ticket.openerId) {
            return interaction.reply({ content: 'Only the ticket opener can respond to this.', flags: MessageFlags.Ephemeral });
        }

        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.success)
                .setDescription(`<@${ticket.openerId}> has accepted the close request. Closing ticket…`)
                .setFooter({ text: 'Florida State Roleplay' })
            ],
            components: [],
        });

        await _closeTicket(channel, interaction.guild, user, 'Accepted close request');
    }

    // ── Close request — Deny ──────────────────────────────────────────────────
    else if (customId === 'closereq_deny') {
        const ticket = getTicket(channel.id);
        if (!ticket) return interaction.reply({ content: 'Not a ticket channel.', flags: MessageFlags.Ephemeral });
        if (user.id !== ticket.openerId) {
            return interaction.reply({ content: 'Only the ticket opener can respond to this.', flags: MessageFlags.Ephemeral });
        }

        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.foundership)
                .setDescription(`<@${ticket.openerId}> has declined the close request. The ticket remains open.`)
                .setFooter({ text: 'Florida State Roleplay' })
            ],
            components: [],
        });
    }

    // ── Partnership — open application modal ──────────────────────────────────
    else if (customId.startsWith('partnership_apply:')) {
        const openerId = customId.split(':')[1];
        if (user.id !== openerId) {
            return interaction.reply({
                content: 'Only the ticket opener can submit the partnership application.',
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.client.rest.post(
            Routes.interactionCallback(interaction.id, interaction.token),
            {
                body: {
                    type: 9,
                    data: {
                        custom_id: 'modal_partnership_apply',
                        title: 'Partnership Application',
                        components: [
                            {
                                type: 18,
                                label: 'Who are your reps in our server?',
                                component: {
                                    type: 5,
                                    custom_id: 'partnership_reps',
                                    placeholder: 'Select representatives (optional)…',
                                    min_values: 0,
                                    max_values: 5,
                                    required: false,
                                },
                            },
                            {
                                type: 1,
                                components: [{
                                    type: 4,
                                    custom_id: 'partnership_server_name',
                                    label: 'Server Name',
                                    style: 1,
                                    placeholder: 'Your Discord server name',
                                    required: true,
                                    max_length: 100,
                                }],
                            },
                            {
                                type: 1,
                                components: [{
                                    type: 4,
                                    custom_id: 'partnership_invite_link',
                                    label: 'Server Invite Link',
                                    style: 1,
                                    placeholder: 'https://discord.gg/…',
                                    required: true,
                                    max_length: 200,
                                }],
                            },
                            {
                                type: 1,
                                components: [{
                                    type: 4,
                                    custom_id: 'partnership_ad',
                                    label: 'Server Advertisement',
                                    style: 2,
                                    placeholder: 'Paste your full server advertisement here…',
                                    required: true,
                                    max_length: 4000,
                                }],
                            },
                        ],
                    },
                },
            }
        );
        interaction._replied = true;
    }

    // ── Partnership — HR Approve ──────────────────────────────────────────────
    else if (customId === 'partnership_approve') {
        if (!isHighRank(member, interaction.guild)) {
            return interaction.reply({
                content: 'Only High Rank+ can approve partnership applications.',
                flags: MessageFlags.Ephemeral,
            });
        }

        const pending = _readPartnerships();
        const data    = pending[channel.id];
        if (!data) {
            return interaction.reply({
                content: 'No pending partnership application found for this ticket.',
                flags: MessageFlags.Ephemeral,
            });
        }

        const settings       = loadSettings();
        const partnershipsId = settings.partnershipsChannelId;
        if (!partnershipsId) {
            return interaction.reply({
                content: '❌ Partnerships channel has not been configured. Use `/setup partnerships-channel` first.',
                flags: MessageFlags.Ephemeral,
            });
        }

        const partnershipsCh = await interaction.guild.channels.fetch(partnershipsId).catch(() => null);
        if (!partnershipsCh) {
            return interaction.reply({
                content: '❌ Could not find the configured partnerships channel.',
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferUpdate();

        const repDisplay = data.reps?.length > 0
            ? data.reps.map(id => `<@${id}>`).join(', ')
            : 'None';

        const postEmbed = new EmbedBuilder()
            .setColor(cfg.colors.success)
            .setTitle(data.serverName)
            .setDescription(data.ad)
            .addFields(
                { name: 'Applied By',      value: `<@${data.openerId}>`, inline: true },
                { name: 'Representatives', value: repDisplay,            inline: true },
                { name: 'Approved By',     value: `<@${user.id}>`,       inline: true },
            )
            .setFooter({ text: 'Florida State Roleplay  •  Partnerships' })
            .setTimestamp();

        const postComponents = [];
        if (data.inviteLink) {
            const safeUrl = /^https?:\/\//i.test(data.inviteLink) ? data.inviteLink : 'https://' + data.inviteLink;
            postComponents.push(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('Join Server')
                        .setStyle(ButtonStyle.Link)
                        .setURL(safeUrl)
                        .setEmoji({ id: '1492185648709242953', name: 'link' }),
                )
            );
        }

        await partnershipsCh.send({ embeds: [postEmbed], components: postComponents });

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.success)
                .setTitle('Partnership Application — Approved')
                .setDescription(
                    `✅ Approved by <@${user.id}>.\n` +
                    `The advertisement has been posted in <#${partnershipsCh.id}>.`
                )
                .setFooter({ text: 'Florida State Roleplay  •  Partnerships' })
                .setTimestamp()
            ],
            components: [],
        });

        delete pending[channel.id];
        _savePartnerships(pending);
    }

    // ── Partnership — HR Deny ─────────────────────────────────────────────────
    else if (customId === 'partnership_deny') {
        if (!isHighRank(member, interaction.guild)) {
            return interaction.reply({
                content: 'Only High Rank+ can deny partnership applications.',
                flags: MessageFlags.Ephemeral,
            });
        }

        const pending = _readPartnerships();
        const data    = pending[channel.id];
        if (!data) {
            return interaction.reply({
                content: 'No pending partnership application found for this ticket.',
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.warning)
                .setTitle('Partnership Application — Denied')
                .setDescription(`❌ Denied by <@${user.id}>.`)
                .setFooter({ text: 'Florida State Roleplay  •  Partnerships' })
                .setTimestamp()
            ],
            components: [],
        });

        delete pending[channel.id];
        _savePartnerships(pending);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal submit — close reason  (routed from interactionCreate)
// ─────────────────────────────────────────────────────────────────────────────
async function handleCloseModal(interaction) {
    const ticket = getTicket(interaction.channelId);
    if (!ticket) return interaction.reply({ content: 'Not a ticket channel.', flags: MessageFlags.Ephemeral });

    const member = interaction.member;
    if (!isStaff(member, interaction.guild) && interaction.user.id !== ticket.openerId) {
        return interaction.reply({ content: 'You do not have permission to close this ticket.', flags: MessageFlags.Ephemeral });
    }

    const closeReason = interaction.fields.getTextInputValue('close_reason').trim();
    await interaction.deferUpdate().catch(() => interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {}));
    await _closeTicket(interaction.channel, interaction.guild, interaction.user, closeReason);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared close logic
// ─────────────────────────────────────────────────────────────────────────────
async function _closeTicket(channel, guild, closedBy, closeReason = 'No reason provided') {
    const ticket = getTicket(channel.id);
    if (!ticket) return;

    await channel.send({
        embeds: [new EmbedBuilder()
            .setColor(cfg.colors.neutral)
            .setTitle('Ticket Closing')
            .addFields(
                { name: 'Closed By',    value: `<@${closedBy.id}>`,  inline: true },
                { name: 'Close Reason', value: closeReason,           inline: true },
            )
            .setDescription('Saving transcript…')
            .setFooter({ text: 'Florida State Roleplay' })
        ],
    });

    // Generate transcript (returns { filepath, url, filename })
    let transcriptResult = null;
    try { transcriptResult = await generateTranscript(channel, ticket, closeReason); } catch (e) { console.error('[transcript]', e); }

    // Post to transcripts channel
    const transcriptCh = await guild.channels.fetch(cfg.channels.transcripts).catch(() => null);
    if (transcriptCh) {
        const levelLabel = ['Staff', 'High Rank', 'Foundership'][ticket.escalationLevel] ?? 'Staff';

        const infoEmbed = new EmbedBuilder()
            .setColor(cfg.colors.neutral)
            .setTitle(`Ticket Closed — #${String(ticket.ticketNumber).padStart(4, '0')}`)
            .addFields(
                { name: 'Type',         value: ticket.type === 'staffreport' ? 'Staff Report' : 'General Support', inline: true },
                { name: 'Opened By',    value: `<@${ticket.openerId}>`,                                            inline: true },
                { name: 'Claimed By',   value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Unclaimed',          inline: true },
                { name: 'Closed By',    value: `<@${closedBy.id}>`,                                                inline: true },
                { name: 'Close Reason', value: closeReason,                                                         inline: true },
                { name: 'Escalation',   value: levelLabel,                                                          inline: true },
                { name: 'Channel',      value: `\`#${channel.name}\``,                                             inline: true },
            )
            .setFooter({ text: 'Florida State Roleplay' })
            .setTimestamp();

        // Always add the View Transcript button if we have a URL
        const components = [];
        if (transcriptResult?.url) {
            components.push(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('View Transcript')
                        .setStyle(ButtonStyle.Link)
                        .setURL(transcriptResult.url),
                ),
            );
        }

        const files = transcriptResult?.filepath
            ? [new AttachmentBuilder(transcriptResult.filepath, { name: `transcript-${channel.name}.html` })]
            : [];

        const sentMsg = await transcriptCh.send({ embeds: [infoEmbed], files, components });

        addEntry({ ticketNumber: ticket.ticketNumber, type: ticket.type, messageId: sentMsg.id });
        await refreshIndexMessage(guild);
    }

    // DM the opener with close details
    try {
        const opener = await guild.client.users.fetch(ticket.openerId).catch(() => null);
        if (opener) {
            const padNum = String(ticket.ticketNumber).padStart(4, '0');
            const dmEmbed = new EmbedBuilder()
                .setColor(cfg.colors.neutral)
                .setTitle(`Ticket #${padNum} Closed — Florida State Roleplay`)
                .addFields(
                    { name: 'Closed By',    value: `${closedBy.username} (<@${closedBy.id}>)`, inline: true },
                    { name: 'Close Reason', value: closeReason,                                  inline: true },
                )
                .setFooter({ text: 'Florida State Roleplay' })
                .setTimestamp();

            const dmComponents = [];
            if (transcriptResult?.url) {
                dmComponents.push(
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('View Transcript')
                            .setStyle(ButtonStyle.Link)
                            .setURL(transcriptResult.url),
                    ),
                );
            }

            await opener.send({ embeds: [dmEmbed], components: dmComponents }).catch(() => {});
        }
    } catch { /* DMs closed or user not fetchable */ }

    deleteTicket(channel.id);
    setTimeout(() => channel.delete('Ticket closed').catch(() => {}), 3000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal submit — partnership application  (routed from interactionCreate)
// ─────────────────────────────────────────────────────────────────────────────
async function handlePartnershipModal(interaction) {
    await interaction.deferReply();

    const channelId  = interaction.channelId;
    const serverName = interaction.fields.getTextInputValue('partnership_server_name').trim();
    let inviteLink = interaction.fields.getTextInputValue('partnership_invite_link').trim();
    if (inviteLink && !/^https?:\/\//i.test(inviteLink)) inviteLink = 'https://' + inviteLink;
    const ad         = interaction.fields.getTextInputValue('partnership_ad').trim();

    let repIds = [];
    try {
        const users = interaction.fields.getSelectedUsers('partnership_reps');
        if (users?.size) repIds = [...users.keys()];
    } catch { /* optional — no users selected */ }

    // Save pending partnership data keyed by channel so approve/deny can retrieve it
    const pending = _readPartnerships();
    pending[channelId] = {
        openerId:   interaction.user.id,
        openerTag:  interaction.user.username,
        serverName,
        inviteLink,
        ad,
        reps:       repIds,
        submittedAt: Date.now(),
    };
    _savePartnerships(pending);

    // Move ticket to HR (highRank) category so HR staff can see it
    const hrCat = await interaction.guild.channels.fetch(cfg.categories.highRank).catch(() => null);
    if (hrCat) await interaction.channel.setParent(hrCat.id, { lockPermissions: false }).catch(() => {});

    // Disable the "Submit Partnership Application" button so it can't be resubmitted
    try {
        const msgs = await interaction.channel.messages.fetch({ limit: 50 });
        const applyMsg = msgs.find(m =>
            m.author.id === interaction.client.user.id &&
            m.components?.some(row =>
                row.components?.some(c => c.customId?.startsWith('partnership_apply:'))
            )
        );
        if (applyMsg) {
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`partnership_apply:${interaction.user.id}`)
                    .setLabel('Application Submitted')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
            );
            await applyMsg.edit({ components: [disabledRow] });
        }
    } catch { /* best-effort */ }

    const repDisplay = repIds.length > 0 ? repIds.map(id => `<@${id}>`).join(', ') : 'None';
    const safeAd     = ad.length > 4000 ? ad.substring(0, 4000) + '…' : ad;

    const reviewEmbed = new EmbedBuilder()
        .setColor(cfg.colors.warning)
        .setTitle(`Partnership Application — ${serverName}`)
        .setDescription(safeAd)
        .addFields(
            { name: 'Applied By',      value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Representatives', value: repDisplay,                   inline: true },
            { name: 'Invite Link',     value: inviteLink,                   inline: false },
        )
        .setFooter({ text: 'Florida State Roleplay  •  Partnerships  •  Pending Review' })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('partnership_approve')
            .setLabel('Approve')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('partnership_deny')
            .setLabel('Deny')
            .setStyle(ButtonStyle.Danger),
    );

    await interaction.editReply({
        content: `<@&${cfg.roles.highRank}>`,
        embeds: [reviewEmbed],
        components: [row],
        allowedMentions: { roles: [cfg.roles.highRank] },
    });
}

module.exports = { handleButton, handleCloseModal, handlePartnershipModal };
