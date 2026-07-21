// 지율 (법무팀장 · 노무) — 지시 #44 역할 부여 → 지시 #45 지식 주입 (노무지침_v1, 대기 모드 해제)
// 절대 규칙: [노무지침_v1]만 근거로 답변 — 지침에 없는 사안은 "지침서 범위 밖 — 노무사 확인 필요" 정지 (추측 금지).
// 휴가 '지시'는 기존 결재 시스템 안내 (마루 단계에서 처리) — 지율은 자문만. 소속 미확인 답변 금지.
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const JIYUL_MODEL = process.env.JIYUL_MODEL || 'claude-sonnet-4-6';
const GUIDE_FILE = path.join(__dirname, '..', 'docs', 'knowledge', 'legal', '노무지침_v1.md');
const PERSONA_FILE = path.join(__dirname, '..', 'docs', 'agents', '지율_특성.md');
const load = (fp, label) => { try { return fs.readFileSync(fp, 'utf8'); } catch (e) { return `(${label} 로드 실패: ${e.message})`; } };

// 구조화 제출 강제 — 오염 방어 (다른 요원과 동일 패턴)
const ADVICE_TOOL = {
    name: 'submit_advice',
    description: '노무 자문 결과를 제출한다.',
    strict: true,
    input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            mode: { type: 'string', enum: ['답변', '소속확인', '범위밖', '노무외'], description: '답변=지침 근거 자문 / 소속확인=어느 사업체인지 확인 필요 / 범위밖=지침에 없음 / 노무외=노무 이슈 아님' },
            question_back: { type: 'string', description: "mode='소속확인'일 때 대표에게 물을 질문 (예: 어느 사업체 소속인가요?). 그 외 출력하지 않는다" },
            conclusion: { type: 'string', description: '✅ 결론 1~2줄 (대표님 호칭, 법적 사실은 단정)' },
            legal_basis: { type: 'string', description: '⚖️ 법적 근거 — 근로기준법 조항·지침서 항목. 범위밖/노무외면 사유' },
            calculation: { type: 'string', description: '💰 계산·표 — 시간·금액·요건은 반드시 표 또는 코드블록 형태 텍스트로. 계산 공식 생략 금지. 해당 없으면 출력하지 않는다' },
            checkpoints: { type: 'array', items: { type: 'string' }, description: '⚠️ 노무사 체크포인트 (위험 ⚠️·분쟁 예방 📌 권고 포함)' },
            actions: { type: 'array', items: { type: 'string' }, description: '✅ 액션 아이템 (대표가 할 일)' },
        },
        required: ['mode', 'conclusion', 'legal_basis'],
    },
};
const clean = v => typeof v === 'string' ? v.replace(/<[^>]*>/g, '').trim() : '';

