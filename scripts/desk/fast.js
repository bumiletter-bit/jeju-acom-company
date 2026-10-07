// #498(대표 GO 10/2) 창구 빠르게 — 대기 프로그램(launcher.js)이 쓰는 순수 함수 모음(AI 호출·DB 접근 없음 → 단독 검증 가능)
//   ① route()         지시를 보고 길을 고른다: AI 없이 바로(중간발주) / 빠른 모델(Sonnet) / 종전 모델(Opus)
//   ② streamWatcher() claude -p --output-format stream-json 의 줄을 읽어 「지금 하는 일」·답변 미리 보기를 뽑는다
//   되돌리기: agent_office_config 'desk_fast' = {"off":true} → 전부 종전 방식(10초 확인·Opus·끝나야 보임)
//   낱개로 끄기: {"route":false} 처럼 항목만 false (poll·stream·prefetch·route·direct·lean·warm)
//   #580(대표 10/8): inline = 최종발주 규칙 문서·자료를 지시문에 미리 넣기 · settlepar = 같은 사람의 정산 이미지 여러 장을 동시에
const DEFAULTS = { off: false, poll: true, stream: true, prefetch: true, route: true, direct: true, lean: true, warm: true, inline: true, settlepar: true };
const KEYS = ['poll', 'stream', 'prefetch', 'route', 'direct', 'lean', 'warm', 'inline', 'settlepar'];
function settings(cfg) {
    const c = cfg && typeof cfg === 'object' ? cfg : {};
    if (c.off === true) return { off: true, poll: false, stream: false, prefetch: false, route: false, direct: false, lean: false, warm: false, inline: false, settlepar: false };
    const o = Object.assign({}, DEFAULTS);
    for (const k of KEYS) if (c[k] === false) o[k] = false;
    if (['low', 'medium', 'high', 'xhigh'].includes(c.effort)) o.effort = c.effort;   // 생각 깊이를 따로 줄 때만(없으면 창구 기본값)
    return o;
}

// ── ① 길 고르기 ─────────────────────────────────────────────────────────────
//   대표 방침(10/2): 회사프로그램 틀 안의 단순 일(정산 이미지·조회) = Sonnet · 영상·시나리오·추천 문구·아이디어 = Opus.
//   총괄 보탬: 값을 바꾸는 일(쿠폰·가격·발송·등록·수정)과 이어서 지시는 Opus · 헷갈리면 Opus(안전한 쪽).
const DIRECT_QTY = /^(\[검증469\]\s*)?(\[바로\]\s*)?중간\s*발주\s*(수량|집계|표|이미지|현황)?\s*(좀\s*)?(해\s*줘|뽑아\s*줘|줘|부탁|부탁해|부탁해요|부탁합니다|확인|확인해\s*줘|알려\s*줘|보여\s*줘|해\s*주세요|뽑아\s*주세요)?[\s.!~요]*$/;
const OPUS_WORDS = /문구|카피|시나리오|추천|아이디어|영상|릴스|그림|이미지\s*(만들|생성|제작)|배너|썸네일|쿠폰|초안|작성|보고서|수정|고쳐|고치|바꿔|바꾸|변경|등록|추가|삭제|지워|발송\s*(해|할|예정|하)|보내|인상|인하|분석|원인|왜|비교|기획|이벤트|힉스|톡톡|문자|답변|응대|정리해|만들어|써\s*줘|제안|검토|판단|어떻게|전략|상세페이지|소개/;
const LOOKUP_WORDS = /알려\s*줘|알려\s*주세요|조회|몇\s*건|몇\s*개|몇\s*박스|얼마|재고|단가|일정|현황|확인해|보여\s*줘|찾아\s*줘|언제|있어\?|있나|됐어|나갔어|들어왔어/;
const SETTLE_WORDS = /정산|발주\s*수량|발송\s*목록|올려\s*줘|올려\s*주세요/;
function route(o, forcedModel) {
    const raw = String(o.content || '').trim();
    // 「보고만 · 아무것도 바꾸지 말 것」 같은 당부는 일의 종류가 아니므로 떼고 본다
    const text = raw.replace(/(아무\s*것도\s*)?(바꾸|수정하|고치|변경하|등록하|삭제하|보내|발송하)지\s*(말|마)(고|것|라|세요|아\s*줘|아요)?/g, ' ').replace(/보고만/g, ' ')
        // 「등록된 품목」「발송된 건」처럼 이미 된 일을 가리키는 말은 시키는 말이 아니다
        .replace(/(등록|변경|수정|추가|삭제|발송|작성)(된|되어|돼|됐|되었|되는)/g, ' ').trim();
    const parent = String(o.parent_content || '').trim();
    if (!o.has_image && !o.reply_to && o.status === '대기' && raw.length <= 40 && DIRECT_QTY.test(raw)) return { lane: 'direct_qty', model: null, why: '중간발주 — AI 없이 바로' };
    if (forcedModel) return { lane: 'ai', model: forcedModel, why: '모델 지정(AKKOME_MODEL)' };
    if (o.status === '승인됨') return { lane: 'ai', model: 'opus', why: '승인된 실행' };
    if (o.reply_to) return { lane: 'ai', model: 'opus', why: '이어서 지시·되묻기 답' };
    if (o.has_image && SETTLE_WORDS.test(text) && text.length <= 120) return { lane: 'ai', model: 'sonnet', why: '정산 이미지 판독' };
    if (o.has_image) return { lane: 'ai', model: 'opus', why: '이미지 + 정산 외 지시' };
    if (text.length <= 160 && LOOKUP_WORDS.test(text) && !OPUS_WORDS.test(text)) return { lane: 'ai', model: 'sonnet', why: '조회' };
    return { lane: 'ai', model: 'opus', why: parent ? '이어서' : '판단·창작·변경' };
}

