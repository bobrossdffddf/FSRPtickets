module.exports = {
    name: 'ready',
    once: true,
    execute(client) {
        console.log(`\n✅  Logged in as ${client.user.tag}`);
        console.log(`🎟️   FSRP Ticket Bot is online and ready.\n`);
        client.user.setPresence({
            activities: [{ name: 'FSRP Support | /panel', type: 3 }],
            status: 'online',
        });
    },
};
