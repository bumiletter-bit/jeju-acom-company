// #821 계산서 정리(자동) 검증 — 실DB·실메일·러너 0
//   ①~③ server.js 의 「#821 계산서 정리(자동)」 구간(+ 대표 계정 고르기용 #581 구간)을 떼어 가짜 pool 로 틱 논리
//   ④ 창구 invoice-month.js 의 본 메일 표(tax_invoice_seen) = 이 PC 메모리 안 Postgres(pglite) + 가짜 메일 러너
//   ⑤ 창구 문서 줄
//   실행: PGLITE_DIR=<@electric-sql/pglite 가 깔린 폴더> node scripts/verify-821-invoice-auto.js
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m, extra) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + m + (!c && extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 600) : '')); };
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const cut = (from, to) => { const a = SRC.indexOf(from); if (a < 0) throw new Error('표식 없음: ' + from); const b = SRC.indexOf(to, a + from.length); if (b < 0) throw new Error('끝 표식 없음: ' + to); return SRC.slice(a, b); };
const BLOCK = cut('// ===== #581 아침 정리 — 시작', '// ===== #581 아침 정리 — 끝') + cut('// ===== #821 계산서 정리(자동) — 시작', '// ===== #821 계산서 정리(자동) — 끝');
const KST = (d, h, m) => Date.UTC(2026, 9, d, h - 9, m);   // KST 2026-10-d h:m (d 가 31 넘으면 11월로 넘어감)
const iso = (ms) => new Date(ms).toISOString();

// 글자 시각 → µs 정수('2026-10-22 04:38:58.965534+00' · ISO 'Z' 둘 다)
function us(t) {
    const m = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d(?::?\d\d)?)?$/.exec(String(t));
    if (!m) throw new Error('시각 글자 꼴 아님: ' + t);
    let tz = m[4] || 'Z'; if (/^[+-]\d\d$/.test(tz)) tz += ':00';
    return Date.parse(`${m[1]}T${m[2]}${tz}`) * 1000 + Number(((m[3] || '') + '000000').slice(0, 6));
}
// 가짜 세상: 설정 store · 메일 색인 mails[{at, idx(색인이 적은 시각 · 없으면 at)}] · 지시 orders[{id,content,status}] · 감사 audits
function world(opt = {}) {
    const W = { dbNow: opt.dbNow || '2026-10-22 05:00:00.123456+00', store: opt.store || {}, mails: opt.mails || [], orders: [], audits: [], sql: [], engine: opt.engine || 'desk', hasIdx: opt.hasIdx !== false, owner: opt.owner === undefined ? { id: 1, name: '전대표', position: '대표' } : opt.owner };
    const pool = { query: async (sql, p = []) => {
        const s = String(sql).replace(/\s+/g, ' ').trim(); W.sql.push(s);
        if (/^SELECT id, name, position FROM users/.test(s)) return { rows: W.owner ? [W.owner] : [] };
        const busyOf = (pat) => { const head = String(pat).replace(/%$/, ''); return W.orders.filter(o => o.content.startsWith(head) && ['대기', '처리중'].includes(o.status) && !o.is_deleted); };
        if (/^SELECT id FROM pending_orders WHERE content LIKE \$1 AND status IN \('대기', '처리중'\) AND is_deleted IS NOT TRUE/.test(s)) {
            if (W.race) { W.orders.push({ id: 9000, content: W.race, status: '대기' }); W.race = null; return { rows: [] }; }   // 다른 인스턴스가 이 검사 직후 같은 지시를 넣음
            return { rows: busyOf(p[0]).slice(0, 1) };
        }
        // 시각은 DB 처럼 µs 까지(글자 ↔ µs 정수) — ms 로 자르면 같은 메일이 다시 「새 메일」로 잡히던 라이브 사고(#3011)를 재현할 수 있게
        const tax = () => W.mails.filter(x => (x.kind || 'tax_invoice') === 'tax_invoice'), ixs = (x) => x.idx || x.at;
        if (/^SELECT now\(\)::text AS m$/.test(s)) return { rows: [{ m: W.dbNow }] };
        if (/^SELECT COALESCE\(max\(indexed_at\), now\(\)\)::text AS m FROM mail_index WHERE parsed->>'kind' = 'tax_invoice'$/.test(s)) {
            const xs = tax().map(ixs).sort((a, b) => us(a) - us(b));
            return { rows: [{ m: xs.length ? xs[xs.length - 1] : W.dbNow }] };
        }
        if (/^SELECT to_regclass\('public\.mail_index'\)/.test(s)) return { rows: [{ ok: W.hasIdx }] };
        if (/^SELECT COALESCE\(at, indexed_at\) AS at, indexed_at::text AS ix FROM mail_index WHERE parsed->>'kind' = 'tax_invoice' AND indexed_at > COALESCE\(\$1::timestamptz, '-infinity'::timestamptz\) ORDER BY indexed_at$/.test(s)) {
            if (p[0] != null && typeof p[0] !== 'string') throw new Error('기준 시각이 글자가 아님: ' + typeof p[0]);
            const since = p[0] ? us(p[0]) : -Infinity;
            return { rows: tax().filter(x => us(ixs(x)) > since).sort((a, b) => us(ixs(a)) - us(ixs(b))).map(x => ({ at: new Date(x.at), ix: ixs(x) })) };
        }
        if (/^INSERT INTO pending_orders \(content, status, created_by, created_by_id, mine_hidden\) SELECT \$1, '대기', \$2, \$3, false WHERE NOT EXISTS \(SELECT 1 FROM pending_orders WHERE content LIKE \$4 AND status IN \('대기', '처리중'\) AND is_deleted IS NOT TRUE\) RETURNING id$/.test(s)) {
            if (busyOf(p[3]).length) return { rows: [] };
            const id = 5000 + W.orders.length; W.orders.push({ id, content: p[0], status: '대기', created_by: p[1], created_by_id: p[2] }); return { rows: [{ id }] };
        }
        throw new Error('가짜 pool 이 모르는 SQL: ' + s.slice(0, 120));
    } };
    const M = new Function('pool', 'naverCfgGet', 'naverCfgSet', 'writeAudit', 'aoEngine', 'setInterval', 'console',
        BLOCK + '\nreturn { deskInvoiceCfg, deskInvoiceTick, deskInvoiceCreate, DESK_INVOICE_TEXT, DESK_INVOICE_HEAD, deskInvoicePrevYm };')(
        pool, async k => (k in W.store ? JSON.parse(JSON.stringify(W.store[k])) : null), async (k, v) => { W.store[k] = JSON.parse(JSON.stringify(v)); },
        async a => { W.audits.push(a); }, async () => W.engine, () => ({}), { log() { }, error(...a) { console.log('     (오류 로그)', ...a); } });
    W.M = M; W.tick = (ms) => M.deskInvoiceTick(ms);
    return W;
}

