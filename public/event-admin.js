// #708-B(대표 10/15 「지금 구도대로 고」) 이벤트 관리 — 회사프로그램 안 메뉴(data-page="event" · #page-event)
//   직원이 터미널 없이 한 회차를 처음부터 끝까지: 머리띠(상태 · 준비 n/6 · 지난 회차 복사 · 새 회차) + 단계 카드 6개
//   ①기간·제목 ②경품 ③상단 그림 ④문구 ⑤미리보기 ⑥열기·운영 · 오른쪽(펼침 900↑) = 미리보기 고정.
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
        noitem_products: '감귤·황금향 등',
    };
    // 셋째 = 글자 상한(서버 120) · 넷째 = 줄바꿈 칸(textarea)
    const TEXT_LABEL = [
        ['prize_head_hand', '경품 카드 위 손글씨', 40],
        ['corner_hand', '오른쪽 아래 손글씨', 40, true],
        ['search_hand', '조회 칸 손글씨', 40],
        ['winner_hand', '발표 창 손글씨', 40],
        ['winner_foot', '발표 창 아래 안내', 120, true],
        ['noitem_products', '「○○ 등 다른 상품 주문은 자동 접수」의 ○○', 40],
    ];
    const SLOTS = {
        hero: { label: '배너 그림', w: 1200, h: 350, pose: '상자들기', field: 'hero_image_id' },
        winner: { label: '발표 창 그림', w: 900, h: 471, pose: '기쁨', field: 'winner_image_id' },
        result: { label: '결과 그림', w: 400, h: 400, pose: '인사', field: 'result_image_id' },
        prize: { label: '경품 그림', w: 480, h: 480, pose: '귤들기', field: 'image_id' },
    };
    const POSES = ['인사', '귤들기', '상자들기', '기쁨', '엄지척', '안내'];
    const BRAND_FALLBACK = ['고당도 하우스귤', '그린레몬', '노란레몬', '유라조생', '황금향'];
    const STEP_TITLE = ['', '기간·제목', '경품', '상단 그림', '문구', '미리보기', '열기·운영'];
    const STATE_LABEL = { preparing: ['준비 중', 'ev-pill-off'], scheduled: ['예약됨', 'ev-pill-wait'], live: ['진행 중', 'ev-pill-ok'], published: ['발표 중', 'ev-pill-ok'], down: ['내려감', 'ev-pill-off'] };
    const AD_WORDS = /할인|쿠폰|%|\d\s*원/;   // /guide 카드 글엔 넣지 않음(광고성 선 · 설계 5절)

    const S = {
        db: null, id: null, ev: null, excluded: [], dirty: false, saving: false, loadErr: '',
        rounds: null, assets: [], open: new Set([1]), view: 'default', frame: 'phone',
        cand: {}, busy: '', ordersPending: [], previewTimer: 0, mounted: false,
    };
    const seenKey = () => 'akm_ev_seen_' + (S.id || 'new');
    const seen = () => { try { return sessionStorage.getItem(seenKey()) === '1'; } catch (e) { return false; } };
    const markSeen = () => { try { sessionStorage.setItem(seenKey(), '1'); } catch (e) { } };

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
        S.dirty = false;
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
        const n = String(name || '').replace(/\s+/g, '');
        const keys = [['황금향', '황금향'], ['레드키위', '레드키위'], ['노란레몬', '노란레몬'], ['그린레몬', '그린레몬'], ['레몬', '그린레몬'], ['유라', '유라조생'], ['하우스', '고당도 하우스귤'], ['감귤', '고당도 하우스귤'], ['귤', '고당도 하우스귤']];
        const hit = keys.find(([k]) => n.includes(k)); if (!hit) return null;
        const a = brandAssets().find(x => String(x.label || '').replace(/\s+/g, '').includes(hit[1].replace(/\s+/g, '')));
        return { id: a ? a.id : null, name: hit[1] };
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
        const t = (e.display_title || e.title || '').trim();
        const miss1 = [];
        if (!t) miss1.push('제목'); if (!e.start) miss1.push('응모 시작'); if (!e.end) miss1.push('응모 끝'); if (!e.announce) miss1.push('발표일'); if (!e.page_until) miss1.push('내리는 날');
        if (!miss1.length && !(e.start <= e.end && e.end <= e.announce && e.announce <= e.page_until)) miss1.push('날짜 순서(시작 ≤ 끝 ≤ 발표 ≤ 내림)');
        out[1] = { ok: !miss1.length, miss: miss1, sum: miss1.length ? '빠짐: ' + miss1.join(' · ') : `${mdw(e.start)} ~ ${mdw(e.end)} · 발표 ${mdw(e.announce)} · 내림 ${mdw(e.page_until)}` };
        const ps = e.prizes || [], miss2 = [];
        if (!ps.length) miss2.push('경품 1개 이상');
        ps.forEach((p, i) => { if (!String(p.name || '').trim()) miss2.push(`${i + 1}등 이름`); if (!(Number(p.count) > 0)) miss2.push(`${i + 1}등 인원`); if (!prizeImg(p)) miss2.push(`${i + 1}등 그림`); });
        const people = ps.reduce((a, p) => a + (Number(p.count) || 0), 0);
        out[2] = { ok: !miss2.length, miss: miss2, sum: miss2.length ? '빠짐: ' + miss2.join(' · ') : `경품 ${ps.length}개 · 총 ${people}명` };
        const heroOn = !!e.hero_image_id, winOn = !!e.winner_image_id;
        out[3] = { ok: true, miss: [], sum: `배너 ${heroOn ? '올린 그림' : '기본 그림'} · 발표 ${winOn ? '올린 그림' : '기본 그림'}${(e.pending_art || []).length ? ' · 아꼼이가 만드는 중 ' + e.pending_art.length + '건' : ''}` };
        const tx = e.texts || {}, filled = TEXT_LABEL.filter(([k]) => String(tx[k] || '').trim()).length;
        out[4] = { ok: true, miss: [], sum: `손글씨 ${filled ? filled + '곳 바꿈' : '기본 글자'}${e.coupon_text ? ' · 쿠폰 문구 있음' : ''}` };
        out[5] = { ok: seen(), miss: seen() ? [] : ['미리보기 한 번 열어 보기'], sum: seen() ? '확인함' : '아직 안 열어 봄' };
        const st = stateOf();
        out[6] = { ok: ['live', 'published'].includes(st), miss: [], sum: STATE_LABEL[st][0] + (st === 'scheduled' ? ' ' + mdw(e.start) + ' 00:00' : '') };
        const srv = S.srvCheck && S.srvCheck.steps; if (srv && !S.dirty) [[1, 'basics'], [2, 'prizes'], [3, 'images']].forEach(([k, n]) => { if (typeof srv[n] === 'boolean' && srv[n] !== out[k].ok) { out[k].ok = srv[n]; if (!srv[n] && !out[k].miss.length) out[k].miss = (S.srvCheck.missing || []).slice(); } });
        out.n = [1, 2, 3, 4, 5, 6].filter(k => out[k].ok).length;
        out.openMiss = [1, 2, 3].filter(k => !out[k].ok).map(k => STEP_TITLE[k] + '(' + out[k].miss.join(', ') + ')');
        return out;
    }

    // ── 자동 문구(/guide 카드 · 봇 답 #59) — 서버도 같은 꼴로 만든다(설계 5절) · 화면은 미리보기와 「다시 생성」용 ──
    function autoGuide() {
        const e = S.ev, ps = e.prizes || [], people = ps.reduce((a, p) => a + (Number(p.count) || 0), 0);
        return {
            title: e.display_title || e.title || '',
            lines: [
                `응모 기간 ${mdw(e.start)} ~ ${mdw(e.end)} 주문 고객 자동 응모`,
                ps.length ? `총 ${people}명 추첨: ` + ps.map((p, i) => `${i + 1}등 ${p.name} ${p.count}명`).join(' · ') : '',
                e.announce ? `발표 ${mdw(e.announce)} · 이름이나 번호로 당첨 확인` : '',
            ],
            btn: '접수·당첨 확인 바로가기',
        };
    }
    function autoBot() {
        const e = S.ev, ps = e.prizes || [];
        return [
            `${e.display_title || e.title || '고객 감사 이벤트'} 안내드려요.`,
            `응모 기간: ${mdw(e.start)} ~ ${mdw(e.end)} (기간 안 주문은 자동 응모 · 따로 신청 없음)`,
            ps.length ? '경품: ' + ps.map((p, i) => `${i + 1}등 ${p.name} ${p.count}명`).join(', ') : '',
            e.coupon_text ? e.coupon_text : '',
            e.announce ? `발표: ${mdw(e.announce)} · 아래 링크에서 이름이나 번호로 확인하실 수 있어요.` : '',
            'https://event.akkome.com/lucky.html',
        ].filter(Boolean).join('\n');
    }

    // ── 미리보기로 넘길 초안(lucky.html 이 읽는 공개 응답 꼴 · 설계 2-3) ──
    function previewPayload() {
        const e = S.ev;
        return {
            title: e.title, display_title: e.display_title || e.title, start: e.start, end: e.end, announce: e.announce, page_until: e.page_until,
            excludeProducts: e.excludeProducts, published: S.view === 'winners', state: S.view === 'winners' ? 'published' : 'live', live_mode: e.live_mode || 'draft',
            prizes: (e.prizes || []).map(p => { const im = prizeImg(p); return { name: p.name, count: Number(p.count) || 0, desc: p.desc || '', note: p.note || '', image: im ? im.url : null }; }),
            images: { hero: e.hero_image_id ? assetUrl(e.hero_image_id) : null, winner: e.winner_image_id ? assetUrl(e.winner_image_id) : null, result: e.result_image_id ? assetUrl(e.result_image_id) : null },
            texts: Object.assign({}, TEXT_DEFAULT, Object.fromEntries(Object.entries(e.texts || {}).filter(([, v]) => String(v || '').trim()))),
        };
    }
    function postPreview() {
        clearTimeout(S.previewTimer);
        S.previewTimer = setTimeout(() => {
            const f = $('ev-frame'); if (!f || !f.contentWindow) return;
            try { f.contentWindow.postMessage({ type: 'lucky:preview', event: previewPayload(), counts: { orders: 0, customers: 0 }, scene: S.view }, location.origin); } catch (e) { }
        }, 120);
    }

    // ── 그리기 ────────────────────────────────────────────
    const btn = (label, attrs, cls) => `<button type="button" class="ev-btn${cls ? ' ' + cls : ''}" ${attrs || ''}>${label}</button>`;
    const field = (label, inner, hint) => `<label class="ev-f"><span class="ev-f-l">${label}</span>${inner}${hint ? `<span class="ev-f-h">${hint}</span>` : ''}</label>`;
    const inp = (k, v, ph, extra) => `<input type="text" class="ev-in" data-k="${k}" value="${esc(v)}"${ph ? ` placeholder="${esc(ph)}"` : ''} autocomplete="off" ${extra || ''}>`;
    const area = (k, v, ph, extra) => `<textarea class="ev-in ev-ta2" data-k="${k}" rows="2"${ph ? ` placeholder="${esc(ph)}"` : ''} ${extra || ''}>${esc(v)}</textarea>`;
    const dateIn = (k, v) => `<input type="text" class="ev-in akm-date" data-k="${k}" value="${esc(v)}" readonly autocomplete="off" placeholder="날짜 선택">`;

    function headHtml(ck) {
        const st = stateOf(), [lab, cls] = STATE_LABEL[st];
        const dots = [1, 2, 3, 4, 5, 6].map(k => `<span class="ev-dot${ck[k].ok ? ' on' : ''}" title="${k}. ${STEP_TITLE[k]}"></span>`).join('');
        return `<div class="ev-head">
            <div class="ev-head-main"><h2 class="ev-round">${esc(S.ev.title || '이름 없는 회차')}</h2>
                <span class="ev-pill ${cls}">${lab}${st === 'scheduled' ? ' ' + esc(mdw(S.ev.start)) + ' 00:00' : ''}</span>
                <span class="ev-ready" aria-label="준비 ${ck.n}/6">준비 <span class="ev-dots" aria-hidden="true">${dots}</span> <b>${ck.n}/6</b></span></div>
            <div class="ev-head-acts">
                <span class="ev-dirty" role="status">${S.saving ? '저장하는 중' : (S.dirty ? '저장 안 한 변경 있음' : '')}</span>
                ${btn(S.saving ? '저장 중' : '변경 저장', `data-ev="save"${S.dirty && !S.saving ? '' : ' disabled'}`, 'primary')}
                ${btn('지난 회차 복사', 'data-ev="copy"')}${btn('새 회차', 'data-ev="new"')}</div>
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
            ${field('회차 이름(관리용)', inp('title', e.title, '예: 2026 가을 고객 감사'))}
            ${field('손님 화면 제목', inp('display_title', e.display_title, e.title || '비우면 회차 이름'), '배너 그림 밖 큰 글자 · 그림 속엔 글자를 넣지 마세요')}
            ${field('응모 시작', dateIn('start', e.start))}${field('응모 끝', dateIn('end', e.end))}
            ${field('발표일', dateIn('announce', e.announce))}
            ${field('페이지 내리는 날', dateIn('page_until', e.page_until), e.announce ? `기본 = 발표일 + 3일(${mdw(addDays(e.announce, 3))}) · 이날까지 당첨 확인 가능` : '발표일을 고르면 3일 뒤로 채워져요')}
            ${field('응모 제외 품목(쉼표로)', inp('excludeProducts', (e.excludeProducts || []).join(', '), '예: 청귤'))}
            ${field('추첨 제외 연락처(쉼표로)', inp('excluded', S.excluded.join(', '), '직원·시험 주문 번호'))}
        </div>`;
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
                    ${inp(`prizes.${i}.note`, p.note, '손글씨 한마디(40자)', 'maxlength="40" aria-label="' + (i + 1) + '등 손글씨"')}
                    ${candBand('prize:' + i)}
                    <div class="ev-row">${btn('↑', `data-ev="pup" data-i="${i}" aria-label="${i + 1}등 위로"${i ? '' : ' disabled'}`, 'sm icon')}${btn('↓', `data-ev="pdown" data-i="${i}" aria-label="${i + 1}등 아래로"${i < ps.length - 1 ? '' : ' disabled'}`, 'sm icon')}${btn('빼기', `data-ev="pdel" data-i="${i}" aria-label="${i + 1}등 빼기"`, 'sm danger')}</div>
                </div></li>`;
        }).join('')}</ol>${ps.length ? '' : '<p class="ev-empty">아직 경품이 없어요.</p>'}${btn('+ 경품 추가', 'data-ev="padd"')}
        <p class="ev-note">경품 그림을 안 올리면 경품 이름에서 품목을 알아봐 실제 품목 사진을 써요(황금향·레몬·하우스귤·유라조생).</p>`;
    }
    function slotBox(slot) {
        const d = SLOTS[slot], e = S.ev;
        const id = e[d.field];
        return `<div class="ev-slot" data-slot="${slot}">
            <div class="ev-slot-h"><b>${d.label}</b><span class="ev-f-h">권장 ${d.w}×${d.h}${slot === 'result' ? ' · 선택' : ''}</span></div>
            <div class="ev-slot-img${slot === 'hero' ? ' wide' : ''}">${id ? `<img src="${esc(assetUrl(id))}" alt="${d.label}">` : '<span class="ev-noimg">기본 그림 사용</span>'}</div>
            <div class="ev-row">${btn('직접 올리기', `data-ev="upload" data-slot="${slot}"`, 'sm')}${btn('AI로 그림 맡기기', `data-ev="art" data-slot="${slot}"`, 'sm')}${id ? btn('기본 그림으로', `data-ev="unset" data-slot="${slot}"`, 'sm ghost') : ''}</div>
            ${candBand(slot)}</div>`;
    }
    function step3() {
        return `<p class="ev-note">그림 속에는 글자를 넣지 마세요(오타가 나도 고칠 수 없어요). 제목은 ①에서 글자로 넣어요.</p>
            ${slotBox('hero')}${slotBox('winner')}${slotBox('result')}`;
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
        const ag = autoGuide(), gl = g.custom ? g : Object.assign({}, g, ag);
        const botText = b.custom ? b.response : autoBot();
        const adWarn = [gl.title].concat(gl.lines || []).some(x => AD_WORDS.test(String(x || '')));
        return `<div class="ev-grid">${TEXT_LABEL.map(([k, l, max, multi]) => field(l, (multi ? area : inp)('texts.' + k, tx[k] || '', TEXT_DEFAULT[k], `maxlength="${max}"`))).join('')}
            ${field('쿠폰 문구(선택)', inp('coupon_text', e.coupon_text, '예: 응모 고객께 다음 주문 할인 쿠폰'), '봇 답(톡톡·상품문의)에만 나가요. 손님 페이지·/guide 카드엔 안 나가요')}</div>
            <div class="ev-sub"><div class="ev-sub-h"><b>봇 답 미리보기(#59)</b>${btn(b.custom ? '자동으로 되돌리기' : '다시 생성', 'data-ev="botauto"', 'sm ghost')}</div>
                <textarea class="ev-in ev-ta" data-k="bot_reply.response" rows="6" aria-label="봇 답 글">${esc(botText)}</textarea>
                <p class="ev-f-h">봇 답은 여기가 정본이에요. 문의 관리에서 고치면 다음 저장 때 덮여요.${b.custom ? ' · 손으로 고친 글(자동 갱신 안 함)' : ' · 칸을 고치면 손으로 고친 글로 남아요'}</p></div>
            <div class="ev-sub"><div class="ev-sub-h"><b>/guide 카드 미리보기</b>${btn(g.custom ? '자동으로 되돌리기' : '다시 생성', 'data-ev="guideauto"', 'sm ghost')}</div>
                <div class="ev-gcard"><input type="text" class="ev-in ev-gtitle" data-k="guide_card.title" value="${esc(gl.title)}" aria-label="카드 제목">
                    ${[0, 1, 2].map(i => `<input type="text" class="ev-in" data-k="guide_card.lines.${i}" value="${esc((gl.lines || [])[i] || '')}" maxlength="120" aria-label="카드 ${i + 1}째 줄">`).join('')}
                    <span class="ev-gbtn">${esc(gl.btn || ag.btn)}</span></div>
                ${adWarn ? '<p class="ev-warn" role="alert">카드 글에 할인·쿠폰·금액 글자가 있어요. 광고성으로 걸릴 수 있으니 빼 주세요(쿠폰은 봇 답에만).</p>' : ''}</div>`;
    }
    function step5(inline) {
        const views = [['default', '접수 전'], ['received', '접수 중'], ['win', '당첨'], ['lose', '미당첨'], ['winners', '발표 창']];
        return `<div class="ev-pv-bar"><div class="ev-seg" role="group" aria-label="미리보기 상태">${views.map(([v, l]) => `<button type="button" class="ev-seg-b${S.view === v ? ' on' : ''}" data-ev="view" data-v="${v}" aria-pressed="${S.view === v}">${l}</button>`).join('')}</div>
            <div class="ev-row">${btn(S.frame === 'phone' ? '넓게 보기' : '폰으로 보기', 'data-ev="frame"', 'sm ghost')}${btn('미리보기 링크 복사', 'data-ev="pvlink"', 'sm')}</div></div>
            ${inline ? frameHtml() : '<p class="ev-note">미리보기는 오른쪽에 떠 있어요. 칸을 고치면 바로 바뀌어요(저장 전 초안).</p>'}
            <p class="ev-f-h">링크는 1시간 동안 열려요 · 다른 직원·대표 폰으로 보낼 때.</p>`;
    }
    const frameHtml = () => `<div class="ev-frame-wrap ${S.frame}"><iframe id="ev-frame" title="손님 화면 미리보기" src="/lucky.html?preview=1" loading="lazy"></iframe></div>`;
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
            <div class="ev-sub ev-danger-zone"><div class="ev-row">${open || st === 'scheduled' ? btn('페이지 내리기', 'data-ev="down"', 'danger') : ''}${btn('전체 초기화', 'data-ev="reset"', 'danger ghost')}</div></div>`;
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
            root.dataset.mode = mode;
            root.innerHTML = `<div class="ev-headbox"></div><div class="ev-layout${wide ? ' two' : ''}"><div class="ev-cards"></div>
                ${wide ? `<aside class="ev-side" aria-label="손님 화면 미리보기"><div class="ev-side-h"><b>손님 화면 미리보기</b><span class="ev-f-h">저장 전 초안</span></div>${frameHtml()}</aside>` : ''}</div>`;
            if (wide) hookFrame();
        } else if (wide) { const fw = root.querySelector('.ev-side .ev-frame-wrap'); if (fw) fw.className = 'ev-frame-wrap ' + S.frame; }
        root.querySelector('.ev-headbox').innerHTML = headHtml(ck);
        root.querySelector('.ev-cards').innerHTML = `${cardHtml(1, ck, step1)}${cardHtml(2, ck, step2)}${cardHtml(3, ck, step3)}${cardHtml(4, ck, step4)}${cardHtml(5, ck, () => step5(!wide))}${cardHtml(6, ck, () => step6(ck))}`;
        if (focusKey) { const el = root.querySelector(`[data-k="${CSS.escape(focusKey)}"]`); if (el) { el.focus(); try { if (selS != null) el.setSelectionRange(selS, selS); } catch (e) { } } }
        if (!wide) hookFrame();
        loadCandImgs();
    }
    // 머리·카드 상태만 다시(입력 중 칸을 다시 그리지 않음)
    function refreshStatus() {
        const root = $('event-root'); if (!root || !S.ev || !S.id) return;
        const ck = check(), hb = root.querySelector('.ev-headbox');
        if (hb) hb.innerHTML = headHtml(ck);
        [1, 2, 3, 4, 5, 6].forEach(k => { const sec = root.querySelector(`.ev-card[data-step="${k}"]`); if (!sec) return; sec.classList.toggle('done', ck[k].ok); const st = sec.querySelector('.ev-card-h .ev-st'); if (st) { st.className = 'ev-st ' + (ck[k].ok ? 'ok' : 'no'); st.textContent = ck[k].ok ? '완료' : '미완'; st.setAttribute('aria-label', ck[k].ok ? '완료' : '미완'); } const sm = sec.querySelector('.ev-card-sum'); if (sm) sm.textContent = ck[k].sum; });
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
        if (ev.data.type === 'lucky:ready') postPreview();
        if (ev.data.type === 'lucky:rendered' && !seen()) { markSeen(); refreshStatus(); }
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
        const el = ev.target; if (!el.dataset || !el.dataset.k) return;
        if (el.dataset.k === 'announce') S._annWas = S.ev.announce;
        setK(el.dataset.k, el.value);
        S.dirty = true;
        if (el.dataset.k === 'announce') { const pu = document.querySelector('#event-root [data-k="page_until"]'); if (pu) pu.value = S.ev.page_until || ''; }
        refreshStatus(); postPreview();
    }

    // ── 저장 · 서버 단추 ──────────────────────────────────
    function payload() {
        const e = clone(S.ev);
        if (!e.guide_card.custom) Object.assign(e.guide_card, autoGuide());
        if (!e.bot_reply.custom) e.bot_reply.response = autoBot();
        e.prizes = (e.prizes || []).filter(p => String(p.name || '').trim()).map(p => { const b = p.image_id ? null : brandFor(p.name); return Object.assign({}, p, { name: String(p.name).trim(), count: Math.max(0, Number(p.count) || 0), image_id: p.image_id || (b && b.id) || null }); });   // 그림을 안 고른 경품 = 품목 실사진(설계 0-ㄷ)
        delete e.state; delete e.live_mode; delete e.checklist;
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
            const maxW = d.w, maxH = slot === 'hero' ? 1200 : Math.max(d.h, d.w);
            const sc = Math.min(1, maxW / im.naturalWidth, maxH / im.naturalHeight);
            const w = Math.max(1, Math.round(im.naturalWidth * sc)), h = Math.max(1, Math.round(im.naturalHeight * sc));
            const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
            cv.getContext('2d').drawImage(im, 0, 0, w, h);
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
        S.dirty = true;
        toast(`${SLOTS[slot].label} 올렸어요 · 저장하면 반영돼요`, 'lime', 2800);
        render(); postPreview();
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
            case 'fold': { const k = +b.dataset.step; S.open.has(k) ? S.open.delete(k) : S.open.add(k); if (k === 5 && S.open.has(5)) { markSeen(); } render(); if (S.open.has(k)) { const sec = $('ev-step-' + k); if (sec && sec.getBoundingClientRect().top < 0) sec.scrollIntoView({ block: 'start' }); } return; }
            case 'save': return save();
            case 'padd': E.prizes.push({ name: '', count: 1, desc: '', note: '' }); S.dirty = true; render(); { const el = document.querySelector(`#event-root [data-k="prizes.${E.prizes.length - 1}.name"]`); if (el) el.focus(); } postPreview(); return;
            case 'pdel': E.prizes.splice(i, 1); S.dirty = true; render(); postPreview(); return;
            case 'pup': case 'pdown': { const j = a === 'pup' ? i - 1 : i + 1; if (j < 0 || j >= E.prizes.length) return; [E.prizes[i], E.prizes[j]] = [E.prizes[j], E.prizes[i]]; S.dirty = true; render(); postPreview(); return; }
            case 'upload': return pickFile(b.dataset.slot, i);
            case 'art': return artSheet(b.dataset.slot, i);
            case 'unset': { const s = b.dataset.slot; E[SLOTS[s].field] = null; S.dirty = true; render(); postPreview(); return; }
            case 'candx': E.pending_art = E.pending_art.filter(p => String(p.order_id) !== b.dataset.order); S.dirty = true; render(); return;
            case 'usecand': {
                const key = b.dataset.slot, slot = key.startsWith('prize:') ? 'prize' : key, idx = slot === 'prize' ? +key.split(':')[1] : undefined;
                try { const bl = await fileBlob(b.dataset.fid); await uploadBlob(bl, slot, idx); } catch (err) { toast(err.message, 'error'); }
                return;
            }
            case 'botauto': E.bot_reply.custom = false; E.bot_reply.response = ''; S.dirty = true; render(); return;
            case 'guideauto': E.guide_card.custom = false; Object.assign(E.guide_card, autoGuide()); S.dirty = true; render(); return;
            case 'view': S.view = b.dataset.v; markSeen(); render(); postPreview(); return;
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
                if (!await confirmBox('전체 초기화할까요?', '이 회차의 주문·당첨자·설정이 처음 상태로 돌아가요. 되돌릴 수 없어요.', '초기화', true)) return;
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
        render(); pollCand();
    }
    function mount() {
        if (S.mounted) return; const root = $('event-root'); if (!root) return; S.mounted = true;
        root.addEventListener('click', onClick);
        root.addEventListener('input', onInput);
        root.addEventListener('change', onChange);
        root.addEventListener('keydown', e => { if (e.target.id === 'ev-drop' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); $('ev-xlsx').click(); } });
        root.addEventListener('click', e => { if (e.target.closest('#ev-drop') && e.target.id !== 'ev-xlsx') $('ev-xlsx').click(); });
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
        open: async step => { await enter(false); const k = Math.min(6, Math.max(1, +step || 1)); S.open.add(k); render(); const sec = $('ev-step-' + k); if (sec) sec.scrollIntoView({ block: 'start' }); pollCand(); },
        _state: S,
    };
})();
