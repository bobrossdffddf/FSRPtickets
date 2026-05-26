const { PermissionFlagsBits, OverwriteType } = require('discord.js');
const cfg = require('../config.json');

const STAFF_PERMS  = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
const OPENER_PERMS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];

/**
 * Builds the full permission overwrite list for a ticket channel.
 * @param {import('discord.js').Guild} guild
 * @param {string} openerId
 * @param {string|null} [claimedBy]
 */
function buildTicketOverwrites(guild, openerId, claimedBy = null) {
    const minStaffRole = guild.roles.cache.get(cfg.roles.minStaff);
    const staffOverwrites = minStaffRole
        ? guild.roles.cache
            .filter(r => r.id !== guild.id && !r.managed && r.position >= minStaffRole.position)
            .map(r => ({ id: r.id, type: OverwriteType.Role,   allow: STAFF_PERMS }))
        : [
            { id: cfg.roles.staff,       type: OverwriteType.Role, allow: STAFF_PERMS },
            { id: cfg.roles.highRank,    type: OverwriteType.Role, allow: STAFF_PERMS },
            { id: cfg.roles.foundership, type: OverwriteType.Role, allow: STAFF_PERMS },
        ];

    const overwrites = [
        { id: guild.id,  type: OverwriteType.Role,   deny:  [PermissionFlagsBits.ViewChannel] },
        { id: openerId,  type: OverwriteType.Member, allow: OPENER_PERMS },
        ...staffOverwrites,
    ];

    if (claimedBy) overwrites.push({ id: claimedBy, type: OverwriteType.Member, allow: STAFF_PERMS });

    return overwrites;
}

/**
 * Returns true if the member has any role at or above the minStaff role position.
 * Falls back to explicit staff/highRank/foundership checks if minStaff isn't in cache.
 */
function isStaff(member, guild) {
    const minRole = guild.roles.cache.get(cfg.roles.minStaff);
    if (!minRole) return (
        member.roles.cache.has(cfg.roles.staff) ||
        member.roles.cache.has(cfg.roles.highRank) ||
        member.roles.cache.has(cfg.roles.foundership)
    );
    return member.roles.cache.some(r => r.position >= minRole.position);
}

/**
 * Returns true if the member has any role at or above the highRank role position.
 */
function isHighRank(member, guild) {
    const hrRole = guild.roles.cache.get(cfg.roles.highRank);
    if (!hrRole) return (
        member.roles.cache.has(cfg.roles.highRank) ||
        member.roles.cache.has(cfg.roles.foundership)
    );
    return member.roles.cache.some(r => r.position >= hrRole.position);
}

module.exports = { buildTicketOverwrites, isStaff, isHighRank };
