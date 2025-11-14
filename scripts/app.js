const CONFIG = {
  wsUrl: "wss://fstream.binance.com/stream",
  streamPayload: {
    method: "SUBSCRIBE",
    params: ["!miniTicker@arr"],
    id: 1,
  },
  defaults: {
    shortWindow: 1,
    shortLimit: 10,
    shortThreshold: 5.0,
    shortSound: true,
  },
  settingsKey: "shortSettings_v1",
  priceHistoryKey: "priceHistory_v1",
  alertAckKey: "shortAlertAck_v2",
  historyWindowMinutes: 5,
  historySaveDebounce: 500,
  minuteMs: 60000,
};

const formatters = {
  price(value) {
    return Number.isFinite(value) ? Number(value).toFixed(6) : "-";
  },
  number(value) {
    return Number.isFinite(value)
      ? Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })
      : "-";
  },
  percent(value) {
    return Number.isFinite(value) ? (value * 100).toFixed(2) + "%" : "-";
  },
};

const clampers = {
  window(value) {
    return [1, 2, 5].includes(value) ? value : CONFIG.defaults.shortWindow;
  },
  limit(value) {
    return Math.max(1, Math.min(value, 50));
  },
  threshold(value) {
    return Math.max(0.1, Math.min(value, 100));
  },
};

class SettingsManager {
  constructor({ form, labels, onChange }) {
    this.form = form;
    this.labels = labels;
    this.onChange = onChange;
    this.state = { ...CONFIG.defaults };
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  init() {
    this.state = this.load();
    this.syncUI();
    if (this.form) {
      this.form.addEventListener("submit", this.handleSubmit);
    }
    this.notify();
  }

  getState() {
    return { ...this.state };
  }

  handleSubmit(event) {
    event.preventDefault();
    this.state.shortWindow = clampers.window(
      Number(this.form.short_window.value)
    );
    this.state.shortLimit = clampers.limit(Number(this.form.short_limit.value));
    this.state.shortThreshold = clampers.threshold(
      Number(this.form.short_threshold.value)
    );
    this.state.shortSound = this.form.short_sound.value === "1";
    this.save();
    this.syncUI();
    this.notify();
  }

  syncUI() {
    if (!this.form) return;
    this.form.short_window.value = String(this.state.shortWindow);
    this.form.short_limit.value = String(this.state.shortLimit);
    this.form.short_threshold.value = this.state.shortThreshold.toFixed(1);
    this.form.short_sound.value = this.state.shortSound ? "1" : "0";
    if (this.labels.shortWindowText) {
      this.labels.shortWindowText.textContent = this.state.shortWindow;
    }
    if (this.labels.shortLimitText) {
      this.labels.shortLimitText.textContent = this.state.shortLimit;
    }
    if (this.labels.shortWindowHeader) {
      this.labels.shortWindowHeader.textContent = this.state.shortWindow;
    }
    if (this.labels.alertThresholdLabel) {
      this.labels.alertThresholdLabel.textContent = this.state.shortThreshold.toFixed(
        1
      );
    }
  }

  save() {
    localStorage.setItem(CONFIG.settingsKey, JSON.stringify(this.state));
  }

  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(CONFIG.settingsKey) || "null");
      if (raw && typeof raw === "object") {
        return {
          shortWindow: clampers.window(
            Number(raw.shortWindow) || CONFIG.defaults.shortWindow
          ),
          shortLimit: clampers.limit(
            Number(raw.shortLimit) || CONFIG.defaults.shortLimit
          ),
          shortThreshold: clampers.threshold(
            Number(raw.shortThreshold) || CONFIG.defaults.shortThreshold
          ),
          shortSound: this.normalizeSoundValue(
            Object.prototype.hasOwnProperty.call(raw, "shortSound")
              ? raw.shortSound
              : CONFIG.defaults.shortSound
          ),
        };
      }
    } catch (err) {
      console.warn("加载本地设置失败，使用默认值", err);
    }
    return { ...CONFIG.defaults };
  }

  normalizeSoundValue(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      return !["0", "false", "off", "no"].includes(value.toLowerCase());
    }
    return Boolean(value);
  }

  notify() {
    this.onChange?.(this.getState());
  }
}

