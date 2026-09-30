/**
 * Minimal discord.js bot wired to the receipt service.
 *
 *   npm install discord.js
 *   DISCORD_TOKEN=... node clients/js/example-bot.mjs
 *
 * /checkout-demo  run the checkout panel with examples/sample.json
 * /receipt-style  choose this server's default receipt style
 * /receipt-demo   post a receipt rendered from examples/sample.json
 */
import { readFile } from 'node:fs/promises';
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { DiscordReceipts } from './discord.mjs';
import { ReceiptClient, ReceiptServiceError } from './receipt-client.mjs';

const sample = JSON.parse(await readFile(new URL('../../examples/sample.json', import.meta.url), 'utf8'));
const receipts = new DiscordReceipts(new ReceiptClient(), { previewData: sample });

const commands = [
  { name: 'checkout-demo', description: '用範例資料跑一次結單流程' },
  { name: 'receipt-style', description: '選擇這個伺服器的預設收據樣式' },
  { name: 'receipt-demo', description: '用範例資料送出一張打賞收據' },
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (ready) => {
  await ready.application.commands.set(commands);
  console.log(`ready as ${ready.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (await receipts.handleStyleSelect(interaction)) return;
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'checkout-demo') {
      const result = await receipts.checkout(interaction, sample);
      console.log(`checkout ${result.status} (${result.template}) by ${interaction.user.tag}`);
    } else if (interaction.commandName === 'receipt-style') {
      await receipts.promptStyle(interaction);
    } else if (interaction.commandName === 'receipt-demo') {
      await interaction.deferReply();
      await interaction.editReply({ files: [await receipts.attachment(interaction.guildId, sample)] });
    }
  } catch (err) {
    if (!(err instanceof ReceiptServiceError)) console.error(err);
    if (!interaction.isRepliable()) return;
    const content = err instanceof ReceiptServiceError ? `收據產生失敗：${err.message}` : '指令執行失敗，請稍後再試。';
    const respond = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
    await interaction[respond]({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
