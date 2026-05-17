/**
 * Button interaction handler.
 *
 * Handles:
 *   claim_ticket          — staff claims ticket
 *   unclaim_ticket        — claimer unclaims
 *   close_ticket          — trigger /close flow
 *   confirm_close_ticket  — confirmed close: generate transcript + delete channel
 *   cancel_close_ticket   — cancel close confirmation
 *   closereq_accept       — opener accepts close request
 *   closereq_deny         — opener denies close request
 */
const {
    EmbedBuilder,
    AttachmentBuilder,
    PermissionFlagsBits,
} = require('discord.js');
const cfg                    = require('../config.json');
const { getTicket, saveTicket, deleteTicket } = require('../utils/db');
const { generateTranscript } = require('../utils/transcript');

const E = {
    fsrp:    '<:FSRP:1500172509826383922>',
    ticket:  '<:ticket:1491123553985232946>',
    shield:  '<:shield:1491123625762492558>',
    user:    '<:User:1491123529918447910>',
    staff:   '<:staff:1492185925415997612>',
    alert:   '<:Alert:1488257805071810630>',
    cross:   '<:_cross_:1488257725983883437>',
    check:   '<:check_yes_wb:1492185650449874994>',
    info:    '<:information:1492185664211386561>',
    tools:   '<:tools:1491123770214191275>',
    bell:    '<:bell:1492185923964637364>',
    locked:  '<:locked:1492185928607862944>',
    megaphone: '<:megaphone:1492185636248092802>',
    pin:     '<:pin:1491123495810367651>',
};

