// #776 창구용 — 네이버 메일(bumiletter@naver.com) 찾기 · 읽기 · 첨부 받기(읽기 전용 · 대표 「지난 메일도 직원들도 찾을 수 있게 에이전트 오피스에서」)
//   node scripts/desk/mail-find.js find "<검색어>" [--from <보낸 사람 글>] [--subject <제목 글>] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--folder <메일함>] [--limit ≤20] [--order <지시 id>]
//        [--more <커서>](#778 더보기 = 앞 결과의 next 를 그대로 · 같은 검색 인자와 함께) → 결과에 has_more · next · next_cmd
//        검색어 = 제목·본문·보낸 사람 어디든(빈 칸 "" 이면 --from·--subject·날짜만으로) · 결과 = 메일마다 날짜·보낸 사람·제목·본문 앞 300자·첨부 이름·크기·uid·folder
//        메일함 기본 = 받은메일함 + 내 메일함들(스팸·휴지통·보낸 메일함은 안 봄) · 한 번에 20통까지 · 찾기는 10초 간격
//   node scripts/desk/mail-find.js read <uid> [--folder <메일함>] [--order <지시 id>]        한 통 = 본문 글 최대 5천 자 + 첨부 목록(part)
//   node scripts/desk/mail-find.js attach <uid> <part> [--folder <메일함>] [--order <지시 id>]   첨부 하나를 이 PC 로(10MB 까지) → 출력 file 을 respond attachments 에 넣어 붙이기
//   ── #779 쓰기(대표 10/20 「메일 쓰는 것은 다 되도록 · 삭제만 관리자만 · 문구 시안 알려주고 『고/보내줘』 하면 보내지도록」) — 전부 --order <지시 id> 필수(누가 시켰는지 기록)
//   node scripts/desk/mail-find.js draft --to <주소>[,<주소>] [--cc <주소>,…] --subject "<제목>" (--text "<본문>" | --text-file <파일>) [--reply <uid> --folder <메일함>] [--attach-file <파일>]… [--attach-id <report_files id>]… --order <지시 id>
//        초안만 만들고 카드로 되묻기(아직 안 보냄 · 30분 보관) · --reply 면 받는 사람·제목(Re:)을 원래 메일에서 채움(주면 그 값)
//   node scripts/desk/mail-find.js send <초안 id> --order <지시 id>      요청자가 「고/보내줘/응」 한 뒤에만 · 초안 없이 바로 보내는 길은 없음 · 하루 30통 · 한 통 10명
//   node scripts/desk/mail-find.js move <uid>[,<uid>…] --to <메일함> [--folder <메일함>] --order <지시 id> [--yes]   --yes 없으면 옮길 목록 카드만(되묻기) · 50통까지
//   node scripts/desk/mail-find.js trash <uid>[,<uid>…] [--folder <메일함>] --order <지시 id> [--yes]          휴지통 폴더로 옮김 = 관리자 지시만(서버가 막음) · 영구 삭제는 없음
//   길 = 요청 줄 agent_office_config 'mail_*_request' → 실서버 5초 틱(naver-mail.js) → 'mail_*_result' · 이 도구는 메일 비밀값을 모른다(서버만)
//   🔴 찾기·읽기·첨부는 읽기 전용 · 보내기·이동·휴지통은 위 #779 명령으로만(영구 삭제·읽음 표시 바꾸기는 없음) · 주민번호 꼴은 이 도구가 가려서 보여 줌 · 답할 때 계좌·카드·주소 같은 개인정보도 필요한 만큼만
const path = require('path'), fs = require('fs'), os = require('os');
const KEYS = { find: ['mail_search_request', 'mail_search_result'], read: ['mail_read_request', 'mail_read_result'], attach: ['mail_attach_request', 'mail_attach_result'],
    move: ['mail_move_request', 'mail_move_result'], trash: ['mail_trash_request', 'mail_trash_result'], send: ['mail_send_request', 'mail_send_result'] };   // #779