(async () => {
    console.log('① 설정 · 글');
    { const W = world(); const { deskInvoiceCfg: C, DESK_INVOICE_TEXT: T, deskInvoicePrevYm: P } = W.M;
        const d = C(null);
        ok(d.enabled === true && d.time === '08:10' && d.debounce_min === 30, '설정 없음 = 켜짐 · 08:10 · 30분');
        ok(C({ enabled: false }).enabled === false && C({ enabled: 'false' }).enabled === true && C({ time: '9:00' }).time === '08:10' && C({ time: '09:00' }).time === '09:00' && C({ debounce_min: -1 }).debounce_min === 30 && C({ debounce_min: 0 }).debounce_min === 0, 'enabled 불리언 false 만 · 시각 HH:MM 만 · debounce 0~1440');
        ok(T(['2026-09', '2026-10']) === '[계산서 정리] 2026-09, 2026-10 — 계산서 메일을 읽어 발행현황 표를 채워 주세요.', '지시 글 = 「[계산서 정리] 달, 달 — …」');
        ok(P('2026-01') === '2025-12' && P('2026-10') === '2026-09', '전달 계산(1월 → 지난해 12월)');
    }

    console.log('② 새 계산서 메일 감지(ⓐ)');
    {   // 첫 가동 = 기준만
        const W = world({ mails: [{ at: iso(KST(21, 9, 0)) }] });
        const r = await W.tick(KST(22, 14, 0));
        ok(r && r.skipped === 'first_run' && W.orders.length === 0 && W.store.desk_invoice_last.mail_at === iso(KST(21, 9, 0)) && W.store.desk_invoice_last.month1 === '2026-10', '첫 가동 = 지시 0 · 기준(mail_at = 계산서 메일 마지막 색인 시각 · month1 = 이번 달)만 — 배포 직전 메일로 안 뜸', W.store);
        ok((await W.tick(KST(22, 14, 1))) === null && W.orders.length === 0, '첫 가동 뒤 새 메일 없으면 0건');
    }
    {
        const last = { date: '2026-10-21', mail_at: iso(KST(21, 20, 0)), month1: '2026-10' };
        const W = world({ store: { desk_invoice_last: last }, mails: [{ at: iso(KST(21, 19, 0)) }, { at: iso(KST(22, 2, 0)) }] });
        ok((await W.tick(KST(22, 8, 9))) === null && W.orders.length === 0, '밤 02:00 에 온 메일 = 08:10 전엔 안 넣음');
        const r = await W.tick(KST(22, 8, 10));
        ok(r && r.ok && r.why === 'mail' && W.orders.length === 1 && W.orders[0].content === '[계산서 정리] 2026-09, 2026-10 — 계산서 메일을 읽어 발행현황 표를 채워 주세요.' && W.orders[0].status === '대기' && W.orders[0].created_by === '전대표 대표' && W.orders[0].created_by_id === 1, '08:10 = 지시 1건(받은 달 + 전달 · 대표 이름 · 대기) · 기준보다 옛 메일(19:00)은 안 셈', W.orders);
        const L = W.store.desk_invoice_last;
        ok(L.date === '2026-10-22' && L.id === 5000 && L.mail_at === iso(KST(22, 2, 0)) && L.at === iso(KST(22, 8, 10)) && L.why === 'mail', '기록 = date·at·id·mail_at(본 메일 중 가장 늦은 것)', L);
        ok(W.audits.length === 1 && W.audits[0].source === 'desk_invoice' && W.audits[0].actor.name === '계산서 정리(자동)' && W.audits[0].changes.after.kind === 'invoice' && W.audits[0].targetId === 5000, '감사 기록(source desk_invoice · actor 계산서 정리(자동))', W.audits);
        // 같은 지시가 대기 중 → 새 메일이 와도 0건 · 기준 그대로
        W.mails.push({ at: iso(KST(22, 9, 0)) });
        for (const mm of [41, 50, 59]) await W.tick(KST(22, 8, mm));
        ok(W.orders.length === 1 && W.store.desk_invoice_last.mail_at === iso(KST(22, 2, 0)), '같은 머리말 지시가 대기 중 = 새 메일이 있어도 0건 · mail_at 그대로(끝난 뒤 다시)');
        W.orders[0].status = '처리중';
        ok((await W.tick(KST(22, 9, 1))) === null && W.orders.length === 1, '처리중이어도 0건');
        W.orders[0].status = '완료';
        const r2 = await W.tick(KST(22, 9, 2));
        ok(r2 && r2.ok && W.orders.length === 2 && W.orders[1].content.startsWith('[계산서 정리] 2026-09, 2026-10 ') && W.store.desk_invoice_last.mail_at === iso(KST(22, 9, 0)), '끝난 뒤 = 남은 새 메일로 1건 더', W.orders.map(o => o.content));
        // debounce: 방금 넣은 뒤 30분 안에 새 메일 → 0건 · 30분 지나면 1건
        W.orders[1].status = '완료';
        W.mails.push({ at: iso(KST(22, 9, 10)) });
        ok((await W.tick(KST(22, 9, 31))) === null && W.orders.length === 2, '마지막 등록 뒤 30분 안 = 0건(29분)');
        const r3 = await W.tick(KST(22, 9, 32));
        ok(r3 && r3.ok && W.orders.length === 3, '30분 지나면 1건');
        ok((await W.tick(KST(22, 10, 30))) === null && W.orders.length === 3, '새 메일 없으면 0건(같은 메일 두 번 안 셈)');
    }
    {   // µs 보존(10/22 12:41 라이브 #3011): 첫 가동 기준 = 색인 시각 글자 그대로 → 같은 메일 2통(.965534)이 다음 틱에 「새 메일」로 안 잡힘
        const mk = () => [{ at: iso(Date.UTC(2026, 0, 20, 3, 0)), idx: '2026-10-22 04:38:58.965534+00' }, { at: iso(Date.UTC(2026, 1, 10, 3, 0)), idx: '2026-10-22 04:38:58.965534+00' }];
        const W = world({ mails: mk() });
        const r0 = await W.tick(KST(22, 12, 39));
        ok(r0 && r0.skipped === 'first_run' && W.store.desk_invoice_last.mail_at === '2026-10-22 04:38:58.965534+00', '첫 가동 기준 = DB 글자 그대로(µs 6자리 · JS 시각 변환 0)', W.store.desk_invoice_last);
        for (const mm of [41, 42, 50]) await W.tick(KST(22, 12, mm));
        await W.tick(KST(22, 13, 30));
        ok(W.orders.length === 0, 'µs 차이 메일(.965534 vs 종전 저장 .965) = 두 번째 틱부터도 0건(종전 = 「2026-01, 2026-02」 지시가 30분마다 반복)', W.orders.map(o => o.content));
        // 등록 뒤 기준도 글자 그대로 → 같은 메일로 다시 안 넣음
        const W2 = world({ store: { desk_invoice_last: { date: '2026-10-21', mail_at: '2026-10-22 04:00:00.000001+00', month1: '2026-10' } }, mails: mk() });
        const r1 = await W2.tick(KST(22, 13, 0));
        ok(r1 && r1.ok && W2.store.desk_invoice_last.mail_at === '2026-10-22 04:38:58.965534+00', '등록 뒤 mail_at = 가장 늦은 색인 시각 글자(µs)', W2.store.desk_invoice_last);
        W2.orders[0].status = '완료';
        await W2.tick(KST(22, 13, 40)); await W2.tick(KST(22, 15, 0));
        ok(W2.orders.length === 1, '→ debounce 지나도 같은 메일로 다시 안 넣음(1건뿐)');
        const W3 = world({ hasIdx: false });
        await W3.tick(KST(22, 12, 39));
        ok(W3.store.desk_invoice_last.mail_at === '2026-10-22 05:00:00.123456+00', '색인 표 없으면 기준 = DB now() 글자');
    }
    {   // 색인이 늦게 적은 옛 메일(메일 날짜 = 7월 · 색인 시각 = 지금) = 잡힘 · 달은 메일 날짜로 · 기준은 색인 시각
        const W = world({ store: { desk_invoice_last: { date: '2026-10-21', mail_at: iso(KST(21, 20, 0)), month1: '2026-10' } }, mails: [{ at: iso(Date.UTC(2026, 6, 15, 3, 0)), idx: iso(KST(22, 7, 0)) }] });
        const r = await W.tick(KST(22, 8, 10));
        ok(r && r.ok && W.orders[0].content.startsWith('[계산서 정리] 2026-06, 2026-07 ') && W.store.desk_invoice_last.mail_at === iso(KST(22, 7, 0)), '늦게 색인된 7월 메일 = 「2026-06, 2026-07」 · mail_at = 색인 시각', { o: W.orders, L: W.store.desk_invoice_last });
        W.orders[0].status = '완료';
        ok((await W.tick(KST(22, 9, 0))) === null && W.orders.length === 1, '같은 메일 두 번 안 셈(색인 시각 기준)');
        const W2 = world({ store: { desk_invoice_last: { date: '2026-10-21', mail_at: iso(KST(21, 20, 0)), month1: '2026-10' } }, mails: [{ at: iso(KST(22, 1, 0)), idx: iso(KST(21, 19, 0)) }] });
        ok((await W2.tick(KST(22, 8, 10))) === null && W2.orders.length === 0, '메일 날짜가 기준 뒤여도 색인 시각이 기준 전이면 안 셈');
    }
    {   // 두 인스턴스 경합 = 검사 직후 다른 쪽이 넣어도 INSERT … WHERE NOT EXISTS 가 막음
        const W = world({ store: { desk_invoice_last: { date: '2026-10-21', mail_at: iso(KST(21, 20, 0)), month1: '2026-10' } }, mails: [{ at: iso(KST(22, 1, 0)) }] });
        W.race = '[계산서 정리] 2026-09, 2026-10 — 다른 인스턴스';
        const r = await W.tick(KST(22, 8, 10));
        ok(r && r.ok === false && r.why === 'busy' && W.orders.length === 1 && W.orders[0].id === 9000 && W.store.desk_invoice_last.mail_at === iso(KST(21, 20, 0)) && W.audits.length === 0, '경합 = 두 번째 지시 0 · 기록·감사 그대로', { r, o: W.orders });
    }
    {   // 달 넘김 · 여러 달 · 옛 메일 · 다른 kind
        const W = world({ store: { desk_invoice_last: { date: '2026-11-02', mail_at: iso(KST(32, 0, 0)), month1: '2026-11' } },
            mails: [{ at: iso(KST(33, 10, 0)) }, { at: iso(KST(31, 23, 0)) }, { at: iso(KST(33, 11, 0)), kind: 'tax_invoice_other' }] });
        const r = await W.tick(KST(33, 12, 0));
        ok(r && r.ok && W.orders[0].content.startsWith('[계산서 정리] 2026-10, 2026-11 ') && W.store.desk_invoice_last.mail_at === iso(KST(33, 10, 0)), '11/3 메일 = 「2026-10, 2026-11」 · 기준 전 메일·다른 회사 계산서(tax_invoice_other)는 안 셈', W.orders);
        const W2 = world({ store: { desk_invoice_last: { date: '2026-10-01', mail_at: iso(KST(1, 0, 0)), month1: '2026-10' } }, mails: [{ at: iso(KST(5, 10, 0)) }, { at: iso(KST(33, 10, 0)) }, { at: iso(KST(20, 10, 0)) }] });
        await W2.tick(KST(33, 12, 0));
        ok(W2.orders.length === 1 && W2.orders[0].content.startsWith('[계산서 정리] 2026-09, 2026-10, 2026-11 '), '여러 달 메일 = 달 중복 없이 차례로 한 지시', W2.orders);
    }
    {   // 꺼짐 · 엔진 api · 대표 계정 없음 · 색인 표 없음
        const base = () => ({ desk_invoice_last: { date: '2026-10-21', mail_at: iso(KST(21, 0, 0)), month1: '2026-10' } });
        const W = world({ store: { ...base(), desk_invoice: { enabled: false } }, mails: [{ at: iso(KST(22, 1, 0)) }] });
        ok((await W.tick(KST(22, 9, 0))) === null && W.orders.length === 0, 'enabled:false = 0건');
        const W2 = world({ store: base(), mails: [{ at: iso(KST(22, 1, 0)) }], engine: 'api' });
        const r2 = await W2.tick(KST(22, 9, 0));
        ok(r2 && r2.why === 'engine_api' && W2.orders.length === 0 && W2.store.desk_invoice_last.mail_at === iso(KST(21, 0, 0)), '엔진 api = 0건 · 기준 그대로(desk 로 돌아오면 그때)');
        const W3 = world({ store: base(), mails: [{ at: iso(KST(22, 1, 0)) }], owner: null });
        const r3 = await W3.tick(KST(22, 9, 0));
        ok(r3 && r3.why === 'owner_missing' && W3.orders.length === 0, '대표 계정 없음 = 0건');
        const W4 = world({ store: base(), hasIdx: false });
        ok((await W4.tick(KST(22, 9, 0))) === null && W4.orders.length === 0 && !W4.sql.some(s => /FROM mail_index/.test(s)), '메일 색인 표가 없으면 안 묻고 0건');
        const W5 = world({ store: { ...base(), desk_invoice: { time: '10:00', debounce_min: 0 } }, mails: [{ at: iso(KST(22, 1, 0)) }] });
        ok((await W5.tick(KST(22, 9, 59))) === null && (await W5.tick(KST(22, 10, 0))).ok && W5.orders.length === 1, '시각을 10:00 으로 바꾸면 그때');
    }

    console.log('③ 매달 1일 안전망(ⓑ)');
    {
        const W = world({ store: { desk_invoice_last: { date: '2026-10-28', at: iso(KST(28, 9, 0)), id: 1, mail_at: iso(KST(28, 8, 0)), month1: '2026-10' } } });
        ok((await W.tick(KST(31, 23, 0))) === null && W.orders.length === 0, '10/31 = 0건');
        ok((await W.tick(KST(32, 8, 9))) === null && W.orders.length === 0, '11/1 08:09 = 아직');
        const r = await W.tick(KST(32, 8, 10));
        ok(r && r.ok && r.why === 'month1' && W.orders.length === 1 && W.orders[0].content.startsWith('[계산서 정리] 2026-10, 2026-11 ') && W.store.desk_invoice_last.month1 === '2026-11' && W.store.desk_invoice_last.mail_at === iso(KST(28, 8, 0)), '11/1 08:10 = 「지난달, 이번 달」 1건 · 기준 메일 시각은 그대로', W.store);
        W.orders[0].status = '완료';
        for (const h of [9, 12, 20]) await W.tick(KST(32, h, 0));
        ok(W.orders.length === 1, '그날 다시 틱 = 안 넣음');
        await W.tick(KST(33, 8, 10));
        ok(W.orders.length === 1, '11/2 = 안 넣음');
    }
    {   // 그날 ⓐ 로 이미 넣었으면 안전망 생략
        const W = world({ store: { desk_invoice_last: { date: '2026-10-28', mail_at: iso(KST(28, 8, 0)), month1: '2026-10' } }, mails: [{ at: iso(KST(32, 3, 0)) }] });
        const r = await W.tick(KST(32, 8, 10));
        ok(r && r.why === 'mail' && W.orders.length === 1 && W.orders[0].content.startsWith('[계산서 정리] 2026-10, 2026-11 ') && W.store.desk_invoice_last.month1 === '2026-11', '1일에 새 메일로 넣음 = month1 도 이번 달로');
        W.orders[0].status = '완료';
        await W.tick(KST(32, 9, 0)); await W.tick(KST(32, 15, 0));
        ok(W.orders.length === 1, '→ 그날 안전망 생략(1건뿐)');
    }
    {   // 1일에 대기 중인 지시 있음 → 끝난 뒤 안전망
        const W = world({ store: { desk_invoice_last: { date: '2026-10-28', mail_at: iso(KST(28, 8, 0)), month1: '2026-10' } } });
        W.orders.push({ id: 1, content: '[계산서 정리] 2026-10 — …', status: '대기' });
        ok((await W.tick(KST(32, 8, 10))) === null && W.orders.length === 1, '1일 같은 머리말 지시 대기 중 = 기다림');
        W.orders[0].status = '완료';
        const r = await W.tick(KST(32, 8, 11));
        ok(r && r.why === 'month1' && W.orders.length === 2, '끝난 뒤 안전망 1건');
    }
    {   // 첫 가동 날이 1일 = 안 넣음
        const W = world();
        const r = await W.tick(KST(32, 8, 30));
        ok(r && r.skipped === 'first_run' && W.orders.length === 0 && W.store.desk_invoice_last.month1 === '2026-11', '첫 가동 날이 1일이어도 지시 0(기준만)');
        await W.tick(KST(32, 9, 0)); await W.tick(KST(32, 20, 0));
        ok(W.orders.length === 0, '그날 내내 0건');
    }

    console.log('④ 창구 invoice-month.js — 본 메일 표(tax_invoice_seen)');
    const PGL = process.env.PGLITE_DIR;
    if (!PGL) { ok(false, 'PGLITE_DIR 가 없어요 — npm i @electric-sql/pglite 한 폴더를 주세요'); }
    else {
        const { PGlite } = require(path.join(PGL, 'node_modules', '@electric-sql', 'pglite'));
        const IM = require(path.join(__dirname, 'desk', 'invoice-month.js'));
        const OUR = '4228104127';
        const conv = (v) => (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof Uint8Array)) ? JSON.stringify(v) : v;
        const db = new PGlite();
        await db.exec(`CREATE TABLE agent_office_config (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE report_files (id SERIAL PRIMARY KEY, filename VARCHAR(200) NOT NULL, run_id INTEGER, data BYTEA NOT NULL, size_bytes INTEGER, created_at TIMESTAMP DEFAULT NOW(), is_deleted BOOLEAN DEFAULT false, purged_at TIMESTAMP);
            CREATE TABLE pending_orders (id SERIAL PRIMARY KEY, created_by TEXT);
            CREATE TABLE mail_index (id SERIAL PRIMARY KEY, folder TEXT, folder_name TEXT, uidvalidity BIGINT, uid BIGINT, from_addr TEXT, from_name TEXT, subject TEXT, msg_date TEXT, at TIMESTAMPTZ, has_attach BOOLEAN, attach_names TEXT, size INTEGER, parsed JSONB, indexed_at TIMESTAMPTZ DEFAULT NOW());
            INSERT INTO mail_index (folder, uidvalidity, uid, from_name, subject, at, parsed) VALUES
              ('INBOX', 7, 51, '네이버', '네이버 광고 계산서', '2026-10-03T02:00:00Z', '{"kind":"tax_invoice","supplier":null}'),
              ('INBOX', 7, 52, '홈택스', '(제주조천점->제주아꼼이네)', '2026-10-04T02:00:00Z', '{"kind":"tax_invoice","supplier":"sion"}'),
              ('INBOX', 7, 53, 'FirstBill', '전자계산서', '2026-10-05T02:00:00Z', '{"kind":"tax_invoice","supplier":null}'),
              ('INBOX', 7, 54, '네이버', '(오션라운지->제주아꼼이네) 광고', '2026-10-06T02:00:00Z', '{"kind":"tax_invoice","supplier":null}'),
              ('INBOX', 7, 55, '탐라OA', '계산서', '2026-10-07T02:00:00Z', '{"kind":"tax_invoice","supplier":null}'),
              ('INBOX', 7, 56, '알리는사람들', '계산서', '2026-10-08T02:00:00Z', '{"kind":"tax_invoice","supplier":null}');`);
        await db.query(`INSERT INTO agent_office_config (key, value) VALUES ('tax_invoice', $1), ('mail_index_state', $2)`, [JSON.stringify({ pdf_password: OUR }), JSON.stringify({ initial_done: true })]);
        const BODY = (n) => `홈택스 발급 안내\n작성일자 2026-10-0${n}\n공급가액 90,000\n세액 0\n합계금액 90,000\n승인번호 20261001-41000000-000000${50 + n}`;
        const MAILS = { 51: BODY(3) + '\n공급자 등록번호 220-81-62517', 52: BODY(4), 53: BODY(5) + '\n공급받는자 상호 오션라운지', 55: null, 56: BODY(8) };   // 51 = 번호 읽힌 기타 · 55 = 읽기 실패(오류) · 56 = 번호 못 읽은 기타
        let reqs = [];
        const hook = async (sql, p) => {
            const m = /INSERT INTO agent_office_config \(key, value\) VALUES \(\$1, \$2::jsonb\)/.test(sql) && /^mail_(read|attach)_request$/.exec(p[0]);
            if (!m) return null;
            const req = JSON.parse(p[1]); reqs.push(req.uid);
            const res = MAILS[req.uid] == null ? { id: req.id, ok: false, error: '시험 실패' } : { id: req.id, ok: true, mail: { uid: req.uid, text: MAILS[req.uid], attachments: [] } };
            await db.query(`INSERT INTO agent_office_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, ['mail_' + m[1] + '_result', JSON.stringify(res)]);
            return { rows: [], rowCount: 1 };
        };
        const pool = { async query(sql, p = []) { const h = await hook(sql, p); if (h) return h; const r = await db.query(sql, p.map(conv)); return { rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length }; } };
        const run = async (args) => { reqs = []; const o = await IM.main(args, { pool, sleep: () => Promise.resolve(), now: () => Date.now() + Math.random(), print: () => { } }); return { o, opened: reqs.slice().sort() }; };
        const seen = async () => (await db.query(`SELECT dedup_key, why FROM tax_invoice_seen ORDER BY dedup_key`)).rows.map(r => r.dedup_key.split(':').pop() + '=' + r.why).join(',');

        let { o, opened } = await run(['2026-10', '--dry']);
        ok(o.ok && o.counts.mails === 6 && (await db.query(`SELECT to_regclass('public.tax_invoice_seen') IS NULL AS no`)).rows[0].no, '--dry = 본 메일 표도 안 만듦', o.counts);
        ({ o, opened } = await run(['2026-10']));
        ok(o.ok && o.counts.mails === 6 && o.counts.other === 3 && o.counts.excluded === 2 && o.counts.check === 1 && o.counts.inserted === 1 && o.counts.seen === 0 && opened.join() === '51,52,53,55,56', '1회차 = 51·52·53·55·56 엶(54 는 제목으로 안 엶) · 기타 3(51 · 55 오류 · 56 번호 못 읽음) · 제외 2 · 새 줄 1(시온)', { c: o.counts, opened });
        ok((await seen()) === '51=other,53=excluded,54=excluded', '본 메일 표 = 번호 읽힌 기타 51 · 제외 53·54 (읽기 실패 55 · 번호 못 읽은 56 · 표에 들어간 52 는 안 적음)', await seen());
        ({ o, opened } = await run(['2026-10']));
        ok(o.ok && opened.join() === '52,55,56' && o.counts.mails === 6 && o.counts.other === 3 && o.counts.excluded === 2 && o.counts.seen === 3 && /그중 3통은 지난번에 봐서 안 엶/.test(o.note), '2회차 = 본 메일 3통은 안 엶(확인 필요 52 · 실패 55 · 번호 못 읽은 56 만 다시) · 건너뛴 수는 종전처럼', { c: o.counts, opened, note: o.note });
        ({ o, opened } = await run(['2026-10', '--limit', '1']));
        ok(o.ok && opened.join() === '52' && o.more === true && o.counts.seen === 3, '--limit 1 = 안 본 메일 기준(가장 옛 51 이 아니라 52) · 더 있음 표시', { c: o.counts, opened, more: o.more });
        ({ o, opened } = await run(['2026-10', '--force']));
        ok(o.ok && opened.join() === '51,52,53,55,56' && o.counts.seen === 0 && o.counts.other === 3 && o.counts.excluded === 2, '--force = 본 메일 표 무시하고 다시 엶', { c: o.counts, opened });
        await db.query(`UPDATE agent_office_config SET value = $1 WHERE key = 'tax_invoice'`, [JSON.stringify({ pdf_password: OUR, suppliers: { sion: ['111-11-11111'] } })]);
        ({ o, opened } = await run(['2026-10']));
        ok(o.ok && opened.join() === '51,52,53,55,56' && o.counts.seen === 0, '공급자 설정이 바뀌면 = 지난번 판단 무효 · 다시 엶', { c: o.counts, opened });
        ({ o, opened } = await run(['2026-10']));
        ok(o.ok && opened.join() === '52,55,56' && o.counts.seen === 3, '바뀐 설정으로 한 번 본 뒤엔 다시 안 엶', { c: o.counts, opened });
        await db.query(`UPDATE agent_office_config SET value = $1 WHERE key = 'tax_invoice'`, [JSON.stringify({ pdf_password: OUR, suppliers: { sion: ['111-11-11111'] }, exclude_words: ['오션라운지', '탐라'] })]);
        ({ o, opened } = await run(['2026-10']));
        ok(o.ok && !opened.includes(55) && opened.includes(51) && o.counts.excluded === 3, '제외 낱말을 바꾸면 = 다시 봄(55 탐라OA 는 제목에서 바로 제외 · 안 엶)', { c: o.counts, opened });
        const tv = (await db.query(`SELECT mail_uid::int AS u FROM tax_invoices ORDER BY mail_uid`)).rows.map(r => r.u).join();
        ok(tv === '52', '발행현황 표 = 시온 52 한 줄뿐(여러 번 돌려도 중복 0)', tv);
        ({ o, opened } = await run(['2026-09', '--dry']));
        ok(o.ok && o.counts.mails === 6 && o.counts.seen === 4 && opened.join() === '52,56', '9월 실행(9/1~10/10 메일) = 같은 메일은 달이 달라도 다시 안 엶 · --dry 도 본 메일 표를 읽음', { c: o.counts, opened });
    }

    console.log('⑤ 창구 규칙 문서');
    {
        const know = fs.readFileSync(path.join(ROOT, '★에이전트오피스', '업무지식.md'), 'utf8');
        const rule = fs.readFileSync(path.join(ROOT, '★에이전트오피스', 'CLAUDE.md'), 'utf8');
        ok(/「\[계산서 정리\] YYYY-MM\[, YYYY-MM\]」/.test(know) && /invoice-month\.js <달> --order <지시 id>/.test(know) && /새 줄 n · 이미 있던 n · 못 읽음 n · 기타 n 건너뜀/.test(know), '업무지식 = 「[계산서 정리]」 지시 → 달마다 invoice-month --order · 답 꼴');
        ok(/계산서 메일\(FirstBill·홈택스·스마트빌\)은 지우거나 받은메일함·「청구·결제」 밖으로 옮기지 않는다/.test(know) && /tax_invoice_seen/.test(know), '업무지식 = 계산서 메일 지우기·옮기기 금지 줄 · 본 메일 표');
        ok(/「\[계산서 정리\] …」로 시작하는 지시\*\*\(#821/.test(rule), '창구 CLAUDE.md 4-1 표에 [계산서 정리] 한 줄');
    }
    console.log(`\n결과: ${pass}/${pass + fail}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
