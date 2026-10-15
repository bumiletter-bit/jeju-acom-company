/* 제주아꼼이네 고객 감사 이벤트 (접수 확인 · 추첨 · 당첨 조회) — 회사 프로그램 이식판
 *
 * 원본: bumiletter-bit/bum-toolbox lucky.js (origin/main 6709f84 · event.akkome.com)
 *   - 추첨·조회·마스킹 로직은 원본과 동일(문자 단위로 옮김). 바뀐 것은 저장소와 로그인뿐:
 *     ① 저장 = 파일(data/lucky.json — 배포마다 소실) → 회사 DB lucky_events(JSONB 1행 = 1회차)
 *     ② 관리자 = 관리자 코드(x-admin-code) → 회사 로그인(JWT) · 직원 가능 · 복원 = 관리자만
 *     ③ 모든 쓰기 = audit_logs 기록(개인정보 없이 건수만)
 *   - 공개 API 경로는 원본과 동일(/api/lucky/event · /lookup · /winners) — 손님 페이지(public/lucky.html) 무변경 이식 가능.
 *   - 관리 API = /api/agent-office/lucky/* (원본 /api/lucky/admin/* 와 같은 동작 · 같은 응답 {ok, db, ...}).
 *
 * #708(대표 10/15 「지금 구도대로 고」 · 설계 docs/708-event-design.md · 약속 docs/708-api.md) — 직원이 터미널 없이 이벤트를 처음부터 끝까지 여는 서버 몫:
 *   · event 칸 추가(display_title · page_until · live_mode · prizes[].desc/note/image_id · hero/winner/result 그림 · texts · coupon_text · guide_card · bot_reply · pending_art) — JSONB 라 ALTER 없음 · 옛 꼴은 merge 가 기본값으로 채움
 *   · 그림 표(lucky_assets · bytea webp) + 공개 GET /api/lucky/asset/:id (immutable 캐시) — 배포 없이 그림을 바꾼다
 *   · state = preparing | live | published | down (서버 한 곳 · 손님 페이지·카드·봇·화면이 전부 이 값) · 옛 회차(live_mode 없음)·0행 = live(종전 화면 그대로)
 *   · 미리보기 키(1시간 HMAC) · 회차 복사 · 열기/예약/내리기 · 틱(1시간 · 예약 열기 · 내리는 날 지나면 내림)
 *   · 동기화 = 이벤트 설정 1곳 → agent_office_config 'guide_event_card'(server.js guideEventCardHtml 은 무접촉 · 값만 써 넣음) + inquiry_scenarios #59 upsert(손으로 고친 custom 은 안 덮음)
 *   · 권한 = 추첨·발표·새 회차·초기화도 직원(대표 10/15) · 복원만 관리자 그대로
 * #711(대표 10/15 라이브 지적 7가지 · 계약 docs/711-event-design.md) — 더한 것 둘 · 종전 응답·대조·저장 꼴 무변경:
 *   · GET  …/lucky/products  = 판매현황(bot_products · 삭제 안 된 전 상태)을 #709 낱말 묶음(ITEM_GROUPS)으로 묶어 돌려줌 → 화면 「응모 제외 품목」 칩 고르기(저장값은 종전 excludeProducts 글자 배열 그대로 · exProdOf 무변경)
 *   · POST …/lucky/bot-preview = 초안을 얹어 봇 답(autoBot)·/guide 카드(autoCard + 광고성 줄 dropped)를 만들어 돌려줌(저장 0 · 동기화 0) → 화면이 치는 대로 보여 줌(화면 사본 제거)
 *
 * 마운트(server.js 1줄): require('./lucky-event.js')(app, { pool, authMiddleware, adminOnly, writeAudit });
 * 🔴 initDB·타이머·설정 행을 만들지 않는다(#467 시드 사고 교훈) — 테이블은 첫 요청 때 CREATE IF NOT EXISTS. 검증은 table 인자로 가짜 표 이름(그림 표 = <table>_assets) · sync 인자로 가짜 받이(실DB agent_office_config·inquiry_scenarios 쓰기 0).
 */
'use strict';
const crypto = require('crypto');

