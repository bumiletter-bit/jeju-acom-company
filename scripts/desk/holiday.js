// #574(대표 GO 10/7) 창구용 발송휴무일 달력 — 직원이 「10/9 한글날 휴무 세팅해줘」라고 하면 화면에서 등록하는 것과 같은 칸을 채운다.
//   node scripts/desk/holiday.js list [YYYY-MM]                                 그 달(기본 이번 달~다음 달) 등록 내용
//   node scripts/desk/holiday.js preview <YYYY-MM-DD>[~<YYYY-MM-DD>] [--arrive] "사유"   등록 전 미리 보기 — 그 날짜들이 쉬면 안내 문장이 어떻게 나가는지(쓰기 0)
//   node scripts/desk/holiday.js add <YYYY-MM-DD>[~<YYYY-MM-DD>] "사유" <지시 id> [--arrive] [--no-ship=false]
//       발송 쉼은 기본 켜짐 · --arrive = 도착도 안 되는 날(택배가 안 다니는 날) · --no-ship=false = 발송은 되고 도착만 안 됨
//   node scripts/desk/holiday.js off <YYYY-MM-DD>[~<YYYY-MM-DD>] <지시 id>           그 날짜 등록을 끈다(지우지 않고 deleted_at — 되돌릴 수 있음)
//   규칙: 지난 날짜는 등록·해제 못 함 · 한 번에 14일까지 · 사유는 2~40자(안내 문장 「○○ 휴무로 ○요일 발송이에요」의 ○○ 자리에 그대로 들어감 — 「공휴일(…)」 포장은 프로그램이 벗김)
//   저장 = shipping_holidays(화면과 같은 표 · 같은 upsert) · audit_logs(source desk) · 알림톡·봇·자사몰 안내가 바로 바뀐다(캐시 없음).
const path = require('path');
const { pool, ROOT } = require('./_db');
const ss = require(path.join(ROOT, 'shipping-schedule.js'));
const kstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const dow = d => DOW[new Date(d + 'T00:00:00Z').getUTCDay()];
const addDay = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
function range(arg) {
    const m = String(arg || '').match(/^(\d{4}-\d{2}-\d{2})(?:~(\d{4}-\d{2}-\d{2}))?$/); if (!m) throw new Error('날짜는 YYYY-MM-DD 또는 YYYY-MM-DD~YYYY-MM-DD 꼴로');
    const a = m[1], b = m[2] || m[1]; if (b < a) throw new Error('끝 날짜가 시작보다 앞입니다');
    const out = []; for (let d = a; d <= b; d = addDay(d, 1)) out.push(d);
    if (out.length > 14) throw new Error('한 번에 14일까지만 등록할 수 있어요 — 나눠서 올려 주세요');
    return out;
}
async function who(orderId) {
    if (!orderId) throw new Error('지시 id 가 필요합니다(누가 시켰는지 기록)');
    const o = (await pool.query(`SELECT created_by FROM pending_orders WHERE id = $1`, [orderId])).rows[0];
    if (!o) throw new Error('없는 지시입니다');
    return '클코(창구) · ' + (o.created_by || '요청자 미상');
}
async function audit(action, id, changes, actor) {
    await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ($1, 'shipping_holiday', $2, $3, 'desk', $4)`, [action, id, JSON.stringify(changes), actor]).catch(e => console.error('audit 실패(무시):', e.message));
}
async function current(from, to) {
    const r = await pool.query(`SELECT id, to_char(holiday_date,'YYYY-MM-DD') AS d, reason, COALESCE(no_ship,TRUE) AS no_ship, COALESCE(no_arrive,FALSE) AS no_arrive, created_by FROM shipping_holidays WHERE deleted_at IS NULL AND holiday_date BETWEEN $1 AND $2 ORDER BY holiday_date`, [from, to]);
    return r.rows;
}
// 등록 뒤(또는 등록했다고 치고) 그 앞뒤 주문의 안내 문장 — 알림톡·봇과 같은 계산기
async function previewText(days, reason, noShip, noArrive) {
    const all = await pool.query(`SELECT to_char(holiday_date,'YYYY-MM-DD') AS d, reason, COALESCE(no_ship,TRUE) AS no_ship, COALESCE(no_arrive,FALSE) AS no_arrive FROM shipping_holidays WHERE deleted_at IS NULL`);
    const set = new Set(), arr = new Set(), reasons = new Map();
    all.rows.forEach(x => { if (days.includes(x.d)) return; if (x.no_ship) set.add(x.d); if (x.no_arrive) arr.add(x.d); if (x.reason) reasons.set(x.d, x.reason); });
    days.forEach(d => { if (noShip) set.add(d); if (noArrive) arr.add(d); if (reason) reasons.set(d, reason); });
    const at = d => new Date(d + 'T14:00:00+09:00');
    const samples = [addDay(days[0], -1), days[0], days[days.length - 1]];
    return samples.map(d => `${d}(${dow(d)}) 오후 주문 → ${ss.computeShipping(at(d), set, reasons, { arriveOff: arr }).text}`);
}
(async () => {
    const args = process.argv.slice(2); const cmd = args.shift();
    const flag = n => { const i = args.findIndex(a => a === '--' + n || a.startsWith('--' + n + '=')); if (i < 0) return undefined; const v = args[i].includes('=') ? args[i].split('=')[1] : 'true'; args.splice(i, 1); return v; };
    const arrive = flag('arrive') === 'true', noShipFlag = flag('no-ship');
    const noShip = noShipFlag === undefined ? true : noShipFlag !== 'false';
    const today = kstToday();
    if (!cmd || cmd === 'list') {
        const m = /^\d{4}-\d{2}$/.test(args[0] || '') ? args[0] : null;
        const from = m ? m + '-01' : today, to = m ? addDay(m + '-01', 45).slice(0, 7) + '-01' : addDay(today, 60);
        const rows = await current(from, to);
        console.log(JSON.stringify({ from, to, count: rows.length, days: rows.map(x => ({ date: x.d + '(' + dow(x.d) + ')', reason: x.reason, no_ship: x.no_ship, no_arrive: x.no_arrive, by: x.created_by })) }, null, 1));
    } else if (cmd === 'preview') {
        const days = range(args[0]), reason = String(args.slice(1).join(' ')).trim();
        console.log(JSON.stringify({ days: days.map(d => d + '(' + dow(d) + ')'), no_ship: noShip, no_arrive: arrive, reason, guide: await previewText(days, reason, noShip, arrive), note: '등록 전 미리 보기 — 아직 아무것도 바꾸지 않았어요' }, null, 1));
    } else if (cmd === 'add') {
        const days = range(args[0]); const orderId = parseInt(args[args.length - 1], 10); const reason = String(args.slice(1, -1).join(' ')).replace(/\s+/g, ' ').trim();
        if (!orderId) throw new Error('사용: holiday.js add <날짜> "사유" <지시 id> [--arrive]');
        if (reason.length < 2 || reason.length > 40) throw new Error('사유는 2~40자(예: 한글날 · 추석 연휴 · 택배사 휴무)');
        if (/[\r\n]/.test(reason) || /01\d[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(reason)) throw new Error('사유에는 줄바꿈·전화번호를 넣지 않아요');
        if (days[0] < today) throw new Error(`지난 날짜(${days[0]})는 등록할 수 없어요`);
        if (days[0] > addDay(today, 90)) throw new Error('90일 넘게 먼 날짜예요 — 날짜를 다시 확인해 주세요');
        if (!noShip && !arrive) throw new Error('발송 쉼·도착 쉼 둘 다 아니면 등록할 것이 없어요');
        const actor = await who(orderId);
        const before = await current(days[0], days[days.length - 1]);
        const out = [];
        for (const d of days) {
            const r = await pool.query(`INSERT INTO shipping_holidays (holiday_date, reason, no_ship, no_arrive, created_by) VALUES ($1,$2,$3,$4,$5)
                ON CONFLICT (holiday_date) DO UPDATE SET deleted_at = NULL, reason = EXCLUDED.reason, no_ship = EXCLUDED.no_ship, no_arrive = EXCLUDED.no_arrive, created_by = EXCLUDED.created_by
                RETURNING id, to_char(holiday_date,'YYYY-MM-DD') AS d`, [d, reason, noShip, arrive, actor]);
            out.push(r.rows[0]);
        }
        for (const x of out) await audit(before.some(b => b.d === x.d) ? 'update' : 'create', x.id, { before: before.find(b => b.d === x.d) || null, after: { date: x.d, reason, no_ship: noShip, no_arrive: arrive }, order_id: orderId }, actor);
        console.log(JSON.stringify({ ok: true, registered: out.map(x => x.d + '(' + dow(x.d) + ')'), reason, no_ship: noShip, no_arrive: arrive, replaced: before.map(b => b.d), guide: await previewText(days, reason, noShip, arrive).catch(() => []), note: '등록했어요 — 알림톡·봇·자사몰 안내가 바로 이 달력을 씁니다' }, null, 1));
    } else if (cmd === 'off') {
        const days = range(args[0]); const orderId = parseInt(args[1], 10); if (!orderId) throw new Error('사용: holiday.js off <날짜> <지시 id>');
        if (days[0] < today) throw new Error(`지난 날짜(${days[0]})는 건드리지 않아요`);
        const actor = await who(orderId);
        const rows = await current(days[0], days[days.length - 1]);
        if (!rows.length) throw new Error('그 날짜에 등록된 휴무가 없어요');
        await pool.query(`UPDATE shipping_holidays SET deleted_at = NOW() WHERE id = ANY($1::int[])`, [rows.map(r => r.id)]);
        for (const r of rows) await audit('delete', r.id, { before: r, order_id: orderId }, actor);
        console.log(JSON.stringify({ ok: true, off: rows.map(r => r.d + '(' + dow(r.d) + ') ' + r.reason), note: '껐어요(지우지 않음 · 다시 add 하면 살아남)' }, null, 1));
    } else throw new Error('사용: holiday.js list [YYYY-MM] | preview <날짜> "사유" [--arrive] | add <날짜> "사유" <지시 id> [--arrive] | off <날짜> <지시 id>');
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });
