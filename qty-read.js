// #1002(대표 11/3): 중간발주 이미지 → 「품목 이름 · 수량」 줄 목록 + 그림의 합계 숫자 (공개 길 · 거래처 차이 표 화면 public/qty-diff.html 이 씀)
//   POST /api/public/qty-read  { image: "data:image/jpeg;base64,…" }  →  { ok, items:[{name,qty,check?}], total, read_sum, mismatch, ms }
//   · 저장 0 · DB 쓰기 0 · 그림·읽은 글 로그 0(실패 종류만 한 줄) · 그림 5MB 상한 · 그림 꼴(JPEG·PNG·WEBP) 머리 바이트로 확인
//   · 남용 막기 = 접속자(IP)당 시간당 30 · 전체 하루 300(KST) · 메모리 셈(재시작 때 0)
//   · 이름 = 「후보 이름표」(품목별 금액 대성 거래처 · 지난 품목 포함 전부 · 최근 기간 먼저 · 품목 이름만 · 5분 기억)를 AI 에 줌 →
//     목록에 없는 이름은 버리지 않음: 글자 1~2개 차이 + 숫자(kg·과수) 같음 + 가장 가까운 것 하나뿐이면 목록 이름으로, 아니면 읽은 그대로(새 품목)
//   · AI = 정산 이미지 판독(#396 settleOcrRead)과 같은 꼴: 도구 호출 → 잘림·0줄·태그 오염이면 평문 JSON 한 번 더
//   · 모델 = env QTY_READ_MODEL 없으면 claude-sonnet-5-5(마루 모델과 따로)
'use strict';

const IP_PER_HOUR = 30;
const ALL_PER_DAY = 300;
const MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const PARTNER_LIKE = '대성%';
const NAMES_TTL = 5 * 60 * 1000;

const TOOL = {
    name: 'read_qty_table',
    description: '중간발주 수량 표 그림에서 품목 줄과 맨 아래 합계 숫자를 읽는다',
    input_schema: {
        type: 'object', additionalProperties: false,
        properties: {
            items: {
                type: 'array', description: '품목 줄 전부(위에서 아래 순서 · 합계 줄 제외)',
                items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                        name: { type: 'string', description: '품목 이름 — 후보 목록이 있으면 그 목록의 이름 하나를 글자 그대로(꼬리 빼고)' },
                        tail: { type: 'string', description: '이름 뒤 꼬리(예: 「M사이즈로!」 「2S사이즈로!」 「20과로!」) · 없으면 빈 글자' },
                        qty: { type: 'integer', description: '오른쪽 칸 수량' },
                    },
                    required: ['name', 'tail', 'qty'],
                },
            },
            total: { type: ['integer', 'null'], description: '맨 아래 이름 칸이 빈 합계 줄의 숫자 · 없으면 null' },
        },
        required: ['items', 'total'],
    },
};
function prompt(names) {
    let t = '이 그림은 「품목 이름 | 수량」 두 칸 표다. 모든 품목 줄을 위에서 아래 순서로 빠짐없이 읽어라(같은 이름이라도 꼬리가 다르면 다른 줄). 이름 뒤 꼬리(예: 「M사이즈로!」 「20과로!」)는 tail 칸에 따로 넣어라. 맨 아래 이름 칸이 빈 합계 줄은 items 에 넣지 말고 그 숫자를 total 에 넣어라. 칸이 잘려 이름 뒤가 안 보여도 보이는 앞부분으로 목록에서 고르고, 잘린 꼬리는 보이는 글자로 짐작해라.';
    if (names && names.length) t += '\n\n아래는 이 거래처의 품목 이름 목록이다. 그림 글자가 목록 이름과 같으면 목록 글자 그대로 써라(띄어쓰기·기호까지). 목록에 없는 품목(새 품목)은 그림 글자 그대로 써라. kg·과수 숫자는 반드시 그림대로:\n' + names.map(n => '- ' + n).join('\n');
    return t + '\n\nread_qty_table 도구로 답하라.';
}

