/* #610-J 사진 판독 정답률 시험 도구 — 폴더의 사진을 서버 시험 라우트(/api/sms/photo-test)로 한 장씩 보내 표를 만든다
 *
 *   사용(대표 PC · 총괄):
 *     set AKKOME_TOKEN=<관리자 로그인 토큰>        ← 회사프로그램에 로그인한 브라우저 F12 콘솔에서  localStorage.getItem('jwt_token')
 *     node scripts/desk/photo-test.js "★에이전트오피스/비공개/사진시험"
 *
 *   인자
 *     <폴더>                   사진 폴더. 하위 폴더 이름이 기대값이 된다(파손·곰팡이·사이즈작음·멀쩡·주소캡처).
 *     --expect-from-folder     하위 폴더 이름을 기대값으로(하위 폴더가 있으면 기본으로 켜짐)
 *     --no-expect              기대값 없이 판정만
 *     --server <주소>          기본 https://jeju-acom-company.onrender.com
 *     --channel sms|talk       손님 문구 채널(기본 sms)
 *     --out <파일.md>          결과 파일(기본 <폴더>/결과_<날짜>.md)
 *     --limit N                앞에서 N장만
 *     --dry                    보내지 않고 목록·기대값만 출력(AI 호출 0)
 *
 *   · 아이디·비밀번호를 받지 않는다. 토큰은 환경변수 AKKOME_TOKEN 으로만(파일·명령줄에 적지 않는다).
 *   · 사진 1장 = 판독 1회 = Sonnet 호출 1회(서버 콘솔 키 과금 · 서버 상한 하루 100회).
 *   · 결과 파일에는 직원용 요약(개수·정도)이 들어간다 → 비공개 폴더(저장소 제외)에만 둔다.
 *   마지막 줄에 JSON 한 줄 요약을 찍는다(총 장수 · 정답 · 정답률 · 결과 파일).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const KINDS = ['damage', 'size', 'other', 'not_fruit', 'unclear'];
const KIND_KO = { damage: '파손·부패', size: '사이즈', other: '기타(멀쩡 등)', not_fruit: '과일 사진 아님', unclear: '판독 불가' };
// 하위 폴더 이름 → 기대값 (이름에 이 낱말이 들어 있으면)
const FOLDER_RULES = [
    [/주소|캡처|캡쳐|화면|송장|영수증|not_?fruit/i, 'not_fruit'],
    [/사이즈|크기|size/i, 'size'],
    [/파손|곰팡|부패|썩|무름|무른|터짐|damage/i, 'damage'],
    [/멀쩡|정상|other/i, 'other'],
    [/흐림|불명|unclear/i, 'unclear']
];
const EXT_TYPE = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };

function expectOf(folderName) {
    for (const [re, kind] of FOLDER_RULES) if (re.test(folderName)) return kind;
    return null;
}

function parseArgs(argv) {
    const a = { dir: '', server: 'https://jeju-acom-company.onrender.com', channel: 'sms', out: '', limit: 0, dry: false, expect: null };
    for (let i = 0; i < argv.length; i++) {
        const v = argv[i];
        if (v === '--server') a.server = String(argv[++i] || '').replace(/\/+$/, '');
        else if (v === '--channel') a.channel = argv[++i] === 'talk' ? 'talk' : 'sms';
        else if (v === '--out') a.out = argv[++i] || '';
        else if (v === '--limit') a.limit = Number(argv[++i]) || 0;
        else if (v === '--dry') a.dry = true;
        else if (v === '--expect-from-folder') a.expect = true;
        else if (v === '--no-expect') a.expect = false;
        else if (!v.startsWith('--') && !a.dir) a.dir = v;
    }
    return a;
}

function listPhotos(dir) {
    const out = [];
    const walk = (d, rel) => {
        for (const ent of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name, 'ko'))) {
            const full = path.join(d, ent.name);
            if (ent.isDirectory()) walk(full, rel ? rel + '/' + ent.name : ent.name);
            else if (EXT_TYPE[path.extname(ent.name).toLowerCase()]) out.push({ full, name: ent.name, folder: rel, contentType: EXT_TYPE[path.extname(ent.name).toLowerCase()] });
        }
    };
    walk(dir, '');
    return out;
}

async function postOnce(url, token, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    return { status: r.status, data };
}
async function post(url, token, body) {
    try { return await postOnce(url, token, body); }
    catch (e) {   // 쉬다 온 연결이 끊겨 「fetch failed」가 나는 일이 있어 한 번만 다시
        await new Promise(r => setTimeout(r, 800));
        return postOnce(url, token, body);
    }
}

function esc(s) { return String(s == null ? '' : s).replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ').trim(); }

function buildReport(rows, meta) {
    const judged = rows.filter(r => !r.failed);
    const scored = judged.filter(r => r.expect);
    const right = scored.filter(r => r.kind === r.expect).length;
    const leaks = judged.filter(r => r.leak).length;
    const ms = judged.map(r => r.ms || 0).sort((a, b) => a - b);
    const avg = ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : 0;
    const tin = judged.reduce((a, r) => a + ((r.tokens && r.tokens.input) || 0), 0);
    const tout = judged.reduce((a, r) => a + ((r.tokens && r.tokens.output) || 0), 0);
    const L = [];
    L.push(`# 사진 판독 시험 결과 — ${meta.date}`, '');
    L.push(`- 서버: ${meta.server} · 채널: ${meta.channel === 'talk' ? '톡톡' : '문자'} · 사진 ${rows.length}장(판독 ${judged.length} · 실패 ${rows.length - judged.length})`);
    L.push(`- **정답률: ${scored.length ? right + '/' + scored.length + ' (' + Math.round(right / scored.length * 100) + '%)' : '기대값 없음'}**`);
    L.push(`- 손님 문구 유출 검사(숫자·개수·비율): ${leaks ? '🔴 ' + leaks + '건 걸림' : '0건'}`);
    L.push(`- 걸린 시간: 평균 ${avg}ms · 가장 김 ${ms.length ? ms[ms.length - 1] : 0}ms · 토큰 합계 입력 ${tin} / 출력 ${tout}`, '');

    if (scored.length) {
        const exps = KINDS.filter(k => scored.some(r => r.expect === k));
        const gots = KINDS.filter(k => scored.some(r => r.kind === k));
        L.push('## 종류별 혼동표 (세로 = 기대 · 가로 = 판정)', '');
        L.push('| 기대 \\ 판정 | ' + gots.map(k => KIND_KO[k]).join(' | ') + ' | 정답률 |');
        L.push('|---|' + gots.map(() => '---:').join('|') + '|---:|');
        for (const e of exps) {
            const rs = scored.filter(r => r.expect === e);
            const ok = rs.filter(r => r.kind === e).length;
            L.push(`| ${KIND_KO[e]} | ` + gots.map(g => rs.filter(r => r.kind === g).length || '').join(' | ') + ` | ${ok}/${rs.length} |`);
        }
        L.push('');
        const wrong = scored.filter(r => r.kind !== r.expect);
        if (wrong.length) {
            L.push('## 틀린 것', '');
            for (const r of wrong) L.push(`- ${esc(r.folder ? r.folder + '/' : '')}${esc(r.name)} — 기대 ${KIND_KO[r.expect]} → 판정 ${KIND_KO[r.kind] || r.kind}(확신 ${r.confidence === 'high' ? '높음' : '낮음'}) · ${esc(r.staff_summary)}`);
            L.push('');
        }
    }

    L.push('## 사진별', '');
    L.push('| 파일 | 기대 | 판정 | 맞음 | 확신 | 사이즈 | 유출 | ms | 직원용 요약 |');
    L.push('|---|---|---|:---:|---|---|---|---:|---|');
    for (const r of rows) {
        if (r.failed) { L.push(`| ${esc(r.folder ? r.folder + '/' : '')}${esc(r.name)} | ${r.expect ? KIND_KO[r.expect] : ''} | 실패 |  |  |  |  |  | ${esc(r.error)} |`); continue; }
        L.push(`| ${esc(r.folder ? r.folder + '/' : '')}${esc(r.name)} | ${r.expect ? KIND_KO[r.expect] : ''} | ${KIND_KO[r.kind] || esc(r.kind)} | ${r.expect ? (r.kind === r.expect ? 'O' : 'X') : ''} | ${r.confidence === 'high' ? '높음' : '낮음'} | ${esc(r.size_guess || '')}${r.size_dir ? '(' + (r.size_dir === 'big' ? '크다' : '작다') + ')' : ''} | ${r.leak ? '🔴 ' + esc(r.leak) : '없음'} | ${r.ms || ''} | ${esc(r.staff_summary)}${r.error ? ' ⚠ ' + esc(r.error) : ''} |`);
    }
    L.push('');

    // 손님에게 나갈 글(종류별로 한 번씩만)
    const seen = new Map();
    for (const r of judged) { const key = r.customer_reply == null ? '(답 없음)' : r.customer_reply; if (!seen.has(key)) seen.set(key, []); seen.get(key).push(r.name); }
    L.push('## 손님에게 나갈 글(같은 글은 한 번만)', '');
    for (const [text, names] of seen) {
        L.push(`**${names.length}장** — ${names.slice(0, 6).map(esc).join(', ')}${names.length > 6 ? ' …' : ''}`, '', '```', text, '```', '');
    }
    return { text: L.join('\n'), summary: { total: rows.length, judged: judged.length, failed: rows.length - judged.length, scored: scored.length, right, rate: scored.length ? Math.round(right / scored.length * 1000) / 10 : null, leaks, avg_ms: avg, tokens_in: tin, tokens_out: tout } };
}

async function main() {
    const a = parseArgs(process.argv.slice(2));
    if (!a.dir) { console.error('사용: node scripts/desk/photo-test.js <사진 폴더> [--server 주소] [--channel sms|talk] [--dry]'); process.exit(2); }
    const dir = path.resolve(a.dir);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { console.error('폴더가 없습니다: ' + dir); process.exit(2); }
    let photos = listPhotos(dir);
    if (a.limit > 0) photos = photos.slice(0, a.limit);
    if (!photos.length) { console.error('사진(jpg·png·gif·webp)이 없습니다: ' + dir); process.exit(2); }
    const useExpect = a.expect === null ? photos.some(p => p.folder) : a.expect;
    for (const p of photos) p.expect = useExpect ? expectOf(p.folder.split('/')[0] || '') : null;
    const noExpect = useExpect ? [...new Set(photos.filter(p => !p.expect).map(p => p.folder || '(맨 위)'))] : [];
    if (noExpect.length) console.log('⚠ 기대값을 못 정한 폴더(판정만 함): ' + noExpect.join(', '));

    if (a.dry) {
        for (const p of photos) console.log(`${p.folder ? p.folder + '/' : ''}${p.name}\t기대 ${p.expect ? KIND_KO[p.expect] : '-'}\t${Math.round(fs.statSync(p.full).size / 1024)}KB`);
        console.log(JSON.stringify({ ok: true, dry: true, total: photos.length, with_expect: photos.filter(p => p.expect).length }));
        return;
    }
    const token = String(process.env.AKKOME_TOKEN || '').trim();
    if (!token) { console.error('환경변수 AKKOME_TOKEN 이 없습니다. 회사프로그램에 관리자로 로그인한 브라우저 F12 콘솔에서 localStorage.getItem(\'jwt_token\') 값을 넣어 주세요.'); process.exit(2); }

    const url = a.server + '/api/sms/photo-test';
    const rows = [];
    let stop = '';
    for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        const row = { name: p.name, folder: p.folder, expect: p.expect };
        const size = fs.statSync(p.full).size;
        if (size > 10 * 1024 * 1024) { Object.assign(row, { failed: true, error: '10MB 초과' }); rows.push(row); console.log(`[${i + 1}/${photos.length}] ${p.name} — 10MB 초과(건너뜀)`); continue; }
        const body = { images: [{ name: p.name, contentType: p.contentType, data: fs.readFileSync(p.full).toString('base64') }], channel: a.channel };
        if (p.expect) body.expect = p.expect;
        let r;
        try { r = await post(url, token, body); }
        catch (e) { Object.assign(row, { failed: true, error: '서버에 닿지 못함: ' + e.message }); rows.push(row); console.log(`[${i + 1}/${photos.length}] ${p.name} — 서버에 닿지 못함`); continue; }
        const d = r.data || {};
        if (r.status === 401 || r.status === 403) { stop = r.status === 401 ? '로그인 토큰이 만료됐거나 틀렸습니다(AKKOME_TOKEN 을 새로 넣어 주세요).' : '관리자 계정의 토큰이 아닙니다.'; break; }
        if (r.status === 404) { stop = '서버에 시험 라우트가 없습니다(아직 배포 전).'; break; }
        if (r.status === 429) { stop = d.error || '오늘 시험 횟수를 다 썼습니다.'; break; }
        if (r.status !== 200 || !d.kind) { Object.assign(row, { failed: true, error: (d.error || 'HTTP ' + r.status) }); rows.push(row); console.log(`[${i + 1}/${photos.length}] ${p.name} — 실패: ${row.error}`); continue; }
        Object.assign(row, { kind: d.kind, confidence: d.confidence, size_guess: d.size_guess, size_dir: d.size_dir, staff_summary: d.staff_summary, customer_reply: d.customer_reply, leak: d.leak || '', tokens: d.tokens, ms: d.ms, error: d.error || '' });
        if (d.error) row.failed = true;   // 판독 자체가 실패(키 없음·잔액 부족 등) — 정답률에서 뺀다
        rows.push(row);
        console.log(`[${i + 1}/${photos.length}] ${p.folder ? p.folder + '/' : ''}${p.name} — ${d.error ? '판독 실패: ' + d.error : (KIND_KO[d.kind] || d.kind) + ' · 확신 ' + (d.confidence === 'high' ? '높음' : '낮음') + (p.expect ? (d.kind === p.expect ? ' · O' : ' · X(기대 ' + KIND_KO[p.expect] + ')') : '')}`);
    }

    const date = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const rep = buildReport(rows, { date, server: a.server, channel: a.channel });
    let out = '';
    if (rows.length) {
        out = a.out ? path.resolve(a.out) : path.join(dir, `결과_${date}.md`);
        fs.writeFileSync(out, rep.text + (stop ? `\n> ⚠ 중간에 멈춤: ${stop} (${rows.length}/${photos.length}장까지)\n` : ''), 'utf8');
    }
    if (stop) console.error('⚠ 멈춤: ' + stop);
    console.log(JSON.stringify(Object.assign({ ok: !stop, stopped: stop || undefined, out }, rep.summary)));
    process.exitCode = stop ? 1 : 0;   // process.exit 를 바로 부르면 윈도에서 fetch 연결 정리 중 비정상 종료 코드가 나는 일이 있다
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { expectOf, listPhotos, buildReport, parseArgs, KIND_KO };
