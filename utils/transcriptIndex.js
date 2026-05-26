const fs   = require('fs');
const path = require('path');
const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require('discord.js');

const cfg        = require('../config.json');
const INDEX_FILE = path.join(__dirname, '../data/transcript-index.json');

function _read() {
    if (!fs.existsSync(INDEX_FILE)) return { indexMessageId: null, entries: [] };
    return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
}

function _write(data) {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(data, null, 2));
}

function addEntry({ ticketNumber, type, messageId }) {
    const data = _read();
    data.entries.push({ ticketNumber, type, messageId });
    _write(data);
}

// Builds the select menu from the most recent ≤25 entries (newest first).
function _buildComponents(entries, channelId) {
    const recent = [...entries].reverse().slice(0, 25);
    if (recent.length === 0) return [];

    const options = recent.map(e => {
        const label = e.type === 'staffreport'
            ? `Staff Report #${String(e.ticketNumber).padStart(4, '0')}`
            : `Gen Report #${String(e.ticketNumber).padStart(4, '0')}`;
        const url = `https://discord.com/channels/${cfg.guildId}/${channelId}/${e.messageId}`;
        return new StringSelectMenuOptionBuilder().setLabel(label).setValue(url);
    });

    return [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('transcript_index_select')
                .setPlaceholder('Jump to a transcript...')
                .addOptions(options),
        ),
    ];
}

// Deletes the old index message (if any), then posts a fresh one at the bottom.
async function refreshIndexMessage(guild) {
    const transcriptCh = await guild.channels.fetch(cfg.channels.transcripts).catch(() => null);
    if (!transcriptCh) return;

    const data = _read();

    if (data.indexMessageId) {
        await transcriptCh.messages.fetch(data.indexMessageId)
            .then(m => m.delete())
            .catch(() => {});
    }

    if (data.entries.length === 0) return;

    const components = _buildComponents(data.entries, transcriptCh.id);
    const total      = data.entries.length;
    const content    = total > 25
        ? `**Transcript Index** — showing ${25} most recent of ${total}`
        : `**Transcript Index** — ${total} transcript${total === 1 ? '' : 's'}`;

    const msg = await transcriptCh.send({ content, components });

    data.indexMessageId = msg.id;
    _write(data);
}

// Called from interactionCreate when a user picks from the dropdown.
async function handleTranscriptIndexSelect(interaction) {
    const url = interaction.values[0];
    await interaction.reply({
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Jump to Transcript')
                    .setStyle(ButtonStyle.Link)
                    .setURL(url),
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });
}

module.exports = { addEntry, refreshIndexMessage, handleTranscriptIndexSelect };