// #580 C: 같은 사람의 지시는 한 번에 하나가 원칙(이어서 지시가 앞 답을 받아야 하므로)이지만,
//   「정산 이미지 판독」은 장마다 따로 끝나는 일(품목·수량만 읽어 올림 · 앞 답을 안 봄)이라 여러 장이 연달아 오면 같이 돌려도 된다.
//   조건 = route() 가 정산 이미지 판독으로 고른 새 지시(대기 · 이어서 아님) + 그림(엑셀 같은 파일 첨부 제외)
function settleImage(o) {
    if (!o || !o.has_image || o.file_name || o.reply_to || o.status !== '대기') return false;
    return route(o, null).why === '정산 이미지 판독';
}

// #580 B: 최종발주 화면이 보낸 일(메모 읽기·대화)은 규칙 문서와 자료 파일을 읽는 데 호출 1~2번을 쓴다 → 대기 프로그램이 미리 읽어 지시문에 넣는다.
//   read(path) = 파일 글(없으면 null) — 순수 함수로 두려고 읽는 길을 받아 쓴다. 돌려주는 값이 null 이면 종전 방식(창구가 직접 읽음).
const INLINE_RULES_MAX = 60000, INLINE_DATA_MAX = 200000;
function inlineFinalOrder(got, read) {
    const fm = got && got.final_order_memo;
    if (!fm || !fm.rules || !fm.how) return null;
    const rules = read(fm.rules);
    if (!rules || !String(rules).trim() || rules.length > INLINE_RULES_MAX) return null;
    // 「규칙 문서를 먼저 읽고」「끝나면 파일을 지웁니다」 두 마디를 떼어 낸다 — 둘 다 못 떼면(문구가 바뀌었으면) 말이 엇갈리므로 미리 넣지 않는다
    const A = 'rules 문서를 먼저 읽고, ', B = ' 끝나면 payload_path 파일을 지웁니다.';
    if (fm.how.split(A).length !== 2 || fm.how.split(B).length !== 2) return null;
    const data = fm.payload_path ? read(fm.payload_path) : null;
    const withData = !!data && data.length <= INLINE_DATA_MAX;
    const name = String(fm.rules).split(/[\\/]/).pop();
    const fm2 = Object.assign({}, fm, { how: fm.how.split(A).join('아래 <규칙 문서> 대로, ').split(B).join('') });
    delete fm2.rules;
    if (withData) { fm2.how = fm2.how.split('payload_path 의 ').join('아래 <자료> 의 '); delete fm2.payload_path; }
    const text = `<규칙 문서 ${name}>\n${rules}\n</규칙 문서>\n`
        + (withData ? `<자료>\n${data}\n</자료>\n` : '')
        + `위 규칙 문서${withData ? '와 자료' : ''}는 대기 프로그램이 파일을 미리 읽어 그대로 넣은 것입니다 — 그 파일을 다시 읽지 말고 바로 판정하세요.`
        + (withData ? '' : ' 자료는 payload_path 파일에 있습니다(이것만 읽습니다).')
        + ' 받은 자료 파일은 대기 프로그램이 지우므로 지우는 명령은 하지 않습니다.\n';
    return { got: Object.assign({}, got, { final_order_memo: fm2 }), text, name, withData, cleanup: fm.payload_path || null };
}

