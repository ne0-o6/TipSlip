# 參考文件

- [資料格式](#資料格式)
- [付款方式](#付款方式)
- [HTTP API](#http-api)
- [錯誤碼](#錯誤碼)
- [樣式](#樣式)
- [新增樣式](#新增樣式)
- [設定與部署](#設定與部署)

## 資料格式

```json
{
  "payer": "@Лиса🦊",
  "items": [
    { "to": "@𝓐𝓢.陪玩小羽|ON AIR!", "toShort": "小羽", "name": "客製打賞", "qty": 2, "amount": 440 },
    { "to": "@𝓐𝓢.店長 | 星野 -專屬客服/ON AIR!", "toShort": "星野", "name": "客製打賞", "qty": 1, "amount": 220 },
    { "to": "@𝓐𝓢.店長 | 星野 -專屬客服/ON AIR!", "toShort": "星野", "name": "語音陪玩（一小時）", "qty": 3, "amount": 900 }
  ],
  "unit": "ASD",
  "total": 1560,
  "payment": "jkopay",
  "time": "2026-09-30T04:56:00+08:00",
  "shop": "𝓐𝓢",
  "note": "感謝您的支持"
}
```

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `payer` | string | 打賞人 |
| `items` | array | 明細，一個禮物一筆，最多 30 筆 |
| `items[].to` | string | 受賞陪陪的完整名稱 |
| `items[].toShort` | string | 選填。短名，票券類樣式的大字與存根會用它 |
| `items[].name` | string | 禮物名稱，預設「打賞」 |
| `items[].qty` | number | 數量 |
| `items[].amount` | number | 這一筆的金額，單位為 `unit` |
| `unit` | string | 明細與餘額的單位，預設 `ASD` |
| `total` | number | 總金額，格式依付款方式決定 |
| `payment` | string | 付款方式的 key 或顯示名稱；不在清單內的文字會直接顯示 |
| `balance` | number | 選填。扣款後餘額，沒有就不顯示 |
| `time` | string | ISO 8601 時間；無法解析的字串（如「今天 上午 05:24」）會原樣顯示 |
| `timeZone` | string | 顯示時區，預設 `Asia/Taipei` |
| `status` | string | 選填。覆寫付款狀態文字 |
| `currency` / `totalFormat` | string | 選填。覆寫總金額格式，例如 `"currency": "ETH "` 或 `"totalFormat": "{amount} 元"` |
| `shop` | string | 選填。店名 |
| `note` | string | 選填。結尾感謝語 |
| `recipients` | array | 選填。受賞陪陪清單；省略時依 `items` 出現順序整理 |

- 同一位陪陪的多筆禮物會合併成一組顯示；同一種禮物送給不同陪陪、數量不同時，各寫一筆即可。
- 字串欄位上限 200 字元。

## 付款方式

定義在 [`templates/_shared/payments.json`](../templates/_shared/payments.json)：

| key | 顯示名稱 | 總金額格式 |
| --- | --- | --- |
| `stored_value` | 儲值卡 | `NT$1,560` |
| `wallet` | 錢包扣款 | `NT$1,560` |
| `jkopay` | 街口支付 | `NT$1,560` |
| `ecpay` | 綠界支付 | `NT$1,560` |
| `atm` | 匯款 / ATM 虛擬帳號 | `NT$1,560` |
| `ctbc_cardless` | 中信無卡 | `NT$1,560` |
| `crypto` | 加密貨幣 | `35.5 USDT` |
| `usd_transfer` | 美金轉帳 | `US$20` |

新增付款方式只要加一筆設定，不需要改程式：

```json
"line_pay": { "label": "LINE Pay", "status": "打賞已使用 LINE Pay 付款" }
```

`totalFormat` 可省略，預設為 `NT${amount}`。加密貨幣預設顯示 USDT，其他幣別請在資料裡帶 `currency`。

## HTTP API

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `GET` | `/templates` | 樣式清單 `[{ id, code, name, description, width }]` |
| `GET` | `/payments` | 付款方式清單 `[{ key, label, status }]` |
| `POST` | `/render` | `{ template, data, scale? }` → `image/png`；`scale` 為 1–3，預設 2 |
| `GET` | `/health` | `{ ok: true }` |
| `GET` | `/` | 樣式預覽頁 |

```bash
curl -X POST http://127.0.0.1:3939/render \
  -H "Content-Type: application/json" \
  -d "{\"template\":\"ticket\",\"data\":$(cat examples/sample.json)}" \
  -o receipt.png
```

## 錯誤碼

錯誤一律以 JSON 回傳：`{ "error": { "code": "UNKNOWN_TEMPLATE", "message": "..." } }`。

| 狀態碼 | code | 原因 |
| --- | --- | --- |
| 400 | `INVALID_JSON` | 請求內容不是合法的 JSON |
| 400 | `INVALID_DATA` | 資料格式不符，訊息會指出欄位 |
| 404 | `UNKNOWN_TEMPLATE` | 找不到指定的樣式 |
| 413 | `PAYLOAD_TOO_LARGE` | 請求超過 64 KB |
| 500 | `NO_BROWSER` | 找不到 Chrome／Chromium |
| 500 | `BROKEN_TEMPLATE` | 樣式缺少 `#receipt` 元素 |
| 500 | `INTERNAL` | 其他錯誤，詳情見服務端 log |
| 504 | `RENDER_TIMEOUT` | 出圖逾時 |

## 樣式

| 代號 | id | 名稱 | 寬度 |
| --- | --- | --- | --- |
| A | `thermal` | 熱感紙收據 | 400 |
| C | `ticket` | 橫式票根 | 840 |
| F | `card` | 襯線感謝卡 | 400 |
| G | `pastel` | 粉彩可愛 | 400 |
| I | `rail` | 復古硬卡車票 | 760 |
| J | `boarding` | 登機證 | 840 |

`template` 可以填 id 或代號（不分大小寫），省略時使用第一個樣式。寬度單位為 CSS px，預設以 2 倍解析度輸出，背景透明。

## 新增樣式

1. 複製 `templates/thermal` 為 `templates/<id>`（id 使用小寫英數字）。
2. 修改 `meta.json`：`code`、`name`、`description`、`width`。
3. 在 `index.html` 以 data 屬性綁定資料。完整說明在 [`receipt-kit.js`](../templates/_shared/receipt-kit.js) 開頭：

   | 屬性 | 作用 |
   | --- | --- |
   | `data-text="payer"` | 填入文字 |
   | `data-if="balance"`、`data-unless="note"` | 依欄位是否有值來顯示或隱藏 |
   | `data-attr="datetime:time.iso"` | 設定屬性 |
   | `data-fit="18"` | 單行放不下時縮小字級，最小到 18px |
   | `<template data-each="groups">` | 逐項重複，可巢狀使用 `data-each="items"` |

4. 執行 `npm run samples -- <id>` 檢查輸出；`npm test` 會對每個樣式跑一次含極端資料的出圖測試。

新樣式會自動出現在 `/templates` 與 bot 的下拉選單中（Discord 下拉選單最多 25 項）。

可綁定的欄位：

| 欄位 | 內容 |
| --- | --- |
| `payer`、`shop`、`note`、`status`、`payment` | 文字 |
| `total`、`balance` | 已格式化的金額，例如 `NT$1,560`、`1,470 ASD` |
| `recipients[]` | `name`、`short`、`showFull`、`index` |
| `groups[]` | 依陪陪分組：`to`、`short`、`showFull`、`items[]`、`subtotal`、`itemCount` |
| `items[]` | `name`、`qty`（`×2`）、`amount`（`440 ASD`）、`to`、`short` |
| `multi`、`recipientCount`、`toShortList`、`noItems` | 版面判斷用 |
| `time.*` | `text`、`date`、`dateWeek`、`md`、`mdTime`、`long`、`longText`、`time12`、`clock`、`stamp`、`iso` |

## 設定與部署

| 環境變數 | 預設 | 說明 |
| --- | --- | --- |
| `PORT` | `3939` | |
| `HOST` | `127.0.0.1` | 只有 bot 在其他機器上時才改成 `0.0.0.0` |
| `RENDER_CONCURRENCY` | `2` | 同時出圖的數量 |
| `CHROME_PATH` | 自動尋找 | 瀏覽器執行檔路徑 |
| `CHROME_NO_SANDBOX` | | 在 Docker 內以 root 執行時設為 `1` |

範本見 [`.env.example`](../.env.example)。Node 20.6 以上可用 `node --env-file=.env src/server.mjs` 載入。

- Linux 需要安裝瀏覽器與字型：`apt install chromium fonts-noto-cjk fonts-noto-color-emoji`
- 常駐執行可使用 pm2 或 systemd
- 服務本身沒有驗證機制，請只開放給 bot 所在的內部網路
