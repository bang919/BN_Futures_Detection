from flask import Flask, render_template_string

app = Flask(__name__)

HTML_TEMPLATE = """
<!doctype html>
<html lang=\"zh\">
<head>
    <meta charset=\"utf-8\">
    <title>币安合约实时监控</title>
    <style>
        body { font-family: system-ui, sans-serif; margin: 40px; background: #fafafa; color: #111; }
        h1 { margin-top: 0; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #e5e5e5; padding: 8px; text-align: right; }
        th { background-color: #f4f4f4; }
        td.symbol { text-align: left; font-weight: 600; }
        tr:hover { background-color: #f9f9f9; }
        .positive { color: #0a7d00; }
        .negative { color: #b30000; }
        .alert-cell { background: #fee2e2; color: #b91c1c; font-weight: 700; }
        .dashboard { display: flex; flex-wrap: wrap; gap: 24px; }
        .panel { background: #fff; border: 1px solid #e1e1e1; border-radius: 12px; padding: 24px; flex: 1 1 420px; box-shadow: 0 10px 25px rgba(0,0,0,0.04); }
        .panel h2 { margin-top: 0; }
        .settings { margin-top: 24px; border-top: 1px solid #eee; padding-top: 16px; }
        .settings h3 { margin-top: 0; }
        .settings-form { display: flex; flex-direction: column; gap: 16px; }
        .settings-form label { font-weight: 600; margin-bottom: 4px; display: inline-block; text-align: left; }
        .settings-form select,
        .settings-form input { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; }
        .settings-form button { padding: 10px 16px; border: none; border-radius: 6px; background: #2563eb; color: #fff; font-weight: 600; cursor: pointer; }
        .settings-form button:hover { background: #1d4ed8; }
        .alert-overlay { position: fixed; inset: 0; background: rgba(255, 0, 0, 0.25); display: flex; align-items: center; justify-content: center; z-index: 999; }
        .alert-overlay.hidden { display: none; }
        .alert-modal { background: #fff; border-radius: 12px; padding: 24px; width: min(420px, 90%); text-align: center; box-shadow: 0 15px 35px rgba(0,0,0,0.25); }
        .alert-list { text-align: left; margin: 12px 0; }
        .alert-modal button { margin-top: 12px; padding: 10px 16px; border: none; border-radius: 6px; background: #dc2626; color: #fff; font-weight: 600; cursor: pointer; }
        body.alert-active { animation: flash-bg 1s linear infinite; }
        @keyframes flash-bg {
            0% { background-color: #fafafa; }
            50% { background-color: #ffe5e5; }
            100% { background-color: #fafafa; }
        }
        .placeholder { text-align: center; color: #666; padding: 24px 0; }
    </style>
</head>
<body>
    <h1>币安合约实时监控看板</h1>
    <div id=\"alert-overlay\" class=\"alert-overlay hidden\">
        <div class=\"alert-modal\">
            <h3>短期升幅预警</h3>
            <p>以下交易对的短期升幅已超过 <span id=\"alert-threshold-label\">{{ short_threshold }}</span>%。</p>
            <ul class=\"alert-list\"></ul>
            <button id=\"alert-ack\">知道了</button>
        </div>
    </div>

    <div class=\"dashboard\">
        <section class=\"panel\">
            <h2>24 小时涨幅榜</h2>
            <p>按 24 小时升幅排序，实时展示合约行情。</p>
            <table>
                <thead>
                    <tr>
                        <th>交易对</th>
                        <th>最新价</th>
                        <th>开盘价</th>
                        <th>24 小时升幅</th>
                        <th>成交量</th>
                        <th>成交额</th>
                    </tr>
                </thead>
                <tbody id=\"long-table-body\">
                    <tr><td class=\"placeholder\" colspan=\"6\">等待行情数据…</td></tr>
                </tbody>
            </table>
        </section>

        <section class=\"panel\">
            <h2>短期涨幅榜</h2>
            <p id=\"short-desc\">按最近 <span id=\"short-window-text\">{{ short_window }}</span> 分钟升幅排序，展示前 <span id=\"short-limit-text\">{{ short_limit }}</span> 个交易对。</p>
            <table>
                <thead>
                    <tr>
                        <th>交易对</th>
                        <th>最新价</th>
                        <th><span id=\"short-window-header\">{{ short_window }}</span> 分钟前</th>
                        <th>短期升幅</th>
                    </tr>
                </thead>
                <tbody id=\"short-table-body\">
                    <tr><td class=\"placeholder\" colspan=\"4\">等待行情数据…</td></tr>
                </tbody>
            </table>

            <div class=\"settings\">
                <h3>设置</h3>
                <form class=\"settings-form\" id=\"settings-form\">
                    <div>
                        <label for=\"short_window\">设置时长监听</label>
                        <select id=\"short_window\" name=\"short_window\">
                            <option value=\"1\" {% if short_window == 1 %}selected{% endif %}>1 分钟</option>
                            <option value=\"2\" {% if short_window == 2 %}selected{% endif %}>2 分钟</option>
                            <option value=\"5\" {% if short_window == 5 %}selected{% endif %}>5 分钟</option>
                        </select>
                    </div>
                    <div>
                        <label for=\"short_limit\">短期涨幅榜显示数量</label>
                        <input id=\"short_limit\" type=\"number\" min=\"1\" max=\"50\" name=\"short_limit\" value=\"{{ short_limit }}\">
                    </div>
                    <div>
                        <label for=\"short_threshold\">短期升幅预警阈值 (%)</label>
                        <input id=\"short_threshold\" type=\"number\" min=\"0.1\" max=\"100\" step=\"0.1\" name=\"short_threshold\" value=\"{{ '{:.1f}'.format(short_threshold) }}\">
                    </div>
                    <div>
                        <label for=\"short_sound\">是否打开预警声音</label>
                        <select id=\"short_sound\" name=\"short_sound\">
                            <option value=\"1\" {% if short_sound_enabled %}selected{% endif %}>开启</option>
                            <option value=\"0\" {% if not short_sound_enabled %}selected{% endif %}>关闭</option>
                        </select>
                    </div>
                    <button type=\"submit\">保存设置</button>
                </form>
            </div>
        </section>
    </div>

    <script>
    const SETTINGS_KEY = 'shortSettings_v1';
    const DEFAULT_SETTINGS = {
        shortWindow: {{ short_window }},
        shortLimit: {{ short_limit }},
        shortThreshold: {{ short_threshold }},
        shortSound: {{ 'true' if short_sound_enabled else 'false' }},
    };
    let settings = null;
    const MAX_HISTORY_MINUTES = 5;
    const WS_URL = 'wss://fstream.binance.com/stream';
    const SUB_MESSAGE = {
        method: 'SUBSCRIBE',
        params: ['!miniTicker@arr'],
        id: 1,
    };

    const tickerMap = new Map();
    const priceHistory = new Map();

    const longTableBody = document.getElementById('long-table-body');
    const shortTableBody = document.getElementById('short-table-body');
    const shortWindowText = document.getElementById('short-window-text');
    const shortLimitText = document.getElementById('short-limit-text');
    const shortWindowHeader = document.getElementById('short-window-header');
    const overlay = document.getElementById('alert-overlay');
    const alertList = overlay.querySelector('.alert-list');
    const alertThresholdLabel = document.getElementById('alert-threshold-label');
    const alertAckButton = document.getElementById('alert-ack');
    const ALERT_STORAGE_KEY = 'shortAlertAck_v2';
    const settingsForm = document.getElementById('settings-form');
    let websocket;
    let reconnectDelay = 1000;
    let audioCtx;
    let alertToneTimer = null;

    function formatPrice(value) {
        if (!isFinite(value)) return '-';
        return Number(value).toFixed(6);
    }

    function formatNumber(value) {
        if (!isFinite(value)) return '-';
        return Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
    }

    function formatPercent(value) {
        if (!isFinite(value)) return '-';
        return (value * 100).toFixed(2) + '%';
    }

    function recordHistory(symbol, price, eventTime) {
        if (!isFinite(price)) return;
        const timestamp = typeof eventTime === 'number' ? eventTime : Date.now();
        const minuteKey = Math.floor(timestamp / 60000);
        const entries = priceHistory.get(symbol) || [];
        const existingIndex = entries.findIndex(item => item.minute === minuteKey);
        if (existingIndex >= 0) {
            entries[existingIndex].price = price;
        } else {
            entries.push({ minute: minuteKey, price });
        }
        const cutoff = minuteKey - MAX_HISTORY_MINUTES;
        const filtered = entries.filter(item => item.minute >= cutoff);
        priceHistory.set(symbol, filtered);
    }

    function handleTickerPayload(payload) {
        for (const entry of payload) {
            const symbol = entry.s;
            const lastPrice = Number(entry.c);
            const openPrice = Number(entry.o);
            if (!symbol || !isFinite(lastPrice) || !isFinite(openPrice) || openPrice === 0) {
                continue;
            }
            const pctChange = (lastPrice - openPrice) / openPrice;
            tickerMap.set(symbol, {
                symbol,
                last_price: lastPrice,
                open_price: openPrice,
                pct_change: pctChange,
                volume: Number(entry.v),
                quote_volume: Number(entry.q),
            });
            recordHistory(symbol, lastPrice, entry.E);
        }
        renderTables();
    }

    function getLongTermRows() {
        return Array.from(tickerMap.values()).sort((a, b) => (b.pct_change ?? -Infinity) - (a.pct_change ?? -Infinity));
    }

    function getShortTermRows() {
        const nowMinute = Math.floor(Date.now() / 60000);
        const targetMinute = nowMinute - settings.shortWindow;
        const rows = [];
        for (const [symbol, row] of tickerMap.entries()) {
            const history = priceHistory.get(symbol);
            if (!history) continue;
            const target = history.find(item => item.minute === targetMinute);
            if (!target || !isFinite(target.price) || target.price === 0) continue;
            const change = (row.last_price - target.price) / target.price;
            rows.push({
                symbol,
                last_price: row.last_price,
                reference_price: target.price,
                short_pct_change: change,
            });
        }
        rows.sort((a, b) => (b.short_pct_change ?? -Infinity) - (a.short_pct_change ?? -Infinity));
        return rows.slice(0, settings.shortLimit);
    }

    function renderTables() {
        const longRows = getLongTermRows();
        if (longRows.length === 0) {
            longTableBody.innerHTML = '<tr><td class="placeholder" colspan="6">等待行情数据…</td></tr>';
        } else {
            longTableBody.innerHTML = longRows
                .map(row => {
                    const cls = row.pct_change >= 0 ? 'positive' : 'negative';
                    return `
                        <tr>
                            <td class="symbol">${row.symbol}</td>
                            <td>${formatPrice(row.last_price)}</td>
                            <td>${formatPrice(row.open_price)}</td>
                            <td class="${cls}">${formatPercent(row.pct_change)}</td>
                            <td>${formatNumber(row.volume)}</td>
                            <td>${formatNumber(row.quote_volume)}</td>
                        </tr>
                    `;
                })
                .join('');
        }

        const shortRows = getShortTermRows();
        if (shortRows.length === 0) {
            shortTableBody.innerHTML = '<tr><td class="placeholder" colspan="4">短期数据尚未准备好…</td></tr>';
        } else {
            shortTableBody.innerHTML = shortRows
                .map(row => {
                    const cls = row.short_pct_change >= 0 ? 'positive' : 'negative';
                    const isAlert = settings.shortThreshold > 0 && row.short_pct_change >= (settings.shortThreshold / 100);
                    return `
                        <tr>
                            <td class="symbol">${row.symbol}</td>
                            <td>${formatPrice(row.last_price)}</td>
                            <td>${formatPrice(row.reference_price)}</td>
                            <td class="${isAlert ? 'alert-cell' : cls}">${formatPercent(row.short_pct_change)}</td>
                        </tr>
                    `;
                })
                .join('');
        }
        maybeShowAlert(shortRows);
    }

    function getAckSet() {
        try {
            const saved = JSON.parse(localStorage.getItem(ALERT_STORAGE_KEY) || '[]');
            if (Array.isArray(saved)) {
                return new Set(saved);
            }
        } catch (_) {
            // ignore
        }
        return new Set();
    }

    function saveAckSet(set) {
        localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(Array.from(set)));
    }

    function maybeShowAlert(shortRows) {
        const thresholdRatio = settings.shortThreshold / 100;
        if (!isFinite(thresholdRatio) || thresholdRatio <= 0) {
            return;
        }
        const ackSet = pruneAckSet(shortRows);
        const pending = shortRows.filter(row => row.short_pct_change >= thresholdRatio && !ackSet.has(row.symbol));
        if (pending.length === 0) {
            return;
        }
        alertList.innerHTML = pending
            .map(row => `<li><strong>${row.symbol}</strong> 短期升幅 ${ (row.short_pct_change * 100).toFixed(2) }%</li>`)
            .join('');
        overlay.classList.remove('hidden');
        document.body.classList.add('alert-active');
        startAlertToneLoop();
        sendBackgroundNotification(pending);

        const acknowledge = () => {
            pending.forEach(row => ackSet.add(row.symbol));
            saveAckSet(ackSet);
            overlay.classList.add('hidden');
            document.body.classList.remove('alert-active');
            stopAlertToneLoop();
            alertAckButton.removeEventListener('click', acknowledge);
        };

        alertAckButton.addEventListener('click', acknowledge);
    }

    function pruneAckSet(shortRows) {
        const ackSet = getAckSet();
        const currentSymbols = new Set(shortRows.map(row => row.symbol));
        let mutated = false;
        for (const symbol of Array.from(ackSet)) {
            if (!currentSymbols.has(symbol)) {
                ackSet.delete(symbol);
                mutated = true;
            }
        }
        if (mutated) {
            saveAckSet(ackSet);
        }
        return ackSet;
    }

    function connectWebSocket() {
        websocket = new WebSocket(WS_URL);
        websocket.addEventListener('open', () => {
            websocket.send(JSON.stringify(SUB_MESSAGE));
            reconnectDelay = 1000;
        });
        websocket.addEventListener('message', event => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.stream === '!miniTicker@arr' && Array.isArray(payload.data)) {
                    handleTickerPayload(payload.data);
                }
            } catch (err) {
                console.error('解析行情数据失败', err);
            }
        });
        websocket.addEventListener('close', scheduleReconnect);
        websocket.addEventListener('error', scheduleReconnect);
    }

    function scheduleReconnect() {
        if (websocket) {
            websocket.close();
        }
        setTimeout(connectWebSocket, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
    }

    function startAlertToneLoop() {
        if (!settings.shortSound) {
            return;
        }
        if (alertToneTimer) {
            return;
        }
        try {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            const playOnce = () => {
                const duration = 0.6;
                const oscillator = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                oscillator.type = 'sawtooth';
                oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
                gainNode.gain.setValueAtTime(0.0001, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.04);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
                oscillator.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                oscillator.start();
                oscillator.stop(audioCtx.currentTime + duration);
            };
            playOnce();
            alertToneTimer = setInterval(playOnce, 800);
        } catch (err) {
            console.warn('系统提醒音播放失败', err);
        }
    }

    function sendBackgroundNotification(pending) {
        if (!document.hidden) {
            return;
        }
        if (!('Notification' in window)) {
            return;
        }
        if (Notification.permission === 'granted') {
            new Notification('短期升幅预警', {
                body: pending
                    .map(row => `${row.symbol}: ${(row.short_pct_change * 100).toFixed(2)}%`)
                    .join('\\n'),
                tag: 'short-term-alert',
                renotify: true,
            });
        } else if (Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    function stopAlertToneLoop() {
        if (alertToneTimer) {
            clearInterval(alertToneTimer);
            alertToneTimer = null;
        }
    }

    function clampWindow(value) {
        return [1, 2, 5].includes(value) ? value : 1;
    }

    function clampLimit(value) {
        return Math.max(1, Math.min(value, 50));
    }

    function clampThreshold(value) {
        return Math.max(0.1, Math.min(value, 100));
    }

    function loadSettings() {
        try {
            const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
            if (raw && typeof raw === 'object') {
                return {
                    shortWindow: clampWindow(Number(raw.shortWindow) || DEFAULT_SETTINGS.shortWindow),
                    shortLimit: clampLimit(Number(raw.shortLimit) || DEFAULT_SETTINGS.shortLimit),
                    shortThreshold: clampThreshold(Number(raw.shortThreshold) || DEFAULT_SETTINGS.shortThreshold),
                    shortSound: normalizeSoundValue('shortSound' in raw ? raw.shortSound : DEFAULT_SETTINGS.shortSound),
                };
            }
        } catch (err) {
            console.warn('加载本地设置失败，使用默认值', err);
        }
        return { ...DEFAULT_SETTINGS };
    }

    function normalizeSoundValue(value) {
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'number') {
            return value !== 0;
        }
        if (typeof value === 'string') {
            const lowered = value.toLowerCase();
            return !['0', 'false', 'off', 'no'].includes(lowered);
        }
        return Boolean(value);
    }

    function saveSettings() {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    function syncFormWithSettings() {
        settingsForm.short_window.value = String(settings.shortWindow);
        settingsForm.short_limit.value = String(settings.shortLimit);
        settingsForm.short_threshold.value = settings.shortThreshold.toFixed(1);
        settingsForm.short_sound.value = settings.shortSound ? '1' : '0';
        shortWindowText.textContent = settings.shortWindow;
        shortLimitText.textContent = settings.shortLimit;
        shortWindowHeader.textContent = settings.shortWindow;
        alertThresholdLabel.textContent = settings.shortThreshold.toFixed(1);
    }

    settingsForm.addEventListener('submit', (event) => {
        event.preventDefault();
        settings.shortWindow = clampWindow(Number(settingsForm.short_window.value));
        settings.shortLimit = clampLimit(Number(settingsForm.short_limit.value));
        settings.shortThreshold = clampThreshold(Number(settingsForm.short_threshold.value));
        settings.shortSound = settingsForm.short_sound.value === '1';
        saveSettings();
        syncFormWithSettings();
        renderTables();
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && !overlay.classList.contains('hidden')) {
            startAlertToneLoop();
        }
    });

    settings = loadSettings();
    syncFormWithSettings();
    connectWebSocket();
    </script>
</body>
</html>
"""


@app.route("/")
def index():
    return render_template_string(
        HTML_TEMPLATE,
        short_window=1,
        short_limit=10,
        short_threshold=5.0,
        short_sound_enabled=True,
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
