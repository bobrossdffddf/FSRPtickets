require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const cfg  = require('./config.json');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const cmd = require(path.join(commandsPath, file));
    if (cmd.data) commands.push(cmd.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
    try {
        console.log(`Registering ${commands.length} slash commands to guild ${cfg.guildId}…`);
        const data = await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, cfg.guildId),
            { body: commands }
        );
        console.log(`✅ Successfully registered ${data.length} commands.`);
    } catch (err) {
        console.error('❌ Deploy failed:', err);
    }
})();