class PriceHistoryStore {
  constructor() {
    this.entries = new Map();
    this.saveTimer = null;
  }

  hydrate() {
    try {
      const raw = JSON.parse(
        localStorage.getItem(CONFIG.priceHistoryKey) || "null"
      );
      if (!Array.isArray(raw)) {
        return;
      }
      this.entries.clear();
      const nowMinute = Math.floor(Date.now() / CONFIG.minuteMs);
      const cutoff = nowMinute - CONFIG.historyWindowMinutes;
      for (const [symbol, items] of raw) {
        if (typeof symbol !== "string" || !Array.isArray(items)) continue;
        const normalized = items
          .map((entry) => this.normalize(entry))
          .filter(
            (entry) =>
              entry && Number.isFinite(entry.minute) && entry.minute >= cutoff
          );
        if (normalized.length > 0) {
          this.entries.set(symbol, normalized);
        }
      }
      if (this.entries.size > 0) {
        this.flush();
      }
    } catch (err) {
      console.warn("读取历史记录失败", err);
    }
  }

  record(symbol, price, eventTime = Date.now()) {
    if (!Number.isFinite(price)) return;
    const minuteKey = Math.floor(eventTime / CONFIG.minuteMs);
    const rows = this.entries.get(symbol) || [];
    let entry = rows.find((item) => item.minute === minuteKey);
    if (entry) {
      entry.values = Array.isArray(entry.values) ? entry.values : [];
      entry.values.push(price);
      entry.price = price;
      entry.lastUpdatedAt = eventTime;
      entry.finalized = false;
    } else {
      entry = {
        minute: minuteKey,
        values: [price],
        price,
        lastUpdatedAt: eventTime,
        finalized: false,
      };
      rows.push(entry);
    }

    for (const item of rows) {
      if (item.minute < minuteKey && !item.finalized) {
        this.finalize(item);
      }
    }

    const cutoff = minuteKey - CONFIG.historyWindowMinutes;
    const filtered = rows.filter((item) => item.minute >= cutoff);
    this.entries.set(symbol, filtered);
    this.scheduleSave();
  }

  getEntry(symbol, targetMinute) {
    const rows = this.entries.get(symbol);
    if (!rows) return null;
    const entry = rows.find((item) => item.minute === targetMinute);
    if (entry && !entry.finalized && entry.minute < this.currentMinute()) {
      this.finalize(entry);
    }
    return entry || null;
  }

  getAgeMinutes(entry) {
    if (!entry) return NaN;
    const reference = Number.isFinite(entry.lastUpdatedAt)
      ? entry.lastUpdatedAt
      : entry.minute * CONFIG.minuteMs;
    if (!Number.isFinite(reference)) return NaN;
    return Math.max(0, Math.floor((Date.now() - reference) / CONFIG.minuteMs));
  }

  flush() {
    this.saveNow();
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.saveNow(), CONFIG.historySaveDebounce);
  }

  saveNow() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      const payload = Array.from(this.entries.entries()).map(
        ([symbol, rows]) => [
          symbol,
          rows.map((row) => ({
            minute: row.minute,
            price: row.price,
            values: Array.isArray(row.values) ? row.values : [],
            finalized: Boolean(row.finalized),
            lastUpdatedAt: row.lastUpdatedAt,
          })),
        ]
      );
      localStorage.setItem(CONFIG.priceHistoryKey, JSON.stringify(payload));
    } catch (err) {
      console.warn("保存历史记录失败", err);
    }
  }

  normalize(raw) {
    if (!raw) return null;
    const minute = Number(raw.minute);
    if (!Number.isFinite(minute)) return null;
    const values = Array.isArray(raw.values)
      ? raw.values
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
      : [];
    let price = Number(raw.price);
    if (!Number.isFinite(price)) {
      price = values.length > 0 ? values[values.length - 1] : NaN;
    }
    if (!Number.isFinite(price)) {
      return null;
    }
    const lastUpdatedAt = Number(raw.lastUpdatedAt);
    return {
      minute,
      values,
      price,
      finalized: Boolean(raw.finalized),
      lastUpdatedAt: Number.isFinite(lastUpdatedAt)
        ? lastUpdatedAt
        : minute * CONFIG.minuteMs,
    };
  }

  finalize(entry) {
    if (!entry || entry.finalized) return;
    if (Array.isArray(entry.values) && entry.values.length > 0) {
      const sum = entry.values.reduce((acc, value) => acc + value, 0);
      entry.price = sum / entry.values.length;
    }
    entry.finalized = true;
  }

  currentMinute() {
    return Math.floor(Date.now() / CONFIG.minuteMs);
  }
}