async function handleButton(interaction) {
    const { customId, channel, user, member, guild } = interaction;

    // ── Claim ─────────────────────────────────────────────────────────────────
    if (customId === 'claim_ticket') {
        const ticket = getTicket(channel.id);
        if (!ticket) return interaction.reply({ content: `${E.alert} Not a ticket channel.`, ephemeral: true });

        // Only staff can claim
        const isStaff = member.roles.cache.has(cfg.roles.staff) ||
                        member.roles.cache.has(cfg.roles.highRank) ||
                        member.roles.cache.has(cfg.roles.foundership);
        if (!isStaff) {
            return interaction.reply({ content: `${E.alert} Only staff members can claim tickets.`, ephemeral: true });
        }

        if (ticket.claimedBy) {
            return interaction.reply({
                embeds: [new EmbedBuilder()
                    .setColor(cfg.colors.warning)
                    .setDescription(`${E.alert} This ticket is already claimed by <@${ticket.claimedBy}>.`)
                ],
                ephemeral: true,
            });
        }

        // Give claimer individual overwrite (so it persists through escalation)
        await channel.permissionOverwrites.edit(user.id, {
            ViewChannel:        true,
            SendMessages:       true,
            ReadMessageHistory: true,
            AttachFiles:        true,
            EmbedLinks:         true,
            ManageMessages:     true,
        });

        ticket.claimedBy    = user.id;
        ticket.claimedByTag = user.tag ?? user.username;
        saveTicket(channel.id, ticket);

        const embed = new EmbedBuilder()
            .setColor(cfg.colors.success)
            .setTitle(`${E.check}  Ticket Claimed`)
            .setDescription(
                `${E.staff} <@${user.id}> has claimed this ticket.\n\n` +
                `${E.info} You are now the assigned staff member.\n` +
                `${E.bell} Please respond to the ticket opener as soon as possible.`
            )
            .addFields({ name: 'Claimed By', value: `<@${user.id}>`, inline: true })
            .setFooter({ text: 'Florida State Roleplay  •  Ticket System' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }

    // ── Unclaim ───────────────────────────────────────────────────────────────
    else if (customId === 'unclaim_ticket') {
        const ticket = getTicket(channel.id);
        if (!ticket) return interaction.reply({ content: `${E.alert} Not a ticket channel.`, ephemeral: true });

        if (!ticket.claimedBy) {
            return interaction.reply({ content: `${E.cross} This ticket is not currently claimed.`, ephemeral: true });
        }

        // Only the claimer or HR+ can unclaim
        const isHR = member.roles.cache.has(cfg.roles.highRank) ||
                     member.roles.cache.has(cfg.roles.foundership);
        if (ticket.claimedBy !== user.id && !isHR) {
            return interaction.reply({
                content: `${E.alert} Only the person who claimed this ticket (or High Rank+) can unclaim it.`,
                ephemeral: true,
            });
        }

        // Remove individual overwrite
        await channel.permissionOverwrites.delete(ticket.claimedBy).catch(() => {});

        const previousClaimer = ticket.claimedBy;
        ticket.claimedBy    = null;
        ticket.claimedByTag = null;
        saveTicket(channel.id, ticket);

        const embed = new EmbedBuilder()
            .setColor(cfg.colors.neutral)
            .setTitle(`${E.tools}  Ticket Unclaimed`)
            .setDescription(
                `<@${previousClaimer}> has unclaimed this ticket.\n` +
                `${E.alert} This ticket is now available for another staff member to claim.`
            )
            .setFooter({ text: 'Florida State Roleplay  •  Ticket System' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }

    // ── Close (button shortcut — shows same confirm as /close) ────────────────
    else if (customId === 'close_ticket') {
        const ticket = getTicket(channel.id);
        if (!ticket) return interaction.reply({ content: `${E.alert} Not a ticket channel.`, ephemeral: true });

        const isStaff = member.roles.cache.has(cfg.roles.staff) ||
                        member.roles.cache.has(cfg.roles.highRank) ||
                        member.roles.cache.has(cfg.roles.foundership);
        const isOpener = user.id === ticket.openerId;
        if (!isStaff && !isOpener) {
            return interaction.reply({ content: `${E.alert} You do not have permission to close this ticket.`, ephemeral: true });
        }

        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const confirmEmbed = new EmbedBuilder()
            .setColor(cfg.colors.warning)
            .setTitle(`${E.alert}  Confirm Ticket Closure`)
            .setDescription(
                `Are you sure you want to close this ticket?\n\n` +
                `${E.check} A full HTML transcript will be saved and posted.\n` +
                `${E.cross} The ticket channel will be **permanently deleted**.\n\n` +
                `**This cannot be undone.**`
            )
            .setFooter({ text: `Requested by ${user.tag ?? user.username}` })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('confirm_close_ticket')
                .setLabel('Close Ticket')
                .setStyle(ButtonStyle.Danger)
                .setEmoji({ id: '1488257725983883437', name: '_cross_' }),
            new ButtonBuilder()
                .setCustomId('cancel_close_ticket')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary),
        );

        await interaction.reply({ embeds: [confirmEmbed], components: [row], ephemeral: true });
    }

    // ── Confirm close ─────────────────────────────────────────────────────────
    else if (customId === 'confirm_close_ticket') {
        await interaction.deferUpdate();

        const ticket = getTicket(channel.id);
        if (!ticket) return;

        // ── Notify channel ─────────────────────────────────────────────────────
        const closingEmbed = new EmbedBuilder()
            .setColor(cfg.colors.neutral)
            .setTitle(`${E.locked}  Ticket Closing`)
            .setDescription(
                `${E.megaphone} This ticket is being closed by <@${user.id}>.\n` +
                `${E.tools} Generating transcript… please wait.`
            )
            .setFooter({ text: 'Florida State Roleplay  •  Ticket System' })
            .setTimestamp();

        await channel.send({ embeds: [closingEmbed] });

        // ── Generate transcript ────────────────────────────────────────────────
        let transcriptPath = null;
        try {
            transcriptPath = await generateTranscript(channel, ticket);
        } catch (err) {
            console.error('[close] Transcript generation failed:', err);
        }

        // ── Post to transcripts channel ────────────────────────────────────────
        const transcriptChannel = await guild.channels.fetch(cfg.channels.transcripts).catch(() => null);
        if (transcriptChannel) {
            const levelLabel = ['Staff', 'High Rank', 'Foundership'][ticket.escalationLevel];
            const typeLabel  = ticket.type === 'staffreport' ? 'Staff Report' : 'General Support';
            const infoEmbed  = new EmbedBuilder()
                .setColor(cfg.colors.neutral)
                .setTitle(`${E.ticket}  Ticket Closed — #${String(ticket.ticketNumber).padStart(4, '0')}`)
                .addFields(
                    { name: 'Type',           value: typeLabel,                            inline: true },
                    { name: 'Opened By',      value: `<@${ticket.openerId}> (${ticket.openerTag})`, inline: true },
                    { name: 'Claimed By',     value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Unclaimed', inline: true },
                    { name: 'Closed By',      value: `<@${user.id}>`,                     inline: true },
                    { name: 'Escalation',     value: levelLabel,                           inline: true },
                    { name: 'Channel',        value: `\`#${channel.name}\``,               inline: true },
                )
                .setFooter({ text: 'Florida State Roleplay  •  Ticket Transcript' })
                .setTimestamp();

            if (ticket.roblox) {
                infoEmbed.addFields({
                    name:   `${E.info} Roblox`,
                    value:  `${ticket.roblox.username} (${ticket.roblox.id})`,
                    inline: false,
                });
            }

            const files = transcriptPath
                ? [new AttachmentBuilder(transcriptPath, { name: `transcript-${channel.name}.html` })]
                : [];

            await transcriptChannel.send({ embeds: [infoEmbed], files });
        }

        // ── Delete ticket from DB ──────────────────────────────────────────────
        deleteTicket(channel.id);

        // ── Delete channel after short delay ───────────────────────────────────
        setTimeout(async () => {
            await channel.delete(`Ticket closed by ${user.tag ?? user.username}`).catch(() => {});
        }, 3000);
    }

    // ── Cancel close ──────────────────────────────────────────────────────────
    else if (customId === 'cancel_close_ticket') {
        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.success)
                .setDescription(`${E.check} Ticket closure cancelled. The ticket remains open.`)
            ],
            components: [],
        });
    }

    // ── Close request — Opener accepts ────────────────────────────────────────
    else if (customId === 'closereq_accept') {
        const ticket = getTicket(channel.id);
        if (!ticket) return interaction.reply({ content: `${E.alert} Not a ticket channel.`, ephemeral: true });

        // Only the opener can accept
        if (user.id !== ticket.openerId) {
            return interaction.reply({
                content: `${E.alert} Only the ticket opener can respond to this close request.`,
                ephemeral: true,
            });
        }

        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.success)
                .setTitle(`${E.check}  Close Request Accepted`)
                .setDescription(
                    `<@${ticket.openerId}> has accepted the close request.\n` +
                    `${E.locked} The ticket will now be closed.`
                )
                .setTimestamp()
            ],
            components: [],
        });

        // Trigger close flow
        await channel.send({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.neutral)
                .setDescription(`${E.megaphone} Closing ticket — generating transcript…`)
            ],
        });

        let transcriptPath = null;
        try { transcriptPath = await generateTranscript(channel, ticket); } catch {}

        const transcriptChannel = await guild.channels.fetch(cfg.channels.transcripts).catch(() => null);
        if (transcriptChannel) {
            const infoEmbed = new EmbedBuilder()
                .setColor(cfg.colors.neutral)
                .setTitle(`${E.ticket}  Ticket Closed — #${String(ticket.ticketNumber).padStart(4, '0')}`)
                .setDescription(`Closed via close request accepted by opener.`)
                .addFields(
                    { name: 'Opened By', value: `<@${ticket.openerId}>`,                       inline: true },
                    { name: 'Claimed By', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Unclaimed', inline: true },
                )
                .setFooter({ text: 'Florida State Roleplay  •  Ticket Transcript' })
                .setTimestamp();
            const files = transcriptPath
                ? [new AttachmentBuilder(transcriptPath, { name: `transcript-${channel.name}.html` })]
                : [];
            await transcriptChannel.send({ embeds: [infoEmbed], files });
        }

        deleteTicket(channel.id);
        setTimeout(async () => { await channel.delete('Close request accepted').catch(() => {}); }, 3000);
    }

    // ── Close request — Opener denies ─────────────────────────────────────────
    else if (customId === 'closereq_deny') {
        const ticket = getTicket(channel.id);
        if (!ticket) return interaction.reply({ content: `${E.alert} Not a ticket channel.`, ephemeral: true });

        if (user.id !== ticket.openerId) {
            return interaction.reply({
                content: `${E.alert} Only the ticket opener can respond to this close request.`,
                ephemeral: true,
            });
        }

        await interaction.update({
            embeds: [new EmbedBuilder()
                .setColor(cfg.colors.foundership)
                .setTitle(`${E.cross}  Close Request Denied`)
                .setDescription(
                    `<@${ticket.openerId}> has denied the close request.\n` +
                    `${E.bell} The ticket remains open. Please continue assisting the user.`
                )
                .setTimestamp()
            ],
            components: [],
        });
    }
}

module.exports = { handleButton };
