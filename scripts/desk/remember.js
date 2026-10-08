// #551(대표 GO 10/6) 창구 「기억해」 — 관리자가 에이전트 오피스에서 「기억해」라고 한 업무 기준을 DB에 적어 두고, 지시마다 get.js 가 함께 내준다.
//   node scripts/desk/remember.js list [--all]              지금 기억하고 있는 것(날짜·누가·글 — 번호 없음 · --all 이면 꺼진 것도)
//   node scripts/desk/remember.js add <지시 id> "기억할 글"   그 지시를 보낸 사람이 대표일 때만 적는다(직원 지시는 거절)
//   node scripts/desk/remember.js off <지시 id> "<글 조각>"   그 글이 든 기억을 끈다(지우지 않고 꺼 둠 · 둘 이상 걸리면 안 끄고 후보를 돌려줌 — 대표 지시일 때만)
//   🔴 번호(n)는 안에서만 쓴다 — 대표 10/8 「기억 번호를 먹이지 말고 기억만으로」: 답·목록·get.js 에 번호를 내지 않는다.
//   저장 = agent_office_config 'desk_memory' { items:[{ n, text, by, at, order_id, off? }] } · 바꿀 때마다 audit_logs.
//   손님 이름·전화·주소, 비밀번호·열쇠 같은 것은 적지 않는다(적으려 하면 거절).
const { pool, audit } = require('./_db');
const KEY = 'desk_memory';
const load = async () => { const r = await pool.query(`SELECT value FROM agent_office_config WHERE key = $1`, [KEY]); const v = r.rows.length ? r.rows[0].value : null; return v && Array.isArray(v.items) ? v : { items: [] }; };
const save = v => pool.query(`INSERT INTO agent_office_config(key, value) VALUES($1, $2::jsonb) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [KEY, JSON.stringify(v)]);
const kst = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
async function adminOf(orderId) {
    const o = (await pool.query(`SELECT o.id, o.created_by, u.role, u.position FROM pending_orders o LEFT JOIN users u ON u.id = o.created_by_id AND u.deleted_at IS NULL WHERE o.id = $1`, [orderId])).rows[0];
    if (!o) throw new Error('없는 지시입니다');
    if (o.role !== 'admin' || o.position !== '대표') throw new Error('기억해 두는 것은 대표 지시일 때만 됩니다(#561) — 이 지시는 대표 계정이 보낸 것이 아닙니다');
    return o;
}
// 지시마다 내줄 목록(켜져 있는 것만 · 최근 것이 뒤) — get.js 가 쓴다. 번호는 안 붙인다(대표 10/8 「번호를 먹이지 말고 기억만으로」 · n 은 안에서만 쓴다)
async function activeList() { const v = await load(); return v.items.filter(x => !x.off).slice(-80).map(x => `(${x.at}) ${x.text}`); }
// 「…잊어」 — 글 조각으로 켜진 기억 하나를 찾는다(하나로 안 정해지면 후보를 돌려줘 창구가 되묻게)
function findByText(v, q) {
    const needle = String(q || '').replace(/\s+/g, '').toLowerCase(); if (!needle) return { hits: [] };
    const on = v.items.filter(x => !x.off);
    let hits = on.filter(x => x.text.replace(/\s+/g, '').toLowerCase().includes(needle));
    if (!hits.length) { const words = String(q).split(/\s+/).filter(w => w.length >= 2); hits = on.filter(x => words.length && words.every(w => x.text.includes(w))); }
    return { hits };
}
module.exports = { activeList };
if (require.main === module) {
    (async () => {
        const [cmd, a, ...rest] = process.argv.slice(2);
        const v = await load();
        if (!cmd || cmd === 'list') {   // 켜진 것만 · 번호 없이(--all 이면 꺼진 것도 · 점검용)
            const all = a === '--all'; const items = v.items.filter(x => all || !x.off).map(x => Object.assign({ at: x.at, by: x.by, text: x.text }, all ? { off: !!x.off } : {}));
            console.log(JSON.stringify({ count: v.items.filter(x => !x.off).length, items }, null, 1));
        }
        else if (cmd === 'add') {
            const id = parseInt(a, 10), text = rest.join(' ').replace(/\s+/g, ' ').trim();
            if (!id || !text) throw new Error('사용: remember.js add <지시 id> "기억할 글"');
            if (text.length > 400) throw new Error('한 줄은 400자까지 — 나눠서 적어 주세요');
            if (/01\d[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(text.replace(/010-6687-4031/g, '')) || /비밀번호|패스워드|password|secret|api[_ ]?key|토큰/i.test(text)) throw new Error('손님 전화번호나 비밀번호·열쇠는 기억해 두지 않습니다');
            const o = await adminOf(id);
            const n = v.items.reduce((m, x) => Math.max(m, x.n || 0), 0) + 1;
            v.items.push({ n, text, by: o.created_by || '', at: kst(), order_id: id });
            await save(v); await audit('desk_memory_add', id, { n, text });
            console.log(JSON.stringify({ ok: true, text, note: '다음 지시부터 get.js 결과의 remember 에 함께 나옵니다' }));
        } else if (cmd === 'off') {   // off <지시 id> "<잊을 기억의 글 조각>" — 번호가 아니라 글로 찾는다
            const id = parseInt(a, 10), q = rest.join(' ').trim();
            if (!id || !q) throw new Error('사용: remember.js off <지시 id> "<잊을 기억의 글 조각>"');
            await adminOf(id);
            const { hits } = findByText(v, q);
            if (!hits.length) throw new Error('그 글이 든 기억이 없습니다 — remember.js list 로 지금 기억을 보고 글 조각을 다시 주세요');
            if (hits.length > 1) { console.log(JSON.stringify({ ok: false, ambiguous: true, candidates: hits.map(x => ({ at: x.at, text: x.text })), note: '둘 이상 걸려 끄지 않았습니다 — 어느 것인지 되물어 더 긴 글 조각으로 다시' })); await pool.end(); return; }
            const it = hits[0]; it.off = true; it.off_at = kst(); it.off_order = id;
            await save(v); await audit('desk_memory_off', id, { n: it.n, text: it.text });
            console.log(JSON.stringify({ ok: true, off: it.text }));
        } else throw new Error('사용: remember.js list [--all] | add <지시 id> "글" | off <지시 id> "<글 조각>"');
        await pool.end();
    })().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });
}