class TableRenderer {
  constructor({ longBody, shortBody }) {
    this.longBody = longBody;
    this.shortBody = shortBody;
  }

  renderLong(rows) {
    if (!this.longBody) return;
    if (rows.length === 0) {
      this.longBody.innerHTML =
        '<tr><td class="placeholder" colspan="6">等待行情数据…</td></tr>';
      return;
    }
    this.longBody.innerHTML = rows
      .map((row) => {
        const cls = row.pct_change >= 0 ? "positive" : "negative";
        return `
          <tr>
            <td class="symbol">${row.symbol}</td>
            <td>${formatters.price(row.last_price)}</td>
            <td>${formatters.price(row.open_price)}</td>
            <td class="${cls}">${formatters.percent(row.pct_change)}</td>
            <td>${formatters.number(row.volume)}</td>
            <td>${formatters.number(row.quote_volume)}</td>
          </tr>
        `;
      })
      .join("");
  }

  renderShort(rows, threshold) {
    if (!this.shortBody) return;
    if (rows.length === 0) {
      this.shortBody.innerHTML =
        '<tr><td class="placeholder" colspan="4">短期数据尚未准备好…</td></tr>';
      return;
    }
    const thresholdRatio = Number.isFinite(threshold) ? threshold / 100 : 0;
    this.shortBody.innerHTML = rows
      .map((row) => {
        const cls = row.short_pct_change >= 0 ? "positive" : "negative";
        const isAlert =
          thresholdRatio > 0 && row.short_pct_change >= thresholdRatio;
        const ageLabel = Number.isFinite(row.history_age_minutes)
          ? `${row.history_age_minutes} 分钟前`
          : "时间未知";
        const historyAttr = Number.isFinite(row.history_timestamp)
          ? ` data-history-ts="${row.history_timestamp}"
              title="${ageLabel}"`
          : "";
        return `
          <tr>
            <td class="symbol">${row.symbol}</td>
            <td>${formatters.price(row.last_price)}</td>
            <td${historyAttr}>
              ${formatters.price(row.reference_price)}
            </td>
            <td class="${isAlert ? "alert-cell" : cls}">
              ${formatters.percent(row.short_pct_change)}
            </td>
          </tr>
        `;
      })
      .join("");
  }
}

class AlertManager {
  constructor({ overlay, list, ackButton }) {
    this.overlay = overlay;
    this.list = list;
    this.ackButton = ackButton;
    this.ackSet = this.loadAckSet();
    this.pendingHandler = null;
    this.audioCtx = null;
    this.toneTimer = null;
    this.soundEnabled = true;
  }

  setSoundEnabled(enabled) {
    this.soundEnabled = Boolean(enabled);
    if (!this.soundEnabled) {
      this.stopToneLoop();
    } else {
      this.resumeToneIfNeeded();
    }
  }

  maybeShow(rows, settings) {
    if (!this.overlay || !Array.isArray(rows) || rows.length === 0) {
      return;
    }
    const thresholdRatio = settings.shortThreshold / 100;
    if (!Number.isFinite(thresholdRatio) || thresholdRatio <= 0) {
      return;
    }
    this.pruneAckSet(rows);
    const pending = rows.filter(
      (row) =>
        row.short_pct_change >= thresholdRatio && !this.ackSet.has(row.symbol)
    );
    if (pending.length === 0) {
      return;
    }
    this.renderAlertList(pending);
    this.show();
    this.startToneLoop();
    this.sendBackgroundNotification(pending);
    this.attachAckHandler(() => {
      pending.forEach((row) => this.ackSet.add(row.symbol));
      this.saveAckSet();
      this.hide();
    });
  }

  show() {
    this.overlay.classList.remove("hidden");
    document.body.classList.add("alert-active");
  }

