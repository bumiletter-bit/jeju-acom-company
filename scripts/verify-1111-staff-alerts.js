// #1111-B 검증 — staff-alerts.js · notify-routes.js 순수 판정 함수 + run() 을 가짜 DB 로 (실DB·서버·AI·발송 0)
//   실행: node scripts/verify-1111-staff-alerts.js
//   분기 다 여는 자료: 순위 정상·사라짐·급락(상위/중위)·읽기 실패·파워링크만 실패·보안 확인·이틀 연속·0건 / 가격 어긋남·예외·참고 종류·조회 실패 /
//   미답변 3시간 전후·처리됨·남음·새로 / 재료 시기 끝·시작·해 넘김·정정·상태 바뀜·지난 날짜 / 클레임 요약 0건·채널·사유·품목 / 정산 실패·성공·어제 / run 스위치 꺼짐·받는 사람 없음·한 번 표식
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SA = require(path.join(ROOT, 'staff-alerts.js'));
const NR = require(path.join(ROOT, 'notify-routes.js'));
let pass = 0, fail = 0;
const ok = (c, n, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + n + (d != null && !c ? ' — ' + String(d).slice(0, 400) : '')); };
const KST = 9 * 3600e3;
const at = s => Date.parse(s + '+09:00');   // 'YYYY-MM-DDTHH:MM' 한국 시각 → ms

