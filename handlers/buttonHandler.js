const {
    EmbedBuilder,
    AttachmentBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');

const cfg = require('../config.json');
const { getTicket, saveTicket, deleteTicket } = require('../utils/db');
const { generateTranscript } = require('../utils/transcript');
const { buildEmbed } = require('./panelHandler');

async function handleButton(interaction) {
    const { customId, channel, user, member, guild } = interaction;

    // ── Claim ─────────────────────────────────────────────────────────────────
    if (customId === 'claim_ticket') {
        const ticket = getTicket(channel.id);
        if (!ticket) return interaction.reply({ content: 'Not a ticket channel.', flags: MessageFlags.Ephemeral });

        const isStaff = member.roles.cache.has(cfg.roles.staff) ||
                        member.roles.cache.has(cfg.roles.highRank) ||
                        member.roles.cache.has(cfg.roles.foundership);
        if (!isStaff) return interaction.reply({ content: 'Only staff can claim tickets.', flags: MessageFlags.Ephemeral });

        if (ticket.claimedBy) {
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor(cfg.colors.warning)
                    .setDescription(`This ticket is already claimed by <@${ticket.claimedBy}>.`)
                ],
                flags: MessageFlags.Ephemeral,
            });
        }

        await channel.permissionOverwrites.edit(user.id, {
            ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
            AttachFiles: true, EmbedLinks: true, ManageMessages: true,
        });

        ticket.claimedBy    = user.id;
        ticket.claimedByTag = user.username;
        saveTicket(channel.id, ticket);

        // Update the pinned embed to show claimer
        if (ticket.openingMessageId) {
            const pinned = await channel.messages.fetch(ticket.openingMessageId).catch(() => null);
            if (pinned) {
                const updated = buildEmbed({
                    opener:       { id: ticket.openerId, username: ticket.openerTag },
                    roblox:       ticket.roblox,
                    reason:       ticket.reason,
                    type:         ticket.type,
                    padNum:       String(ticket.ticketNumber).padStart(4, '0'),
                    reportedInfo: ticket.reportedUserId ? { userId: ticket.reportedUserId, tag: ticket.reportedUserTag } : null,
                    claimed:      user.id,
                });
                await pinned.edit({ embeds: [updated] }).catch(() => {});
            }
        }

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.success)
                .setDescription(`<@${user.id}> has claimed this ticket.`)
                .setFooter({ text: 'Florida State Roleplay' })
            ],
        });
    }

    // ── Unclaim ───────────────────────────────────────────────────────────────
    else if (customId === 'unclaim_ticket') {
        const ticket = getTicket(channel.id);
        if (!ticket) return interaction.reply({ content: 'Not a ticket channel.', flags: MessageFlags.Ephemeral });
        if (!ticket.claimedBy) return interaction.reply({ content: 'This ticket is not claimed.', flags: MessageFlags.Ephemeral });

        const isHR = member.roles.cache.has(cfg.roles.highRank) || member.roles.cache.has(cfg.roles.foundership);
        if (ticket.claimedBy !== user.id && !isHR) {
            return interaction.reply({ content: 'Only the claimer or High Rank+ can unclaim this ticket.', flags: MessageFlags.Ephemeral });
        }

        await channel.permissionOverwrites.delete(ticket.claimedBy).catch(() => {});

        const previousClaimer = ticket.claimedBy;
        ticket.claimedBy    = null;
        ticket.claimedByTag = null;
        saveTicket(channel.id, ticket);

        // Update pinned embed
        if (ticket.openingMessageId) {
            const pinned = await channel.messages.fetch(ticket.openingMessageId).catch(() => null);
            if (pinned) {
                const updated = buildEmbed({
                    opener:       { id: ticket.openerId, username: ticket.openerTag },
                    roblox:       ticket.roblox,
                    reason:       ticket.reason,
                    type:         ticket.type,
                    padNum:       String(ticket.ticketNumber).padStart(4, '0'),
                    reportedInfo: ticket.reportedUserId ? { userId: ticket.reportedUserId, tag: ticket.reportedUserTag } : null,
                    claimed:      null,
                });
                await pinned.edit({ embeds: [updated] }).catch(() => {});
            }
        }

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.neutral)
                .setDescription(`<@${previousClaimer}> has been unclaimed from this ticket.`)
                .setFooter({ text: 'Florida State Roleplay' })
            ],
        });
    }

    // ── Close button (shows confirm) ──────────────────────────────────────────
    else if (customId === 'close_ticket') {
        const ticket = getTicket(channel.id);
        if (!ticket) return interaction.reply({ content: 'Not a ticket channel.', flags: MessageFlags.Ephemeral });

        const isStaff = member.roles.cache.has(cfg.roles.staff) ||
                        member.roles.cache.has(cfg.roles.highRank) ||
                        member.roles.cache.has(cfg.roles.foundership);
        if (!isStaff && user.id !== ticket.openerId) {
            return interaction.reply({ content: 'You do not have permission to close this ticket.', flags: MessageFlags.Ephemeral });
        }

        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirm_close_ticket').setLabel('Confirm Close').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('cancel_close_ticket').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        );

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.warning)
                .setTitle('Close Ticket?')
                .setDescription('This will generate a transcript and permanently delete the channel.\n\nAre you sure?')
                .setFooter({ text: `Requested by ${user.username}` })
            ],
            components: [row],
            flags: MessageFlags.Ephemeral,
        });
    }

    // ── Confirm close ─────────────────────────────────────────────────────────
    else if (customId === 'confirm_close_ticket') {
        await interaction.deferUpdate();
        await _closeTicket(channel, guild, user);
    }

    // ── Cancel close ──────────────────────────────────────────────────────────
    else if (customId === 'cancel_close_ticket') {
        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.success)
                .setDescription('Ticket closure cancelled.')
            ],
            components: [],
        });
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

        await _closeTicket(channel, guild, user);
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
// Shared close logic
// ─────────────────────────────────────────────────────────────────────────────
async function _closeTicket(channel, guild, closedBy) {
    const ticket = getTicket(channel.id);
    if (!ticket) return;

    await channel.send({
        embeds: [new EmbedBuilder()
            .setColor(cfg.colors.neutral)
            .setDescription(`Ticket closed by <@${closedBy.id}>. Saving transcript…`)
            .setFooter({ text: 'Florida State Roleplay' })
        ],
    });

    // Generate transcript
    let transcriptPath = null;
    try { transcriptPath = await generateTranscript(channel, ticket); } catch (e) { console.error('[transcript]', e); }

    // Post to transcripts channel
    const transcriptCh = await guild.channels.fetch(cfg.channels.transcripts).catch(() => null);
    if (transcriptCh) {
        const levelLabel = ['Staff', 'High Rank', 'Foundership'][ticket.escalationLevel];
        const infoEmbed  = new EmbedBuilder()
            .setColor(cfg.colors.neutral)
            .setTitle(`Ticket Closed — #${String(ticket.ticketNumber).padStart(4, '0')}`)
            .addFields(
                { name: 'Type',       value: ticket.type === 'staffreport' ? 'Staff Report' : 'General Support', inline: true },
                { name: 'Opened By',  value: `<@${ticket.openerId}>`,                                            inline: true },
                { name: 'Claimed By', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Unclaimed',          inline: true },
                { name: 'Closed By',  value: `<@${closedBy.id}>`,                                                inline: true },
                { name: 'Escalation', value: levelLabel,                                                          inline: true },
                { name: 'Channel',    value: `\`#${channel.name}\``,                                             inline: true },
            )
            .setFooter({ text: 'Florida State Roleplay' })
            .setTimestamp();

        const files = transcriptPath ? [new AttachmentBuilder(transcriptPath, { name: `transcript-${channel.name}.html` })] : [];
        await transcriptCh.send({ embeds: [infoEmbed], files });
    }

    deleteTicket(channel.id);
    setTimeout(() => channel.delete('Ticket closed').catch(() => {}), 3000);
}

module.exports = { handleButton };
