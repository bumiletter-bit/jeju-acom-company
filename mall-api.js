'use strict';
/* ============================================================================
 * mall-api.js — 제주아꼼이네 자사몰 게임 백엔드 (독립 Express 라우터 모듈)
 * ============================================================================
 * ▶ 상태: 프로토타입. server.js 결선(require + app.use) 전까지 완전 비활성.
 *   결선 후에도 env MALL_API==='on' && MALL_API_TOKEN 설정 전엔 전 라우트 503.
 *   실지급(쿠폰·마일리지·실물) 0건 — 전부 스텁/pending 기록만.
 *
 * ▶ 모듈 계약:
 *   const { createMallRouter } = require('./mall-api.js');
 *   app.use('/api/mall', createMallRouter({ pool, express, cfgGet, cfgSet, writeAudit }));
 *   - cfgGet(key)/cfgSet(key,val): agent_office_config JSONB (메인 주입)
 *   - writeAudit({action,targetType,targetId,changes,source,actor}) (메인 주입)
 *   - 이 모듈은 cfgSet을 호출하지 않음(설정 관리 화면은 메인 담당).
 *
 * ▶ 전제 테이블(메인 initDB 생성 — 여기엔 DDL 없음):
 *   mall_members / points_ledger(append-only, idem_key UNIQUE)
 *   roulette_spins(UNIQUE(member_id,spin_date)) / tree_state / reward_grants
 *   재사용: season_waitlist, bot_products (읽기·INSERT만)
 *
 * ▶ 원장 원칙: points_ledger는 append-only — 이 모듈은 UPDATE/DELETE를 절대
 *   실행하지 않는다. 잔액 = 해당 회원 마지막 행의 balance_after.
 *
 * ============================================================================
 * ■ 어뷰징 시나리오 상정·방어 (설계 문서화)
 * ============================================================================
 * [A1] 동시 다발 스핀(따닥·멀티탭·스크립트 연타):
 *      → roulette_spins UNIQUE(member_id, spin_date)가 DB 레벨 원자 보장.
 *        ON CONFLICT DO NOTHING + RETURNING 없음 감지 → ROLLBACK 후 409.
 *        앱 레벨 "오늘 참여했나" 선조회에 의존하지 않음(레이스 무의미화).
 * [A2] idem_key 재사용 이중 적립(재시도 폭탄·리플레이):
 *      → points_ledger.idem_key UNIQUE. 중복이면 신규 INSERT 없이 기존 행을
 *        200으로 재반환(이중 처리 방지). 단 idem_key가 "타 회원" 원장 행과
 *        충돌하면 409(남의 처리 결과 탈취 방지).
 *        라우트별 접두사(earn:/redeem:/water:)로 교차 라우트 충돌 차단.
 * [A3] 음수·거대·소수 amount 주입(예: -100 redeem으로 적립 효과):
 *      → Number.isInteger + 1 이상 + 상한(MAX_POINT_AMOUNT) 강제. 문자열 숫자
 *        는 정수 변환 후 재검증. delta 부호는 서버가 결정(클라 부호 무시).
 * [A4] 동시 redeem 이중 인출(잔액 100에 100 인출 2발 동시):
 *      → 모든 잔액 변동은 트랜잭션 안에서 mall_members 행 FOR UPDATE로 회원별
 *        직렬화 후 마지막 원장 행을 읽어 계산 → 음수 잔액 원천 불가.
 * [A5] 타 회원 member_key 도용:
 *      → 현 단계는 단일 서버 토큰(프로토타입) — member_key 신원 위조를 서버가
 *        판별할 수 없음. 🔴 대표 확인 필요: 실오픈 전 회원별 서명(카페24
 *        로그인 연동 HMAC 등) 필수. 임의 확정하지 않고 게이트 주석에 명시.
 * [A6] 요청 폭주(포인트 API 난사·테이블 팽창):
 *      → 인메모리 레이트리밋(IP당 분당 RATE_PER_MIN회 초과 시 429).
 *        프로토타입용 — 다중 인스턴스면 무력(현재 Render 단일 인스턴스 가정).
 * [A7] mall_game_config 오염(weight 합 0·음수·thresholds 비정렬):
 *      → normalizeConfig()가 스키마 검증 실패 시 코드 안전 기본값으로 폴백.
 *
 * ============================================================================
 * ■ 🔴 대표 확인 필요 (임의 확정 금지 목록)
 * ============================================================================
 * 1) 회원 인증: 단일 Bearer 토큰은 프로토타입용 — 회원별 위조 방지 방식 미정.
 * 2) DEFAULT_CONFIG의 확률·weight·water_cost·physical_monthly_limit 값은
 *    데모 수치 — 실서비스 원가(기대 지급 포인트/스핀 = Σ points×weight/Σweight
 *    = 기본값 기준 약 22.7P/회) 승인 필요.
 * 3) MAX_POINT_AMOUNT(1회 적립·사용 상한 100,000) — 운영값 승인 필요.
 * 4) daily_spin_limit은 스키마상 1만 지원(UNIQUE(member_id,spin_date)).
 *    2회 이상으로 바꾸려면 테이블 구조 변경 필요 — 현재 값 무시하고 1 고정.
 * 5) 룰렛 'coupon' 당첨 시 reward_grants에 pending만 기록(실발급 없음) —
 *    카페24 mall.write_promotion / mall.write_mileage scope 재동의 후 개방.
 * ============================================================================ */

const crypto = require('crypto');

// ── 안전 기본값 (cfgGet('mall_game_config') 없거나 오염 시 폴백)
//    지시 #148(대표 확정): 꽝 없음(0%) 확정 — lose 제거. weight는 임시값(실확률은 오픈 전 대표 확정·운영 화면 편집이 최종).
const DEFAULT_CONFIG = Object.freeze({
    probabilities: [
        { key: 'box',      label: '제주 감귤 1박스',   points: 0,   weight: 1 },
        { key: 'upgrade',  label: '업그레이드 이용권', points: 0,   weight: 4 },
        { key: 'coupon10', label: '10% 할인 쿠폰',     points: 0,   weight: 10 },
        { key: 'coupon5',  label: '5% 할인 쿠폰',      points: 0,   weight: 25 },
        { key: 'w50',      label: '물방울 +50',        points: 50,  weight: 30 },
        { key: 'w100',     label: '물방울 +100',       points: 100, weight: 30 }
    ],
    water_cost: 10,
    level_thresholds: [0, 5, 15, 30, 50],
    daily_spin_limit: 1,            // ⚠️ 스키마상 1 고정 (상단 대표 확인 4번)
    physical_monthly_limit: 30
});