(async () => {
    console.log('① 받는 사람(notify-routes)');
    ok(JSON.stringify(NR.pickIds(null, 'settle_recon', [1, 3])) === '[1,3]', '설정 없음 = 종전 그대로');
    ok(JSON.stringify(NR.pickIds({ rank_alert: [7] }, 'settle_recon', [1, 3])) === '[1,3]', '그 type 칸 없음 = 종전 그대로');
    ok(JSON.stringify(NR.pickIds({ settle_recon: [9, '9', 'x', 0, -1, 4] }, 'settle_recon', [1])) === '[9,4]', '칸 있음 = 그 목록(숫자만·중복 뺌)');
    ok(JSON.stringify(NR.pickIds({ settle_recon: [] }, 'settle_recon', [1])) === '[]', '빈 칸 = 아무에게도 안 보냄');
    ok(JSON.stringify(NR.pickIds({ settle_recon: 'x' }, 'settle_recon', [1])) === '[1]', '꼴 틀린 칸 = 종전 그대로');
    { let q = 0; const r = NR({ pool: { query: async () => { q++; return { rows: [{ value: { a: [5] } }] }; } } }); await r.routeIds('a', []); await r.routeIds('b', [2]); ok(q === 1 && JSON.stringify(await r.routeIds('a', [])) === '[5]', '60초 기억(두 번째부터 DB 0)'); }
    { const r = NR({ pool: { query: async () => { throw new Error('x'); } } }); ok(JSON.stringify(await r.routeIds('a', [2])) === '[2]', '읽기 실패 = 종전 그대로'); }

    console.log('② 순위(쇼핑만)');
    const Y = [{ keyword: '귤', shopping_rank: 3 }, { keyword: '황금향', shopping_rank: 5 }, { keyword: '감귤', shopping_rank: 15 }, { keyword: '레몬', shopping_rank: 30 }, { keyword: '타이벡귤', shopping_rank: 8 }, { keyword: '노지', shopping_rank: null }, { keyword: '체험', shopping_rank: 20 }, { keyword: '광고실패', shopping_rank: 6 }];
    const T = [{ keyword: '귤', shopping_rank: 7 }, { keyword: '황금향', shopping_rank: null }, { keyword: '감귤', shopping_rank: 24 }, { keyword: '레몬', shopping_rank: 40 }, { keyword: '타이벡귤', shopping_rank: 12 }, { keyword: '노지', shopping_rank: null }, { keyword: '체험', shopping_rank: null }, { keyword: '광고실패', shopping_rank: 6 }];
    const r1 = SA.rankAlerts({ today: T, yest: Y, last: { errors: [{ keyword: '체험', error: '쇼핑: 목록을 못 찾음' }, { keyword: '광고실패', error: '파워링크(pc): x' }] }, prev: null });
    const K = k => r1.items.find(x => x.keyword === k);
    ok(K('귤') === undefined, '3위 → 7위(↓4 · 10위 안 +5 미만) = 정상');
    ok(K('황금향') && K('황금향').kind === 'gone', '5위 → 없음 = 사라짐');
    ok(K('감귤') === undefined, '15위 → 24위(↓9 · 11~40위 +10 미만) = 정상');
    ok(K('레몬') && K('레몬').kind === 'drop', '30위 → 40위(↓10) = 급락');
    ok(K('타이벡귤') === undefined && SA.rankAlerts({ today: [{ keyword: '타이벡귤', shopping_rank: 13 }], yest: [{ keyword: '타이벡귤', shopping_rank: 8 }], last: {} }).items[0].kind === 'drop', '8위 → 12위 정상 · 8위 → 13위(↓5) 급락');
    ok(K('노지') === undefined, '어제도 없던 키워드 = 볼 것 없음');
    ok(K('체험') === undefined && r1.failed.includes('체험'), '쇼핑 읽기 실패 = 사라짐으로 안 셈(failed)');
    ok(K('광고실패') === undefined && !r1.failed.includes('광고실패'), '파워링크만 실패 = 쇼핑 값으로 봄');
    ok(SA.rankAlerts({ today: [], yest: [{ keyword: '귤', shopping_rank: 2 }], last: {} }).items.length === 0, '오늘 줄 없음 = 사라짐으로 안 셈');
    ok(SA.rankAlerts({ today: [{ keyword: '귤', shopping_rank: 55 }], yest: [{ keyword: '귤', shopping_rank: 39 }], last: {} }).items[0].kind === 'gone', '39위 → 55위(40 밖) = 사라짐');
    const r2 = SA.rankAlerts({ today: T, yest: Y, last: { errors: [] }, prev: { '황금향': 'gone' } });
    ok(!r2.items.some(x => x.keyword === '황금향') && r2.items.some(x => x.keyword === '레몬'), '이틀 연속 같은 문제 = 한 번만');
    ok(SA.rankAlerts({ today: T, yest: Y, last: { blocked: true } }).blocked === true, '보안 확인 = 막힘');
    { const t = SA.rankText(r1, '2026-11-11'); ok(t.title === '🟥 확인 필요 · 순위 문제 2건 (11/11)' && /「황금향」 쇼핑 5위 → 40위 밖\(사라짐\)/.test(t.message) && /「레몬」 쇼핑 30위 → 40위\(↓10\)/.test(t.message) && /\n→ 순위관리에서 확인$/.test(t.message) && !/에이전트/.test(t.message) && t.level === 'alert', '순위 글 꼴', JSON.stringify(t)); }
    ok(SA.rankText({ blocked: false, items: [] }, '2026-11-11') === null, '0건 = 안 보냄');
    ok(/보안 확인/.test(SA.rankText({ blocked: true, items: [] }, '2026-11-11').message) && /→ 순위관리에서 확인\(오늘 순위 못 읽음\)$/.test(SA.rankText({ blocked: true, items: [] }, '2026-11-11').message), '막힘 글');
    { const all = [SA.rankText({ blocked: true, items: [] }, 'x'), SA.priceText(SA.priceDiff({ ok: true, groups: [{ key: 'a', label: 'a', issues: [{ kind: 'mall_vs_naver', detail: 'd' }] }] }, {}), []),
        SA.claimText(SA.claimBrief({ rows: {}, claims: [], open: 1 }), '2026-11-10'), SA.settleText({ last_run_at: new Date(at('2026-11-11T09:00')).toISOString(), last_status: 'failed' }, '2026-11-11')];
      ok(all.every(m => m && !/에이전트|대표/.test(m.message)) && /\n→ 전체 가격 확인하기에서 확인$/.test(all[1].message) && /\n→ 미답변은 손님 연락에서$/.test(all[2].message) && /\n→ 정산관리에서 오늘 정산 확인$/.test(all[3].message), '꼬리 = 본인이 처리하는 행동만(에이전트·대표 문구 0)', JSON.stringify(all.map(m => m && m.message))); }

    console.log('③ 가격');
    const rep = { ok: true, source: { coupang: 'live' }, groups: [
        { key: 'p:타이벡 5kg', label: '타이벡 가정용 5kg', issues: [{ kind: 'coupang_vs_naver', detail: '쿠팡 타이벡 26,800 ↔ 네이버 25,620' }, { kind: 'stale', detail: '한쪽만 바뀜' }] },
        { key: 'p:황금향 선물', label: '황금향 선물용 3kg', issues: [{ kind: 'mall_vs_naver', detail: '자사몰 35,800 ↔ 네이버 33,800' }] },
        { key: 'p:VIP', label: 'VIP 선물세트', issues: [{ kind: 'vip_same', detail: '참고' }, { kind: 'tier_mismatch', detail: 'VIP 페이지끼리 다름' }] },
        { key: 'p:레몬', label: '레몬 5kg', issues: [{ kind: 'coupang_unmatched', detail: '짝 없음' }, { kind: 'missing', detail: '자사몰에 없음' }] }] };
    const p1 = SA.priceDiff(rep, { price_ignore: ['VIP 선물세트'] });
    ok(p1.ok && p1.items.length === 2 && p1.items.every(x => ['coupang_vs_naver', 'mall_vs_naver'].includes(x.kind)), '문제 4종만 · 참고(missing·vip_same·coupang_unmatched·stale) 뺌 · 예외 글자(VIP) 뺌', JSON.stringify(p1.items));
    { const t = SA.priceText(p1, ['p:황금향 선물|mall_vs_naver']); ok(t.title === '🟥 확인 필요 · 가격 어긋남 2곳' && /\(어제부터\) \[자사몰 ↔ 네이버\] 황금향 선물용 3kg/.test(t.message) && /\[쿠팡 ↔ 네이버\]/.test(t.message) && /전체 가격 확인하기/.test(t.message), '가격 글 꼴 · 어제부터 남은 것 표시', t.message); }
    ok(SA.priceText(SA.priceDiff({ ok: true, groups: [{ key: 'a', label: 'a', issues: [{ kind: 'stale', detail: 'x' }] }] }, {}), []) === null, '어긋남 0 = 안 보냄');
    ok(SA.priceDiff({ ok: false, error: '스냅샷 없음' }).ok === false && SA.priceText(SA.priceDiff({ ok: false })) === null, '조회 실패 = 안 보냄(로그만)');
    { const t = SA.priceText(SA.priceDiff(Object.assign({}, rep, { source: { coupang: 'none' } }), {}), []); ok(/쿠팡은 이번에 못 읽음/.test(t.message), '쿠팡 못 읽음 꼬리'); }

    console.log('④ 묵은 미답변');
    const now = at('2026-11-11T09:00');
    const it = [
        { ch: 'talk', id: 'a', title: '톡톡 손님 1234', last_at: new Date(at('2026-11-11T05:30')).toISOString(), last_text: '송장번호 알려주세요' },
        { ch: 'sms', id: '9', title: '문자 …5678', last_at: new Date(at('2026-11-10T21:00')).toISOString(), last_text: '귤이 물러서 왔어요' },
        { ch: 'qna', id: 'q1', title: '타이벡', last_at: new Date(at('2026-11-11T07:00')).toISOString(), last_text: '언제 와요' },
        { ch: 'inquiry', id: 'i1', title: '황금향', last_at: new Date(at('2026-11-11T06:01')).toISOString(), last_text: '주소 변경' }];
    const s1 = SA.staleUnanswered(it, now, { stale_hours: 3 }, ['talk:a', 'talk:zz']);
    ok(s1.items.length === 2 && s1.items[0].ch === 'sms' && s1.by.sms === 1 && s1.by.talk === 1 && !s1.by.qna && !s1.by.inquiry, '3시간 넘은 것만(06:01·07:00 은 아직) · 오래된 순');
    ok(s1.remain === 1 && s1.fresh === 1 && s1.done === 1, '지난번 뒤 처리 1(zz) · 남음 1(a) · 새로 1(sms)');
    { const t = SA.staleText(s1, '11/11 09시'); ok(t.title === '🟥 확인 필요 · 3시간 넘게 답 안 한 문의 2건 (11/11 09시)' && /지난번 뒤 처리 1건 · 아직 남음 1건 · 새로 1건/.test(t.message) && /문자 …5678 · 21:00\(11\/10\)/.test(t.message) && /\n→ 손님 연락 미처리에서 답하기$/.test(t.message), '미답변 글 꼴', t.message); }
    ok(SA.staleText(SA.staleUnanswered([], now, {}, []), 'x') === null, '0건·지난번도 0 = 안 보냄');
    { const t = SA.staleText(SA.staleUnanswered([], now, {}, ['talk:a']), '11/11 15시'); ok(t && t.level === 'info' && /모두 처리됐어요/.test(t.message), '지난번 알린 것이 다 처리됨 = 「정리됨」 한 통(빨강 아님)'); }

    console.log('⑤ 답변 재료 점검');
    const ms = SA.materialSignals({ nowMs: at('2026-12-30T09:00'), cfg: {},
        knowledge: [{ id: 1, item_key: '노지감귤', label: '판매 중', start_md: '11-01', end_md: '01-01', enabled: true }, { id: 2, item_key: '한라봉', label: '판매', start_md: '01-01', end_md: '03-31', enabled: true }, { id: 3, item_key: '전체', label: 'x', start_md: '01-01', end_md: '12-31', enabled: true }, { id: 4, item_key: '꺼짐', label: 'x', start_md: '12-30', end_md: '12-31', enabled: false }, { id: 5, item_key: '체험', label: '운영', start_md: '11-01', end_md: '12-30', enabled: true }],
        logs: [{ id: 10, user_id: 'u1', message: '황금향 언제까지', bot_response: '12월까지예요', staff_response: null, scenario_name: '품목-황금향' }, { id: 11, user_id: 'u1', message: '네', bot_response: '[쿨다운-무응답]', staff_response: '위에 AI 자동답변이예요ㅠㅠ 1월까지예요' },
               { id: 12, user_id: 'u2', message: '감사', bot_response: '감사합니다', staff_response: '네 감사합니다 ^^' }],
        products: [{ id: 7, name: '노지 황금향 가정용 5kg', status: '품절', updated_at: new Date(at('2026-12-30T08:00')).toISOString() }, { id: 8, name: '레몬 3kg', status: '판매중', updated_at: new Date(at('2026-12-20T08:00')).toISOString() }],
        scenarios: [{ id: 37, scenario_no: 36, name: '품목-황금향', response: '노지 황금향 판매 중', enabled: true, updated_at: new Date(at('2026-12-01T00:00')).toISOString() }, { id: 59, scenario_no: 54, name: '명절 마감', response: '12월 20일 주문분까지 · 1/5 발송', enabled: true, updated_at: new Date(at('2026-12-01T00:00')).toISOString() }, { id: 60, scenario_no: 55, name: '꺼진 글', response: '12월 1일', enabled: false, updated_at: new Date(at('2026-12-01T00:00')).toISOString() }] });
    const kinds = ms.map(x => x.kind + ':' + x.key.split(':')[1]).sort();
    ok(ms.some(x => x.key === 'season-end:1:01-01' && /2일 뒤 끝/.test(x.text)), '해 넘김 끝(12/30 → 1/1 = 2일 뒤)', JSON.stringify(kinds));
    ok(ms.some(x => x.key === 'season-start:2:01-01' && /2일 뒤 시작/.test(x.text)), '해 넘김 시작');
    ok(ms.some(x => x.key === 'season-end:5:12-30' && /오늘 끝/.test(x.text)), '오늘 끝');
    ok(!ms.some(x => /:3:|:4:/.test(x.key)), '1년 내내 줄·꺼진 줄 뺌');
    ok(ms.some(x => x.key === 'fix:10' && /품목-황금향/.test(x.text)) && !ms.some(x => x.key === 'fix:12'), '봇 답 뒤 직원 정정(다음 줄) 잡음 · 평범한 직원 답은 안 잡음');
    ok(ms.some(x => x.kind === 'status' && /노지 황금향 가정용 5kg」 → 품절/.test(x.text) && /#36/.test(x.text)) && !ms.some(x => x.kind === 'status' && /레몬/.test(x.text)), '판매 상태 바뀜(하루 안) + 그 뒤 안 고친 재료 · 오래된 변경은 안 봄');
    ok(ms.some(x => x.kind === 'date' && /#54/.test(x.text) && /12월 20일/.test(x.text)) && !ms.some(x => x.kind === 'date' && /#55/.test(x.text)), '지난 날짜 글(켜진 줄만 · 「1/5」 는 앞날이라 안 잡음)');
    { const t = SA.materialText(ms, [ms[0].key, 'gone-key']); ok(t.title === `🟥 확인 필요 · 답변 재료 점검 ${ms.length}건` && /지난번 뒤 처리 1건 · 아직 남음 1건/.test(t.message) && /\(남음\)/.test(t.message) && /\n→ 문의 관리 답변 재료에서 그 줄 고치기$/.test(t.message), '재료 글 꼴', t.message); }
    ok(SA.materialText([], []) === null, '0건 = 안 보냄');

    console.log('⑥ 어제 클레임 요약');
    const b1 = SA.claimBrief({ open: 3, claimWords: ['파손', '썩', '곰팡이', '물러', '환불', '반품', '교환', '안 왔', '터졌'],
        rows: { sms: [{ key: 't1', text: '귤이 물러서 왔어요' }, { key: 't1', text: '타이벡이에요 곰팡이도' }, { key: 't2', text: '감사합니다' }],
                talk: [{ key: 'u1', text: '황금향 박스가 터졌어요' }, { key: 'u2', text: '언제 와요' }], qna: [{ key: 'q', text: '반품 되나요' }], inquiry: [] },
        claims: [{ claim_kind: 'RETURN' }, { claim_kind: 'RETURN' }, { claim_kind: 'EXCHANGE' }] });
    ok(b1.total === 3 && b1.ch.sms === 1 && b1.ch.talk === 1 && b1.ch.qna === 1 && b1.ch.inquiry === 0, '손님 하나 = 1건(문자 같은 대화 두 글 = 1) · 클레임 낱말 없는 글 뺌');
    ok(b1.reason['무름'] === 1 && b1.reason['곰팡이·부패'] === 1 && b1.reason['파손'] === 1 && b1.item['타이벡'] === 1 && b1.item['황금향'] === 1, '사유·품목 묶음');
    { const t = SA.claimText(b1, '2026-11-10'); ok(t.title === '어제 클레임 요약 (11/10)' && /클레임 글 3건 \(문자 1 · 톡톡 1 · 상품문의 1 · 고객문의 0\)/.test(t.message) && /반품 신청 2 · 교환 신청 1/.test(t.message) && /지금 미답변 3건/.test(t.message) && !/포인트/.test(t.message) && t.level === 'alert', '요약 글 꼴 · 포인트 없음 · 미답변 있으면 빨강', t.message); }
    { const t = SA.claimText(SA.claimBrief({ rows: {}, claims: [], open: 0 }), '2026-11-10'); ok(/클레임 글 0건/.test(t.message) && !/품목:/.test(t.message) && t.level === 'info', '0건 = 숫자만 · 보통 알림'); }

    console.log('⑦ 정산');
    ok(SA.settleText({ last_run_at: new Date(at('2026-11-11T09:31')).toISOString(), last_status: 'failed', last_error: 'relay 504' }, '2026-11-11').title === '🟥 확인 필요 · 정산 자동 수집 실패', '오늘 실패 = 알림');
    ok(SA.settleText({ last_run_at: new Date(at('2026-11-11T09:31')).toISOString(), last_status: 'ok' }, '2026-11-11') === null, '오늘 성공 = 없음');
    ok(SA.settleText({ last_run_at: new Date(at('2026-11-10T09:31')).toISOString(), last_status: 'failed' }, '2026-11-11') === null, '어제 실패 = 오늘은 안 봄');

    console.log('⑧ run(가짜 DB)');
    const mkPool = (cfg) => { const store = { staff_alerts: cfg, keyword_rank_last: null, staff_alerts_state: {} }; return { store, query: async (sql, p) => {
        if (/SELECT value FROM agent_office_config/.test(sql)) return { rows: store[p[0]] != null ? [{ value: store[p[0]] }] : [] };
        if (/INSERT INTO agent_office_config.*'done'/s.test(sql)) { const d = store.staff_alerts_state.done = store.staff_alerts_state.done || {}; if (d[p[0]]) return { rows: [] }; d[p[0]] = 1; return { rows: [{ key: 1 }] }; }
        if (/INSERT INTO agent_office_config.*'mem'/s.test(sql)) { const m = store.staff_alerts_state.mem = store.staff_alerts_state.mem || {}; m[p[0]] = JSON.parse(p[1]); return { rows: [] }; }
        if (/UPDATE agent_office_config/.test(sql) && /jsonb_each/.test(sql)) { store.gcCalls = (store.gcCalls || 0) + 1; return { rows: [] }; }   // 30일 표식 정리
        if (/UPDATE agent_office_config/.test(sql) && /'\{tries\}'/.test(sql)) { const st = store.staff_alerts_state; if (st.done) delete st.done[p[0]]; st.tries = st.tries || {}; st.tries[p[0]] = (st.tries[p[0]] || 0) + 1; return { rows: [{ n: st.tries[p[0]] }] }; }   // 실패 = 표식 걷고 시도 수 +1
        if (/FROM sms_threads/.test(sql)) return { rows: [] };
        if (/FROM naver_auto_collect/.test(sql)) return { rows: [{ last_run_at: new Date(at('2026-11-11T09:31')).toISOString(), last_status: 'failed', last_error: 'x' }] };
        return { rows: [] }; } }; };
    const sent = []; const notify = async (...a) => { sent.push(a); };
    { const pool = mkPool({ enabled: false }); const r = await SA.run({ pool, notify, routes: NR({ pool: { query: async () => ({ rows: [{ value: { settle_error: [5] } }] }) } }), now: () => at('2026-11-11T10:30') }); ok(r.skipped === 'off' && sent.length === 0, '스위치 꺼짐 = 아무것도 안 함'); }
    { const pool = mkPool({ enabled: true }); sent.length = 0;
      const routes = NR({ pool: { query: async () => ({ rows: [{ value: { settle_error: [5], cs_stale: [6, 7] } }] }) } });
      await SA.run({ pool, notify, routes, inbox: { _talkThreads: async () => [], _postThreads: async () => [] }, now: () => at('2026-11-11T10:30') });
      const settle = sent.filter(x => x[1] === 'settle_error');
      ok(settle.length === 1 && settle[0][0] === 5 && /^🟥 확인 필요/.test(settle[0][2]) && settle[0][4] === 'settlement' && settle[0][5] === 'alert', '정산 실패 = 가영(5)에게 1통 · 빨강 · link');
      ok(!sent.some(x => x[1] === 'cs_stale'), '미답변 0건 = 안 보냄');
      ok(!sent.some(x => x[1] === 'cs_claim_brief'), '받는 사람 칸 없는 종류(cs_claim_brief) = 안 보냄');
      sent.length = 0; await SA.run({ pool, notify, routes, inbox: { _talkThreads: async () => [], _postThreads: async () => [] }, now: () => at('2026-11-11T10:31') });
      ok(!sent.some(x => x[1] === 'settle_error'), '같은 날 두 번째 틱 = 한 번 표식으로 안 보냄'); }
    { const pool = mkPool({ enabled: true }); sent.length = 0;
      const routes = NR({ pool: { query: async () => ({ rows: [{ value: { cs_stale: [6, 7] } }] }) } });
      const inbox = { _talkThreads: async () => [{ id: 'a', title: '톡톡 손님 1', last_at: new Date(at('2026-11-11T05:00')).toISOString(), last_text: '언제 와요' }], _postThreads: async () => [] };
      await SA.run({ pool, notify, routes, inbox, now: () => at('2026-11-11T09:05') });
      const st = sent.filter(x => x[1] === 'cs_stale'); ok(st.length === 2 && st.map(x => x[0]).join() === '6,7' && /3시간 넘게 답 안 한 문의 1건/.test(st[0][2]), '09시 묶음 = 지현·승협 둘에게 1통씩');
      sent.length = 0; await SA.run({ pool, notify, routes, inbox: { _talkThreads: async () => [], _postThreads: async () => [] }, now: () => at('2026-11-11T15:10') });
      const st2 = sent.filter(x => x[1] === 'cs_stale'); ok(st2.length === 2 && /모두 처리됐어요/.test(st2[0][3]), '15시 = 지난번 것 처리됨 「정리됨」'); }
    { const pool = mkPool({ enabled: true }); sent.length = 0; pool.store.keyword_rank_last = { date: '2026-11-11', notified_date: '2026-11-11', errors: [] };
      const q0 = pool.query; pool.query = async (sql, p) => /FROM keyword_rankings/.test(sql) ? { rows: [{ d: '2026-11-10', keyword: '황금향', shopping_rank: 5 }, { d: '2026-11-11', keyword: '황금향', shopping_rank: null }] } : q0(sql, p);
      const routes = NR({ pool: { query: async () => ({ rows: [{ value: { rank_alert: [3] } }] }) } });
      await SA.run({ pool, notify, routes, inbox: {}, now: () => at('2026-11-11T09:40') });
      const rk = sent.filter(x => x[1] === 'rank_alert'); ok(rk.length === 1 && rk[0][0] === 3 && /사라짐/.test(rk[0][3]) && rk[0][4] === 'rankings', '순위 사라짐 = 민주(3)에게 1통');
      ok(pool.store.staff_alerts_state.mem.rank.sent['황금향'] === 'gone', '알린 것 기억(다음 날 같은 문제 거름)'); }

    console.log('⑨ 쉬는 날(토·일·공휴일)');
    const HS = SA.holidaySetOf({ seed: require(path.join(ROOT, 'shipping-schedule.js')).HOLIDAYS, cfgDays: ['2027-01-01', 'x'], shippingRows: [{ d: '2026-11-19', reason: '태풍 임시휴무' }, { d: '2027-02-08', reason: '설날 연휴' }], fromShipping: true });
    ok(SA.isOffDay('2026-11-14', HS) && SA.isOffDay('2026-11-15', HS) && !SA.isOffDay('2026-11-16', HS), '토·일 쉼 · 월 근무');
    ok(SA.isOffDay('2026-12-25', HS) && SA.isOffDay('2026-10-05', HS), '시드 공휴일·대체공휴일 쉼');
    ok(SA.isOffDay('2027-01-01', HS) && SA.isOffDay('2027-02-08', HS) && !HS.has('x'), '설정 날짜·발송 휴무일 표의 공휴일 이름 줄 쉼(꼴 틀린 값 버림)');
    ok(SA.isOffDay('2026-11-19', HS), '발송 휴무일 달력에 체크한 날 = 휴무(사유가 태풍 임시휴무여도 · 대표 11/11 「발송 휴무일 체크한 건도 휴무」)');
    { const H2 = SA.holidaySetOf({ seed: [], cfgDays: [], shippingRows: [{ d: '2026-11-19', reason: '태풍 임시휴무', no_ship: true }, { d: '2026-11-20', reason: '택배사 휴무', no_ship: false }, { d: '2027-02-08', reason: '설날', no_ship: true }], fromShipping: 'names' });
      ok(!H2.has('2026-11-19') && H2.has('2027-02-08'), "holidays_from_shipping 'names' = 공휴일 이름 줄만"); }
    ok(!SA.holidaySetOf({ seed: [], cfgDays: [], shippingRows: [{ d: '2026-11-20', reason: '택배사 휴무', no_ship: false }], fromShipping: true }).has('2026-11-20'), '도착 불가만 체크(no_ship false)한 날 = 휴무 아님');
    ok(!SA.holidaySetOf({ seed: [], cfgDays: [], shippingRows: [{ d: '2027-02-08', reason: '설날' }], fromShipping: false }).has('2027-02-08'), 'holidays_from_shipping false = 발송 휴무일 표 안 봄');
    { const W = { default: [1, 2, 3, 4, 5], users: { '7': [2, 3, 4, 5, 6] } }, WDm = require(path.join(ROOT, 'workdays.js'));
      ok(!WDm.isOffFor(7, '2026-11-14', W, HS) && WDm.isOffFor(7, '2026-11-16', W, HS) && WDm.isOffFor(6, '2026-11-14', W, HS) && !WDm.isOffFor(6, '2026-11-16', W, HS), '사람별 근무 요일 = 승협(7) 토 근무·월 쉼 · 지현(6) 토 쉼·월 근무');
      ok(WDm.prevWorkdayFor(7, '2026-11-17', W, HS) === '2026-11-14' && WDm.prevWorkdayFor(6, '2026-11-16', W, HS) === '2026-11-13', '지난 근무일 = 승협 화요일 → 토 · 지현 월요일 → 금');
      ok(WDm.isOffFor(7, '2026-11-19', W, HS), '달력 휴무가 사람별 근무 요일보다 우선(승협 근무일인 목요일이라도 달력 휴무면 쉼)');
      ok(JSON.stringify(WDm.daysOf({ users: { '9': 'x' } }, 9)) === '[1,2,3,4,5]' && JSON.stringify(WDm.daysOf(null, 3)) === '[1,2,3,4,5]', '설정 없음·꼴 틀림 = 월~금'); }
    ok(SA.prevWorkday('2026-11-16', HS) === '2026-11-13' && SA.prevWorkday('2026-11-11', HS) === '2026-11-10' && SA.prevWorkday('2026-10-06', HS) === '2026-10-02', '지난 근무일 = 월요일 → 금 · 평일 → 어제 · 대체공휴일 낀 화요일 → 앞 금');
    ok(SA.claimText(SA.claimBrief({ rows: {}, claims: [], open: 0 }), '2026-11-15', '2026-11-13').title === '클레임 요약 (11/13~11/15 · 3일치)' && SA.claimText(SA.claimBrief({ rows: {}, claims: [], open: 0 }), '2026-11-10', '2026-11-10').title === '어제 클레임 요약 (11/10)', '클레임 요약 제목 = 월요일 금~일 3일치 · 평일 어제');
    ok(/11\/16 · 11\/13 대비/.test(SA.rankText({ blocked: false, items: [{ keyword: '귤', kind: 'gone', y: 3, t: null }] }, '2026-11-16', '2026-11-13').title) && !/대비/.test(SA.rankText({ blocked: false, items: [{ keyword: '귤', kind: 'gone', y: 3, t: null }] }, '2026-11-11', '2026-11-10').title), '순위 제목 = 쉬는 날 뒤면 「M/D 대비」');
    ok(SA.materialSignals({ nowMs: at('2026-11-16T09:00'), sinceMs: at('2026-11-13T00:00'), knowledge: [], logs: [], scenarios: [{ id: 1, scenario_no: 1, name: '품목-황금향', response: '', enabled: true, updated_at: new Date(at('2026-11-01T00:00')).toISOString() }], products: [{ id: 9, name: '노지 황금향 5kg', status: '품절', updated_at: new Date(at('2026-11-14T10:00')).toISOString() }] }).some(x => x.kind === 'status'), '재료 = 주말 사이 판매 상태 바뀜도 월요일에(지난 근무일 0시부터)');
    { const pool = mkPool({ enabled: true }); sent.length = 0;
      const routes = NR({ pool: { query: async () => ({ rows: [{ value: { settle_error: [5], cs_stale: [6], cs_claim_brief: [6], rank_alert: [3] } }] }) } });
      const inbox = { _talkThreads: async () => [{ id: 'a', title: 't', last_at: new Date(at('2026-11-14T05:00')).toISOString(), last_text: 'x' }], _postThreads: async () => [] };
      const r = await SA.run({ pool, notify, routes, inbox, now: () => at('2026-11-14T10:30') });
      ok(r.skipped === 'holiday' && sent.length === 0, '토요일 = 아무것도 안 보냄(미답변·정산 실패 있어도)');
      ok((await SA.run({ pool, notify, routes, inbox, now: () => at('2026-12-25T09:05') })).skipped === 'holiday' && sent.length === 0, '성탄절(평일 공휴일) = 안 보냄');
      pool.store.keyword_rank_last = { date: '2026-11-16', notified_date: '2026-11-16', errors: [] };
      const asked = []; const q0 = pool.query; pool.query = async (sql, p) => { if (/FROM keyword_rankings/.test(sql)) { asked.push(p); return { rows: [{ d: '2026-11-13', keyword: '황금향', shopping_rank: 5 }, { d: '2026-11-16', keyword: '황금향', shopping_rank: null }] }; } if (/FROM sms_messages/.test(sql)) asked.push(['claim', p]); return q0(sql, p); };
      await SA.run({ pool, notify, routes, inbox, now: () => at('2026-11-16T09:40') });
      ok(asked.some(p => Array.isArray(p) && p[0] === '2026-11-16' && p[1] === '2026-11-13'), '월요일 순위 = 금요일 값과 비교', JSON.stringify(asked));
      const rk = sent.filter(x => x[1] === 'rank_alert'); ok(rk.length === 1 && /11\/13 대비/.test(rk[0][2]) && /사라짐/.test(rk[0][3]), '주말 사이 사라짐 = 월요일 1통');
      const cb = sent.filter(x => x[1] === 'cs_claim_brief'); ok(cb.length === 1 && cb[0][2] === '클레임 요약 (11/13~11/15 · 3일치)', '월요일 클레임 요약 = 금~일 3일치 제목', JSON.stringify(cb.map(x => x[2])));
      ok(asked.some(p => p[0] === 'claim' && p[1][0] === '2026-11-13 00:00' && p[1][1] === '2026-11-16 00:00'), '클레임 모을 기간 = 금 00:00 ~ 월 00:00(KST)');
      ok(sent.some(x => x[1] === 'cs_stale' && /답 안 한 문의 1건/.test(x[2])), '월요일 09시 미답변 = 주말에 쌓인 것 그대로'); }
    { // 승협(7) 화~토 · 지현(6) 월~금 — 같은 묶음(cs_stale)을 근무하는 날에만
      const pool = mkPool({ enabled: true, workdays: { default: [1, 2, 3, 4, 5], users: { '7': [2, 3, 4, 5, 6] } } }); sent.length = 0;
      const routes = NR({ pool: { query: async () => ({ rows: [{ value: { cs_stale: [6, 7], cs_claim_brief: [6] } }] }) } });
      const inbox = { _talkThreads: async () => [{ id: 'a', title: 't', last_at: new Date(at('2026-11-13T05:00')).toISOString(), last_text: 'x' }], _postThreads: async () => [] };
      const rSat = await SA.run({ pool, notify, routes, inbox, now: () => at('2026-11-14T09:05') });
      const satIds = sent.filter(x => x[1] === 'cs_stale').map(x => x[0]); ok(JSON.stringify(satIds) === '[7]' && !rSat.skipped, '토요일 = 승협만 미답변 받음(지현·클레임 요약 0)', JSON.stringify([satIds, rSat]));
      ok(!sent.some(x => x[1] === 'cs_claim_brief'), '토요일 클레임 요약(지현) = 안 감');
      sent.length = 0; await SA.run({ pool, notify, routes, inbox, now: () => at('2026-11-16T09:05') });
      const monIds = sent.filter(x => x[1] === 'cs_stale').map(x => x[0]); ok(JSON.stringify(monIds) === '[6]', '월요일 = 지현만 미답변(승협 쉼)', JSON.stringify(monIds));
      ok(sent.some(x => x[1] === 'cs_claim_brief' && x[0] === 6 && x[2] === '클레임 요약 (11/13~11/15 · 3일치)'), '월요일 지현 클레임 요약 = 금~일 3일치(토요일엔 안 보냈으니 그대로)');
      ok(/남음 1건/.test((sent.find(x => x[1] === 'cs_stale') || [])[3] || ''), '「남음」 기억 = 공용(토요일 승협에게 알린 것이 월요일 지현 글에 「남음」)', (sent.find(x => x[1] === 'cs_stale') || [])[3]);
      sent.length = 0; const rSun = await SA.run({ pool, notify, routes, inbox, now: () => at('2026-11-15T09:05') });
      ok(rSun.skipped === 'holiday' && !sent.length, '일요일 = 둘 다 쉼 = 0통'); }

    console.log('⑧-b 실패하면 다시(최대 3번) · 표식 정리');
    { const pool = mkPool({ enabled: true }); sent.length = 0;
      const routes = NR({ pool: { query: async () => ({ rows: [{ value: { price_alert: [5] } }] }) } });
      let calls = 0; const priceReport = async () => { calls++; return { ok: false, error: '쿠팡 중계 504' }; };
      const r1 = await SA.run({ pool, notify, routes, inbox: {}, priceReport, now: () => at('2026-11-11T10:05') });
      ok(calls === 1 && r1.done.some(x => /price:2026-11-11:retry1/.test(x)) && !pool.store.staff_alerts_state.done['price:2026-11-11'] && !sent.length, '1번째 실패 = 표식 걷음(다음 틱에 다시) · 알림 0', JSON.stringify(r1));
      await SA.run({ pool, notify, routes, inbox: {}, priceReport, now: () => at('2026-11-11T10:06') });
      ok(calls === 2 && !sent.length, '2번째 실패 = 또 다시');
      const r3 = await SA.run({ pool, notify, routes, inbox: {}, priceReport, now: () => at('2026-11-11T10:07') });
      const f = sent.filter(x => x[1] === 'price_alert');
      ok(calls === 3 && f.length === 1 && f[0][0] === 5 && f[0][2] === '🟥 확인 필요 · 오늘 3채널 가격 대조 못 함' && /3번 실패/.test(f[0][3]) && /쿠팡 중계 504/.test(f[0][3]) && /→ 전체 가격 확인하기에서 직접 확인/.test(f[0][3]) && f[0][4] === 'agent-office?price=1' && f[0][5] === 'alert', '3번째 실패 = 담당(민주)에게 실패 안내 1통(조용히 안 빠짐)', JSON.stringify(f));
      sent.length = 0; await SA.run({ pool, notify, routes, inbox: {}, priceReport, now: () => at('2026-11-11T10:08') });
      ok(calls === 3 && !sent.length, '그 뒤 = 그날은 더 안 함(표식 남음)');
      ok(pool.store.gcCalls === 1, '표식 정리 = 하루 1번(같은 날 4틱에 1번)', pool.store.gcCalls);
      let ok2 = 0; const good = async () => { ok2++; return { ok: true, groups: [] }; };
      const pool2 = mkPool({ enabled: true }); let n2 = 0; const flaky = async () => { n2++; if (n2 === 1) throw new Error('잠깐 끊김'); return { ok: true, groups: [] }; };
      await SA.run({ pool: pool2, notify, routes, inbox: {}, priceReport: flaky, now: () => at('2026-11-11T10:05') });
      await SA.run({ pool: pool2, notify, routes, inbox: {}, priceReport: flaky, now: () => at('2026-11-11T10:06') });
      ok(n2 === 2 && !!pool2.store.staff_alerts_state.done['price:2026-11-11'], '한 번 실패 뒤 다음 틱에 성공 = 끝(표식 남음 · 실패 안내 0)'); void ok2; void good; }

    console.log('⑩ 폰 푸시 보류(push.js · 가짜 DB · web-push 발송은 가짜)');
    {
        const wp = require(path.join(ROOT, 'node_modules', 'web-push')); const pushed = [];
        wp.sendNotification = async (sub, payload) => { pushed.push({ ep: sub.endpoint, p: JSON.parse(payload) }); return {}; };
        const realNow = Date.now; let fakeNow = at('2026-11-14T10:00');
        Date.now = () => fakeNow;
        const notes = [];   // { id, user_id, type, title, message, link, created_at(ms), pushed_at, push_held }
        let nid = 0; const add = (uid, type, title) => notes.push({ id: ++nid, user_id: uid, type, title, message: 'm', link: '', created_at: fakeNow, pushed_at: null, push_held: null });
        const cfg = { push_hold: true, workdays: { default: [1, 2, 3, 4, 5], users: { '7': [2, 3, 4, 5, 6] } } };
        const pool = { query: async (sql, p) => {
            if (/FROM agent_office_config WHERE key = 'webpush_vapid'/.test(sql)) return { rows: [] };
            if (/INSERT INTO agent_office_config/.test(sql)) return { rows: [] };
            if (/key = 'staff_alerts'/.test(sql)) return { rows: [{ value: cfg }] };
            if (/key = 'push_scope'/.test(sql)) return { rows: [] };
            if (/FROM shipping_holidays/.test(sql)) return { rows: [] };
            if (/CREATE TABLE|ALTER TABLE/.test(sql)) return { rows: [] };
            if (/UPDATE notifications SET pushed_at = NOW\(\)/.test(sql)) { const pick = notes.filter(n => !n.pushed_at).slice(0, 20); pick.forEach(n => { n.pushed_at = fakeNow; }); return { rows: pick.map(n => Object.assign({}, n, { fresh: fakeNow - n.created_at < 600000 })) }; }
            if (/UPDATE notifications SET push_held = true WHERE id/.test(sql)) { notes.find(n => n.id === p[0]).push_held = true; return { rows: [] }; }
            if (/SELECT DISTINCT user_id FROM notifications WHERE push_held = true/.test(sql)) return { rows: [...new Set(notes.filter(n => n.push_held).map(n => n.user_id))].map(u => ({ user_id: u })) };
            if (/UPDATE notifications SET push_held = false WHERE user_id/.test(sql)) { const g = notes.filter(n => n.user_id === p[0] && n.push_held); g.forEach(n => { n.push_held = false; }); return { rows: g.map(n => ({ type: n.type, md: (new Date(n.created_at + KST).getUTCMonth() + 1) + '/' + new Date(n.created_at + KST).getUTCDate(), created_at: new Date(n.created_at) })) }; }
            if (/FROM push_subscriptions WHERE user_id = \$1 AND label IS DISTINCT FROM/.test(sql)) return { rows: [{ id: p[0], endpoint: 'ep' + p[0], p256dh: 'x', auth: 'y' }] };
            if (/UPDATE push_subscriptions/.test(sql)) return { rows: [] };
            return { rows: [] }; } };
        const P = require(path.join(ROOT, 'push.js'))({ get() {}, post() {} }, { pool, authMiddleware: () => {} });
        // 토 10:00 = 지현(6) 쉼 · 승협(7) 근무 · 대표(1) 빼는 사람
        add(6, 'document_approved', '서류 승인'); add(7, 'desk', '지시 결과'); add(1, 'rank', '순위'); add(6, 'rank', '순위');
        await P.deliver();
        ok(pushed.map(x => x.ep).sort().join() === 'ep1,ep7' && notes.filter(n => n.push_held).map(n => n.id).join() === '1,4', '토요일 = 지현 알림 2건 보류(알림 종엔 그대로) · 승협·대표는 바로 푸시', JSON.stringify({ pushed: pushed.map(x => x.ep), held: notes.filter(n => n.push_held).map(n => n.id) }));
        pushed.length = 0; fakeNow = at('2026-11-15T09:00'); add(6, 'desk', '지시 결과'); await P.deliver();
        ok(!pushed.length && notes.filter(n => n.push_held).length === 3, '일요일 = 또 보류(3건) · 일요일엔 묶음도 안 냄');
        pushed.length = 0; fakeNow = at('2026-11-16T08:50'); await P.deliver();
        ok(!pushed.length, '월요일 08:50 = 아직(09:00 전)');
        pushed.length = 0; fakeNow = at('2026-11-16T09:00'); await P.deliver();
        const b = pushed.filter(x => x.ep === 'ep6');
        ok(b.length === 1 && /^쉬는 동안 알림 3건 \(11\/14~11\/15\)$/.test(b[0].p.title) && /지시 결과 1/.test(b[0].p.body) && /결재 결과 1/.test(b[0].p.body) && /순위 요약 1/.test(b[0].p.body) && !notes.some(n => n.push_held), '월요일 09:00 = 지현에게 한 통 「쉬는 동안 알림 3건 (11/14~11/15)」 + 종류별 건수 · 보류 표식 걷힘', JSON.stringify(b.map(x => x.p)));
        pushed.length = 0; fakeNow = at('2026-11-16T09:10'); await P.deliver(); ok(!pushed.length, '두 번째 틱 = 묶음 다시 안 냄(보류분 0)');
        pushed.length = 0; fakeNow = at('2026-11-16T10:00'); add(7, 'desk', 'x'); await P.deliver();
        ok(!pushed.length && notes.find(n => n.id === nid).push_held === true, '월요일 = 승협(화~토) 쉼 = 보류');
        pushed.length = 0; fakeNow = at('2026-11-17T09:02'); await P.deliver();
        ok(pushed.length === 1 && pushed[0].ep === 'ep7' && /쉬는 동안 알림 1건 \(11\/16\)/.test(pushed[0].p.title), '화요일 09:02 = 승협에게 1통(11/16)', JSON.stringify(pushed.map(x => x.p.title)));
        pushed.length = 0; fakeNow = at('2026-11-21T09:30'); add(6, 'document_approved', '서류 승인'); add(6, 'desk', 'z'); await P.deliver();
        ok(!pushed.length && notes.filter(n => n.push_held).length === 2, '토요일 = 지현 2건 보류(스위치 켠 채)');
        cfg.push_hold = false; pushed.length = 0; fakeNow = at('2026-11-21T10:00'); add(6, 'desk', 'y'); await P.deliver();
        const nw = pushed.filter(x => x.ep === 'ep6');
        ok(nw.length === 2 && nw.some(x => x.p.title === 'x' || x.p.title === 'y' || /지시/.test(x.p.title) || x.p.title.length) && nw.some(x => /^쉬는 동안 알림 2건 \(11\/21\)$/.test(x.p.title)) && !notes.some(n => n.push_held), '스위치 끔 = 새 알림은 바로 + 남은 보류분 2건을 그 틱에 한 통으로(토요일이어도)', JSON.stringify(nw.map(x => x.p.title)));
        pushed.length = 0; fakeNow = at('2026-11-21T10:05'); await P.deliver(); ok(!pushed.length, '끈 뒤 다음 틱 = 보류분 없음 = 0통');
        Date.now = realNow;
    }

    { // 순서 = 쉬는 동안 묶음 09:00 → 그날 새 직원 알림 09:01 부터
      const pool = mkPool({ enabled: true }); sent.length = 0;
      const routes = NR({ pool: { query: async () => ({ rows: [{ value: { cs_stale: [6], cs_claim_brief: [6] } }] }) } });
      const inbox = { _talkThreads: async () => [{ id: 'a', title: 't', last_at: new Date(at('2026-11-16T05:00')).toISOString(), last_text: 'x' }], _postThreads: async () => [] };
      await SA.run({ pool, notify, routes, inbox, now: () => at('2026-11-16T09:00') });
      ok(!sent.length, '09:00 정각 = 새 직원 알림 아직(쉬는 동안 묶음이 먼저 나가는 자리)');
      await SA.run({ pool, notify, routes, inbox, now: () => at('2026-11-16T09:01') });
      ok(sent.some(x => x[1] === 'cs_stale') && sent.some(x => x[1] === 'cs_claim_brief'), '09:01 = 미답변·클레임 요약 나감'); }

    console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
