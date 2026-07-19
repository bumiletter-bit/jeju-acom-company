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
            // 지시 #62-1: deliverables 최상단 — 결과물 창작 요청이면 계획보다 실물을 먼저 쓴다
            deliverables: {
                type: 'array', items: { type: 'string' },
                description: '📦 산출물 (지시 #54-5·#62-1 — 최우선): 요청받은 후보·시안·리스트의 실제 내용 전문. 지시에 "N개" 요청이 있으면 정확히 N개 이상 실물 필수. 작성 예시 — "아이디 후보 1: acomine_jeju — 아꼼이네+제주 직관 조합 (선정 이유 한 줄)", "소개글 후보 1: (소개글 전문 전체)". 계획만 쓰고 이 칸을 비우면 실패. 결과물 요청이 아니면 출력하지 않는다',
            },
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
        // 🔴 지시 #54-4: 날짜 단일 소스 — 서버 확정값만 받아쓴다 (자체 계산·추측 절대 금지)
        const datesLine = params.dates_hint
            ? `

## 🔴 날짜 단일 소스 (지시 #54 — 절대 규칙)
확정 날짜: ${params.dates_hint}
날짜·기간은 이 확정값만 그대로 받아쓴다. 요일·날짜를 스스로 계산하지 않는다.`
            : `

## 🔴 날짜 규칙 (지시 #54 — 절대 규칙)
확정 날짜가 주입되지 않았다. 날짜가 필요하면 반드시 "00일(날짜 확인 필요)" 자리표시를 쓴다. 자체 계산·추측 금지.`;
        const systemPrompt = `너는 제주아꼼이네 AGENT OFFICE 개발부서 기획 전문가 '기안'이다.${datesLine}

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
- 📦 **산출물(deliverables) — 가장 먼저 채운다 (지시 #62-1)**: 대표가 후보·시안·리스트 등 결과물 자체를 요청하면 (예: "아이디 3개 만들어줘") deliverables에 **완성본 전문**을 담는다. 지시에 "N개" 요청이 있으면 정확히 N개 이상. 작성 예시:
  deliverables: ["아이디 후보 1: acomine_jeju — 아꼼이네+제주 직관 조합 (선정 이유 한 줄)", "아이디 후보 2: jeju_acom_farm — 농장 정체성 강조 (선정 이유 한 줄)", "소개글 후보 1: (소개글 전문 전체를 그대로 작성)"]
  실행 단계에 "후보 중 선택"이라 써놓고 이 칸을 비우면 말-실물 불일치로 실패 (지시 #54·#62)
- 반드시 submit_plan 도구로 제출. 다른 텍스트 응답 금지`;
        // 지시 #59-3: 창작 요청 감지 — deliverables 실물 필수 (빈 배열 = 재생성 1회 → 실패 시 정직 표기)
        const isCreative = /만들어\s*줘|추천|후보|예시|(\d+)\s*개\s*(해|만들|뽑|제안)|시안/.test(instruction);
        const callPlan = async extra => await anthropic.messages.create({
            model: GIAN_MODEL, max_tokens: 3000, // 지시 #62-1: 1400 → 3000 — 7항목+산출물 전문(아이디·소개글 N안)을 담을 예산 (run #68 미기재 원인 후보 제거)
            system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
            tools: [PLAN_TOOL], tool_choice: { type: 'tool', name: 'submit_plan' },
            messages: [{ role: 'user', content: `대표 기획 요청: ${instruction}${extra || ''}` }],
        });
        let msg = await callPlan();
        let tu = msg.content.find(b => b.type === 'tool_use');
        if (!tu) throw new Error('기안 응답에서 기획안(tool_use)을 찾지 못했습니다');
        let p = tu.input;
        let deliverablesError = '';
        // 지시 #59-3: 창작 요청인데 산출물이 비면 재생성 1회 (경고 명시) → 그래도 비면 정직 표기
        const delivEmpty = arr => !Array.isArray(arr) || !arr.filter(x => x && String(x).trim()).length;
        // 지시 #62-1: 말-실물 불일치 차단 — steps가 '후보 중 선택'류를 언급하는데 결과물이 비면 자동 실패
        const stepsRefer = pp => /후보|시안|\d+\s*안\s*중|안?\s*중\s*(최종\s*)?(선택|확정|1\s*개|1\s*안)/.test(JSON.stringify((pp && pp.steps) || []));
        if ((isCreative || stepsRefer(p)) && delivEmpty(p.deliverables)) {
            msg = await callPlan('\n\n※ 경고: 직전 응답에 산출물(deliverables)이 비어 있었다. 대표가 요청한 후보·시안·예시의 **완성본 전문**을 deliverables 배열에 반드시 담아라 (예: 아이디 후보 각각, 소개글 각각의 전체 텍스트). 실행 단계에 "만들 예정"만 쓰는 것은 실패다.');
            tu = msg.content.find(b => b.type === 'tool_use');
            if (tu && !delivEmpty(tu.input.deliverables)) p = tu.input;
            else deliverablesError = '산출물 생성 실패 (말-실물 불일치) — 재생성 1회에도 deliverables가 비어 있음 (사유: 모델이 결과물 칸을 채우지 않음). 대표 확인 필요';
        }
        // 지시 #50-4: 7항목 서버 구조화 보장 — 누락·정화 후 빈 필드는 "미정 — 대표 확인 필요" 자리표시 (정직 표기, 몰래 생략 금지)
        const HOLD = '미정 — 대표 확인 필요';
        const or = (v, cap) => { const c = clean(v).slice(0, cap); return c || HOLD; };
        let steps = (Array.isArray(p.steps) ? p.steps : []).map(s => ({
            who: clean(s && s.who).slice(0, 60) || HOLD, what: clean(s && s.what).slice(0, 200), when: clean(s && s.when).slice(0, 60) || HOLD,
        })).filter(s => s.what).slice(0, 10);
        if (!steps.length) steps = [{ who: HOLD, what: HOLD, when: HOLD }];
        let risks = (Array.isArray(p.risks) ? p.risks : []).map(x => clean(x).slice(0, 200)).filter(Boolean).slice(0, 6);
        if (!risks.length) risks = [HOLD];
        const report = {
            type: 'gian_plan',
            summary: or(p.summary, 200),
            purpose: or(p.purpose, 400),
            target: or(p.target, 200),
            steps,
            cost: or(p.cost, 200),
            metrics: or(p.metrics, 300),
            risks,
            deliverables: (Array.isArray(p.deliverables) ? p.deliverables : []).map(x => clean(x).slice(0, 1000)).filter(Boolean).slice(0, 10),
            deliverables_error: deliverablesError,
            model: GIAN_MODEL, instruction,
            note: '기획 기준 = 비전_v1 (철학 4축·로드맵) · 미래 팀장 검수 경유 · 실행은 대표 승인 후 · 미정 항목은 대표 확인 필요',
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