// ── ② 진행 상황 읽기 ─────────────────────────────────────────────────────────
// 덜 끝난 JSON 문자열 조각을 읽을 수 있는 데까지 푼다(닫는 따옴표 전이거나 조각이 끝나면 멈춤)
function lenientString(s, from) {
    let out = '';
    for (let i = from; i < s.length; i++) {
        const ch = s[i];
        if (ch === '"') return { text: out, end: i, closed: true };
        if (ch !== '\\') { out += ch; continue; }
        const n = s[i + 1];
        if (n === undefined) break;
        if (n === 'n') out += '\n'; else if (n === 't') out += '\t'; else if (n === 'r') out += '';
        else if (n === 'u') { const h = s.slice(i + 2, i + 6); if (h.length < 4 || !/^[0-9a-fA-F]{4}$/.test(h)) break; out += String.fromCharCode(parseInt(h, 16)); i += 4; }
        else out += n;
        i++;
    }
    return { text: out, end: s.length, closed: false };
}
function fieldPartial(src, key) {
    const m = new RegExp('"' + key + '"\\s*:\\s*"').exec(src);
    if (!m) return null;
    return lenientString(src, m.index + m[0].length).text;
}
// Write 도구로 결과.json을 쓰는 중이면 그 안의 answer(또는 question)를 적힌 데까지 꺼낸다
function livePreview(partialInput) {
    let content = fieldPartial(partialInput, 'content');                    // Write 도구
    if (content == null) content = fieldPartial(partialInput, 'command');   // Bash로 결과 파일을 적는 경우
    if (content == null) return null;
    if (!/"(kind|type)"\s*:\s*"(answer|question)"/.test(content)) return null;
    const a = fieldPartial(content, 'answer');
    if (a != null) return a;
    return fieldPartial(content, 'question');
}
// 도구 호출 → 직원이 읽을 한 줄(없으면 null = 화면에 안 올림)
function stepText(name, input) {
    const i = input || {};
    if (name === 'Bash' || name === 'PowerShell') {
        const c = String(i.command || '');
        if (/respond\.js|step\.js|get\.js/.test(c)) return null;            // 결과 올리기·단계 기록은 그쪽이 스스로 적는다
        if (/qty-image/.test(c)) return '📦 중간발주 집계 중 (주문을 불러오느라 1~2분 걸려요)';
        if (/scenario-edit/.test(c)) return '🗂️ 시나리오 확인 중';
        if (/talk-pending/.test(c)) return '💬 처리 안 된 톡톡 문의 모으는 중';
        if (/talk-send/.test(c)) return '📨 톡톡 답변 보내는 중';
        if (/points\.js/.test(c)) return '👤 자사몰 회원 찾는 중';
        if (/higgsfield/i.test(c)) return '🎨 그림·영상 만드는 중 (몇 분 걸릴 수 있어요)';
        if (/ffmpeg|video-verify|whisper/i.test(c)) return '🎬 영상 다듬는 중';
        if (/xlsx|\.csv/i.test(c)) return '📊 표 파일 만드는 중';
        if (/pool\.query|SELECT |psql|pg['"]/i.test(c)) return '🔎 회사프로그램 자료 조회 중';
        return '⚙️ 자료 확인 중';   // 창구가 붙인 설명(description)은 내부 용어가 섞여 직원 화면에 올리지 않는다
    }
    if (name === 'Read') {
        const p = String(i.file_path || '');
        if (/\.(png|jpe?g|webp|gif)$/i.test(p)) return '🖼️ 이미지 읽는 중';
        if (/업무지식/.test(p)) return '📖 업무 기준 확인 중';
        if (/[1-6]_.*\.md$/.test(p) || /플레이북|카피/.test(p)) return '📖 문구 기준 확인 중';
        return null;
    }
    if (name === 'Write' || name === 'Edit') {
        const p = String(i.file_path || '');
        if (/\.json$/i.test(p)) return '✍️ 답변 정리 중';
        return '📝 파일 작성 중';
    }
    if (name === 'WebSearch' || name === 'WebFetch') return '🌐 자료 찾는 중';
    if (name === 'Grep' || name === 'Glob') return null;
    return null;
}
function streamWatcher(cb) {
    const blocks = new Map();     // 쓰는 중인 도구 입력 조각(index → {name, json})
    let lastStep = '', lastLive = '', lastLiveAt = 0, pendingLive = null, liveTimer = null;
    const pushStep = t => { if (!t || t === lastStep) return; lastStep = t; try { cb.onStep && cb.onStep(t); } catch (e) { /* 무시 */ } };
    const flushLive = () => { liveTimer = null; if (pendingLive == null || pendingLive === lastLive) return; lastLive = pendingLive; lastLiveAt = Date.now(); try { cb.onLive && cb.onLive(lastLive); } catch (e) { /* 무시 */ } };
    const pushLive = t => {
        if (t == null || t.length < 8) return;
        pendingLive = t;
        const wait = 1200 - (Date.now() - lastLiveAt);
        if (wait <= 0) flushLive(); else if (!liveTimer) { liveTimer = setTimeout(flushLive, wait); if (liveTimer.unref) liveTimer.unref(); }
    };
    return {
        line(raw) {
            const s = String(raw).trim();
            if (!s || s[0] !== '{') return;
            const j = JSON.parse(s);
            if (j.type === 'stream_event' && j.event) {
                const e = j.event;
                if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'tool_use') blocks.set(e.index, { name: e.content_block.name, json: '' });
                else if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'input_json_delta') {
                    const b = blocks.get(e.index);
                    if (b) { b.json += e.delta.partial_json || ''; if (b.name === 'Write' || b.name === 'Bash') pushLive(livePreview(b.json)); }
                } else if (e.type === 'content_block_stop') blocks.delete(e.index);
                else if (e.type === 'message_start') blocks.clear();
                return;
            }
            if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) {
                for (const c of j.message.content) if (c.type === 'tool_use') pushStep(stepText(c.name, c.input));
                return;
            }
            if (j.type === 'result') {
                try { cb.onResult && cb.onResult({ cost_usd: j.total_cost_usd, turns: j.num_turns, api_ms: j.duration_api_ms, is_error: !!j.is_error }); } catch (e) { /* 무시 */ }
            }
        },
    };
}

