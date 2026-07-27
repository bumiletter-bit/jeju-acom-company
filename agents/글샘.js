// AGENT OFFICE 실행 스크립트 — 글샘 (마케팅팀 · 문구)
// 4차: 실전 연결 — Anthropic Sonnet으로 즉시 발송 가능한 카피 생성.
// 원칙: ① 카피 "생성"까지만 — 자동 발송 경로는 어디에도 없음 (발송은 대표가 알리고에서 직접)
//       ② 대표 지시 원문을 자르지 않고 통째로 전달받아 작성
//       ③ 지식 문서(10블록·검증 라임·명분·톤앤매너) 완전 준수, 학습 노트는 지식보다 우선
//       ④ 누락 정보는 지어내지 않고 [가격 입력] 자리표시 + 채울 목록 보고
//       ⑤ API 오류 시 허위 카피 없이 오류 그대로 (throw → 실행 '오류' 기록)
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// 카피 품질이 중요해서 Haiku가 아닌 Sonnet급 기본 (환경변수로 교체 가능)
// 대표 7/27: claude-sonnet-4-6에서 상향 — 구형이 본문 필드에 "test"만 넣는 사고(run#219)·제목 오염 파편(run#60) 반복 → 톡톡봇과 동일 모델로 통일
const GEULSAEM_MODEL = process.env.GEULSAEM_MODEL || 'claude-sonnet-5';

const KNOWLEDGE_DIR = path.join(__dirname, '..', 'docs', 'knowledge', 'marketing');
const KNOWLEDGE_FILES = [
    '브랜드가이드_v1.md',        // [A+] 브랜드 정체성 · 타겟 · 톤 (지시 #31 — 정적 가이드, 개정 대표 승인제)
    '문자톡톡_전문가_지침.md',   // [B] 10블록 구조 · 검증 라임 · 절대 금지
    '상품별_톤앤매너_가이드.md',  // [C]
    '마케팅_문자_가이드북.md',    // [D] 채널 규격 · 골든타임
    '명분_라이브러리.md',        // [E] 명분 없는 할인 금지
    '검증된_카피_자산집.md',     // [F] 킬러 카피
    '마케팅_전문팀_시스템.md',    // [G] 비전 · 출력 규칙
    '톡톡_실전사례_v1.md',       // [H] 1년치 발송 실물 15건 분석 (대표 제공 7/20 — 참고·발전, 고정 금지)
];
let _knowledgeCache = null;
function loadKnowledge() {
    if (_knowledgeCache) return _knowledgeCache;
    const parts = [];
    for (const f of KNOWLEDGE_FILES) {
        try {
            parts.push(`\n\n===== [지식 문서: ${f}] =====\n` + fs.readFileSync(path.join(KNOWLEDGE_DIR, f), 'utf8'));
        } catch (e) {
            parts.push(`\n\n===== [지식 문서: ${f}] =====\n(로드 실패: ${e.message})`);
        }
    }
    _knowledgeCache = parts.join('');
    return _knowledgeCache;
}

