// #498 검증: 창구 빠르게 — ① scripts/desk/fast.js 순수 함수 단위 ② 화면(처리 중 「쓰는 중인 답변」·자동 펼침·중간발주 바로 받기)
//   사용: node scripts/verify-498-fast.js            (단위 + 화면)
//         node scripts/verify-498-fast.js unit       (단위만 — 서버·브라우저 안 띄움)
//         node scripts/verify-498-fast.js ui [스크린샷 폴더]
//   화면 = 로컬 실서버 3459(스케줄러 차단) · desk/orders 응답과 모든 쓰기 요청을 page.route로 가로챈다 → 이 스크립트의 DB 쓰기 0.
require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const F = require(path.join(ROOT, 'scripts', 'desk', 'fast.js'));
const PORT = 3459;
const MODE = process.argv[2] || 'all';
const SHOT = process.argv[3] || null;
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass: !!pass }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + note : '')); };
const info = msg => console.log('ℹ️ ' + msg);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ───────────────────────────── ① 단위 ─────────────────────────────
async function unit() {
    console.log('\n── ① fast.js 단위');
    // route — [지시, 기대 lane, 기대 model, 설명]
    const O = (content, extra) => Object.assign({ content, status: '대기', has_image: false, reply_to: null }, extra || {});
    const R = [
        // AI 없이 바로(중간발주)
        [O('중간발주 뽑아줘'), 'direct_qty', null],
        [O('중간발주'), 'direct_qty', null],
        [O('중간 발주 해줘'), 'direct_qty', null],
        [O('중간발주 수량 알려줘'), 'direct_qty', null],
        [O('중간발주 이미지 부탁해요'), 'direct_qty', null],
        [O('중간발주 확인'), 'direct_qty', null],
        [O('[검증469] 중간발주 뽑아줘'), 'direct_qty', null],
        [O('중간발주 뽑아주세요!'), 'direct_qty', null],
        // 조건이 붙으면 AI
        [O('중간발주 대성만'), 'ai', null],
        [O('중간발주 대성만 뽑아줘'), 'ai', null],
        [O('중간발주 뽑아줘 그리고 효돈 것만 이미지로'), 'ai', null],
        [O('어제 중간발주랑 비교해줘'), 'ai', 'opus'],
        [O('중간발주 뽑아줘', { has_image: true }), 'ai', null],
        [O('중간발주 뽑아줘', { reply_to: 940 }), 'ai', 'opus'],
        [O('중간발주 뽑아줘', { status: '승인됨' }), 'ai', 'opus'],
        // 정산 이미지·조회 = sonnet
        [O('금일 정산관리 올려줘', { has_image: true }), 'ai', 'sonnet'],
        [O('정산관리에 올려줘', { has_image: true }), 'ai', 'sonnet'],
        [O('오늘 정산 올려주세요', { has_image: true }), 'ai', 'sonnet'],
        [O('오늘 발송 박스 수 알려줘'), 'ai', 'sonnet'],
        [O('귤 박스 10kg 재고 얼마야?'), 'ai', 'sonnet'],
        [O('황금향 5kg 단가 알려줘'), 'ai', 'sonnet'],
        [O('오늘 일정 보여줘'), 'ai', 'sonnet'],
        [O('어제 주문 몇 건 들어왔어?'), 'ai', 'sonnet'],
        [O('발송 목록 조회해줘'), 'ai', 'sonnet'],
        // 당부(보고만·바꾸지 말 것)는 판정에서 제외
        [O('판매현황에서 지금 판매중인 품목이 몇 개인지 알려줘 — 보고만'), 'ai', 'sonnet'],
        [O('재고 알려줘. 아무것도 바꾸지 말 것'), 'ai', 'sonnet'],
        [O('단가 알려줘, 수정하지 마'), 'ai', 'sonnet'],
        [O('아무것도 바꾸지 말고 판매중 품목 몇 개인지 알려줘'), 'ai', 'sonnet', '당부가 앞에 오고 쉼표 없이 이어지는 글'],
        // 문구·시나리오·아이디어·영상·값 바꾸기 = opus
        [O('추석 감사 문자 문구 만들어줘'), 'ai', 'opus'],
        [O('유라조생 시나리오 추가해줘'), 'ai', 'opus'],
        [O('인스타 릴스 영상 만들어줘'), 'ai', 'opus'],
        [O('10월 이벤트 아이디어 추천해줘'), 'ai', 'opus'],
        [O('황금향 3kg 판매가 33,500원으로 바꿔줘'), 'ai', 'opus'],
        [O('가입 쿠폰 발급해줘'), 'ai', 'opus'],
        [O('단가표에 레드키위 등록해줘'), 'ai', 'opus'],
        [O('처리 안 된 톡톡 건 답변 예시문구 만들어줘'), 'ai', 'opus'],
        [O('어제 매출이 왜 낮았는지 분석해줘'), 'ai', 'opus'],
        [O('재고 알려줘 그리고 판매가도 수정해줘'), 'ai', 'opus'],
        [O('이 사진으로 배너 만들어줘', { has_image: true }), 'ai', 'opus'],
        [O('이 화면 뭐가 문제인지 봐줘', { has_image: true }), 'ai', 'opus'],
        [O('재고 알려줘', { reply_to: 915 }), 'ai', 'opus'],
        [O('재고 알려줘', { status: '승인됨' }), 'ai', 'opus'],
        [O('재고 알려줘 ' + '그리고 '.repeat(60)), 'ai', 'opus', '160자 넘는 조회 = 안전한 쪽'],
        [O('안녕'), 'ai', 'opus', '헷갈리면 opus'],
    ];
    let rPass = 0; const rFail = [];
    for (const [o, lane, model, memo] of R) {
        let r; try { r = F.route(o); } catch (e) { r = { lane: 'THROW', model: e.message }; }
        const good = r.lane === lane && (model === null ? true : r.model === model) && (lane === 'direct_qty' ? r.model === null : true);
        if (good) rPass++; else rFail.push(`「${String(o.content).slice(0, 40)}」${o.has_image ? '+이미지' : ''}${o.reply_to ? '+이어서' : ''}${o.status !== '대기' ? '+' + o.status : ''} → 기대 ${lane}/${model} · 실제 ${r.lane}/${r.model}(${r.why || ''})${memo ? ' [' + memo + ']' : ''}`);
    }
    ok(`route() ${R.length}건 — 길·모델 판정`, rPass === R.length, `${rPass}/${R.length}` + (rFail.length ? '\n     ' + rFail.join('\n     ') : ''));
    const f1 = F.route(O('재고 알려줘'), 'opus'), f2 = F.route(O('문구 만들어줘'), 'sonnet'), f3 = F.route(O('중간발주 뽑아줘'), 'opus');
    ok('route() forcedModel — AI 길은 지정 모델 · 중간발주 바로 받기는 그대로', f1.model === 'opus' && f2.model === 'sonnet' && f3.lane === 'direct_qty', `${f1.model}/${f2.model}/${f3.lane}`);
    ok('route() 빈 지시·없는 필드에도 예외 없음', (() => { try { F.route({}); F.route({ content: null, status: '대기' }); return true; } catch (e) { return false; } })());

    // settings
    const s0 = F.settings(undefined), sOff = F.settings({ off: true }), s1 = F.settings({ route: false }), sW = F.settings({ warm: false });
    const KEYS = ['poll', 'stream', 'prefetch', 'route', 'direct', 'lean'];
    ok('settings() 설정 없음 = 전부 켬(켜 둔 창구 warm 포함)', KEYS.every(k => s0[k] === true) && s0.warm === true && s0.off === false);
    ok('settings() {off:true} = 전부 끔', KEYS.every(k => sOff[k] === false) && sOff.warm === false && sOff.off === true);
    ok('settings() 낱개 끄기 {route:false} — 그 항목만', s1.route === false && KEYS.filter(k => k !== 'route').every(k => s1[k] === true) && s1.warm === true);
    ok('settings() warm 낱개 끄기 {warm:false} — 나머지는 켬 · 이상한 값(null·글자·0·"no")은 기본값(켬)', sW.warm === false && KEYS.every(k => sW[k] === true) && F.settings({ warm: 'no' }).warm === true && F.settings(null).warm === true && KEYS.every(k => F.settings(null)[k] && F.settings('x')[k]) && F.settings({ poll: 0 }).poll === true);

    // livePreview — 글자 수를 늘려 가며 잘라 넣기
    const ANSWER = '첫 줄입니다.\n둘째 줄 "따옴표"와 역슬래시 \\ 그리고 탭\t끝.\n귤 🍊 3kg = 33,500원 (10/2 기준)\n마지막 줄';
    const sweep = (full, truth, label) => {
        let threw = 0, bad = 0, nonNull = 0, last = null, firstBad = '';
        for (let n = 0; n <= full.length; n++) {
            let v; try { v = F.livePreview(full.slice(0, n)); } catch (e) { threw++; continue; }
            if (v == null) continue;
            nonNull++;
            if (!truth.startsWith(v)) { bad++; if (!firstBad) firstBad = `n=${n} → 「${v.slice(-30)}」`; }
            last = v;
        }
        ok(`livePreview() ${label} — ${full.length + 1}가지 길이 전부 예외 0 · 항상 정답의 앞부분 · 끝까지 넣으면 전체`, threw === 0 && bad === 0 && last === truth && nonNull > 10, `예외 ${threw} · 어긋남 ${bad}${firstBad ? '(' + firstBad + ')' : ''} · 미리보기 나온 횟수 ${nonNull}`);
    };
    const resultJson = JSON.stringify({ kind: 'answer', title: '제목 한 줄', answer: ANSWER });
    const writeInput = JSON.stringify({ file_path: 'C:/x/.scratch1/r.json', content: resultJson });
    sweep(writeInput, ANSWER, 'Write 도구 입력(\\n·\\"·\\\\·한글·이모지)');
    // \uXXXX 로 적힌 조각(모델이 가끔 이렇게 보냄)
    const uEsc = writeInput.replace(/첫/g, '\\uccab').replace(/귤/g, '\\uade4');
    sweep(uEsc, ANSWER, 'Write 입력 · \\uXXXX 섞임');
    const heredoc = `cd "C:/x" && mkdir -p .scratch1 && cat > .scratch1/r.json <<'EOF'\n${resultJson}\nEOF\nnode scripts/desk/respond.js 1 .scratch1/r.json`;
    sweep(JSON.stringify({ command: heredoc, description: '답변 올리기' }), ANSWER, 'Bash heredoc 입력');
    const qJson = JSON.stringify({ kind: 'question', question: '50명 넘게 발송됩니다.\n진행할까요?' });
    ok('livePreview() kind=question → 질문 글', F.livePreview(JSON.stringify({ file_path: 'r.json', content: qJson })) === '50명 넘게 발송됩니다.\n진행할까요?');
    ok('livePreview() "type":"answer" 로 적어도 읽음', F.livePreview(JSON.stringify({ file_path: 'r.json', content: JSON.stringify({ type: 'answer', answer: '가나다' }) })) === '가나다');
    const nulls = [
        JSON.stringify({ file_path: 'r.json', content: JSON.stringify({ kind: 'approval', summary: '쿠폰 발급', answer: '이건 보이면 안 됨' }) }),
        JSON.stringify({ file_path: 'r.json', content: JSON.stringify({ kind: 'ocr', items: [{ name: '황금향', qty: 3 }] }) }),
        JSON.stringify({ file_path: 'q.js', content: 'const a = 1; console.log("answer")' }),
        JSON.stringify({ command: 'node scripts/desk/get.js 12', description: '받기' }),
        '', '{', '{"file_path":"r.json","conte',
    ];
    ok('livePreview() kind가 answer/question이 아니거나 결과 파일이 아니면 null', nulls.every(x => { try { return F.livePreview(x) === null; } catch (e) { return false; } }), nulls.map(x => { try { return String(F.livePreview(x)); } catch (e) { return 'THROW'; } }).join(','));

    // stepText
    const B = (command, description) => F.stepText('Bash', { command, description });
    ok('stepText() respond/get/step = null(화면에 안 올림)', B('node scripts/desk/respond.js 1 r.json') === null && B('cd x && node scripts/desk/get.js 944') === null && B('node scripts/desk/step.js 1 조회 중') === null);
    const st = {
        qty: B('node scripts/desk/qty-image.js'), scen: B('node scripts/desk/scenario-edit.js list'), hig: B('higgsfield generate --model gpt_image_2_5'),
        tp: B('node scripts/desk/talk-pending.js'), ts: B('node scripts/desk/talk-send.js x.json'), pt: B('node scripts/desk/points.js lookup 010'),
        ff: B('ffmpeg -i a.mp4 b.mp4'), xl: B('node make.js out.xlsx'), sql: B('node -e "pool.query(\'SELECT 1\')"'),
        ko: B('ls', '업무지식 확인'), en: B('ls -la', 'List files'), none: B('ls'), ps: F.stepText('PowerShell', { command: 'Get-ChildItem' }),
    };
    const hasKo = s => typeof s === 'string' && /[가-힣]/.test(s);
    ok('stepText() qty-image·scenario-edit·higgsfield·talk·points·ffmpeg·xlsx·SQL = 한국어 문구', ['qty', 'scen', 'hig', 'tp', 'ts', 'pt', 'ff', 'xl', 'sql'].every(k => hasKo(st[k])) && /중간발주/.test(st.qty) && /시나리오/.test(st.scen) && /그림|영상/.test(st.hig), JSON.stringify(st));
    ok('stepText() 창구가 붙인 description은 한국어여도 화면에 안 올림 — 한국어·영어·없음 모두 「자료 확인 중」', st.ko === '⚙️ 자료 확인 중' && /자료 확인 중/.test(st.en) && /자료 확인 중/.test(st.none) && /자료 확인 중/.test(st.ps));
    ok('stepText() Read(이미지·업무지식)·Write(.json = 답변 정리)·WebSearch 문구 · Grep/Glob/모르는 도구 = null · 입력 없음도 예외 0',
        /이미지/.test(F.stepText('Read', { file_path: 'C:/a/받은파일/12.PNG' })) && /업무 기준/.test(F.stepText('Read', { file_path: 'x/업무지식.md' })) && F.stepText('Read', { file_path: 'a.js' }) === null
        && /답변 정리/.test(F.stepText('Write', { file_path: 'r.json' })) && /파일 작성/.test(F.stepText('Write', { file_path: 'a.md' })) && /자료 찾는/.test(F.stepText('WebSearch', {}))
        && F.stepText('Grep', {}) === null && F.stepText('Glob', {}) === null && F.stepText('Task', {}) === null && F.stepText('Bash') !== undefined && F.stepText('Read') === null);
    ok('stepText() 문구에 영어 명령·경로가 새지 않음', Object.values(st).filter(Boolean).every(s => !/node |scripts\/|\.js|ls -la/.test(s)));

    // streamWatcher — 실제 기록 파일
    const logs = [path.join(os.homedir(), '.akkome', 'logs', 'probe-498-stream.jsonl'), path.join(os.homedir(), '.akkome', 'logs', 'order-953.log')];
    for (const file of logs) {
        if (!fs.existsSync(file)) { info(`streamWatcher 실파일 건너뜀(없음): ${file}`); continue; }
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
        const got = { step: [], live: [], result: [] }; let threw = 0, firstErr = '', jsonLines = 0;
        const w = F.streamWatcher({ onStep: t => got.step.push(t), onLive: t => got.live.push(t), onResult: r => got.result.push(r) });
        for (const l of lines) { if (l.trim().startsWith('{')) jsonLines++; try { w.line(l); } catch (e) { threw++; if (!firstErr) firstErr = e.message + ' ← ' + l.slice(0, 80); } }
        await sleep(1400);
        if (!jsonLines) { info(`streamWatcher 실파일 건너뜀(stream-json 형식 아님): ${path.basename(file)}`); continue; }
        ok(`streamWatcher() ${path.basename(file)} ${lines.length}줄 — 예외 0 · onResult 1회 · onStep 문구는 전부 한국어`, threw === 0 && got.result.length === 1 && got.step.length >= 1 && got.step.every(hasKo) && !got.step.some(t => /헬퍼|DB|찾기/.test(t)),
            `예외 ${threw}${firstErr ? '(' + firstErr + ')' : ''} · 단계 ${got.step.length}개 [${got.step.join(' | ')}] · 미리보기 ${got.live.length}회 · 결과 ${JSON.stringify(got.result[0] || null)}`);
    }
    // streamWatcher — 만든 흐름(Write 입력이 조각조각 옴)
    {
        const got = { step: [], live: [], result: [] };
        const w = F.streamWatcher({ onStep: t => got.step.push(t), onLive: t => got.live.push(t), onResult: r => got.result.push(r) });
        const ev = e => JSON.stringify({ type: 'stream_event', event: e, session_id: 's' });
        let threw = 0;
        const feed = l => { try { w.line(l); } catch (e) { threw++; } };
        feed(''); feed('Permission deny rule (.claude\\settings.json): …');   // JSON이 아닌 줄
        feed(JSON.stringify({ type: 'system', subtype: 'init' }));
        feed(ev({ type: 'message_start', message: {} }));
        feed(ev({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'Bash', input: {} } }));
        feed(ev({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"node scripts/desk/qty-image.js"}' } }));
        feed(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'node scripts/desk/qty-image.js' } }] } }));
        feed(ev({ type: 'content_block_stop', index: 0 }));
        feed(ev({ type: 'message_start', message: {} }));
        feed(ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't2', name: 'Write', input: {} } }));
        for (let i = 0; i < writeInput.length; i += 7) { feed(ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: writeInput.slice(i, i + 7) } })); if (i % 70 === 0) await sleep(260); }
        feed(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Write', input: JSON.parse(writeInput) }] } }));
        feed(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.1, num_turns: 3, duration_api_ms: 999 }));
        await sleep(1500);
        const grow = got.live.every((t, i) => i === 0 || (t.length > got.live[i - 1].length && t.startsWith(got.live[i - 1])));
        ok('streamWatcher() 만든 흐름 — 단계 2개(중간발주·답변 정리) · 미리보기가 점점 길어지다 전체 답으로 끝남 · 결과 1회 · 예외 0',
            threw === 0 && got.step.length === 2 && /중간발주/.test(got.step[0]) && /답변 정리/.test(got.step[1]) && got.live.length >= 2 && grow && got.live[got.live.length - 1] === ANSWER && got.result.length === 1 && got.result[0].turns === 3,
            `예외 ${threw} · 단계 ${JSON.stringify(got.step)} · 미리보기 ${got.live.length}회(길이 ${got.live.map(t => t.length).join('→')}) · 정답 길이 ${ANSWER.length}`);
        let cbThrew = false; try { const w2 = F.streamWatcher({ onStep() { throw new Error('x'); }, onResult() { throw new Error('y'); } }); w2.line(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } })); w2.line(JSON.stringify({ type: 'result' })); } catch (e) { cbThrew = true; }
        ok('streamWatcher() 받는 쪽 함수가 오류를 내도 읽기는 멈추지 않음', !cbThrew);
    }

    // qtyAnswer
    const P1 = 'C:\\x\\받은파일\\중간발주_대성(시온)_1002.png', P2 = 'C:\\x\\받은파일\\중간발주_효돈농협_1002.png', P3 = 'C:\\x\\받은파일\\중간발주_미매칭_1002.png', J = 'C:\\x\\받은파일\\중간발주_러너결과_1002.json';
    const head = `중간발주 집계 — 조회 2026-10-02 09:12 KST · 주문 네이버 351 · 자사몰 6 · 쿠팡 0\n\n[대성(시온)] 합계 224박스\n   120  황금향 가정용 - 3kg\n   104  황금향 선물용 - 5kg\n\n[효돈농협] 합계 219박스\n   219  하우스감귤 선물용 - 3kg(로얄과)\n`;
    const outA = head + `\n파일 2개: ${P1} · ${P2}\n\n` + JSON.stringify({ at: '2026-10-02 09:12', counts: { naver: 351, cafe24: 6, coupang: 0 }, errors: [], partners: {}, unmatched: [], noOrder: {}, files: [P1, P2, J] }) + '\n';
    const a = F.qtyAnswer(outA);
    ok('qtyAnswer() 견본 → 제목(조회 시각)·거래처별 수량 글·첨부는 png만', a.title === '중간발주 집계 (10-02 09:12)' && /\[대성\(시온\)\] 합계 224박스/.test(a.answer) && /219 {2}하우스감귤/.test(a.answer) && a.attachments.length === 2 && a.attachments.every(f => /\.png$/.test(f)) && !/파일 2개:/.test(a.answer) && !/"counts"/.test(a.answer) && !/미매칭/.test(a.answer) && /선택분 이미지 저장/.test(a.answer), a.title);
    const outB = head + `\n[미매칭] 합계 3박스 — 품목별 금액에 없는 옵션(수기 확인)\n     2  [네이버] 제주 레몬3kg(중소과)\n     1  [자사몰] 개인결제창\n\n파일 3개: ${P1} · ${P2} · ${P3}\n\n` + JSON.stringify({ at: '2026-10-02 09:12', counts: {}, errors: [{ ch: 'coupang', error: 'x' }], partners: {}, unmatched: [{ name: '[네이버] 제주 레몬3kg(중소과)', qty: 2 }, { name: '[자사몰] 개인결제창', qty: 1 }], files: [P1, P2, P3] });
    const b = F.qtyAnswer(outB.replace(/\n/g, '\r\n'));
    ok('qtyAnswer() 미매칭 있으면 경고 문장(합계 박스 수) · 채널 오류 경고 · 줄바꿈 CRLF도 읽음', /⚠️ 미매칭 3박스/.test(b.answer) && /일부 채널을 불러오지 못했어요\(1곳\)/.test(b.answer) && b.attachments.length === 3);
    let qThrew = ''; try { F.qtyAnswer('ERR 러너 응답 없음\n'); } catch (e) { qThrew = e.message; }
    ok('qtyAnswer() 결과 줄이 없으면 오류로 알림(빈 답을 만들지 않음)', /읽지 못했습니다/.test(qThrew));
    const many = F.qtyAnswer('x\n' + JSON.stringify({ at: '2026-10-02 09:12', files: Array.from({ length: 9 }, (_, i) => `a${i}.png`) }));
    ok('qtyAnswer() 첨부는 5개까지', many.attachments.length === 5);
}

