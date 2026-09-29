/* 제주아꼼이네 고객 감사 이벤트 (접수 확인 · 추첨 · 당첨 조회) — 회사 프로그램 이식판
 *
 * 원본: bumiletter-bit/bum-toolbox lucky.js (origin/main 6709f84 · event.akkome.com)
 *   - 추첨·조회·마스킹 로직은 원본과 동일(문자 단위로 옮김). 바뀐 것은 저장소와 로그인뿐:
 *     ① 저장 = 파일(data/lucky.json — 배포마다 소실) → 회사 DB lucky_events(JSONB 1행 = 1회차)
 *     ② 관리자 = 관리자 코드(x-admin-code) → 회사 로그인(JWT) · 직원 가능 · 초기화/복원/새 회차 = 관리자만
 *     ③ 모든 쓰기 = audit_logs 기록(개인정보 없이 건수만)
 *   - 공개 API 경로는 원본과 동일(/api/lucky/event · /lookup · /winners) — 손님 페이지(public/lucky.html) 무변경 이식 가능.
 *   - 관리 API = /api/agent-office/lucky/* (원본 /api/lucky/admin/* 와 같은 동작 · 같은 응답 {ok, db, ...}).
 *
 * 마운트(server.js 1줄): require('./lucky-event.js')(app, { pool, authMiddleware, adminOnly, writeAudit });
 * 🔴 initDB·타이머·설정 행을 만들지 않는다(#467 시드 사고 교훈) — 테이블은 첫 요청 때 CREATE IF NOT EXISTS.
 */
'use strict';
const crypto = require('crypto');