const MAX_POINT_AMOUNT = 100000;    // 1회 earn/redeem 상한 — 🔴 대표 확인 필요
const RATE_PER_MIN = 120;           // IP당 분당 요청 상한 (프로토타입)

// ── KST 시간 유틸 (서버는 UTC — spin_date/month_key는 반드시 KST 기준) ──
function kstShifted() { return new Date(Date.now() + 9 * 3600 * 1000); } // getUTC* == KST
function pad2(n) { return String(n).padStart(2, '0'); }
function kstDateStr() {
    const k = kstShifted();
    return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())}`;
}
function kstMonthKey() {
    const k = kstShifted();
    return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}`;
}
function kstNextMidnightISO() { // 다음 KST 자정을 UTC ISO로 (룰렛 다음 참여 가능 시각)
    const k = kstShifted();
    const utcMs = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + 1, 0, 0, 0) - 9 * 3600 * 1000;
    return new Date(utcMs).toISOString();
}

// ── 입력 검증 ──
const MEMBER_KEY_RE = /^[A-Za-z0-9_\-:@.]{3,100}$/;   // 카페24 member_id 형태 가정
const IDEM_KEY_RE = /^[A-Za-z0-9_\-:.]{1,100}$/;      // 접두사 붙여도 120 이내
function badReq(msg) { const e = new Error(msg); e.status = 400; return e; }
function checkMemberKey(v) {
    if (typeof v !== 'string' || !MEMBER_KEY_RE.test(v)) throw badReq('member_key 형식 오류(3~100자 영숫자·_-:@.)');
    return v;
}
function checkIdemKey(v) {
    if (typeof v !== 'string' || !IDEM_KEY_RE.test(v)) throw badReq('idem_key 필수(1~100자 영숫자·_-:.)');
    return v;
}
function checkAmount(v) { // [A3] 방어: 정수·양수·상한. 부호/한도는 서버가 최종 결정
    const n = typeof v === 'string' ? Number(v) : v;
    if (!Number.isInteger(n) || n < 1 || n > MAX_POINT_AMOUNT) throw badReq(`amount는 1~${MAX_POINT_AMOUNT} 정수`);
    return n;
}
function checkReason(v) {
    if (v == null) return null;
    if (typeof v !== 'string' || v.length > 100) throw badReq('reason은 100자 이내 문자열');
    return v;
}

// ── 설정 검증 [A7] — 오염 시 필드 단위 기본값 폴백 ──
function normalizeConfig(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const cfg = {};
    const probsOk = Array.isArray(src.probabilities) && src.probabilities.length > 0 &&
        src.probabilities.every(p => p && typeof p.key === 'string' &&
            Number.isFinite(Number(p.weight)) && Number(p.weight) > 0 &&
            Number.isInteger(Number(p.points)) && Number(p.points) >= 0);
    cfg.probabilities = probsOk
        ? src.probabilities.map(p => ({
            key: String(p.key).slice(0, 30),
            label: String(p.label || p.key).slice(0, 50),
            points: Number(p.points),
            weight: Number(p.weight)
        }))
        : DEFAULT_CONFIG.probabilities;
    cfg.water_cost = (Number.isInteger(src.water_cost) && src.water_cost > 0 && src.water_cost <= MAX_POINT_AMOUNT)
        ? src.water_cost : DEFAULT_CONFIG.water_cost;
    const thOk = Array.isArray(src.level_thresholds) && src.level_thresholds.length > 0 &&
        src.level_thresholds.every((t, i, a) => Number.isInteger(t) && t >= 0 && (i === 0 || t > a[i - 1]));
    cfg.level_thresholds = thOk ? src.level_thresholds : DEFAULT_CONFIG.level_thresholds;
    cfg.daily_spin_limit = 1; // 스키마 고정 (대표 확인 4번)
    cfg.physical_monthly_limit = (Number.isInteger(src.physical_monthly_limit) && src.physical_monthly_limit >= 0)
        ? src.physical_monthly_limit : DEFAULT_CONFIG.physical_monthly_limit;
    return cfg;
}

// ── 가중치 추첨 — Math.random() 지양(시드 예측 여지) → crypto 기반 ──
function weightedDraw(probs) {
    const total = probs.reduce((s, p) => s + p.weight, 0);
    let r = (crypto.randomInt(1e9) / 1e9) * total;
    for (const p of probs) { r -= p.weight; if (r < 0) return p; }
    return probs[probs.length - 1]; // 부동소수 잔여 방어
}

// ── 레벨 산출: thresholds 중 water_count 이상 통과한 개수 (최소 1) ──
function calcLevel(thresholds, waterCount) {
    let lvl = 0;
    for (const t of thresholds) { if (waterCount >= t) lvl++; else break; }
    return Math.max(1, lvl);
}

// ── 토큰 비교 (타이밍 공격 방어) ──
function safeEqual(a, b) {
    const A = Buffer.from(String(a)), B = Buffer.from(String(b));
    if (A.length !== B.length) return false;
    return crypto.timingSafeEqual(A, B);
}

// ── PG 오류 판별: 23505(UNIQUE 위반)를 제약별로 구분 [함정 3] ──
function isUniqueViolation(err, constraintIncludes) {
    if (!err || err.code !== '23505') return false;
    if (!constraintIncludes) return true;
    return String(err.constraint || err.detail || '').includes(constraintIncludes);
}

