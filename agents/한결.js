// 한결 (마케팅팀장) — v5.2 검수 게이트 (지시 #38)
// 역할: 글샘·미소 콘텐츠 산출물을 4항목으로 검수 (브랜드 가이드 준수·어그로·명확성·강조).
// 원칙: ⚠️보완이어도 숨기지 않고 의견과 함께 표시 — 최종 판단은 대표 (정직 원칙).
//       검수 시에만 소넷 1회 호출 (비용 통제). 자동 재작성 없음 (대표 지시 시에만 기존 피드백 경로로 1회).
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const HANGYEOL_MODEL = process.env.HANGYEOL_MODEL || 'claude-sonnet-4-6';
const BRAND_FILE = path.join(__dirname, '..', 'docs', 'knowledge', 'marketing', '브랜드가이드_v1.md');
let _brandCache = null;
function loadBrand() {
    if (_brandCache) return _brandCache;
    try { _brandCache = fs.readFileSync(BRAND_FILE, 'utf8'); }
    catch (e) { _brandCache = `(브랜드 가이드 로드 실패: ${e.message})`; }
    return _brandCache;
}

const REVIEW_ITEMS = ['브랜드 가이드 준수', '어그로(후킹)', '목적·전달사항 명확성', '강조 포인트'];

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
                description: '4항목 각각의 판정 (순서 고정: 브랜드 가이드 준수 → 어그로 → 명확성 → 강조 포인트)',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        name: { type: 'string', enum: REVIEW_ITEMS },
                        ok: { type: 'boolean' },
                        comment: { type: 'string', description: '2줄 내외 코멘트 (문제없으면 짧은 확인, 문제면 구체 지적)' },
                    },
                    required: ['name', 'ok', 'comment'],
                },
            },
            suggestion: { type: 'string', description: "verdict가 '보완'일 때 수정 제안 (구체적으로). 통과면 출력하지 않는다" },
        },
        required: ['verdict', 'items'],
    },
};

// 콘텐츠 검수 — contentKind: '카피'|'시안 프롬프트', contentText: 검수 대상 전문
async function reviewContent({ contentKind, contentText }) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const systemPrompt = `너는 제주아꼼이네 농업회사법인(주) AGENT OFFICE 마케팅팀장 '한결'이다.
팀원(글샘·미소)의 콘텐츠를 대표 승인 전에 검수하는 것이 임무다. 아래 브랜드 가이드가 판정 기준이다.

===== [브랜드 가이드 v1] =====
${loadBrand()}

## 검수 4항목 (대표 확정 기준 — 이 순서로 전부 판정)
① 브랜드 가이드 준수 — 금지 표현(과장·자극, 명분 없는 할인), 타겟(30~50대 여성)·톤("아는 농가 사장님") 적합성. 시안 프롬프트는 제주 요소·브랜드 컬러·금지 소품도 확인
② 어그로(후킹) — 시선을 잡는 요소가 있는가
③ 목적·전달사항 명확성 — 이 콘텐츠가 뭘 하라는 건지 분명한가
④ 강조 포인트 — 핵심이 제대로 강조됐는가

## 판정 원칙
- 하나라도 보완 필요하면 verdict='보완' — 무난하게 통과시키지 말 것. 반대로 트집도 잡지 말 것 (실무 기준)
- 코멘트는 항목당 2줄 내외, 보완이면 suggestion에 구체 수정 제안
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
        suggestion: r.verdict === '보완' ? String(r.suggestion || '').slice(0, 500) : '',
        model: HANGYEOL_MODEL,
        reviewed_at: new Date().toISOString(),
    };
}

module.exports = {
    live: false, // 직접 라우팅 대상 아님 — 검수 게이트 전용 (글샘·미소 완료 시 자동 실행)
    reviewContent,
    REVIEW_ITEMS,
};
