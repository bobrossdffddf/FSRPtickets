/**
 * Generates an HTML transcript from a ticket channel's message history
 * and saves it as a file attachment.
 */
const fs   = require('fs');
const path = require('path');

const TRANSCRIPT_DIR = path.join(__dirname, '../data/transcripts');

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
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\n/g, '<br>');
}

function formatTime(date) {
    return date.toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
    });
}

function renderEmbed(embed) {
    const color = embed.color ? `#${embed.color.toString(16).padStart(6, '0')}` : '#1565C0';
    let html = `<div class="embed" style="border-left:4px solid ${color}">`;
    if (embed.title) html += `<div class="embed-title">${escapeHtml(embed.title)}</div>`;
    if (embed.description) html += `<div class="embed-desc">${escapeHtml(embed.description)}</div>`;
    if (embed.fields?.length) {
        html += '<div class="embed-fields">';
        for (const f of embed.fields) {
            html += `<div class="embed-field ${f.inline ? 'inline' : ''}">
                <div class="field-name">${escapeHtml(f.name)}</div>
                <div class="field-value">${escapeHtml(f.value)}</div>
            </div>`;
        }
        html += '</div>';
    }
    if (embed.footer) html += `<div class="embed-footer">${escapeHtml(embed.footer.text)}</div>`;
    html += '</div>';
    return html;
}

function renderMessages(messages) {
    let html = '';
    let lastAuthorId = null;
    let lastTime = null;

    for (const msg of messages) {
        if (msg.system || (!msg.content && !msg.embeds.length && !msg.attachments.size)) continue;

        const author = msg.author;
        const time   = msg.createdAt;
        const newGroup = author.id !== lastAuthorId ||
            (lastTime && (time - lastTime) > 5 * 60 * 1000);

        lastAuthorId = author.id;
        lastTime     = time;

        if (newGroup) {
            html += `
            <div class="message-group">
                <img class="avatar" src="https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=40"
                     onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
                <div class="message-content">
                    <div class="message-header">
                        <span class="username" style="color:${author.bot ? '#5865F2' : '#ffffff'}">${escapeHtml(author.username)}</span>
                        ${author.bot ? '<span class="bot-tag">APP</span>' : ''}
                        <span class="timestamp">${formatTime(time)}</span>
                    </div>`;
        } else {
            html += `<div class="message-group no-avatar">
                <div class="message-content">
                    <div>`;
        }

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
                html += `<div class="attachment"><a href="${att.url}">${escapeHtml(att.name)}</a></div>`;
            }
        }

        if (newGroup) {
            html += `</div></div>`;
        } else {
            html += `</div></div>`;
        }
    }
    return html;
}

/**
 * Build the full HTML document.
 * @param {import('discord.js').TextChannel} channel
 * @param {import('../utils/db').TicketData} ticketData
 * @param {import('discord.js').Message[]} messages
 */
