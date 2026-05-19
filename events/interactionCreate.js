const { handlePanelSelect, handleUserSelect, handleGeneralModal, handleStaffReportModal } =
    require('../handlers/panelHandler');
const { handleButton, handleCloseModal } = require('../handlers/buttonHandler');

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
                }
            }

            // ── User Select Menus (staff report — step 1: pick who to report) ─
            else if (interaction.isUserSelectMenu()) {
                if (interaction.customId === 'report_user_select') {
                    await handleUserSelect(interaction, client);
                }
            }

            // ── Modal Submissions ──────────────────────────────────────────────
            else if (interaction.isModalSubmit()) {
                if (interaction.customId === 'modal_general_support') {
                    await handleGeneralModal(interaction, client);
                } else if (interaction.customId === 'modal_staff_report') {
                    await handleStaffReportModal(interaction, client);
                } else if (interaction.customId === 'modal_close_ticket') {
                    await handleCloseModal(interaction, client);
                }
            }

            // ── Buttons ────────────────────────────────────────────────────────
            else if (interaction.isButton()) {
                await handleButton(interaction, client);
            }

        } catch (err) {
            console.error('[interactionCreate] Unhandled error:', err);
            const payload = { content: '⚠️ An unexpected error occurred. Please try again.', ephemeral: true };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(payload).catch(() => {});
            } else {
                await interaction.reply(payload).catch(() => {});
            }
        }
    },
};