  hide() {
    this.overlay.classList.add("hidden");
    document.body.classList.remove("alert-active");
    this.stopToneLoop();
    if (this.pendingHandler) {
      this.ackButton.removeEventListener("click", this.pendingHandler);
      this.pendingHandler = null;
    }
  }

  renderAlertList(rows) {
    if (!this.list) return;
    this.list.innerHTML = rows
      .map(
        (row) =>
          `<li><strong>${row.symbol}</strong> 短期涨幅 ${(
            row.short_pct_change * 100
          ).toFixed(2)}%</li>`
      )
      .join("");
  }

  attachAckHandler(handler) {
    if (!this.ackButton) return;
    if (this.pendingHandler) {
      this.ackButton.removeEventListener("click", this.pendingHandler);
    }
    this.pendingHandler = handler;
    this.ackButton.addEventListener("click", this.pendingHandler);
  }

  resumeToneIfNeeded() {
    if (!this.overlay || this.overlay.classList.contains("hidden")) {
      return;
    }
    this.startToneLoop();
  }

  startToneLoop() {
    if (!this.soundEnabled || this.toneTimer) {
      return;
    }
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      const playOnce = () => {
        const duration = 0.6;
        const oscillator = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();
        oscillator.type = "sawtooth";
        oscillator.frequency.setValueAtTime(880, this.audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.0001, this.audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(
          0.25,
          this.audioCtx.currentTime + 0.04
        );
        gainNode.gain.exponentialRampToValueAtTime(
          0.0001,
          this.audioCtx.currentTime + duration
        );
        oscillator.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);
        oscillator.start();
        oscillator.stop(this.audioCtx.currentTime + duration);
      };
      playOnce();
      this.toneTimer = setInterval(playOnce, 800);
    } catch (err) {
      console.warn("系统提醒音播放失败", err);
    }
  }

  stopToneLoop() {
    if (this.toneTimer) {
      clearInterval(this.toneTimer);
      this.toneTimer = null;
    }
  }

  sendBackgroundNotification(rows) {
    if (!document.hidden) {
      return;
    }
    if (!("Notification" in window)) {
      return;
    }
    if (Notification.permission === "granted") {
      new Notification("短期涨幅预警", {
        body: rows
          .map(
            (row) => `${row.symbol}: ${(row.short_pct_change * 100).toFixed(2)}%`
          )
          .join("\n"),
        tag: "short-term-alert",
        renotify: true,
      });
    } else if (Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  pruneAckSet(rows) {
    const currentSymbols = new Set(rows.map((row) => row.symbol));
    let mutated = false;
    for (const symbol of Array.from(this.ackSet)) {
      if (!currentSymbols.has(symbol)) {
        this.ackSet.delete(symbol);
        mutated = true;
      }
    }
    if (mutated) {
      this.saveAckSet();
    }
  }

  loadAckSet() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(CONFIG.alertAckKey) || "[]"
      );
      if (Array.isArray(saved)) {
        return new Set(saved);
      }
    } catch (_) {
      // ignore
    }
    return new Set();
  }

  saveAckSet() {
    localStorage.setItem(
      CONFIG.alertAckKey,
      JSON.stringify(Array.from(this.ackSet))
    );
  }
}

class MonitorApp {
  constructor() {
    this.tickers = new Map();
    this.websocket = null;
    this.reconnectDelay = 1000;
    this.settingsState = { ...CONFIG.defaults };

    this.tableRenderer = new TableRenderer({
      longBody: document.getElementById("long-table-body"),
      shortBody: document.getElementById("short-table-body"),
    });

    this.alertManager = new AlertManager({
      overlay: document.getElementById("alert-overlay"),
      list: document.querySelector("#alert-overlay .alert-list"),
      ackButton: document.getElementById("alert-ack"),
    });

    this.priceHistory = new PriceHistoryStore();

    this.handleSettingsChange = this.handleSettingsChange.bind(this);
    this.settingsManager = new SettingsManager({
      form: document.getElementById("settings-form"),
      labels: {
        shortWindowText: document.getElementById("short-window-text"),
        shortLimitText: document.getElementById("short-limit-text"),
        shortWindowHeader: document.getElementById("short-window-header"),
        alertThresholdLabel: document.getElementById("alert-threshold-label"),
      },
      onChange: this.handleSettingsChange,
    });
  }

