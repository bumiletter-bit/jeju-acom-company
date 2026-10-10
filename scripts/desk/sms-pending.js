// #610-H 직원 몫 문자 뽑기 — 사용: node scripts/desk/sms-pending.js [--all]
//   회사 휴대폰으로 온 문자 가운데 사람이 봐야 하는 대화(상태 staff_needed)만 내준다. --all 이면 봇이 초안만 만들어 둔 대화(draft)도.
//   읽기만(SELECT) · 발송 없음. 문자 답 보내기는 창구가 하지 않는다 — 에이전트 오피스 「문자」 카드에서 사람이 보낸다.
//   🔴 손님 번호 전체·주소는 내지 않는다: tail = 끝 4자리 · masked = 010****1234 꼴 · hint = 주문 한 줄(거래처·발송일·옵션·상태).
//   last_in = 손님 마지막 글 80자(글 속 전화번호 → (번호) · 주소 꼴 → [주소]) · draft = 봇이 만들어 둔 답 초안 앞 200자(있을 때만) · why = 왜 직원 몫인지(마지막 받은 글의 갈래).
const { pool } = require('./_db');
const tail = d => String(d || '').slice(-4);
const masked = d => { d = String(d || ''); return d.length >= 7 ? d.slice(0, 3) + '****' + d.slice(-4) : (d ? '***' + d.slice(-2) : ''); };
// 손님이 글에 적은 주소 꼴 가림 — 「○○시 ○○구 ○○로 12」「○○로 12길 3 101동 202호」
const ADDR_RES = [
    new RegExp('(?:[가-힣]{2,5}(?:특별자치도|특별자치시|특별시|광역시|도)\\s*)?[가-힣]{1,5}(?:시|군|구)\\s+[가-힣0-9\\s]{0,24}?[가-힣0-9]+(?:로|길|동|읍|면|리)\\s*\\d+(?:(?:번길|길)\\s*\\d+)?(?:[-~]\\d+)?(?:\\s*번지)?(?!\\d|\\s*(?:일|시|개|분|번째|kg|박스|상자|원|차|월|명|과))(?:\\s*,?\\s*[가-힣A-Za-z0-9]{0,12}\\s*\\d+\\s*(?:동|호|층))*', 'g'),
    new RegExp('[가-힣]{2,}(?:로|길)\\s*\\d+(?:(?:번길|길)\\s*\\d+)?(?:-\\d+)?(?!\\d|\\s*(?:일|시|개|분|번째|kg|박스|상자|원|차|월|명|과))(?:\\s*,?\\s*\\d+\\s*(?:동|호|층))*', 'g'),
    /\d+\s*동\s*\d+\s*호/g,
];
const maskText = s => { let t = String(s || '').replace(/\d{2,3}[-\s]?\d{3,4}[-\s]?\d{4}/g, '(번호)'); for (const re of ADDR_RES) t = t.replace(re, '[주소]'); return t.replace(/(\[주소\]\s*)+/g, '[주소] ').trim(); };
const WHY = { claim: '불만·문제 낱말', photo: '사진', ship_q: '배송 물음(규칙·AI 가 답 못 함)', order_q: '주문·변경 물음', other: '그 밖', greeting: '인사', otp: '인증 문자', ad: '광고', carrier: '통신사' };
(async () => {
    const all = process.argv.includes('--all');
    const has = (await pool.query(`SELECT to_regclass('public.sms_threads') IS NOT NULL AS ok`)).rows[0].ok;
    if (!has) { console.log(JSON.stringify({ count: 0, items: [], note: '문자 표(sms_threads)가 아직 없습니다 — 문자 연동이 켜지기 전입니다.' }, null, 2)); await pool.end(); return; }
    const mode = (await pool.query(`SELECT value->>'mode' AS mode, value->>'enabled' AS enabled FROM agent_office_config WHERE key = 'sms_gateway'`)).rows[0] || {};
    const r = await pool.query(`
        SELECT t.id, t.phone_digits, t.status, t.order_hint, LEFT(COALESCE(t.last_in_text, ''), 80) AS last_in, t.has_image,
               to_char(t.last_in_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') AS last_in_at, LEFT(t.draft_text, 200) AS draft, t.draft_kind,
               (SELECT m.bucket FROM sms_messages m WHERE m.thread_id = t.id AND m.direction = 'in' ORDER BY m.id DESC LIMIT 1) AS bucket,
               (SELECT count(*)::int FROM sms_messages m WHERE m.thread_id = t.id AND m.direction = 'in' AND m.created_at > now() - interval '3 days') AS in_3d
          FROM sms_threads t
         WHERE t.status = ANY($1::text[])
         ORDER BY t.last_in_at ASC NULLS LAST, t.id ASC LIMIT 100`, [all ? ['staff_needed', 'draft'] : ['staff_needed']]);
    const items = r.rows.map(x => ({
        id: x.id, tail: tail(x.phone_digits), masked: masked(x.phone_digits), status: x.status, hint: x.order_hint || null,
        last_in: maskText(x.last_in),   // 손님이 글에 적은 전화번호 → (번호) · 주소 꼴 → [주소]
        last_in_at: x.last_in_at, has_image: !!x.has_image, why: WHY[x.bucket] || x.bucket || null, in_3d: x.in_3d,
        draft: x.draft ? maskText(x.draft) : null, draft_kind: x.draft_kind || null,   // 초안은 앞 200자만
    }));
    console.log(JSON.stringify({ count: items.length, staff_needed: items.filter(x => x.status === 'staff_needed').length, draft: items.filter(x => x.status === 'draft').length,
        mode: mode.mode || null, enabled: mode.enabled || null, items }, null, 2));
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });
