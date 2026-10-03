// #506 검증(서버): /api/agent-office/desk-status 가 처리 중 지시의 working_list[] 를 내리는가
//   사용: node scripts/verify-506-status.js
//   로컬 실서버 3459(스케줄러 차단) · 실DB — [검증469] 시험 지시 2건(부모 완료 + 이어서 처리중)을 잠깐 만들고 끝에 숨김·취소.
require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PORT = 3459;
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass: !!pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + note : '')); };
const info = msg => console.log('ℹ️ ' + msg);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    let srv = null; const made = [];
    const { Client } = require('pg');
    const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    try {
        const jwt = require('jsonwebtoken');
        const env = { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) };
        delete env.ANTHROPIC_API_KEY; delete env.RENDER;
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`],
            { cwd: ROOT, env, stdio: ['ignore', fs.openSync(path.join(os.tmpdir(), 'desk506-server.log'), 'w'), fs.openSync(path.join(os.tmpdir(), 'desk506-server.err'), 'w')] });
        let up = false;
        for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        ok('로컬 실서버 기동(' + PORT + ')', up);
        if (!up) throw new Error('server not up');
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' AND deleted_at IS NULL LIMIT 1`)).rows[0];
        const staff = (await db.query(`SELECT id, name, position FROM users WHERE role <> 'admin' AND deleted_at IS NULL ORDER BY id LIMIT 1`)).rows[0];
        const tokA = jwt.sign({ id: ceo.id, name: ceo.name, position: '대표', role: 'admin' }, 'verifytest', { expiresIn: '20m' });
        const tokS = jwt.sign({ id: staff.id, name: staff.name, position: staff.position || '', role: 'staff' }, 'verifytest', { expiresIn: '20m' });
        const get = async tok => { const r = await fetch(`http://localhost:${PORT}/api/agent-office/desk-status`, { headers: { Authorization: 'Bearer ' + tok, Connection: 'close' } }); return { status: r.status, j: await r.json() }; };
        const busyNow = (await db.query(`SELECT COUNT(*)::int c FROM pending_orders WHERE is_deleted=false AND status IN ('처리중','판독완료','확인표작성')`)).rows[0].c;
        const s0 = await get(tokA);
        ok('desk-status 200 · working_list 는 배열', s0.status === 200 && Array.isArray(s0.j.working_list), `online=${s0.j.online} state=${s0.j.state} working=${s0.j.working} list=${s0.j.working_list && s0.j.working_list.length} · 지금 실제 처리중 ${busyNow}건`);
        if (!s0.j.online) info('⚠️ 창구가 자리 비움(offline) 상태라 서버가 working_list를 [] 로 내린다 — 아래 내용 검사는 online일 때만 의미 있음');
        if (busyNow === 0) ok('처리 중 지시가 없으면 working_list = []', s0.j.working_list.length === 0 && s0.j.working === 0);
        else info(`지금 실제 처리중 ${busyNow}건이 있어 「빈 배열」 검사는 건너뜀 — 목록 ${s0.j.working_list.map(w => '#' + w.id).join(',')}`);
        // 시험 지시: 부모(완료) + 이어서(처리중 · 이미지·결과 있음)
        const parent = (await db.query(`INSERT INTO pending_orders (content, status, created_by, created_by_id, result, processed_at) VALUES ($1, '완료', $2, $3, $4, NOW()) RETURNING id`,
            ['[검증469] #506 부모 — ' + '가'.repeat(100), '시험506 대표', ceo.id, JSON.stringify({ type: 'desk_answer', answer: '부모 답' })])).rows[0].id;
        made.push(parent);
        const child = (await db.query(`INSERT INTO pending_orders (content, status, created_by, created_by_id, reply_to, image_data, image_mime, result) VALUES ($1, '처리중', $2, $3, $4, $5, 'image/png', $6) RETURNING id`,
            ['[검증469] #506 이어서 — ' + '나'.repeat(100), '시험506 대표', ceo.id, parent, 'data:image/png;base64,AAAA', JSON.stringify({ type: 'live', text: '쓰는 중' })])).rows[0].id;
        made.push(child);
        const s1 = await get(tokA);
        const w = (s1.j.working_list || []).find(x => x.id === child);
        if (s1.j.online) {
            ok('처리중으로 만든 시험 지시가 working_list에 옴 · 항목 = {id, created_by, content, reply_to, parent_content}', !!w && w.created_by === '시험506 대표' && w.reply_to === parent && typeof w.content === 'string' && typeof w.parent_content === 'string' && Object.keys(w).sort().join() === 'content,created_by,id,parent_content,reply_to', w ? Object.keys(w).sort().join() : `목록 ${JSON.stringify((s1.j.working_list || []).map(x => x.id))}`);
            ok('content·parent_content 는 80자까지만 · image_data·result·image_mime 은 안 옴', !!w && w.content.length === 80 && w.parent_content.length === 80 && !('image_data' in w) && !('result' in w) && !('image_mime' in w), w ? `content ${w.content.length}자 · parent ${w.parent_content.length}자` : '');
            ok('working 수에 시험 지시 포함 · 부모(완료)는 목록에 없음', s1.j.working >= 1 && !(s1.j.working_list || []).some(x => x.id === parent), `working=${s1.j.working}`);
            const s2 = await get(tokS);
            ok('직원 계정도 같은 working_list(화면 문구용 · 성함·요청만)', s2.status === 200 && Array.isArray(s2.j.working_list) && s2.j.working_list.some(x => x.id === child), `list=${s2.j.working_list && s2.j.working_list.length}`);
        } else {
            ok('(offline) working_list 는 빈 배열 · working 수에는 시험 지시 포함', Array.isArray(s1.j.working_list) && s1.j.working_list.length === 0 && s1.j.working >= 1, `working=${s1.j.working}`);
            info('온라인 때의 항목 내용 검사는 창구가 켜진 뒤 다시 돌려야 함');
        }
        const S = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
        ok('server.js: 목록 SQL = 처리중·판독완료·확인표작성 · LEFT(…, 80) · LIMIT 8 · online 일 때만 · 읽기만(UPDATE/INSERT 없음)', /LEFT\(o\.content, 80\) AS content/.test(S) && /LEFT\(p\.content, 80\)/.test(S) && /status IN \('처리중','판독완료','확인표작성'\) ORDER BY o\.id ASC LIMIT 8/.test(S) && /working_list: online \? wq\.rows : \[\]/.test(S));
    } catch (e) {
        ok('검증 실행', false, e.message);
    } finally {
        if (made.length) {
            await db.query(`UPDATE pending_orders SET is_deleted = true, status = '취소' WHERE id = ANY($1::int[])`, [made]);
            const left = (await db.query(`SELECT COUNT(*)::int c FROM pending_orders WHERE id = ANY($1::int[]) AND is_deleted = false`, [made])).rows[0].c;
            ok('시험 지시 ' + made.length + '건 정리(숨김·취소)', left === 0, made.join(','));
        }
        await db.end();
        if (srv) { try { srv.kill(); } catch (_) { } }
    }
    const pass = results.filter(r => r.pass).length;
    console.log(`\n결과: ${pass}/${results.length}` + (pass === results.length ? ' ✅' : ' — 실패: ' + results.filter(r => !r.pass).map(r => r.name).join(' / ')));
    process.exit(pass === results.length ? 0 : 1);
})();
