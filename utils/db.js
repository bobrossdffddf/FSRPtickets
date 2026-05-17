/**
 * Simple JSON-file database for ticket state.
 * All reads/writes are synchronous so there are no race-condition footguns
 * for a single-process bot.
 */
const fs   = require('fs');
const path = require('path');

const DATA_DIR    = path.join(__dirname, '../data');
const TICKETS     = path.join(DATA_DIR, 'tickets.json');
const COUNTER     = path.join(DATA_DIR, 'counter.json');

function _read(file)       { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function _write(file, obj) { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }

// ── Ticket CRUD ───────────────────────────────────────────────────────────────

/** @returns {Object.<string, TicketData>} */
function getAllTickets() { return _read(TICKETS); }

/**
 * @typedef {Object} TicketData
 * @property {'general'|'staffreport'} type
 * @property {string}  openerId
 * @property {string}  openerTag
 * @property {string|null} claimedBy        — userId of claimer, or null
 * @property {string|null} claimedByTag
 * @property {0|1|2}  escalationLevel      — 0=staff 1=highrank 2=foundership
 * @property {number} ticketNumber
 * @property {string} reason
 * @property {string|null} reportedUserId   — for staffreport tickets
 * @property {string|null} reportedUserTag
 * @property {Object|null} roblox           — { id, username, displayName, created, avatarUrl }
 * @property {number} openedAt             — Unix ms
 * @property {string} openingMessageId     — id of the main embed message in the ticket
 */

/** @returns {TicketData|null} */
function getTicket(channelId) {
    const tickets = getAllTickets();
    return tickets[channelId] ?? null;
}

/** @param {string} channelId @param {TicketData} data */
function saveTicket(channelId, data) {
    const tickets = getAllTickets();
    tickets[channelId] = data;
    _write(TICKETS, tickets);
}

function deleteTicket(channelId) {
    const tickets = getAllTickets();
    delete tickets[channelId];
    _write(TICKETS, tickets);
}

/** Returns the next auto-increment ticket number */
function nextTicketNumber() {
    const counter = _read(COUNTER);
    counter.count++;
    _write(COUNTER, counter);
    return counter.count;
}

module.exports = { getAllTickets, getTicket, saveTicket, deleteTicket, nextTicketNumber };