// 중간발주(AI 없이) — qty-image.js 출력에서 답변 글·첨부를 만든다
function qtyAnswer(stdout) {
    const lines = String(stdout).split(/\r?\n/);
    let meta = null;
    for (let i = lines.length - 1; i >= 0; i--) { const t = lines[i].trim(); if (t.startsWith('{') && t.endsWith('}')) { try { meta = JSON.parse(t); lines.splice(i); break; } catch (e) { /* 다음 */ } } }
    if (!meta) throw new Error('집계 결과를 읽지 못했습니다');
    const body = lines.filter(l => !/^파일 \d+개:/.test(l.trim())).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const um = Array.isArray(meta.unmatched) ? meta.unmatched : [];
    const umTotal = um.reduce((s, r) => s + (parseInt(r.qty, 10) || 0), 0);
    const tail = (um.length ? `\n\n⚠️ 미매칭 ${umTotal}박스는 품목별 금액에 없는 옵션이에요. 어느 거래처 품목인지 확인해 주세요.` : '')
        + ((meta.errors && meta.errors.length) ? `\n\n⚠️ 일부 채널을 불러오지 못했어요(${meta.errors.length}곳). 숫자가 모자랄 수 있으니 잠시 뒤 다시 받아 보세요.` : '')
        + '\n\n아래 그림은 회사프로그램 [중간발주 → 선택분 이미지 저장]과 같은 표예요.';
    const files = (Array.isArray(meta.files) ? meta.files : []).filter(f => /\.png$/i.test(f)).slice(0, 5);
    return { title: '중간발주 집계 (' + String(meta.at || '').slice(5) + ')', answer: body + tail, attachments: files };
}

module.exports = { DEFAULTS, settings, route, settleImage, inlineFinalOrder, streamWatcher, livePreview, lenientString, stepText, qtyAnswer };