module.exports = {
    live: true, // 지시 #45: 노무지침_v1 주입 — 실전 자문 가동
    steps: ['노무지침_v1 대조 중...', '사업장 구분·적용 매트릭스 확인 중...', '자문 정리 중...'],
    stepDelayMs: 1500,
    async result({ pool, params = {} }) {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다');
        const instruction = String(params.order_content || '').trim();
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        // 학습 노트 (활성 — 승인제·상한 10, 다른 요원과 동일)
        let lessonsText = '';
        try {
            const ag = await pool.query(`SELECT id FROM agents WHERE code = 'jiyul' LIMIT 1`);
            if (ag.rows.length) {
                const lr = await pool.query(
                    `SELECT lesson, category FROM agent_lessons
                     WHERE agent_id = $1 AND status = 'active' AND is_deleted = false
                     ORDER BY created_at DESC LIMIT 10`, [ag.rows[0].id]);
                if (lr.rows.length) {
                    lessonsText = '\n\n## 📚 대표님 학습 노트 — 지침과 충돌하면 학습 노트를 우선 적용할 것!\n'
                        + lr.rows.map(l => `- [${l.category}] ${l.lesson}`).join('\n');
                }
            }
        } catch (e) { /* 학습 노트 로드 실패는 자문을 막지 않음 */ }
        // 🔴 지시 #54-4: 날짜 단일 소스 — 서버 확정값만 받아쓴다 (자체 계산·추측 절대 금지)
        const datesLine = params.dates_hint
            ? `

## 🔴 날짜 단일 소스 (지시 #54 — 절대 규칙)
확정 날짜: ${params.dates_hint}
날짜·기간은 이 확정값만 그대로 받아쓴다. 요일·날짜를 스스로 계산하지 않는다.`
            : `

## 🔴 날짜 규칙 (지시 #54 — 절대 규칙)
확정 날짜가 주입되지 않았다. 날짜가 필요하면 반드시 "00일(날짜 확인 필요)" 자리표시를 쓴다. 자체 계산·추측 금지.`;
        const systemPrompt = `너는 제주아꼼이네 AGENT OFFICE 법무팀장 '지율'이다.${datesLine}

===== [지율 특성 — 지시 #44·#45] =====
${load(PERSONA_FILE, '특성 파일')}

===== [노무지침_v1 — 유일한 답변 근거] =====
${load(GUIDE_FILE, '노무지침')}${lessonsText}

## 답변 규칙 (지시 #45 템플릿)
- 형식: ✅결론(1~2줄) → ⚖️법적 근거(근로기준법 조항) → 💰계산·표 → ⚠️노무사 체크포인트 → ✅액션 아이템
- 시간·금액·요건은 반드시 표/코드블록. 공식 생략한 계산 결과만 제시 금지
- 지침에 없는 사안 = mode='범위밖' ("지침서 범위 밖 — 노무사 확인 필요") 정지. 일반 지식 추측 절대 금지
- 소속(법인 vs 오션라운지) 불명확 = mode='소속확인'으로 되묻기. 소속 미확인 답변 금지
- 노무 이슈 없는 질문 = mode='노무외' ("노무 관련 이슈는 없습니다 — 해당 팀 문의"). 단 인건비·근태·채용·퇴직·4대보험은 적극 답변
- "5인 미만=다 면제" 단순화 금지 (주휴·최저임금·4대보험 항상 짚기). 특별 보호 대상(청소년·임산부) 점검 누락 금지
- 🔴 결론(conclusion)의 금액·수치는 반드시 calculation에서 실제로 도출한 값과 **글자 그대로 일치**해야 한다. calculation에 등장하지 않는 숫자를 결론에 쓰지 말 것.
- 🔴 주휴수당 금액은 반드시 (1주 소정근로시간 ÷ 40) × 8 × 시급 공식으로만 산출한다. **시급 × 1일 근로시간으로 단순 환산해 헤드라인 금액을 만드는 것을 절대 금지** (예: 4.5h·5일이면 54,000원이지 60,000원이 아니다).
- 🔴 금액 확정에 필요한 입력(근무일수 등)이 불명확하면 결론에 단일 금액을 단정하지 말고 경우별 금액(예: 주4일 43,200원 / 주5일 54,000원)을 그대로 제시한다. 계산표와 결론의 숫자가 서로 어긋나면 안 된다.
- 반드시 submit_advice 도구로 제출. 다른 텍스트 응답 금지`;
        const msg = await anthropic.messages.create({
            model: JIYUL_MODEL, max_tokens: 1400,
            system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
            tools: [ADVICE_TOOL], tool_choice: { type: 'tool', name: 'submit_advice' },
            messages: [{ role: 'user', content: `대표 질문: ${instruction}` }],
        });
        const tu = msg.content.find(b => b.type === 'tool_use');
        if (!tu) throw new Error('지율 응답에서 자문 결과(tool_use)를 찾지 못했습니다');
        const a = tu.input;
        const report = {
            type: 'jiyul_labor',
            mode: ['답변', '소속확인', '범위밖', '노무외'].includes(a.mode) ? a.mode : '범위밖',
            question_back: clean(a.question_back).slice(0, 300),
            conclusion: clean(a.conclusion).slice(0, 600),
            legal_basis: clean(a.legal_basis).slice(0, 800),
            calculation: clean(a.calculation).slice(0, 1500),
            checkpoints: (Array.isArray(a.checkpoints) ? a.checkpoints : []).map(x => clean(x).slice(0, 200)).slice(0, 8),
            actions: (Array.isArray(a.actions) ? a.actions : []).map(x => clean(x).slice(0, 200)).slice(0, 8),
            guide: '노무지침_v1', model: JIYUL_MODEL, instruction,
            note: '자문 근거 = 노무지침_v1만 (추측 금지 · 개정 대표 승인제). 최종 확정은 노무사 검토 권장',
        };
        const modeLabel = { '답변': '자문 완료', '소속확인': '소속 확인 필요', '범위밖': '지침서 범위 밖 — 노무사 확인 필요', '노무외': '노무 이슈 없음' }[report.mode];
        return {
            summary: `${modeLabel}: ${report.conclusion.slice(0, 60)}`,
            lines: [
                '✅ ' + report.conclusion,
                report.mode === '소속확인' ? '❓ ' + report.question_back : '⚖️ ' + report.legal_basis.slice(0, 100),
                report.actions.length ? '✅ 액션: ' + report.actions[0] : '상세는 보고서 카드에서',
            ],
            report,
        };
    },
};