// ── 문의 답변 재료 (대표 7/27 — 전부 기존 DB 읽기 전용. 시나리오=톤 교과서, bot_products=사실 출처, 수집 문의=유형 참고)
//    PII 원칙: 고객문의 본문은 수집 시 마스킹본이지만, 직원 실답변(message_logs)은 원문이므로 주입 전 마스킹 재적용.
function maskContact(s) {
    return String(s || '')
        .replace(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, '(연락처)')
        .replace(/\d{2,4}[-\s.]\d{3,4}[-\s.]\d{4}/g, '(연락처)')
        .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '(이메일)')
        .replace(/010-6687-4031|\(연락처\) 고객센터/g, '📞 010-6687-4031'); // 회사 공개 번호는 복원 (꼬리 문구 학습용)
}
const INQUIRY_TRIGGER = /문의|답변|시나리오|Q&A|QnA|톡톡.{0,6}(문구|답)|고객.{0,6}(질문|물어)|물어(봐|보는|보나)/i;
async function loadInquiryMaterials(pool, instruction) {
    if (!INQUIRY_TRIGGER.test(String(instruction || ''))) return '';
    const parts = [];
    try {
        const sc = await pool.query(
            `SELECT scenario_no, name, channel, response FROM inquiry_scenarios
             WHERE deleted_at IS NULL AND enabled = true ORDER BY scenario_no ASC, id ASC`);
        parts.push(`\n\n===== [문의 답변 시나리오 — 우리 답변의 톤·구조 교과서 (${sc.rows.length}건, DB 실시간)] =====\n`
            + sc.rows.map(s => `### [${s.scenario_no}·${s.channel}] ${s.name}\n${s.response}`).join('\n\n'));
    } catch (e) { parts.push(`\n\n(시나리오 로드 실패: ${e.message})`); }
    try {
        const bp = await pool.query(`SELECT name, status, price FROM bot_products WHERE deleted_at IS NULL ORDER BY status, name`);
        parts.push('\n\n===== [판매현황·판매가 — 사실 정보의 유일한 출처 (bot_products, DB 실시간)] =====\n'
            + bp.rows.map(r => `- ${r.name}: ${r.status}${r.price ? ` (${r.price})` : ''}`).join('\n'));
    } catch (e) { /* 생략 */ }
    try {
        const cat = await pool.query(
            `SELECT raw->>'category' AS c, COUNT(*) AS n FROM naver_inquiries
             WHERE collected_at > NOW() - INTERVAL '30 days' GROUP BY 1 ORDER BY n DESC`);
        const skipQ = await pool.query(
            `SELECT raw->>'question' AS q FROM naver_qnas WHERE ai_status IN ('skip') ORDER BY collected_at DESC LIMIT 8`);
        const skipI = await pool.query(
            `SELECT raw->>'title' AS t, raw->>'content' AS c FROM naver_inquiries
             WHERE ai_status IN ('skip','claim') ORDER BY collected_at DESC LIMIT 8`);
        parts.push('\n\n===== [최근 실제 고객 질문 동향 (30일 수집분 — 마스킹본)] =====\n'
            + '유형별 건수: ' + (cat.rows.map(x => `${x.c || '기타'} ${x.n}건`).join(' · ') || '(수집분 없음)') + '\n'
            + '자동답변이 SKIP한(=시나리오가 못 받은) 최근 질문 예:\n'
            + [...skipQ.rows.map(x => `- (상품문의) ${String(x.q || '').replace(/\s+/g, ' ').slice(0, 100)}`),
               ...skipI.rows.map(x => `- (고객문의) ${String((x.t || '') + ' ' + (x.c || '')).replace(/\s+/g, ' ').slice(0, 100)}`)].join('\n'));
    } catch (e) { /* 생략 */ }
    try {
        const st = await pool.query(
            `SELECT message, staff_response FROM message_logs
             WHERE staff_response IS NOT NULL AND staff_response <> '' AND LENGTH(staff_response) > 60
             ORDER BY id DESC LIMIT 8`);
        if (st.rows.length) parts.push('\n\n===== [직원 실답변 사례 (톡톡 최근 — 마스킹 적용)] =====\n'
            + st.rows.map(x => `Q: ${maskContact(x.message).replace(/\s+/g, ' ').slice(0, 80)}\nA: ${maskContact(x.staff_response).replace(/\s+/g, ' ').slice(0, 200)}`).join('\n---\n'));
    } catch (e) { /* 생략 */ }
    return parts.join('') + `

## 문의 답변 문구 모드 (위 재료가 주입된 경우 — 반드시 준수)
- 대표가 "OO 문의 답변 문구 써줘" 류를 지시하면 channel='문의답변'으로 제출한다. 이 채널은 알리고 규칙(이모지 금지·10블록·(광고) 머리말) **미적용** — 시나리오 재료의 라임을 그대로 따른다: "안녕하세요 고객님, 제주아꼼이네입니다 🍊" 인사, 존댓말+이모지, 마지막 줄 "*추가 문의사항 있으시다면 언제든지 톡톡 또는 📞 010-6687-4031 고객센터 번호로 연락주시면 빠른 상담 도와드리겠습니다." 꼬리까지.
- 사실 정보(가격·기간·구성·정책)는 위 재료(시나리오·판매현황)에 있는 값만 쓴다. 재료에 없는 사실이 필요하면 본문에 "⚠️ 대표님 확인 필요: OO" 표시를 넣고 missing_fields에 나열한다 — 지어내기 절대 금지.
- "요즘 손님들 뭐 많이 물어봐?" 류 동향 질문이면 channel='문의요약'으로, versions 1개(label '문의 동향')에 위 동향 재료 기반 요약 보고를 담는다. 재료에 없는 수치는 만들지 않는다.
- 이 모드의 결과물도 초안일 뿐이다 — 시나리오 등록·수정은 사람이 [문의 관리]에서 한다는 안내를 send_tip에 남긴다.`;
}

