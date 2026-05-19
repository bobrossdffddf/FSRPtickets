/**
 * Generates an HTML transcript from a ticket channel's message history,
 * saves it as a local file, and returns { filepath, url, filename }.
 */
const fs   = require('fs');
const path = require('path');

const TRANSCRIPT_DIR = path.join(__dirname, '../data/transcripts');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Fetch ALL messages from a channel (newest-first Discord → reversed to oldest-first) */
async function fetchAllMessages(channel) {
    const messages = [];
    let lastId = null;

    while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;

        const batch = await channel.messages.fetch(options);
        if (batch.size === 0) break;

        messages.push(...batch.values());
        lastId = batch.last().id;
        if (batch.size < 100) break;
    }

    return messages.reverse(); // oldest first
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/\n/g, '<br>');
}

function formatTime(date) {
    return date.toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Embed renderer
// ─────────────────────────────────────────────────────────────────────────────
function renderEmbed(embed) {
    const color = embed.color ? `#${embed.color.toString(16).padStart(6, '0')}` : '#1565C0';
    let html = `<div class="embed" style="border-left:4px solid ${color}">`;
    if (embed.thumbnail?.url) {
        html += `<img class="embed-thumbnail" src="${embed.thumbnail.url}" alt="thumbnail" />`;
    }
    if (embed.title) html += `<div class="embed-title">${escapeHtml(embed.title)}</div>`;
    if (embed.description) html += `<div class="embed-desc">${escapeHtml(embed.description)}</div>`;
    if (embed.fields?.length) {
        html += '<div class="embed-fields">';
        for (const f of embed.fields) {
            html += `<div class="embed-field${f.inline ? ' inline' : ''}">
                <div class="field-name">${escapeHtml(f.name)}</div>
                <div class="field-value">${escapeHtml(f.value)}</div>
            </div>`;
        }
        html += '</div>';
    }
    if (embed.image?.url) {
        html += `<div class="attachment"><img src="${embed.image.url}" alt="embed image" /></div>`;
    }
    if (embed.footer?.text) html += `<div class="embed-footer">${escapeHtml(embed.footer.text)}</div>`;
    html += '</div>';
    return html;
}

// ─────────────────────────────────────────────────────────────────────────────
// Message renderer  (fixed HTML structure — no-avatar groups now close properly)
// ─────────────────────────────────────────────────────────────────────────────
function renderMessages(messages) {
    let html = '';
    let lastAuthorId = null;
    let lastTime     = null;

    for (const msg of messages) {
        // Skip system messages and completely empty messages
        if (msg.system || (!msg.content && !msg.embeds.length && !msg.attachments.size)) continue;

        const author   = msg.author;
        const time     = msg.createdAt;
        const newGroup = author.id !== lastAuthorId ||
            (lastTime && (time - lastTime) > 5 * 60 * 1000);

        lastAuthorId = author.id;
        lastTime     = time;

        if (newGroup) {
            // Prefer the animated avatar; fall back to default discriminator bucket
            const avatarHash = author.avatar;
            const avatarUrl  = avatarHash
                ? `https://cdn.discordapp.com/avatars/${author.id}/${avatarHash}.png?size=40`
                : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(author.id) % 5n)}.png`;

            html += `<div class="message-group">`;
            html += `<img class="avatar" src="${avatarUrl}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" alt="avatar" />`;
            html += `<div class="message-content">`;
            html += `<div class="message-header">`;
            html += `<span class="username" style="color:${author.bot ? '#5865F2' : '#ffffff'}">${escapeHtml(author.username)}</span>`;
            if (author.bot) html += `<span class="bot-tag">APP</span>`;
            html += `<span class="timestamp">${formatTime(time)}</span>`;
            html += `</div>`; // /.message-header
        } else {
            html += `<div class="message-group no-avatar">`;
        }

        // ── Message body (content, embeds, attachments) ───────────────────────
        if (msg.content) {
            html += `<div class="message-text">${escapeHtml(msg.content)}</div>`;
        }
        for (const embed of msg.embeds) {
            html += renderEmbed(embed);
        }
        for (const [, att] of msg.attachments) {
            if (att.contentType?.startsWith('image')) {
                html += `<div class="attachment"><img src="${att.url}" alt="${escapeHtml(att.name)}" /></div>`;
            } else {
                html += `<div class="attachment"><a href="${att.url}" target="_blank">${escapeHtml(att.name)}</a></div>`;
            }
        }

        if (newGroup) {
            html += `</div>`; // /.message-content
        }
        html += `</div>`; // /.message-group  or  /.message-group.no-avatar
    }

    return html || '<p style="color:#8e9297;text-align:center;margin-top:32px">No messages to display.</p>';
}

// ─────────────────────────────────────────────────────────────────────────────
// Full HTML document builder
// ─────────────────────────────────────────────────────────────────────────────
function buildHtml(channel, ticketData, messages, closeReason) {
    const typeLabel   = ticketData.type === 'staffreport' ? 'Staff Report' : 'General Support';
    const levelLabels = ['Staff', 'High Rank', 'Foundership'];
    const levelLabel  = levelLabels[ticketData.escalationLevel] ?? 'Staff';
    const openDate    = new Date(ticketData.openedAt);
    const reportedRow = ticketData.reportedUserTag
        ? `<div class="meta-item"><span class="meta-label">Reported</span><span class="meta-value">${escapeHtml(ticketData.reportedUserTag)}</span></div>`
        : '';
    const robloxRow = ticketData.roblox
        ? `<div class="meta-item"><span class="meta-label">Roblox</span><span class="meta-value">${escapeHtml(ticketData.roblox.username)} (${ticketData.roblox.id})</span></div>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>FSRP Transcript — ${escapeHtml(channel.name)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #1e1f22; color: #dcddde; font-family: 'gg sans', 'Noto Sans', 'Segoe UI', sans-serif; font-size: 15px; line-height: 1.5; }

  /* ── Header ─────────────────────────────────────────────────────────────── */
  .header { background: #111214; padding: 24px 32px; border-bottom: 2px solid #1565C0; display: flex; align-items: center; gap: 20px; }
  .header-logo { font-size: 28px; font-weight: 800; color: #1565C0; letter-spacing: 1px; }
  .header-info h1 { font-size: 20px; font-weight: 700; color: #fff; }
  .header-info p  { font-size: 13px; color: #8e9297; margin-top: 2px; }
  .badge { display: inline-block; background: #1565C0; color: #fff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 99px; margin-left: 8px; vertical-align: middle; }

  /* ── Meta grid ──────────────────────────────────────────────────────────── */
  .meta { background: #2b2d31; padding: 16px 32px; display: flex; flex-wrap: wrap; gap: 24px; border-bottom: 1px solid #1e1f22; }
  .meta-item { display: flex; flex-direction: column; gap: 2px; }
  .meta-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #8e9297; letter-spacing: .5px; }
  .meta-value { font-size: 14px; color: #dcddde; }

  /* ── Messages ───────────────────────────────────────────────────────────── */
  .messages { padding: 16px 32px; }

  .message-group { display: flex; gap: 14px; padding: 4px 0 2px; margin-top: 16px; }
  .message-group.no-avatar { margin-top: 2px; padding-left: 54px; display: block; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; background: #36393f; object-fit: cover; }
  .message-content { flex: 1; min-width: 0; }
  .message-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; }
  .username { font-weight: 600; font-size: 15px; }
  .bot-tag { background: #5865F2; color: #fff; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px; vertical-align: middle; }
  .timestamp { font-size: 11px; color: #8e9297; }
  .message-text { color: #dcddde; white-space: pre-wrap; word-break: break-word; }

  /* ── Embeds ─────────────────────────────────────────────────────────────── */
  .embed { background: #2b2d31; border-radius: 4px; padding: 12px 16px; margin-top: 6px; max-width: 520px; position: relative; overflow: hidden; }
  .embed-thumbnail { float: right; max-width: 80px; max-height: 80px; border-radius: 4px; margin-left: 12px; }
  .embed-title  { font-weight: 700; font-size: 15px; color: #fff; margin-bottom: 6px; }
  .embed-desc   { font-size: 14px; color: #dcddde; white-space: pre-wrap; }
  .embed-fields { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; clear: both; }
  .embed-field  { flex: 1 1 100%; min-width: 0; }
  .embed-field.inline { flex: 1 1 45%; }
  .field-name   { font-size: 12px; font-weight: 700; color: #fff; margin-bottom: 2px; }
  .field-value  { font-size: 13px; color: #dcddde; white-space: pre-wrap; word-break: break-word; }
  .embed-footer { font-size: 11px; color: #8e9297; margin-top: 10px; border-top: 1px solid #3f4147; padding-top: 6px; clear: both; }

  /* ── Attachments ────────────────────────────────────────────────────────── */
  .attachment { margin-top: 6px; }
  .attachment img { max-width: 400px; max-height: 300px; border-radius: 4px; display: block; }
  .attachment a   { color: #00b0f4; text-decoration: none; }
  .attachment a:hover { text-decoration: underline; }

  /* ── Footer ─────────────────────────────────────────────────────────────── */
  .footer { text-align: center; padding: 24px; color: #8e9297; font-size: 12px; border-top: 1px solid #2b2d31; margin-top: 32px; }
</style>
</head>
<body>

<div class="header">
  <div class="header-logo">FSRP</div>
  <div class="header-info">
    <h1>#${escapeHtml(channel.name)} <span class="badge">${typeLabel}</span></h1>
    <p>Florida State Roleplay — Ticket Transcript</p>
  </div>
</div>

<div class="meta">
  <div class="meta-item"><span class="meta-label">Ticket #</span><span class="meta-value">${String(ticketData.ticketNumber).padStart(4, '0')}</span></div>
  <div class="meta-item"><span class="meta-label">Type</span><span class="meta-value">${typeLabel}</span></div>
  <div class="meta-item"><span class="meta-label">Opened By</span><span class="meta-value">${escapeHtml(ticketData.openerTag)}</span></div>
  <div class="meta-item"><span class="meta-label">Claimed By</span><span class="meta-value">${ticketData.claimedByTag ? escapeHtml(ticketData.claimedByTag) : 'Unclaimed'}</span></div>
  <div class="meta-item"><span class="meta-label">Escalation</span><span class="meta-value">${levelLabel}</span></div>
  <div class="meta-item"><span class="meta-label">Opened</span><span class="meta-value">${formatTime(openDate)}</span></div>
  <div class="meta-item"><span class="meta-label">Closed</span><span class="meta-value">${formatTime(new Date())}</span></div>
  <div class="meta-item"><span class="meta-label">Close Reason</span><span class="meta-value">${escapeHtml(closeReason ?? 'N/A')}</span></div>
  <div class="meta-item"><span class="meta-label">Messages</span><span class="meta-value">${messages.length}</span></div>
  ${robloxRow}
  ${reportedRow}
</div>

<div class="messages">
  ${renderMessages(messages)}
</div>

<div class="footer">
  Florida State Roleplay &nbsp;|&nbsp; Ticket Transcript &nbsp;|&nbsp; Generated ${formatTime(new Date())}
</div>

</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a transcript file and return { filepath, url, filename }.
 * @param {import('discord.js').TextChannel} channel
 * @param {object} ticketData
 * @param {string} [closeReason]
 * @returns {Promise<{ filepath: string, url: string, filename: string }>}
 */
async function generateTranscript(channel, ticketData, closeReason = 'No reason provided') {
    if (!fs.existsSync(TRANSCRIPT_DIR)) {
        fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
    }

    const messages = await fetchAllMessages(channel);
    const html     = buildHtml(channel, ticketData, messages, closeReason);
    const filename = `transcript-${channel.name}-${Date.now()}.html`;
    const filepath = path.join(TRANSCRIPT_DIR, filename);

    fs.writeFileSync(filepath, html, 'utf8');

    // Lazy-require to avoid circular dep at module load time
    const { getTranscriptUrl } = require('./transcriptServer');
    const url = getTranscriptUrl(filename);

    return { filepath, url, filename };
}

module.exports = { generateTranscript };
