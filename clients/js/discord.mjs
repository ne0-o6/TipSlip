/**
 * discord.js (v14) helpers on top of ReceiptClient.
 *
 *   const receipts = new DiscordReceipts(new ReceiptClient());
 *   await receipts.send(channel, data);                   // post a receipt directly
 *   const result = await receipts.checkout(interaction, data); // preview, pick a style, send
 *   await receipts.promptStyle(interaction);              // server-wide default style
 *   if (await receipts.handleStyleSelect(interaction)) return;
 */
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
} from 'discord.js';

export const STYLE_MENU_ID = 'receipt-style';
export const CHECKOUT_IDS = {
  style: 'receipt-checkout:style',
  send: 'receipt-checkout:send',
  cancel: 'receipt-checkout:cancel',
};

const MAX_SELECT_OPTIONS = 25;
// Interaction tokens expire after 15 minutes; the panel must close before that.
const MAX_CHECKOUT_TIMEOUT = 14 * 60_000;

/** Per-guild style preference kept in memory. Any object with the same async get/set works. */
export class MemoryStyleStore {
  #styles = new Map();

  constructor(defaultTemplate = 'thermal') {
    this.defaultTemplate = defaultTemplate;
  }

  async get(guildId) {
    return this.#styles.get(guildId) ?? this.defaultTemplate;
  }

  async set(guildId, template) {
    this.#styles.set(guildId, template);
  }
}

function checkoutButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(CHECKOUT_IDS.send).setLabel('送出收據').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(CHECKOUT_IDS.cancel).setLabel('取消').setStyle(ButtonStyle.Secondary),
  );
}

export class DiscordReceipts {
  constructor(receipts, { store = new MemoryStyleStore(), previewData = null, fileName = 'receipt.png' } = {}) {
    this.receipts = receipts;
    this.store = store;
    this.previewData = previewData;
    this.fileName = fileName;
  }

  /** Renders `data` with the guild's style (or `template`) as a message attachment. */
  async attachment(guildId, data, template) {
    const png = await this.receipts.render(template ?? (await this.store.get(guildId)), data);
    return new AttachmentBuilder(png, { name: this.fileName });
  }

  async send(channel, data, template) {
    return channel.send({ files: [await this.attachment(channel.guildId, data, template)] });
  }

  async styleMenu(current, customId = STYLE_MENU_ID) {
    const templates = await this.receipts.templates();
    const menu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('選擇收據樣式')
      .addOptions(
        templates.slice(0, MAX_SELECT_OPTIONS).map((t) => ({
          label: `${t.code} ${t.name}`,
          value: t.id,
          description: t.description ? t.description.slice(0, 100) : undefined,
          default: t.id === current,
        })),
      );
    return new ActionRowBuilder().addComponents(menu);
  }

  /**
   * Final step of an order: shows the invoking user an ephemeral preview with a
   * style menu and send/cancel buttons, then posts the chosen receipt.
   *
   * Resolves with `{ status: 'sent' | 'cancelled' | 'timeout', template, message? }`.
   * Works on a fresh interaction or one that was already deferred/replied to.
   */
  async checkout(interaction, data, { channel = interaction.channel, content, timeout = 5 * 60_000 } = {}) {
    let template = await this.store.get(interaction.guildId);
    const rendered = new Map();

    const receiptFile = async () => {
      if (!rendered.has(template)) rendered.set(template, await this.receipts.render(template, data));
      return new AttachmentBuilder(rendered.get(template), { name: this.fileName });
    };
    const panel = async () => ({
      content: '結單確認：選擇收據樣式後按「送出收據」。',
      files: [await receiptFile()],
      attachments: [],
      components: [await this.styleMenu(template, CHECKOUT_IDS.style), checkoutButtons()],
    });

    const ownsReply = !interaction.deferred && !interaction.replied;
    if (ownsReply) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const payload = await panel();
    const message = ownsReply
      ? await interaction.editReply(payload)
      : await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    // Ephemeral messages can only be edited through the interaction webhook.
    const closePanel = (text, keepPreview) =>
      interaction.editReply({ message: message.id, content: text, components: [], ...(keepPreview ? {} : { attachments: [] }) });

    const collector = message.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id && Object.values(CHECKOUT_IDS).includes(i.customId),
      time: Math.min(timeout, MAX_CHECKOUT_TIMEOUT),
    });

    return new Promise((resolve, reject) => {
      let result = null;

      collector.on('collect', async (i) => {
        try {
          await i.deferUpdate();
          if (i.customId === CHECKOUT_IDS.style) {
            [template] = i.values;
            await i.editReply(await panel());
          } else if (i.customId === CHECKOUT_IDS.send) {
            const sent = await channel.send({ content, files: [await receiptFile()] });
            result = { status: 'sent', template, message: sent };
            collector.stop('sent');
            await closePanel('收據已送出。', true);
          } else {
            result = { status: 'cancelled', template };
            collector.stop('cancelled');
            await closePanel('已取消，沒有送出收據。', false);
          }
        } catch (err) {
          collector.stop('error');
          await closePanel('收據產生失敗，請稍後再試。', false).catch(() => {});
          reject(err);
        }
      });

      collector.on('end', async (_, reason) => {
        if (reason === 'error') return;
        if (result) return resolve(result);
        await closePanel('結單面板已逾時，沒有送出收據。', false).catch(() => {});
        resolve({ status: 'timeout', template });
      });
    });
  }

  async promptStyle(interaction) {
    const current = await this.store.get(interaction.guildId);
    await interaction.reply({
      content: '選一個收據樣式：',
      components: [await this.styleMenu(current)],
      flags: MessageFlags.Ephemeral,
    });
  }

  /** Handles the server-wide style picker; resolves false for any other interaction. */
  async handleStyleSelect(interaction) {
    if (!interaction.isStringSelectMenu() || interaction.customId !== STYLE_MENU_ID) return false;

    const [template] = interaction.values;
    await interaction.deferUpdate();
    await this.store.set(interaction.guildId, template);

    const files = this.previewData ? [await this.attachment(interaction.guildId, this.previewData, template)] : [];
    await interaction.editReply({
      content: '已套用，之後的收據會使用這個樣式。',
      components: [await this.styleMenu(template)],
      files,
      attachments: [],
    });
    return true;
  }
}