// 지시 #39: 제목 필드 정화 — 오염 파편(마크업 태그·JSON 원문) 감지 시 정화, 불가 시 빈 값 반환
// (오염 텍스트를 대표 화면에 노출 금지 + 몰래 지어내기 금지 — 정직 원칙)
function cleanTitleField(v) {
    if (typeof v !== 'string') return '';
    const s = v.trim();
    if (!s) return '';
    if (!/[<>{}[\]]|antml|parameter/i.test(s)) return s.slice(0, 40); // 파편 없음 — 정상 제목
    // 파편 감지 — 태그·JSON 구조 제거 후 첫 줄이 짧은 정상 제목이면 그것만 살림
    const first = s.replace(/<[^>]*>/g, ' ').replace(/[{}[\]"\\]/g, ' ').split('\n')
        .map(x => x.trim()).filter(Boolean)[0] || '';
    if (first && first.length <= 30 && !/label|text|versions|parameter|antml|name=/i.test(first)) return first;
    return ''; // 정화 불가 — 제목 생략 (title_error로 사유 표시)
}

// 강제 tool 호출로 구조화된 카피 제출 보장
const COPY_TOOL = {
    name: 'submit_copy',
    description: '작성 완료한 카피 결과물을 제출한다.',
    strict: true,
    input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            channel: { type: 'string', enum: ['LMS', 'SMS', '톡톡', '문의답변', '문의요약'], description: '작성한 채널 (고객 문의 답변 문구=문의답변, 문의 동향 요약=문의요약)' },
            title: { type: 'string', description: 'LMS 제목 제안 (한글 13자 이내). 해당 없으면 빈 문자열' },
            versions: {
                type: 'array',
                description: '카피 버전 1~3개. 단일 지시면 1개, 열린 지시면 안정형/어그로형/감성형 3개',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        label: { type: 'string', description: '버전 이름 (예: 기본 / 안정형 / 어그로형 / 감성형)' },
                        text: { type: 'string', description: '즉시 발송 가능한 완성 카피 본문 전체' },
                    },
                    required: ['label', 'text'],
                },
            },
            missing_fields: {
                type: 'array', items: { type: 'string' },
                description: "지시에 없어 [자리표시]로 남긴 항목 목록 (예: '가격', '마감일', '링크'). 없으면 빈 배열",
            },
            char_counts: { type: 'string', description: "버전별 글자 수 요약 (예: '기본 842자')" },
            send_tip: { type: 'string', description: '추천 발송 타이밍·후속 전략 한두 줄' },
        },
        required: ['channel', 'title', 'versions', 'missing_fields', 'char_counts', 'send_tip'],
    },
};