const NM = require(path.join(__dirname, '..', '..', 'naver-mail.js'));   // 초안 검사 규칙(서버와 같은 checkDraft) · 비밀값 없음
const ATTACH_EXT = ['xlsx', 'xls', 'csv', 'pdf', 'docx', 'doc', 'hwp', 'hwpx', 'zip', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'txt', 'pptx'];
const DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'akkome', 'mail');
const YMD = /^\d{4}-\d{2}-\d{2}$/;
// 주민등록번호 꼴(6자리-7자리 · 뒷자리 첫 숫자 1~4) → 앞 6 + 성별 1자리만
const maskPii = (s) => String(s == null ? '' : s).replace(/(\d{6})\s?-\s?([1-4])\d{6}(?!\d)/g, '$1-$2******');
const kb = (n) => n == null ? '' : n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB';
function parseArgs(args) {
    const o = {}, rest = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (['--from', '--subject', '--since', '--until', '--folder', '--limit', '--order', '--more', '--to', '--cc', '--text', '--text-file', '--reply'].includes(a)) o[a.slice(2)] = args[++i];
        else if (a === '--attach-file' || a === '--attach-id') (o[a.slice(2)] = o[a.slice(2)] || []).push(args[++i]);
        else if (a === '--yes') o.yes = true;
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
        if (o.more != null && !/^[A-Za-z0-9_-]{8,400}$/.test(String(o.more))) throw new Error('--more 는 앞 결과의 next 글 그대로');
        const res = await R.send('find', { q: q || null, from: o.from || null, subject: o.subject || null, since: o.since || null, until: o.until || null, folder: o.folder || null, limit, more: o.more || null, order_id: orderId, by }, 180000);   // 한글 낱말 = 서버가 최근 메일 제목·보낸 사람을 대조해 오래 걸릴 수 있음
        if (!res.ok) return out({ ok: false, error: res.error, note: '찾지 못했어요 — 위 error 그대로 전하기 · 읽기만 하는 도구라 바뀐 것 없음' });
        const mails = (res.mails || []).map(m => ({ ...m, from: maskPii(m.from), subject: maskPii(m.subject), preview: maskPii(m.preview) }));
        const base = res.page_from || 1;
        const lines = mails.map((m, i) => `${base + i}. [${m.folder_name}] ${m.date || ''} · ${m.from} · 「${m.subject}」${m.attachments.length ? ' · 첨부 ' + m.attachments.map(a => `${a.name}(${kb(a.size)} · part ${a.part})`).join(', ') : ''} · uid ${m.uid}\n   ${m.preview.replace(/\s+/g, ' ').slice(0, 300)}`);
        return out({ ok: true, found: res.found, shown: res.shown, folders: res.folders, mails,
            text: (res.found ? `메일 ${res.found}통 중 ${base}~${base + res.shown - 1}번째(최근순 · 메일함 ${res.folders.join(' · ')})` : `찾은 메일 없음(메일함 ${res.folders.join(' · ')})`) + (lines.length ? '\n' + lines.join('\n') : '')
                + (res.has_more ? `\n더 있어요 — 「더 보여줘」라고 하면 다음 ${limit}건` : res.limited ? '\n여기까지 — 더 오래된 메일은 기간(--since/--until)을 좁혀 다시 찾아 주세요' : ''),
            has_more: !!res.has_more, more: res.has_more ? res.next : undefined,
            next_cmd: res.has_more ? ['node', 'scripts/desk/mail-find.js', 'find', JSON.stringify(q), ...['from', 'subject', 'since', 'until', 'folder', 'limit', 'order'].flatMap(k => o[k] != null ? ['--' + k, JSON.stringify(String(o[k]))] : []), '--more', res.next].join(' ') : undefined,
            more_line: res.has_more ? `더 있어요 — 「더 보여줘」라고 하면 다음 ${limit}건` : (res.limited ? '여기까지 — 더 오래된 메일은 기간(--since/--until)을 좁혀 다시 찾아 주세요' : undefined),
            next: mails.length ? `한 통 자세히: read <uid> --folder "<folder>" · 첨부 받기: attach <uid> <part> --folder "<folder>"` : '검색어를 줄이거나(낱말 하나) 날짜를 넓혀 다시',
            korean_scan: res.korean_scan || undefined,
            scan_note: res.korean_scan ? `한글 낱말은 네이버 메일이 직접 못 찾아서 ${res.korean_scan.days ? '최근 ' + res.korean_scan.days + '일 ' : ''}메일 ${res.korean_scan.scanned}통의 제목·보낸 사람에서 찾았어요(본문 속 낱말은 못 찾음 · 더 오래된 건 --since)${res.korean_scan.limited ? ' · 더 오래된 메일은 --since/--until 로 기간을 좁혀 다시' : ''}` : undefined,
            note: res.has_more ? `「더 보여줘」면 next_cmd 그대로 실행(같은 검색 + --more)` : undefined });
    }
    if (cmd === 'read') {
        const uid = parseInt(rest[0], 10); if (!(uid > 0)) throw new Error('read <uid> — 찾기 결과의 uid');
        const res = await R.send('read', { uid, folder: o.folder || null, order_id: orderId, by });
        if (!res.ok) return out({ ok: false, error: res.error, note: '못 읽었어요 — uid 와 --folder(찾기 결과의 folder) 확인' });
        const m = res.mail;
        return out({ ok: true, uid: m.uid, folder: m.folder, folder_name: m.folder_name, date: m.date, from: maskPii(m.from), to: maskPii(m.to), cc: m.cc ? maskPii(m.cc) : undefined, subject: maskPii(m.subject),
            text: maskPii(m.text), text_cut: m.text_cut || undefined, attachments: m.attachments,
            links: Array.isArray(m.links) && m.links.length ? m.links.map(l => `${l.text || '(글 없음)'} → ${l.href}${l.how ? ` (${l.how})` : ''}`) : undefined,   // #818 HTML 본문 링크(스마트빌 「계산서 보기」 등)
            html_info: m.html_info || undefined,   // #818-b HTML 부분 수(a·http·js·form) · 원문(m.html)은 안 찍음
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
    // ── #779 쓰기 ──
    const needOrder = () => { if (!(orderId > 0)) throw new Error('쓰기(보내기·옮기기·휴지통)는 --order <지시 id> 가 있어야 해요(누가 시켰는지 기록)'); };
    const addrs = (v) => String(v || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
    if (cmd === 'draft') {
        needOrder();
        let to = addrs(o.to), cc = addrs(o.cc), subject = o.subject != null ? String(o.subject).trim() : '', replyUid = null, replyOf = null;
        let text = o.text != null ? String(o.text) : null;
        if (o['text-file'] != null) { if (!fs.existsSync(o['text-file'])) throw new Error('본문 파일이 없어요: ' + o['text-file']); text = fs.readFileSync(o['text-file'], 'utf8').replace(/^\uFEFF/, ''); }
        if (o.reply != null) {   // 답장 = 원래 메일을 읽어 받는 사람·제목 채움
            replyUid = parseInt(o.reply, 10); if (!(replyUid > 0)) throw new Error('--reply 는 찾기 결과의 uid');
            const rr = await R.send('read', { uid: replyUid, folder: o.folder || null, order_id: orderId, by });
            if (!rr.ok) return out({ ok: false, error: rr.error, note: '답장할 메일을 못 읽었어요 — uid 와 --folder 확인 · 초안 안 만듦' });
            replyOf = { from: rr.mail.from, subject: rr.mail.subject, date: rr.mail.date };
            if (!to.length) { const m = /<([^>]+)>/.exec(rr.mail.from || '') || /([^\s<>"]+@[^\s<>"]+)/.exec(rr.mail.from || ''); if (m) to = [m[1]]; }
            if (!subject) subject = /^re:/i.test(rr.mail.subject || '') ? rr.mail.subject : 'Re: ' + (rr.mail.subject || '');
        }
        const ids = (o['attach-id'] || []).map(x => parseInt(x, 10));
        if (ids.some(x => !(x > 0))) throw new Error('--attach-id 는 report_files id 숫자');
        let total = 0; const names = [];
        if (ids.length) {
            const fr = (await deps.pool.query('SELECT id, filename, size_bytes FROM report_files WHERE id = ANY($1) AND is_deleted = false AND purged_at IS NULL', [ids])).rows;
            if (fr.length !== ids.length) throw new Error('없는 첨부 id 가 있어요: ' + ids.filter(x => !fr.some(y => Number(y.id) === x)).join(', '));
            for (const x of fr) { total += Number(x.size_bytes) || 0; names.push({ id: Number(x.id), name: x.filename, size: Number(x.size_bytes) || 0 }); }
        }
        for (const p of (o['attach-file'] || [])) {   // 이 PC 파일 → report_files(respond 와 같은 꼴)
            if (!fs.existsSync(p)) throw new Error('첨부 파일이 없어요: ' + p);
            const ext = (path.extname(p).slice(1) || '').toLowerCase(); if (!ATTACH_EXT.includes(ext)) throw new Error('붙일 수 없는 형식이에요(.' + ext + ')');
            const buf = fs.readFileSync(p); if (!buf.length) throw new Error('빈 파일이에요: ' + path.basename(p));
            total += buf.length; if (total > 10 * 1024 * 1024) throw new Error('첨부가 합쳐서 10MB 를 넘어요');
            const ins = await deps.pool.query('INSERT INTO report_files (filename, run_id, data, size_bytes) VALUES ($1, NULL, $2, $3) RETURNING id', [path.basename(p).slice(0, 190), buf, buf.length]);
            ids.push(Number(ins.rows[0].id)); names.push({ id: Number(ins.rows[0].id), name: path.basename(p), size: buf.length });
        }
        if (total > 10 * 1024 * 1024) throw new Error('첨부가 합쳐서 10MB 를 넘어요');
        const d = { to, cc, subject, text: text == null ? '' : text, reply_to_uid: replyUid, folder: replyUid ? (o.folder || 'INBOX') : null, attach_file_ids: ids };
        const bad = NM.checkDraft(d); if (bad) return out({ ok: false, error: bad, note: '초안 안 만듦 — 고쳐서 다시 draft' });
        const draftId = Math.random().toString(36).slice(2, 8) + deps.now().toString(36).slice(-4);
        await deps.pool.query(`INSERT INTO agent_office_config (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            ['mail_draft_' + draftId, JSON.stringify({ ...d, id: draftId, at: deps.now(), order_id: orderId, by, attach_names: names })]);
        const card = ['━━━ 메일 초안(아직 안 보냄) ━━━', `받는 사람: ${to.join(', ')}`, ...(cc.length ? [`참조: ${cc.join(', ')}`] : []), `제목: ${subject}`,
            ...(replyOf ? [`답장: ${replyOf.date || ''} ${maskPii(replyOf.from)} 「${maskPii(replyOf.subject)}」`] : []),
            ...(names.length ? ['첨부: ' + names.map(x => `${x.name}(${kb(x.size)})`).join(', ')] : []), '── 본문 ──', d.text, '──────', '이대로 보낼까요? 「고」·「보내줘」면 보내요(30분 안 · 고칠 곳이 있으면 말씀해 주세요)'];
        return out({ ok: true, draft_id: draftId, to, cc, subject, attachments: names, card: card.join('\n'), next: `send ${draftId} --order ${orderId}`,
            note: '아직 안 보냈어요 — 카드를 그대로 보여 주고 되묻기 1회 · 「고/보내줘/응」이면 next 실행 · 문구를 고치라면 draft 를 새로(옛 초안은 30분 뒤 저절로 사라짐)' });
    }
    if (cmd === 'send') {
        needOrder();
        const draftId = String(rest[0] || '').trim(); if (!/^[a-z0-9]{6,20}$/.test(draftId)) throw new Error('send <초안 id> — draft 결과의 draft_id');
        const res = await R.send('send', { draft_id: draftId, order_id: orderId, by }, 150000);
        if (!res.ok) return out({ ok: false, error: res.error, note: /초안이 없어요|30분/.test(res.error || '') ? '보내지 않았어요 — draft 부터 다시 만들어 카드로 되묻기' : '보내지 않았을 가능성이 높지만 확실치 않으면 「보낸메일함」을 찾아보고 다시 보내지 말고 총괄에게' });
        const card = ['━━━ 메일 보냄 ━━━', `받는 사람: ${res.to.join(', ')}`, ...(res.cc && res.cc.length ? [`참조: ${res.cc.join(', ')}`] : []), `제목: ${res.subject}`,
            ...(res.attachments && res.attachments.length ? ['첨부: ' + res.attachments.map(x => `${x.name}(${kb(x.size)})`).join(', ')] : []), `지시: ${res.by}`];
        return out({ ok: true, sent: true, to: res.to, cc: res.cc, subject: res.subject, by: res.by, card: card.join('\n'), note: '보냈어요 — 카드 그대로 전하기' });
    }
    if (cmd === 'move' || cmd === 'trash') {
        needOrder();
        const uids = String(rest[0] || '').split(',').map(x => parseInt(x.trim(), 10));
        if (!uids.length || uids.some(x => !(x > 0)) || uids.length > 50) throw new Error(cmd + ' <uid>[,<uid>…] — 찾기 결과의 uid · 50통까지');
        if (cmd === 'move' && !o.to) throw new Error('move 는 --to <옮길 메일함>');
        const res = await R.send(cmd, { uids, folder: o.folder || null, ...(cmd === 'move' ? { to_folder: o.to } : {}), dry: !o.yes, order_id: orderId, by }, 150000);
        if (!res.ok) return out({ ok: false, error: res.error, note: '옮기지 않았어요 — 위 error 그대로 전하기' });
        const list = (res.mails || []).map(m => `· uid ${m.uid} · ${m.date || ''} · ${maskPii(m.from)} · 「${maskPii(m.subject)}」`);
        const where = `${res.from_folder} → ${res.to_folder}`;
        if (res.dry) return out({ ok: true, dry: true, card: [`━━━ 메일 ${cmd === 'trash' ? '휴지통으로' : '옮기기'}(아직 안 함) ━━━`, `${where} · ${res.mails.length}통`, ...list, ...(res.missing && res.missing.length ? [`이 메일함에 없는 uid: ${res.missing.join(', ')}`] : []), `이 ${res.mails.length}통을 ${cmd === 'trash' ? '휴지통으로 옮길까요?(영구 삭제 아님 · 휴지통에서 다시 꺼낼 수 있음)' : res.to_folder + ' 로 옮길까요?'}`].join('\n'),
            next: [cmd, uids.join(','), ...(o.folder ? ['--folder', JSON.stringify(o.folder)] : []), ...(cmd === 'move' ? ['--to', JSON.stringify(o.to)] : []), '--order', orderId, '--yes'].join(' '), note: '아직 안 옮겼어요 — 카드로 되묻기 1회 · 「응」이면 next 실행' });
        const card = [`━━━ 메일 ${cmd === 'trash' ? '휴지통으로 옮김' : '옮김'} ━━━`, `${where} · ${res.moved}통`, ...list, ...(res.not_moved && res.not_moved.length ? [`⚠ 아직 그대로인 uid: ${res.not_moved.join(', ')}`] : []), `지시: ${res.by}`];
        return out({ ok: true, moved: res.moved, card: card.join('\n'), note: res.not_moved && res.not_moved.length ? '일부가 안 옮겨졌어요 — 다시 보내지 말고 총괄에게' : '옮겼어요 — 카드 그대로 전하기' });
    }
    throw new Error('명령: find "<검색어>" · read <uid> · attach <uid> <part> · draft … · send <초안 id> · move <uid,…> --to <메일함> · trash <uid,…>(관리자)');
}
module.exports = { main, makeRunner, parseArgs, maskPii, KEYS };
if (require.main === module) {
    const { pool } = require('./_db');
    main(process.argv.slice(2), { pool, sleep: ms => new Promise(r => setTimeout(r, ms)), now: () => Date.now() })
        .catch(e => { console.log(JSON.stringify({ ok: false, error: e.message }, null, 1)); process.exitCode = 1; })
        .finally(() => pool.end().catch(() => { }));
}
