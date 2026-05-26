/**
 * /setup — configure bot images and channel settings.
 * Restricted to HR (highRank) and above.
 *
 * Subcommands:
 *   image                  — update a bot image (banner, thumbnail, footer, etc.)
 *   partnerships-channel   — set the channel where approved partnership ads are posted
 */
const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags,
} = require('discord.js');

const https = require('https');
const http  = require('http');
const path  = require('path');
const fs    = require('fs');

const cfg                         = require('../config.json');
const { loadImages, saveImages }  = require('../utils/images');
const { getImageUrl, IMAGES_DIR } = require('../utils/transcriptServer');
const { isHighRank }              = require('../utils/permissions');
const { loadSettings, saveSettings } = require('../utils/settings');

function _downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const file  = fs.createWriteStream(dest);
        proto.get(url, res => {
            if (res.statusCode !== 200) {
                file.close(); fs.unlink(dest, () => {});
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
            file.on('error',  err => { fs.unlink(dest, () => {}); reject(err); });
        }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
    });
}

const TYPE_LABELS = {
    banner:       'Banner',
    thumbnail:    'Thumbnail / Logo',
    footer:       'Footer Logo',
    topBanner:    'Top Banner',
    bottomBanner: 'Bottom Banner',
};

const STORAGE_KEY = {
    banner:       'banner',
    thumbnail:    'thumbnail',
    footer:       'footerIcon',
    topBanner:    'topBanner',
    bottomBanner: 'bottomBanner',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Configure bot images and channel settings.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub
            .setName('image')
            .setDescription('Update a bot image used in panels and ticket embeds.')
            .addStringOption(opt =>
                opt.setName('type')
                    .setDescription('Which image to update')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Banner',           value: 'banner'       },
                        { name: 'Thumbnail / Logo', value: 'thumbnail'    },
                        { name: 'Footer Logo',      value: 'footer'       },
                        { name: 'Top Banner',       value: 'topBanner'    },
                        { name: 'Bottom Banner',    value: 'bottomBanner' },
                    )
            )
            .addAttachmentOption(opt =>
                opt.setName('image')
                    .setDescription('Upload the image file (PNG, JPG, GIF, WEBP)')
                    .setRequired(true)
            )
        )
        .addSubcommand(sub => sub
            .setName('partnerships-channel')
            .setDescription('Set the channel where approved partnership advertisements are posted.')
            .addChannelOption(opt =>
                opt.setName('channel')
                    .setDescription('The partnerships channel')
                    .setRequired(true)
                    .addChannelTypes(ChannelType.GuildText)
            )
        )
        .addSubcommand(sub => sub
            .setName('partnerships-category')
            .setDescription('Set the category that partnership ticket channels are moved into.')
            .addChannelOption(opt =>
                opt.setName('category')
                    .setDescription('The HR/partnerships category')
                    .setRequired(true)
                    .addChannelTypes(ChannelType.GuildCategory)
            )
        ),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const member = interaction.member;
        if (!isHighRank(member, interaction.guild)) {
            return interaction.editReply({ content: 'This command requires the High Rank role or above.' });
        }

        const sub = interaction.options.getSubcommand();

        // ── /setup image ──────────────────────────────────────────────────────
        if (sub === 'image') {
            const type       = interaction.options.getString('type');
            const attachment = interaction.options.getAttachment('image');

            if (!attachment.contentType?.startsWith('image/')) {
                return interaction.editReply({
                    content: '❌ Please upload a valid image file (PNG, JPG, GIF, WEBP).',
                });
            }

            const storageKey = STORAGE_KEY[type];
            const label      = TYPE_LABELS[type];

            if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
            const ext      = (attachment.contentType?.split('/')[1]?.split('+')[0]) || 'png';
            const filename = `${storageKey}.${ext}`;
            const filepath = path.join(IMAGES_DIR, filename);

            try {
                await _downloadFile(attachment.url, filepath);
            } catch (err) {
                return interaction.editReply({ content: `❌ Failed to download image: ${err.message}` });
            }

            const publicUrl = getImageUrl(filename);

            const images       = loadImages();
            const previousUrl  = images[storageKey] ?? null;
            images[storageKey] = publicUrl;
            saveImages(images);

            const embed = new EmbedBuilder()
                .setColor(cfg.colors.success)
                .setTitle(`${label} Updated`)
                .setDescription(
                    `The **${label}** image has been saved and will be used immediately.\n\n` +
                    (previousUrl ? `**Previous:** [link](${previousUrl})\n` : '') +
                    `**New image shown below.**`
                )
                .setImage(attachment.url)
                .setFooter({ text: 'Florida State Roleplay  •  Setup' })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }

        // ── /setup partnerships-channel ───────────────────────────────────────
        if (sub === 'partnerships-channel') {
            const channel  = interaction.options.getChannel('channel');
            const settings = loadSettings();
            settings.partnershipsChannelId = channel.id;
            saveSettings(settings);

            const embed = new EmbedBuilder()
                .setColor(cfg.colors.success)
                .setTitle('Partnerships Channel Set')
                .setDescription(`Approved partnership advertisements will now be posted in <#${channel.id}>.`)
                .setFooter({ text: 'Florida State Roleplay  •  Setup' })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }

        // ── /setup partnerships-category ─────────────────────────────────────
        if (sub === 'partnerships-category') {
            const category = interaction.options.getChannel('category');
            const settings = loadSettings();
            settings.partnershipsCategoryId = category.id;
            saveSettings(settings);

            const embed = new EmbedBuilder()
                .setColor(cfg.colors.success)
                .setTitle('Partnerships Category Set')
                .setDescription(`Partnership ticket channels will now be moved to **${category.name}** when \`/partnership\` is run.`)
                .setFooter({ text: 'Florida State Roleplay  •  Setup' })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }
    },
};