module.exports = {
    cleanTitleField, // 지시 #39: 역량 박제용 export (제목 파편 정화)
    live: true, // 실전 연결됨 (4차) — 마루 라우팅 시 실제 카피 생성
    steps: ['지식 문서(10블록·검증 라임) 로드 중...', '카피 초안 작성 중...', '규격·금지사항 검수 중...'],
    stepDelayMs: 1500,
    async result({ agent, pool, params = {} }) {
        // 대표 지시 원문 (마루가 자르지 않고 통째로 전달)
        const instruction = String(params.order_content || '').trim();
        if (!instruction) {
            // 수동 [지금 실행] 등 지시 원문이 없는 경우 — 허위 카피를 만들지 않음
            return {
                summary: '지시 내용이 없어 카피를 만들지 않았습니다',
                lines: [
                    '글샘은 대표 지시 원문이 있어야 카피를 작성합니다',
                    '하단 입력바로 마루에게 지시하면 원문이 그대로 전달됩니다',
                    '예: "카라향 마감 임박 LMS 만들어줘 — 5kg 39,900원, 일요일 마감"',
                ],
            };
        }
        if (!process.env.ANTHROPIC_API_KEY) {
            throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다 (Render 환경변수 확인 필요)');
        }

        // 학습 노트 (활성) — 지식 문서보다 우선 적용
        let lessonsText = '';
        try {
            const lr = await pool.query(
                `SELECT lesson, category FROM agent_lessons
                 WHERE agent_id = $1 AND status = 'active' AND is_deleted = false
                 ORDER BY created_at DESC LIMIT 10`, [agent.id]); // 지시 #22-6: 활성 교훈 상한 10
            if (lr.rows.length) {
                lessonsText = '\n\n## 📚 대표님 학습 노트 — 아래 교훈이 지식 문서와 충돌하면 학습 노트를 우선 적용할 것!\n'
                    + lr.rows.map(l => `- [${l.category || '일반'}] ${l.lesson}`).join('\n');
            }
        } catch (e) { /* 노트 로드 실패는 카피 작성을 막지 않음 */ }

        // 오늘 날짜+요일 (KST) — 본문 날짜 표기 시 요일 검산용
        const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
        const todayStr = nowKst.toISOString().slice(0, 10);
        const dayName = ['일', '월', '화', '수', '목', '금', '토'][nowKst.getUTCDay()];

        // v5.0 3단계: 활성 할인·이벤트 일정만 컨텍스트 주입 — 활성 할인 = 명분 있는 할인
        // (지식 문서의 '명분 없는 할인 표현 금지' 규칙과 충돌하지 않게 오늘 활성인 것만 전달)
        let discountText = '';
        try {
            const dr = await pool.query(
                `SELECT date, end_date, title FROM schedules
                 WHERE is_deleted = false AND category = '할인·이벤트'
                   AND date <= $1 AND COALESCE(end_date, date) >= $1
                 ORDER BY date`, [todayStr]);
            if (dr.rows.length) {
                discountText = '\n\n## 현재 활성 할인·이벤트 (오늘 기준 — 카피에 명분으로 활용 가능)\n'
                    + dr.rows.map(s => `- ${String(s.date).slice(0, 10)}${s.end_date ? '~' + String(s.end_date).slice(0, 10) : ''}: ${s.title}`).join('\n')
                    + '\n(이 목록에 없는 할인 표현은 명분 없는 할인 금지 규칙에 따라 쓰지 않는다)';
            }
        } catch (e) { /* 주입 실패는 카피 작성을 막지 않음 */ }

        // 지시 #44: 특성 파일 주입 (인격·스타일 — docs/agents/글샘_특성.md, 개정 대표 승인제)
        let personaText = '';
        try { personaText = '\n\n===== [글샘 특성 — 지시 #44] =====\n' + fs.readFileSync(path.join(__dirname, '..', 'docs', 'agents', '글샘_특성.md'), 'utf8'); }
        catch (e) { personaText = `\n\n(특성 파일 로드 실패: ${e.message})`; }
        // 🔴 지시 #54-4: 날짜 단일 소스 — 서버 확정값만 받아쓴다 (자체 계산·추측 절대 금지)
        const datesLine = params.dates_hint
            ? `

## 🔴 날짜 단일 소스 (지시 #54 — 절대 규칙)
확정 날짜: ${params.dates_hint}
날짜·기간은 이 확정값만 그대로 받아쓴다. 요일·날짜를 스스로 계산하지 않는다.
행사 기간이 확정되면 본문에 반드시 명시하되, 고객 발송 카피에는 "7월 21일(화)~23일(목)" 같은 한국식 표기를 쓴다 (ISO "2026-07-21"은 내부용 — 지시 #59).`
            : `

## 🔴 날짜 규칙 (지시 #54 — 절대 규칙)
확정 날짜가 주입되지 않았다. 날짜가 필요하면 반드시 "00일(날짜 확인 필요)" 자리표시를 쓴다. 자체 계산·추측 금지.`;
        // 대표 7/27: 문의 관련 지시면 문의 DB 재료(시나리오·판매현황·수집 문의·실답변) 주입 — 전부 읽기 전용
        let inquiryMaterials = '';
        try { inquiryMaterials = await loadInquiryMaterials(pool, instruction); }
        catch (e) { /* 재료 로드 실패는 카피 작성을 막지 않음 */ }
        const systemPrompt = `너는 제주아꼼이네 농업회사법인(주) AGENT OFFICE 마케팅팀의 카피라이터 '글샘'이다.${personaText}${datesLine}
아래 지식 문서는 **참고용 카피 자산**이다 (톤·구조·표현 예시). 절대 규칙이 아니다.
🎯 **대표 지시 내용이 최우선 근거다** (대표 7/20): 대표가 이번 지시에서 준 정보·강점(예: "지금 맛이 아주 좋다")을 카피의 중심으로 삼는다. 지식 문서에 적힌 셀링포인트(예: "초반 호박이 1년 중 가장 포슬")는 대표가 그 내용을 말했을 때만 쓴다 — 대표가 언급하지 않은 특성(초반/후반/특정 시기 등)을 임의로 지어내 강조하지 않는다.
오늘 날짜: ${todayStr} (${dayName}요일, KST) — 본문에 날짜·마감일을 쓸 때 요일은 이 기준으로 반드시 검산할 것. 확신 없으면 요일을 빼고 날짜만 쓴다.

## 작업 규칙 (반드시 준수)
1. 채널 판단: 지시에 채널 언급이 없으면 알리고 LMS(1,000자 이내) 기본. "톡톡"이라 하면 네이버 톡톡 규격, "짧게"/"문자 90자"면 SMS.
1-2. 어그로(강한 후킹)는 **허용한다** (대표 7/20): 전환을 부르고 **그 내용이 사실이면** 강하게 어필해도 된다. 최종 판단은 대표가 한다. 단 **명백한 거짓·근거 없는 수치**만 금지 (예: 판매량·순위·효능을 지어내기). "미쳤어요/끝판/인생○/역대급" 같은 표현도 사실 기반이면 어그로형에서 쓸 수 있다 — 다만 남발하지 말고 상품 강점이 실제로 뒷받침될 때 쓴다.
2. 알리고(LMS/SMS) 절대 위반 금지: 이모지 사용 금지(★ ▶ ◆ ━ ─ 기호만), 첫 줄 "(광고)제주아꼼이네입니다^^" 고정, 표준 10블록 순서 유지, VIP 혜택 블록 + 수신거부 안내 고정. 톡톡은 이모지 허용.
3. 누락 정보 처리: 가격·쿠폰·마감일·수량·링크가 지시에 없으면 절대 지어내지 말고 [가격 입력], [마감일 입력], [링크 입력] 같은 대괄호 자리표시로 초안을 완성한 뒤 missing_fields에 나열한다. 되묻느라 멈추지 말고 초안을 먼저 완성한다.
4. 버전: 단일·구체 지시면 1개, 열린 지시면 최대 3개(안정형/어그로형/감성형).
5. 과장·허위 금지, 명분 없는 할인 표현 금지 (명분 라이브러리 준수).
6. 반드시 submit_copy 도구로 제출한다. 도구 밖 텍스트 응답 금지.
7. 🔴 versions[].text에는 **즉시 사용 가능한 완성 본문 전체**를 넣는다 — "test"·요약·자리 텍스트·제목만 넣는 것은 실패다 (char_counts에 적은 글자 수와 본문 실제 길이가 일치해야 한다).
${loadKnowledge()}${lessonsText}${discountText}${inquiryMaterials}`;

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const callModel = async (extraNote) => {
            let msg;
            try {
                msg = await anthropic.messages.create({
                    model: GEULSAEM_MODEL,
                    max_tokens: 4000,
                    system: [{ type: 'text', text: systemPrompt + (extraNote || ''), cache_control: { type: 'ephemeral' } }],
                    tools: [COPY_TOOL],
                    tool_choice: { type: 'tool', name: 'submit_copy' },
                    messages: [{ role: 'user', content: `범 대표님 지시 (원문 그대로):\n${instruction}` }],
                });
            } catch (err) {
                // 오류 정직 표시 — 허위 카피 생성 금지
                throw new Error(err && err.status
                    ? `Anthropic API 오류 (${err.status}): ${err.message}`
                    : (err && err.message) || String(err));
            }
            const toolUse = msg.content.find(b => b.type === 'tool_use');
            if (!toolUse) throw new Error('글샘 응답에서 카피 결과(tool_use)를 찾지 못했습니다');
            return toolUse.input;
        };
        // 본문 실물 검증 (대표 7/27 — run#219에서 본문에 "test" 4자만 담긴 사고): 전 버전이 40자 미만이면 1회 재시도
        let c = await callModel();
        let versions = Array.isArray(c.versions) ? c.versions.filter(v => v && v.text) : [];
        if (versions.length === 0 || versions.every(v => String(v.text).trim().length < 40)) {
            c = await callModel('\n\n※ 경고: 직전 응답의 versions[].text에 완성 본문이 없었다. 각 버전 text에 즉시 사용 가능한 완성 본문 전체를 반드시 담아라. 자리 텍스트·요약 금지.');
            versions = Array.isArray(c.versions) ? c.versions.filter(v => v && v.text) : [];
        }
        // 평문 폴백 (7/27 3연타 재테스트 실측 run#226: 도구 JSON 태그 오염으로 versions 본문이 재시도까지 2회 연속 전멸)
        //   마루 v5.9.110과 같은 해법 — 본문만은 도구 없이 평문 재질의(오염 원천 불가 경로). 제출 부가 필드(제목·채널)는 포기하고 본문 확보 우선.
        let plainFallback = false;
        if (versions.length === 0 || versions.every(v => String(v.text).trim().length < 40)) {
            const msg2 = await anthropic.messages.create({
                model: GEULSAEM_MODEL, max_tokens: 4000,
                system: [{ type: 'text', text: systemPrompt + '\n\n※ 지금은 submit_copy 도구를 쓰지 않는다. 지시에 맞는 완성 카피 본문 1종만 평문으로 출력하라 — 제목·설명·JSON·태그 없이, 즉시 사용 가능한 본문 텍스트만.', cache_control: { type: 'ephemeral' } }],
                messages: [{ role: 'user', content: `범 대표님 지시 (원문 그대로):\n${instruction}` }],
            });
            const plain = (msg2.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
            if (plain.length >= 40) { versions = [{ text: plain, label: '기본 (평문 폴백)' }]; plainFallback = true; }
        }
        if (versions.length === 0) throw new Error('글샘이 카피 본문을 생성하지 못했습니다 (평문 폴백 포함 3회 실패)');
        if (versions.every(v => String(v.text).trim().length < 40)) throw new Error('글샘이 완성 본문 대신 자리 텍스트만 제출했습니다 (재시도 후에도 실패 — 허위 보고 방지 차단)');
        const missing = Array.isArray(c.missing_fields) ? c.missing_fields.filter(Boolean) : [];
        // 채널·글자수 표기도 오염 방어: 파편 감지 시 안전값 (본문과 달리 표기용이라 생략해도 무해)
        const channelSafe = (typeof c.channel === 'string' && c.channel.trim() && !/[<>{}]|antml|parameter/i.test(c.channel))
            ? c.channel.trim().slice(0, 20) : '카피';
        const charCounts = plainFallback ? `본문 약 ${versions[0].text.length}자 (평문 폴백)` : (c.char_counts || '');
        // 지시 #39: 제목 필드 정화 — run #60에서 오염 파편(태그+versions JSON 원문 1,366자)이
        // 제목에 유입돼 대표 화면에 노출된 첫 사례. 정화 불가 시 제목 생략 (몰래 지어내기 금지)
        const title = cleanTitleField(c.title);

        return {
            summary: `완료: ${channelSafe} 카피 ${versions.length}종${missing.length ? ` (채울 항목 ${missing.length}개)` : ''}${plainFallback ? ' — 평문 폴백' : ''}`,
            lines: [
                `채널 ${channelSafe}${title ? ` · 제목안 "${title}"` : ''}${charCounts ? ' · ' + charCounts : ''}`,
                missing.length ? `✏️ 채워야 할 항목: ${missing.join(', ')}` : '누락 정보 없음 — 바로 발송 가능한 초안',
                '발송은 대표님이 알리고에서 직접 (자동 발송 경로 없음)',
            ],
            report: {
                type: 'geulsaem_copy',
                channel: channelSafe, title,
                title_error: (!title && c.title) ? '제목 추출 실패 (오염 파편 정화 불가 — 본문 카피는 정상)' : '',
                fallback: plainFallback ? 'plain' : '',
                versions, missing_fields: missing,
                char_counts: charCounts, send_tip: c.send_tip || '',
                model: GEULSAEM_MODEL, instruction,
                note: '글샘은 카피 생성까지만 — 발송은 알리고에서 대표가 직접 (자동 발송 경로 없음)',
            },
        };
    },
};