function buildHtml(channel, ticketData, messages) {
    const typeLabel  = ticketData.type === 'staffreport' ? 'Staff Report' : 'General Support';
    const levelLabel = ['Staff', 'High Rank', 'Foundership'][ticketData.escalationLevel];
    const openDate   = new Date(ticketData.openedAt);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>FSRP Transcript — ${escapeHtml(channel.name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #1e1f22; color: #dcddde; font-family: 'gg sans', 'Noto Sans', sans-serif; font-size: 15px; line-height: 1.5; }

  /* Header */
  .header { background: #111214; padding: 24px 32px; border-bottom: 2px solid #1565C0; display: flex; align-items: center; gap: 20px; }
  .header-logo { font-size: 28px; font-weight: 800; color: #1565C0; letter-spacing: 1px; }
  .header-info h1 { font-size: 20px; font-weight: 700; color: #fff; }
  .header-info p  { font-size: 13px; color: #8e9297; margin-top: 2px; }
  .badge { display: inline-block; background: #1565C0; color: #fff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 99px; margin-left: 8px; vertical-align: middle; }

  /* Meta grid */
  .meta { background: #2b2d31; padding: 16px 32px; display: flex; flex-wrap: wrap; gap: 24px; border-bottom: 1px solid #1e1f22; }
  .meta-item { display: flex; flex-direction: column; gap: 2px; }
  .meta-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #8e9297; letter-spacing: .5px; }
  .meta-value { font-size: 14px; color: #dcddde; }

  /* Messages */
  .messages { padding: 16px 32px; }
  .date-divider { text-align: center; color: #8e9297; font-size: 12px; font-weight: 600; margin: 16px 0; position: relative; }
  .date-divider::before, .date-divider::after { content: ''; display: inline-block; width: 40%; height: 1px; background: #3f4147; vertical-align: middle; margin: 0 8px; }

  .message-group { display: flex; gap: 14px; padding: 4px 0 2px; margin-top: 16px; }
  .message-group.no-avatar { margin-top: 2px; padding-left: 54px; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; background: #36393f; }
  .message-content { flex: 1; min-width: 0; }
  .message-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; }
  .username { font-weight: 600; font-size: 15px; }
  .bot-tag { background: #5865F2; color: #fff; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px; }
  .timestamp { font-size: 11px; color: #8e9297; }
  .message-text { color: #dcddde; white-space: pre-wrap; word-break: break-word; }

  /* Embeds */
  .embed { background: #2b2d31; border-radius: 4px; padding: 12px 16px; margin-top: 6px; max-width: 520px; }
  .embed-title { font-weight: 700; font-size: 15px; color: #fff; margin-bottom: 6px; }
  .embed-desc  { font-size: 14px; color: #dcddde; white-space: pre-wrap; }
  .embed-fields { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .embed-field  { flex: 1 1 100%; }
  .embed-field.inline { flex: 1 1 45%; }
  .field-name  { font-size: 12px; font-weight: 700; color: #fff; margin-bottom: 2px; }
  .field-value { font-size: 13px; color: #dcddde; white-space: pre-wrap; }
  .embed-footer{ font-size: 11px; color: #8e9297; margin-top: 10px; border-top: 1px solid #3f4147; padding-top: 6px; }

  /* Attachments */
  .attachment img { max-width: 400px; border-radius: 4px; margin-top: 6px; }
  .attachment a   { color: #00b0f4; }

  /* Footer */
  .footer { text-align: center; padding: 24px; color: #8e9297; font-size: 12px; border-top: 1px solid #2b2d31; }
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
  <div class="meta-item"><span class="meta-label">Messages</span><span class="meta-value">${messages.length}</span></div>
  ${ticketData.roblox ? `
  <div class="meta-item"><span class="meta-label">Roblox</span><span class="meta-value">${escapeHtml(ticketData.roblox.username)} (${ticketData.roblox.id})</span></div>
  ` : ''}
</div>

<div class="messages">
  ${renderMessages(messages)}
</div>

<div class="footer">
  Florida State Roleplay | Ticket Transcript | Generated ${formatTime(new Date())}
</div>
</body>
</html>`;
}

/**
 * Generate a transcript file and return the file path.
 * @param {import('discord.js').TextChannel} channel
 * @param {import('../utils/db').TicketData} ticketData
 * @returns {Promise<string>} path to the generated HTML file
 */
async function generateTranscript(channel, ticketData) {
    if (!fs.existsSync(TRANSCRIPT_DIR)) {
        fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
    }

    const messages = await fetchAllMessages(channel);
    const html     = buildHtml(channel, ticketData, messages);
    const filename = `transcript-${channel.name}-${Date.now()}.html`;
    const filepath = path.join(TRANSCRIPT_DIR, filename);

    fs.writeFileSync(filepath, html, 'utf8');
    return filepath;
}

module.exports = { generateTranscript };