module.exports = function mountLuckyEvent(app, { pool, authMiddleware, adminOnly, writeAudit, table }) {
  const T = /^[a-z_]+$/.test(table || '') ? table : 'lucky_events';   // 검증 스크립트만 다른 테이블 사용
  /* ── 기본값 (원본 DEFAULT와 동일한 모양) ── */
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
      excludeProducts: ['청귤']
    },
    orders: [], winners: [], excluded: [], uploads: [], updatedAt: null
  });
  const merge = d => { const out = Object.assign(DEFAULT(), d || {}); out.event = Object.assign(DEFAULT().event, (d && d.event) || {}); return out; };

  /* ── 저장소: lucky_events (1행 = 1회차, is_current 1개) ── */
  let tableReady = null;
  function ensureTable() {
    if (!tableReady) {
      tableReady = pool.query(`CREATE TABLE IF NOT EXISTS ${T} (
          id SERIAL PRIMARY KEY,
          title TEXT,
          data JSONB NOT NULL,
          is_current BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          archived_at TIMESTAMP
        )`).catch(e => { tableReady = null; throw e; });
    }
    return tableReady;
  }
  let cache = null, cacheId = null, cacheAt = 0;
  const CACHE_MS = 15000;   // 공개 조회용 — 쓰기는 항상 DB에서 새로 읽음
  async function loadCurrent(fresh) {
    await ensureTable();
    if (!fresh && cache && Date.now() - cacheAt < CACHE_MS) return cache;
    const r = await pool.query(`SELECT id, data FROM ${T} WHERE is_current = TRUE ORDER BY id DESC LIMIT 1`);
    if (r.rows.length) { cache = merge(r.rows[0].data); cacheId = r.rows[0].id; }
    else { cache = DEFAULT(); cacheId = null; }
    cacheAt = Date.now();
    return cache;
  }
  async function save(db) {
    db.updatedAt = new Date().toISOString();
    const json = JSON.stringify(db);
    if (cacheId) await pool.query(`UPDATE ${T} SET data=$2::jsonb, title=$3, updated_at=NOW() WHERE id=$1`, [cacheId, json, db.event.title]);
    else { const r = await pool.query(`INSERT INTO ${T} (title, data, is_current) VALUES ($1, $2::jsonb, TRUE) RETURNING id`, [db.event.title, json]); cacheId = r.rows[0].id; }
    cache = db; cacheAt = Date.now();
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
  const publicEvent = db => ({ title: db.event.title, start: db.event.start, end: db.event.end, announce: db.event.announce, prizes: db.event.prizes, published: db.event.published, excludeProducts: db.event.excludeProducts || [] });
  const dispName = n => { let s = String(n || '').replace(/[!！.]+$/g, '').replace(/\s*드림\s*$/, '').replace(/[!！.]+$/g, '').trim(); const parts = s.split(/\s+/).filter(Boolean); if (parts.length > 1) { const last = parts[parts.length - 1]; if (last.length >= 2) s = last; } return maskName(s); };

  /* ── 레이트 리밋 (원본 limited(ip, key, perMin)과 같은 뜻) ── */
  const hits = new Map();
  const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
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

  /* ═════════ 공개 API (원본과 같은 경로·응답) ═════════ */
  app.get('/api/lucky/event', async (_req, res) => {
    try {
      const db = await loadCurrent(false); const el = eligibleOf(db);
      const list = db.orders.filter(el); const s = new Set(list.map(custKey));
      res.json({ event: publicEvent(db), counts: { orders: list.length, customers: s.size } });
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

  app.post('/api/lucky/lookup', async (req, res) => {
    try {
      if (limited(ipOf(req), 'lucky', 40)) return res.status(429).json({ error: 'RATE' });
      const q = String((req.body && req.body.q) || '').trim().slice(0, 40);
      if (!q) return res.status(400).json({ error: 'EMPTY' });
      const db = await loadCurrent(false);
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
      res.json({ ok: true, mode: phoneMode ? 'phone' : 'name', by: out.length ? out[0].by : null, results: out, event: publicEvent(db) });
    } catch (e) { fail(res, e); }
  });

  /* ═════════ 관리 API (회사 로그인 · 직원 가능) ═════════ */
  const A = '/api/agent-office/lucky';

  app.get(A + '/state', authMiddleware, async (_req, res) => {
    try { const db = await loadCurrent(true); res.json({ ok: true, db, id: cacheId }); } catch (e) { fail(res, e); }
  });

  // 지난 회차 목록 (개인정보 없이 요약만)
  app.get(A + '/rounds', authMiddleware, async (_req, res) => {
    try {
      await ensureTable();
      const r = await pool.query(`SELECT id, title, is_current, created_at, updated_at, archived_at,
          data->'event'->>'start' AS start, data->'event'->>'end' AS "end", (data->'event'->>'published')::boolean AS published,
          jsonb_array_length(COALESCE(data->'orders','[]'::jsonb)) AS orders, jsonb_array_length(COALESCE(data->'winners','[]'::jsonb)) AS winners
        FROM ${T} ORDER BY id DESC LIMIT 50`);
      res.json({ ok: true, rounds: r.rows });
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

  app.post(A + '/event', authMiddleware, async (req, res) => {
    try {
      const db = await withLock(async () => {
        const db = await loadCurrent(true);
        const e = req.body.event || {};
        ['title', 'start', 'end', 'announce'].forEach(k => { if (e[k] != null) db.event[k] = String(e[k]).slice(0, 80); });
        if (Array.isArray(e.excludeProducts)) db.event.excludeProducts = e.excludeProducts.map(x => String(x).trim()).filter(Boolean);
        if (Array.isArray(e.prizes)) db.event.prizes = e.prizes.filter(p => p && p.name).map(p => ({ name: String(p.name).slice(0, 60), count: Math.max(0, Number(p.count) || 0) }));
        if (Array.isArray(req.body.excluded)) db.excluded = req.body.excluded.map(x => digits(x) || norm(x)).filter(Boolean);
        await save(db);
        return db;
      });
      audit(req, 'lucky_event_settings', { title: db.event.title, start: db.event.start, end: db.event.end, announce: db.event.announce, prizes: db.event.prizes, excludeProducts: db.event.excludeProducts, excludedCount: db.excluded.length });
      res.json({ ok: true, db });
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

  // 옛 사이트 백업 JSON(또는 이 화면의 백업 파일)으로 현재 회차를 덮어쓰기 — 관리자만
  app.post(A + '/restore', authMiddleware, adminOnly, async (req, res) => {
    try {
      const d = req.body.db; if (!d || !Array.isArray(d.orders)) return res.status(400).json({ error: 'BAD' });
      const db = await withLock(async () => { await loadCurrent(true); const db = merge(d); await save(db); return db; });
      audit(req, 'lucky_restore', { orders: db.orders.length, winners: db.winners.length, title: db.event.title });
      res.json({ ok: true, db });
    } catch (e) { fail(res, e); }
  });

  // 전체 초기화 — 관리자만 (원본 동일: confirm 'RESET')
  app.post(A + '/reset', authMiddleware, adminOnly, async (req, res) => {
    try {
      if (req.body.confirm !== 'RESET') return res.status(400).json({ error: 'CONFIRM' });
      const before = await loadCurrent(true);
      const n = before.orders.length;
      const db = await withLock(async () => { const db = DEFAULT(); await save(db); return db; });
      audit(req, 'lucky_reset', { ordersBefore: n });
      res.json({ ok: true, db });
    } catch (e) { fail(res, e); }
  });

  // 새 회차 시작 — 현재 회차는 보관(삭제 안 함), 빈 회차를 새로 만든다 · 관리자만
  app.post(A + '/new-round', authMiddleware, adminOnly, async (req, res) => {
    try {
      if (req.body.confirm !== 'NEW') return res.status(400).json({ error: 'CONFIRM' });
      const db = await withLock(async () => {
        await loadCurrent(true);
        if (cacheId) await pool.query(`UPDATE ${T} SET is_current=FALSE, archived_at=NOW() WHERE id=$1`, [cacheId]);
        cacheId = null;
        const db = DEFAULT();
        db.event.title = String(req.body.title || db.event.title).slice(0, 80);
        db.event.start = db.event.end = db.event.announce = '';
        db.event.prizes = []; db.event.excludeProducts = [];
        await save(db);
        return db;
      });
      audit(req, 'lucky_new_round', { title: db.event.title });
      res.json({ ok: true, db });
    } catch (e) { fail(res, e); }
  });
};