// ============================================================================
function createMallRouter({ pool, express, cfgGet, cfgSet, writeAudit, cafe24, notify }) {
    if (!pool || !express || typeof cfgGet !== 'function' || typeof writeAudit !== 'function') {
        throw new Error('createMallRouter: pool/express/cfgGet/writeAudit 주입 필수');
    }
    void cfgSet; // 계약상 주입받지만 이 모듈은 설정을 쓰지 않음(메인 담당)

    const router = express.Router();
    router.use(express.json({ limit: '50kb' })); // 메인 앱에 이미 있어도 무해(중복 파싱 안전)

    // ════════════════════════════════════════════════════════════
    // 0. 공개 게임 API (#256 — 대표 (a)안 승인 2026-08-07)
    //    스킨(akkome.cafe24.com/akkome.com)에서 직접 호출 — 무토큰.
    //    신뢰 모델: member_id 사칭은 가능하나 실익 차단 — 티켓·후기 지급은 "카페24 실주문 대사"로 상한,
    //    가입 +5·출석 +1은 소액(콘텐츠 재미 수준). 게이트 = DB 스위치 cfg 'mall_pub' {on:true}.
    //    ⚠️ 이 섹션은 전역 게이트(토큰)보다 앞에 있어야 한다.
    // ════════════════════════════════════════════════════════════
    const PUB_ORIGINS = ['https://akkome.cafe24.com', 'https://akkome.com', 'https://www.akkome.com'];
    const pubRl = new Map();
    router.use('/pub', (req, res, next) => {
        const org = String(req.headers.origin || '');
        if (PUB_ORIGINS.indexOf(org) !== -1) {
            res.set('Access-Control-Allow-Origin', org);
            res.set('Vary', 'Origin');
            res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
            res.set('Access-Control-Allow-Headers', 'Content-Type');
        }
        if (req.method === 'OPTIONS') return res.status(204).end();
        // 레이트리밋 (인메모리)
        const now = Date.now();
        const ip = req.ip || req.socket?.remoteAddress || '?';
        let b = pubRl.get(ip);
        if (!b || now > b.reset) { b = { n: 0, reset: now + 60000 }; pubRl.set(ip, b); }
        if (++b.n > 120) return res.status(429).json({ error: '요청이 너무 잦습니다' });
        if (pubRl.size > 5000) { for (const [k, v] of pubRl) if (now > v.reset) pubRl.delete(k); }
        next();
    });
    const pubGate = async (req, res, next) => {
        try {
            const sw = await cfgGet('mall_pub');
            if (!sw || sw.on !== true) return res.status(503).json({ error: '준비 중' });
            next();
        } catch (e) { res.status(503).json({ error: '준비 중' }); }
    };
    const pubWrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(err => {
        const status = (err && err.status) || 500;
        if (status >= 500) console.error('[mall-pub] 오류:', err && err.message);
        res.status(status).json({ error: status >= 500 ? '서버 오류' : (err.message || '오류') });
    });

    // ── 주문 대사: 카페24 실주문 수(최근 180일·배송 계열 상태) — 60초 캐시 ──
    const orderCntCache = new Map();   // member_key → {n, at}
    // #277: statuses 파라미터화 — 룰렛권은 배송완료(N40)만, 후기 상한은 종전(입금완료~배송완료) 그대로.
    async function countPaidOrders(memberKey, statuses) {
        const ST = statuses || 'N10,N20,N21,N22,N30,N40';
        if (!cafe24 || typeof cafe24.apiGet !== 'function') return 0;
        const ck = memberKey + '|' + ST;
        const c = orderCntCache.get(ck);
        if (c && Date.now() - c.at < 60000) return c.n;
        let total = 0;
        const now = new Date(Date.now() + 9 * 3600 * 1000);
        const fmt = d => d.toISOString().slice(0, 10);
        for (let seg = 0; seg < 2; seg++) {
            const end = new Date(now.getTime() - seg * 90 * 86400000);
            const start = new Date(end.getTime() - 89 * 86400000);
            try {
                const r = await cafe24.apiGet('/api/v2/admin/orders/count', {
                    start_date: fmt(start), end_date: fmt(end), member_id: memberKey,
                    order_status: ST,
                });
                total += Number(r && r.count) || 0;
            } catch (e) { /* 구간 실패 = 그 구간 0 (부분 성공) */ }
        }
        orderCntCache.set(ck, { n: total, at: Date.now() });
        if (orderCntCache.size > 2000) orderCntCache.clear();
        return total;
    }
    // #277(대표 확정): 룰렛 이용권 = 배송완료 주문 수. 배송 전/취소·반품 건은 티켓이 생기지 않는다.
    const countDeliveredOrders = (memberKey) => countPaidOrders(memberKey, 'N40');
    async function ledgerCountByReason(memberId, reasonPrefix) {
        const r = await pool.query(
            `SELECT COUNT(*)::int AS n FROM points_ledger WHERE member_id=$1 AND reason LIKE $2`,
            [memberId, reasonPrefix + '%']);
        return r.rows[0].n;
    }
    async function currentBalance(memberId) {
        const r = await pool.query(
            `SELECT balance_after FROM points_ledger WHERE member_id=$1 ORDER BY id DESC LIMIT 1`, [memberId]);
        return r.rows.length ? Number(r.rows[0].balance_after) : 0;
    }
    // 지급 공통 (idem — 재클릭·재로드 무해)
    async function pubGrant(member, delta, reason, idemKey) {
        const prior = await findLedgerByIdem(idemKey);
        if (prior) return { replayed: true, balance: Number(prior.balance_after) };
        try {
            const out = await withTx(async (client) => {
                await lockMember(client, member.id);
                return insertLedger(client, { memberId: member.id, delta, reason, refType: 'pub', refId: null, idemKey });
            });
            return { replayed: false, balance: Number(out.balance_after) };
        } catch (err) {
            if (isUniqueViolation(err, 'idem')) {
                const again = await findLedgerByIdem(idemKey);
                if (again) return { replayed: true, balance: Number(again.balance_after) };
            }
            throw err;
        }
    }
    function pubMid(v) {
        const s = String(v || '').trim();
        if (!s || s.length > 40 || /[^A-Za-z0-9_@.\-]/.test(s)) { const e = new Error('잘못된 회원 식별자'); e.status = 400; throw e; }
        return s;
    }

    // 지갑 종합 (자동 회원 생성)
    router.get('/pub/wallet', pubGate, pubWrap(async (req, res) => {
        const mid = pubMid(req.query.mid);
        const member = await resolveMember(mid, null);
        const [balance, tree, orders, spins, reviews, attend, delivered] = await Promise.all([
            currentBalance(member.id),
            pool.query(`SELECT water_count FROM tree_state WHERE member_id=$1`, [member.id]),
            countPaidOrders(mid),
            pool.query(`SELECT COUNT(*)::int AS n FROM roulette_spins WHERE member_id=$1`, [member.id]),
            ledgerCountByReason(member.id, '후기 물방울'),
            pool.query(`SELECT 1 FROM points_ledger WHERE member_id=$1 AND reason='출석 체크' AND idem_key=$2`,
                [member.id, 'attend:' + member.id + ':' + kstDateStr()]),
            countDeliveredOrders(mid),   // #277: 룰렛권 = 배송완료 기준
        ]);
        const joined = !!(await findLedgerByIdem('join:' + member.id));
        res.json({
            water: balance,
            given: tree.rows.length ? Number(tree.rows[0].water_count) : 0,
            goal: (await loadConfig()).level_thresholds.slice(-1)[0] || 100,
            tickets: Math.max(0, delivered - spins.rows[0].n),   // #277: 배송완료 1건당 1회
            delivered,
            review_left: Math.max(0, orders - reviews),
            attend_today: attend.rows.length > 0,
            join_bonus: joined,
        });
    }));

    // 가입 혜택 +5 (1회)
    router.post('/pub/join-bonus', pubGate, pubWrap(async (req, res) => {
        const mid = pubMid((req.body || {}).mid);
        const member = await resolveMember(mid, null);
        const out = await pubGrant(member, 5, '회원가입 혜택', 'join:' + member.id);
        if (!out.replayed) await audit('grant', 'mall_member', member.id, { kind: 'join-bonus', delta: 5 });
        res.json({ ok: true, replayed: out.replayed, balance: out.balance });
    }));

    // 출석 +1 (KST 1일 1회)
    router.post('/pub/attend', pubGate, pubWrap(async (req, res) => {
        const mid = pubMid((req.body || {}).mid);
        const member = await resolveMember(mid, null);
        const out = await pubGrant(member, 1, '출석 체크', 'attend:' + member.id + ':' + kstDateStr());
        res.json({ ok: true, replayed: out.replayed, balance: out.balance });
    }));

    // 후기 실작성 수 — 카페24 상품후기 게시판(board 4) 대조. #259(대표): 후기를 실제로 써야 지급.
    //   scope mall.read_community 미개통이면 null 반환 → 검증 생략(주문 상한만 — 재동의 전 폴백).
    const reviewCntCache = new Map();
    async function countReviews(memberKey) {
        if (!cafe24 || typeof cafe24.apiGet !== 'function') return null;
        const c = reviewCntCache.get(memberKey);
        if (c && Date.now() - c.at < 30000) return c.n;
        try {
            const r = await cafe24.apiGet('/api/v2/admin/boards/4/articles', { member_id: memberKey, limit: 100 });
            const arr = (r && r.articles) || [];
            // member_id 파라미터가 무시될 가능성 방어: 응답에 작성자 필드가 있으면 그걸로 대조, 없으면 파라미터 필터를 신뢰
            const hasIdField = arr.some(a => a.member_id != null || a.writer_id != null);
            const n = hasIdField
                ? arr.filter(a => String(a.member_id || '') === memberKey || String(a.writer_id || '') === memberKey).length
                : arr.length;
            reviewCntCache.set(memberKey, { n, at: Date.now() });
            return n;
        } catch (e) { return null; }
    }

    // 후기 물방울 +1 — 대표 확정(#259): 사진 무관·주문 1건당 1회·"실제 후기 작성" 확인 후 지급
    router.post('/pub/review-claim', pubGate, pubWrap(async (req, res) => {
        const mid = pubMid((req.body || {}).mid);
        const member = await resolveMember(mid, null);
        const orders = await countPaidOrders(mid);
        const claimed = await ledgerCountByReason(member.id, '후기 물방울');
        if (claimed >= orders) return res.status(403).json({ error: '지급 가능한 후기 횟수를 모두 받았어요 (주문 1건당 1회)' });
        const reviews = await countReviews(mid);
        if (reviews !== null && claimed >= reviews) {
            return res.status(403).json({ error: '후기를 먼저 작성해 주세요 🍊 작성 후 이 버튼을 누르면 물방울 1개를 드려요!' });
        }
        const out = await pubGrant(member, 1, '후기 물방울', 'review:' + member.id + ':' + (claimed + 1));
        res.json({ ok: true, replayed: out.replayed, balance: out.balance, review_left: Math.max(0, orders - claimed - 1) });
    }));

    // 나무 물주기 −1 (+수확 알림)
    router.post('/pub/tree-water', pubGate, pubWrap(async (req, res) => {
        const mid = pubMid((req.body || {}).mid);
        const idem = 'pubwater:' + checkIdemKey(String((req.body || {}).idem_key || ''));
        const cfg = await loadConfig();
        const member = await resolveMember(mid, null);
        const prior = await findLedgerByIdem(idem);
        if (prior) {
            const t = await pool.query(`SELECT water_count FROM tree_state WHERE member_id=$1`, [member.id]);
            return res.json({ ok: true, replayed: true, balance: Number(prior.balance_after), given: t.rows[0]?.water_count ?? 0 });
        }
        const out = await withTx(async (client) => {
            await lockMember(client, member.id);
            const ledger = await insertLedger(client, { memberId: member.id, delta: -cfg.water_cost, reason: '나무 물주기', refType: 'tree', refId: null, idemKey: idem });
            const up = await client.query(
                `INSERT INTO tree_state (member_id, water_count, level, updated_at) VALUES ($1, 1, 1, now())
                 ON CONFLICT (member_id) DO UPDATE SET water_count = tree_state.water_count + 1, updated_at = now()
                 RETURNING water_count`, [member.id]);
            return { ledger, waterCount: Number(up.rows[0].water_count) };
        });
        const goal = cfg.level_thresholds.slice(-1)[0] || 100;
        if (out.waterCount === goal && typeof notify === 'function') {
            notify(`🌳 [귤나무 수확!] 회원 ${mid} — 물 ${goal}개 달성. **지금 제일 싱싱한 제철 귤 4.5kg** 발송 안내 필요(배송지 확인)`);
        }
        res.json({ ok: true, replayed: false, balance: Number(out.ledger.balance_after), given: out.waterCount });
    }));

    // 룰렛 — 티켓(실주문 대사) 검증 → 서버 추첨 → 지급/기록
    router.post('/pub/spin', pubGate, pubWrap(async (req, res) => {
        const mid = pubMid((req.body || {}).mid);
        const cfg = await loadConfig();
        const member = await resolveMember(mid, null);
        const orders = await countDeliveredOrders(mid);   // #277: 배송완료 기준
        const used = await pool.query(`SELECT COUNT(*)::int AS n FROM roulette_spins WHERE member_id=$1`, [member.id]);
        if (used.rows[0].n >= orders) return res.status(403).json({ error: '룰렛 이용권이 없어요 — 배송이 완료되면 1건당 1번 드려요 🍊' });
        const out = await withTx(async (client) => {
            await lockMember(client, member.id);
            const prize = weightedDraw(cfg.probabilities);
            const ins = await client.query(
                `INSERT INTO roulette_spins (member_id, spin_date, result_key, points) VALUES ($1,$2,$3,$4) RETURNING id`,
                [member.id, kstDateStr(), prize.key, prize.points]);
            const spinId = ins.rows[0].id;
            let ledger = null;
            if (prize.points > 0) {
                ledger = await insertLedger(client, {
                    memberId: member.id, delta: prize.points,
                    reason: `룰렛 당첨(${prize.label})`, refType: 'roulette', refId: String(spinId), idemKey: 'spin:' + spinId });
            }
            if (/^coupon/.test(prize.key) || prize.key === 'box' || prize.key === 'upgrade') {
                await client.query(
                    `INSERT INTO reward_grants (member_id, kind, amount, status, month_key, idem_key)
                     VALUES ($1,$4,1,'pending',$2,$3) ON CONFLICT (idem_key) DO NOTHING`,
                    [member.id, kstMonthKey(), 'spin-' + prize.key + ':' + spinId, prize.key]);
            }
            return { spinId, prize, ledger };
        });
        if (/^coupon/.test(out.prize.key) || out.prize.key === 'box' || out.prize.key === 'upgrade') {
            if (typeof notify === 'function') notify(`🎡 [룰렛 실물 당첨] 회원 ${mid} — ${out.prize.label} (수동 발급 필요 · 데이터관리 게임 운영 참조)`);
        }
        await audit('create', 'roulette_spin', out.spinId, { member_id: member.id, result: out.prize.key, pub: true });
        res.json({
            ok: true, result: { key: out.prize.key, label: out.prize.label, points: out.prize.points },
            balance: out.ledger ? Number(out.ledger.balance_after) : (await currentBalance(member.id)),
            tickets: Math.max(0, orders - used.rows[0].n - 1),
        });
    }));

    // ── 전역 게이트 ──────────────────────────────────────────────
    // 🔴 프로토타입 인증: 단일 서버 토큰 — member_key 신원 위조는 못 막음.
    //    회원별 위조 방지(카페24 로그인 연동 서명 등)는 "대표 확인 필요".
    const rl = new Map(); // ip → {n, reset}  [A6]
    router.use((req, res, next) => {
        if (process.env.MALL_API !== 'on') return res.status(503).json({ error: '준비 중' });
        const token = process.env.MALL_API_TOKEN;
        if (!token) return res.status(503).json({ error: '준비 중' }); // 토큰 미설정 = 미개방
        const auth = String(req.headers['authorization'] || '');
        const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (!bearer || !safeEqual(bearer, token)) return res.status(401).json({ error: '인증 실패' });
        // QA D4: 전역 json 파서(15mb)가 라우터 레벨 한도보다 먼저 돌므로 게이트에서 바디 크기 직접 상한 (외부 노출 API 방어)
        if (Number(req.headers['content-length'] || 0) > 51200) return res.status(413).json({ error: '요청이 너무 큽니다' });
        // 레이트리밋 (인메모리 — 단일 인스턴스 전제, 프로토타입)
        const now = Date.now();
        const ip = req.ip || req.socket?.remoteAddress || '?';
        let b = rl.get(ip);
        if (!b || now > b.reset) { b = { n: 0, reset: now + 60000 }; rl.set(ip, b); }
        if (++b.n > RATE_PER_MIN) return res.status(429).json({ error: '요청이 너무 잦습니다' });
        if (rl.size > 5000) { for (const [k, v] of rl) if (now > v.reset) rl.delete(k); } // 팽창 방어
        next();
    });

    // ── 공통 헬퍼 ────────────────────────────────────────────────
    const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(err => {
        const status = (err && err.status) || 500;
        if (status >= 500) console.error('[mall-api] 오류:', err && err.message); // 스택·시크릿 응답 미노출
        res.status(status).json({ error: status >= 500 ? '서버 오류' : (err.message || '오류') });
    });

    async function audit(action, targetType, targetId, changes) {
        // 시크릿·연락처 원문 로그 금지 — changes는 호출부에서 마스킹된 값만 전달
        try { await writeAudit({ action, targetType, targetId, changes, source: 'mall-api', actor: null }); }
        catch (_) { /* 감사 실패가 본 처리를 막지 않음 (메인 writeAudit도 자체 catch) */ }
    }

    async function loadConfig() {
        let raw = null;
        try { raw = await cfgGet('mall_game_config'); } catch (_) { /* 폴백 */ }
        return normalizeConfig(raw);
    }

    // 회원 조회 (없으면 404 — 자동 생성은 resolve/spin만)
    async function getMember(memberKey) {
        const r = await pool.query(
            `SELECT id, member_key, nickname, deleted_at FROM mall_members WHERE member_key=$1`, [memberKey]);
        if (!r.rows.length) { const e = new Error('회원 없음 — POST /members/resolve 먼저'); e.status = 404; throw e; }
        const m = r.rows[0];
        if (m.deleted_at) { const e = new Error('사용할 수 없는 회원입니다'); e.status = 403; throw e; }
        return m;
    }

    // upsert 회원 (resolve·spin 공용). deleted 회원은 부활시키지 않음 → 403
    async function resolveMember(memberKey, nickname) {
        const nick = (typeof nickname === 'string' && nickname.trim()) ? nickname.trim().slice(0, 50) : null;
        const r = await pool.query(
            `INSERT INTO mall_members (member_key, nickname) VALUES ($1, $2)
             ON CONFLICT (member_key) DO UPDATE SET nickname = COALESCE(EXCLUDED.nickname, mall_members.nickname)
             RETURNING id, member_key, nickname, created_at, deleted_at,
                       (xmax = 0) AS is_new`,   // xmax=0 → 신규 INSERT 판별
            [memberKey, nick]);
        const m = r.rows[0];
        if (m.deleted_at) { const e = new Error('사용할 수 없는 회원입니다'); e.status = 403; throw e; }
        return m;
    }

    // ── 동시성 핵심: 회원 행 FOR UPDATE = 회원별 잔액 변동 직렬화 앵커 ──
    // 방식 선택 이유(주석 요구사항): "원장 마지막 행 잠금"은 첫 거래(행 없음)에
    // 잠글 대상이 없어 레이스 구멍이 생김. mall_members 행은 항상 존재하므로
    // FOR UPDATE로 잡으면 그 회원의 모든 잔액 변동이 완전 직렬화된다. [A4]
    async function lockMember(client, memberId) {
        const r = await client.query(
            `SELECT id, deleted_at FROM mall_members WHERE id=$1 FOR UPDATE`, [memberId]);
        if (!r.rows.length) { const e = new Error('회원 없음'); e.status = 404; throw e; }
        if (r.rows[0].deleted_at) { const e = new Error('사용할 수 없는 회원입니다'); e.status = 403; throw e; }
    }

    // 원장 append (호출부가 lockMember 선행 필수). 음수 잔액 절대 불가.
    async function insertLedger(client, { memberId, delta, reason, refType, refId, idemKey }) {
        const prev = await client.query(
            `SELECT balance_after FROM points_ledger WHERE member_id=$1 ORDER BY id DESC LIMIT 1`, [memberId]);
        const before = prev.rows.length ? Number(prev.rows[0].balance_after) : 0;
        const after = before + delta;
        if (after < 0) { const e = new Error(`잔액 부족 (보유 ${before})`); e.status = 400; throw e; }
        const r = await client.query(
            `INSERT INTO points_ledger (member_id, delta, balance_after, reason, ref_type, ref_id, idem_key)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING id, delta, balance_after, reason, created_at`,
            [memberId, delta, after, reason, refType, refId, idemKey]);
        return r.rows[0];
    }

    async function findLedgerByIdem(idemKey) {
        const r = await pool.query(
            `SELECT id, member_id, delta, balance_after, reason, created_at FROM points_ledger WHERE idem_key=$1`,
            [idemKey]);
        return r.rows[0] || null;
    }

    // idem 재생 응답 [A2]: 같은 회원이면 200 + 기존 결과, 타 회원 충돌은 409
    function replayOr409(res, prior, memberId) {
        if (prior.member_id !== memberId) {
            return res.status(409).json({ error: 'idem_key가 다른 처리에 이미 사용됨' });
        }
        return res.json({
            ok: true, replayed: true,
            ledger_id: prior.id, delta: prior.delta, balance: Number(prior.balance_after),
            created_at: prior.created_at
        });
    }

    // 트랜잭션 래퍼 — 실패 시 전체 ROLLBACK + release 보장 [함정 5]
    async function withTx(fn) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const out = await fn(client);
            await client.query('COMMIT');
            return out;
        } catch (err) {
            try { await client.query('ROLLBACK'); } catch (_) { /* 이미 끊긴 커넥션 등 */ }
            throw err;
        } finally {
            client.release();
        }
    }

    // ════════════════════════════════════════════════════════════
    // 2. 회원
    // ════════════════════════════════════════════════════════════
    router.post('/members/resolve', wrap(async (req, res) => {
        const { member_key, nickname } = req.body || {};
        checkMemberKey(member_key);
        const m = await resolveMember(member_key, nickname);
        if (m.is_new) await audit('create', 'mall_member', m.id, { member_key });
        res.json({ id: m.id, member_key: m.member_key, nickname: m.nickname, created_at: m.created_at });
    }));

    // ════════════════════════════════════════════════════════════
    // 3. 룰렛
    // ════════════════════════════════════════════════════════════
    // 1일 1회의 진짜 보장 = roulette_spins UNIQUE(member_id, spin_date). [A1]
    // 클라 idem_key는 형식 검증만 하고 원장 idem은 스펙대로 'spin:'+spin행id
    // (spin행이 곧 멱등 앵커 — 재시도는 daily UNIQUE에 걸려 409 + 기존 결과 반환).
    router.post('/roulette/spin', wrap(async (req, res) => {
        const { member_key, idem_key } = req.body || {};
        checkMemberKey(member_key);
        checkIdemKey(idem_key);
        const cfg = await loadConfig();
        const member = await resolveMember(member_key, null);
        const today = kstDateStr(); // [함정 1] KST 날짜 — UTC 금지

        const out = await withTx(async (client) => {
            await lockMember(client, member.id); // [함정 2] 잔액 직렬화
            const prize = weightedDraw(cfg.probabilities);
            /* #256: UNIQUE(member,spin_date) 제약은 "주문 1건당 1회" 정책으로 제거됨(마이그레이션) —
               이 구(토큰) 라우트의 1일 1회는 사전 SELECT로 유지(레거시 호환·미가동 경로) */
            const dup = await client.query(
                `SELECT 1 FROM roulette_spins WHERE member_id=$1 AND spin_date=$2 LIMIT 1`, [member.id, today]);
            if (dup.rows.length) return { already: true };
            const ins = await client.query(
                `INSERT INTO roulette_spins (member_id, spin_date, result_key, points)
                 VALUES ($1,$2,$3,$4)
                 RETURNING id`,
                [member.id, today, prize.key, prize.points]);
            const spinId = ins.rows[0].id;
            let ledger = null;
            if (prize.points > 0) {
                ledger = await insertLedger(client, {
                    memberId: member.id, delta: prize.points,
                    reason: `룰렛 당첨(${prize.label})`, refType: 'roulette', refId: String(spinId),
                    idemKey: 'spin:' + spinId
                });
            }
            if (/^coupon/.test(prize.key) || prize.key === 'box' || prize.key === 'upgrade') {
                // 실발급 아님 — pending 기록만 (개방은 카페24 scope 재동의 후, 대표 확인 5번). #148: 실물성 경품(box·upgrade·쿠폰 등급) 전부 원장 기록.
                await client.query(
                    `INSERT INTO reward_grants (member_id, kind, amount, status, month_key, idem_key)
                     VALUES ($1,$4,1,'pending',$2,$3)
                     ON CONFLICT (idem_key) DO NOTHING`,
                    [member.id, kstMonthKey(), 'spin-' + prize.key + ':' + spinId, prize.key]);
            }
            return { spinId, prize, ledger };
        });

        if (out.already) {
            const cur = await pool.query(
                `SELECT result_key, points, created_at FROM roulette_spins WHERE member_id=$1 AND spin_date=$2`,
                [member.id, today]);
            return res.status(409).json({
                error: '오늘 이미 참여했습니다',
                today: cur.rows[0] || null,
                next_available_at: kstNextMidnightISO()
            });
        }
        await audit('create', 'roulette_spin', out.spinId,
            { member_id: member.id, result: out.prize.key, points: out.prize.points, date: today });
        res.json({
            ok: true, spin_id: out.spinId, date: today,
            result: { key: out.prize.key, label: out.prize.label, points: out.prize.points },
            balance: out.ledger ? Number(out.ledger.balance_after) : null,
            next_available_at: kstNextMidnightISO()
        });
    }));

    router.get('/roulette/status', wrap(async (req, res) => {
        const memberKey = checkMemberKey(req.query.member_key);
        const member = await getMember(memberKey);
        const today = kstDateStr();
        const r = await pool.query(
            `SELECT result_key, points, created_at FROM roulette_spins WHERE member_id=$1 AND spin_date=$2`,
            [member.id, today]);
        res.json({
            date: today,
            spun_today: r.rows.length > 0,
            today: r.rows[0] || null,
            next_available_at: r.rows.length ? kstNextMidnightISO() : null
        });
    }));

    // ════════════════════════════════════════════════════════════
    // 4. 포인트
    // ════════════════════════════════════════════════════════════
    router.get('/points/balance', wrap(async (req, res) => {
        const member = await getMember(checkMemberKey(req.query.member_key));
        const r = await pool.query(
            `SELECT balance_after FROM points_ledger WHERE member_id=$1 ORDER BY id DESC LIMIT 1`, [member.id]);
        res.json({ member_key: member.member_key, balance: r.rows.length ? Number(r.rows[0].balance_after) : 0 });
    }));

    router.get('/points/ledger', wrap(async (req, res) => {
        const member = await getMember(checkMemberKey(req.query.member_key));
        let limit = Number(req.query.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) limit = 50;
        const r = await pool.query(
            `SELECT id, delta, balance_after, reason, ref_type, ref_id, created_at
             FROM points_ledger WHERE member_id=$1 ORDER BY id DESC LIMIT $2`,
            [member.id, limit]);
        res.json({ member_key: member.member_key, rows: r.rows });
    }));

    // earn/redeem 공용 — kind가 delta 부호를 결정(클라 부호 무시) [A3]
    async function ledgerWrite(req, res, kind) {
        const { member_key, amount, reason, idem_key } = req.body || {};
        checkMemberKey(member_key);
        const amt = checkAmount(amount);
        const rsn = checkReason(reason) || (kind === 'earn' ? '적립' : '사용');
        const idem = kind + ':' + checkIdemKey(idem_key); // 라우트별 접두사 [A2]
        const member = await getMember(member_key);

        // 빠른 재생 경로 (레이스는 아래 23505 처리로 커버)
        const prior = await findLedgerByIdem(idem);
        if (prior) return replayOr409(res, prior, member.id);

        const delta = kind === 'earn' ? amt : -amt;
        let row;
        try {
            row = await withTx(async (client) => {
                await lockMember(client, member.id); // [A4] 직렬화 → 음수 잔액 불가
                return insertLedger(client, {
                    memberId: member.id, delta, reason: rsn,
                    refType: 'api', refId: null, idemKey: idem
                });
            });
        } catch (err) {
            if (isUniqueViolation(err, 'idem')) {        // 동시 재시도 레이스 → 기존 결과 재반환
                const again = await findLedgerByIdem(idem);
                if (again) return replayOr409(res, again, member.id);
            }
            throw err;
        }
        await audit(kind, 'points_ledger', row.id, { member_id: member.id, delta, reason: rsn }); // idem·연락처 등 원문 미기록
        res.json({ ok: true, replayed: false, ledger_id: row.id, delta, balance: Number(row.balance_after) });
    }
    router.post('/points/earn', wrap((req, res) => ledgerWrite(req, res, 'earn')));
    router.post('/points/redeem', wrap((req, res) => ledgerWrite(req, res, 'redeem')));

    // ════════════════════════════════════════════════════════════
    // 5. 나무 키우기
    // ════════════════════════════════════════════════════════════
    router.get('/tree', wrap(async (req, res) => {
        const member = await getMember(checkMemberKey(req.query.member_key));
        const cfg = await loadConfig();
        const r = await pool.query(
            `SELECT level, water_count, updated_at FROM tree_state WHERE member_id=$1`, [member.id]);
        const st = r.rows[0] || { level: 1, water_count: 0, updated_at: null };
        const next = cfg.level_thresholds.find(t => t > st.water_count);
        res.json({
            member_key: member.member_key,
            level: st.level, water_count: st.water_count,
            water_cost: cfg.water_cost,
            next_level_at: next != null ? next : null,   // 최고 레벨이면 null
            level_thresholds: cfg.level_thresholds,
            updated_at: st.updated_at
        });
    }));

    router.post('/tree/water', wrap(async (req, res) => {
        const { member_key, idem_key } = req.body || {};
        checkMemberKey(member_key);
        const idem = 'water:' + checkIdemKey(idem_key);
        const cfg = await loadConfig();
        const member = await getMember(member_key);

        // 재생: 같은 idem이면 물주기 재실행 없이 현재 나무 상태 반환 [A2]
        const prior = await findLedgerByIdem(idem);
        if (prior) {
            if (prior.member_id !== member.id) return res.status(409).json({ error: 'idem_key가 다른 처리에 이미 사용됨' });
            const t = await pool.query(`SELECT level, water_count FROM tree_state WHERE member_id=$1`, [member.id]);
            return res.json({ ok: true, replayed: true, balance: Number(prior.balance_after),
                level: t.rows[0]?.level ?? 1, water_count: t.rows[0]?.water_count ?? 0 });
        }

        let out;
        try {
            out = await withTx(async (client) => {
                await lockMember(client, member.id);
                const ledger = await insertLedger(client, {   // 잔액 부족 시 여기서 400 → 전체 ROLLBACK
                    memberId: member.id, delta: -cfg.water_cost,
                    reason: '나무 물주기', refType: 'tree', refId: null, idemKey: idem
                });
                const up = await client.query(
                    `INSERT INTO tree_state (member_id, water_count, level, updated_at)
                     VALUES ($1, 1, 1, now())
                     ON CONFLICT (member_id) DO UPDATE
                       SET water_count = tree_state.water_count + 1, updated_at = now()
                     RETURNING water_count`,
                    [member.id]);
                const waterCount = Number(up.rows[0].water_count);
                const level = calcLevel(cfg.level_thresholds, waterCount);
                await client.query(`UPDATE tree_state SET level=$1 WHERE member_id=$2`, [level, member.id]);
                return { ledger, waterCount, level };
            });
        } catch (err) {
            if (isUniqueViolation(err, 'idem')) {
                const again = await findLedgerByIdem(idem);
                if (again && again.member_id === member.id) {
                    const t = await pool.query(`SELECT level, water_count FROM tree_state WHERE member_id=$1`, [member.id]);
                    return res.json({ ok: true, replayed: true, balance: Number(again.balance_after),
                        level: t.rows[0]?.level ?? 1, water_count: t.rows[0]?.water_count ?? 0 });
                }
            }
            throw err;
        }
        await audit('water', 'tree_state', member.id,
            { member_id: member.id, cost: cfg.water_cost, water_count: out.waterCount, level: out.level });
        res.json({
            ok: true, replayed: false,
            level: out.level, water_count: out.waterCount,
            balance: Number(out.ledger.balance_after)
        });
    }));

    // ════════════════════════════════════════════════════════════
    // 6. 상품 (읽기 전용 — bot_products, price는 TEXT 원문 그대로)
    // ════════════════════════════════════════════════════════════
    router.get('/products', wrap(async (req, res) => {
        const r = await pool.query(
            `SELECT id, name, price, status FROM bot_products
             WHERE deleted_at IS NULL AND status='판매중' ORDER BY id`);
        res.json({ rows: r.rows });
    }));

    // ════════════════════════════════════════════════════════════
    // 7. 시즌 오픈 대기 신청 (기존 season_waitlist 재사용 — 응답에 연락처 없음)
    // ════════════════════════════════════════════════════════════
    router.post('/season-waitlist', wrap(async (req, res) => {
        const { item, contact, memo } = req.body || {};
        if (typeof item !== 'string' || !item.trim() || item.length > 100) throw badReq('item은 1~100자');
        const digits = String(contact || '').replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 11) throw badReq('연락처는 숫자 10~11자리');
        const memoVal = (typeof memo === 'string' && memo.trim()) ? memo.trim().slice(0, 500) : null;
        // 중복: 직원이 하이픈 포함 저장했을 수 있어 숫자만 비교
        const dup = await pool.query(
            `SELECT id FROM season_waitlist
             WHERE item=$1 AND regexp_replace(contact, '\\D', '', 'g')=$2 AND deleted_at IS NULL`,
            [item.trim(), digits]);
        if (dup.rows.length) return res.status(409).json({ error: '이미 신청된 연락처입니다' });
        const ins = await pool.query(
            `INSERT INTO season_waitlist (item, contact, memo, created_by)
             VALUES ($1,$2,$3,'mall-api') RETURNING id, item, created_at`,
            [item.trim(), digits, memoVal]);
        const row = ins.rows[0];
        // 감사 로그에 연락처 원문 금지 — 마스킹만
        await audit('create', 'season_waitlist', row.id,
            { item: row.item, contact_masked: digits.slice(0, 3) + '****' + digits.slice(-2) });
        res.json({ ok: true, id: row.id, item: row.item, created_at: row.created_at }); // 연락처 미포함
    }));

    // ════════════════════════════════════════════════════════════
    // 8·9. 보상 스텁 (실지급 0건 — 개방 전 501)
    // ════════════════════════════════════════════════════════════
    // 설계 메모: 개방 시 흐름(현재 미구현·주석만) —
    //  ① 카페24 scope 재동의: 쿠폰 = mall.write_promotion, 마일리지 = mall.write_mileage
    //  ② withTx: lockMember → reward_grants INSERT(status 'pending', idem_key
    //     UNIQUE로 멱등) → 카페24 API 성공 시 status 'granted' UPDATE(원장 아님·갱신 허용)
    //  ③ [9] 실물(kind='physical') 월 한도: 당월 합계
    //     SELECT COALESCE(SUM(amount),0) FROM reward_grants
    //      WHERE kind='physical' AND month_key=$당월 AND status<>'canceled'
    //     이 physical_monthly_limit 도달 시 → kind를 'coupon'으로 자동 전환하는 분기.
    const rewardStub = wrap(async (req, res) => {
        // 자리 스텁: 한도 분기 형태만 명시 (실동작 없음)
        // const cfg = await loadConfig();
        // const used = await pool.query(`SELECT COALESCE(SUM(amount),0) AS s FROM reward_grants
        //     WHERE kind='physical' AND month_key=$1 AND status<>'canceled'`, [kstMonthKey()]);
        // const kind = Number(used.rows[0].s) >= cfg.physical_monthly_limit ? 'coupon' : requestedKind;
        res.status(501).json({ error: '카페24 scope 재동의 후 개방 예정' });
    });
    router.post('/rewards/coupon', rewardStub);
    router.post('/rewards/mileage', rewardStub);

    return router;
}

module.exports = { createMallRouter };
