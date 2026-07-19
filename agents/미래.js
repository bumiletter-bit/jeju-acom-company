// 미래 (개발부서 팀장) — 검수 게이트 (지시 #44)
// 역할: 기안 산출물을 검수 4문(팀장 공통)으로 확인. ② "대표가 실행 버튼 누를 만큼 구체적인가" 특화.
// 검수 시에만 소넷 1회. 자동 재작성 금지 (대표 요청 시 1회). ⚠️도 숨김 없이 표시 — 최종 판단 대표.
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const MIRAE_MODEL = process.env.MIRAE_MODEL || 'claude-sonnet-4-6';
const PERSONA_FILE = path.join(__dirname, '..', 'docs', 'agents', '미래_특성.md');
const BRAND_FILE = path.join(__dirname, '..', 'docs', 'knowledge', 'marketing', '브랜드가이드_v1.md');
const load = (fp, label) => { try { return fs.readFileSync(fp, 'utf8'); } catch (e) { return `(${label} 로드 실패: ${e.message})`; } };

const REVIEW_ITEMS = ['우리다움', '대표 의도(실행 구체성)', '정직·정확'];
const REVIEW_TOOL = {
    name: 'submit_review',
    description: '기획 검수 결과를 제출한다.',
    strict: true,
    input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            verdict: { type: 'string', enum: ['통과', '보완'] },
            items: {
                type: 'array',
                description: '검수 3항목 판정 (순서 고정: 우리다움 → 대표 의도(실행 구체성) → 정직·정확)',
                items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                        name: { type: 'string', enum: REVIEW_ITEMS },
                        ok: { type: 'boolean' },
                        comment: { type: 'string', description: '2줄 내외 — 뜬구름이면 "이 부분을 숫자/날짜로" 식으로 구체 지적' },
                    },
                    required: ['name', 'ok', 'comment'],
                },
            },
            comment: { type: 'string', description: '전체 총평 한 줄' },
            fill_items: { type: 'array', items: { type: 'string' }, description: '[대표가 채울 항목]. 없으면 출력하지 않는다' },
            suggestion: { type: 'string', description: "보완일 때 수정 제안 (숫자/날짜/주체를 어떻게 채울지). 통과면 출력하지 않는다" },
        },
        required: ['verdict', 'items', 'comment'],
    },
};

async function reviewContent({ contentKind, contentText }) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const systemPrompt = `너는 제주아꼼이네 농업회사법인(주) AGENT OFFICE 개발부서 팀장 '미래'다.
팀원(기안)의 기획 산출물을 대표 승인 전에 검수하는 것이 임무다.

===== [미래 특성 — 지시 #44] =====
${load(PERSONA_FILE, '특성 파일')}

===== [브랜드 가이드 v1] =====
${load(BRAND_FILE, '브랜드 가이드')}

## 검수 4문 (팀장 공통 — 이 순서로 전부 판정)
① 우리다움 — 브랜드 가이드·회사 4축(단골화/직원 편의/손님 재미/친근 CS 재구매)에 맞는가, 과장 없나
② 대표 의도(실행 구체성) — **대표가 실행 버튼을 누를 만큼 구체적인가**: 목적·대상·비용·다음 액션이 있나. 뜬구름이면 "이 부분을 숫자/날짜로" 지적
③ 정직·정확 — 근거 없는 매출 전망·주체 없는 계획 없나, 리스크가 정직하게 표기됐나
④ 판정 — verdict + 총평 한 줄 + [대표가 채울 항목]

## 원칙: 지적에는 고치는 방법을 함께. 반드시 submit_review 도구로만 제출`;
    const msg = await anthropic.messages.create({
        model: MIRAE_MODEL, max_tokens: 900, system: systemPrompt,
        tools: [REVIEW_TOOL], tool_choice: { type: 'tool', name: 'submit_review' },
        messages: [{ role: 'user', content: `[검수 대상 — ${contentKind}]\n${String(contentText).slice(0, 6000)}` }],
    });
    const tu = msg.content.find(b => b.type === 'tool_use');
    if (!tu) throw new Error('미래 검수 응답에서 결과(tool_use)를 찾지 못했습니다');
    const r = tu.input;
    return {
        verdict: r.verdict === '통과' ? '통과' : '보완',
        items: (Array.isArray(r.items) ? r.items : []).slice(0, 4),
        comment: String(r.comment || '').slice(0, 200),
        fill_items: (Array.isArray(r.fill_items) ? r.fill_items : []).map(x => String(x).slice(0, 80)).slice(0, 10),
        suggestion: r.verdict === '보완' ? String(r.suggestion || '').slice(0, 500) : '',
        reviewer: '미래', model: MIRAE_MODEL, reviewed_at: new Date().toISOString(),
    };
}

module.exports = { live: false, reviewContent, REVIEW_ITEMS }; // 검수 게이트 전용 (기안 실전 연결 시 자동 작동)
