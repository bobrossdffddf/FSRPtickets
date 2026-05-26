const { MessageFlags } = require('discord.js');
const {
    handlePanelGeneralBtn,
    handlePanelStaffBtn,
    handleGsDeptInquiry,
    handleGsStaffApp,
    handleGsPunishmentAppeal,
    handleGsBotIssues,
    handleGsContinue,
    handleOpenStaffReportBtn,
    handleOpenFoundershipReportBtn,
    handleFoundershipReportModal,
    handlePanelSelect,
    handleTestPanelSelect,
    handleGeneralModal,
    handleGeneralTestModal,
    handleStaffReportModal,
    handleStaffReportTestModal,
} = require('../handlers/panelHandler');
const { handleButton, handleCloseModal, handlePartnershipModal } = require('../handlers/buttonHandler');
const { handleTranscriptIndexSelect } = require('../utils/transcriptIndex');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        try {
            // ── Slash Commands ─────────────────────────────────────────────────
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (!command) return;
                await command.execute(interaction, client);
            }

            // ── String Select Menus ────────────────────────────────────────────
            else if (interaction.isStringSelectMenu()) {
                if (interaction.customId === 'ticket_panel_select') {
                    await handlePanelSelect(interaction, client);
                } else if (interaction.customId === 'ticket_test_select') {
                    await handleTestPanelSelect(interaction, client);
                } else if (interaction.customId === 'transcript_index_select') {
                    await handleTranscriptIndexSelect(interaction);
                }
            }

            // ── Modal Submissions ──────────────────────────────────────────────
            else if (interaction.isModalSubmit()) {
                if (interaction.customId === 'modal_general_support') {
                    await handleGeneralModal(interaction, client);
                } else if (interaction.customId === 'modal_general_support_test') {
                    await handleGeneralTestModal(interaction, client);
                } else if (interaction.customId === 'modal_staff_report') {
                    await handleStaffReportModal(interaction, client);
                } else if (interaction.customId === 'modal_staff_report_test') {
                    await handleStaffReportTestModal(interaction, client);
                } else if (interaction.customId === 'modal_foundership_report') {
                    await handleFoundershipReportModal(interaction, client);
                } else if (interaction.customId === 'modal_close_ticket') {
                    await handleCloseModal(interaction, client);
                } else if (interaction.customId === 'modal_partnership_apply') {
                    await handlePartnershipModal(interaction, client);
                }
            }

            // ── Buttons ────────────────────────────────────────────────────────
            else if (interaction.isButton()) {
                const { customId } = interaction;

                // ── Main panel buttons ─────────────────────────────────────────
                if (customId === 'panel_general_btn') {
                    await handlePanelGeneralBtn(interaction);
                } else if (customId === 'panel_staff_btn') {
                    await handlePanelStaffBtn(interaction);

                // ── General Support sub-embed buttons ──────────────────────────
                } else if (customId === 'gs_dept_inquiry') {
                    await handleGsDeptInquiry(interaction);
                } else if (customId === 'gs_staff_app') {
                    await handleGsStaffApp(interaction);
                } else if (customId === 'gs_punishment_appeal') {
                    await handleGsPunishmentAppeal(interaction);
                } else if (customId === 'gs_bot_issues') {
                    await handleGsBotIssues(interaction);
                } else if (customId === 'gs_continue') {
                    await handleGsContinue(interaction);

                // ── Staff Report panel buttons ─────────────────────────────────
                } else if (customId === 'open_staff_report') {
                    await handleOpenStaffReportBtn(interaction);
                } else if (customId === 'open_foundership_report') {
                    await handleOpenFoundershipReportBtn(interaction);

                // ── Ticket management buttons ──────────────────────────────────
                } else {
                    await handleButton(interaction, client);
                }
            }

        } catch (err) {
            console.error('[interactionCreate] Unhandled error:', err);
            const payload = { content: '⚠️ An unexpected error occurred. Please try again.', flags: MessageFlags.Ephemeral };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(payload).catch(() => {});
            } else {
                await interaction.reply(payload).catch(() => {});
            }
        }
    },
};
