"""Minimal discord.py bot wired to the receipt service.

    pip install -U discord.py
    DISCORD_TOKEN=... python clients/python/example_bot.py

/checkout-demo  run the checkout panel with examples/sample.json
/receipt-style  choose this server's default receipt style
/receipt-demo   post a receipt rendered from examples/sample.json
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

import discord
from discord import app_commands

from receipt_client import ReceiptClient, ReceiptServiceError
from receipt_discord import DiscordReceipts

log = logging.getLogger("receipt-bot")

SAMPLE = json.loads((Path(__file__).resolve().parents[2] / "examples" / "sample.json").read_text(encoding="utf-8"))

receipts = DiscordReceipts(ReceiptClient(), preview_data=SAMPLE)


class ReceiptBot(discord.Client):
    def __init__(self) -> None:
        super().__init__(intents=discord.Intents.default())
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self) -> None:
        await self.tree.sync()


bot = ReceiptBot()


@bot.tree.command(name="checkout-demo", description="用範例資料跑一次結單流程")
async def checkout_demo(interaction: discord.Interaction) -> None:
    view = await receipts.checkout(interaction, SAMPLE)
    await view.wait()
    log.info("checkout %s (%s) by %s", view.status, view.template, interaction.user)


@bot.tree.command(name="receipt-style", description="選擇這個伺服器的預設收據樣式")
async def receipt_style(interaction: discord.Interaction) -> None:
    view = await receipts.style_view(interaction.guild_id)
    await interaction.response.send_message("選一個收據樣式：", view=view, ephemeral=True)


@bot.tree.command(name="receipt-demo", description="用範例資料送出一張打賞收據")
async def receipt_demo(interaction: discord.Interaction) -> None:
    await interaction.response.defer()
    await interaction.followup.send(file=await receipts.file(interaction.guild_id, SAMPLE))


@bot.tree.error
async def on_app_command_error(interaction: discord.Interaction, error: app_commands.AppCommandError) -> None:
    original = getattr(error, "original", error)
    if isinstance(original, ReceiptServiceError):
        message = f"收據產生失敗：{original}"
    else:
        log.exception("command failed", exc_info=original)
        message = "指令執行失敗，請稍後再試。"
    if interaction.response.is_done():
        await interaction.followup.send(message, ephemeral=True)
    else:
        await interaction.response.send_message(message, ephemeral=True)


if __name__ == "__main__":
    bot.run(os.environ["DISCORD_TOKEN"])
