const { PermissionFlagsBits, OverwriteType } = require('discord.js');
const cfg = require('../config.json');

const STAFF_PERMS  = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
const OPENER_PERMS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];

// Escalation level index → ticketRoles key
const LEVEL_TYPE = ['gen', 'hr', 'foundership'];

/**
 * Builds the full permission overwrite list for a ticket channel.
 * @param {import('discord.js').Guild} guild
 * @param {string} openerId
 * @param {string|null} [claimedBy]
 * @param {'gen'|'hr'|'foundership'} [ticketType]
 */
function buildTicketOverwrites(guild, openerId, claimedBy = null, ticketType = 'gen') {
    const roleIds = cfg.ticketRoles[ticketType] ?? cfg.ticketRoles.gen;
    const overwrites = [
        { id: guild.id, type: OverwriteType.Role,   deny:  [PermissionFlagsBits.ViewChannel] },
        { id: openerId, type: OverwriteType.Member, allow: OPENER_PERMS },
        ...roleIds.map(id => ({ id, type: OverwriteType.Role, allow: STAFF_PERMS })),
    ];
    if (claimedBy) overwrites.push({ id: claimedBy, type: OverwriteType.Member, allow: STAFF_PERMS });
    return overwrites;
}

function isStaff(member) {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    return cfg.ticketRoles.gen.some(id => member.roles.cache.has(id));
}

function isHighRank(member) {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    return cfg.ticketRoles.hr.some(id => member.roles.cache.has(id));
}

module.exports = { buildTicketOverwrites, isStaff, isHighRank, STAFF_PERMS, LEVEL_TYPE };
