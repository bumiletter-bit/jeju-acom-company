// #708-B(대표 10/15 「지금 구도대로 고」) 이벤트 관리 — 회사프로그램 안 메뉴(data-page="event" · #page-event)
//   직원이 터미널 없이 한 회차를 처음부터 끝까지: 머리띠(상태 · 준비 n/5 · 지난 회차 복사 · 새 회차) + 단계 카드 5개(#716 부터 · 종전 6개)
//   ①기간·제목 ②경품 ③그림 ④문구 ⑤열기·운영 · 미리보기 = 2단(본문 900↑)은 오른쪽 판 고정 · 한 줄(폰·폴드7 펼침)은 아래 떠 있는 단추 → 전체 화면 겹(#716 · 뒤로가기 = 겹만 닫힘 · app.js #678 .modal-overlay 규약).
//   #716: 글·그림을 고치면 미리보기가 그 장으로 저절로 넘어가고 postMessage 에 focus(고친 칸 이름 · lucky.html 이 그 자리를 강조)를 싣는다 — 손으로 고른 탭은 다음 입력이 오면 다시 자동(60초 보호 없음).
//   #718(대표 「직원 누구나 보고 바로 쓰게」): 「손님 화면 제목」 칸 삭제(회차 이름 하나 · 저장 몸에 display_title 안 보냄) · 드물게 쓰는 칸은 카드 안 「더 보기」(details · 기본 닫힘 · 값이 있으면 처음 열림)
//     ① 페이지 내리는 날·추첨 제외 연락처 ② 경품 손글씨 한마디·품목 사진 관리 ④ 손글씨 5곳·봇 답·쿠폰·알림톡 카드(④ 는 기본이 자동 글이라 한 줄 안내만) · 미리보기 판 = 링크 복사 · ⑤ 아래 [초기화] 중복 삭제(머리띠 것만).
//   저장은 「초안」(손님에게 안 보임) · [이벤트 열기]가 손님 페이지·/guide 카드·봇 답(#59)에 한 번에 반영(서버 lucky-event.js).
//   서버 계약 = docs/708-event-design.md 3절(관리 API /api/agent-office/lucky/* · 응답 {ok, db}) · 미리보기 = iframe /lucky.html?preview=1 에 postMessage(초안 그대로 · 서버 왕복 0).
//   그림 = 브라우저가 canvas 로 webp 로 줄여 POST /assets · 「AI로 그림 맡기기」 = 에이전트 오피스 지시([이벤트그림] 머리말) → 후보(report_files) → [이 그림 쓰기].
(function () {
    'use strict';
    const A = '/api/agent-office/lucky';
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const toast = (m, t, ms) => { if (typeof showToast === 'function') showToast(m, t, ms); };
    const tokenHdr = () => ({ Authorization: 'Bearer ' + (localStorage.getItem('jwt_token') || '') });
    const call = async (url, method, body) => {
        const h = tokenHdr(); if (body) h['Content-Type'] = 'application/json';
        let r, j = null;
        try { r = await fetch(url, { method: method || 'GET', headers: h, body: body ? JSON.stringify(body) : undefined }); } catch (e) { return { ok: false, status: 0, body: { error: '인터넷 연결을 확인해 주세요' } }; }
        try { j = await r.json(); } catch (e) { j = null; }
        return { ok: r.ok && !!j && j.ok !== false, status: r.status, body: j || {} };
    };
    const errText = b => { const e = b && (b.message || b.error); const M = { SERVER: '서버 오류가 났어요. 잠시 뒤 다시 해 주세요', CONFIRM: '확인이 필요해요', BAD: '보낸 값이 올바르지 않아요', PREPARING: '이벤트가 아직 열리지 않았어요', CLOSED: '이벤트가 내려갔어요' }; return M[e] || e || '저장하지 못했어요'; };
    const clone = o => JSON.parse(JSON.stringify(o == null ? null : o));
    const kstToday = () => { const d = new Date(Date.now() + 9 * 3600e3); return d.toISOString().slice(0, 10); };
    const addDays = (ymd, n) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return ''; const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const md = ymd => /^\d{4}-\d{2}-\d{2}$/.test(ymd || '') ? `${+ymd.slice(5, 7)}/${+ymd.slice(8, 10)}` : '';
    const mdw = ymd => { if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return ''; const d = new Date(ymd + 'T00:00:00Z'); return `${md(ymd)}(${'일월화수목금토'[d.getUTCDay()]})`; };
    const digits = s => String(s || '').replace(/\D/g, '');

    // 손님 페이지(lucky.html) 지금 박힌 글자 = 비었을 때 기본값(설계 2-4) — 화면은 이 글을 흐린 안내(placeholder)로 보여 준다
    const TEXT_DEFAULT = {
        prize_head_hand: '제주의 좋은 마음을 선물합니다! ♡',
        corner_hand: '늘 함께해 주셔서\n감사합니다! ♡',
        search_hand: '성함·번호로 확인해보세요! ♡',
        winner_hand: '함께해 주신 모든 분께 감사드립니다! ♡',
        winner_foot: '당첨되신 분께는 순차적으로 연락드리며, 경품은 주문 시 배송지로 보내드립니다 🍊',
    };
    // 셋째 = 글자 상한(서버 120) · 넷째 = 줄바꿈 칸(textarea)
    const TEXT_LABEL = [
        ['prize_head_hand', '경품 카드 위 손글씨', 40],
        ['corner_hand', '오른쪽 아래 손글씨', 40, true],
        ['search_hand', '조회 칸 손글씨', 40],
        ['winner_hand', '발표 창 손글씨', 40],
        ['winner_foot', '발표 창 아래 안내', 120, true],
    ];
    // where = 손님 화면 어디에 쓰이는지(#711 · 결과·발표·상단 혼동 방지)
    const SLOTS = {
        hero: { label: '상단 그림', w: 1200, h: 350, pose: '상자들기', field: 'hero_image_id', where: '손님 페이지 맨 위 배너 · 제목은 그림 안에(#718 배너 아래 큰 제목 없앰)' },
        winner: { label: '발표 그림', w: 900, h: 471, pose: '기쁨', field: 'winner_image_id', where: '당첨자 발표 창 맨 위' },
        result: { label: '조회 결과 그림', w: 400, h: 400, pose: '인사', field: 'result_image_id', where: '조회 결과 장(접수됨·당첨·미당첨·대상 아님) 왼쪽 아꼼이 자리' },
        prize: { label: '경품 그림', w: 480, h: 480, pose: '귤들기', field: 'image_id' },
        brand: { label: '품목 사진', w: 480, h: 480 },
    };
    const POSES = ['인사', '귤들기', '상자들기', '기쁨', '엄지척', '안내'];
    const BRAND_FALLBACK = ['고당도 하우스귤', '그린레몬', '노란레몬', '유라조생', '황금향', '레드키위'];
    // 품목 알아보기(#709) — ①사진 이름(label)이 경품 이름에 글자 그대로 들어 있으면 그 사진(가장 긴 이름) ②없으면 같은 낱말 묶음 ③어느 묶음에도 안 들면 붙이지 않음
    //   🔴 맨 「귤」·「감귤」은 묶음에 넣지 않는다 — 다른 품목 사진이 손님 화면에 붙지 않게(업무지식 「유라를 하우스 사진으로 대신하지 않는다」 · 청귤에 하우스 사진 금지)
    const ITEM_GROUPS = [['청귤', '풋귤'], ['황금향'], ['한라봉'], ['천혜향'], ['레드향'], ['레드키위', '키위'], ['노란레몬'], ['그린레몬', '레몬'], ['노지감귤', '노지', '유라조생', '유라'], ['하우스감귤', '하우스귤', '하우스']];
    const gRank = name => { const i = ITEM_GROUPS.findIndex(g => g.includes(name)); return i < 0 ? 99 : i; };
    // /products 묶음(판매현황에 있는 품목) + 그 응답에 없는 화면 10개 표 묶음(지금 판매현황에 행이 없어도 사진 매칭은 유지)
    const groupsNow = () => {
        const local = ITEM_GROUPS.map(g => ({ name: g[0], words: g }));
        if (!(S.products && S.products.groups.length)) return local;
        const srv = S.products.groups.map(g => ({ name: g.name, words: g.words.length ? g.words : [g.name] })), have = new Set(srv.flatMap(g => g.words));
        return srv.concat(local.filter(g => !g.words.some(w => have.has(w))));
    };
    function groupOf(s) {   // 묶음 번호(groupsNow 기준) · 「노지황금향」·「하우스황금향」 = 황금향(긴 낱말 · 같으면 #709 표 앞 순서)
        const n = String(s || '').replace(/\s+/g, ''); if (!n) return -1;
        let best = -1, bl = 0, br = 999;
        groupsNow().forEach((g, i) => { const l = Math.max(0, ...g.words.map(w => String(w).replace(/\s+/g, '')).filter(w => w && n.includes(w)).map(w => w.length)); if (!l) return; const r = gRank(g.name); if (l > bl || (l === bl && r < br)) { best = i; bl = l; br = r; } });
        return best;
    }
    const STEP_TITLE = ['', '기간·제목', '경품', '그림(상단·발표·조회 결과)', '문구', '열기·운영'];   // #716 ⑤ 미리보기 카드 없앰(2단 = 오른쪽 판 · 한 줄 = 떠 있는 단추) → ①~⑤
    const STEPS = [1, 2, 3, 4, 5];
    const STATE_LABEL = { preparing: ['준비 중', 'ev-pill-off'], scheduled: ['예약됨', 'ev-pill-wait'], live: ['진행 중', 'ev-pill-ok'], published: ['발표 중', 'ev-pill-ok'], down: ['내려감', 'ev-pill-off'] };
    const AD_WORDS = /할인|쿠폰|%|\d\s*원/;   // /guide 카드 글엔 넣지 않음(광고성 선 · 설계 5절)

    const S = {
        db: null, id: null, ev: null, excluded: [], dirty: false, saving: false, loadErr: '',
        rounds: null, assets: [], open: new Set([1]), view: 'default', frame: 'phone',
        cand: {}, busy: '', ordersPending: [], previewTimer: 0, mounted: false, pvOpen: false, focus: '', more: null,
    };
    // #718 「더 보기」 처음 열림 = 그 안 칸에 기본값 아닌 값이 있을 때(한 번만 셈 · 그 뒤는 직원이 연/닫은 대로)
    function seedMore() {
        if (S.more) return; S.more = new Set();
        const e = S.ev || {}, tx = e.texts || {};
        if (S.excluded.length || (e.page_until && e.announce && e.page_until !== addDays(e.announce, 3))) S.more.add('1');
        if ((e.prizes || []).some(p => String(p.note || '').trim())) S.more.add('2');
        if (TEXT_LABEL.some(([k]) => String(tx[k] || '').trim() && String(tx[k]).trim() !== TEXT_DEFAULT[k]) || String(e.coupon_text || '').trim() || (e.bot_reply && e.bot_reply.custom) || (e.guide_card && e.guide_card.custom)) S.more.add('4');
    }
    const moreHtml = (k, label, inner) => `<details class="ev-more" data-more="${k}"${S.more && S.more.has(k) ? ' open' : ''}><summary>더 보기 · ${label}</summary><div class="ev-more-b">${inner}</div></details>`;

    // ── 서버 값 → 초안(ev) ─────────────────────────────────
    function takeDb(db, id, body) {
        S.db = db; if (id != null) S.id = id;
        S.srvState = body && body.state || (db && (db.state || (db.event && db.event.state))) || null;
        S.srvCheck = body && body.checklist || null;
        const e = clone((db && db.event) || {});
        e.prizes = Array.isArray(e.prizes) ? e.prizes : [];
        e.texts = Object.assign({}, e.texts || {});
        e.guide_card = Object.assign({ enabled: true, title: '', lines: ['', '', ''], btn: '접수·당첨 확인 바로가기', custom: false }, e.guide_card || {});
        e.bot_reply = Object.assign({ enabled: true, keywords: [], response: '', custom: false }, e.bot_reply || {});
        e.pending_art = Array.isArray(e.pending_art) ? e.pending_art : [];
        e.excludeProducts = Array.isArray(e.excludeProducts) ? e.excludeProducts : [];
        if (!e.page_until && e.announce) e.page_until = addDays(e.announce, 3);
        S.ev = e; S.excluded = Array.isArray(db && db.excluded) ? db.excluded.slice() : [];
        S.dirty = false; seedMore();
    }
    // 서버 state(설계 2-3)가 있으면 그것 · 없으면 같은 규칙으로 계산(옛 서버)
    function stateOf() {
        const e = S.ev || {}; const s = S.srvState;
        if (s) return s === 'preparing' && e.live_mode === 'scheduled' ? 'scheduled' : s;   // 서버는 예약을 preparing 으로 셈 → 화면만 「예약됨」
        const t = kstToday(), m = e.live_mode || '';
        if (m === 'down' || (e.page_until && t > e.page_until)) return 'down';
        if (m === 'live' || (m === 'scheduled' && e.start && t >= e.start)) return e.published ? 'published' : 'live';
        if (m === 'scheduled') return 'scheduled';
        return 'preparing';
    }
    const isOpen = () => ['live', 'published'].includes(stateOf());

    // ── 그림 주소 ─────────────────────────────────────────
    const assetById = id => S.assets.find(a => String(a.id) === String(id));
    const assetUrl = id => { if (!id) return ''; const a = assetById(id); return a && a.url ? a.url : `/api/lucky/asset/${encodeURIComponent(id)}${a && a.sha1 ? '?v=' + a.sha1 : ''}`; };
    const brandAssets = () => S.assets.filter(a => a.slot === 'brand');
    const brandNames = () => { const n = brandAssets().map(a => a.label).filter(Boolean); return n.length ? [...new Set(n)] : BRAND_FALLBACK; };
    // 경품 이름에서 품목을 알아봄(설계 0-ㄷ) — 「브랜드」 실사진이 올라가 있으면 그 그림
    function brandFor(name) {
        const n = String(name || '').replace(/\s+/g, ''); if (!n) return null;
        const all = brandAssets().slice().sort((x, y) => y.id - x.id);   // 같은 이름이면 최근 것
        const exact = all.filter(x => { const l = String(x.label || '').replace(/\s+/g, ''); return l && n.includes(l); }).sort((x, y) => String(y.label).length - String(x.label).length)[0];
        if (exact) return { id: exact.id, name: exact.label };
        const g = groupOf(name); if (g < 0) return null;
        const a = all.find(x => groupOf(x.label) === g);
        return { id: a ? a.id : null, name: a ? a.label : groupsNow()[g].name };
    }
    const prizeImg = p => {
        if (p && p.image_id) { const a = assetById(p.image_id); return { url: assetUrl(p.image_id), how: a && a.slot === 'brand' ? '품목 사진' : '올린 그림' }; }
        const b = brandFor(p && p.name);
        if (b && b.id) return { url: assetUrl(b.id), how: `품목 사진 자동(${b.name})` };
        return null;
    };

    // ── 준비 상태(설계 1-3 완료 기준 · 서버 checklist 가 오면 그 값 우선) ──
    function check() {
        const e = S.ev || {}, out = {};
        const t = (e.title || '').trim();   // #718 손님 화면 제목 칸 없음 → 회차 이름 하나
        const miss1 = [];
        if (!t) miss1.push('회차 이름'); if (!e.start) miss1.push('응모 시작'); if (!e.end) miss1.push('응모 끝'); if (!e.announce) miss1.push('발표일'); if (!e.page_until) miss1.push('내리는 날');
        if (!miss1.length && !(e.start <= e.end && e.end <= e.announce && e.announce <= e.page_until)) miss1.push('날짜 순서(시작 ≤ 끝 ≤ 발표 ≤ 내림)');
        out[1] = { ok: !miss1.length, miss: miss1, sum: miss1.length ? '빠짐: ' + miss1.join(' · ') : `${mdw(e.start)} ~ ${mdw(e.end)} · 발표 ${mdw(e.announce)} · 내림 ${mdw(e.page_until)}` };
        const ps = e.prizes || [], miss2 = [];
        if (!ps.length) miss2.push('경품 1개 이상');
        ps.forEach((p, i) => { if (!String(p.name || '').trim()) miss2.push(`${i + 1}등 이름`); if (!(Number(p.count) > 0)) miss2.push(`${i + 1}등 인원`); if (!prizeImg(p)) miss2.push(`${i + 1}등 그림`); });
        const people = ps.reduce((a, p) => a + (Number(p.count) || 0), 0);
        out[2] = { ok: !miss2.length, miss: miss2, sum: miss2.length ? '빠짐: ' + miss2.join(' · ') : `경품 ${ps.length}개 · 총 ${people}명` };
        const heroOn = !!e.hero_image_id, winOn = !!e.winner_image_id;
        out[3] = { ok: true, miss: [], sum: `상단 ${heroOn ? '올린 그림' : '기본 그림'} · 발표 ${winOn ? '올린 그림' : '기본 그림'}${e.result_image_id ? ' · 조회 결과 올린 그림' : ''}${(e.pending_art || []).length ? ' · 아꼼이가 만드는 중 ' + e.pending_art.length + '건' : ''}` };
        const tx = e.texts || {}, filled = TEXT_LABEL.filter(([k]) => String(tx[k] || '').trim() && String(tx[k]).trim() !== TEXT_DEFAULT[k]).length;   // 서버가 기본 글자를 채워 주므로 기본과 다른 것만 「바꿈」
        out[4] = { ok: true, miss: [], sum: `손글씨 ${filled ? filled + '곳 바꿈' : '기본 글자'}${e.coupon_text ? ' · 쿠폰 문구 있음' : ''}` };
        const st = stateOf();
        out[5] = { ok: ['live', 'published'].includes(st), miss: [], sum: STATE_LABEL[st][0] + (st === 'scheduled' ? ' ' + mdw(e.start) + ' 00:00' : '') };
        const srv = S.srvCheck && S.srvCheck.steps; if (srv && !S.dirty) [[1, 'basics'], [2, 'prizes'], [3, 'images']].forEach(([k, n]) => { if (typeof srv[n] === 'boolean' && srv[n] !== out[k].ok) { out[k].ok = srv[n]; if (!srv[n] && !out[k].miss.length) out[k].miss = (S.srvCheck.missing || []).slice(); } });
        out.n = STEPS.filter(k => out[k].ok).length;
        out.openMiss = [1, 2, 3].filter(k => !out[k].ok).map(k => STEP_TITLE[k] + '(' + out[k].miss.join(', ') + ')');
        return out;
    }

    // ── 자동 문구(/guide 카드 · 봇 답 #59) — 서버도 같은 꼴로 만든다(설계 5절) · 화면은 미리보기와 「다시 생성」용 ──
    function autoGuide() {
        const e = S.ev, ps = e.prizes || [], people = ps.reduce((a, p) => a + (Number(p.count) || 0), 0);
        return {
            title: e.title || '',
            lines: [
                `응모 기간 ${mdw(e.start)} ~ ${mdw(e.end)} 주문 고객 자동 응모`,
                ps.length ? `총 ${people}명 추첨: ` + ps.map((p, i) => `${i + 1}등 ${p.name} ${p.count}명`).join(' · ') : '',
                e.announce ? `발표 ${mdw(e.announce)} · 이름이나 번호로 당첨 확인` : '',
            ],
            btn: '접수·당첨 확인 바로가기',
        };
    }

    // ── 미리보기로 넘길 초안(lucky.html 이 읽는 공개 응답 꼴 · 설계 2-3) ──
    function previewPayload() {
        const e = S.ev;
        return {
            title: e.title, start: e.start, end: e.end, announce: e.announce, page_until: e.page_until,   // #718 display_title 안 보냄(lucky.html 이 title 로)
            excludeProducts: e.excludeProducts, published: ['winners', 'published'].includes(S.view), state: ['winners', 'published'].includes(S.view) ? 'published' : 'live', live_mode: e.live_mode || 'draft',
            prizes: (e.prizes || []).map(p => { const im = prizeImg(p); return { name: p.name, count: Number(p.count) || 0, desc: p.desc || '', note: p.note || '', image: im ? im.url : null }; }),
            images: { hero: e.hero_image_id ? assetUrl(e.hero_image_id) : null, winner: e.winner_image_id ? assetUrl(e.winner_image_id) : null, result: e.result_image_id ? assetUrl(e.result_image_id) : null },
            texts: Object.assign({}, TEXT_DEFAULT, Object.fromEntries(Object.entries(e.texts || {}).filter(([, v]) => String(v || '').trim()))),
        };
    }
    // #716 focus = 방금 고친 칸 이름(lucky.html 이 그 자리를 강조 · 표 = 워커2에 보낸 focus 키 표) · 글·그림을 고쳐 보낼 때만 실림(탭·처음엔 없음) · 300ms 디바운스
    function postPreview(focus) {
        if (focus) S.focus = focus;
        clearTimeout(S.previewTimer);
        S.previewTimer = setTimeout(() => {
            const fc = S.focus; S.focus = ''; if (fc && !S.readyResend) S.lastFocus = fc; S.readyResend = false;   // iframe 이 늦게 떠 ready 가 입력 뒤에 오면 그 focus 를 다시 실어 보냄
            const f = $('ev-frame'); if (!f || !f.contentWindow) return;
            const msg = { type: 'lucky:preview', event: previewPayload(), counts: { orders: 0, customers: 0 }, scene: S.view === 'published' ? 'default' : S.view };
            if (fc) msg.focus = fc;
            try { f.contentWindow.postMessage(msg, location.origin); } catch (e) { }
        }, 300);
    }
    // data-k → focus 키(손님 페이지에 자리가 있는 칸만 · texts 는 칸 이름 그대로 · 없는 칸 = '' → focus 안 실림)
    function focusOf(k) {
        k = String(k || '');
        if (k.startsWith('texts.')) return k.slice(6);
        if (/^prizes\.\d+\.(name|count|desc|note)$/.test(k)) return k;
        if (['title', 'start', 'end', 'announce', 'page_until', 'excludeProducts'].includes(k)) return k;
        return '';
    }

    // #711 치는 대로 바뀌는 미리보기 — 대상 아님 문장(lucky.html noitem 장과 같은 글 · #717 「다른 상품 이름」 칸 없앰 → 이름 없이 「그 밖의 다른 상품」) · 봇 답(자동일 때만)
    function noitemHtml() {
        const e = S.ev, x = (e.excludeProducts || []).join(', ');
        return `주문은 확인되지만 <b>${esc(x || '(제외 품목)')}</b> 상품은 이번 이벤트 응모 대상에서 제외돼요. 그 밖의 다른 상품 주문은 자동 접수됩니다!`;
    }
    function refreshNoitem() { const p = $('ev-noitem-pv'); if (p) p.innerHTML = noitemHtml(); }
    // #711 봇 답·/guide 카드 = 서버 POST /bot-preview(저장 0 · docs/711 4-1) · 300ms 디바운스 · 옛 서버(404)면 저장된 값 그대로
    function refreshBot() {
        clearTimeout(S.botTimer);
        S.botTimer = setTimeout(fetchBotPreview, 300);
    }
    async function fetchBotPreview() {
        if (!S.ev || S.bpOld) return;
        const seq = S.bpSeq = (S.bpSeq || 0) + 1;
        const r = await call(A + '/bot-preview', 'POST', { event: payload().event });
        if (seq !== S.bpSeq) return;   // 늦게 온 옛 응답은 버림
        if (r.status === 404) { S.bpOld = true; applyBp(); return; }
        const note = $('ev-bot-note'); if (note) note.hidden = r.status !== 429;
        if (!r.ok || !r.body.bot) return;
        S.bp = r.body; applyBp();
    }
    const cardView = () => { const g = S.ev.guide_card, sc = S.bp && S.bp.card; return g.custom ? Object.assign({}, g, { dropped: sc ? sc.dropped || [] : [] }) : (sc ? sc : Object.assign({}, g, autoGuide(), { dropped: [] })); };
    const botView = () => { const b = S.ev.bot_reply; return b.custom ? b.response : (S.bp && S.bp.bot ? S.bp.bot.text : (S.bpOld ? (b.response || '(저장하면 서버가 만든 봇 답이 여기에 보여요)') : '불러오는 중')); };
    const dropHtml = cv => (cv.dropped || []).length ? `<div class="ev-gdrop"><b>이 줄은 카드에 안 실려요(할인·쿠폰·금액 글자)</b><ul>${cv.dropped.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
    function applyBp() {   // 입력 중인 칸은 건드리지 않음
        const t = $('ev-bot'); if (t && document.activeElement !== t) t.value = botView();
        const cv = cardView(), box = document.querySelector('#event-root .ev-gcard'); if (!box) return;
        const set = (k, v) => { const el = box.querySelector(`[data-k="${k}"]`); if (el && document.activeElement !== el) el.value = v || ''; };
        if (!S.ev.guide_card.custom) { set('guide_card.title', cv.title); [0, 1, 2].forEach(i => set('guide_card.lines.' + i, (cv.lines || [])[i])); }
        const gb = box.querySelector('.ev-gbtn'); if (gb) gb.textContent = cv.btn || '접수·당첨 확인 바로가기';
        const dz = $('ev-gdrop-box'); if (dz) dz.innerHTML = dropHtml(cv);
    }

    // ── 그리기 ────────────────────────────────────────────
    const btn = (label, attrs, cls) => `<button type="button" class="ev-btn${cls ? ' ' + cls : ''}" ${attrs || ''}>${label}</button>`;
    const field = (label, inner, hint) => `<label class="ev-f"><span class="ev-f-l">${label}</span>${inner}${hint ? `<span class="ev-f-h">${hint}</span>` : ''}</label>`;
    const inp = (k, v, ph, extra) => `<input type="text" class="ev-in" data-k="${k}" value="${esc(v)}"${ph ? ` placeholder="${esc(ph)}"` : ''} autocomplete="off" ${extra || ''}>`;
    const area = (k, v, ph, extra) => `<textarea class="ev-in ev-ta2" data-k="${k}" rows="2"${ph ? ` placeholder="${esc(ph)}"` : ''} ${extra || ''}>${esc(v)}</textarea>`;
    const dateIn = (k, v) => `<input type="text" class="ev-in akm-date" data-k="${k}" value="${esc(v)}" readonly autocomplete="off" placeholder="날짜 선택">`;

    function headHtml(ck) {
        const st = stateOf(), [lab, cls] = STATE_LABEL[st];
        const dots = STEPS.map(k => `<span class="ev-dot${ck[k].ok ? ' on' : ''}" title="${k}. ${STEP_TITLE[k]}"></span>`).join('');
        return `<div class="ev-head">
            <div class="ev-head-main"><h2 class="ev-round">${esc(S.ev.title || '이름 없는 회차')}</h2>
                <span class="ev-pill ${cls}">${lab}${st === 'scheduled' ? ' ' + esc(mdw(S.ev.start)) + ' 00:00' : ''}</span>
                <span class="ev-ready" aria-label="준비 ${ck.n}/${STEPS.length}">준비 <span class="ev-dots" aria-hidden="true">${dots}</span> <b>${ck.n}/${STEPS.length}</b></span></div>
            <div class="ev-head-acts">
                <span class="ev-dirty" role="status">${S.saving ? '저장하는 중' : (S.dirty ? '저장 안 한 변경 있음' : '')}</span>
                ${btn(S.saving ? '저장 중' : '변경 저장', `data-ev="save"${S.dirty && !S.saving ? '' : ' disabled'}`, 'primary')}
                ${btn('지난 회차 복사', 'data-ev="copy"')}${btn('새 회차', 'data-ev="new"')}${btn('초기화', 'data-ev="reset" aria-label="이 회차 초기화"', 'danger ghost ev-head-reset')}</div>
        </div>`;
    }
    function cardHtml(k, ck, body) {
        const c = ck[k], op = S.open.has(k);
        return `<section class="ev-card${op ? ' open' : ''}${c.ok ? ' done' : ''}" data-step="${k}" id="ev-step-${k}">
            <button type="button" class="ev-card-h" data-ev="fold" data-step="${k}" aria-expanded="${op}" aria-controls="ev-body-${k}">
                <span class="ev-num">${k}</span><span class="ev-card-t">${STEP_TITLE[k]}</span>
                <span class="ev-st ${c.ok ? 'ok' : 'no'}" aria-label="${c.ok ? '완료' : '미완'}">${c.ok ? '완료' : '미완'}</span>
                <span class="ev-card-sum">${esc(c.sum)}</span><span class="ev-chev" aria-hidden="true"></span></button>
            <div class="ev-card-b" id="ev-body-${k}"${op ? '' : ' hidden'}>${op ? body() : ''}</div></section>`;
    }

    function step1() {
        const e = S.ev;
        return `<div class="ev-grid">
            ${field('회차 이름', inp('title', e.title, '예: 2026 가을 고객 감사'), '알림톡 카드·봇 답 제목으로도 쓰여요 · 손님이 봐도 되는 이름으로')}
            ${field('응모 시작', dateIn('start', e.start))}${field('응모 끝', dateIn('end', e.end))}
            ${field('발표일', dateIn('announce', e.announce))}
        </div>${chipBox('xp')}<div class="ev-sent"><span class="ev-f-l">손님이 보는 문장(대상 아님 장)</span><p id="ev-noitem-pv" aria-live="polite">${noitemHtml()}</p></div>
        ${moreHtml('1', '페이지 내리는 날 · 추첨 제외 연락처', `<div class="ev-grid">${field('페이지 내리는 날', dateIn('page_until', e.page_until), '기본 = 발표일 + 3일 · 이날까지 당첨 확인 가능')}</div>${chipBox('xc')}`)}`;
    }
    // #711 칩 고르기 — xp = 응모 제외 품목(S.ev.excludeProducts · 글자 포함이면 제외) · xc = 추첨 제외 연락처(S.excluded) · 저장 꼴은 종전 배열 그대로
    const fmtPhone = v => { const d = digits(v); return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : String(v); };
    const chipList = kind => kind === 'xp' ? (S.ev.excludeProducts || []) : S.excluded;
    function chipBox(kind) {
        const isP = kind === 'xp', list = chipList(kind);
        const lab = isP ? '응모 제외 품목' : '추첨 제외 연락처';
        return `<div class="ev-chipf" id="ev-${kind}"><span class="ev-f-l" id="ev-${kind}-l">${lab}</span>
            <ul class="ev-chips" aria-labelledby="ev-${kind}-l">${list.map((v, i) => `<li class="ev-chip${!isP && digits(v) && !/^\d{10,11}$/.test(digits(v)) ? ' bad' : ''}"><span>${esc(isP ? v : fmtPhone(v))}</span><button type="button" class="ev-chip-x" data-ev="chipx" data-kind="${kind}" data-i="${i}" aria-label="${esc(isP ? v : fmtPhone(v))} 빼기">×</button></li>`).join('') || `<li class="ev-chip-none">${isP ? '없음 · 기간 안 모든 주문이 응모돼요' : '없음'}</li>`}</ul>
            <div class="ev-chip-add"><input type="${isP ? 'search' : 'tel'}" class="ev-in" id="ev-${kind}-in" data-chip="${kind}" maxlength="${isP ? 40 : 20}" autocomplete="off" ${isP ? 'placeholder="품목 찾기 · 예: 청귤" aria-controls="ev-xp-pick"' : 'inputmode="numeric" placeholder="예: 010-1234-5678"'} aria-label="${lab} 추가">${btn('+ 추가', `data-ev="chipadd" data-kind="${kind}" aria-label="${lab} 추가"`)}</div>
            ${isP ? `<div class="ev-pick" id="ev-xp-pick" role="listbox" aria-label="품목 목록">${pickHtml()}</div>` : ''}
            <span class="ev-f-h">${isP ? '주문 상품 이름에 이 글자가 들어 있으면 응모에서 빠져요 · 목록에서 누르거나 적고 [+ 추가]' : '직원·시험 주문 번호 · 숫자만 10~11자리 · 이 번호는 추첨에서 빠져요'}</span></div>`;
    }
    function addChip(kind, v) {
        v = String(v || '').trim(); if (!v) { toast(kind === 'xp' ? '품목 이름을 적어 주세요' : '연락처를 적어 주세요', 'error'); return false; }
        if (kind === 'xc') {
            const d = digits(v); if (!d) { toast('연락처 숫자를 적어 주세요', 'error'); return false; }
            if (S.excluded.some(x => digits(x) === d)) { toast('이미 들어 있는 번호예요', 'error'); return false; }
            S.excluded = S.excluded.concat([d]);
            if (!/^\d{10,11}$/.test(d)) toast('휴대폰 번호는 10~11자리예요 · 빨간 칩을 확인해 주세요', 'error', 3600);
        } else {
            v = v.slice(0, 120); const E = S.ev;   // 옵션 칩 = 판매현황 이름 그대로(40자 넘는 이름이 많음 · 서버 상한 없음 · 직접 입력 칸은 maxlength 40) E.excludeProducts = E.excludeProducts || [];
            if (E.excludeProducts.some(x => x.replace(/\s+/g, '') === v.replace(/\s+/g, ''))) { toast('이미 들어 있는 품목이에요', 'error'); return false; }
            E.excludeProducts = E.excludeProducts.concat([v]);
        }
        S.dirty = true; S.pq = '';
        if (kind === 'xp') autoView('excludeProducts');
        reChips(kind); postPreview(kind === 'xp' ? 'excludeProducts' : ''); return true;
    }
    // 품목 목록(워커3 GET /lucky/products) — 빈 칸 = 품목 묶음 단추 · 글자를 치면 묶음·옵션 이름 중 맞는 것(최대 12)
    function pickHtml() {
        const P = S.products; if (!P) return '';
        const ns = s => String(s || '').replace(/\s+/g, '');
        const have = new Set((S.ev.excludeProducts || []).map(ns)), q = ns(S.pq);
        const gOn = g => have.has(ns(g.name));   // 묶음 칩이 있으면 그 묶음 옵션은 고를 필요 없음(회색)
        const rows = !q ? P.groups.map(g => ({ v: g.name, sub: (g.selling ? '' : '판매 안 함 · ') + (g.options.length ? `옵션 ${g.options.length}` : '옵션 없음'), off: gOn(g), dim: !g.selling }))
            : P.groups.flatMap(g => (g.words.concat(g.name).some(w => ns(w).includes(q) || (ns(w) && q.includes(ns(w)))) ? [{ v: g.name, sub: '품목 전체', off: gOn(g), dim: !g.selling }] : [])
                .concat(g.options.filter(o => ns(o.name).includes(q)).map(o => ({ v: o.name, sub: o.status ? `${g.name} · ${o.status}` : g.name, off: gOn(g) || have.has(ns(o.name)), opt: true })))).slice(0, 12);
        if (!rows.length) return q ? `<p class="ev-empty">목록에 없어요 · 그대로 [+ 추가]하면 그 글자로 빠져요</p>` : '';
        return `<div class="ev-pick-list">${rows.map(r => `<button type="button" class="ev-pick-b${r.off ? ' on' : ''}${r.opt ? ' opt' : ''}${r.dim ? ' dim' : ''}" role="option" aria-selected="${!!r.off}" data-ev="pick" data-v="${esc(r.v)}"${r.off ? ' disabled' : ''}><b>${esc(r.v)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</button>`).join('')}</div>${q ? '<p class="ev-f-h">옵션 하나만 빼면 네이버 주문에만 맞아요 · 품목 전체는 묶음을 고르세요</p>' : ''}`;
    }
    async function loadProducts(force) {
        if (S.productsBusy) return;
        if (!force && (S.products || Date.now() - (S.productsAt || 0) < 30000)) return;
        S.productsBusy = true; S.productsAt = Date.now();
        const r = await call(A + '/products');
        S.productsBusy = false;
        if (r.ok) S.products = normProducts(r.body); else if (!S.products) S.products = undefined;
        const pk = $('ev-xp-pick'); if (pk) pk.innerHTML = pickHtml();
        if (r.ok && S.open.has(2)) { document.querySelectorAll('#event-root .ev-prize').forEach((li, i) => { const p = (S.ev.prizes || [])[i], im = prizeImg(p), box = li.querySelector('.ev-prize-img > span'); if (box && im) box.textContent = im.how; }); refreshStatus(); }
    }
    function normProducts(b) {   // 계약 꼴(docs/711-event-design.md)을 화면 꼴 {groups:[{name, options:[]}]} 로
        const gs = Array.isArray(b && b.groups) ? b.groups : [];
        return { groups: gs.map(g => ({ name: String(g.name || g.group || '').trim(), words: (Array.isArray(g.words) ? g.words : []).map(String).filter(Boolean), selling: g.selling !== false, options: (Array.isArray(g.options) ? g.options : []).map(o => typeof o === 'string' ? { name: o.trim(), status: '' } : { name: String(o.name || '').trim(), status: String(o.status || '') }).filter(o => o.name) })).filter(g => g.name) };
    }
    function reChips(kind) {   // 칩 칸만 다시(카드 전체를 다시 그리지 않음 · 입력 칸 초점 유지)
        const box = $('ev-' + kind); if (!box) return;
        const tmp = document.createElement('div'); tmp.innerHTML = chipBox(kind); box.replaceWith(tmp.firstElementChild);
        const inp = $('ev-' + kind + '-in'); if (inp) inp.focus();
        refreshStatus(); refreshNoitem();
    }
    function step2() {
        const ps = S.ev.prizes || [];
        return `<ol class="ev-prizes">${ps.map((p, i) => {
            const im = prizeImg(p);
            return `<li class="ev-prize" data-i="${i}">
                <div class="ev-prize-img">${im ? `<img src="${esc(im.url)}" alt="${esc(p.name)} 그림" loading="lazy"><span>${esc(im.how)}</span>` : '<span class="ev-noimg">그림 없음</span>'}
                    <div class="ev-row">${btn('올리기', `data-ev="upload" data-slot="prize" data-i="${i}"`, 'sm')}${btn('AI로 맡기기', `data-ev="art" data-slot="prize" data-i="${i}"`, 'sm')}</div></div>
                <div class="ev-prize-f">
                    <div class="ev-prize-top"><b class="ev-rank">${i + 1}등</b>${inp(`prizes.${i}.name`, p.name, '경품 이름 · 예: 황금향 5kg 선물용', 'aria-label="' + (i + 1) + '등 경품 이름"')}
                        <input type="number" class="ev-in ev-cnt" data-k="prizes.${i}.count" value="${esc(p.count)}" min="1" inputmode="numeric" aria-label="${i + 1}등 인원"><span class="ev-unit">명</span></div>
                    ${area(`prizes.${i}.desc`, p.desc, '설명 1~2줄(120자 · 줄바꿈 가능)', 'maxlength="120" aria-label="' + (i + 1) + '등 설명"')}
                    ${inp(`prizes.${i}.note`, p.note, '손글씨 한마디(40자)', 'maxlength="40" aria-label="' + (i + 1) + '등 손글씨"' + (S.more && S.more.has('2') ? '' : ' hidden'))}
                    ${candBand('prize:' + i)}
                    <div class="ev-row">${btn('↑', `data-ev="pup" data-i="${i}" aria-label="${i + 1}등 위로"${i ? '' : ' disabled'}`, 'sm icon')}${btn('↓', `data-ev="pdown" data-i="${i}" aria-label="${i + 1}등 아래로"${i < ps.length - 1 ? '' : ' disabled'}`, 'sm icon')}${btn('빼기', `data-ev="pdel" data-i="${i}" aria-label="${i + 1}등 빼기"`, 'sm danger')}</div>
                </div></li>`;
        }).join('')}</ol>${ps.length ? '' : '<p class="ev-empty">아직 경품이 없어요.</p>'}${btn('+ 경품 추가', 'data-ev="padd"')}
        <p class="ev-note">그림을 안 올리면 경품 이름으로 품목 사진을 찾아 써요.</p>
        ${moreHtml('2', '경품 손글씨 한마디 · 품목 사진 관리', brandBox())}`;
    }
    // #709(대표 「직원이 직접」) 품목 사진 관리 — 경품 그림 기본값으로 쓰는 실제 품목 사진(slot brand · label = 품목 이름) · 품목이 바뀌어도 직원이 올림
    function brandBox() {
        // #711 검색 칸이 맨 위 · 글자를 쳐야 목록(26장을 늘 펼치지 않음) · 같은 칸 글자가 올릴 때 품목 이름
        return `<div class="ev-sub ev-brand" id="ev-brand"><div class="ev-sub-h"><b>품목 사진</b><span class="ev-f-h">경품 그림 기본값으로 쓰는 품목 실사진 · 새 품목이면 여기에 올려요</span></div>
            <div class="ev-badd"><label class="ev-f"><span class="ev-f-l">품목 이름 찾기 · 올릴 때 이름</span><input type="search" class="ev-in" id="ev-blabel" maxlength="30" value="${esc(S.bq || '')}" placeholder="예: 황금향" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ev-bnpanel"></label>
                ${btn('품목 사진 올리기', 'data-ev="badd"', 'primary')}</div>
            <div id="ev-bres" aria-live="polite">${brandResults()}</div></div>`;
    }
    const nsp = s => String(s || '').replace(/\s+/g, '');
    function brandResults() {
        const all = brandAssets(), q = nsp(S.bq);
        if (!q) return `<p class="ev-empty ev-bhint">품목 이름을 검색하면 사진이 보여요 · ${all.length}장</p>`;
        const g = groupOf(q);
        const list = all.filter(a => { const l = nsp(a.label); return (l && (l.includes(q) || q.includes(l))) || (g >= 0 && groupOf(a.label) === g); })
            .sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'ko') || b.id - a.id);
        if (!list.length) return `<p class="ev-empty">「${esc(S.bq)}」 사진이 아직 없어요 · [품목 사진 올리기]로 올려요</p>`;
        return `<ul class="ev-blist">${list.map(a => `<li class="ev-bitem" data-id="${a.id}"><img src="${esc(assetUrl(a.id))}" alt="${esc(a.label || '품목 사진')}" loading="lazy"><b>${esc(a.label || '(이름 없음)')}</b>
                <span class="ev-row">${btn('바꾸기', `data-ev="brep" data-id="${a.id}" data-label="${esc(a.label || '')}" aria-label="${esc(a.label || '')} 사진 바꾸기"`, 'sm')}${btn('지우기', `data-ev="bdel" data-id="${a.id}" aria-label="${esc(a.label || '')} 사진 지우기"`, 'sm danger')}</span></li>`).join('')}</ul>`;
    }
    // #716 품목 이름 찾기 = 우리 목록 창(브라우저 기본 datalist 대신 · 중간발주 #qty-pickpanel 꼴) — 칸 하나가 검색 칸 · PC = 칸에 붙어 스크롤 따라감(자리 없으면 위) · 폰 = 칸 바로 아래 폭 꽉(자판 위까지)
    const BN = { open: false, act: -1, n: 0, up: null };
    const bnMobile = () => window.matchMedia('(max-width: 640px)').matches;
    function bnRows() {
        const q = nsp(S.bq), all = brandAssets().slice().sort((a, b) => b.id - a.id), seen = new Map();
        BRAND_FALLBACK.concat(S.itemNames || [], all.map(a => a.label)).forEach(n => { n = String(n || '').trim(); const k = nsp(n); if (k && !seen.has(k)) seen.set(k, n); });
        return [...seen].filter(([k]) => !q || k.includes(q)).map(([k, n]) => ({ n, ph: all.filter(a => nsp(a.label) === k) }))
            .sort((a, b) => (b.ph.length ? 1 : 0) - (a.ph.length ? 1 : 0) || a.n.localeCompare(b.n, 'ko'));
    }
    function bnEl() {
        let p = $('ev-bnpanel'); if (p) return p;
        p = document.createElement('div'); p.id = 'ev-bnpanel'; p.className = 'ev-bnpanel'; p.hidden = true; p.setAttribute('role', 'listbox'); p.setAttribute('aria-label', '품목 이름');
        p.addEventListener('pointerdown', e => e.preventDefault());   // 칸 초점 유지(폰 자판이 내려가지 않게)
        p.addEventListener('click', e => { const r = e.target.closest('.ev-bn-row'); if (r) bnPick(r.dataset.v); });
        document.body.appendChild(p); return p;
    }
    function bnDraw() {
        const p = bnEl(), rows = bnRows(), raw = String(S.bq || '').trim().toLowerCase(); BN.n = rows.length;
        const mark = n => { const k = raw ? n.toLowerCase().indexOf(raw) : -1; return k < 0 ? esc(n) : esc(n.slice(0, k)) + '<mark>' + esc(n.slice(k, k + raw.length)) + '</mark>' + esc(n.slice(k + raw.length)); };
        p.innerHTML = rows.length ? rows.map((r, i) => `<div class="ev-bn-row" role="option" id="ev-bn-${i}" data-i="${i}" data-v="${esc(r.n)}" aria-selected="false">${r.ph.length ? `<img src="${esc(assetUrl(r.ph[0].id))}" alt="" loading="lazy">` : '<span class="ev-bn-noimg" aria-hidden="true"></span>'}<span class="ev-bn-t">${mark(r.n)}</span><small class="${r.ph.length ? '' : 'none'}">${r.ph.length ? r.ph.length + '장' : '사진 없음'}</small></div>`).join('')
            : '<p class="ev-bn-none">맞는 품목이 없어요</p>';
        bnAct(raw && rows.length ? 0 : -1);
    }
    function bnAct(i) {
        BN.act = i; const p = $('ev-bnpanel'), inp = $('ev-blabel'); if (!p) return;
        p.querySelectorAll('.ev-bn-row.act').forEach(r => { r.classList.remove('act'); r.setAttribute('aria-selected', 'false'); });
        const r = i >= 0 ? p.querySelector(`.ev-bn-row[data-i="${i}"]`) : null;
        if (r) { r.classList.add('act'); r.setAttribute('aria-selected', 'true'); if (inp) inp.setAttribute('aria-activedescendant', r.id); if (typeof r.scrollIntoView === 'function') r.scrollIntoView({ block: 'nearest' }); }
        else if (inp) inp.removeAttribute('aria-activedescendant');
    }
    function bnPlace(follow) {
        const p = $('ev-bnpanel'), inp = $('ev-blabel'); if (!p || !BN.open) return;
        if (!inp || !inp.isConnected || !isActive()) return bnClose();
        const r = inp.getBoundingClientRect(), vv = window.visualViewport, bot = vv ? vv.offsetTop + vv.height : window.innerHeight, vw = document.documentElement.clientWidth || window.innerWidth;
        p.style.visibility = r.bottom < 0 || r.top > bot ? 'hidden' : '';   // 칸이 화면 밖이면 창도 안 보임(열린 채 · 돌아오면 제자리)
        if (bnMobile() && !follow && bot - r.bottom < 240) { const top = (vv ? vv.offsetTop : 0) + 72; let sc = inp.parentElement; while (sc && sc !== document.body && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement; const dy = r.top - top; if (dy > 8) { if (sc && sc !== document.body) sc.scrollTop += dy; else window.scrollBy(0, dy); return bnPlace(true); } }   // 폰: 칸이 아래쪽(자판 바로 위)이면 칸을 위로 올려 목록 자리를 만든다
        if (bnMobile()) { p.style.left = '12px'; p.style.width = (vw - 24) + 'px'; p.style.bottom = ''; p.style.top = (r.bottom + 4) + 'px'; p.style.maxHeight = Math.max(132, Math.min(420, bot - r.bottom - 12)) + 'px'; p.dataset.up = ''; return; }
        const below = bot - r.bottom - 12, above = r.top - 12, w = Math.max(280, Math.min(480, r.width));
        const up = follow && BN.up != null ? BN.up : (below < 240 && above > below); BN.up = up;
        p.style.width = w + 'px'; p.style.left = Math.max(8, Math.min(vw - w - 8, r.left)) + 'px';
        if (!follow) p.style.maxHeight = Math.max(160, Math.min(360, up ? above : below)) + 'px';
        if (up) { p.style.top = ''; p.style.bottom = (window.innerHeight - r.top + 4) + 'px'; } else { p.style.bottom = ''; p.style.top = (r.bottom + 4) + 'px'; }
        p.dataset.up = up ? '1' : '';
    }
    function bnOpen() {
        const inp = $('ev-blabel'); if (!inp) return;
        const p = bnEl(); if (!BN.open) { BN.open = true; BN.up = null; p.hidden = false; inp.setAttribute('aria-expanded', 'true'); }
        bnDraw(); bnPlace();
    }
    function bnClose() {
        if (!BN.open) return; BN.open = false; BN.act = -1; BN.up = null;
        const p = $('ev-bnpanel'), inp = $('ev-blabel'); if (p) p.hidden = true;
        if (inp) { inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); }
    }
    function bnPick(v) {
        S.bq = v; const inp = $('ev-blabel'); if (inp) inp.value = v;
        const r = $('ev-bres'); if (r) r.innerHTML = brandResults(); bnClose();
    }
    function bnKey(e) {
        if (e.isComposing) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!BN.open) bnOpen(); if (BN.n) bnAct(BN.act < 0 ? (e.key === 'ArrowDown' ? 0 : BN.n - 1) : Math.max(0, Math.min(BN.n - 1, BN.act + (e.key === 'ArrowDown' ? 1 : -1)))); }
        else if (e.key === 'Enter') { e.preventDefault(); if (BN.open && BN.act >= 0) { const r = $('ev-bnpanel').querySelector('.ev-bn-row.act'); if (r) bnPick(r.dataset.v); } else bnClose(); }
        else if (e.key === 'Escape' && BN.open) { e.preventDefault(); e.stopPropagation(); bnClose(); }
        else if (e.key === 'Tab') bnClose();
    }
    async function loadItemNames() {
        if (S.itemNames) return;
        S.itemNames = [];
        const r = await call('/api/agent-office/bot-products');
        const ps = r.body && Array.isArray(r.body.products) ? r.body.products : [];
        // 판매현황 이름의 「 / 」 앞(품목) · 「…:」 머리말 · 무게 이하를 뗀 품목 이름
        S.itemNames = [...new Set(ps.filter(p => !p.deleted_at).map(p => String(p.name || '').split(' / ')[0].replace(/^[^:]*:\s*/, '').replace(/\s*\d+(\.\d+)?\s*kg.*$/i, '').replace(/^(최상품|제철)\s*/, '').trim()).filter(n => n && n.length <= 30))];
        if (BN.open) bnDraw();
    }
    async function uploadBrand(file, label, replaceId) {
        label = String(label || '').trim().slice(0, 30);
        if (!label) { toast('품목 이름을 먼저 적어 주세요', 'error'); const el = $('ev-blabel'); if (el) el.focus(); return; }
        if (!/^image\/(png|jpe?g|webp)$/.test(file.type || '')) { toast('그림 파일(png·jpg·webp)만 올릴 수 있어요', 'error'); return; }
        toast('사진을 줄여서 올리는 중', undefined, 1600);
        let s; try { s = await shrink(file, 'brand'); } catch (e) { toast(e.message, 'error'); return; }
        const r = await call(A + '/assets', 'POST', { slot: 'brand', mime: s.blob.type, data: await b64(s.blob), width: s.w, height: s.h, label });
        if (!r.ok || !r.body.asset) { toast(errText(r.body), 'error', 3600); return; }
        S.assets = S.assets.concat([r.body.asset]); S.bq = label;   // 올린 사진이 목록에 바로 보이게
        let msg = `「${label}」 사진을 올렸어요`;
        if (replaceId) {
            const d = await call(A + '/assets/' + replaceId, 'DELETE');
            if (d.ok) S.assets = S.assets.filter(a => String(a.id) !== String(replaceId));
            else if (d.status === 409) msg += ' · 옛 사진은 지금 회차 경품이 쓰고 있어 남겨 뒀어요(새 경품부터 새 사진)';
        }
        toast(msg, 'lime', 3600); render(); postPreview();
    }
    function pickBrand(label, replaceId) {
        const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/png,image/jpeg,image/webp'; f.hidden = true;
        f.onchange = () => { const x = f.files && f.files[0]; f.remove(); if (x) uploadBrand(x, label, replaceId); };
        document.body.appendChild(f); f.click();
    }
    function slotBox(slot) {
        const d = SLOTS[slot], e = S.ev;
        const id = e[d.field];
        return `<div class="ev-slot" data-slot="${slot}">
            <div class="ev-slot-h"><b>${d.label}</b><span class="ev-f-h">권장 ${d.w}×${d.h}${slot === 'result' ? ' · 선택' : ''}</span></div>
            <p class="ev-slot-where">쓰이는 곳: ${esc(d.where)}</p>
            <div class="ev-slot-img${slot === 'hero' ? ' wide' : ''}">${id ? `<img src="${esc(assetUrl(id))}" alt="${d.label}">` : '<span class="ev-noimg">기본 그림 사용</span>'}</div>
            <div class="ev-row">${btn('직접 올리기', `data-ev="upload" data-slot="${slot}"`, 'sm')}${btn('AI로 그림 맡기기', `data-ev="art" data-slot="${slot}"`, 'sm')}${id ? btn('기본 그림으로', `data-ev="unset" data-slot="${slot}"`, 'sm ghost') : ''}</div>
            ${candBand(slot)}</div>`;
    }
    function step3() {
        return `${slotBox('hero')}${slotBox('winner')}${slotBox('result')}`;
    }
    function candBand(key) {
        const pend = (S.ev.pending_art || []).filter(p => p.slot === key);
        if (!pend.length) return '';
        return pend.map(p => {
            const c = S.cand[p.order_id];
            const files = c && c.files || [];
            const head = !c ? '불러오는 중' : (files.length ? `아꼼이가 만든 후보 ${files.length}장 · 지시 #${p.order_id}` : (c.err ? esc(c.err) : `아꼼이가 만드는 중 · 지시 #${p.order_id}`));
            return `<div class="ev-cand" data-order="${p.order_id}"><div class="ev-cand-h"><span>${head}</span>${btn('닫기', `data-ev="candx" data-order="${p.order_id}" aria-label="후보 띠 닫기"`, 'sm ghost')}</div>
                ${files.length ? `<div class="ev-cand-list">${files.map(f => `<figure class="ev-cand-it"><img data-fid="${f.id}" alt="후보 그림 ${esc(f.filename || '')}"><figcaption>${btn('이 그림 쓰기', `data-ev="usecand" data-order="${p.order_id}" data-fid="${f.id}" data-slot="${esc(key)}"`, 'sm primary')}</figcaption></figure>`).join('')}</div>` : ''}</div>`;
        }).join('');
    }
    function step4() {
        const e = S.ev, tx = e.texts || {}, g = e.guide_card, b = e.bot_reply;
        const gl = cardView(), botText = botView();
        const adWarn = g.custom && [gl.title].concat(gl.lines || []).some(x => AD_WORDS.test(String(x || '')));
        // #718 기본은 전부 자동(손글씨 기본 글자 · 봇 답·카드 글은 기간·경품·발표일로 서버가 만듦) → 한 줄 안내 + 「더 보기」
        return `<p class="ev-note">봇 답·알림톡 카드 글은 기간·경품·발표일로 자동으로 만들어져요 · 손글씨는 기본 글자예요 · 고칠 때만 아래를 열어요.</p>
            ${moreHtml('4', '손글씨 5곳 · 봇 답 · 쿠폰 · 알림톡 카드', `<div class="ev-grid">${TEXT_LABEL.map(([k, l, max, multi]) => field(l, (multi ? area : inp)('texts.' + k, tx[k] || '', TEXT_DEFAULT[k], `maxlength="${max}"`))).join('')}</div>
            <div class="ev-sub" id="ev-botbox"><div class="ev-sub-h"><b>봇 답(톡톡·상품문의)</b>${btn(b.custom ? '자동으로 되돌리기' : '다시 생성', 'data-ev="botauto"', 'sm ghost')}</div>
                <p class="ev-f-h ev-bot-what">손님이 톡톡·상품문의에서 이벤트를 물으면 봇이 이렇게 답해요(시나리오 #59 · [이벤트 열기] 때 자동 등록 · 손님 페이지엔 안 나가요).</p>
                <textarea class="ev-in ev-ta" id="ev-bot" data-k="bot_reply.response" rows="6" aria-label="봇 답 글">${esc(botText)}</textarea>
                <p class="ev-f-h ev-bot-note" id="ev-bot-note" role="status" hidden>잠시 뒤 다시 보여 드려요(미리보기 요청이 많아요 · 아래 글은 바로 앞 글)</p>
                <p class="ev-f-h">${b.custom ? '손으로 고친 글 · 자동으로 안 바뀌어요(문의 관리에서 고친 글은 다음 저장 때 이 글로 덮여요)' : '칸을 고치면 손으로 고친 글로 남아요'}</p>
                ${field('쿠폰 한 줄', inp('coupon_text', e.coupon_text, '예: 응모 고객께 다음 주문 할인 쿠폰'), '위 봇 답의 🎟 줄에만 들어가요 · 손님 페이지·알림톡 카드엔 안 나가요(광고성)')}</div>
            <div class="ev-sub"><div class="ev-sub-h"><b>알림톡 단추 페이지(/guide) 맨 위 카드</b>${btn(g.custom ? '자동으로 되돌리기' : '다시 생성', 'data-ev="guideauto"', 'sm ghost')}</div>
                <p class="ev-f-h">발송안내 알림톡 [맛있게 드시는 법] 페이지 맨 위에 이벤트 기간 동안 붙는 카드 · 할인·쿠폰·금액 글자는 자동으로 빠져요.</p>
                <div class="ev-gcard"><input type="text" class="ev-in ev-gtitle" data-k="guide_card.title" value="${esc(gl.title)}" aria-label="카드 제목">
                    ${[0, 1, 2].map(i => `<input type="text" class="ev-in" data-k="guide_card.lines.${i}" value="${esc((gl.lines || [])[i] || '')}" maxlength="120" aria-label="카드 ${i + 1}째 줄">`).join('')}
                    <span class="ev-gbtn">${esc(gl.btn || '접수·당첨 확인 바로가기')}</span></div><div id="ev-gdrop-box">${dropHtml(gl)}</div>
                ${adWarn ? '<p class="ev-warn" role="alert">카드 글에 할인·쿠폰·금액 글자가 있어요. 광고성으로 걸릴 수 있으니 빼 주세요(쿠폰은 봇 답에만).</p>' : ''}</div>`)}`;
    }
    // #711 손님 화면 미리보기 — 상태 탭(lucky.html 미리보기 장) · PC 2단 = 오른쪽 판에만 · 한 줄 = 떠 있는 단추 → 전체 화면 겹(#716)
    // 장 이름(scene) = docs/711-event-design.md 1절 · 「발표 뒤 첫 화면」만 화면 쪽 이름 published(= scene default + event.published)
    const VIEWS = [['preparing', '준비 중', 1], ['default', '접수 중', 1], ['published', '발표 뒤 첫 화면', 1], ['received', '접수 확인', 2], ['win', '당첨', 2], ['lose', '미당첨', 2], ['noitem', '대상 아님', 2], ['outside', '기간 밖', 2], ['winners', '발표 창', 3], ['closed', '끝남', 3]];
    const VIEW_HINT = { preparing: '열기 전 · 「준비 중」 한 장', default: '응모 기간 · 손님 페이지 첫 화면(상단 그림·경품·조회 칸)', published: '발표 시작 뒤 첫 화면 · 「당첨자 발표 완료」 띠 + [명단 보기]', received: '이름·번호 조회 → 「접수되었습니다」(조회 결과 그림)', win: '이름·번호 조회 → 당첨(조회 결과 그림 · 1등 경품)', lose: '이름·번호 조회 → 미당첨(조회 결과 그림)', noitem: '이름·번호 조회 → 제외 품목만 산 손님(대상 아님 문장)', outside: '이름·번호 조회 → 기간 밖 주문', winners: '당첨자 명단 창(발표 그림·발표 손글씨)', closed: '내리는 날 뒤 · 끝난 장 + 스토어 단추' };
    function pvBarHtml() {
        const seg = (list, lab) => `<div class="ev-seg" role="group" aria-label="${lab}">${list.map(([v, l]) => `<button type="button" class="ev-seg-b${S.view === v ? ' on' : ''}" data-ev="view" data-v="${v}" aria-pressed="${S.view === v}">${l}</button>`).join('')}</div>`;
        const g = n => VIEWS.filter(x => x[2] === n);
        // #716-A 「당첨 조회」 = 누르는 알약이 아니라 둘째 묶음 위 작은 회색 머리글(대표가 탭으로 보고 「안 눌린다」) — 옆 「접수 확인」 탭이 이미 그 장이라 단추로 두지 않음
        return `<div class="ev-pv-bar"><div class="ev-pv-tabs">${seg(g(1), '미리보기 상태')}<div class="ev-pv-grp"><span class="ev-pv-gl" aria-hidden="true">당첨 조회 결과 ↓</span>${seg(g(2), '당첨 조회 결과')}</div>${seg(g(3), '발표·끝')}</div>
            <p class="ev-pv-hint" aria-live="polite">${esc(VIEW_HINT[S.view] || '')}</p></div>`;
    }
    function refreshPvBar() { document.querySelectorAll('#event-root .ev-pv-bar, #ev-pv-ov .ev-pv-bar').forEach(el => { const t = document.createElement('div'); t.innerHTML = pvBarHtml(); el.replaceWith(t.firstElementChild); }); }
    // 그림·글을 고치면 그것이 쓰이는 장으로 미리보기를 돌림(#711 · #716 = 글 입력도 늘 이김 · 손으로 고른 탭은 다음 입력까지만)
    const VIEW_FOR = { hero: 'default', winner: 'winners', result: 'win', prize: 'default', excludeProducts: 'noitem', 'texts.winner_hand': 'winners', 'texts.winner_foot': 'winners', 'texts.prize_head_hand': 'default', 'texts.corner_hand': 'default', 'texts.search_hand': 'received', title: 'default', start: 'default', end: 'default', announce: 'default', page_until: 'default', 'texts.preparing_title': 'preparing', 'texts.preparing_line': 'preparing', 'texts.closed_title': 'closed', 'texts.closed_line': 'closed', 'texts.store_btn': 'closed' };
    function autoView(key) {
        const k = /^prizes\./.test(key) ? 'prize' : key, v = VIEW_FOR[k];
        if (!v || v === S.view) return;
        S.view = v; refreshPvBar();
    }
    // #718 링크 복사 = 「더 보기」 안(드물게 씀) · [넓게 보기] 는 그대로
    const pvActs = () => `<div class="ev-row ev-pv-acts">${btn(S.frame === 'phone' ? '넓게 보기' : '폰으로 보기', 'data-ev="frame"', 'sm ghost')}</div>
            ${moreHtml('pv', '다른 폰으로 보는 링크', `<div class="ev-row">${btn('미리보기 링크 복사', 'data-ev="pvlink"', 'sm')}<span class="ev-f-h">1시간 동안 열려요 · 다른 직원·대표 폰으로 보낼 때</span></div>`)}`;
    const frameHtml = () => `<div class="ev-frame-wrap ${S.frame}"><iframe id="ev-frame" title="손님 화면 미리보기" src="/lucky.html?preview=1" loading="lazy"></iframe></div>`;
    // #716-E 한 줄(폰·폴드7 펼침)에서는 미리보기가 떠 있는 단추 → 전체 화면 겹. class modal-overlay = app.js #678 가 공통 창으로 세어 뒤로가기·Esc 로 닫아 줌(× = .modal-close 를 눌러 닫음)
    const fabHtml = () => `<button type="button" class="ev-btn primary ev-pv-fab" data-ev="pvopen" aria-haspopup="dialog">손님 화면 미리보기</button>`;
    function openPv() {
        if (S.pvOpen || isWide()) return;
        const root = $('event-root'); if (!root) return;
        S.pvOpen = true;
        const ov = document.createElement('div'); ov.className = 'modal-overlay ev-pv-ov'; ov.id = 'ev-pv-ov';
        ov.innerHTML = `<div class="ev-pv-sheet" role="dialog" aria-modal="true" aria-labelledby="ev-pv-t"><div class="ev-pv-head"><b id="ev-pv-t">손님 화면 미리보기</b><span class="ev-f-h">저장 전 초안 · 뒤로가기로 닫혀요</span><button type="button" class="modal-close ev-pv-x" data-ev="pvclose" aria-label="미리보기 닫기">×</button></div>
            ${pvBarHtml()}${frameHtml()}<div class="ev-side-acts">${pvActs()}</div></div>`;
        ov.addEventListener('click', onClick);   // body 에 붙이므로(app.js #678 는 body 직계 자식 추가만 봄 → 겹 수 akmM 에 셈) 단추 위임을 겹에 직접
        document.body.appendChild(ov);
        hookFrame();
        { const f = ov.querySelector('#ev-frame'); if (f) f.addEventListener('load', () => { try { f.contentWindow.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.isComposing) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }); } catch (e) { } }); }   // 같은 출처 iframe 의 Esc 를 부모로(app.js #678 이 겹을 닫음)
        const x = ov.querySelector('.ev-pv-x'); if (x) x.focus();
    }
    function closePv() {
        const ov = $('ev-pv-ov'); S.pvOpen = false;
        if (ov) ov.remove();
        const fab = document.querySelector('#event-root .ev-pv-fab'); if (fab) fab.focus();
    }
    function step6(ck) {
        const st = stateOf(), d = S.db || {}, open = isOpen();
        const orders = Array.isArray(d.orders) ? d.orders : [], winners = Array.isArray(d.winners) ? d.winners : [];
        const ev = S.ev, inR = o => { const x = String(o.date || '').slice(0, 10); return x >= ev.start && x <= ev.end; };
        const exP = o => (ev.excludeProducts || []).some(k => k && String(o.product || '').includes(k));
        const elig = orders.filter(o => inR(o) && !exP(o)), cust = new Set(elig.map(o => digits(o.buyerPhone) || digits(o.recvPhone) || o.buyer || o.recv));
        const g = {}; orders.forEach(o => { const k = o.date + '|' + o.vendor; g[k] = g[k] || { date: o.date, vendor: o.vendor, n: 0 }; g[k].n++; });
        const ups = Object.values(g).sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const lock = ck.openMiss.length;
        const where = [['손님 페이지', open], ['/guide 카드', open && ev.guide_card.enabled !== false, ev.page_until ? `~${mdw(ev.page_until)}` : ''], ['봇 답 #59', open && ev.bot_reply.enabled !== false]];
        return `${!open && st !== 'down' ? `<div class="ev-golive">
                ${btn('이벤트 열기 지금', `data-ev="live"${lock ? ' disabled aria-describedby="ev-lockmsg"' : ''}`, 'primary')}
                ${btn(st === 'scheduled' ? '예약 풀기' : '시작일에 자동 열기 예약', `data-ev="${st === 'scheduled' ? 'unsched' : 'sched'}"${lock && st !== 'scheduled' ? ' disabled' : ''}`)}
                ${lock ? `<p class="ev-warn" id="ev-lockmsg">열기 전에 채울 것: ${esc(ck.openMiss.join(' · '))}</p>` : `<p class="ev-f-h">열면 손님 페이지 · /guide 카드 · 봇 답에 한 번에 나가요.${S.dirty ? ' 저장 안 한 변경은 먼저 저장돼요.' : ''}</p>`}</div>` : ''}
            ${open || st === 'down' ? `<ul class="ev-where">${where.map(([l, on, x]) => `<li class="${on ? 'on' : ''}"><span class="ev-st ${on ? 'ok' : 'no'}">${on ? '보임' : '안 보임'}</span>${l}${x ? ' <small>' + esc(x) + '</small>' : ''}</li>`).join('')}</ul>` : ''}
            <div class="ev-stats"><div><span>응모권(대상 주문)</span><b>${elig.length}</b></div><div><span>응모 고객</span><b>${cust.size}</b></div><div><span>당첨자</span><b>${winners.length}</b></div><div><span>발표</span><b>${ev.published ? '발표 중' : (winners.length ? '추첨 끝' : '접수 중')}</b></div></div>
            <div class="ev-sub"><div class="ev-sub-h"><b>송장 올리기</b><span class="ev-f-h">거래처(대성·효돈) 송장 엑셀 · 같은 송장은 빠짐</span></div>
                <div class="ev-drop" id="ev-drop" tabindex="0" role="button" aria-label="송장 엑셀 고르기">엑셀을 끌어다 놓거나 눌러서 고르세요(여러 개 가능)<input type="file" id="ev-xlsx" accept=".xlsx,.xls,.csv" multiple hidden></div>
                <div id="ev-upprev">${upPreview()}</div></div>
            <div class="ev-sub"><div class="ev-sub-h"><b>등록 현황</b></div>
                <div class="ev-scroll"><table class="ev-tbl"><thead><tr><th>발송일</th><th>거래처</th><th>건수</th><th></th></tr></thead><tbody>
                ${ups.map(r => `<tr><td>${esc(r.date)}${r.date >= ev.start && r.date <= ev.end ? '' : ' <span class="ev-pill ev-pill-wait">기간 밖</span>'}</td><td>${esc(r.vendor)}</td><td>${r.n}</td><td>${btn('지우기', `data-ev="updel" data-date="${esc(r.date)}" data-vendor="${esc(r.vendor)}"`, 'sm danger')}</td></tr>`).join('') || '<tr><td colspan="4" class="ev-empty">아직 올린 송장이 없어요</td></tr>'}</tbody></table></div></div>
            <div class="ev-sub"><div class="ev-sub-h"><b>추첨·발표</b><span class="ev-f-h">주문 1건 = 응모권 1장 · 한 사람은 1번만 당첨</span></div>
                <div class="ev-row">${btn('추첨하기', 'data-ev="draw"', 'primary')}${btn(ev.published ? '발표 숨기기' : '발표 시작', `data-ev="${ev.published ? 'unpub' : 'pub'}"${winners.length ? '' : ' disabled'}`)}</div>
                <div class="ev-scroll"><table class="ev-tbl"><thead><tr><th>#</th><th>경품</th><th>고객</th><th>연락처</th><th>주문</th></tr></thead><tbody>
                ${winners.map((w, i) => `<tr><td>${i + 1}</td><td><b>${esc(w.prize)}</b></td><td>${esc(w.name)}</td><td>${esc(w.phone)}</td><td>${esc(String(w.product || '').slice(0, 24))} · ${w.orders || 1}건</td></tr>`).join('') || '<tr><td colspan="5" class="ev-empty">아직 추첨 전이에요</td></tr>'}</tbody></table></div>
                <div class="ev-row">${btn('당첨자 복사', `data-ev="wcopy"${winners.length ? '' : ' disabled'}`, 'sm')}${btn('당첨자 엑셀', `data-ev="wxlsx"${winners.length ? '' : ' disabled'}`, 'sm')}</div></div>
            ${open || st === 'scheduled' ? `<div class="ev-sub ev-danger-zone"><div class="ev-row">${btn('페이지 내리기', 'data-ev="down"', 'danger')}</div></div>` : ''}`;   // #718 아래 [초기화] 는 머리띠 것과 중복이라 없앰
    }
    function upPreview() {
        if (!S.ordersPending.length) return '';
        const tot = S.ordersPending.reduce((a, p) => a + p.orders.length, 0);
        return S.ordersPending.map((p, i) => `<div class="ev-up"><b>${esc(p.name)}</b> <span class="ev-pill ${p.orders.length ? 'ev-pill-ok' : 'ev-pill-off'}">${p.orders.length}건 · 송장번호 ${p.tracked}건</span>
            <div class="ev-row"><label class="ev-f inl"><span class="ev-f-l">거래처</span><select class="ev-in" data-upv="${i}">${['대성', '효돈', '기타'].map(v => `<option${(p.vendor || '기타') === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
            <label class="ev-f inl"><span class="ev-f-l">발송일</span><input type="text" class="ev-in akm-date" data-upd="${i}" value="${esc(p.date)}" readonly></label></div></div>`).join('')
            + `<div class="ev-row">${btn('서버에 등록(' + tot + '건)', 'data-ev="upgo"', 'primary')}${btn('취소', 'data-ev="upx"', 'ghost')}</div>`;
    }

    function render(keepScroll) {
        bnClose();   // #716 카드를 다시 그리면 칸이 바뀜 → 목록 창 닫음
        const root = $('event-root'); if (!root) return;
        if (S.loadErr) { root.dataset.mode = ''; root.innerHTML = `<div class="ev-loaderr" role="alert">${esc(S.loadErr)} ${btn('다시 불러오기', 'data-ev="reload"')}</div>`; return; }
        if (!S.ev) { root.dataset.mode = ''; root.innerHTML = '<p class="ev-empty">불러오는 중</p>'; return; }
        if (!S.id) {   // 회차가 아직 없음(lucky_events 0행) — 서버는 옛 회차로 보지만 화면은 새 회차부터만 길을 연다
            root.dataset.mode = 'none';
            root.innerHTML = `<div class="ev-headbox"><div class="ev-head"><div class="ev-head-main"><h2 class="ev-round">회차 없음</h2><span class="ev-pill ev-pill-off">회차 없음</span></div></div></div>
                <section class="ev-none" aria-labelledby="ev-none-h"><h3 id="ev-none-h">아직 만든 이벤트 회차가 없어요</h3><p class="ev-note">새 회차를 만들면 기간·경품·그림·문구를 차례로 채우고 미리보기로 확인한 뒤 열 수 있어요. 열기 전에는 손님에게 보이지 않아요.</p>${btn('새 회차 시작', 'data-ev="new"', 'primary')}</section>`;
            return;
        }
        const ck = check(), wide = isWide();
        const ae = document.activeElement, focusKey = ae && ae.dataset && ae.dataset.k, selS = ae && ae.selectionStart;
        // 뼈대(머리 · 카드 칸 · 오른쪽 미리보기)는 폭 꼴이 바뀔 때만 새로 — 오른쪽 iframe 이 다시 그릴 때마다 새로 읽히지 않게
        const mode = wide ? 'two' : 'one';
        if (root.dataset.mode !== mode || !root.querySelector('.ev-cards')) {
            if (S.pvOpen) closePv();   // 폭 꼴이 바뀌면 전체 화면 겹은 닫고(2단엔 오른쪽 판) 뼈대부터 새로
            root.dataset.mode = mode;
            root.innerHTML = `<div class="ev-headbox"></div><div class="ev-layout${wide ? ' two' : ''}"><div class="ev-cards"></div>
                ${wide ? `<aside class="ev-side" aria-label="손님 화면 미리보기"><div class="ev-side-h"><b>손님 화면 미리보기</b><span class="ev-f-h">저장 전 초안 · 글·그림을 고치면 그 장으로 넘어가요</span></div>${pvBarHtml()}${frameHtml()}<div class="ev-side-acts">${pvActs()}</div></aside>` : fabHtml()}</div>`;
            if (wide) hookFrame();
        } else { const fw = document.querySelector('#event-root .ev-side .ev-frame-wrap, #ev-pv-ov .ev-frame-wrap'); if (fw) fw.className = 'ev-frame-wrap ' + S.frame; const sa = document.querySelector('#event-root .ev-side-acts, #ev-pv-ov .ev-side-acts'); if (sa) sa.innerHTML = pvActs(); }
        root.querySelector('.ev-headbox').innerHTML = headHtml(ck);
        root.querySelector('.ev-cards').innerHTML = `${cardHtml(1, ck, step1)}${cardHtml(2, ck, step2)}${cardHtml(3, ck, step3)}${cardHtml(4, ck, step4)}${cardHtml(5, ck, () => step6(ck))}`;
        refreshPvBar();
        if (focusKey) { const el = root.querySelector(`[data-k="${CSS.escape(focusKey)}"]`); if (el) { el.focus(); try { if (selS != null) el.setSelectionRange(selS, selS); } catch (e) { } } }
        loadCandImgs();
        if (S.open.has(1) && !S.products) loadProducts();   // 회차 없음 → [새 회차] 로 처음 카드가 그려질 때도 품목 목록을 읽음(#711 실왕복에서 찾음)
        if (S.open.has(4)) refreshBot();   // ④ 가 펼쳐져 있으면 서버 글로 다시(경품 추가·빼기 등 단추 변경 포함)
    }
    // 머리·카드 상태만 다시(입력 중 칸을 다시 그리지 않음)
    function refreshStatus() {
        const root = $('event-root'); if (!root || !S.ev || !S.id) return;
        const ck = check(), hb = root.querySelector('.ev-headbox');
        if (hb) hb.innerHTML = headHtml(ck);
        STEPS.forEach(k => { const sec = root.querySelector(`.ev-card[data-step="${k}"]`); if (!sec) return; sec.classList.toggle('done', ck[k].ok); const st = sec.querySelector('.ev-card-h .ev-st'); if (st) { st.className = 'ev-st ' + (ck[k].ok ? 'ok' : 'no'); st.textContent = ck[k].ok ? '완료' : '미완'; st.setAttribute('aria-label', ck[k].ok ? '완료' : '미완'); } const sm = sec.querySelector('.ev-card-sum'); if (sm) sm.textContent = ck[k].sum; });
        const live = root.querySelector('[data-ev="live"]'); if (live) { live.disabled = !!ck.openMiss.length; }
        const lm = $('ev-lockmsg'); if (lm) lm.textContent = '열기 전에 채울 것: ' + ck.openMiss.join(' · ');
    }
    function hookFrame() {
        const f = $('ev-frame'); if (!f) return;
        f.addEventListener('load', () => postPreview(), { once: true });   // 옛 페이지(ready 를 안 보냄) 대비 · ready 가 오면 또 보냄
    }
    window.addEventListener('message', ev => {
        if (ev.origin !== location.origin || !ev.data || typeof ev.data !== 'object') return;
        const f = $('ev-frame'); if (!f || ev.source !== f.contentWindow) return;
        if (ev.data.type === 'lucky:ready') { const lf = S.lastFocus || ''; S.lastFocus = ''; S.readyResend = !!lf; postPreview(lf); }   // 늦게 뜬 iframe 에 한 번만 다시 실음(겹을 닫았다 열면 옛 칸이 또 반짝이지 않게)
    });

    // ── 값 넣기(data-k 경로) ──────────────────────────────
    function setK(k, v) {
        const e = S.ev;
        if (k === 'excluded') { S.excluded = String(v).split(',').map(s => s.trim()).filter(Boolean); return; }
        if (k === 'excludeProducts') { e.excludeProducts = String(v).split(',').map(s => s.trim()).filter(Boolean); return; }
        const p = k.split('.'); let o = e;
        for (let i = 0; i < p.length - 1; i++) { const key = /^\d+$/.test(p[i]) ? +p[i] : p[i]; if (o[key] == null) o[key] = /^\d+$/.test(p[i + 1]) ? [] : {}; o = o[key]; }
        const last = /^\d+$/.test(p[p.length - 1]) ? +p[p.length - 1] : p[p.length - 1];
        o[last] = (k.endsWith('.count')) ? Math.max(0, parseInt(v, 10) || 0) : v;
        if (k === 'announce' && v) { const was = S._annWas; if (!e.page_until || e.page_until === addDays(was, 3)) e.page_until = addDays(v, 3); }
        if (k === 'bot_reply.response') e.bot_reply.custom = true;
        if (k.startsWith('guide_card.')) { if (!e.guide_card.custom) { const ag = autoGuide(); e.guide_card.title = e.guide_card.title || ag.title; e.guide_card.lines = (e.guide_card.lines || []).map((x, i) => k === 'guide_card.lines.' + i ? x : (x || ag.lines[i])); } e.guide_card.custom = true; }
    }
    function onInput(ev) {
        const el = ev.target;
        if (el.id === 'ev-blabel') { S.bq = el.value; const r = $('ev-bres'); if (r) r.innerHTML = brandResults(); bnOpen(); return; }   // 검색만(저장할 값 아님)
        if (el.dataset && el.dataset.chip === 'xp') { S.pq = el.value; const pk = $('ev-xp-pick'); if (pk) pk.innerHTML = pickHtml(); return; }
        if (!el.dataset || !el.dataset.k) return;
        if (el.dataset.k === 'announce') S._annWas = S.ev.announce;
        setK(el.dataset.k, el.value);
        S.dirty = true;
        if (el.dataset.k === 'announce') { const pu = document.querySelector('#event-root [data-k="page_until"]'); if (pu) pu.value = S.ev.page_until || ''; }
        if (el.dataset.k !== 'bot_reply.response') refreshBot();
        autoView(el.dataset.k);
        refreshStatus(); postPreview(focusOf(el.dataset.k));
    }

    // ── 저장 · 서버 단추 ──────────────────────────────────
    function payload() {
        const e = clone(S.ev);
        if (!e.guide_card.custom) Object.assign(e.guide_card, autoGuide());
        if (!e.bot_reply.custom) e.bot_reply.response = '';
        e.prizes = (e.prizes || []).filter(p => String(p.name || '').trim()).map(p => { const b = p.image_id ? null : brandFor(p.name); return Object.assign({}, p, { name: String(p.name).trim(), count: Math.max(0, Number(p.count) || 0), image_id: p.image_id || (b && b.id) || null }); });   // 그림을 안 고른 경품 = 품목 실사진(설계 0-ㄷ)
        delete e.state; delete e.live_mode; delete e.checklist; delete e.display_title;   // #718 손님 화면 제목 칸 없음 → 안 보냄(서버 옛 값 그대로 · 지금 회차는 빈 값)
        return { event: e, excluded: S.excluded };
    }
    async function save(quiet) {
        if (S.saving) return false;
        S.saving = true; refreshStatus();
        const r = await call(A + '/event', 'POST', payload());
        S.saving = false;
        if (!r.ok) { refreshStatus(); toast(errText(r.body), 'error', 3600); return false; }
        if (r.body.db) takeDb(r.body.db, r.body.id != null ? r.body.id : S.id, r.body); else S.dirty = false;
        if (!quiet) toast(r.body.synced && (r.body.synced.card || r.body.synced.bot) ? '저장했어요 · 손님 페이지·카드·봇 답에도 반영' : '저장했어요', 'lime', 2600);
        render(); postPreview();
        return true;
    }
    async function act(path, body, okMsg) {
        S.busy = path;
        const r = await call(A + '/' + path, 'POST', body || {});
        S.busy = '';
        if (!r.ok) {
            const m = r.body && r.body.error === 'NOT_READY' && Array.isArray(r.body.missing) ? '먼저 채울 것: ' + r.body.missing.join(' · ') : (r.body && r.body.error === 'LIVE' ? '열려 있는 회차는 먼저 내린 뒤 복사할 수 있어요' : errText(r.body));
            toast(m, 'error', 4200); return null;
        }
        if (r.body.db) takeDb(r.body.db, r.body.id != null ? r.body.id : S.id, r.body);
        // 회차가 바뀌는 단추는 응답에 id·state 가 없을 수 있다 → /state 로 다시 읽어 회차 번호·상태·checklist 를 맞춘다
        if (['new-round', 'copy-round', 'reset'].includes(path) && (r.body.id == null || !r.body.state)) { const s2 = await call(A + '/state'); if (s2.ok && s2.body.db) takeDb(s2.body.db, s2.body.id, s2.body); }
        if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r.body) : okMsg, 'lime', 3200);
        render(); postPreview();
        return r.body;
    }

    // 확인 창(새 회차·초기화·열기·내리기 · 1번) — 화면 안 창(브라우저 confirm 금지 · #578)
    function confirmBox(title, msg, okLabel, danger) {
        return new Promise(resolve => {
            const ov = document.createElement('div');
            ov.className = 'ev-dlg-ov';
            ov.innerHTML = `<div class="ev-dlg" role="alertdialog" aria-modal="true" aria-labelledby="ev-dlg-t" aria-describedby="ev-dlg-m"><h3 id="ev-dlg-t">${esc(title)}</h3><p id="ev-dlg-m">${esc(msg)}</p>
                <div class="ev-row end">${btn('취소', 'data-x="0"', 'ghost')}${btn(esc(okLabel), 'data-x="1"', danger ? 'danger solid' : 'primary')}</div></div>`;
            const prev = document.activeElement;
            const end = v => { document.removeEventListener('keydown', key, true); ov.remove(); try { prev && prev.focus(); } catch (e) { } resolve(v); };
            const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); } };
            ov.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (b) end(b.dataset.x === '1'); else if (e.target === ov) end(false); });
            document.addEventListener('keydown', key, true);
            document.body.appendChild(ov);
            ov.querySelector('[data-x="1"]').focus();
        });
    }
    function pickRound() {
        return new Promise(async resolve => {
            const ov = document.createElement('div'); ov.className = 'ev-dlg-ov';
            ov.innerHTML = '<div class="ev-dlg" role="dialog" aria-modal="true" aria-labelledby="ev-pr-t"><h3 id="ev-pr-t">지난 회차 복사</h3><p class="ev-f-h">기간·제목·경품·그림·문구를 그대로 가져오고 날짜는 비워요. 주문·당첨자는 안 가져와요.</p><div class="ev-rlist">불러오는 중</div><div class="ev-row end"><button type="button" class="ev-btn ghost" data-x="0">닫기</button></div></div>';
            const end = v => { document.removeEventListener('keydown', key, true); ov.remove(); resolve(v); };
            const key = e => { if (e.key === 'Escape') { e.preventDefault(); end(null); } };
            ov.addEventListener('click', e => { const b = e.target.closest('[data-rid]'); if (b) return end(+b.dataset.rid); if (e.target.closest('[data-x]') || e.target === ov) end(null); });
            document.addEventListener('keydown', key, true); document.body.appendChild(ov); ov.querySelector('[data-x]').focus();
            const r = await call(A + '/rounds');
            const rows = (r.body.rounds || []).filter(x => String(x.id) !== String(S.id));
            ov.querySelector('.ev-rlist').innerHTML = rows.length ? rows.map(x => `<button type="button" class="ev-rrow" data-rid="${x.id}"><b>${esc(x.title || '이름 없는 회차')}</b><span>${esc(x.start || '')} ~ ${esc(x.end || '')} · 주문 ${x.orders || 0} · 당첨 ${x.winners || 0}</span></button>`).join('') : '<p class="ev-empty">복사할 지난 회차가 없어요.</p>';
        });
    }

    // ── 그림 줄이기(canvas → webp ≤ 400KB) · 올리기 ─────────
    const loadImg = src => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('그림을 읽지 못했어요')); im.src = src; });
    async function shrink(blob, slot) {
        const d = SLOTS[slot] || SLOTS.prize;
        const url = URL.createObjectURL(blob);
        try {
            const im = await loadImg(url);
            let w, h; const cv = document.createElement('canvas');
            if (slot === 'brand') {   // 품목 사진 = 정사각 가운데 자르기(cover) · 480×480(원본이 작으면 그 짧은 변)
                const side = Math.min(im.naturalWidth, im.naturalHeight); w = h = Math.max(1, Math.min(d.w, side));
                cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(im, (im.naturalWidth - side) / 2, (im.naturalHeight - side) / 2, side, side, 0, 0, w, h);
            } else {
                const maxW = d.w, maxH = slot === 'hero' ? 1200 : Math.max(d.h, d.w);
                const sc = Math.min(1, maxW / im.naturalWidth, maxH / im.naturalHeight);
                w = Math.max(1, Math.round(im.naturalWidth * sc)); h = Math.max(1, Math.round(im.naturalHeight * sc));
                cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(im, 0, 0, w, h);
            }
            let q = 0.86, out = null;
            for (let i = 0; i < 6; i++) { out = await new Promise(r => cv.toBlob(r, 'image/webp', q)); if (!out) break; if (out.size <= 400 * 1024) break; q -= 0.12; }
            if (!out || out.type !== 'image/webp') out = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.82));
            return { blob: out, w, h };
        } finally { URL.revokeObjectURL(url); }
    }
    const b64 = blob => new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] || ''); fr.onerror = () => no(fr.error); fr.readAsDataURL(blob); });
    async function uploadBlob(blob, slot, idx, label) {
        if (!/^image\/(png|jpe?g|webp|gif)$/.test(blob.type || '')) { toast('그림 파일(png·jpg·webp)만 올릴 수 있어요', 'error'); return; }
        toast('그림을 줄여서 올리는 중', undefined, 1600);
        let s; try { s = await shrink(blob, slot); } catch (e) { toast(e.message, 'error'); return; }
        const r = await call(A + '/assets', 'POST', { slot, mime: s.blob.type, data: await b64(s.blob), width: s.w, height: s.h, label: label || (slot === 'prize' ? ((S.ev.prizes[idx] || {}).name || '') : SLOTS[slot].label) });
        if (!r.ok) { toast(errText(r.body), 'error', 3600); return; }
        const a = r.body.asset || r.body; if (!a || a.id == null) { toast('올린 그림 번호를 받지 못했어요', 'error'); return; }
        S.assets = S.assets.filter(x => String(x.id) !== String(a.id)).concat([a]);
        const e = S.ev;
        if (slot === 'prize') { if (e.prizes[idx]) e.prizes[idx].image_id = a.id; }
        else e[SLOTS[slot].field] = a.id;
        S.dirty = true; autoView(slot);
        toast(`${SLOTS[slot].label} 올렸어요 · 저장하면 반영돼요`, 'lime', 2800);
        render(); postPreview(slot === 'prize' ? '' : 'images.' + slot);   // 경품 그림 자리는 focus 표에 없음(장만 default)
    }
    function pickFile(slot, idx) {
        const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/png,image/jpeg,image/webp'; f.hidden = true;
        f.onchange = () => { const x = f.files && f.files[0]; f.remove(); if (x) uploadBlob(x, slot, idx); };
        document.body.appendChild(f); f.click();
    }

    // ── AI로 그림 맡기기(에이전트 오피스 지시 · 설계 4절) ──
    function artSheet(slot, idx) {
        const d = SLOTS[slot], place = slot === 'prize' ? `경품 ${idx + 1}` : (slot === 'hero' ? '배너' : slot === 'winner' ? '발표' : '결과');
        const guess = slot === 'prize' ? (brandFor((S.ev.prizes[idx] || {}).name) || {}).name : '';
        const ov = document.createElement('div'); ov.className = 'ev-dlg-ov';
        ov.innerHTML = `<form class="ev-dlg ev-art" role="dialog" aria-modal="true" aria-labelledby="ev-art-t"><h3 id="ev-art-t">AI로 그림 맡기기 · ${esc(place)}</h3>
            <p class="ev-f-h">3D 아꼼이 기준 그림에 품목만 바꿔 넣어요. 끝나면 알림이 오고 후보 2~3장이 카드에 떠요.</p>
            ${field('품목', `<select class="ev-in" name="item">${brandNames().map(n => `<option${n === guess ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`)}
            ${field('아꼼이 자세', `<select class="ev-in" name="pose">${POSES.map(p => `<option${p === d.pose ? ' selected' : ''}>${p}</option>`).join('')}</select>`)}
            ${field('한 줄 요청(선택)', '<input type="text" class="ev-in" name="ask" maxlength="80" placeholder="예: 가을 느낌 · 노란 바탕" autocomplete="off">')}
            <div class="ev-row end">${btn('취소', 'data-x="0"', 'ghost')}<button type="submit" class="ev-btn primary">맡기기</button></div></form>`;
        const end = () => { document.removeEventListener('keydown', key, true); ov.remove(); };
        const key = e => { if (e.key === 'Escape') { e.preventDefault(); end(); } };
        ov.addEventListener('click', e => { if (e.target.closest('[data-x]') || e.target === ov) end(); });
        ov.querySelector('form').addEventListener('submit', async e => {
            e.preventDefault(); const fd = new FormData(e.target);
            const content = `[이벤트그림] 회차 #${S.id || '-'} · 자리 ${place} · 품목 ${fd.get('item')} · 자세 ${fd.get('pose')} · 크기 ${d.w}x${d.h} · 요청: ${String(fd.get('ask') || '').trim() || '없음'}\n후보 2~3장을 첨부로 답해 주세요(글자 없는 그림 · 3D 아꼼이 기준 · 품목 실사진 참고).`;
            const sb = e.target.querySelector('[type="submit"]'); sb.disabled = true; sb.textContent = '보내는 중';
            const r = await call('/api/agent-office/orders', 'POST', { content });
            const oid = r.body && r.body.order && r.body.order.id;
            if (!r.status || r.status >= 400 || !oid) { sb.disabled = false; sb.textContent = '맡기기'; toast(errText(r.body), 'error', 3600); return; }
            end();
            S.ev.pending_art = (S.ev.pending_art || []).concat([{ order_id: oid, slot: slot === 'prize' ? 'prize:' + idx : slot, at: new Date().toISOString() }]);
            S.cand[oid] = { files: [] };
            toast(`아꼼이에게 맡겼어요 · 지시 #${oid}`, 'lime', 3200);
            await save(true); pollCand();
        });
        document.addEventListener('keydown', key, true); document.body.appendChild(ov); ov.querySelector('select').focus();
    }
    async function pollCand() {
        const pend = (S.ev && S.ev.pending_art) || []; let changed = false;
        await Promise.all(pend.map(async p => {
            const r = await call('/api/agent-office/orders/' + p.order_id);
            const o = r.body && r.body.order, res = o && o.result || {};
            const files = (Array.isArray(res.files) ? res.files : []).filter(f => f && f.file_id && /\.(png|jpe?g|webp|gif)$/i.test(f.label || ''));
            const prev = S.cand[p.order_id];
            const next = { files: files.map(f => ({ id: f.file_id, filename: f.label })), err: r.status === 404 ? '지시를 찾지 못했어요' : (o && /오류/.test(o.status) ? '아꼼이가 그림을 못 만들었어요' : '') };
            if (!prev || prev.files.length !== next.files.length || prev.err !== next.err) changed = true;
            S.cand[p.order_id] = next;
        }));
        if (changed) render();
    }
    const blobCache = {};
    async function fileBlob(fid) {
        if (blobCache[fid]) return blobCache[fid];
        const r = await fetch('/api/agent-office/files/' + fid + '/download', { headers: tokenHdr() });
        if (!r.ok) throw new Error('후보 그림을 받지 못했어요');
        return (blobCache[fid] = await r.blob());
    }
    function loadCandImgs() {
        document.querySelectorAll('#event-root img[data-fid]').forEach(async im => {
            try { const b = await fileBlob(im.dataset.fid); if (!im.src) im.src = URL.createObjectURL(b); } catch (e) { im.alt = e.message; }
        });
    }

    // ── 송장 엑셀(옛 lucky-admin 과 같은 읽기) ───────────────
    const H = (row, names) => { for (const n of names) { const k = Object.keys(row).find(k => k.replace(/\s|_x000D_|\n/g, '') === n.replace(/\s/g, '')); if (k != null && row[k] != null && String(row[k]).trim() !== '') return String(row[k]).trim(); } return ''; };
    const normDate = v => { if (v instanceof Date) return v.toISOString().slice(0, 10); const m = String(v).match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : ''; };
    async function parseFile(f) {
        if (typeof XLSX === 'undefined') throw new Error('엑셀 도구를 불러오지 못했어요');
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
        const sheets = wb.SheetNames.map(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }));
        const hasKey = (s, re) => s.length && Object.keys(s[0]).some(k => re.test(k));
        const s2 = sheets.find(s => hasKey(s, /운송장/) && hasKey(s, /수취인명|받는분/)), s1 = sheets.find(s => s !== s2 && hasKey(s, /수취인명|받는분/));
        const main = s2 || s1 || sheets[0] || []; const track = {}, buyerMap = {}; let d2 = '';
        if (s2) s2.forEach(r => { const rn = H(r, ['받는분', '수취인명']), rp = digits(H(r, ['받는분전화번호', '수취인연락처1'])), pd = H(r, ['상품명', '옵션정보']), t = H(r, ['운송장번호']), d = H(r, ['집화예정일자']); if (d && !d2) d2 = normDate(d); if (t) track[rn + '|' + rp + '|' + pd.slice(0, 20)] = t; if (t && !track[rn + '|' + rp]) track[rn + '|' + rp] = t; });
        if (s1 && main === s2) s1.forEach(r => { const rn = H(r, ['수취인명', '받는분']), rp = digits(H(r, ['수취인연락처1', '받는분전화번호', '수취인연락처'])), bp = H(r, ['구매자연락처', '주문자연락처']); if (bp && !buyerMap[rn + '|' + rp]) buyerMap[rn + '|' + rp] = bp; });
        const vendor = /대성/.test(f.name) ? '대성' : /효돈/.test(f.name) ? '효돈' : '';
        const m = f.name.match(/(\d{1,2})[.\-_](\d{1,2})/); const date = d2 || (m ? `${new Date().getFullYear()}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : kstToday());
        const orders = main.map(r => {
            const raw = H(r, ['보내는사람', '보내는분']), buyer = raw.replace(/\(.*?\)/g, '').trim(), channel = (raw.match(/\((.*?)\)/) || [])[1] || '';
            const recv = H(r, ['수취인명', '받는분']), recvPhone = H(r, ['수취인연락처1', '받는분전화번호', '수취인연락처']), recvPhone2 = H(r, ['수취인연락처2']);
            const buyerPhone = H(r, ['구매자연락처', '주문자연락처']) || buyerMap[recv + '|' + digits(recvPhone)] || H(r, ['보내는사람연락처', '보내는분전화번호']), buyerPhone2 = H(r, ['보내는사람연락처', '보내는분전화번호']);
            const product = H(r, ['옵션정보', '상품명', '단품명']), qty = +H(r, ['수량']) || 1, addr = H(r, ['배송지', '받는분주소']);
            const tracking = H(r, ['운송장번호']) || track[recv + '|' + digits(recvPhone) + '|' + product.slice(0, 20)] || track[recv + '|' + digits(recvPhone)] || '';
            if (!recv && !buyer) return null;
            return { vendor, date, buyer, buyerPhone, buyerPhone2, recv, recvPhone, recvPhone2, product, qty, addr, tracking, channel };
        }).filter(Boolean);
        return { name: f.name, vendor, date, orders, tracked: orders.filter(o => o.tracking).length };
    }
    async function takeFiles(files) {
        S.ordersPending = [];
        for (const f of files) { try { S.ordersPending.push(await parseFile(f)); } catch (e) { toast(f.name + ' 읽기 실패: ' + e.message, 'error', 4000); } }
        const box = $('ev-upprev'); if (box) box.innerHTML = upPreview();
    }

    // ── 단추 ──────────────────────────────────────────────
    async function onClick(e) {
        const b = e.target.closest('[data-ev]'); if (!b || b.disabled) return;
        const a = b.dataset.ev, i = +b.dataset.i;
        const E = S.ev;
        switch (a) {
            case 'reload': return enter(true);
            case 'chipadd': { const k = b.dataset.kind, el = $('ev-' + k + '-in'); addChip(k, el && el.value); return; }
            case 'chipx': { const k = b.dataset.kind; if (k === 'xp') E.excludeProducts = E.excludeProducts.filter((_, j) => j !== i); else S.excluded = S.excluded.filter((_, j) => j !== i); S.dirty = true; if (k === 'xp') autoView('excludeProducts'); reChips(k); postPreview(k === 'xp' ? 'excludeProducts' : ''); return; }
            case 'pick': addChip('xp', b.dataset.v); return;
            case 'pvopen': openPv(); postPreview(); return;
            case 'pvclose': closePv(); return;
            case 'fold': { const k = +b.dataset.step; if (k === 2) loadItemNames(); if (k === 1 && !S.open.has(1)) loadProducts(true); S.open.has(k) ? S.open.delete(k) : S.open.add(k); render(); if (S.open.has(k)) { const sec = $('ev-step-' + k); if (sec && sec.getBoundingClientRect().top < 0) sec.scrollIntoView({ block: 'start' }); } return; }
            case 'save': return save();
            case 'padd': E.prizes.push({ name: '', count: 1, desc: '', note: '' }); S.dirty = true; render(); { const el = document.querySelector(`#event-root [data-k="prizes.${E.prizes.length - 1}.name"]`); if (el) el.focus(); } postPreview(); return;
            case 'pdel': E.prizes.splice(i, 1); S.dirty = true; render(); postPreview(); return;
            case 'pup': case 'pdown': { const j = a === 'pup' ? i - 1 : i + 1; if (j < 0 || j >= E.prizes.length) return; [E.prizes[i], E.prizes[j]] = [E.prizes[j], E.prizes[i]]; S.dirty = true; render(); postPreview(); return; }
            case 'upload': return pickFile(b.dataset.slot, i);
            case 'badd': { const v = ($('ev-blabel') || {}).value || ''; if (!v.trim()) { toast('품목 이름을 먼저 적어 주세요', 'error'); $('ev-blabel').focus(); return; } return pickBrand(v); }
            case 'brep': return pickBrand(b.dataset.label, +b.dataset.id);
            case 'bdel': {
                if (!await confirmBox('이 품목 사진을 지울까요?', '지운 사진은 경품 그림 기본값으로 더 쓰이지 않아요. 지난 회차 복사본에서도 빠져요.', '지우기', true)) return;
                const d = await call(A + '/assets/' + b.dataset.id, 'DELETE');
                if (d.status === 409) { toast('지금 회차 경품이 이 사진을 쓰고 있어 지울 수 없어요. 경품 그림을 바꾼 뒤 지워 주세요', 'error', 4600); return; }
                if (!d.ok) { toast(errText(d.body), 'error'); return; }
                S.assets = S.assets.filter(a => String(a.id) !== b.dataset.id); toast('지웠어요', 'lime'); render(); return;
            }
            case 'art': return artSheet(b.dataset.slot, i);
            case 'unset': { const s = b.dataset.slot; E[SLOTS[s].field] = null; S.dirty = true; autoView(s); render(); postPreview('images.' + s); return; }
            case 'candx': E.pending_art = E.pending_art.filter(p => String(p.order_id) !== b.dataset.order); S.dirty = true; render(); return;
            case 'usecand': {
                const key = b.dataset.slot, slot = key.startsWith('prize:') ? 'prize' : key, idx = slot === 'prize' ? +key.split(':')[1] : undefined;
                try { const bl = await fileBlob(b.dataset.fid); await uploadBlob(bl, slot, idx); } catch (err) { toast(err.message, 'error'); }
                return;
            }
            case 'botauto': E.bot_reply.custom = false; E.bot_reply.response = ''; S.dirty = true; render(); return;
            case 'guideauto': E.guide_card.custom = false; Object.assign(E.guide_card, autoGuide()); S.dirty = true; render(); return;
            case 'view': S.view = b.dataset.v; refreshPvBar(); postPreview(); return;   // 손으로 고른 장 = 탭 줄만 다시(카드·겹은 그대로) · 다음 글·그림 입력이 오면 다시 자동
            case 'frame': S.frame = S.frame === 'phone' ? 'wide' : 'phone'; render(); return;
            case 'pvlink': {
                const r = await call(A + '/preview-key');
                const url = r.body && (r.body.url || (r.body.pk && '/lucky.html?pk=' + encodeURIComponent(r.body.pk)));
                if (!url) { toast(errText(r.body), 'error'); return; }
                const full = /^https?:/.test(url) ? url : location.origin + url;
                try { await navigator.clipboard.writeText(full); toast('미리보기 링크를 복사했어요(1시간)', 'lime'); } catch (err) { if (typeof akmAlert === 'function') akmAlert('이 링크를 복사해 주세요(1시간)\n' + full); }
                return;
            }
            case 'live': case 'sched': {
                const ck = check(); if (ck.openMiss.length) { toast('먼저 채울 것: ' + ck.openMiss[0], 'error'); return; }
                const sched = a === 'sched';
                if (!await confirmBox(sched ? '시작일에 자동으로 열까요?' : '이벤트를 지금 열까요?', sched ? `${mdw(E.start)} 00:00 에 손님 페이지 · /guide 카드 · 봇 답이 한 번에 열려요.` : '손님 페이지 · /guide 카드 · 봇 답(#59)에 지금 바로 보여요.', sched ? '예약' : '지금 열기')) return;
                if (S.dirty && !await save(true)) return;
                return act('go-live', { mode: sched ? 'scheduled' : 'live' }, sched ? '예약했어요' : '이벤트를 열었어요');
            }
            case 'unsched': if (S.dirty && !await save(true)) return; return act('go-live', { mode: 'draft' }, '예약을 풀었어요');
            case 'down':
                if (!await confirmBox('페이지를 내릴까요?', '손님 페이지가 「이벤트가 끝났어요」로 바뀌고 /guide 카드·봇 답도 꺼져요. 다시 열 수 있어요.', '내리기', true)) return;
                return act('go-live', { mode: 'down' }, '페이지를 내렸어요');
            case 'new': {
                if (S.dirty && !await confirmBox('저장 안 한 변경이 있어요', '새 회차를 만들면 지금 고친 내용은 사라져요.', '버리고 계속', true)) return;
                if (!await confirmBox('새 회차를 시작할까요?', S.id ? '지금 회차는 지워지지 않고 보관돼요. 빈 회차가 새로 만들어져요.' : '빈 회차가 새로 만들어져요. 열기 전에는 손님에게 보이지 않아요.', '새 회차 시작', !!S.id)) return;
                S.open = new Set([1]);
                return act('new-round', { confirm: 'NEW', title: '새 이벤트' }, '새 회차를 만들었어요 · ①부터 채워 주세요');
            }
            case 'copy': {
                if (isOpen()) { toast('열려 있는 회차는 먼저 내린 뒤 복사할 수 있어요', 'error', 3600); return; }
                const rid = await pickRound(); if (!rid) return;
                if (!await confirmBox('이 회차 설정을 가져올까요?', '지금 회차의 설정(제목·경품·그림·문구)이 바뀌어요. 주문·당첨자는 그대로예요.', '가져오기', true)) return;
                S.open = new Set([1]);
                return act('copy-round', { from_id: rid, title: '' }, '지난 회차 설정을 가져왔어요 · 날짜를 채워 주세요');
            }
            case 'reset':
                if (!await confirmBox('이 회차를 초기화할까요?', `이 회차의 주문 ${((S.db || {}).orders || []).length}건·당첨 기록을 지우고 날짜·경품·제외 품목도 비운 초안 상태로 돌립니다.${isOpen() ? ' 열려 있는 손님 페이지·/guide 카드·봇 답도 닫혀요.' : ''} 되돌릴 수 없어요.`, '초기화', true)) return;
                return act('reset', { confirm: 'RESET' }, '초기화했어요');
            case 'draw': {
                const d = S.db || {};
                if ((d.winners || []).length && !await confirmBox('다시 추첨할까요?', '이미 뽑은 당첨자가 있어요. 전부 새로 뽑아요.', '다시 추첨', true)) return;
                return act('draw', {}, j => `추첨 끝 · 응모 ${j.pool || 0}명(응모권 ${j.tickets || 0}장) 중 ${((S.db || {}).winners || []).length}명`);
            }
            case 'pub': if (!await confirmBox('발표를 시작할까요?', '손님 화면에 당첨·미당첨 결과가 보여요.', '발표 시작')) return; return act('publish', { published: true }, '발표를 시작했어요');
            case 'unpub': return act('publish', { published: false }, '발표를 숨겼어요');
            case 'wcopy': { const t = ((S.db || {}).winners || []).map((w, k) => `${k + 1}. ${w.prize} — ${w.name} ${w.phone}`).join('\n'); try { await navigator.clipboard.writeText(t); toast('당첨자 목록을 복사했어요', 'lime'); } catch (err) { toast('복사하지 못했어요', 'error'); } return; }
            case 'wxlsx': { if (typeof XLSX === 'undefined') return; const ws = XLSX.utils.json_to_sheet(((S.db || {}).winners || []).map((w, k) => ({ 번호: k + 1, 경품: w.prize, 고객: w.name, 연락처: w.phone, 주문상품: w.product, 주문건수: w.orders, 발송일: w.date }))); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '당첨자'); XLSX.writeFile(wb, '당첨자_' + (E.end || kstToday()) + '.xlsx'); return; }
            case 'updel':
                if (!await confirmBox('이 송장을 지울까요?', `${b.dataset.date} ${b.dataset.vendor} 송장 전체를 지워요.`, '지우기', true)) return;
                return act('remove', { vendor: b.dataset.vendor, date: b.dataset.date }, j => `${j.removed || 0}건 지웠어요`);
            case 'upx': S.ordersPending = []; { const box = $('ev-upprev'); if (box) box.innerHTML = ''; } return;
            case 'upgo': {
                b.disabled = true; let added = 0, dup = 0;
                for (const p of S.ordersPending) {
                    const r = await call(A + '/orders', 'POST', { orders: p.orders.map(o => Object.assign({}, o, { vendor: p.vendor || '기타', date: p.date })), label: p.name });
                    if (!r.ok) { toast('등록 실패: ' + errText(r.body), 'error', 4000); b.disabled = false; return; }
                    added += r.body.added || 0; dup += r.body.dup || 0; if (r.body.db) { const keep = S.dirty ? clone(S.ev) : null; const ex = S.excluded.slice(); takeDb(r.body.db, null, r.body); if (keep) { S.ev = keep; S.excluded = ex; S.dirty = true; } }
                }
                S.ordersPending = []; toast(`등록했어요 · 새로 ${added}건 · 중복 ${dup}건`, 'lime', 4000); render(); return;
            }
        }
    }
    function onChange(e) {
        const t = e.target;
        if (t.id === 'ev-xlsx') { takeFiles([...t.files]); t.value = ''; return; }
        if (t.dataset.upv != null) { S.ordersPending[+t.dataset.upv].vendor = t.value; return; }
        if (t.dataset.upd != null) { S.ordersPending[+t.dataset.upd].date = t.value; return; }
        if (t.dataset.k && t.classList.contains('akm-date')) onInput(e);   // 달력은 change 로만 알림
        if (t.dataset.k && t.type === 'number') { onInput(e); }
    }

    // ── 들어오기 ─────────────────────────────────────────
    async function enter(force) {
        mount();
        if (S.ev && !force) { render(); return; }
        S.loadErr = ''; render();
        const [st, as] = await Promise.all([call(A + '/state'), call(A + '/assets')]);
        if (!st.ok) { S.loadErr = st.status === 403 ? '이 메뉴를 볼 권한이 없어요' : '이벤트 설정을 불러오지 못했어요. ' + errText(st.body); render(); return; }
        S.assets = as.ok && Array.isArray(as.body.assets) ? as.body.assets : [];
        takeDb(st.body.db, st.body.id, st.body);
        render(); pollCand(); if (S.id) loadProducts();
    }
    function mount() {
        if (S.mounted) return; const root = $('event-root'); if (!root) return; S.mounted = true;
        root.addEventListener('click', onClick);
        root.addEventListener('input', onInput);
        root.addEventListener('change', onChange);
        root.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.target.dataset && e.target.dataset.chip) { e.preventDefault(); addChip(e.target.dataset.chip, e.target.value); } });   // 칩 칸 Enter = [+ 추가](한글 조합 중 제외)
        // #718 「더 보기」 열고 닫음 기억(details toggle 은 안 번짐 → capture) · ② 는 경품 손글씨 칸을 같이 보임/숨김
        const onMore = e => { const d = e.target; if (!(d instanceof HTMLDetailsElement) || !d.dataset.more) return; if (!S.more) S.more = new Set(); d.open ? S.more.add(d.dataset.more) : S.more.delete(d.dataset.more); if (d.dataset.more === '2') document.querySelectorAll('#event-root .ev-prize [data-k$=".note"]').forEach(el => { el.hidden = !d.open; }); };
        root.addEventListener('toggle', onMore, true);
        document.addEventListener('toggle', e => { if (e.target.closest && e.target.closest('#ev-pv-ov')) onMore(e); }, true);
        root.addEventListener('keydown', e => { if (e.target.id === 'ev-drop' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); $('ev-xlsx').click(); } });
        root.addEventListener('click', e => { if (e.target.closest('#ev-drop') && e.target.id !== 'ev-xlsx') $('ev-xlsx').click(); });
        // #716 품목 이름 찾기 목록 창 — 칸을 누르거나 초점이 오면 열림(빈 칸 = 전체) · 바깥 누름·Esc·Tab 닫힘 · 화면이 움직이면 따라감
        root.addEventListener('focusin', e => { if (e.target.id === 'ev-blabel') bnOpen(); });
        root.addEventListener('click', e => { if (e.target.id === 'ev-blabel' && !BN.open) bnOpen(); });
        root.addEventListener('keydown', e => { if (e.target.id === 'ev-blabel') bnKey(e); });
        root.addEventListener('focusout', e => { if (e.target.id === 'ev-blabel') setTimeout(() => { if (document.activeElement !== $('ev-blabel')) bnClose(); }, 0); });
        document.addEventListener('pointerdown', e => { if (BN.open && !(e.target.closest && (e.target.closest('#ev-bnpanel') || e.target.id === 'ev-blabel'))) bnClose(); }, true);
        window.addEventListener('resize', () => { if (BN.open) bnPlace(); });
        window.addEventListener('scroll', e => { if (BN.open && !(e.target && e.target.closest && e.target.closest('#ev-bnpanel'))) bnPlace(true); }, { passive: true, capture: true });
        if (window.visualViewport) { window.visualViewport.addEventListener('resize', () => { if (BN.open) bnPlace(); }); window.visualViewport.addEventListener('scroll', () => { if (BN.open) bnPlace(true); }); }
        root.addEventListener('dragover', e => { const d = e.target.closest('#ev-drop'); if (d) { e.preventDefault(); d.classList.add('on'); } });
        root.addEventListener('dragleave', e => { const d = e.target.closest('#ev-drop'); if (d) d.classList.remove('on'); });
        root.addEventListener('drop', e => { const d = e.target.closest('#ev-drop'); if (d) { e.preventDefault(); d.classList.remove('on'); takeFiles([...e.dataTransfer.files]); } });
        let lastWide = isWide();
        window.addEventListener('resize', () => { const w = isWide(); if (w !== lastWide && isActive()) { lastWide = w; render(); } });
        window.addEventListener('beforeunload', e => { if (S.dirty && isActive()) { e.preventDefault(); e.returnValue = ''; } });
        setInterval(() => { if (isActive() && S.ev && (S.ev.pending_art || []).some(p => !(S.cand[p.order_id] && S.cand[p.order_id].files.length))) pollCand(); }, 30000);
    }
    // 2단 = 본문 칸 자체가 900px 이상일 때(사이드바 몫을 뺀 폭 · 폴드7 펼침 900 은 사이드바가 있어 본문 약 660 → 한 줄 + ⑤ 카드 안 미리보기)
    const isWide = () => { const r = $('event-root'); return !!(r && r.clientWidth >= 900); };
    const isActive = () => { const p = $('page-event'); return !!(p && p.classList.contains('active')); };

    window.AkmEvent = {
        enter: () => enter(false),
        // 알림 링크 event?step=3 → 그 카드 펼쳐 보이기
        open: async step => { await enter(false); const k = Math.min(STEPS.length, Math.max(1, +step || 1)); S.open.add(k); render(); const sec = $('ev-step-' + k); if (sec) sec.scrollIntoView({ block: 'start' }); pollCand(); },
        _state: S,
    };
})();
