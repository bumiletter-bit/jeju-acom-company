// #421 검증: 글샘 태그 오염 대비 강화 — 평문 JSON 폴백 + 전체 오염 검사 + 표기 필드 세척 (2026-08-31)
// 실모듈(agents/글샘.js) require + @anthropic-ai/sdk 스텁(#408 cafe24 검증과 같은 방식) — API 호출 0·DB 접속 0.
const path = require('path');
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass, note }); console.log((pass ? '✅' : '❌') + ' ' + name + (note ? ' — ' + note : '')); };

// ── SDK 스텁 주입 (글샘 require 전에)
let handler = null;
let calls = [];
class FakeAnthropic {
    constructor() { this.messages = { create: async (opts) => { const kind = opts.tools ? 'tool' : (String(opts.system[0].text).includes('아래 형식의 JSON') ? 'plain-json' : 'plain'); calls.push(kind); return handler(kind, opts); } }; }
}
require.cache[require.resolve('@anthropic-ai/sdk')] = { exports: FakeAnthropic };
process.env.ANTHROPIC_API_KEY = 'stub-key-for-test';

const gs = require(path.join(__dirname, '..', 'agents', '글샘.js'));
const pool = { query: async () => ({ rows: [] }) };
const INSTR = '하우스감귤 소과 가격 인하 / 2,000원 할인쿠폰 증정 중(~8/27 오전 8시까지 ID당 1회 사용가능) / 하우스귤 소과 1+1 20명 랜덤 추첨 증정 / 해당내용 넣어서 네이버 톡톡 문구 짜줘, 톡톡은 총 8줄로 한줄에 20자 정도씩 만들어줘';
const run = () => gs.result({ agent: { id: 1 }, pool, params: { order_content: INSTR } });
const LONG = (s) => (s + ' 알찬 하우스귤 소과, 지금이 제일 맛있어요. 2,000원 쿠폰과 1+1 추첨까지 놓치지 마세요! 제주아꼼이네였습니다.');
const CLEAN3 = { channel: '톡톡', title: '하우스귤 소과 특가', versions: [
    { label: '안정형', text: LONG('안정형 본문.') }, { label: '어그로형', text: LONG('어그로형 본문.') }, { label: '감성형', text: LONG('감성형 본문.') }],
    missing_fields: [], char_counts: '각 150자 내외', send_tip: '오전 10~11시 발송 추천' };
const toolMsg = (input) => ({ content: [{ type: 'tool_use', input }] });
const textMsg = (t) => ({ content: [{ type: 'text', text: t }] });

