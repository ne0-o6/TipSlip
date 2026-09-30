# 接入指南

這份文件說明如何把收據出圖接進既有的 Discord bot：在結單時彈出預覽面板，讓使用者選擇收據樣式，確認後把收據圖發到頻道。

- 下單、選陪陪、付款等流程由你的 bot 負責，收據服務只處理「最後出圖」這一步。
- Python（discord.py）與 JavaScript（discord.js）有現成的 helper，其他語言可直接呼叫 HTTP API。

## 目錄

1. [流程總覽](#1-流程總覽)
2. [啟動收據服務](#2-啟動收據服務)
3. [準備收據資料](#3-準備收據資料)
4. [Python（discord.py）](#4-pythondiscordpy)
5. [JavaScript（discord.js）](#5-javascriptdiscordjs)
6. [其他語言：直接呼叫 HTTP API](#6-其他語言直接呼叫-http-api)
7. [互動細節與限制](#7-互動細節與限制)
8. [疑難排解](#8-疑難排解)
9. [上線前檢查](#9-上線前檢查)

## 1. 流程總覽

```
使用者在你的 bot 裡下單、付款
            │
            ▼  結單（slash command 或按鈕觸發）
你的 bot：把訂單轉成收據資料 data
            │
            ▼
receipts.checkout(interaction, data)
            │
            ├─ 只有結單的人看得到的面板：收據預覽＋樣式下拉選單＋「送出收據／取消」
            │     切換樣式 → 重新出圖並更新預覽
            │
            ├─ 送出收據 → 頻道收到收據圖，回傳 status = "sent"
            ├─ 取消     → 不發送，回傳 status = "cancelled"
            └─ 逾時     → 不發送，回傳 status = "timeout"

出圖流程：helper → POST /render → 收據服務（Node + Chrome）→ PNG
```

不需要面板的情況（例如金流回呼自動入帳、沒有互動可以回覆），可以直接呼叫 `receipts.send(channel, data)`，以伺服器的預設樣式發圖。

## 2. 啟動收據服務

收據服務與 bot 放在同一台機器最簡單，bot 透過 `http://127.0.0.1:3939` 呼叫。

```bash
npm install
npm start
curl http://127.0.0.1:3939/health     # {"ok":true}
```

瀏覽器打開 <http://127.0.0.1:3939> 可預覽所有樣式、試改資料。

| 環境變數 | 預設 | 說明 |
| --- | --- | --- |
| `PORT` | `3939` | |
| `HOST` | `127.0.0.1` | 只有 bot 在其他機器上時才改成 `0.0.0.0`，並用防火牆限制來源 |
| `RENDER_CONCURRENCY` | `2` | 同時出圖的數量；調高可增加吞吐量，但會用掉更多記憶體 |
| `CHROME_PATH` | 自動尋找 | 瀏覽器執行檔路徑 |
| `CHROME_NO_SANDBOX` | | 在 Docker 內以 root 執行時設為 `1` |

Linux 主機需要先安裝瀏覽器與字型，否則中文和 emoji 會變成方框：

```bash
sudo apt install chromium fonts-noto-cjk fonts-noto-color-emoji
```

常駐執行（以 pm2 為例）：

```bash
pm2 start src/server.mjs --name receipt-service
pm2 save
```

服務本身沒有驗證機制，請勿直接開放到公網。

## 3. 準備收據資料

以一則結單訊息為例，對應關係如下：

| 原本的訊息 | 收據資料欄位 |
| --- | --- |
| 打賞已使用儲值卡付款 | `"payment": "stored_value"` |
| 打賞人 `@Лиса🦊` | `"payer": "@Лиса🦊"` |
| 受賞陪陪、打賞明細 | `"items": [...]`，每個禮物一筆 |
| `@𝓐𝓢.店長 \| 星野 …：客製打賞×1｜120 ASD` | `{ "to": "@𝓐𝓢.店長 \| 星野 …", "toShort": "星野", "name": "客製打賞", "qty": 1, "amount": 120 }` |
| 總金額 NT$120 | `"total": 120` |
| 扣款後餘額 1470 ASD | `"balance": 1470` |
| 今天 上午 05:24 | `"time": "2026-09-30T05:24:00+08:00"` |

```json
{
  "payer": "@Лиса🦊",
  "items": [
    { "to": "@𝓐𝓢.店長 | 星野 -專屬客服/ON AIR!", "toShort": "星野", "name": "客製打賞", "qty": 1, "amount": 120 }
  ],
  "unit": "ASD",
  "total": 120,
  "balance": 1470,
  "payment": "stored_value",
  "time": "2026-09-30T05:24:00+08:00",
  "shop": "𝓐𝓢",
  "note": "感謝您的支持"
}
```

填寫原則：

- **金額一律給數字**（`1560`，而不是 `"1,560"`），千分位和幣別由樣式處理。
- **時間給 ISO 8601 的結單時間**，不要給「今天」。圖片發出後會一直留著，相對時間很快就會失真。
- **多位陪陪、同一種禮物不同數量**：每位陪陪的每個禮物各寫一筆。同一位陪陪的多筆禮物會自動合併成一組顯示。

  ```json
  "items": [
    { "to": "@小羽", "name": "客製打賞", "qty": 2, "amount": 440 },
    { "to": "@星野", "name": "客製打賞", "qty": 1, "amount": 220 },
    { "to": "@星野", "name": "語音陪玩（一小時）", "qty": 3, "amount": 900 }
  ]
  ```

- **`toShort` 建議都填**。I（復古硬卡車票）、J（登機證）會用短名當大字；不填則顯示完整名稱並自動縮小字級。
- **`balance` 只在會扣餘額的付款方式（儲值卡、錢包扣款）才帶**；不帶就不會顯示這一列。
- **`payment` 用 key**：`stored_value`、`wallet`、`jkopay`、`ecpay`、`atm`、`ctbc_cardless`、`crypto`、`usd_transfer`。新增付款方式請見[參考文件](REFERENCE.md#付款方式)。加密貨幣預設以 USDT 顯示，其他幣別請帶 `"currency": "ETH "`。

完整欄位說明見[參考文件](REFERENCE.md#資料格式)。

## 4. Python（discord.py）

需要 discord.py 2.x。aiohttp 是 discord.py 的相依套件，不用另外安裝。

### 4.1 放入檔案

把 `clients/python/receipt_client.py` 和 `clients/python/receipt_discord.py` 複製到 bot 專案中。

### 4.2 啟動時建立實例

```python
from receipt_client import ReceiptClient
from receipt_discord import DiscordReceipts, MemoryStyleStore

receipts = DiscordReceipts(
    ReceiptClient("http://127.0.0.1:3939"),
    store=MemoryStyleStore(default_template="thermal"),  # 伺服器預設樣式
)
```

### 4.3 結單時呼叫 `checkout`

```python
def build_receipt_data(order) -> dict:
    """把你的訂單物件轉成收據資料；欄位名稱依你的資料結構調整。"""
    return {
        "payer": order.payer_display_name,
        "items": [
            {
                "to": line.companion_display_name,
                "toShort": line.companion_nickname,
                "name": line.gift_name,
                "qty": line.quantity,
                "amount": line.amount,
            }
            for line in order.lines
        ],
        "unit": "ASD",
        "total": order.total,
        "balance": order.balance_after if order.payment_method in ("stored_value", "wallet") else None,
        "payment": order.payment_method,
        "time": order.completed_at.isoformat(),
        "shop": "𝓐𝓢",
        "note": "感謝您的支持",
    }


async def finish_order(interaction: discord.Interaction, order) -> None:
    view = await receipts.checkout(interaction, build_receipt_data(order))
    await view.wait()

    if view.status == "sent":
        # view.template：使用者選的樣式；view.sent_message：頻道裡那則收據訊息
        await save_receipt(order.id, view.template, view.sent_message.id)
```

- `interaction` 可以來自 slash command，也可以來自你自己面板上的「結單」按鈕。
- 如果呼叫前已經 `defer` 或回覆過，`checkout` 會改用 followup 送出面板。
- 呼叫前若有耗時的查詢，請先 `await interaction.response.defer(ephemeral=True)`，避免超過 Discord 的 3 秒回應期限。

`checkout` 的參數：

| 參數 | 預設 | 說明 |
| --- | --- | --- |
| `destination` | `interaction.channel` | 收據發到哪裡，可傳頻道、討論串或 DM（`await interaction.user.create_dm()`） |
| `content` | `None` | 隨圖附上的文字，例如 `f"{interaction.user.mention} 的打賞收據"` |
| `timeout` | `300` | 秒；上限 840（Discord 互動 token 15 分鐘後失效） |

### 4.4 不用面板直接發圖

```python
await receipts.send(channel, data)                 # 使用伺服器預設樣式
await receipts.send(channel, data, template="J")   # 指定樣式，id 或代號皆可
```

### 4.5 伺服器預設樣式（選用）

```python
@tree.command(name="receipt-style", description="選擇這個伺服器的預設收據樣式")
async def receipt_style(interaction: discord.Interaction):
    view = await receipts.style_view(interaction.guild_id)
    await interaction.response.send_message("選一個收據樣式：", view=view, ephemeral=True)
```

`MemoryStyleStore` 把設定存在記憶體，重啟後就會遺失。要永久保存的話，改成任何實作了這兩個方法的物件：

```python
class DbStyleStore:
    async def get(self, guild_id): ...              # 回傳樣式 id，沒設定時回傳預設值
    async def set(self, guild_id, template): ...

receipts = DiscordReceipts(ReceiptClient(), store=DbStyleStore())
```

可執行的完整範例：[`clients/python/example_bot.py`](../clients/python/example_bot.py)（`/checkout-demo`、`/receipt-style`、`/receipt-demo`）。

## 5. JavaScript（discord.js）

需要 discord.js v14 與 Node.js 18.17 以上。

### 5.1 放入檔案

把 `clients/js/receipt-client.mjs` 和 `clients/js/discord.mjs` 複製到 bot 專案中。

### 5.2 啟動時建立實例

```js
import { ReceiptClient } from './receipt-client.mjs';
import { DiscordReceipts, MemoryStyleStore } from './discord.mjs';

const receipts = new DiscordReceipts(new ReceiptClient('http://127.0.0.1:3939'), {
  store: new MemoryStyleStore('thermal'),
});
```

bot 本身就是 Node 的話，也可以不透過 HTTP，直接在 bot 的行程裡出圖：

```js
import { ReceiptRenderer } from './tip-receipt/src/renderer.mjs';
const receipts = new DiscordReceipts(new ReceiptRenderer());
```

### 5.3 結單時呼叫 `checkout`

```js
async function finishOrder(interaction, order) {
  const result = await receipts.checkout(interaction, buildReceiptData(order));

  if (result.status === 'sent') {
    // result.template：使用者選的樣式；result.message：頻道裡那則收據訊息
    await saveReceipt(order.id, result.template, result.message.id);
  }
}
```

`checkout` 的選項：`{ channel, content, timeout }`。預設值為 `interaction.channel`、無附加文字、5 分鐘；逾時上限 14 分鐘。

面板上元件的 customId 以 `receipt-checkout:` 開頭，由 `checkout` 自己的 collector 處理。如果你有全域的 `InteractionCreate` handler，請略過這些 customId。

### 5.4 其他

```js
await receipts.send(channel, data);            // 不用面板直接發圖
await receipts.send(channel, data, 'ticket');  // 指定樣式

// 伺服器預設樣式
if (interaction.commandName === 'receipt-style') await receipts.promptStyle(interaction);
if (await receipts.handleStyleSelect(interaction)) return;   // 放在 InteractionCreate 開頭
```

可執行的完整範例：[`clients/js/example-bot.mjs`](../clients/js/example-bot.mjs)。

## 6. 其他語言：直接呼叫 HTTP API

```
GET  /templates   → [{ "id": "thermal", "code": "A", "name": "熱感紙收據", "description": "...", "width": 400 }, ...]
GET  /payments    → [{ "key": "jkopay", "label": "街口支付", "status": "打賞已使用街口支付付款" }, ...]
POST /render      → body { "template": "thermal", "data": {...}, "scale": 2 }，回傳 image/png
```

錯誤格式為 `{ "error": { "code": "...", "message": "..." } }`，狀態碼與 code 的對照見[參考文件](REFERENCE.md#錯誤碼)。

要自己實作面板的話，流程如下：

1. 用 `/templates` 產生下拉選單的選項。
2. 使用者每切換一次樣式，就呼叫 `/render` 更新預覽。
3. 使用者按下送出後，把最後一張 PNG 發到頻道。

## 7. 互動細節與限制

- 面板是 ephemeral 訊息，只有觸發結單的人看得到，其他人也無法操作。
- 每種樣式在同一個面板裡只會出圖一次；切回看過的樣式時直接使用快取，送出時也不會重新出圖。
- 出圖時間約 0.3–1 秒。服務啟動後的第一張圖需要啟動 Chrome，約 1–2 秒。
- 預設輸出 2 倍解析度的 PNG，大小約 100–250 KB，背景透明，在 Discord 深色與淺色主題下都能正常顯示。
- Discord 的下拉選單最多 25 個選項，超過的樣式不會出現在面板上。

## 8. 疑難排解

| 狀況 | 處理方式 |
| --- | --- |
| `NO_BROWSER` | 設定 `CHROME_PATH` 指向 Chrome／Chromium |
| 中文或 emoji 顯示成方框 | Linux 安裝 `fonts-noto-cjk`、`fonts-noto-color-emoji` |
| 字型和預覽頁不一樣 | 主機連不到 Google Fonts，已退回系統字型；開放 `fonts.googleapis.com`、`fonts.gstatic.com` |
| `RENDER_TIMEOUT` | 主機負載過高或網路卡住；調低 `RENDER_CONCURRENCY` 或檢查對外連線 |
| Discord 顯示「此互動失敗」／`Unknown interaction` | 在呼叫 `checkout` 前做了超過 3 秒的工作，請先 `defer` |
| 面板按鈕沒反應 | 面板已逾時，或全域 handler 攔截了 `receipt-checkout:` 開頭的元件 |
| `INVALID_DATA` | 訊息內會說明哪個欄位有問題（例如 `items` 不是陣列、字串超過 200 字） |

## 9. 上線前檢查

- [ ] 收據服務以常駐方式執行，`/health` 回傳 `{"ok":true}`
- [ ] 服務只開放給 bot 所在的內部網路
- [ ] Linux 主機已安裝 Chromium 與中文、emoji 字型
- [ ] 用 `/checkout-demo` 或自己的結單流程，實際跑過送出、取消、逾時三種情況
- [ ] 每種付款方式都用真實訂單資料出過一次圖，確認金額格式與餘額顯示正確
- [ ] 伺服器預設樣式已改用永久儲存（如果有使用 `/receipt-style`）
