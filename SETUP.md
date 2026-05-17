# FSRP Ticket Bot — Setup Guide

---

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- A **Discord Bot** created at [discord.com/developers](https://discord.com/developers/applications)
- A **Melonly API key** — Melonly Dashboard → Panel Settings → API Token

---

## Step 1 — Create your Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → name it `FSRP Tickets`
3. Go to the **Bot** tab → click **Add Bot**
4. Under **Privileged Gateway Intents**, enable:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
5. Copy your **Bot Token** (you'll need it in Step 3)
6. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Administrator`
7. Open the generated URL and invite the bot to your server

Copy your **Application ID** (shown on the General Information page) — this is your `CLIENT_ID`.

---

## Step 2 — Install dependencies

Open a terminal in the `fsrp-ticketbot` folder and run:

```bash
npm install
```

---

## Step 3 — Configure environment

Create a file called `.env` in the `fsrp-ticketbot` folder:

```
BOT_TOKEN=paste_your_bot_token_here
CLIENT_ID=paste_your_application_id_here
MELONLY_API_KEY=paste_your_melonly_api_key_here
```

> **Melonly API Key:** Sign in at [melonly.xyz](https://melonly.xyz) → Dashboard → Panel Settings → API Token. Make sure the token is scoped to your FSRP server.

---

## Step 4 — Verify config.json

The `config.json` file is already pre-filled with your server's IDs:

| Setting | Value |
|---|---|
| Guild ID | `1487127237584224441` |
| Staff Role | `1487127237898666070` |
| High Rank Role | `1487127238058180810` |
| Foundership Role | `1487127238141935635` |
| Transcripts Channel | `1487127239945621611` |
| General Category | `1501036273916444853` |
| High Rank Category | `1501037177918853220` |
| Foundership Category | `1487165830826561737` |

If any of these change, edit `config.json` accordingly.

---

## Step 5 — Deploy slash commands

Run this **once** to register all commands:

```bash
npm run deploy
```

You should see: `✅ Successfully registered 6 commands.`

---

## Step 6 — Start the bot

```bash
npm start
```

You should see:
```
✅  Logged in as FSRP Tickets#xxxx
🎟️   FSRP Ticket Bot is online and ready.
```

---

## Step 7 — Set up the panel

In the Discord channel where you want the support panel to appear, run:

```
/panel
```

This sends the panel with the support category dropdown.

---

## Commands Reference

| Command | Description | Who can use |
|---|---|---|
| `/panel` | Send the support panel | Staff (Manage Channels perm) |
| `/close` | Close the current ticket + generate transcript | Staff, opener, or claimer |
| `/escalate` | Escalate ticket to next tier (Staff → HR → Foundership) | Staff+ |
| `/dismiss` | Force-unclaim a ticket | High Rank+ |
| `/rename <name>` | Rename the ticket channel | Staff or opener |
| `/closerequest` | Ask the opener if the ticket can be closed | Staff |

---

## How Escalation Works

| Level | Who has access | Channel category |
|---|---|---|
| 0 — Staff | All staff + opener | General category |
| 1 — High Rank | HR role + Foundership + claimer (individual) | High Rank category |
| 2 — Foundership | Foundership + claimer (individual) | Foundership category |

When escalated:
- The previous tier's role **loses all permissions** on the channel
- The new tier's role gains access
- The claimer keeps their individual permission overwrite **no matter what**
- Regular staff **cannot** see a High Rank or Foundership ticket

---

## Transcript Files

Transcripts are saved to `data/transcripts/` as HTML files and also uploaded to your transcripts channel as attachments. You can open the HTML file in any browser to view a full chat log with embeds.

---

## Keeping the bot online 24/7

Use **PM2** for persistent hosting:

```bash
npm install -g pm2
pm2 start index.js --name fsrp-tickets
pm2 save
pm2 startup
```

Or host on a VPS / server (DigitalOcean, Hetzner, etc.).

---

## Troubleshooting

**Bot is offline / not responding:**
→ Check your `BOT_TOKEN` in `.env` is correct and the bot is invited to your server.

**Commands not showing up:**
→ Run `npm run deploy` again. It can take up to 1 hour to propagate globally (guild commands are instant).

**Roblox info not showing in tickets:**
→ Check your `MELONLY_API_KEY` in `.env`. Make sure the API token is generated from your FSRP server's Panel Settings in the Melonly dashboard, and that the ticket opener has verified their Roblox account through Melonly.

**Transcript channel is empty:**
→ Make sure the bot has `Send Messages` + `Attach Files` permissions in your transcripts channel.

---

*Florida State Roleplay — Ticket Bot v1.0.0*
