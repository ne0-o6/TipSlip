/*
 * Runtime shared by every receipt template.
 *
 * A template is a static HTML page containing a #receipt element. Bindings are
 * declared with data attributes and filled from the view model built by
 * normalize():
 *
 *   data-text="path"          textContent
 *   data-if="path"            hidden unless the value is non-empty
 *   data-unless="path"        hidden when the value is non-empty
 *   data-attr="name:path;..." attributes (removed when the value is empty)
 *   data-fit="min"            shrink font-size (px) until the text fits on one
 *                             line; the element must be block-level with a
 *                             constrained width
 *   <template data-each="path">
 *                             repeated per entry; entries inherit the outer
 *                             scope, so `multi` or `unit` stay reachable
 *
 * The renderer calls window.renderReceipt(data, { payments }), waits for
 * fonts, then calls window.fitReceipt().
 */
(function () {
  'use strict';

  // Mirrors examples/sample.json so a template opened directly shows content.
  const SAMPLE = {
    shop: '𝓐𝓢',
    payment: 'stored_value',
    payer: '@Лиса🦊',
    items: [
      { to: '@𝓐𝓢.店長 | 星野 -專屬客服/ON AIR!', toShort: '星野', name: '客製打賞', qty: 1, amount: 120 },
    ],
    unit: 'ASD',
    total: 120,
    balance: 1470,
    time: '2026-09-30T05:24:00+08:00',
    note: '感謝您的支持',
  };

  const FALLBACK_PAYMENTS = {
    stored_value: { label: '儲值卡', status: '打賞已使用儲值卡付款' },
  };

  const isBlank = (v) => v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0);
  const text = (v) => (v == null || v === '' ? '' : String(v));
  const pad2 = (n) => String(n).padStart(2, '0');
  const isNumeric = (v) => typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v));

  function formatNumber(value) {
    return isNumeric(value) ? Number(value).toLocaleString('en-US') : String(value);
  }

  function formatTime(value, timeZone) {
    const date = value == null || value === '' ? new Date() : new Date(value);
    if (Number.isNaN(date.getTime())) {
      // Free-form strings such as "今天 上午 05:24" are shown verbatim.
      const raw = String(value);
      return { iso: '', text: raw, date: raw, dateWeek: raw, md: raw, mdTime: raw, long: raw, longText: raw, time12: '', clock: '', stamp: raw };
    }

    const p = {};
    const parts = new Intl.DateTimeFormat('zh-TW', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'narrow',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(date);
    for (const part of parts) p[part.type] = part.value;

    const ymd = `${p.year}/${pad2(p.month)}/${pad2(p.day)}`;
    const md = `${pad2(p.month)}/${pad2(p.day)}`;
    const week = `（${p.weekday}）`;
    const clock = `${p.hour}:${p.minute}`;
    const time12 = `${p.dayPeriod} ${clock}`;
    const long = `${p.year} 年 ${p.month} 月 ${p.day} 日${week}`;

    return {
      iso: date.toISOString(),
      text: `${ymd}${week}${time12}`, // 2026/09/30（三）上午 05:24
      date: ymd, //                      2026/09/30
      dateWeek: `${ymd}${week}`, //      2026/09/30（三）
      md, //                             09/30
      mdTime: `${md}${week}${time12}`, // 09/30（三）上午 05:24
      long, //                           2026 年 9 月 30 日（三）
      longText: `${long}${time12}`, //   2026 年 9 月 30 日（三）上午 05:24
      time12, //                         上午 05:24
      clock, //                          05:24
      stamp: `${p.year}.${String(p.month).padStart(2, ' ')}.${pad2(p.day)}`, // 2026. 9.30
    };
  }

  /** Looks a payment up by registry key or label; unknown values become a custom label. */
  function resolvePayment(value, registry) {
    const key = text(value);
    if (!key) return { key: '', label: '', status: '', totalFormat: '' };
    const entry = registry[key] || Object.values(registry).find((p) => p.label === key) || {};
    const label = text(entry.label) || key;
    return {
      key,
      label,
      status: text(entry.status) || `打賞已使用${label}付款`,
      totalFormat: text(entry.totalFormat),
    };
  }

  function normalize(input, options) {
    const data = input || {};
    const registry = (options && options.payments) || FALLBACK_PAYMENTS;
    const unit = text(data.unit) || 'ASD';
    const payment = resolvePayment(data.payment, registry);
    const totalFormat =
      text(data.totalFormat) ||
      (text(data.currency) ? `${data.currency}{amount}` : '') ||
      payment.totalFormat ||
      'NT${amount}';

    const items = (Array.isArray(data.items) ? data.items : []).map((raw, i) => {
      const item = raw || {};
      const to = text(item.to);
      return {
        index: pad2(i + 1),
        to,
        short: text(item.toShort) || to,
        name: text(item.name) || '打賞',
        qty: isBlank(item.qty) ? '' : `×${item.qty}`,
        amount: isBlank(item.amount) ? '—' : `${formatNumber(item.amount)} ${unit}`,
        amountValue: isNumeric(item.amount) ? Number(item.amount) : null,
      };
    });

    // One group per companion, in first-seen order, so a companion with several
    // gifts is listed once and each gift keeps its own quantity.
    const groups = [];
    for (const item of items) {
      let group = groups.find((g) => g.to === item.to);
      if (!group) {
        group = { index: pad2(groups.length + 1), to: item.to, short: item.short, showFull: item.short !== item.to, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    }
    for (const group of groups) {
      const sum = group.items.every((i) => i.amountValue !== null)
        ? group.items.reduce((acc, i) => acc + i.amountValue, 0)
        : null;
      group.subtotal = sum === null ? '' : `${formatNumber(sum)} ${unit}`;
      group.itemCount = group.items.length;
    }

    const shortByName = new Map(groups.filter((g) => g.to).map((g) => [g.to, g.short]));
    const source = Array.isArray(data.recipients)
      ? data.recipients.map((r) => (typeof r === 'string' ? { name: r } : r || {}))
      : groups.map((g) => ({ name: g.to }));

    const recipients = [];
    for (const entry of source) {
      const name = text(entry.name);
      if (!name || recipients.some((r) => r.name === name)) continue;
      const short = text(entry.short) || shortByName.get(name) || name;
      recipients.push({ index: pad2(recipients.length + 1), name, short, showFull: short !== name });
    }

    return {
      shop: text(data.shop),
      status: text(data.status) || payment.status,
      payment: payment.label,
      paymentKey: payment.key,
      payer: text(data.payer),
      note: text(data.note),
      unit,
      items,
      noItems: items.length === 0,
      groups,
      recipients,
      recipientCount: recipients.length,
      multi: recipients.length > 1,
      toShortList: recipients.map((r) => r.short).join('、'),
      total: isBlank(data.total) ? '' : totalFormat.replace('{amount}', formatNumber(data.total)),
      balance: isBlank(data.balance) ? '' : `${formatNumber(data.balance)} ${unit}`,
      time: formatTime(data.time, text(data.timeZone) || 'Asia/Taipei'),
    };
  }

  function lookup(scope, path) {
    return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), scope);
  }

  function select(root, selector) {
    const found = Array.from(root.querySelectorAll(selector));
    if (root.matches && root.matches(selector)) found.unshift(root);
    return found;
  }

  function bind(root, scope) {
    for (const el of select(root, '[data-text]')) {
      el.textContent = text(lookup(scope, el.dataset.text));
    }
    for (const el of select(root, '[data-if]')) {
      el.hidden = isBlank(lookup(scope, el.dataset.if));
    }
    for (const el of select(root, '[data-unless]')) {
      el.hidden = !isBlank(lookup(scope, el.dataset.unless));
    }
    for (const el of select(root, '[data-attr]')) {
      for (const pair of el.dataset.attr.split(';')) {
        const [name, path] = pair.split(':').map((s) => s.trim());
        const value = text(lookup(scope, path));
        if (value) el.setAttribute(name, value);
        else el.removeAttribute(name);
      }
    }
    for (const tpl of select(root, 'template[data-each]')) {
      const list = lookup(scope, tpl.dataset.each);
      (Array.isArray(list) ? list : []).forEach((entry, i, all) => {
        const entryScope = Object.assign(Object.create(scope), entry, { $first: i === 0, $last: i === all.length - 1 });
        const fragment = tpl.content.cloneNode(true);
        bind(fragment, entryScope);
        for (const node of Array.from(fragment.children)) {
          node.setAttribute('data-generated', '');
          tpl.before(node);
        }
      });
    }
  }

  function fit(root) {
    for (const el of select(root, '[data-fit]')) {
      el.style.fontSize = '';
      el.style.whiteSpace = 'nowrap';
      el.style.overflowWrap = '';
      const min = Number(el.dataset.fit) || 14;
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollWidth > el.clientWidth + 0.5 && size > min) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
      if (el.scrollWidth > el.clientWidth + 0.5) {
        // Still too wide at the minimum size: wrap, breaking long handles if needed.
        el.style.whiteSpace = 'normal';
        el.style.overflowWrap = 'anywhere';
      }
    }
  }

  function receiptRoot() {
    return document.getElementById('receipt');
  }

  function renderReceipt(data, options) {
    const model = normalize(data === undefined ? SAMPLE : data, options);
    const root = receiptRoot();
    for (const node of root.querySelectorAll('[data-generated]')) node.remove();
    bind(root, model);
    fit(root);
    return model;
  }

  window.ReceiptKit = { normalize, resolvePayment, formatTime, formatNumber, sample: SAMPLE };
  window.renderReceipt = renderReceipt;
  window.fitReceipt = () => fit(receiptRoot());

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => renderReceipt());
  } else {
    renderReceipt();
  }
  if (document.fonts) document.fonts.addEventListener('loadingdone', () => window.fitReceipt());
})();