(async () => {
    try {
        // ── 0. 단위: 오염 검사·세척
        ok('hasContamination: 파편 감지', gs.hasContamination({ a: '좋아요 </antml_parameter>' }) === true);
        ok('hasContamination: 정상 = false', gs.hasContamination(CLEAN3) === false);
        ok('cleanShortField: 정상 텍스트 무변형', gs.cleanShortField('오전 10~11시 발송 추천') === '오전 10~11시 발송 추천');
        ok('cleanShortField: 순수 파편 = 빈값', gs.cleanShortField('</antml_parameter>\n') === '');
        ok('cleanShortField: 혼합 = 파편만 제거', (() => { const r = gs.cleanShortField('오전 발송 추천 </antml_parameter>'); return r.includes('오전 발송 추천') && !/antml|parameter/i.test(r); })());

        // ── A. 정상 도구 응답 = 종전 그대로(무회귀) — 폴백 미발동·추가 호출 0
        calls = []; handler = () => toolMsg(CLEAN3);
        const A = await run();
        ok('A: 정상 = 3종·제목 유지', A.report.versions.length === 3 && A.report.title === '하우스귤 소과 특가');
        ok('A: 폴백 미발동·tool 1회만', A.report.fallback === '' && calls.join(',') === 'tool', calls.join(','));
        ok('A: summary 폴백 표기 없음', !A.summary.includes('폴백'), A.summary);

        // ── B. 부분 오염(본문 정상·send_tip 파편) → 평문 JSON 폴백으로 전체 교체
        calls = [];
        handler = (kind) => kind === 'tool'
            ? toolMsg({ ...CLEAN3, title: '</antml_parameter>제목', send_tip: '</antml_parameter>\n' })
            : textMsg(JSON.stringify(CLEAN3));
        const B = await run();
        ok('B: 부분 오염 → plain-json 채택(3종·제목 생존)', B.report.fallback === 'plain-json' && B.report.versions.length === 3 && B.report.title === '하우스귤 소과 특가', calls.join(','));
        ok('B: 결과 어디에도 파편 0', !/antml|<\/\s*parameter/i.test(JSON.stringify(B)));

        // ── C. 부분 오염 + plain-json 실패 → 도구 본문 유지 + 필드 세척(무회귀 안전망)
        calls = [];
        handler = (kind) => kind === 'tool'
            ? toolMsg({ ...CLEAN3, title: '<parameter name="title">{"versions":[...]}', send_tip: '</antml_parameter>' })
            : textMsg('JSON 아님 — 폴백 실패 시뮬레이션');
        const C = await run();
        ok('C: 본문 3종 유지 + 파편 0', C.report.versions.length === 3 && !/antml/i.test(JSON.stringify(C)), C.report.fallback);
        ok('C: send_tip 세척(빈값)·title_error 표기', C.report.send_tip === '' && !!C.report.title_error);

        // ── D. 전멸 오염 + plain-json 성공 → 3종 복구
        calls = [];
        handler = (kind) => kind === 'tool' ? toolMsg({ channel: '톡톡', versions: [] }) : textMsg('```json\n' + JSON.stringify(CLEAN3) + '\n```');
        const D = await run();
        ok('D: 전멸 → plain-json 3종·제목 복구', D.report.fallback === 'plain-json' && D.report.versions.length === 3 && D.report.title === '하우스귤 소과 특가');
        ok('D: 도구 2회(재시도)+plain-json 1회', calls.join(',') === 'tool,tool,plain-json', calls.join(','));

        // ── E. 전멸 + plain-json도 실패 → 종전 평문 본문 폴백(최후 안전망 무회귀)
        calls = [];
        handler = (kind) => kind === 'tool' ? toolMsg({ channel: '톡톡', versions: [] })
            : (kind === 'plain-json' ? textMsg('실패') : textMsg(LONG('평문 본문.')));
        const E = await run();
        ok('E: 최후 안전망 = 평문 본문 1종', E.report.fallback === 'plain' && E.report.versions.length === 1 && E.report.versions[0].label.includes('평문 폴백'));
        ok('E: summary 「평문 폴백」 표기 유지', E.summary.includes('— 평문 폴백'), E.summary);

        // ── F. 전부 실패 → 종전 오류 그대로(허위 카피 금지 무회귀)
        handler = (kind) => kind === 'tool' ? toolMsg({ channel: '톡톡', versions: [] }) : textMsg('x');
        let threw = false;
        try { await run(); } catch (e) { threw = /생성하지 못했습니다/.test(e.message); }
        ok('F: 전부 실패 = 정직 오류(무회귀)', threw);

        // ── G. cleanTitleField 종전 케이스 무회귀 (#39)
        ok('G: 정상 제목 통과', gs.cleanTitleField('카라향 마감 임박') === '카라향 마감 임박');
        ok('G: 오염 제목 정화 불가 = 빈값', gs.cleanTitleField('<parameter name="title">{"versions":[...]}') === '');
    } catch (err) {
        ok('실행', false, String(err && err.stack || err).slice(0, 300));
    } finally {
        const pass = results.filter(r => r.pass).length;
        console.log(`\n결과: ${pass}/${results.length}`);
        process.exit(pass === results.length ? 0 : 1);
    }
})();