// ───────────────────────────── ② 화면 ─────────────────────────────
async function ui() {
    console.log('\n── ② 화면 (로컬 실서버 ' + PORT + ' · API 가로채기)');
    let srv = null, browser = null;
    try {
        const jwt = require('jsonwebtoken');
        const env = { ...process.env, JWT_SECRET: 'verifytest', PORT: String(PORT) };
        delete env.ANTHROPIC_API_KEY; delete env.RENDER;
        srv = spawn(process.execPath, ['-e', `global.setInterval=()=>({unref(){},ref(){}}); process.env.ANTHROPIC_API_KEY=''; require('./server.js');`],
            { cwd: ROOT, env, stdio: ['ignore', fs.openSync(path.join(os.tmpdir(), 'desk498-server.log'), 'w'), fs.openSync(path.join(os.tmpdir(), 'desk498-server.err'), 'w')] });
        let up = false;
        for (let i = 0; i < 60; i++) { await sleep(1000); try { const r = await fetch(`http://localhost:${PORT}/`); if (r.status) { up = true; break; } } catch (_) { } }
        ok('로컬 실서버 기동(' + PORT + ')', up);
        if (!up) throw new Error('server not up');
        // 로그인 우회용 계정 = 실제 대표 계정(읽기만) — 없는 id로는 앱이 로그인 화면으로 돌아간다
        const { Client } = require('pg');
        const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        await db.connect();
        const ceo = (await db.query(`SELECT id, name FROM users WHERE position='대표' AND deleted_at IS NULL LIMIT 1`)).rows[0];
        await db.end();
        const user = { id: ceo.id, name: ceo.name, position: '대표', role: 'admin' };
        const tok = jwt.sign(user, 'verifytest', { expiresIn: '20m' });

        const T0 = new Date().toISOString();
        const stepsOf = n => ['📥 지시 접수 — 검증498', '🔎 회사프로그램 자료 조회 중', '✍️ 답변 정리 중', '⚙️ 업무지식 확인'].slice(0, n).map((text, i) => ({ t: new Date(Date.now() - (n - i) * 20000).toISOString(), kind: i ? 'step' : 'order', actor: '클코', text }));
        const LIVE1 = '판매현황에서 지금 판매중인 품목은 27개입니다.\n황금향 6종';
        const LIVE2 = LIVE1 + ' · 하우스감귤 5종 · 유라조생 9종 · 그린레몬 3종 · 레드키위 3종 · 대용량 1종입니다.\n<b>굵게</b> 같은 글자도 그대로 보입니다.';
        const LIVE_LONG = LIVE2 + '\n' + Array.from({ length: 60 }, (_, i) => `${i + 1}번째 줄 — 품목 이름과 판매가가 길게 이어지는 줄입니다 황금향 가정용 3kg 33,500원`).join('\n');
        const base = (id, content) => ({ id, content, status: '처리중', created_at: T0, processed_at: null, created_by: '검증498', created_by_id: user.id, has_image: false, reply_to: null, steps: stepsOf(3), result: { type: 'live', text: LIVE1 } });
        const old = { id: 990000, content: '어제 끝난 지시', status: '완료', created_at: T0, processed_at: T0, created_by: '검증498', created_by_id: user.id, has_image: false, reply_to: null, steps: stepsOf(2), result: { type: 'desk_answer', title: '끝난 답', answer: '이미 끝난 답변' } };

        const { chromium } = require('playwright');
        browser = await chromium.launch();
        const open = async (vw, extra, firstOrders) => {
            const st = { orders: firstOrders || [base(990001, '판매현황에서 지금 판매중인 품목이 몇 개인지 알려줘'), old], gets: 0, posts: [], writes: [] };
            const ctx = await browser.newContext(Object.assign({ viewport: vw }, extra || {}));
            try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${PORT}` }); } catch (_) { }
            const pg = await ctx.newPage();
            const errors = [], cons = [];
            pg.on('pageerror', e => errors.push(String(e)));
            pg.on('console', m => { if (m.type() === 'error') cons.push(m.text().slice(0, 200)); });
            pg.on('dialog', d => d.accept());
            const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
            // 쓰기 요청은 전부 막는다(실DB 무변경) — 나중에 등록한 규칙이 먼저 걸린다
            await pg.route('**/api/**', route => { const rq = route.request(); if (rq.method() === 'GET') return route.continue(); st.writes.push(rq.method() + ' ' + new URL(rq.url()).pathname); return json(route, { ok: true }); });
            await pg.route('**/api/agent-office/desk/orders*', route => { if (route.request().method() !== 'GET') return json(route, { ok: true }); st.gets++; return json(route, { orders: st.orders }); });
            await pg.route('**/api/agent-office/orders', route => {
                const rq = route.request();
                if (rq.method() !== 'POST') return route.continue();
                let body = null; try { body = JSON.parse(rq.postData() || '{}'); } catch (_) { }
                st.posts.push(body);
                const o = { id: 990100 + st.posts.length, content: body && body.content, status: '대기', created_at: new Date().toISOString(), processed_at: null, created_by: '검증498', created_by_id: user.id, has_image: false, reply_to: null, steps: [], result: null };
                st.orders = [o, ...st.orders];
                return json(route, { ok: true, engine: 'desk', order: o });
            });
            await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
            await pg.evaluate(([t, u]) => { localStorage.setItem('jwt_token', t); localStorage.setItem('jwt_user', JSON.stringify(u)); localStorage.setItem('akm_last_page', 'agent-office'); localStorage.setItem('akm_desk_view', 'table'); }, [tok, user]);
            await pg.reload({ waitUntil: 'networkidle' });
            await pg.waitForTimeout(2500);
            await pg.evaluate(() => { const n = document.querySelector('.nav-item[data-page="agent-office"]'); if (n) n.click(); else if (typeof switchPage === 'function') switchPage('agent-office'); });
            await pg.waitForSelector('#desk-list .desk-card, #desk-list .desk-table, #desk-list .desk-empty', { timeout: 20000 });
            await pg.waitForTimeout(800);
            return { pg, st, errors, cons, ctx };
        };
        const shot = async (pg, name) => { if (!SHOT) return; try { fs.mkdirSync(SHOT, { recursive: true }); await pg.screenshot({ path: path.join(SHOT, 'r2-' + name + '.png'), fullPage: false }); } catch (e) { info('스크린샷 실패: ' + e.message); } };
        // 표에서 그 줄의 상태를 읽는다(재렌더마다 selector로 다시 찾는다)
        const rowState = (pg, id) => pg.evaluate(id => {
            const tr = document.querySelector(`#desk-list tr.row[data-oid="${id}"]`);
            if (!tr) return { found: false };
            const d = tr.nextElementSibling && tr.nextElementSibling.classList.contains('detailrow') ? tr.nextElementSibling : null;
            const live = d && d.querySelector('.desk-a.answer.live');
            const vis = el => !!el && el.getClientRects().length > 0;
            const sc = live && live.querySelector('.desk-live-scroll');
            const wrap = document.querySelector('#desk-list .table-scroll-wrapper');
            const lr = live ? live.getBoundingClientRect() : null, wr = wrap ? wrap.getBoundingClientRect() : null;
            return {
                found: true, opened: tr.classList.contains('opened'), detail: !!d, badge: (tr.querySelector('.desk-badge') || {}).textContent, line: (tr.querySelector('.c-r') || {}).textContent,
                live: vis(live), liveText: live ? live.textContent : '', liveHtmlHasTag: live ? !!live.querySelector('b') : false, caret: vis(d && d.querySelector('.desk-caret')),
                label: live ? (live.querySelector('.desk-a-label') || {}).textContent : '', steps: d ? Array.from(d.querySelectorAll('.desk-steps li')).map(x => x.textContent.trim()) : [],
                working: d ? (d.querySelector('.desk-working') || {}).textContent : '', anyLive: document.querySelectorAll('#desk-list .live').length,
                answerLabel: d ? Array.from(d.querySelectorAll('.desk-a.answer .desk-a-label')).map(x => x.textContent) : [], answerText: d ? Array.from(d.querySelectorAll('.desk-a.answer')).map(x => x.textContent).join('|') : '',
                inWrap: lr && wr ? lr.left >= wr.left - 1 && lr.right <= wr.right + 1 : null, liveH: lr ? Math.round(lr.height) : 0, liveScroll: sc ? sc.scrollTop : 0, liveScrollMax: sc ? sc.scrollHeight - sc.clientHeight : 0, scH: sc ? Math.round(sc.getBoundingClientRect().height) : 0,
                labelSeen: (() => { const lb = live && live.querySelector('.desk-a-label'); if (!lb || !lr) return false; const b = lb.getBoundingClientRect(); return b.height > 8 && b.top >= lr.top - 1 && b.bottom <= lr.bottom + 1 && !(sc && sc.contains(lb)); })(),
                xOverflow: document.documentElement.scrollWidth > window.innerWidth + 2, rootOverflow: document.getElementById('ao-desk-root').scrollWidth > window.innerWidth + 2,
            };
        }, id);
        const waitFor = async (fn, ms) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(250); } return null; };

        // (a) 1440px 표 — 자동 펼침 + 쓰는 중인 답변 + 직전 단계
        const A = await open({ width: 1440, height: 900 });
        const a = await rowState(A.pg, 990001);
        ok('(a) 처리중인 내 지시 줄이 누르지 않아도 펼쳐짐(1440px 표)', a.found && a.opened && a.detail, `배지 ${a.badge}`);
        ok('(a) .desk-a.answer.live 에 쓰는 중인 글 + 커서 · 머리말 「클코 답변 · 쓰는 중」', a.live && a.liveText.includes('판매중인 품목은 27개') && a.caret && /쓰는 중/.test(a.label || ''), `글 ${a.liveText.length}자 · 커서 ${a.caret}`);
        ok('(a) 직전 단계 목록 3개 표시 · 안내 「답변을 쓰고 있어요」', a.steps.length === 3 && /자료 조회 중/.test(a.steps[1]) && /답변을 쓰고/.test(a.working || ''), a.steps.join(' / '));
        ok('(a) 끝난 다른 지시는 펼쳐지지 않음 · live 칸은 1개뿐', a.anyLive === 1 && !(await rowState(A.pg, 990000)).opened);
        ok('(a) live 칸이 표 너비 안 · 가로 넘침 없음', a.inWrap === true && !a.xOverflow && !a.rootOverflow);
        await shot(A.pg, '498-a-1440-live');

        // (b) 글이 길어진 다음 응답 → 화면 글도 길어짐(누르지 않고 2초 주기 새로고침만으로)
        const g0 = A.st.gets, tB = Date.now();
        A.st.orders = [Object.assign(base(990001, A.st.orders[0].content), { steps: stepsOf(3), result: { type: 'live', text: LIVE2 } }), old];
        const b = await waitFor(async () => { const s = await rowState(A.pg, 990001); return s.liveText.includes('레드키위 3종') ? s : null; }, 8000);
        ok('(b) 다음 응답에서 글이 길어지면 화면 글도 길어짐(자동 새로고침)', !!b && b.opened && b.live && b.caret, b ? `${((Date.now() - tB) / 1000).toFixed(1)}초 뒤 반영 · ${b.liveText.length}자` : '8초 안에 안 바뀜');
        ok('(b) 답 안의 꺾쇠 글자는 태그가 아니라 글자로 보임', !!b && !b.liveHtmlHasTag && b.liveText.includes('<b>굵게</b>'));
        await sleep(6200);
        const perSec = (A.st.gets - g0) / ((Date.now() - tB) / 1000);
        ok('(b) 진행 중에는 약 2초마다 목록 새로고침', perSec > 0.33 && perSec < 0.8, `${A.st.gets - g0}회 / ${((Date.now() - tB) / 1000).toFixed(1)}초`);
        // 긴 글: 칸 높이 제한·스크롤 위치(관찰)
        A.st.orders = [Object.assign(base(990001, A.st.orders[0].content), { result: { type: 'live', text: LIVE_LONG } }), old];
        const bl = await waitFor(async () => { const s = await rowState(A.pg, 990001); return s.liveText.includes('60번째 줄') ? s : null; }, 8000);
        ok('(b) 긴 글 — 글 칸(.desk-live-scroll) 높이 300px 이하에서 안쪽 스크롤 · 가로 넘침 없음', !!bl && bl.scH <= 302 && bl.liveH <= 360 && bl.liveScrollMax > 0 && !bl.xOverflow, bl ? `글 칸 ${bl.scH}px · 답변 칸 전체 ${bl.liveH}px · 스크롤 여유 ${bl.liveScrollMax}px` : '');
        ok('(b) 긴 글 — 맨 아래로 내려가 있어도 머리말 「클코 답변 · 쓰는 중」은 잘리지 않고 보임(스크롤 밖 고정)', !!bl && bl.labelSeen && /쓰는 중/.test(bl.label || ''));
        await shot(A.pg, '498-b-1440-long');
        // 스크롤: 긴 글은 맨 아래(지금 쓰는 곳)를 따라간다 · 위로 올려 읽던 중이면 그 자리
        const atBottom = s => !!s && s.liveScrollMax > 0 && s.liveScrollMax - s.liveScroll < 3;
        const setLive = text => { A.st.orders = [Object.assign(base(990001, A.st.orders[0].content), { result: { type: 'live', text } }), old]; };
        const liveHas = (word, ms) => waitFor(async () => { const s = await rowState(A.pg, 990001); return s.liveText.includes(word) ? s : null; }, ms || 8000);
        const TAIL = n => LIVE_LONG + Array.from({ length: n }, (_, i) => `\n${61 + i}번째 줄 추가`).join('');
        ok('(b) 긴 글 — 칸이 맨 아래(지금 쓰는 글이 보임)', atBottom(bl), bl ? `${bl.liveScroll}/${bl.liveScrollMax}` : '');
        const caretSeen = await A.pg.evaluate(() => { const l = document.querySelector('#desk-list [data-live]'), c = l && l.querySelector('.desk-caret'); if (!c) return false; const a = l.getBoundingClientRect(), b = c.getBoundingClientRect(); return b.bottom <= a.bottom + 1 && b.top >= a.top - 1; });
        ok('(b) 긴 글 — 커서가 칸 안 보이는 자리에 있음', caretSeen);
        setLive(TAIL(3));
        const bl2 = await liveHas('63번째 줄');
        ok('(b) 글이 더 길어져도 맨 아래를 따라감', atBottom(bl2) && bl2.liveScrollMax > bl.liveScrollMax, bl2 ? `${bl2.liveScroll}/${bl2.liveScrollMax}` : '');
        await A.pg.evaluate(() => { const l = document.querySelector('#desk-list [data-live]'); l.scrollTop = 200; });
        setLive(TAIL(5));
        const bl3 = await liveHas('65번째 줄');
        ok('(b) 사용자가 위로 올려 읽는 중이면 새로고침 뒤에도 그 자리(200px) 유지', !!bl3 && Math.abs(bl3.liveScroll - 200) <= 2 && bl3.liveScrollMax > bl2.liveScrollMax, bl3 ? `${bl3.liveScroll}/${bl3.liveScrollMax}` : '');
        await A.pg.evaluate(() => { const l = document.querySelector('#desk-list [data-live]'); l.scrollTop = l.scrollHeight; });
        setLive(TAIL(6));
        const bl4 = await liveHas('66번째 줄');
        ok('(b) 다시 맨 아래로 내리면 그 뒤로는 또 따라감', atBottom(bl4), bl4 ? `${bl4.liveScroll}/${bl4.liveScrollMax}` : '');
        // 글자를 끌어 고르는 중에는 다시 그리지 않는다 → 고른 것이 유지 · 풀면 다음 주기에 최신 글
        const selText = await A.pg.evaluate(() => {
            const l = document.querySelector('#desk-list [data-live]'); l.scrollTop = 0;
            const tw = document.createTreeWalker(l, NodeFilter.SHOW_TEXT); let tn = null;
            while (tw.nextNode()) { if (tw.currentNode.textContent.includes('판매중인 품목은 27개')) { tn = tw.currentNode; break; } }
            if (!tn) return '(글 노드 못 찾음)';
            const i = tn.textContent.indexOf('판매중인 품목은 27개');
            const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + 12);
            const g = window.getSelection(); g.removeAllRanges(); g.addRange(r);
            return String(g);
        });
        const gS = A.st.gets;
        setLive(TAIL(6) + '\n선택 중에 온 새 글 67번째 줄');
        await waitFor(async () => A.st.gets >= gS + 2, 9000);
        await sleep(300);
        const sel1 = await A.pg.evaluate(() => ({ sel: String(window.getSelection()), has67: document.querySelector('#desk-list [data-live]').textContent.includes('67번째 줄') }));
        ok('(b) 글자를 끌어 고른 상태 — 새로고침 2회가 와도 고른 것이 유지(다시 그리지 않음)', selText === '판매중인 품목은 27개' && sel1.sel === selText && sel1.has67 === false, `고른 글 「${sel1.sel}」 · 새 글 반영 ${sel1.has67} · 요청 ${A.st.gets - gS}회`);
        await A.pg.evaluate(() => window.getSelection().removeAllRanges());
        const sel2 = await liveHas('67번째 줄', 6000);
        ok('(b) 고르기를 풀면 다음 주기에 최신 글로 그려짐', !!sel2);

        // (d) 사용자가 접으면 다음 새로고침에 다시 펼치지 않음
        await A.pg.click('#desk-list tr.row[data-oid="990001"] .c-q');
        const d1 = await rowState(A.pg, 990001);
        A.st.orders = [Object.assign(base(990001, A.st.orders[0].content), { steps: stepsOf(4), result: { type: 'live', text: LIVE_LONG + '\n접힌 동안 온 68번째 줄' } }), old];
        const gD = A.st.gets;
        await waitFor(async () => A.st.gets >= gD + 2, 9000);
        await sleep(400);
        const d2 = await rowState(A.pg, 990001);
        ok('(d) 줄을 눌러 접음 → 그 뒤 새로고침 2회(단계·글이 바뀜)에도 다시 펼쳐지지 않음', d1.found && !d1.opened && !d2.opened && d2.anyLive === 0, `접은 직후 ${d1.opened} · 새로고침 뒤 ${d2.opened} · 결과 칸 「${(d2.line || '').trim()}」`);
        ok('(d) 접힌 줄의 결과 칸에 마지막 단계가 보임', /업무지식 확인/.test(d2.line || ''));
        await A.pg.click('#desk-list tr.row[data-oid="990001"] .c-q');
        const d3 = await rowState(A.pg, 990001);
        ok('(d) 다시 누르면 펼쳐지고 쓰는 중인 글이 보임', d3.opened && d3.live && d3.liveText.includes('68번째 줄'));
        // 새로 처리중이 된 다른 지시는 따로 한 번 펼쳐진다
        A.st.orders = [base(990002, '두 번째 지시'), ...A.st.orders];
        const d4 = await waitFor(async () => { const s = await rowState(A.pg, 990002); return s.found && s.opened ? s : null; }, 8000);
        ok('(d) 새로 처리중이 된 다른 지시는 그 줄도 한 번 자동으로 펼쳐짐', !!d4 && d4.live);
        A.st.orders = A.st.orders.filter(o => o.id !== 990002);

        // (c) 완료 + desk_answer → live 사라지고 「클코 답변」
        A.st.orders = [Object.assign(base(990001, A.st.orders[0].content), { status: '완료', processed_at: new Date().toISOString(), steps: stepsOf(4), result: { type: 'desk_answer', title: '판매중 품목 27개', answer: LIVE2 } }), old];
        const c = await waitFor(async () => { const s = await rowState(A.pg, 990001); return s.found && s.anyLive === 0 && s.answerLabel.includes('클코 답변') ? s : null; }, 10000);
        ok('(c) 완료로 바뀌면 live·커서가 사라지고 「클코 답변」 + 제목·전체 글 (펼친 채 유지)', !!c && c.opened && !c.live && !c.caret && c.answerText.includes('판매중 품목 27개') && c.answerText.includes('레드키위 3종') && /완료/.test(c.badge || ''), c ? `머리말 ${JSON.stringify(c.answerLabel)}` : '10초 안에 안 바뀜');
        const cDom = await A.pg.evaluate(() => ({ caret: document.querySelectorAll('#desk-list .desk-caret').length, working: Array.from(document.querySelectorAll('#desk-list tr.row[data-oid="990001"] ~ tr.detailrow .desk-working')).length }));
        ok('(c) 완료 뒤 화면에 커서 0개', cDom.caret === 0);
        await shot(A.pg, '498-c-1440-done');
        // 완료 뒤에는 새로고침이 느려진다(12초) — 관찰
        const gC = A.st.gets; await sleep(5000);
        info(`관찰: 진행 중 지시가 없을 때 5초간 목록 요청 ${A.st.gets - gC}회(느린 주기로 돌아감)`);

        // (f) 「중간발주 바로 받기」
        const btn = await A.pg.evaluate(() => { const b = document.getElementById('desk-qty-now'); return b ? { vis: b.getClientRects().length > 0, text: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height) } : null; });
        ok('(f) #desk-qty-now 버튼이 보임', !!btn && btn.vis, btn ? `「${btn.text}」 높이 ${btn.h}px` : '없음');
        await A.pg.click('#desk-qty-now');
        const f = await waitFor(async () => A.st.posts.length ? A.st.posts : null, 5000);
        ok("(f) 클릭 → POST /api/agent-office/orders 본문 content = '중간발주 뽑아줘' · 1회만", !!f && f.length === 1 && f[0] && f[0].content === '중간발주 뽑아줘' && Object.keys(f[0]).join() === 'content', JSON.stringify(f));
        const f2 = await waitFor(async () => { const s = await rowState(A.pg, 990101); return s.found ? s : null; }, 6000);
        ok('(f) 보낸 지시가 목록 맨 위에 「대기」로 보임', !!f2 && /대기|기다리/.test((f2.badge || '') + (f2.line || '')), f2 ? `${f2.badge} · ${(f2.line || '').trim()}` : '');
        ok('(f) 보낸 지시와 fast.route() 판정이 맞물림(direct_qty)', F.route({ content: f && f[0] && f[0].content, status: '대기' }).lane === 'direct_qty');
        ok('(g) 1440px — pageerror 0 · console error 0', A.errors.length === 0 && A.cons.length === 0, [...A.errors, ...A.cons].join(' | ').slice(0, 400));
        info('가로챈 쓰기 요청(실서버 미도달): ' + (A.st.writes.length ? A.st.writes.join(', ') : '없음') + ` · POST orders ${A.st.posts.length}회`);
        await A.ctx.close();

        // (e) 1000px 카드
        const E = await open({ width: 1000, height: 900 });
        const cardState = id => E.pg.evaluate(id => {
            const c = document.querySelector(`#desk-list .desk-card[data-oid="${id}"]`);
            if (!c) return { found: false, table: !!document.querySelector('#desk-list .desk-table') };
            const live = c.querySelector('.desk-a.answer.live'); const vis = el => !!el && el.getClientRects().length > 0;
            const cr = c.getBoundingClientRect(), lr = live ? live.getBoundingClientRect() : null;
            return { found: true, live: vis(live), text: live ? live.textContent : '', caret: vis(c.querySelector('.desk-caret')), steps: c.querySelectorAll('.desk-steps li').length, inCard: lr ? lr.left >= cr.left - 1 && lr.right <= cr.right + 1 : null,
                xOverflow: document.documentElement.scrollWidth > window.innerWidth + 2, rootOverflow: document.getElementById('ao-desk-root').scrollWidth > window.innerWidth + 2, liveH: lr ? Math.round(lr.height) : 0 };
        }, id);
        const e1 = await cardState(990001);
        ok('(e) 1000px 카드에서도 쓰는 중인 글 + 커서 표시', e1.found && e1.live && e1.text.includes('판매중인 품목은 27개') && e1.caret, e1.found ? `글 ${e1.text.length}자 · 단계 ${e1.steps}개` : '카드 없음(표로 보임: ' + e1.table + ')');
        ok('(e) 카드 안에 들어감 · 가로 넘침 없음', e1.inCard === true && !e1.xOverflow && !e1.rootOverflow);
        E.st.orders = [Object.assign(base(990001, E.st.orders[0].content), { result: { type: 'live', text: LIVE_LONG } }), old];
        const e2 = await waitFor(async () => { const s = await cardState(990001); return s.found && s.text.includes('60번째 줄') ? s : null; }, 8000);
        ok('(e) 카드 — 글이 길어지면 따라 길어지고 답변 칸 높이 360px 이하(글 칸 300px) · 넘침 없음', !!e2 && e2.liveH <= 360 && !e2.xOverflow && e2.inCard === true, e2 ? `높이 ${e2.liveH}px` : '');
        await shot(E.pg, '498-e-1000-card');
        E.st.orders = [Object.assign(base(990001, E.st.orders[0].content), { status: '완료', processed_at: new Date().toISOString(), result: { type: 'desk_answer', answer: LIVE2 } }), old];
        const e3 = await waitFor(async () => { const n = await E.pg.evaluate(() => ({ live: document.querySelectorAll('#desk-list .live, #desk-list .desk-caret').length, ans: !!Array.from(document.querySelectorAll('#desk-list .desk-card[data-oid="990001"] .desk-a-label')).find(x => x.textContent === '클코 답변') })); return n.live === 0 && n.ans ? n : null; }, 10000);
        ok('(e) 카드 — 완료되면 live 사라지고 「클코 답변」', !!e3);
        // 390px 폰 너비(덤)
        await E.pg.setViewportSize({ width: 390, height: 800 });
        E.st.orders = [Object.assign(base(990001, E.st.orders[0].content), { result: { type: 'live', text: LIVE_LONG } }), old];
        const e4 = await waitFor(async () => { const s = await cardState(990001); return s.found && s.live ? s : null; }, 10000);
        ok('(e) 390px 폰 — live 표시 · 카드 안 · 가로 넘침 없음', !!e4 && e4.inCard === true && !e4.rootOverflow, e4 ? `높이 ${e4.liveH}px · 문서 넘침 ${e4.xOverflow}` : '');
        await shot(E.pg, '498-e-390-card');
        ok('(g) 1000px·390px — pageerror 0 · console error 0', E.errors.length === 0 && E.cons.length === 0, [...E.errors, ...E.cons].join(' | ').slice(0, 400));
        await E.ctx.close();

        // ── #498 4차: 답변 글 그리기(표·굵게·목록) · Enter 보내기 · 자주 쓰는 일 · 처리 길 표시
        const MD = ['## 거래처별 수량', '**대성(시온)** 합계 224박스입니다.', '',
            '| 품목 | 수량 | 비고 |', '|---|---:|---|',
            '| 황금향 가정용 - 3kg | 120 | **주력** |',
            '| <script>window.__xss=1</script> | 104 | <b>굵게아님</b> |',
            '| 아주아주 긴 품목 이름 과즙팡팡 황금향 / 상품 및 과수: 선물용 - 5kg(중대과 13~25과) 그리고 더 긴 설명이 붙은 품목 | 3 | 비고도 길게 적혀 있어서 좁은 화면에서는 표가 칸보다 넓어지는 경우를 본다 |',
            '', '- 첫째 항목', '- 둘째 **굵은** 항목', '', '1. 하나', '2. 둘', '', '---', '끝 <img src=x onerror="window.__xss=2"> 글',
            ...Array.from({ length: 8 }, (_, i) => `덧붙인 ${i + 1}번째 줄입니다.`)].join('\n');
        const tLane = new Date(Date.now() - 60000).toISOString(), tDone = new Date(Date.parse(tLane) + 12000).toISOString();
        const mdOrder = () => ({ id: 990010, content: '중간발주 표로 정리해줘', status: '완료', created_at: tLane, processed_at: tDone, created_by: '검증498', created_by_id: user.id, has_image: false, reply_to: null,
            steps: [{ t: tLane, kind: 'order', actor: '클코', text: '📥 지시 접수' }, { t: tLane, kind: 'lane', lane: 'sonnet', actor: '클코', text: '⚡ 빠른 답' }, { t: tDone, kind: 'report', actor: '클코', text: '✅ 답변 완료' }],
            result: { type: 'desk_answer', title: '거래처별 수량', answer: MD } });
        const liveMd = () => Object.assign(base(990011, '쓰는 중 표'), { steps: [...stepsOf(3), { t: tLane, kind: 'lane', lane: 'opus', actor: '클코', text: '🧠 꼼꼼한 답' }], result: { type: 'live', text: MD.split('\n').slice(0, 8).join('\n') } });
        // 답변 칸 상태(표·카드 공통): box = 그 지시의 줄(표면 자세히 칸, 카드면 카드)
        const mdState = (pg, id) => pg.evaluate(id => {
            const tr = document.querySelector(`#desk-list tr.row[data-oid="${id}"]`);
            const box = tr ? (tr.nextElementSibling && tr.nextElementSibling.classList.contains('detailrow') ? tr.nextElementSibling : null) : document.querySelector(`#desk-list .desk-card[data-oid="${id}"]`);
            if (!box) return { found: false, row: !!tr };
            const a = box.querySelector('.desk-a.answer'); if (!a) return { found: false, row: !!tr, noAnswer: true };
            const n = sel => a.querySelectorAll(sel).length;
            const tw = a.querySelector('.desk-md-tw'), ar = a.getBoundingClientRect(), br = box.getBoundingClientRect(), twr = tw ? tw.getBoundingClientRect() : null;
            const lane = a.querySelector('.desk-lane'), lr = lane ? lane.getBoundingClientRect() : null, lab = a.querySelector('.desk-a-label'), labr = lab ? lab.getBoundingClientRect() : null;
            const btn = box.querySelector('[data-act="toggle"]');
            const cs = getComputedStyle(a);
            return {
                found: true, table: n('table.desk-md-t'), th: n('.desk-md-t th'), td: n('.desk-md-t td'), strong: n('strong'), ul: n('ul.desk-md-l li'), ol: n('ol.desk-md-l li'), hr: n('hr'), hd: n('.desk-md-h'),
                nums: Array.from(a.querySelectorAll('.desk-md-t td')).filter(td => /^[0-9,]+$/.test(td.textContent.trim())).map(td => ({ t: td.textContent.trim(), num: td.classList.contains('num'), align: getComputedStyle(td).textAlign, right: Math.round(td.getBoundingClientRect().right) })),
                numHead: Array.from(a.querySelectorAll('.desk-md-t th')).map(th => getComputedStyle(th).textAlign),
                titleCount: a.textContent.split('거래처별 수량').length - 1, titleEl: a.querySelectorAll('.desk-a-title').length,
                stepTexts: Array.from(box.querySelectorAll('.desk-steps li')).map(x => x.textContent.trim()), working: (box.querySelector('.desk-working') || {}).textContent || '', rowLine: tr ? (tr.querySelector('.c-r') || {}).textContent.trim() : '',
                numSplit: Array.from(a.querySelectorAll('.desk-md-t td')).filter(td => /^[0-9,]+$/.test(td.textContent.trim())).filter(td => { const r = document.createRange(); r.selectNodeContents(td); return r.getClientRects().length > 1; }).map(td => td.textContent.trim()),
                bad: n('script') + n('img') + n('b') + n('iframe'), xss: typeof window.__xss, text: a.textContent,
                thText: Array.from(a.querySelectorAll('.desk-md-t th')).map(x => x.textContent.trim()), strongText: Array.from(a.querySelectorAll('strong')).map(x => x.textContent),
                aInBox: ar.left >= br.left - 1 && ar.right <= br.right + 1, twInA: twr ? twr.left >= ar.left - 1 && twr.right <= ar.right + 1 : null, twScroll: tw ? tw.scrollWidth - tw.clientWidth : 0,
                rootOverflow: document.getElementById('ao-desk-root').scrollWidth > window.innerWidth + 2, docOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
                lane: lane ? lane.textContent.trim() : null, laneInA: lr ? lr.right <= ar.right + 1 && lr.left >= ar.left - 1 : null, laneOverLabel: lr && labr ? !(lr.left >= labr.right - 1 || lr.top >= labr.bottom - 1 || lr.bottom <= labr.top + 1) : null,
                clamp: a.classList.contains('clamp'), pv: a.classList.contains('pv'), h: Math.round(ar.height), fullH: a.scrollHeight, hidden: cs.overflow === 'hidden',
                toggle: btn ? btn.textContent.trim() : null, toggleVis: !!btn && btn.getClientRects().length > 0, copyBtn: !!box.querySelector('[data-act="copy"]'), live: a.classList.contains('live'), caret: !!a.querySelector('.desk-caret'),
            };
        }, id);
        const structOk = m => m.found && m.table === 1 && m.th === 3 && m.td === 9 && m.strong === 3 && m.ul === 2 && m.ol === 2 && m.hr === 1 && m.hd === 1;
        const safeOk = m => m.found && m.bad === 0 && m.xss === 'undefined' && m.text.includes('<script>window.__xss=1</script>') && m.text.includes('<b>굵게아님</b>') && m.text.includes('<img src=x onerror="window.__xss=2">');

        // 1440px 표
        const M = await open({ width: 1440, height: 900 }, null, [mdOrder(), liveMd(), old]);
        await M.pg.click('#desk-list tr.row[data-oid="990010"] .c-q');
        const m1 = await mdState(M.pg, 990010);
        ok('(md) 표가 든 답 → 실제 표(th 3·td 9)·굵게 3·점 목록 2·번호 목록 2·제목 1·구분선 1 로 그려짐', structOk(m1), JSON.stringify({ table: m1.table, th: m1.th, td: m1.td, strong: m1.strong, ul: m1.ul, ol: m1.ol, hr: m1.hr, hd: m1.hd, thText: m1.thText, strongText: m1.strongText }));
        ok('(md) 답 안의 <script>·<b>·<img onerror> 는 글자로만 보임 — 태그 0 · 실행 0', safeOk(m1), `태그 ${m1.bad}개 · __xss ${m1.xss}`);
        ok('(md) 별표·세로줄 같은 기호가 화면에 남지 않음', m1.found && !/\*\*|\|---|^## /m.test(m1.text) && !m1.text.includes('| 품목'));
        ok('(md) 1440 — 표가 답변 칸 안 · 답변 칸이 줄 안 · 가로 넘침 없음', m1.aInBox && m1.twInA === true && !m1.rootOverflow && !m1.docOverflow, `표 안쪽 스크롤 여유 ${m1.twScroll}px`);
        ok('(md) 1440 — 표의 숫자 칸(120·104·3)이 두 줄로 쪼개지지 않음', m1.numSplit.length === 0, m1.numSplit.length ? '쪼개진 숫자: ' + m1.numSplit.join(', ') : '');
        ok('(md) 숫자 칸 3개 = .num · 오른쪽 정렬 · 오른쪽 끝이 같은 줄에 맞음 · 「---:」 머리글도 오른쪽', m1.nums.length === 3 && m1.nums.every(x => x.num && x.align === 'right') && new Set(m1.nums.map(x => x.right)).size === 1 && m1.numHead[1] === 'right', JSON.stringify(m1.nums) + ' 머리글 ' + m1.numHead.join('/'));
        ok('(md) 제목과 본문 첫 줄이 같은 글이면 한 번만 보임', m1.titleCount === 1 && m1.titleEl === 0, `「거래처별 수량」 ${m1.titleCount}번`);
        await M.pg.evaluate(() => { const r = document.querySelector('#desk-list tr.row[data-oid="990010"]'); if (r) r.scrollIntoView({ block: 'start' }); });
        await sleep(300);
        await shot(M.pg, '1-1440-표든답변');
        ok('(lane) 완료 건 답변 칸에 「⚡ 빠른 답 · 12초」 · 칸 안 · 머리말과 안 겹침', m1.lane === '⚡ 빠른 답 · 12초' && m1.laneInA === true && m1.laneOverLabel === false, String(m1.lane));
        ok('(md) 펼친 자세히 칸은 줄이지 않음(전체 보기 버튼 없음) · 답변 복사 버튼 있음', !m1.clamp && m1.toggle === null && m1.copyBtn);
        await M.pg.click('#desk-list tr.row[data-oid="990010"] + tr.detailrow [data-act="copy"]');
        await sleep(400);
        const clip = await M.pg.evaluate(() => navigator.clipboard.readText().catch(e => 'ERR ' + e.message));
        const clipN = String(clip).replace(/\r\n/g, '\n'); let dAt = -1; for (let i = 0; i < Math.max(clipN.length, MD.length); i++) if (clipN[i] !== MD[i]) { dAt = i; break; }
        ok('(md) [답변 복사] = 꾸미기 전 원문 그대로(기호·태그 글자 포함)', clipN === MD, clipN === MD ? `${clipN.length}자 일치` + (clip !== clipN ? ' (윈도 클립보드가 줄바꿈을 CRLF로 바꾼 것만 다름)' : '') : `첫 차이 ${dAt}번째 글자: 복사본 ${JSON.stringify(clipN.slice(dAt, dAt + 30))} / 원문 ${JSON.stringify(MD.slice(dAt, dAt + 30))}`);
        await sleep(3200);   // 「복사했어요」 토스트가 사라진 뒤
        const lv = await mdState(M.pg, 990011);
        ok('(md) 쓰는 중인 글(live)도 같은 꾸밈 — 표·굵게 · 커서 · 태그 주입 0', lv.found && lv.live && lv.caret && lv.table === 1 && lv.strong >= 2 && lv.bad === 0 && lv.xss === 'undefined', JSON.stringify({ table: lv.table, strong: lv.strong, td: lv.td, bad: lv.bad }));
        ok('(lane) 길 표시용 단계(🧠 꼼꼼한 답)는 단계 목록·진행 문구·결과 칸에 안 나옴 — 마지막 보통 단계가 보임', lv.stepTexts.length === 3 && !lv.stepTexts.some(t => /꼼꼼한 답/.test(t)) && !/꼼꼼한 답/.test(lv.working + lv.rowLine) && /답변 정리 중/.test(lv.rowLine), `단계 ${lv.stepTexts.length}개 · 결과 칸 「${lv.rowLine}」`);
        ok('(lane) 처리 중 건에는 길 표시가 없거나 시간 없이만', lv.lane === null || !/초|분/.test(lv.lane), String(lv.lane));
        await M.pg.evaluate(() => { const r = document.querySelector('#desk-list tr.row[data-oid="990011"]'); if (r) r.scrollIntoView({ block: 'start' }); });
        await shot(M.pg, '2-1440-처리중-live');

        // Enter = 보내기 · Shift+Enter = 줄바꿈 · 한글 조합 중 Enter는 안 보냄
        const fine = await M.pg.evaluate(() => window.matchMedia('(pointer: fine)').matches);
        await M.pg.click('#desk-input');
        await M.pg.keyboard.type('첫 줄');
        await M.pg.keyboard.press('Shift+Enter');
        await M.pg.keyboard.type('둘째 줄');
        const v1 = await M.pg.inputValue('#desk-input');
        ok('(enter) Shift+Enter = 줄바꿈만 · 보내지 않음', fine && v1 === '첫 줄\n둘째 줄' && M.st.posts.length === 0, JSON.stringify(v1));
        const comp = await M.pg.evaluate(() => { const i = document.getElementById('desk-input'); const e1 = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }); i.dispatchEvent(e1); const e2 = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, which: 229, bubbles: true, cancelable: true }); i.dispatchEvent(e2); return { p1: e1.defaultPrevented, p2: e2.defaultPrevented, k2: e2.keyCode }; });
        await sleep(500);
        ok('(enter) 한글 조합 중 Enter(isComposing · keyCode 229)는 보내지 않음', !comp.p1 && !comp.p2 && M.st.posts.length === 0, JSON.stringify(comp) + (comp.k2 !== 229 ? ' (이 브라우저는 만든 이벤트의 keyCode를 229로 못 줌 — isComposing 쪽만 유효)' : ''));
        await M.pg.keyboard.press('Enter');
        const pE = await waitFor(async () => M.st.posts.length ? M.st.posts : null, 5000);
        await sleep(600);
        const v2 = await M.pg.inputValue('#desk-input');
        ok('(enter) Enter = 보내기 — POST 1회 · 본문 = 적은 글(줄바꿈 포함) · 입력칸 비워짐', !!pE && pE.length === 1 && pE[0].content === '첫 줄\n둘째 줄' && v2 === '', JSON.stringify(pE) + ' · 입력칸 ' + JSON.stringify(v2));
        await M.pg.click('#desk-input'); await M.pg.keyboard.press('Enter'); await sleep(500);
        ok('(enter) 빈 입력칸에서 Enter = 보내지 않음', M.st.posts.length === 1 && (await M.pg.inputValue('#desk-input')) === '');

        // 자주 쓰는 일 3종
        const q = await M.pg.evaluate(() => { const g = document.querySelector('.desk-quick2'); const ids = ['desk-qty-now', 'desk-settle-now', 'desk-talk-now']; const inp = document.getElementById('desk-input').getBoundingClientRect(); return { group: !!g, inGroup: ids.map(i => !!(g && g.querySelector('#' + i))), vis: ids.map(i => { const b = document.getElementById(i); return !!b && b.getClientRects().length > 0; }), text: ids.map(i => (document.getElementById(i) || {}).textContent), h: ids.map(i => Math.round(document.getElementById(i).getBoundingClientRect().height)), below: g ? g.getBoundingClientRect().top >= inp.bottom - 1 : false, oneRow: new Set(ids.map(i => Math.round(document.getElementById(i).getBoundingClientRect().top))).size === 1, label: (g && g.querySelector('.desk-quick2-label') || {}).textContent }; });
        ok('(quick) 입력칸 아래 「자주 쓰는 일」 줄에 버튼 3종', q.group && q.below && q.inGroup.every(Boolean) && q.vis.every(Boolean) && q.label === '자주 쓰는 일', q.text.join(' / ') + ' · 높이 ' + q.h.join('/'));
        ok('(quick) 세 번째 버튼 이름 = 「톡톡 답변 추천」', q.text[2] === '톡톡 답변 추천', q.text.join(' / '));
        if (!q.oneRow) info('관찰: 1440px에서 「자주 쓰는 일」 버튼 3개가 한 줄에 안 들어가 마지막 버튼이 다음 줄로 내려감(지시 칸 너비가 좁음)');
        const meta = await M.pg.evaluate(() => { const m = document.querySelector('.desk-ask-meta'); if (!m) return null; const r = m.getBoundingClientRect(), send = document.getElementById('desk-send').getBoundingClientRect(), hint = m.querySelector('.desk-keyhint'), cnt = m.querySelector('#desk-count'), inp = document.getElementById('desk-input').getBoundingClientRect(); return { hint: hint ? hint.textContent : '', hintVis: !!hint && hint.getClientRects().length > 0, cnt: !!cnt, rightOfSend: r.left >= send.right - 1, sameRow: Math.abs((r.top + r.bottom) / 2 - (send.top + send.bottom) / 2) < 14, rightEdge: Math.abs(r.right - inp.right) < 6 }; });
        ok('(enter) 입력 안내 + 글자 수가 한 묶음(.desk-ask-meta) — 입력칸 오른쪽 끝에 맞춤', !!meta && meta.cnt && meta.hintVis && /Enter 보내기/.test(meta.hint) && meta.rightEdge, JSON.stringify(meta));
        if (meta && !meta.sameRow) info('관찰: 1440px에서 입력 안내 묶음이 보내기 버튼 옆이 아니라 그 아랫줄 오른쪽에 놓임(칸이 좁아 줄바꿈)');
        const p0 = M.st.posts.length;
        await M.pg.click('#desk-talk-now');
        const tk = await M.pg.evaluate(() => ({ v: document.getElementById('desk-input').value, focus: document.activeElement === document.getElementById('desk-input'), count: document.getElementById('desk-count').textContent }));
        await sleep(400);
        ok('(quick) 「톡톡 답변 추천」 = 입력칸에 글 채우고 포커스 · 보내지 않음 · 글자 수 갱신', tk.v === '처리 안 된 톡톡 건 답변 예시문구 만들어줘' && tk.focus && M.st.posts.length === p0 && tk.count.replace(/\s/g, '') === tk.v.length + '/2000', JSON.stringify(tk));
        const [fc1] = await Promise.all([M.pg.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null), M.pg.click('#desk-settle-now')]);
        const sv1 = await M.pg.inputValue('#desk-input');
        ok('(quick) 「정산 이미지 올리기」 — 입력칸에 글이 있으면 그대로 두고 파일 고르기 열림', !!fc1 && sv1 === tk.v, '입력칸 ' + JSON.stringify(sv1));
        await M.pg.fill('#desk-input', '');
        const [fc2] = await Promise.all([M.pg.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null), M.pg.click('#desk-settle-now')]);
        const sv2 = await M.pg.evaluate(() => ({ v: document.getElementById('desk-input').value, count: document.getElementById('desk-count').textContent }));
        ok('(quick) 「정산 이미지 올리기」 — 입력칸이 비었으면 「정산관리에 올려줘」 채우고 파일 고르기 열림 · 보내지 않음', !!fc2 && sv2.v === '정산관리에 올려줘' && M.st.posts.length === p0, JSON.stringify(sv2));
        await M.pg.fill('#desk-input', '');
        await M.pg.click('#desk-qty-now');
        const pq = await waitFor(async () => M.st.posts.length > p0 ? M.st.posts : null, 5000);
        ok("(quick) 「중간발주 바로 받기」(자리 옮긴 뒤에도) POST 1회 · content = '중간발주 뽑아줘'", !!pq && pq.length === p0 + 1 && pq[pq.length - 1].content === '중간발주 뽑아줘');
        await M.pg.evaluate(() => { window.scrollTo(0, 0); const m = document.querySelector('.main-content'); if (m) m.scrollTop = 0; });
        await sleep(300);
        await shot(M.pg, '3-1440-입력칸-자주쓰는일');
        ok('(g) 1440px(4차) — pageerror 0 · console error 0', M.errors.length === 0 && M.cons.length === 0, [...M.errors, ...M.cons].join(' | ').slice(0, 400));
        await M.ctx.close();

        // 1000px 카드 — 접어 보기 · 전체 보기
        const N = await open({ width: 1000, height: 900 }, null, [mdOrder(), liveMd(), old]);
        const n1 = await mdState(N.pg, 990010);
        ok('(md) 1000 카드 — 표·굵게·목록 그대로 · 태그 주입 0 · 카드 안 · 가로 넘침 없음', structOk(n1) && safeOk(n1) && n1.aInBox && n1.twInA === true && !n1.rootOverflow && !n1.docOverflow, `표 안쪽 스크롤 여유 ${n1.twScroll}px`);
        ok('(md) 1000 카드 — 긴 답은 접혀 보임(높이로 자름) · [전체 보기] 버튼', n1.clamp && n1.hidden && n1.h < n1.fullH - 20 && n1.toggle === '전체 보기' && n1.toggleVis, `보이는 높이 ${n1.h}px / 전체 ${n1.fullH}px`);
        ok('(lane) 1000 카드 — 「⚡ 빠른 답 · 12초」 · 머리말과 안 겹침', n1.lane === '⚡ 빠른 답 · 12초' && n1.laneInA === true && n1.laneOverLabel === false);
        await shot(N.pg, '4-1000-카드-접힘');
        await N.pg.click('#desk-list .desk-card[data-oid="990010"] [data-act="toggle"]');
        const n2 = await mdState(N.pg, 990010);
        ok('(md) [전체 보기] → 다 펼쳐짐 · 버튼이 「접기」로', !n2.clamp && n2.h >= n2.fullH - 2 && n2.h > n1.h + 20 && n2.toggle === '접기' && structOk(n2), `${n1.h}px → ${n2.h}px`);
        await shot(N.pg, '4-1000-카드-펼침');
        await N.pg.click('#desk-list .desk-card[data-oid="990010"] [data-act="toggle"]');
        const n3 = await mdState(N.pg, 990010);
        ok('(md) [접기] → 다시 접힘', n3.clamp && Math.abs(n3.h - n1.h) <= 2 && n3.toggle === '전체 보기');
        ok('(g) 1000px(4차) — pageerror 0 · console error 0', N.errors.length === 0 && N.cons.length === 0, [...N.errors, ...N.cons].join(' | ').slice(0, 400));
        await N.ctx.close();

        // 390px 폰(터치)
        const P = await open({ width: 390, height: 800 }, { hasTouch: true, isMobile: true }, [mdOrder(), liveMd(), old]);
        const pFine = await P.pg.evaluate(() => window.matchMedia('(pointer: fine)').matches);
        await P.pg.evaluate(() => { const g = document.querySelector('.desk-quick2'); if (g) g.scrollIntoView({ block: 'end' }); });
        const pq2 = await P.pg.evaluate(() => { const g = document.querySelector('.desk-quick2'), r = g.getBoundingClientRect(); const bs = Array.from(g.querySelectorAll('button')).map(b => b.getBoundingClientRect()); return { inView: r.left >= 0 && r.right <= window.innerWidth + 1, btnIn: bs.every(b => b.left >= r.left - 1 && b.right <= r.right + 1), minH: Math.min(...bs.map(b => Math.round(b.height))), rows: new Set(bs.map(b => Math.round(b.top))).size, overflow: document.getElementById('ao-desk-root').scrollWidth > window.innerWidth + 2 }; });
        ok('(quick) 390 폰 — 「자주 쓰는 일」 버튼이 화면 안(줄바꿈됨) · 가로 넘침 없음 · 누를 높이 44px 이상', pq2.inView && pq2.btnIn && !pq2.overflow && pq2.minH >= 44, JSON.stringify(pq2));
        await shot(P.pg, '5-390-입력칸');
        await P.pg.tap('#desk-input');
        await P.pg.keyboard.type('폰 첫 줄');
        await P.pg.keyboard.press('Enter');
        await P.pg.keyboard.type('폰 둘째 줄');
        await sleep(500);
        const pv = await P.pg.inputValue('#desk-input');
        ok('(enter) 390 터치 기기 — Enter = 줄바꿈(보내지 않음)', pFine === false && pv === '폰 첫 줄\n폰 둘째 줄' && P.st.posts.length === 0, `pointer:fine=${pFine} · ${JSON.stringify(pv)} · POST ${P.st.posts.length}회`);
        const p1 = await mdState(P.pg, 990010);
        ok('(md) 390 폰 — 표·굵게·목록 그대로 · 태그 주입 0', structOk(p1) && safeOk(p1));
        ok('(md) 390 폰 — 넓은 표는 표 틀 안에서만 옆으로 밀림 · 카드·화면 밖으로 안 넘침', p1.aInBox && p1.twInA === true && !p1.rootOverflow && !p1.docOverflow, `표 안쪽 스크롤 여유 ${p1.twScroll}px`);
        ok('(md) 390 폰 — 표의 숫자 칸이 두 줄로 쪼개지지 않음 · 오른쪽 정렬 · 제목 1번', p1.numSplit.length === 0 && p1.nums.every(x => x.num && x.align === 'right') && p1.titleCount === 1, p1.numSplit.length ? '쪼개진 숫자: ' + p1.numSplit.join(', ') : '');
        ok('(lane) 390 폰 — 「⚡ 빠른 답 · 12초」 칸 안 · 머리말과 안 겹침', p1.lane === '⚡ 빠른 답 · 12초' && p1.laneInA === true && p1.laneOverLabel === false);
        await P.pg.tap('#desk-list .desk-card[data-oid="990010"] [data-act="toggle"]');
        const p2 = await mdState(P.pg, 990010);
        ok('(md) 390 폰 — [전체 보기] 동작', !p2.clamp && p2.toggle === '접기' && p2.h > p1.h + 20, `${p1.h}px → ${p2.h}px`);
        await P.pg.evaluate(() => { const c = document.querySelector('#desk-list .desk-card[data-oid="990010"]'); if (c) c.scrollIntoView({ block: 'start' }); });
        await sleep(300);
        await shot(P.pg, '6-390-답변');
        await P.pg.evaluate(() => { const c = document.querySelector('#desk-list .desk-card[data-oid="990011"]'); if (c) c.scrollIntoView({ block: 'start' }); });
        await sleep(300);
        await shot(P.pg, '6-390-처리중');
        ok('(g) 390px(4차) — pageerror 0 · console error 0', P.errors.length === 0 && P.cons.length === 0, [...P.errors, ...P.cons].join(' | ').slice(0, 400));
        await P.ctx.close();
    } catch (e) {
        ok('화면 검증 실행', false, e.message);
    } finally {
        if (browser) await browser.close().catch(() => { });
        if (srv) { try { srv.kill(); } catch (_) { } }
    }
}

(async () => {
    if (MODE === 'all' || MODE === 'unit') await unit();
    if (MODE === 'all' || MODE === 'ui') await ui();
    const pass = results.filter(r => r.pass).length;
    console.log(`\n결과: ${pass}/${results.length}` + (pass === results.length ? ' ✅' : ' — 실패: ' + results.filter(r => !r.pass).map(r => r.name).join(' / ')));
    process.exit(pass === results.length ? 0 : 1);
})();