// ===== 이름 맞추기 =====
const keyOf = s => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '').replace(/[∼〜～]/g, '~').replace(/[‐-―−]/g, '-');
const digitsOf = s => (keyOf(s).match(/\d+/g) || []).join(',');
function lev(a, b) {   // 글자 차이 수(2 넘으면 99)
    if (a === b) return 0; if (Math.abs(a.length - b.length) > 2) return 99;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i]; let rowMin = i;
        for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < rowMin) rowMin = cur[j]; }
        if (rowMin > 2) return 99; prev = cur;
    }
    return prev[b.length];
}
// 읽은 이름 → 목록 이름(같거나 · 글자 1~2개 차이 + 숫자 같음 + 가장 가까운 것 하나뿐) · 아니면 읽은 그대로(새 품목 · 확인 표시 없음)
function snapName(raw, names) {
    const r = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!names || !names.length) return { name: r, snapped: false };
    const k = keyOf(r);
    const exact = names.find(n => keyOf(n) === k);
    if (exact) return { name: exact, snapped: false };
    const d = digitsOf(r);
    const near = names.filter(n => digitsOf(n) === d).map(n => ({ n, e: lev(keyOf(n), k) })).filter(x => x.e <= 2).sort((x, y) => x.e - y.e);
    if (near.length && (near.length === 1 || near[0].e < near[1].e)) return { name: near[0].n, snapped: true };
    return { name: r, snapped: false };
}
const TAIL_OK = /^((2S|S|M|L|2L|3L)사이즈로|\d{1,3}과로)!?$/i;
function cleanItems(raw, names) {
    return (raw && Array.isArray(raw.items) ? raw.items : []).slice(0, 300).map(x => {
        const q = Number(x && x.qty);
        let nm = String((x && x.name) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        let tail = String((x && x.tail) || '').normalize('NFKC').replace(/\s+/g, '').slice(0, 30);
        if (!tail) { const m = nm.match(/\s((?:2S|S|M|L|2L|3L)사이즈로!?|\d{1,3}과로!?)$/i); if (m) { tail = m[1]; nm = nm.slice(0, -m[0].length).trim(); } }
        if (!nm || !Number.isInteger(q) || q < 0 || q >= 100000) return null;
        const s = snapName(nm, names);
        if (tail && !/!$/.test(tail) && TAIL_OK.test(tail)) tail += '!';
        return { name: s.name + (tail ? ' ' + tail : ''), qty: q };
    }).filter(Boolean);
}
function sniff(buf) {
    if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
    if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png';
    if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    return null;
}

function mount(app, deps) {
    const { Anthropic, pool, clientIp } = deps;
    const model = deps.model || DEFAULT_MODEL;
    const ipHits = new Map();          // ip → [시각…] (한 시간 창)
    let day = { key: '', n: 0 };       // KST 날짜 · 그날 전체 횟수
    const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    let namesMemo = { at: 0, list: [] };

    function allow(ip) {
        const now = Date.now();
        if (ipHits.size > 5000) for (const [k, v] of ipHits) if (!v.length || now - v[v.length - 1] > 3600e3) ipHits.delete(k);
        const arr = (ipHits.get(ip) || []).filter(t => now - t < 3600e3);
        const k = kstDay(); if (day.key !== k) day = { key: k, n: 0 };
        if (arr.length >= IP_PER_HOUR) return 'ip';
        if (day.n >= ALL_PER_DAY) return 'day';
        arr.push(now); ipHits.set(ip, arr); day.n++;
        return '';
    }
    // 후보 이름표 = 품목별 금액(대성) 최근 60일 기간의 품목 이름만(가격·박스 칸은 안 읽음) · 실패하면 빈 목록(이름 맞추기 없이 그대로)
    async function candidateNames() {
        if (Date.now() - namesMemo.at < NAMES_TTL) return namesMemo.list;
        let list = [];
        try {
            if (pool) {
                const r = await pool.query(`SELECT x->>'name' AS name, MAX(p.end_date) AS e FROM pricing p, jsonb_array_elements(p.items) x
                    WHERE p.partner LIKE $1 AND COALESCE(x->>'name','') <> '' GROUP BY 1 ORDER BY 2 DESC, 1`, [PARTNER_LIKE]);
                list = r.rows.map(x => String(x.name).trim()).filter(Boolean).slice(0, 200);
            }
        } catch (e) { console.warn('[qty-read] 후보 이름표 못 읽음:', (e && e.code) || 'error'); }
        namesMemo = { at: Date.now(), list };
        return list;
    }

    async function readOnce(client, mime, b64, names, plain) {
        const content = [{ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
            { type: 'text', text: prompt(names) + (plain ? '\n다른 설명·마크업 없이 JSON 객체 하나만 출력하라: {"items":[{"name":"이름","tail":"꼬리 또는 빈 글자","qty":숫자}],"total":숫자 또는 null}' : '') }];
        const req = { model, max_tokens: 8000, messages: [{ role: 'user', content }] };
        if (!plain) { req.tools = [TOOL]; req.tool_choice = { type: 'auto' }; }   // sonnet-5-5 = 도구 강제(tool·any) 안 받음 → auto + 글로 지시 · 안 부르면 평문으로 한 번 더
        const msg = await client.messages.create(req);
        let raw = null;
        if (!plain) { const tu = (msg.content || []).find(b => b.type === 'tool_use'); raw = tu ? tu.input : null; }
        else { const t = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n'); const m = t.match(/\{[\s\S]*\}/); try { raw = m ? JSON.parse(m[0]) : null; } catch (_) { raw = null; } }
        return { raw, stop: msg.stop_reason || null, usage: msg.usage || {} };
    }

    app.post('/api/public/qty-read', async (req, res) => {
        const t0 = Date.now();
        try {
            const img = String((req.body && req.body.image) || '');
            const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(img);
            if (!m) return res.status(400).json({ ok: false, error: '그림(JPEG·PNG)만 넣어 주세요.' });
            if (m[2].length > Math.ceil(MAX_BYTES / 3) * 4 + 4) return res.status(413).json({ ok: false, error: '그림이 너무 커요(5MB 까지).' });
            const buf = Buffer.from(m[2], 'base64');
            if (buf.length > MAX_BYTES) return res.status(413).json({ ok: false, error: '그림이 너무 커요(5MB 까지).' });
            const mime = sniff(buf);
            if (!mime) return res.status(400).json({ ok: false, error: '그림 파일이 아니에요. 다시 넣어 주세요.' });
            const lim = allow(clientIp(req));
            if (lim) return res.status(429).json({ ok: false, error: lim === 'ip' ? '잠깐 너무 많이 읽었어요. 한 시간 뒤 다시 넣어 주세요.' : '오늘 읽기 횟수를 다 썼어요. 표를 글로 넣어 주세요.' });
            if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ ok: false, error: '지금은 그림 읽기를 쓸 수 없어요. 표를 글로 넣어 주세요.' });
            const names = await candidateNames();
            const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
            const b64 = buf.toString('base64');
            let att = await readOnce(client, mime, b64, names, false);
            let items = cleanItems(att.raw, names);
            const polluted = /antml|<\s*\/?\s*parameter/i.test(JSON.stringify(att.raw || ''));
            let usage = { in: att.usage.input_tokens || 0, out: att.usage.output_tokens || 0 };
            if (att.stop === 'max_tokens' || !items.length || polluted) {
                console.warn(`[qty-read] 도구 경로 이상 → 평문: stop=${att.stop} items=${items.length} polluted=${polluted}`);
                const p = await readOnce(client, mime, b64, names, true);
                usage = { in: usage.in + (p.usage.input_tokens || 0), out: usage.out + (p.usage.output_tokens || 0) };
                const pi = cleanItems(p.raw, names);
                if (p.stop !== 'max_tokens' && pi.length) { att = p; items = pi; } else if (polluted) items = [];
            }
            if (!items.length) return res.status(422).json({ ok: false, error: '표를 못 읽었어요. 다시 넣어 주세요.' });
            const total = Number.isInteger(att.raw && att.raw.total) ? att.raw.total : null;
            const readSum = items.reduce((s, x) => s + x.qty, 0);
            res.json({ ok: true, items, total, read_sum: readSum, mismatch: total !== null && total !== readSum, names: names.length, ms: Date.now() - t0, usage, model });
        } catch (e) {
            console.warn('[qty-read] 실패:', (e && (e.status || e.name)) || 'error');
            if (!res.headersSent) res.status(502).json({ ok: false, error: '읽기에 실패했어요. 다시 넣어 주세요.' });
        }
    });
}

module.exports = { mount, _t: { sniff, cleanItems, snapName, keyOf, IP_PER_HOUR, ALL_PER_DAY, DEFAULT_MODEL } };
