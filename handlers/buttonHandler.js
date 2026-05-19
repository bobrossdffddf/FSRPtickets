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
} = require('discord.js');

const cfg = require('../config.json');
const { getTicket, saveTicket, deleteTicket } = require('../utils/db');
const { generateTranscript } = require('../utils/transcript');
const { buildTicketComponents, buildButtons } = require('./panelHandler');

// ─────────────────────────────────────────────────────────────────────────────
// Helper — rebuild the pinned embed + buttons and edit the message in-place
// ─────────────────────────────────────────────────────────────────────────────
async function _refreshPinnedEmbed(channel, ticket) {
    if (!ticket.openingMessageId) return;
    const pinned = await channel.messages.fetch(ticket.openingMessageId).catch(() => null);
    if (!pinned) return;

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

    await pinned.edit({
        flags:           MessageFlags.IsComponentsV2,
        components:      buildTicketComponents(ticket, params),
        allowedMentions: { parse: [] },
    }).catch(err => console.error('[Ticket] Failed to refresh pinned container:', err?.message));
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

        const isStaff = member.roles.cache.has(cfg.roles.staff) ||
                        member.roles.cache.has(cfg.roles.highRank) ||
                        member.roles.cache.has(cfg.roles.foundership);
        if (!isStaff) return interaction.reply({ content: 'Only staff can claim tickets.', flags: MessageFlags.Ephemeral });

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
            const isHR = member.roles.cache.has(cfg.roles.highRank) || member.roles.cache.has(cfg.roles.foundership);
            if (ticket.claimedBy !== user.id && !isHR) {
                return interaction.editReply({
                    content: 'Only the claimer or High Rank+ can unclaim this ticket.',
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

        const isStaff = member.roles.cache.has(cfg.roles.staff) ||
                        member.roles.cache.has(cfg.roles.highRank) ||
                        member.roles.cache.has(cfg.roles.foundership);
        if (!isStaff && user.id !== ticket.openerId) {
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal submit — close reason  (routed from interactionCreate)
// ─────────────────────────────────────────────────────────────────────────────
async function handleCloseModal(interaction) {
    const ticket = getTicket(interaction.channelId);
    if (!ticket) return interaction.reply({ content: 'Not a ticket channel.', flags: MessageFlags.Ephemeral });

    const member  = interaction.member;
    const isStaff = member.roles.cache.has(cfg.roles.staff) ||
                    member.roles.cache.has(cfg.roles.highRank) ||
                    member.roles.cache.has(cfg.roles.foundership);
    if (!isStaff && interaction.user.id !== ticket.openerId) {
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

        await transcriptCh.send({ embeds: [infoEmbed], files, components });
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

module.exports = { handleButton, handleCloseModal };
