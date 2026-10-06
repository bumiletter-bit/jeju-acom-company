// #564(대표 GO 10/6) 대표가 챙길 일 — 에이전트 오피스 「지금 챙길 일」 칸에 대표 계정에게만 보이는 목록(정본 = DB).
//   대표는 화면에서 내리지 않는다 — 총괄(클코)이 처리하고 이 도구로 올리고 내린다.
//   node scripts/owner-todo.js list
//   node scripts/owner-todo.js add "할 일 글" [--when "10/11"] [--where "어디서·무엇 때문에"]     when = 오른쪽 표시(없으면 「확인」)
//   node scripts/owner-todo.js done <번호>                                                      내림(지우지 않고 done 표시 — 기록은 남는다)
//   node scripts/owner-todo.js edit <번호> "새 글" [--when ..] [--where ..]
//   저장 = agent_office_config 'owner_todo' { items:[{ n, text, when, where, at, done?, done_at? }] } · 바꿀 때마다 audit_logs.
//   손님 이름·전화·주소는 적지 않는다(화면에 그대로 보인다).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
const KEY = 'owner_todo', WHO = '클코 총괄';
const load = async () => { const r = await pool.query('SELECT value FROM agent_office_config WHERE key = $1', [KEY]); const v = r.rows.length ? r.rows[0].value : null; return v && Array.isArray(v.items) ? v : { items: [] }; };
const save = v => pool.query('INSERT INTO agent_office_config(key, value) VALUES($1, $2::jsonb) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()', [KEY, JSON.stringify(v)]);
const audit = (action, n, changes) => pool.query("INSERT INTO audit_logs(action,target_type,target_id,changes,source,actor_name) VALUES($1,'owner_todo',$2,$3::jsonb,'script',$4)", [action, String(n), JSON.stringify(changes), WHO]);
const kst = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const opt = (args, name) => { const i = args.indexOf('--' + name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return String(v || '').trim(); };
(async () => {
    const args = process.argv.slice(2); const cmd = args.shift();
    const when = opt(args, 'when'), where = opt(args, 'where');
    const v = await load();
    const clean = t => String(t || '').replace(/\s+/g, ' ').trim();
    const guard = t => { if (!t) throw new Error('글이 비었습니다'); if (t.length > 120) throw new Error('한 줄은 120자까지(칸이 좁다) — 줄여 주세요'); if (/01\d[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(t.replace(/010-6687-4031/g, ''))) throw new Error('전화번호는 적지 않습니다'); };
    if (!cmd || cmd === 'list') console.log(JSON.stringify({ open: v.items.filter(x => !x.done).map(x => ({ n: x.n, when: x.when || '', text: x.text, where: x.where || '', at: x.at })), done: v.items.filter(x => x.done).length }, null, 1));
    else if (cmd === 'add') {
        const text = clean(args.join(' ')); guard(text);
        const n = v.items.reduce((m, x) => Math.max(m, x.n || 0), 0) + 1;
        v.items.push({ n, text, when: clean(when).slice(0, 12), where: clean(where).slice(0, 60), at: kst() });
        await save(v); await audit('create', n, { text, when, where }); console.log(JSON.stringify({ ok: true, n, text }));
    } else if (cmd === 'done') {
        const n = parseInt(args[0], 10); const it = v.items.find(x => x.n === n && !x.done); if (!it) throw new Error('그 번호의 열린 항목이 없습니다');
        it.done = true; it.done_at = kst(); await save(v); await audit('update', n, { done: true, text: it.text }); console.log(JSON.stringify({ ok: true, done: n, text: it.text }));
    } else if (cmd === 'edit') {
        const n = parseInt(args.shift(), 10); const it = v.items.find(x => x.n === n && !x.done); if (!it) throw new Error('그 번호의 열린 항목이 없습니다');
        const before = { text: it.text, when: it.when, where: it.where }; const text = clean(args.join(' '));
        if (text) { guard(text); it.text = text; } if (when !== undefined) it.when = clean(when).slice(0, 12); if (where !== undefined) it.where = clean(where).slice(0, 60);
        await save(v); await audit('update', n, { before, after: { text: it.text, when: it.when, where: it.where } }); console.log(JSON.stringify({ ok: true, n, text: it.text }));
    } else throw new Error('사용: owner-todo.js list | add "글" [--when ..] [--where ..] | done <번호> | edit <번호> "글"');
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });
