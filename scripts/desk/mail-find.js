// #776 창구용 — 네이버 메일(bumiletter@naver.com) 찾기 · 읽기 · 첨부 받기(읽기 전용 · 대표 「지난 메일도 직원들도 찾을 수 있게 에이전트 오피스에서」)
//   node scripts/desk/mail-find.js find "<검색어>" [--from <보낸 사람 글>] [--subject <제목 글>] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--folder <메일함>] [--limit ≤20] [--order <지시 id>]
//        검색어 = 제목·본문·보낸 사람 어디든(빈 칸 "" 이면 --from·--subject·날짜만으로) · 결과 = 메일마다 날짜·보낸 사람·제목·본문 앞 300자·첨부 이름·크기·uid·folder
//        메일함 기본 = 받은메일함 + 내 메일함들(스팸·휴지통·보낸 메일함은 안 봄) · 한 번에 20통까지 · 찾기는 10초 간격
//   node scripts/desk/mail-find.js read <uid> [--folder <메일함>] [--order <지시 id>]        한 통 = 본문 글 최대 5천 자 + 첨부 목록(part)
//   node scripts/desk/mail-find.js attach <uid> <part> [--folder <메일함>] [--order <지시 id>]   첨부 하나를 이 PC 로(10MB 까지) → 출력 file 을 respond attachments 에 넣어 붙이기
//   길 = 요청 줄 agent_office_config 'mail_*_request' → 실서버 5초 틱(naver-mail.js) → 'mail_*_result' · 이 도구는 메일 비밀값을 모른다(서버만)
//   🔴 읽기 전용 — 메일 삭제·이동·답장·전달·읽음 표시는 못 함 · 주민번호 꼴은 이 도구가 가려서 보여 줌 · 답할 때 계좌·카드·주소 같은 개인정보도 필요한 만큼만
const path = require('path'), fs = require('fs'), os = require('os');
const KEYS = { find: ['mail_search_request', 'mail_search_result'], read: ['mail_read_request', 'mail_read_result'], attach: ['mail_attach_request', 'mail_attach_result'] };
const DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'akkome', 'mail');
const YMD = /^\d{4}-\d{2}-\d{2}$/;
// 주민등록번호 꼴(6자리-7자리 · 뒷자리 첫 숫자 1~4) → 앞 6 + 성별 1자리만
const maskPii = (s) => String(s == null ? '' : s).replace(/(\d{6})\s?-\s?([1-4])\d{6}(?!\d)/g, '$1-$2******');
const kb = (n) => n == null ? '' : n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB';
function parseArgs(args) {
    const o = {}, rest = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (['--from', '--subject', '--since', '--until', '--folder', '--limit', '--order'].includes(a)) o[a.slice(2)] = args[++i];
        else rest.push(a);
    }
    return { o, rest };
}
function makeRunner(deps) {
    const { pool, sleep, now } = deps;
    async function send(cmd, req, ms) {
        const [reqK, resK] = KEYS[cmd];
        const busy = (await pool.query('SELECT 1 FROM agent_office_config WHERE key = $1', [reqK])).rows.length;
        if (busy) throw new Error('다른 메일 요청이 아직 처리 중이에요 — 10초 뒤 다시');
        const id = 'm' + now().toString(36) + Math.random().toString(36).slice(2, 6);
        await pool.query('DELETE FROM agent_office_config WHERE key = $1', [resK]);
        await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [reqK, JSON.stringify({ ...req, id })]);
        const t0 = now();
        while (now() - t0 < (ms || 120000)) {
            await sleep(3000);
            const r = await pool.query('SELECT value FROM agent_office_config WHERE key = $1', [resK]);
            if (r.rows.length && r.rows[0].value && r.rows[0].value.id === id) { await pool.query('DELETE FROM agent_office_config WHERE key = $1', [resK]); return r.rows[0].value; }
        }
        throw new Error('메일 러너 응답 없음(2분) — 실서버가 깨어 있는지 확인해 주세요(요청 줄은 서버가 깨면 그대로 실행돼요 — 다시 보내지 말고 총괄에게)');
    }
    async function orderBy(orderId) {
        if (!orderId) return '창구';
        const o = (await pool.query('SELECT id, created_by FROM pending_orders WHERE id = $1', [orderId])).rows[0];
        if (!o) throw new Error('없는 지시입니다: ' + orderId);
        return '클코(창구) · ' + (o.created_by || '요청자 미상');
    }
    return { send, orderBy };
}
async function main(argv, deps) {
    const out = deps.out || (o => console.log(JSON.stringify(o, null, 1)));
    const R = makeRunner(deps);
    const cmd = argv[0], { o, rest } = parseArgs(argv.slice(1));
    const orderId = o.order != null ? parseInt(o.order, 10) : null;
    if (o.order != null && !(orderId > 0)) throw new Error('--order 는 지시 id 숫자');
    const by = await R.orderBy(orderId);
    if (cmd === 'find') {
        const q = rest[0] != null ? String(rest[0]).trim() : '';
        for (const k of ['since', 'until']) if (o[k] != null && !YMD.test(o[k])) throw new Error(`--${k} 는 YYYY-MM-DD`);
        const limit = o.limit != null ? parseInt(o.limit, 10) : 10;
        if (!(limit >= 1 && limit <= 20)) throw new Error('--limit 은 1~20');
        if (!q && !o.from && !o.subject && !o.since && !o.until) throw new Error('검색어·--from·--subject·--since·--until 중 하나는 주세요');
        for (const [k, v] of [['검색어', q], ['--from', o.from], ['--subject', o.subject]]) if (v && String(v).length > 100) throw new Error(k + ' 는 100자까지');
        const res = await R.send('find', { q: q || null, from: o.from || null, subject: o.subject || null, since: o.since || null, until: o.until || null, folder: o.folder || null, limit, order_id: orderId, by });
        if (!res.ok) return out({ ok: false, error: res.error, note: '찾지 못했어요 — 위 error 그대로 전하기 · 읽기만 하는 도구라 바뀐 것 없음' });
        const mails = (res.mails || []).map(m => ({ ...m, from: maskPii(m.from), subject: maskPii(m.subject), preview: maskPii(m.preview) }));
        const lines = mails.map((m, i) => `${i + 1}. [${m.folder_name}] ${m.date || ''} · ${m.from} · 「${m.subject}」${m.attachments.length ? ' · 첨부 ' + m.attachments.map(a => `${a.name}(${kb(a.size)} · part ${a.part})`).join(', ') : ''} · uid ${m.uid}\n   ${m.preview.replace(/\s+/g, ' ').slice(0, 300)}`);
        return out({ ok: true, found: res.found, shown: res.shown, folders: res.folders, mails,
            text: (res.found ? `메일 ${res.found}통 중 최근 ${res.shown}통(메일함 ${res.folders.join(' · ')})` : `찾은 메일 없음(메일함 ${res.folders.join(' · ')})`) + (lines.length ? '\n' + lines.join('\n') : ''),
            next: mails.length ? `한 통 자세히: read <uid> --folder "<folder>" · 첨부 받기: attach <uid> <part> --folder "<folder>"` : '검색어를 줄이거나(낱말 하나) 날짜를 넓혀 다시',
            note: res.found > res.shown ? `더 오래된 ${res.found - res.shown}통은 안 보였어요 — 날짜(--since/--until)나 보낸 사람(--from)으로 좁히기` : undefined });
    }
    if (cmd === 'read') {
        const uid = parseInt(rest[0], 10); if (!(uid > 0)) throw new Error('read <uid> — 찾기 결과의 uid');
        const res = await R.send('read', { uid, folder: o.folder || null, order_id: orderId, by });
        if (!res.ok) return out({ ok: false, error: res.error, note: '못 읽었어요 — uid 와 --folder(찾기 결과의 folder) 확인' });
        const m = res.mail;
        return out({ ok: true, uid: m.uid, folder: m.folder, folder_name: m.folder_name, date: m.date, from: maskPii(m.from), to: maskPii(m.to), cc: m.cc ? maskPii(m.cc) : undefined, subject: maskPii(m.subject),
            text: maskPii(m.text), text_cut: m.text_cut || undefined, attachments: m.attachments,
            note: (m.text_cut ? '본문이 길어 앞 5천 자만 · ' : '') + (m.attachments.length ? `첨부 받기: attach ${m.uid} <part> --folder "${m.folder}"` : '첨부 없음') + ' · 답할 때 개인정보(주민번호·계좌·카드·주소)는 필요한 만큼만' });
    }
    if (cmd === 'attach') {
        const uid = parseInt(rest[0], 10), part = String(rest[1] || '').trim();
        if (!(uid > 0) || !/^\d+(\.\d+){0,9}$/.test(part)) throw new Error('attach <uid> <part> — 찾기·읽기 결과 첨부 목록의 part(예: 2 · 1.2)');
        const res = await R.send('attach', { uid, part, folder: o.folder || null, order_id: orderId, by }, 180000);
        if (!res.ok) return out({ ok: false, error: res.error, note: '첨부를 못 받았어요 — 위 error 그대로 전하기' });
        const row = (await deps.pool.query('SELECT filename, data FROM report_files WHERE id = $1 AND is_deleted = false AND purged_at IS NULL', [res.file_id])).rows[0];
        if (!row) return out({ ok: false, error: '서버가 저장한 첨부를 못 찾았어요(file_id ' + res.file_id + ')' });
        fs.mkdirSync(DIR, { recursive: true });
        const safe = String(row.filename).replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 150) || 'attachment.bin';
        const file = path.join(DIR, `${uid}-${part.replace(/\./g, '_')}-${safe}`);
        fs.writeFileSync(file, row.data);
        return out({ ok: true, file, filename: row.filename, size: row.data.length, type: res.type,
            note: `받았어요 — respond 결과의 attachments 에 이 file 경로를 넣으면 화면 내려받기로 붙어요(10MB · 5개까지 · respond 가 받는 형식만: xlsx·pdf·hwp·docx·zip·png·jpg 등)` });
    }
    throw new Error('명령: find "<검색어>" · read <uid> · attach <uid> <part>');
}
module.exports = { main, makeRunner, parseArgs, maskPii, KEYS };
if (require.main === module) {
    const { pool } = require('./_db');
    main(process.argv.slice(2), { pool, sleep: ms => new Promise(r => setTimeout(r, ms)), now: () => Date.now() })
        .catch(e => { console.log(JSON.stringify({ ok: false, error: e.message }, null, 1)); process.exitCode = 1; })
        .finally(() => pool.end().catch(() => { }));
}
