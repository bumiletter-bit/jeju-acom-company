// 기안 (개발부서 · 기획 전문가) — 지시 #44 역할 부여 + 지시 #49 실전 가동 (소넷 구조화 기획)
// 출력 7항목 고정 (지시 #44·#46): 요약 · 목적(철학 4축+로드맵 매핑) · 대상 · 실행 단계(누가·뭘·언제) ·
// 비용 · 성공 지표(측정 가능 숫자) · 리스크 1+. 금지: 근거 없는 매출 전망 · 주체 없는 계획.
// 산출물은 미래(개발부서 팀장) 검수 게이트를 자동 통과한다 (gian_plan → 미래 검수 — 서버 레지스트리).
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const GIAN_MODEL = process.env.GIAN_MODEL || 'claude-sonnet-4-6';
const VISION_FILE = path.join(__dirname, '..', 'docs', 'knowledge', 'planning', '비전_v1.md');
const PERSONA_FILE = path.join(__dirname, '..', 'docs', 'agents', '기안_특성.md');
const BRAND_FILE = path.join(__dirname, '..', 'docs', 'knowledge', 'marketing', '브랜드가이드_v1.md');
const load = (fp, label) => { try { return fs.readFileSync(fp, 'utf8'); } catch (e) { return `(${label} 로드 실패: ${e.message})`; } };
const clean = v => typeof v === 'string' ? v.replace(/<[^>]*>/g, '').trim() : '';

const PLAN_TOOL = {
    name: 'submit_plan',
    description: '기획안(7항목)을 제출한다.',
    strict: true,
    input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            summary: { type: 'string', description: '① 한 줄 요약' },
            purpose: { type: 'string', description: "② 목적 — 3대 철학 4축 + 성장 로드맵 단계 매핑 (예: '철학① 재구매 신뢰 + 로드맵 1단계 자사몰 전환에 기여'). 로드맵과 무관하면 그 사실을 정직 표기" },
            target: { type: 'string', description: '③ 대상 손님' },
            steps: {
                type: 'array', description: '④ 실행 단계 — 누가·뭘·언제 (주체 없는 계획 금지)',
                items: {
                    type: 'object', additionalProperties: false,
                    properties: { who: { type: 'string' }, what: { type: 'string' }, when: { type: 'string' } },
                    required: ['who', 'what', 'when'],
                },
            },
            cost: { type: 'string', description: '⑤ 예상 비용 — 근거와 함께 (모르면 "미정 — 견적 필요" 정직 표기)' },
            metrics: { type: 'string', description: '⑥ 성공 지표 — 측정 가능한 숫자로. 근거 없는 매출 전망치 금지 (매출 예측 대신 측정 지표: 재구매율·클릭수·참여자 수 등)' },
            risks: { type: 'array', items: { type: 'string' }, description: '⑦ 리스크 1개 이상 정직 표기' },
        },
        required: ['summary', 'purpose', 'target', 'steps', 'cost', 'metrics', 'risks'],
    },
};

module.exports = {
    live: true, // 지시 #49: 실전 가동 — 마루 라우팅 시 기획안 생성 (미래 검수 게이트 자동)
    steps: ['비전·로드맵 대조 중...', '실행 단계 구성 중...', '기획안 작성 중...'],
    stepDelayMs: 1500,
    async result({ params = {} }) {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다');
        const instruction = String(params.order_content || '').trim();
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const systemPrompt = `너는 제주아꼼이네 AGENT OFFICE 개발부서 기획 전문가 '기안'이다.

===== [기안 특성 — 지시 #44·#46] =====
${load(PERSONA_FILE, '특성 파일')}

===== [비전_v1 — 기획 기준] =====
${load(VISION_FILE, '비전')}

===== [브랜드 가이드 v1] =====
${load(BRAND_FILE, '브랜드 가이드')}

## 작성 규칙
- 7항목 전부 채운다 (요약·목적·대상·실행 단계·비용·지표·리스크)
- 목적은 반드시 3대 철학 4축 + 로드맵 단계에 매핑. 무관하면 "로드맵 단계와 직접 연관 없음" 정직 표기
- 실행 단계는 누가·뭘·언제 — 주체 없는 계획 금지
- 성공 지표는 측정 가능한 숫자만. **근거 없는 매출 전망치 절대 금지** (매출 예측 대신 재구매율·참여 수 등 측정 지표)
- 비용을 모르면 "미정 — 견적 필요" 정직 표기. 리스크 1개 이상 필수
- 반드시 submit_plan 도구로 제출. 다른 텍스트 응답 금지`;
        const msg = await anthropic.messages.create({
            model: GIAN_MODEL, max_tokens: 1400,
            system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
            tools: [PLAN_TOOL], tool_choice: { type: 'tool', name: 'submit_plan' },
            messages: [{ role: 'user', content: `대표 기획 요청: ${instruction}` }],
        });
        const tu = msg.content.find(b => b.type === 'tool_use');
        if (!tu) throw new Error('기안 응답에서 기획안(tool_use)을 찾지 못했습니다');
        const p = tu.input;
        const report = {
            type: 'gian_plan',
            summary: clean(p.summary).slice(0, 200),
            purpose: clean(p.purpose).slice(0, 400),
            target: clean(p.target).slice(0, 200),
            steps: (Array.isArray(p.steps) ? p.steps : []).map(s => ({
                who: clean(s && s.who).slice(0, 60), what: clean(s && s.what).slice(0, 200), when: clean(s && s.when).slice(0, 60),
            })).filter(s => s.what).slice(0, 10),
            cost: clean(p.cost).slice(0, 200),
            metrics: clean(p.metrics).slice(0, 300),
            risks: (Array.isArray(p.risks) ? p.risks : []).map(x => clean(x).slice(0, 200)).filter(Boolean).slice(0, 6),
            model: GIAN_MODEL, instruction,
            note: '기획 기준 = 비전_v1 (철학 4축·로드맵) · 미래 팀장 검수 경유 · 실행은 대표 승인 후',
        };
        return {
            summary: `기획안: ${report.summary.slice(0, 60)}`,
            lines: [
                '🎯 ' + report.purpose.slice(0, 100),
                `실행 ${report.steps.length}단계 · 비용 ${report.cost.slice(0, 40)} · 리스크 ${report.risks.length}건`,
                '상세는 보고서 카드에서 — 실행은 대표 승인 후',
            ],
            report,
        };
    },
};