module.exports = function mountLuckyEvent(app, { pool, authMiddleware, adminOnly, writeAudit, table, sync, now, secret, tick, products }) {
  if (!table && process.env.LUCKY_TABLE && !process.env.RENDER) table = process.env.LUCKY_TABLE;   // 로컬 실서버 통합 확인용(env · 라이브 Render 에선 무시) — 가짜 표 + 동기화·틱 기본 꺼짐이 같이 걸린다
  if (table && !/^[a-z][a-z0-9_]*$/.test(table)) throw new Error('lucky-event: 표 이름이 틀려요 — ' + table);
  if (table === 'lucky_events' || table === 'lucky_assets') throw new Error('lucky-event: 검증 표 이름이 운영 표와 같아요 — ' + table);   // 🔴 검증이 준 표 이름이 틀리면 운영 표로 떨어지지 않게 멈춘다(10/15 실사고: 숫자 든 이름이 가드를 못 넘어 운영 lucky_events 에 시험 줄 2행)
  const T = table || 'lucky_events';                                   // 검증 스크립트만 다른 테이블 사용
  const AT = table ? T + '_assets' : 'lucky_assets';                   // #708 그림 표(검증은 가짜 표 뒤에 _assets)
  const nowMs = typeof now === 'function' ? now : () => Date.now();
  const SECRET = secret || process.env.JWT_SECRET || '';
  const PUBLIC_URL = process.env.EVENT_PUBLIC_URL || 'https://event.akkome.com/lucky.html';
  const STORE_URL = process.env.EVENT_STORE_URL || 'https://brand.naver.com/jejuakkome';   // 브랜드스토어 주소(저장소 안 79곳이 이 주소 · 공개 지표 수집기도 brand.naver.com) · lucky.html 의 폴백과 같은 글자
  const ASSET_KEEP_DAYS = Math.max(30, Number(process.env.EVENT_ASSET_DAYS) || 730);   // 내려간 회차의 그림 바이트 보관(기본 2년 · 대표 10/15 기본값)
  const ASSET_MAX = 1.5 * 1024 * 1024, ASSET_MIMES = ['image/webp', 'image/png', 'image/jpeg'], ASSET_SLOTS = ['hero', 'winner', 'result', 'prize', 'brand'];
  const INT_MAX = 2147483647;

  /* ── 기본값 (원본 DEFAULT와 동일한 모양 + #708 칸) ── */
  // 손님 페이지(lucky.html)에 박혀 있던 글자 그대로 — 설정이 비면 이 값이라 화면이 종전과 같다
  const TEXT_DEFAULTS = {
    prize_head_hand: '제주의 좋은 마음을 선물합니다! ♡',
    corner_hand: '늘 함께해 주셔서\n감사합니다! ♡',
    search_hand: '성함·번호로 확인해보세요! ♡',
    winner_hand: '함께해 주신 모든 분께 감사드립니다! ♡',
    winner_foot: '당첨되신 분께는 순차적으로 연락드리며, 경품은 주문 시 배송지로 보내드립니다 🍊',
    noitem_products: '감귤·황금향 등',
    preparing_title: '이벤트 준비 중이에요 🍊',
    preparing_line: '곧 열립니다. 조금만 기다려 주세요!',
    closed_title: '이벤트가 끝났어요 🙏',
    closed_line: '함께해 주셔서 감사합니다. 당첨되신 분께는 순차적으로 연락드려요.'
  };
  const TEXT_KEYS = Object.keys(TEXT_DEFAULTS);
  const BOT_KEYWORDS = ['이벤트', '추첨', '응모', '경품', '당첨자', '이벤트 당첨', '이벤트당첨', '당첨 확인', '당첨확인', '럭키', '할인쿠폰', '할인 쿠폰', '이벤트 안내', '이벤트안내'];
  // #711 낱말 묶음 — 앞 10개는 화면(event-admin.js ITEM_GROUPS · #709)과 같은 순서(먼저 맞는 묶음이 이긴다: 노지황금향·하우스황금향 → 황금향) · 그 뒤는 품목 사진 26장 라벨 품목
  //   🔴 맨 「귤」·「감귤」은 묶음 아님(#709 규칙) · 첫 낱말 = 묶음 대표 이름(칩에 저장되는 글자 · 주문 글 부분 일치 대조 exProdOf 그대로)
  const ITEM_GROUPS = [['청귤', '풋귤'], ['황금향'], ['한라봉'], ['천혜향'], ['레드향'], ['레드키위', '키위'], ['노란레몬'], ['그린레몬', '레몬'], ['노지감귤', '노지', '유라조생', '유라'], ['하우스감귤', '하우스귤', '하우스'],
    ['미니밤호박', '밤호박', '한입밤호박'], ['타이벡감귤', '타이벡'], ['카라향'], ['탐라향'], ['하귤'], ['산하홍'], ['수라향'], ['블러드오렌지'], ['세미놀'], ['자몽'], ['청견오렌지'], ['초당옥수수', '옥수수'], ['브로콜리'], ['고깔양배추', '양배추']];
  const groupOf = s => { const n = String(s || '').replace(/\s+/g, ''); return ITEM_GROUPS.findIndex(g => g.some(k => n.includes(k))); };
  // 어느 묶음에도 안 드는 판매현황 이름 → 품목 머리(머리말 「…:」 · 「 / 」 뒤 · 무게·개입 이하 · ★행사 글자 떼기)로 묶음 하나
  const itemHead = s => String(s || '').split(' / ')[0].replace(/^[^:]*:\s*/, '').replace(/[★☆\[\]【】]/g, ' ').replace(/\s*\d+(\.\d+)?\s*(kg|개입|과|구).*$/i, '').replace(/^(최상품|제철|제주산|제주|고당도|과즙팡팡)\s*/, '').replace(/\(.*?\)/g, '').trim();
  const TEST_PRODUCT_RE = /^\s*(\[검증\]|테스트|시험)/;
  // 판매현황 행 → {groups:[{name, words, selling, options:[{name,status}]}]} (판매중 있는 묶음 먼저 · 가나다)
  function groupProducts(rows) {
    const map = new Map();
    (rows || []).forEach(r => {
      const name = String(r.name || '').trim(); if (!name || TEST_PRODUCT_RE.test(name)) return;
      const gi = groupOf(name); const key = gi >= 0 ? 'g' + gi : 'h' + (itemHead(name) || name).replace(/\s+/g, '');
      if (!map.has(key)) map.set(key, { name: gi >= 0 ? ITEM_GROUPS[gi][0] : (itemHead(name) || name), words: gi >= 0 ? ITEM_GROUPS[gi].slice() : [itemHead(name) || name], selling: false, options: [] });
      const g = map.get(key); const status = String(r.status || '').trim();
      if (status === '판매중') g.selling = true;
      if (!g.options.some(o => o.name === name)) g.options.push({ name, status });
    });
    const ko = (a, b) => a.localeCompare(b, 'ko');
    const groups = [...map.values()];
    groups.forEach(g => g.options.sort((a, b) => ko(a.name, b.name)));
    groups.sort((a, b) => (a.selling === b.selling ? ko(a.name, b.name) : a.selling ? -1 : 1));
    return groups;
  }
  const defaultProducts = async () => (await pool.query(`SELECT name, status FROM bot_products WHERE deleted_at IS NULL ORDER BY id`)).rows;
  const P = typeof products === 'function' ? products : defaultProducts;   // 검증은 가짜 행(운영 bot_products 무접촉)
  let productsCache = null;   // {at, groups} · 30초
  async function productGroups() {
    const t = nowMs();
    if (productsCache && t - productsCache.at < 30e3) return productsCache.groups;
    const groups = groupProducts(await P());
    productsCache = { at: t, groups };
    return groups;
  }
  const DEFAULT = () => ({
    event: {
      title: '제주아꼼이네 고객 감사 이벤트',
      start: '2026-09-10', end: '2026-09-21', announce: '2026-09-21',
      prizes: [
        { name: '황금향 5kg 선물용', count: 5 },
        { name: '황금향 3kg 선물용', count: 7 },
        { name: '감귤 3kg 선물용', count: 10 }
      ],
      published: false, drawnAt: null,
      excludeProducts: ['청귤'],
      // #708 — 옛 회차(칸 없음)·0행은 live_mode 'legacy' 로 읽혀 날짜와 무관하게 종전 화면 그대로(기본값 날짜가 9월이라 'live' 로 두면 내리는 날 규칙에 걸려 down 이 됨). new-round·copy-round·reset 만 'draft' 로 시작
      display_title: '', page_until: '', live_mode: 'legacy', live_at: null,
      hero_image_id: null, winner_image_id: null, result_image_id: null,
      texts: {}, coupon_text: '',
      guide_card: { enabled: true, title: '', lines: [], btn: '', custom: false },
      bot_reply: { enabled: true, keywords: [], response: '', custom: false },
      pending_art: []
    },
    orders: [], winners: [], excluded: [], uploads: [], updatedAt: null
  });
  const merge = d => {
    const out = Object.assign(DEFAULT(), d || {});
    const de = DEFAULT().event, se = (d && d.event) || {};
    out.event = Object.assign(de, se);
    out.event.texts = Object.assign({}, se.texts && typeof se.texts === 'object' ? se.texts : {});
    out.event.guide_card = Object.assign(de.guide_card, se.guide_card && typeof se.guide_card === 'object' ? se.guide_card : {});
    out.event.bot_reply = Object.assign(de.bot_reply, se.bot_reply && typeof se.bot_reply === 'object' ? se.bot_reply : {});
    out.event.prizes = (Array.isArray(out.event.prizes) ? out.event.prizes : []).map(p => Object.assign({ name: '', count: 0 }, p || {}));
    out.event.pending_art = Array.isArray(se.pending_art) ? se.pending_art : [];
    return out;
  };

  /* ── 저장소: lucky_events (1행 = 1회차, is_current 1개) + lucky_assets(그림) ── */
  let tableReady = null;
  function ensureTable() {
    if (!tableReady) {
      tableReady = (async () => {
        await pool.query(`CREATE TABLE IF NOT EXISTS ${T} (
          id SERIAL PRIMARY KEY,
          title TEXT,
          data JSONB NOT NULL,
          is_current BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          archived_at TIMESTAMP
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS ${AT} (
          id SERIAL PRIMARY KEY,
          round_id INTEGER,
          slot TEXT NOT NULL,
          label TEXT,
          mime TEXT NOT NULL,
          bytes BYTEA,
          size INTEGER NOT NULL DEFAULT 0,
          width INTEGER, height INTEGER,
          sha1 TEXT,
          source TEXT,
          created_by INTEGER,
          created_at TIMESTAMP DEFAULT NOW(),
          purged_at TIMESTAMP
        )`);
      })().catch(e => { tableReady = null; throw e; });
    }
    return tableReady;
  }
  let cache = null, cacheId = null, cacheAt = 0;
  const CACHE_MS = 15000;   // 공개 조회용 — 쓰기는 항상 DB에서 새로 읽음
  async function loadCurrent(fresh) {
    await ensureTable();
    if (!fresh && cache && nowMs() - cacheAt < CACHE_MS) return cache;
    const r = await pool.query(`SELECT id, data FROM ${T} WHERE is_current = TRUE ORDER BY id DESC LIMIT 1`);
    if (r.rows.length) { cache = merge(r.rows[0].data); cacheId = r.rows[0].id; }
    else { cache = DEFAULT(); cacheId = null; }
    cacheAt = nowMs();
    return cache;
  }
  async function save(db) {
    // #708 손질 ①: 0행(지금 운영)에서 첫 저장이 생기면 그 회차는 「초안」으로 시작한다 — legacy 로 두면 저장 즉시 손님 노출 + 카드·#59 켜짐 + 영영 안 내려감. 공개 GET 의 0행 = legacy 그대로(무회귀)
    if (!cacheId && (!db.event.live_mode || db.event.live_mode === 'legacy')) {
      db.event.live_mode = 'draft';
      const d0 = DEFAULT().event;   // 옛 기본 날짜(9월)가 그대로면 비운다 — 안 비우면 초안이 「내리는 날 지남 = down」으로 계산돼 직원 눈에 「내려감」으로 뜬다 · 직원이 같은 요청으로 날짜를 넣었으면(기본값과 다름) 그대로
      if (db.event.start === d0.start && db.event.end === d0.end && db.event.announce === d0.announce) { db.event.start = db.event.end = db.event.announce = ''; db.event.page_until = ''; }
    }
    db.updatedAt = new Date(nowMs()).toISOString();
    const json = JSON.stringify(db);
    if (cacheId) await pool.query(`UPDATE ${T} SET data=$2::jsonb, title=$3, updated_at=NOW() WHERE id=$1`, [cacheId, json, db.event.title]);
    else { const r = await pool.query(`INSERT INTO ${T} (title, data, is_current) VALUES ($1, $2::jsonb, TRUE) RETURNING id`, [db.event.title, json]); cacheId = r.rows[0].id; }
    cache = db; cacheAt = nowMs();
  }
  // 쓰기 직렬화 — 동시 업로드·추첨이 서로 덮지 않게
  let lock = Promise.resolve();
  function withLock(fn) { const p = lock.then(fn, fn); lock = p.catch(() => {}); return p; }

  /* ── 원본 헬퍼 (그대로) ── */
  const digits = s => String(s || '').replace(/\D/g, '');
  const norm = s => String(s || '').replace(/\s+/g, '').replace(/\(.*?\)/g, '').trim();
  const nameKey = s => norm(s).replace(/[!！.,~♡♥♥️^*]/g, '').replace(/(드림|올림|배상|보냄|님|씨|대표님|대표|사장님|팀장님|과장님|부장님)+$/, '');
  const maskName = n => { n = String(n || ''); if (n.length <= 1) return n; if (n.length === 2) return n[0] + '*'; return n[0] + '*'.repeat(n.length - 2) + n[n.length - 1]; };
  const maskPhone = p => { const d = digits(p); if (d.length < 7) return d ? '***' : ''; return d.slice(0, 3) + '-****-' + d.slice(-4); };
  const maskAddr = a => { a = String(a || '').trim(); const parts = a.split(/\s+/); return parts.slice(0, 3).join(' ') + (parts.length > 3 ? ' …' : ''); };
  const custKey = o => digits(o.buyerPhone) || digits(o.recvPhone) || norm(o.buyer) || norm(o.recv);
  const inRangeOf = db => o => { const d = String(o.date || '').slice(0, 10); return d >= db.event.start && d <= db.event.end; };
  const exProdOf = db => o => (db.event.excludeProducts || []).some(k => k && String(o.product || '').includes(k));
  const eligibleOf = db => { const ir = inRangeOf(db), ex = exProdOf(db); return o => ir(o) && !ex(o); };
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
  const orderId = o => o.tracking && digits(o.tracking).length >= 8 ? 'T' + digits(o.tracking) : 'H' + hash([o.vendor, o.date, norm(o.recv), digits(o.recvPhone), o.product, o.qty, o.addr].join('|'));
  const dispName = n => { let s = String(n || '').replace(/[!！.]+$/g, '').replace(/\s*드림\s*$/, '').replace(/[!！.]+$/g, '').trim(); const parts = s.split(/\s+/).filter(Boolean); if (parts.length > 1) { const last = parts[parts.length - 1]; if (last.length >= 2) s = last; } return maskName(s); };

  /* ── #708 날짜·상태·체크리스트 ── */
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const kstToday = ms => new Date((ms == null ? nowMs() : ms) + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const addDays = (d, n) => { if (!isDate(d)) return ''; const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const fmtK = d => isDate(d) ? `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일` : '';
  const pageUntilOf = e => isDate(e.page_until) ? e.page_until : addDays(e.announce, 3);
  // 상태 — docs/708-api.md 1절. 날짜 칸이 비어 있으면 그 검사는 건너뛴다(새 회차 직후 down 으로 떨어지지 않게)
  function stateOf(db, ms) {
    const e = db.event, today = kstToday(ms), until = pageUntilOf(e), mode = e.live_mode || 'legacy';
    if (mode === 'legacy') return e.published ? 'published' : 'live';   // 옛 회차·0행 = 종전 화면(날짜 규칙 없음)
    if (mode === 'down') return 'down';
    if (until && today > until) return 'down';
    const live = mode === 'live' || (mode === 'scheduled' && isDate(e.start) && today >= e.start);
    if (!live) return 'preparing';
    return e.published ? 'published' : 'live';
  }
  const isOpen = st => st === 'live' || st === 'published';
  function checklistOf(db, assets) {
    const e = db.event, missing = [];
    const dt = isDate(e.start) && isDate(e.end) && isDate(e.announce) && isDate(pageUntilOf(e));
    if (!(e.display_title || e.title)) missing.push('손님 제목');
    if (!isDate(e.start)) missing.push('응모 시작일'); if (!isDate(e.end)) missing.push('응모 종료일'); if (!isDate(e.announce)) missing.push('발표일');
    if (dt && !(e.start <= e.end && e.end <= e.announce && e.announce <= pageUntilOf(e))) missing.push('날짜 순서(시작 ≤ 끝 ≤ 발표 ≤ 내리는 날)');
    const basics = !!(e.display_title || e.title) && dt && e.start <= e.end && e.end <= e.announce && e.announce <= pageUntilOf(e);
    let prizes = Array.isArray(e.prizes) && e.prizes.length > 0;
    if (!prizes) missing.push('경품 1개 이상');
    (e.prizes || []).forEach((p, i) => { if (!String(p.name || '').trim()) { prizes = false; missing.push(`경품 ${i + 1} 이름`); } if (!(Number(p.count) > 0)) { prizes = false; missing.push(`경품 ${i + 1} 인원`); } });
    // 그림 = 기본 그림이면 미완 아님 · 가리킨 그림이 없거나 비워졌을 때만 미완
    let images = true;
    const chk = (id, what) => { if (id != null && !(assets && assets.has(Number(id)))) { images = false; missing.push(what + ' 그림(지워짐)'); } };
    chk(e.hero_image_id, '배너'); chk(e.winner_image_id, '발표 창'); chk(e.result_image_id, '결과');
    (e.prizes || []).forEach((p, i) => chk(p.image_id, `경품 ${i + 1}`));
    const st = stateOf(db);
    return { ready: basics && prizes && images, steps: { basics, prizes, images, texts: true, preview: null, open: isOpen(st) }, missing };
  }

  /* ── #708 그림 ── */
  // 현재 회차가 가리키는 그림 메타(id → {sha1, mime}) · 공개 응답에 주소를 붙일 때 · 비워진(purged) 그림은 없음으로
  async function assetMetaFor(db) {
    const ids = new Set();
    const e = db.event; [e.hero_image_id, e.winner_image_id, e.result_image_id].forEach(x => { if (Number.isInteger(Number(x)) && Number(x) > 0) ids.add(Number(x)); });
    (e.prizes || []).forEach(p => { if (Number.isInteger(Number(p.image_id)) && Number(p.image_id) > 0) ids.add(Number(p.image_id)); });
    const m = new Map();
    if (!ids.size) return m;
    const r = await pool.query(`SELECT id, sha1, mime FROM ${AT} WHERE id = ANY($1::int[]) AND purged_at IS NULL`, [[...ids]]);
    r.rows.forEach(x => m.set(Number(x.id), { sha1: x.sha1 || '', mime: x.mime }));
    return m;
  }
  const assetUrl = (assets, id) => { const n = Number(id); const a = n > 0 && assets ? assets.get(n) : null; return a ? `/api/lucky/asset/${n}?v=${String(a.sha1 || '').slice(0, 8)}` : null; };
  const refIds = db => { const e = db.event; return [e.hero_image_id, e.winner_image_id, e.result_image_id].concat((e.prizes || []).map(p => p.image_id)).map(Number).filter(n => n > 0); };

  // 공개 응답(종전 7칸 그대로 + #708 칸) · full=false(준비 중·내려감 · 미리보기 키 없음) 면 경품·그림을 비운다
  function publicEvent(db, assets, st, full) {
    const e = db.event, texts = Object.assign({}, TEXT_DEFAULTS);
    TEXT_KEYS.forEach(k => { const v = e.texts && e.texts[k]; if (typeof v === 'string' && v.trim()) texts[k] = v; });
    const out = {
      title: e.title, start: e.start, end: e.end, announce: e.announce,
      prizes: full ? (e.prizes || []).map(p => ({ name: p.name, count: p.count, desc: String(p.desc || ''), note: String(p.note || ''), image: assetUrl(assets, p.image_id) })) : [],
      published: e.published, excludeProducts: e.excludeProducts || [],
      display_title: (e.display_title && String(e.display_title).trim()) || e.title, page_until: pageUntilOf(e),
      state: st, live_mode: (e.live_mode && e.live_mode !== 'legacy') ? e.live_mode : 'live',
      images: full ? { hero: assetUrl(assets, e.hero_image_id), winner: assetUrl(assets, e.winner_image_id), result: assetUrl(assets, e.result_image_id) } : { hero: null, winner: null, result: null },
      texts, store_url: STORE_URL
    };
    return out;
  }

  /* ── #708 미리보기 키(1시간 · HMAC) ── */
  const pkSig = (exp, rid) => crypto.createHmac('sha256', SECRET).update(`lucky-pk|${exp}|${rid}`).digest('hex').slice(0, 24);
  const makePk = rid => { const exp = nowMs() + 3600e3; return `${exp}.${rid || 0}.${pkSig(exp, rid || 0)}`; };
  function pkValid(pk, rid) {
    if (!SECRET || !pk) return false;
    const m = String(pk).match(/^(\d{10,16})\.(\d+)\.([0-9a-f]{24})$/); if (!m) return false;
    const exp = Number(m[1]); if (!(exp > nowMs())) return false;
    if (Number(m[2]) !== Number(rid || 0)) return false;
    const want = pkSig(exp, Number(m[2]));
    return want.length === m[3].length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[3]));
  }

  /* ── #708 동기화: 이벤트 설정 → /guide 카드 설정 + 봇 시나리오 #59 (server.js 무접촉 · 값만 써 넣음) ── */
  const BAN_RE = /할인|쿠폰|\d\s*%|\d\s*원/;   // 알림톡 랜딩 카드엔 할인·쿠폰·금액 글자를 넣지 않는다(메모리 jeju-alimtalk-event-exposure)
  const defaultSync = {
    cfgSet: async (key, value) => { await pool.query(`INSERT INTO agent_office_config (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, JSON.stringify(value)]); },
    scenarioUpsert: async s => {
      const ex = await pool.query(`SELECT id FROM inquiry_scenarios WHERE scenario_no = $1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`, [s.scenario_no]);
      if (ex.rows.length) { await pool.query(`UPDATE inquiry_scenarios SET name = $2, keywords = $3::jsonb, response = $4, enabled = $5, channel = $6, updated_by = $7, updated_at = NOW() WHERE id = $1`, [ex.rows[0].id, s.name, JSON.stringify(s.keywords), s.response, s.enabled, s.channel, s.updated_by]); return ex.rows[0].id; }
      const r = await pool.query(`INSERT INTO inquiry_scenarios (scenario_no, name, keywords, response, action, enabled, channel, updated_by) VALUES ($1, $2, $3::jsonb, $4, '자동응답', $5, $6, $7) RETURNING id`, [s.scenario_no, s.name, JSON.stringify(s.keywords), s.response, s.enabled, s.channel, s.updated_by]);
      return r.rows[0].id;
    }
  };
  // 🔴 검증 모드(table 인자)에선 동기화 기본 꺼짐 — 받이(sync)를 명시로 준 것만 쓴다(10/15 2차 실사고: 종전 검증이 새 코드를 만나 운영 guide_event_card·#59 를 덮음)
  const noSync = { cfgSet: async () => false, scenarioUpsert: async () => false };   // false = 「안 썼음」 → 응답 synced 도 false(문서 8절)
  const S = Object.assign({}, table ? noSync : defaultSync, sync || {});
  const prizeLine = e => (e.prizes || []).map((p, i) => `${i + 1}등 ${p.name}(${p.count}명)`).join(' · ');
  const totalCnt = e => (e.prizes || []).reduce((a, p) => a + (Number(p.count) || 0), 0);
  function autoCard(db) {
    const e = db.event;
    return {
      title: `🎁 ${(e.display_title || e.title || '').trim()}`,
      lines: [
        `${fmtK(e.start)} ~ ${fmtK(e.end)} 주문 고객 대상, 기간 내 주문 건은 자동 응모됐어요.`,
        `총 ${totalCnt(e)}명 추첨: ${prizeLine(e)}`,
        `당첨자 발표 ${fmtK(e.announce)}. 주문하신 분 성함 또는 휴대폰 번호로 접수·당첨을 확인하실 수 있어요.`
      ],
      btn: '접수·당첨 확인 바로가기'
    };
  }
  function autoBot(db) {
    const e = db.event, name = (e.display_title || e.title || '이벤트').trim();
    const lines = [
      '안녕하세요 고객님 제주아꼼이네입니다 🍊',
      '이벤트 문의 주셔서 감사합니다 😊',
      '',
      `🎁 ${name} (${fmtK(e.start)} ~ ${fmtK(e.end)} 주문 고객 대상)`,
      '✅ 기간 내 주문 건은 자동 응모돼요. 따로 신청하실 필요 없어요!',
      `🏆 총 ${totalCnt(e)}명 추첨: ${prizeLine(e)}`
    ];
    if (String(e.coupon_text || '').trim()) lines.push(`🎟 ${String(e.coupon_text).trim()}`);
    lines.push(`📅 당첨자 발표: ${fmtK(e.announce)}`,
      '🔍 접수·당첨 확인: 주문하신 분 성함 또는 휴대폰 번호로 조회하실 수 있어요 (선물하기 주문은 받는 분 연락처로도 확인 가능)',
      `▶ ${PUBLIC_URL}`, '',
      '*추가 문의사항 있으시다면 언제든지 톡톡 또는 📞 010-6687-4031 고객센터 번호로 연락주시면 빠른 상담 도와드리겠습니다.');
    return lines.join('\n');
  }
  // 열려 있으면(live/published) 켜서 쓰고, 그 밖(내려감·준비 중으로 돌아감)은 꺼서 쓴다. 호출하는 쪽이 「열림 또는 열림에서 벗어나는 순간」에만 부른다.
  async function syncOut(db, req) {
    const e = db.event, st = stateOf(db), on = isOpen(st);
    const out = { card: false, bot: false, card_dropped: [] };
    const made = composeOut(db);   // #711: 글 만들기는 composeOut 한 곳(/bot-preview 가 같은 글을 미리 보여 준다) · 손질 ②: 제목·단추 글에 할인·쿠폰·금액이 들면 중립 글로
    try {
      out.card_dropped = made.card.dropped.slice();
      const cfg = { enabled: on && made.card.enabled, title: made.card.title, lines: made.card.lines, btn: made.card.btn, url: PUBLIC_URL, start: e.start || '', end: pageUntilOf(e) || '' };
      out.card = (await S.cfgSet('guide_event_card', cfg)) !== false;   // 받이가 false 를 돌려주면 안 쓴 것(가짜 표 모드)
    } catch (err) { console.error('[lucky] 카드 동기화 실패(무시):', err && err.message); }
    try {
      const row = { scenario_no: 59, name: '이벤트 안내(자동)', keywords: made.bot.keywords, response: made.bot.text, enabled: on && made.bot.enabled, channel: '공통', updated_by: '이벤트 관리' };
      out.bot = (await S.scenarioUpsert(row)) !== false;
    } catch (err) { console.error('[lucky] 봇 답(#59) 동기화 실패(무시):', err && err.message); }
    try { await writeAudit({ action: 'lucky_sync', targetType: 'lucky_event', targetId: cacheId, changes: { state: st, card: out.card, bot: out.bot, dropped: out.card_dropped.length }, source: 'lucky_admin', actor: req ? actorOf(req) : null }); } catch (_) { }
    return out;
  }

  /* ── 레이트 리밋 (원본 limited(ip, key, perMin)과 같은 뜻 · #693 과 같이 cf-connecting-ip 우선) ── */
  const hits = new Map();
  const ipOf = req => String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  function limited(ip, key, perMin) {
    const k = key + '|' + ip, now = Date.now();
    const arr = (hits.get(k) || []).filter(t => now - t < 60000);
    arr.push(now); hits.set(k, arr);
    if (hits.size > 5000) { for (const [kk, v] of hits) if (!v.length || now - v[v.length - 1] > 60000) hits.delete(kk); }
    return arr.length > perMin;
  }

  const fail = (res, e) => { console.error('[lucky]', e && e.message || e); if (!res.headersSent) res.status(500).json({ error: 'SERVER' }); };
  const actorOf = req => ({ id: req.user && req.user.id, name: req.user && req.user.name });
  const audit = (req, action, changes) => writeAudit({ action, targetType: 'lucky_event', targetId: cacheId, changes, source: 'lucky_admin', actor: actorOf(req) });
  const withMeta = async (db, extra) => { const assets = await assetMetaFor(db); return Object.assign({ ok: true, db, state: stateOf(db), checklist: checklistOf(db, assets) }, extra || {}); };

  /* ═════════ 공개 API (원본과 같은 경로·응답 + #708 칸) ═════════ */
  app.get('/api/lucky/event', async (req, res) => {
    try {
      const pk = req.query && req.query.pk;
      let db = await loadCurrent(false);   // 손질 ④: 키를 먼저 검사하고 맞을 때만 새로 읽는다(아무 pk 로 캐시를 우회해 DB 를 두드리지 못하게)
      const prev = !!pk && pkValid(pk, cacheId);
      if (prev) db = await loadCurrent(true);
      const el = eligibleOf(db);
      const st = stateOf(db), full = isOpen(st) || prev;
      const list = full ? db.orders.filter(el) : []; const s = new Set(list.map(custKey));
      const assets = full ? await assetMetaFor(db) : new Map();
      const ev = publicEvent(db, assets, st, full); if (prev) ev.preview = true;
      if (prev) res.set('Cache-Control', 'no-store');
      res.json({ event: ev, counts: { orders: list.length, customers: s.size } });
    } catch (e) { fail(res, e); }
  });

  app.get('/api/lucky/winners', async (_req, res) => {
    try {
      const db = await loadCurrent(false);
      if (!db.event.published) return res.json({ published: false, groups: [] });
      const groups = db.event.prizes.map((p, i) => ({
        rank: i + 1, prize: p.name, count: p.count,
        winners: db.winners.filter(w => w.prize === p.name).map(w => ({ name: dispName(w.name), phone: maskPhone(w.phone) }))
      }));
      res.json({ published: true, announce: db.event.announce, total: db.winners.length, groups });
    } catch (e) { fail(res, e); }
  });

  // #708 그림(공개 · 주소에 sha 꼬리 = 캐시 깨기 · 1년 immutable)
  app.get('/api/lucky/asset/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10); if (!(id > 0 && id <= INT_MAX)) return res.status(404).end();   // 손질 ⑥: int 범위 밖은 404(500 아님)
      await ensureTable();
      const r = await pool.query(`SELECT mime, bytes FROM ${AT} WHERE id = $1 AND purged_at IS NULL AND bytes IS NOT NULL`, [id]);
      if (!r.rows.length) { res.set('Cache-Control', 'public, max-age=60'); return res.status(404).end(); }
      res.set('Content-Type', r.rows[0].mime); res.set('Cache-Control', 'public, max-age=31536000, immutable'); res.set('X-Content-Type-Options', 'nosniff');
      res.end(r.rows[0].bytes);
    } catch (e) { fail(res, e); }
  });

  app.post('/api/lucky/lookup', async (req, res) => {
    try {
      if (limited(ipOf(req), 'lucky', 40)) return res.status(429).json({ error: 'RATE' });
      const q = String((req.body && req.body.q) || '').trim().slice(0, 40);
      if (!q) return res.status(400).json({ error: 'EMPTY' });
      const db = await loadCurrent(false);
      const st0 = stateOf(db); if (st0 === 'preparing') return res.status(400).json({ error: 'PREPARING' }); if (st0 === 'down') return res.status(400).json({ error: 'CLOSED' });   // #708
      const inRange = inRangeOf(db), exProd = exProdOf(db), eligible = eligibleOf(db);
      const d = digits(q); const phoneMode = d.length >= 7 && d.length >= q.replace(/[\s\-().]/g, '').length * 0.7;
      let found = [];
      const list = db.orders;
      if (phoneMode) {
        found = list.filter(o => digits(o.buyerPhone) === d || digits(o.buyerPhone2) === d).map(o => ({ o, by: 'buyer' }));
        if (!found.length) found = list.filter(o => digits(o.recvPhone) === d || digits(o.recvPhone2) === d).map(o => ({ o, by: 'receiver' }));
      } else {
        const n = nameKey(q); if (n.length < 2) return res.status(400).json({ error: 'SHORT' });
        const mt = s => { const k = nameKey(s); return k === n || (n.length >= 3 && k.includes(n)); };
        found = list.filter(o => mt(o.buyer)).map(o => ({ o, by: 'buyer' }));
        if (!found.length) found = list.filter(o => mt(o.recv)).map(o => ({ o, by: 'receiver' }));
      }
      found.sort((a, b) => (eligible(b.o) - eligible(a.o)) || String(b.o.date).localeCompare(String(a.o.date)));
      const wm = {}; db.winners.forEach(w => { wm[w.key] = w; });
      const pub = db.event.published;
      const out = found.slice(0, 30).map(({ o, by }) => {
        const w = wm[custKey(o)]; const inr = eligible(o);
        return {
          by, inRange: inr, noitem: inRange(o) && exProd(o), date: String(o.date || '').slice(0, 10), vendor: o.vendor || '', product: o.product || '', qty: o.qty || 1,
          buyer: maskName(o.buyer), buyerPhone: maskPhone(o.buyerPhone), recv: maskName(o.recv), recvPhone: maskPhone(o.recvPhone), addr: maskAddr(o.addr),
          tracking: o.tracking ? String(o.tracking).replace(/\d(?=\d{4})/g, '*') : '',
          status: !inr ? (inRange(o) ? 'noitem' : 'outside') : (pub ? (w ? 'win' : 'lose') : 'received'), prize: pub && w && inr ? w.prize : null
        };
      });
      const assets = await assetMetaFor(db);
      res.json({ ok: true, mode: phoneMode ? 'phone' : 'name', by: out.length ? out[0].by : null, results: out, event: publicEvent(db, assets, st0, true) });
    } catch (e) { fail(res, e); }
  });

  /* ═════════ 관리 API (회사 로그인 · 직원 가능) ═════════ */
  const A = '/api/agent-office/lucky';

  app.get(A + '/state', authMiddleware, async (_req, res) => {
    try { const db = await loadCurrent(true); res.json(await withMeta(db, { id: cacheId })); } catch (e) { fail(res, e); }
  });

  // 지난 회차 목록 (개인정보 없이 요약만 · #708 state·page_until 추가)
  app.get(A + '/rounds', authMiddleware, async (_req, res) => {
    try {
      await ensureTable();
      const r = await pool.query(`SELECT id, title, is_current, created_at, updated_at, archived_at, data,
          data->'event'->>'start' AS start, data->'event'->>'end' AS "end", (data->'event'->>'published')::boolean AS published,
          jsonb_array_length(COALESCE(data->'orders','[]'::jsonb)) AS orders, jsonb_array_length(COALESCE(data->'winners','[]'::jsonb)) AS winners
        FROM ${T} ORDER BY id DESC LIMIT 50`);
      res.json({ ok: true, rounds: r.rows.map(x => { const db = merge(x.data); const row = Object.assign({}, x); delete row.data; row.state = x.is_current ? stateOf(db) : (x.archived_at ? 'down' : stateOf(db)); row.page_until = pageUntilOf(db.event); return row; }) });
    } catch (e) { fail(res, e); }
  });

  app.post(A + '/orders', authMiddleware, async (req, res) => {
    try {
      const out = await withLock(async () => {
        const db = await loadCurrent(true);
        const rows = Array.isArray(req.body.orders) ? req.body.orders : [];
        const label = String(req.body.label || '').slice(0, 80);
        const ids = new Set(db.orders.map(o => o.id));
        let added = 0, dup = 0;
        rows.forEach(r => {
          const o = {
            vendor: String(r.vendor || '').slice(0, 20), date: String(r.date || '').slice(0, 10), buyer: String(r.buyer || '').slice(0, 40), buyerPhone: String(r.buyerPhone || '').slice(0, 30), buyerPhone2: String(r.buyerPhone2 || '').slice(0, 30),
            recv: String(r.recv || '').slice(0, 40), recvPhone: String(r.recvPhone || '').slice(0, 30), recvPhone2: String(r.recvPhone2 || '').slice(0, 30), product: String(r.product || '').slice(0, 120), qty: Number(r.qty) || 1,
            addr: String(r.addr || '').slice(0, 120), tracking: String(r.tracking || '').slice(0, 30), channel: String(r.channel || '').slice(0, 30)
          };
          o.id = orderId(o);
          if (ids.has(o.id)) { dup++; return; }
          ids.add(o.id); db.orders.push(o); added++;
        });
        if (added) db.uploads.push({ at: new Date().toISOString(), label, added, dup, by: req.user && req.user.name });
        await save(db);
        return { added, dup, label, db };
      });
      audit(req, 'lucky_orders_upload', { label: out.label, added: out.added, dup: out.dup });
      res.json({ ok: true, added: out.added, dup: out.dup, db: out.db });
    } catch (e) { fail(res, e); }
  });

  app.post(A + '/remove', authMiddleware, async (req, res) => {
    try {
      const out = await withLock(async () => {
        const db = await loadCurrent(true);
        const ids = new Set((req.body.ids || []).map(String)); const before = db.orders.length;
        if (req.body.vendor && req.body.date) db.orders = db.orders.filter(o => !(o.vendor === req.body.vendor && o.date === req.body.date));
        else db.orders = db.orders.filter(o => !ids.has(o.id));
        await save(db);
        return { removed: before - db.orders.length, db };
      });
      audit(req, 'lucky_orders_remove', { vendor: req.body.vendor || null, date: req.body.date || null, removed: out.removed });
      res.json({ ok: true, removed: out.removed, db: out.db });
    } catch (e) { fail(res, e); }
  });

  // 설정 저장 — 종전 칸 + #708 칸(화이트리스트 · 길이 자름) · live_mode 는 /go-live 로만 · 열려 있을 때만 카드·봇 동기화
  const cut = (v, n) => String(v == null ? '' : v).slice(0, n);
  const intOrNull = v => { if (v === null || v === '' || v === undefined) return null; const n = Number(v); return Number.isInteger(n) && n > 0 && n <= INT_MAX ? n : null; };   // 손질 ⑥: int 범위 밖은 없음으로(SQL int[] 캐스트 오류 방지)
  // 저장 몸 → db 에 얹기(화이트리스트 · 길이 자름) — /event 저장과 #711 /bot-preview(저장 안 함)가 같은 함수를 쓴다
  function applyEventPatch(db, e, excluded) {
    e = e || {};
    ['title', 'start', 'end', 'announce'].forEach(k => { if (e[k] != null) db.event[k] = String(e[k]).slice(0, 80); });
    if (Array.isArray(e.excludeProducts)) db.event.excludeProducts = e.excludeProducts.map(x => String(x).trim()).filter(Boolean);
    if (Array.isArray(e.prizes)) db.event.prizes = e.prizes.filter(p => p && p.name).map(p => ({ name: String(p.name).slice(0, 60), count: Math.max(0, Number(p.count) || 0), desc: cut(p.desc, 120), note: cut(p.note, 40), image_id: intOrNull(p.image_id) }));
    if (Array.isArray(excluded)) db.excluded = excluded.map(x => digits(x) || norm(x)).filter(Boolean);
    // #708
    if (e.display_title != null) db.event.display_title = cut(e.display_title, 60).trim();
    if (e.page_until != null) db.event.page_until = isDate(e.page_until) ? e.page_until : '';
    if (e.coupon_text != null) db.event.coupon_text = cut(e.coupon_text, 80).trim();
    ['hero_image_id', 'winner_image_id', 'result_image_id'].forEach(k => { if (k in e) db.event[k] = intOrNull(e[k]); });
    if (e.texts && typeof e.texts === 'object') { TEXT_KEYS.forEach(k => { if (k in e.texts) { const v = cut(e.texts[k], 120).trim(); if (v) db.event.texts[k] = v; else delete db.event.texts[k]; } }); }
    if (e.guide_card && typeof e.guide_card === 'object') {
      const g = e.guide_card, cur = db.event.guide_card;
      db.event.guide_card = { enabled: g.enabled == null ? cur.enabled !== false : g.enabled !== false, title: cut(g.title != null ? g.title : cur.title, 60), lines: (Array.isArray(g.lines) ? g.lines : cur.lines || []).slice(0, 3).map(l => cut(l, 120)), btn: cut(g.btn != null ? g.btn : cur.btn, 30), custom: g.custom == null ? !!cur.custom : !!g.custom };
    }
    if (e.bot_reply && typeof e.bot_reply === 'object') {
      const b = e.bot_reply, cur = db.event.bot_reply;
      db.event.bot_reply = { enabled: b.enabled == null ? cur.enabled !== false : b.enabled !== false, keywords: (Array.isArray(b.keywords) ? b.keywords : cur.keywords || []).slice(0, 20).map(k => cut(k, 20).trim()).filter(Boolean), response: cut(b.response != null ? b.response : cur.response, 2000), custom: b.custom == null ? !!cur.custom : !!b.custom };
    }
    if (Array.isArray(e.pending_art)) db.event.pending_art = e.pending_art.slice(0, 20).map(x => ({ order_id: intOrNull(x && x.order_id), slot: cut(x && x.slot, 20), at: cut(x && x.at, 40) })).filter(x => x.order_id);
    return db;
  }
  // 카드·봇 글 만들기(저장 때 syncOut 이 쓰는 것과 같은 규칙) — 카드는 광고성 줄을 빼고 뺀 줄을 dropped 로
  function composeOut(db) {
    const e = db.event, gc = e.guide_card || {}, auto = autoCard(db), br = e.bot_reply || {};
    const title = gc.custom && gc.title ? gc.title : auto.title;
    const srcLines = gc.custom && Array.isArray(gc.lines) && gc.lines.length ? gc.lines : auto.lines;
    const lines = [], dropped = []; srcLines.forEach(l => { const s = String(l || '').trim(); if (!s) return; if (BAN_RE.test(s)) dropped.push(s); else lines.push(s); });
    const btn0 = (gc.custom && gc.btn) || auto.btn;
    if (BAN_RE.test(title)) dropped.push(title); if (BAN_RE.test(btn0)) dropped.push(btn0);
    return {
      card: { title: BAN_RE.test(title) ? '🎁 이벤트 안내' : title, lines: lines.slice(0, 3), btn: BAN_RE.test(btn0) ? '접수·당첨 확인 바로가기' : btn0, dropped, custom: !!gc.custom, enabled: gc.enabled !== false },
      bot: { text: br.custom && br.response ? br.response : autoBot(db), custom: !!(br.custom && br.response), keywords: (br.custom && Array.isArray(br.keywords) && br.keywords.length ? br.keywords : BOT_KEYWORDS).slice(0, 20), enabled: br.enabled !== false }
    };
  }
  app.post(A + '/event', authMiddleware, async (req, res) => {
    try {
      const r = await withLock(async () => {
        const db = await loadCurrent(true);
        applyEventPatch(db, req.body.event || {}, req.body.excluded);
        await save(db);
        const synced = isOpen(stateOf(db)) ? await syncOut(db, req) : { card: false, bot: false };
        return { db, synced };
      });
      audit(req, 'lucky_event_settings', { title: r.db.event.title, start: r.db.event.start, end: r.db.event.end, announce: r.db.event.announce, page_until: pageUntilOf(r.db.event), prizes: r.db.event.prizes.map(p => ({ name: p.name, count: p.count })), excludeProducts: r.db.event.excludeProducts, excludedCount: r.db.excluded.length, state: stateOf(r.db) });
      res.json(await withMeta(r.db, { synced: r.synced }));
    } catch (e) { fail(res, e); }
  });

  // #711 봇 답·/guide 카드 미리보기 — 초안을 현재 회차 사본에 얹어 저장 때와 같은 글을 만든다(저장 0 · 동기화 0 · 감사 0) · 화면이 300ms 디바운스로 부름
  app.post(A + '/bot-preview', authMiddleware, async (req, res) => {
    try {
      if (limited(req.user && req.user.id ? 'u' + req.user.id : ipOf(req), 'botpv', 300)) return res.status(429).json({ error: 'RATE' });   // 사람(로그인 id)마다 분당 300 — 사무실 공인 IP 하나로 여럿이 ④ 를 고쳐도 429 안 남(워커2 점검)
      const body = req.body || {}; const e = body.event;
      if (e != null && (typeof e !== 'object' || Array.isArray(e))) return res.status(400).json({ error: 'BODY' });
      const cur = await loadCurrent(true);
      const db = applyEventPatch(merge(JSON.parse(JSON.stringify(cur))), e || {}, body.excluded);   // 깊은 사본 · 캐시(cur) 무변경
      const made = composeOut(db);
      res.json({ ok: true, bot: made.bot, card: made.card, state: stateOf(db) });
    } catch (e) { fail(res, e); }
  });

  // #711 판매현황 품목 묶음(응모 제외 품목 칩 고르기) — 읽기만 · 30초 기억 · 개인정보·금액 없음
  app.get(A + '/products', authMiddleware, async (_req, res) => {
    try { res.json({ ok: true, groups: await productGroups() }); } catch (e) { fail(res, e); }
  });

  // #708 그림 올리기(브라우저가 webp 로 줄여 base64 로) · 목록 · 지우기
  app.post(A + '/assets', authMiddleware, async (req, res) => {
    try {
      const b = req.body || {};
      const slot = String(b.slot || ''); if (!ASSET_SLOTS.includes(slot)) return res.status(400).json({ error: 'SLOT' });
      const mime = String(b.mime || ''); if (!ASSET_MIMES.includes(mime)) return res.status(400).json({ error: 'MIME' });
      const raw = String(b.data || '').replace(/^data:[^;]+;base64,/, '');
      if (!raw || raw.length > ASSET_MAX * 1.4) return res.status(400).json({ error: 'SIZE' });
      const buf = Buffer.from(raw, 'base64'); if (!buf.length || buf.length > ASSET_MAX) return res.status(400).json({ error: 'SIZE' });
      const sha1 = crypto.createHash('sha1').update(buf).digest('hex');
      await ensureTable(); await loadCurrent(true);
      const r = await pool.query(`INSERT INTO ${AT} (round_id, slot, label, mime, bytes, size, width, height, sha1, source, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, created_at`,
        [cacheId, slot, cut(b.label, 60) || null, mime, buf, buf.length, intOrNull(b.width), intOrNull(b.height), sha1, cut(b.source, 20) || 'upload', (req.user && req.user.id) || null]);
      const id = r.rows[0].id;
      audit(req, 'lucky_asset_upload', { asset_id: id, slot, mime, size: buf.length, label: cut(b.label, 60) || null });
      res.json({ ok: true, asset: { id, url: `/api/lucky/asset/${id}?v=${sha1.slice(0, 8)}`, slot, mime, size: buf.length, width: intOrNull(b.width), height: intOrNull(b.height), label: cut(b.label, 60) || null, created_at: r.rows[0].created_at } });
    } catch (e) { fail(res, e); }
  });
  app.get(A + '/assets', authMiddleware, async (req, res) => {
    try {
      await ensureTable();
      const slot = String((req.query && req.query.slot) || '');
      const r = await pool.query(`SELECT id, slot, label, mime, size, width, height, sha1, source, round_id, created_at FROM ${AT} WHERE purged_at IS NULL ${slot ? 'AND slot = $1' : ''} ORDER BY id DESC LIMIT 200`, slot ? [slot] : []);
      res.json({ ok: true, assets: r.rows.map(x => ({ id: x.id, url: `/api/lucky/asset/${x.id}?v=${String(x.sha1 || '').slice(0, 8)}`, slot: x.slot, label: x.label, mime: x.mime, size: x.size, width: x.width, height: x.height, source: x.source, round_id: x.round_id, created_at: x.created_at })) });
    } catch (e) { fail(res, e); }
  });
  app.delete(A + '/assets/:id', authMiddleware, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10); if (!(id > 0 && id <= INT_MAX)) return res.status(400).json({ error: 'ID' });
      const db = await loadCurrent(true);
      if (refIds(db).includes(id)) return res.status(409).json({ error: 'IN_USE' });
      await pool.query(`UPDATE ${AT} SET bytes = NULL, purged_at = NOW() WHERE id = $1 AND purged_at IS NULL`, [id]);
      audit(req, 'lucky_asset_delete', { asset_id: id });
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  // #708 열기·예약·내리기 — 열기 전 체크리스트(①~③) 미완이면 거절 · 열리는 순간/열림에서 벗어나는 순간 동기화 1회
  app.post(A + '/go-live', authMiddleware, async (req, res) => {
    try {
      const mode = String((req.body && req.body.mode) || '');
      if (!['live', 'scheduled', 'down', 'draft'].includes(mode)) return res.status(400).json({ error: 'MODE' });
      const r = await withLock(async () => {
        const db = await loadCurrent(true);
        const before = stateOf(db);
        if (mode === 'live' || mode === 'scheduled') {
          const cl = checklistOf(db, await assetMetaFor(db));
          if (!cl.ready) return { err: { status: 400, body: { error: 'NOT_READY', missing: cl.missing } } };
          if (mode === 'scheduled' && !isDate(db.event.start)) return { err: { status: 400, body: { error: 'NOT_READY', missing: ['응모 시작일'] } } };
        }
        if (mode === 'down' && !isDate(db.event.page_until)) db.event.page_until = kstToday();   // 내리는 날을 오늘로 적어 틱·카드가 같은 날짜를 보게
        db.event.live_mode = mode;
        db.event.live_at = mode === 'live' ? new Date(nowMs()).toISOString() : (mode === 'scheduled' ? db.event.start + 'T00:00:00+09:00' : db.event.live_at);
        await save(db);
        const after = stateOf(db);
        const synced = (isOpen(after) || isOpen(before)) ? await syncOut(db, req) : { card: false, bot: false };
        return { db, synced, before, after };
      });
      if (r.err) return res.status(r.err.status).json(r.err.body);
      audit(req, 'lucky_go_live', { mode, before: r.before, after: r.after });
      res.json(await withMeta(r.db, { synced: r.synced }));
    } catch (e) { fail(res, e); }
  });

  // #708 지난 회차 복사 — 설정·문구·그림 참조만 · 주문·당첨·제외·올린 기록 비움 · 날짜 비움 · 초안으로 시작 · 지금 회차가 열려 있으면 거절
  app.post(A + '/copy-round', authMiddleware, async (req, res) => {
    try {
      const fromId = parseInt(req.body && req.body.from_id, 10); if (!(fromId > 0)) return res.status(400).json({ error: 'FROM' });
      const r = await withLock(async () => {
        const cur = await loadCurrent(true);
        if (cacheId && isOpen(stateOf(cur))) return { err: { status: 409, body: { error: 'LIVE' } } };
        const src = await pool.query(`SELECT data FROM ${T} WHERE id = $1`, [fromId]);
        if (!src.rows.length) return { err: { status: 404, body: { error: 'NOT_FOUND' } } };
        const from = merge(src.rows[0].data);
        if (cacheId) await pool.query(`UPDATE ${T} SET is_current=FALSE, archived_at=COALESCE(archived_at, NOW()) WHERE id=$1`, [cacheId]);
        cacheId = null;
        const db = DEFAULT();
        db.event = Object.assign(db.event, JSON.parse(JSON.stringify(from.event)), {
          title: String((req.body && req.body.title) || from.event.title).slice(0, 80),
          start: '', end: '', announce: '', page_until: '', live_mode: 'draft', live_at: null, published: false, drawnAt: null, pending_art: []
        });
        await save(db);
        return { db, from: fromId };
      });
      if (r.err) return res.status(r.err.status).json(r.err.body);
      audit(req, 'lucky_copy_round', { from: r.from, title: r.db.event.title });
      res.json(await withMeta(r.db, { id: cacheId }));
    } catch (e) { fail(res, e); }
  });

  // #708 미리보기 키(1시간 · 현재 회차만)
  app.get(A + '/preview-key', authMiddleware, async (_req, res) => {
    try {
      await loadCurrent(true);
      if (!SECRET) return res.status(500).json({ error: 'NO_SECRET' });
      const pk = makePk(cacheId || 0);
      res.json({ ok: true, pk, expires_at: new Date(Number(pk.split('.')[0])).toISOString(), url: `/lucky.html?pk=${pk}` });
    } catch (e) { fail(res, e); }
  });

  app.post(A + '/draw', authMiddleware, async (req, res) => {
    try {
      const out = await withLock(async () => {
        const db = await loadCurrent(true); const eligible = eligibleOf(db);
        const ex = new Set(db.excluded);
        const keep = req.body.keep ? new Set(req.body.keep.map(String)) : null;
        const byKey = {};
        db.orders.filter(eligible).forEach(o => { const k = custKey(o); if (!k || ex.has(k)) return; if (!byKey[k]) byKey[k] = { key: k, name: o.buyer || o.recv, phone: o.buyerPhone || o.recvPhone, orders: 0, first: o }; byKey[k].orders++; });
        // 가중 추첨: 주문 1건 = 응모권 1장 · 한 사람은 최대 1번 당첨 (원본 동일)
        const ticketPool = []; Object.values(byKey).forEach(c => { for (let i = 0; i < c.orders; i++) ticketPool.push(c); });
        for (let i = ticketPool.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [ticketPool[i], ticketPool[j]] = [ticketPool[j], ticketPool[i]]; }
        const slots = []; db.event.prizes.forEach(p => { for (let i = 0; i < p.count; i++) slots.push(p.name); });
        const kept = keep ? db.winners.filter(w => keep.has(w.key)) : [];
        const used = new Set(kept.map(w => w.key));
        const winners = kept.slice();
        const remaining = slots.slice(); kept.forEach(w => { const i = remaining.indexOf(w.prize); if (i > -1) remaining.splice(i, 1); });
        for (const c of ticketPool) { if (!remaining.length) break; if (used.has(c.key)) continue; used.add(c.key); winners.push({ key: c.key, name: c.name, phone: c.phone, prize: remaining.shift(), orders: c.orders, product: c.first.product, date: c.first.date }); }
        db.winners = winners; db.event.drawnAt = new Date().toISOString(); db.event.published = false;
        await save(db);
        return { pool: Object.keys(byKey).length, tickets: ticketPool.length, kept: kept.length, db };
      });
      audit(req, 'lucky_draw', { pool: out.pool, tickets: out.tickets, winners: out.db.winners.length, kept: out.kept });
      res.json({ ok: true, pool: out.pool, tickets: out.tickets, db: out.db });
    } catch (e) { fail(res, e); }
  });

  app.post(A + '/publish', authMiddleware, async (req, res) => {
    try {
      const db = await withLock(async () => { const db = await loadCurrent(true); db.event.published = !!req.body.published; await save(db); return db; });
      audit(req, 'lucky_publish', { published: db.event.published, winners: db.winners.length });
      res.json({ ok: true, db });
    } catch (e) { fail(res, e); }
  });

  // 옛 사이트 백업 JSON(또는 이 화면의 백업 파일)으로 현재 회차를 덮어쓰기 — 관리자만(#708 에서도 그대로)
  app.post(A + '/restore', authMiddleware, adminOnly, async (req, res) => {
    try {
      const d = req.body.db; if (!d || !Array.isArray(d.orders)) return res.status(400).json({ error: 'BAD' });
      const db = await withLock(async () => { await loadCurrent(true); const db = merge(d); await save(db); return db; });
      audit(req, 'lucky_restore', { orders: db.orders.length, winners: db.winners.length, title: db.event.title });
      res.json({ ok: true, db });
    } catch (e) { fail(res, e); }
  });

  // 전체 초기화 — 직원 가능(#708 · 대표 10/15 · 화면이 확인 창 1번 뒤 confirm 글자를 넣어 보냄 · 원본 동일: confirm 'RESET')
  app.post(A + '/reset', authMiddleware, async (req, res) => {
    try {
      if (req.body.confirm !== 'RESET') return res.status(400).json({ error: 'CONFIRM' });
      const before = await loadCurrent(true);
      const n = before.orders.length, wasOpen = isOpen(stateOf(before));
      const db = await withLock(async () => { const db = DEFAULT(); db.event.live_mode = 'draft'; db.event.start = db.event.end = db.event.announce = ''; db.event.prizes = []; db.event.excludeProducts = []; await save(db); if (wasOpen) await syncOut(db, req); return db; });
      audit(req, 'lucky_reset', { ordersBefore: n });
      res.json({ ok: true, db });
    } catch (e) { fail(res, e); }
  });

  // 새 회차 시작 — 현재 회차는 보관(삭제 안 함), 빈 회차를 새로 만든다 · 직원 가능(#708) · 새 회차는 초안(preparing)으로 시작
  app.post(A + '/new-round', authMiddleware, async (req, res) => {
    try {
      if (req.body.confirm !== 'NEW') return res.status(400).json({ error: 'CONFIRM' });
      const r = await withLock(async () => {
        const cur = await loadCurrent(true); const wasOpen = isOpen(stateOf(cur)) && !!cacheId;
        if (cacheId) await pool.query(`UPDATE ${T} SET is_current=FALSE, archived_at=NOW() WHERE id=$1`, [cacheId]);
        cacheId = null;
        const db = DEFAULT();
        db.event.title = String(req.body.title || db.event.title).slice(0, 80);
        db.event.start = db.event.end = db.event.announce = '';
        db.event.prizes = []; db.event.excludeProducts = [];
        db.event.live_mode = 'draft';
        await save(db);
        if (wasOpen) await syncOut(db, req);   // 열려 있던 회차를 보관했으니 카드·봇은 꺼진다
        return db;
      });
      audit(req, 'lucky_new_round', { title: r.event.title });
      res.json(await withMeta(r, { id: cacheId }));   // 손질 ⓐ: state(preparing)·checklist 도 같이
    } catch (e) { fail(res, e); }
  });

  /* ── #708 틱(1시간) — 예약 열기 · 내리는 날 지나면 내림(카드·봇 끔) · 내려간 지 오래된 회차의 그림 바이트 비움 ── */
  async function tickOnce(ms) {
    const out = { opened: false, closed: false, purged: 0 };
    try {
      await withLock(async () => {
        const db = await loadCurrent(true); if (!cacheId) return;
        const e = db.event, mode = e.live_mode || 'legacy', st = stateOf(db, ms);
        if (mode === 'legacy') return;   // 옛 회차는 틱이 건드리지 않는다
        if (mode === 'scheduled' && isOpen(st)) { e.live_mode = 'live'; e.live_at = new Date(ms == null ? nowMs() : ms).toISOString(); await save(db); await syncOut(db, null); out.opened = true; }
        else if (mode !== 'down' && st === 'down') { e.live_mode = 'down'; await save(db); await syncOut(db, null); out.closed = true; }
      });
      const keep = refIds(cache || DEFAULT());
      const r = await pool.query(`UPDATE ${AT} a SET bytes = NULL, purged_at = NOW() WHERE a.purged_at IS NULL AND a.slot <> 'brand' AND a.created_at < NOW() - make_interval(days => $1::int)
          AND NOT (a.id = ANY($2::int[])) AND (a.round_id IS NULL OR EXISTS (SELECT 1 FROM ${T} t WHERE t.id = a.round_id AND t.is_current = FALSE)) RETURNING id`, [ASSET_KEEP_DAYS, keep.length ? keep : [0]]);
      out.purged = r.rowCount || 0;
    } catch (err) { console.error('[lucky] 틱 실패(다음 시간에 다시):', err && err.message); }
    return out;
  }
  if (tick === true || (tick !== false && !table)) {   // 검증(표 이름 인자)이면 틱 기본 꺼짐(tick:true 로만 켬) · 손질 ③: 기동 90초 뒤 1회(재배포 사이 놓친 예약 열기·내리기) + 1시간 주기
    const t0 = setTimeout(() => { tickOnce().catch(() => { }); }, 90e3); if (t0.unref) t0.unref();
    const t = setInterval(() => { tickOnce().catch(() => { }); }, 3600e3); if (t.unref) t.unref();
  }

  return { tickOnce, stateOf, checklistOf, pkValid, makePk, _assetTable: AT, _itemGroups: ITEM_GROUPS, groupProducts, composeOut };
};