  init() {
    this.priceHistory.hydrate();
    this.settingsManager.init();
    this.settingsState = this.settingsManager.getState();
    this.alertManager.setSoundEnabled(this.settingsState.shortSound);
    this.render();
    this.connectWebSocket();
    document.addEventListener("visibilitychange", () =>
      this.handleVisibilityChange()
    );
    window.addEventListener("beforeunload", () => this.priceHistory.flush());
  }

  handleSettingsChange(state) {
    this.settingsState = state;
    this.alertManager.setSoundEnabled(state.shortSound);
    this.render();
  }

  handleVisibilityChange() {
    if (document.hidden) {
      this.priceHistory.flush();
    } else {
      this.alertManager.resumeToneIfNeeded();
    }
  }

  connectWebSocket() {
    this.websocket = new WebSocket(CONFIG.wsUrl);
    this.websocket.addEventListener("open", () => {
      this.websocket.send(JSON.stringify(CONFIG.streamPayload));
      this.reconnectDelay = 1000;
    });
    this.websocket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (
          payload.stream === "!miniTicker@arr" &&
          Array.isArray(payload.data)
        ) {
          this.handleTickerBatch(payload.data);
        }
      } catch (err) {
        console.error("解析行情数据失败", err);
      }
    });
    const scheduleReconnect = () => this.scheduleReconnect();
    this.websocket.addEventListener("close", scheduleReconnect);
    this.websocket.addEventListener("error", scheduleReconnect);
  }

  scheduleReconnect() {
    if (this.websocket) {
      try {
        this.websocket.close();
      } catch (_) {
        // ignore
      }
    }
    setTimeout(() => this.connectWebSocket(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 15000);
  }

  handleTickerBatch(payload) {
    for (const entry of payload) {
      const symbol = entry.s;
      const lastPrice = Number(entry.c);
      const openPrice = Number(entry.o);
      if (
        !symbol ||
        !Number.isFinite(lastPrice) ||
        !Number.isFinite(openPrice) ||
        openPrice === 0
      ) {
        continue;
      }
      const pctChange = (lastPrice - openPrice) / openPrice;
      this.tickers.set(symbol, {
        symbol,
        last_price: lastPrice,
        open_price: openPrice,
        pct_change: pctChange,
        volume: Number(entry.v),
        quote_volume: Number(entry.q),
      });
      this.priceHistory.record(symbol, lastPrice, entry.E);
    }
    this.render();
  }

  getLongTermRows() {
    return Array.from(this.tickers.values()).sort(
      (a, b) => (b.pct_change ?? -Infinity) - (a.pct_change ?? -Infinity)
    );
  }

  getShortTermRows() {
    const nowMinute = Math.floor(Date.now() / CONFIG.minuteMs);
    const targetMinute = nowMinute - this.settingsState.shortWindow;
    const rows = [];
    for (const [symbol, ticker] of this.tickers.entries()) {
      const historyEntry = this.priceHistory.getEntry(symbol, targetMinute);
      if (!historyEntry || !Number.isFinite(historyEntry.price) || historyEntry.price === 0) {
        continue;
      }
      const referenceTimestamp = Number.isFinite(historyEntry.lastUpdatedAt)
        ? historyEntry.lastUpdatedAt
        : historyEntry.minute * CONFIG.minuteMs;
      const change = (ticker.last_price - historyEntry.price) / historyEntry.price;
      rows.push({
        symbol,
        last_price: ticker.last_price,
        reference_price: historyEntry.price,
        short_pct_change: change,
        history_timestamp: referenceTimestamp,
        history_age_minutes: this.priceHistory.getAgeMinutes(historyEntry),
      });
    }
    rows.sort(
      (a, b) =>
        (b.short_pct_change ?? -Infinity) - (a.short_pct_change ?? -Infinity)
    );
    return rows.slice(0, this.settingsState.shortLimit);
  }

  render() {
    if (!this.settingsState) return;
    const longRows = this.getLongTermRows();
    this.tableRenderer.renderLong(longRows);
    const shortRows = this.getShortTermRows();
    this.tableRenderer.renderShort(shortRows, this.settingsState.shortThreshold);
    this.alertManager.maybeShow(shortRows, this.settingsState);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new MonitorApp();
  app.init();
});
