/**
 * /setup — configure bot images (banner, thumbnail/logo, footer logo, top/bottom banner).
 * Restricted to HR (highRank) and above.
 */
const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags,
} = require('discord.js');

const cfg               = require('../config.json');
const { loadImages, saveImages } = require('../utils/images');

const TYPE_LABELS = {
    banner:       'Banner',
    thumbnail:    'Thumbnail / Logo',
    footer:       'Footer Logo',
    topBanner:    'Top Banner',
    bottomBanner: 'Bottom Banner',
};

// Map choice value → images.json key
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
        .setDescription('Configure bot images used in the panel and ticket embeds.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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
        ),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // HR+ only
        const member = interaction.member;
        const isHR = member.roles.cache.has(cfg.roles.highRank) ||
                     member.roles.cache.has(cfg.roles.foundership);
        if (!isHR) {
            return interaction.editReply({ content: 'This command requires the High Rank role or above.' });
        }

        const type       = interaction.options.getString('type');
        const attachment = interaction.options.getAttachment('image');

        if (!attachment.contentType?.startsWith('image/')) {
            return interaction.editReply({
                content: '❌ Please upload a valid image file (PNG, JPG, GIF, WEBP).',
            });
        }

        const storageKey  = STORAGE_KEY[type];
        const label       = TYPE_LABELS[type];

        const images         = loadImages();
        const previousUrl    = images[storageKey] ?? null;
        images[storageKey]   = attachment.url;
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

        await interaction.editReply({ embeds: [embed] });
    },
};
