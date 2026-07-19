// 한결 (마케팅팀장) — v5.2 검수 게이트 (지시 #38)
// 역할: 글샘·미소 콘텐츠 산출물을 4항목으로 검수 (브랜드 가이드 준수·어그로·명확성·강조).
// 원칙: ⚠️보완이어도 숨기지 않고 의견과 함께 표시 — 최종 판단은 대표 (정직 원칙).
//       검수 시에만 소넷 1회 호출 (비용 통제). 자동 재작성 없음 (대표 지시 시에만 기존 피드백 경로로 1회).
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const HANGYEOL_MODEL = process.env.HANGYEOL_MODEL || 'claude-sonnet-4-6';
const BRAND_FILE = path.join(__dirname, '..', 'docs', 'knowledge', 'marketing', '브랜드가이드_v1.md');
const PERSONA_FILE = path.join(__dirname, '..', 'docs', 'agents', '한결_특성.md'); // 지시 #44
let _brandCache = null;
function loadBrand() {
    if (_brandCache) return _brandCache;
    try { _brandCache = fs.readFileSync(BRAND_FILE, 'utf8'); }
    catch (e) { _brandCache = `(브랜드 가이드 로드 실패: ${e.message})`; }
    return _brandCache;
}
let _personaCache = null;
function loadPersona() {
    if (_personaCache) return _personaCache;
    try { _personaCache = fs.readFileSync(PERSONA_FILE, 'utf8'); }
    catch (e) { _personaCache = `(특성 파일 로드 실패: ${e.message})`; }
    return _personaCache;
}

// 지시 #44: 검수 4문 체계 — 기존 4항목(브랜드/어그로/목적·전달/강조)은 ①·③에 흡수 유지
const REVIEW_ITEMS = ['우리다움', '대표 의도', '정직·정확'];

const REVIEW_TOOL = {
    name: 'submit_review',
    description: '콘텐츠 검수 결과를 제출한다.',
    strict: true,
    input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            verdict: { type: 'string', enum: ['통과', '보완'], description: '4항목 모두 문제없으면 통과, 하나라도 보완 필요하면 보완' },
            items: {
                type: 'array',
                description: '검수 3항목 각각의 판정 (순서 고정: 우리다움 → 대표 의도 → 정직·정확)',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        name: { type: 'string', enum: REVIEW_ITEMS },
                        ok: { type: 'boolean' },
                        comment: { type: 'string', description: '2줄 내외 코멘트 (문제없으면 짧은 확인, 문제면 구체 지적 + 고치는 방법)' },
                    },
                    required: ['name', 'ok', 'comment'],
                },
            },
            comment: { type: 'string', description: '전체 총평 한 줄' },
            fill_items: { type: 'array', items: { type: 'string' }, description: '[대표가 채울 항목] — 자리표시·미확정 정보 목록. 없으면 출력하지 않는다' },
            suggestion: { type: 'string', description: "verdict가 '보완'일 때 수정 제안 — 반드시 고치는 방법을 구체적으로. 통과면 출력하지 않는다" },
        },
        required: ['verdict', 'items', 'comment'],
    },
};

// 콘텐츠 검수 — contentKind: '카피'|'시안 프롬프트', contentText: 검수 대상 전문
async function reviewContent({ contentKind, contentText }) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const systemPrompt = `너는 제주아꼼이네 농업회사법인(주) AGENT OFFICE 마케팅팀장 '한결'이다.
팀원(글샘·미소)의 콘텐츠를 대표 승인 전에 검수하는 것이 임무다.

===== [한결 특성 — 지시 #44] =====
${loadPersona()}

===== [브랜드 가이드 v1 — 판정 기준] =====
${loadBrand()}

## 검수 4문 (이 순서로 전부 판정 — 지시 #44 팀장 공통)
① 우리다움 — 브랜드 가이드 준수, "아는 농가 사장님" 톤, 과장 금지, 명분 없는 할인 금지. 시선을 잡는 요소(어그로)가 있되 우리다운가. 시안 프롬프트는 제주 요소·브랜드 컬러·금지 소품도 확인
② 대표 의도 — 지시 원문이 요구한 결과가 실제 나왔나, 빠진 것은 없나. **마감 문자에 마감 날짜가 없으면 최우선 지적**
③ 정직·정확 — 추측·근거 없는 수치 없음, 정보 부족은 자리표시로 처리했나. 목적·전달사항이 분명하고 핵심이 강조됐나
④ 판정 — verdict(통과/보완) + comment(총평 한 줄) + fill_items([대표가 채울 항목])

## 판정 원칙
- 하나라도 보완 필요하면 verdict='보완' — 무난하게 통과시키지 말 것. 반대로 트집도 잡지 말 것 (실무 기준)
- 지적에는 반드시 고치는 방법을 함께 (깐깐하지만 따뜻한 선배)
- 반드시 submit_review 도구로 제출. 다른 텍스트 응답 금지`;
    const msg = await anthropic.messages.create({
        model: HANGYEOL_MODEL,
        max_tokens: 900,
        system: systemPrompt,
        tools: [REVIEW_TOOL],
        tool_choice: { type: 'tool', name: 'submit_review' },
        messages: [{ role: 'user', content: `[검수 대상 — ${contentKind}]\n${String(contentText).slice(0, 6000)}` }],
    });
    const tu = msg.content.find(b => b.type === 'tool_use');
    if (!tu) throw new Error('한결 검수 응답에서 결과(tool_use)를 찾지 못했습니다');
    const r = tu.input;
    const items = (Array.isArray(r.items) ? r.items : []).slice(0, 4);
    return {
        verdict: r.verdict === '통과' ? '통과' : '보완',
        items,
        comment: String(r.comment || '').slice(0, 200),
        fill_items: (Array.isArray(r.fill_items) ? r.fill_items : []).map(x => String(x).slice(0, 80)).slice(0, 10),
        suggestion: r.verdict === '보완' ? String(r.suggestion || '').slice(0, 500) : '',
        reviewer: '한결',
        model: HANGYEOL_MODEL,
        reviewed_at: new Date().toISOString(),
    };
}

module.exports = {
    live: false, // 직접 라우팅 대상 아님 — 검수 게이트 전용 (글샘·미소 완료 시 자동 실행)
    reviewContent,
    REVIEW_ITEMS,
};
