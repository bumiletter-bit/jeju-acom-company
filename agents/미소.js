// AGENT OFFICE 실행 스크립트 — 미소 (마케팅팀 · 디자인)
// 5차: 실전 연결 — Anthropic Sonnet으로 Gemini용 이미지/영상 프롬프트 작성.
// 원칙: ① 프롬프트 "작성"까지만 — 이미지/영상 자동 생성 경로 없음 (생성은 대표가 Gemini에서 직접)
//       ② 대표 지시 원문을 자르지 않고 통째로 전달받아 작성
//       ③ 지식: 마케팅_전문팀_시스템.md의 Gemini 프롬프트 8단계 구조 + 브랜드 컬러/톤앤매너 준수
//       ④ API 오류 시 허위 결과 없이 오류 그대로 (throw → 실행 '오류' 기록)
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// 프롬프트 품질 우선 — Sonnet급 기본 (환경변수로 교체 가능)
const MISO_MODEL = process.env.MISO_MODEL || 'claude-sonnet-4-6';

const KNOWLEDGE_FILE = path.join(__dirname, '..', 'docs', 'knowledge', 'marketing', '마케팅_전문팀_시스템.md');
let _knowledgeCache = null;
function loadKnowledge() {
    if (_knowledgeCache) return _knowledgeCache;
    try {
        _knowledgeCache = '\n\n===== [지식 문서: 마케팅_전문팀_시스템.md — Gemini 프롬프트 원칙 · 브랜드] =====\n'
            + fs.readFileSync(KNOWLEDGE_FILE, 'utf8');
    } catch (e) {
        _knowledgeCache = `\n\n(지식 문서 로드 실패: ${e.message})`;
    }
    return _knowledgeCache;
}

// 강제 tool 호출로 구조화된 프롬프트 제출 보장
const PROMPT_TOOL = {
    name: 'submit_prompts',
    description: '작성 완료한 Gemini용 프롬프트 결과물을 제출한다.',
    strict: true,
    input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            outputs: {
                type: 'array',
                description: '프롬프트 1~3개 (지시가 단일 시안이면 1개)',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        label: { type: 'string', description: "시안 이름 (예: '메인 시안', '감성 컷')" },
                        media: { type: 'string', enum: ['이미지', '영상'], description: '이미지=Nano Banana Pro, 영상=Veo 3' },
                        prompt_en: { type: 'string', description: '영문 프롬프트 전체 (8단계 구조: 타입→피사체→구도→조명→배경→브랜드컬러→분위기→기술사양)' },
                        prompt_ko: { type: 'string', description: '영문 프롬프트의 한글 해석' },
                        ratio: { type: 'string', description: "추천 비율 (예: '1:1', '9:16', '16:9', '4:5')" },
                        usage: { type: 'string', description: "추천 사용처 (예: '인스타 피드', '톡톡 카드', '자사몰 배너', '상세페이지')" },
                    },
                    required: ['label', 'media', 'prompt_en', 'prompt_ko', 'ratio', 'usage'],
                },
            },
            concept_note: { type: 'string', description: '시안 방향 설명 한두 줄 (대표 보고용)' },
        },
        required: ['outputs', 'concept_note'],
    },
};

module.exports = {
    live: true, // 실전 연결됨 (5차) — 마루 라우팅 시 실제 프롬프트 작성
    steps: ['브랜드 가이드·Gemini 원칙 로드 중...', '시안 방향 구상 중...', '프롬프트 작성·검수 중...'],
    stepDelayMs: 1500,
    async result({ agent, pool, params = {} }) {
        // 대표 지시 원문 (마루가 자르지 않고 통째로 전달)
        const instruction = String(params.order_content || '').trim();
        if (!instruction) {
            return {
                summary: '지시 내용이 없어 프롬프트를 만들지 않았습니다',
                lines: [
                    '미소는 대표 지시 원문이 있어야 프롬프트를 작성합니다',
                    '하단 입력바로 마루에게 지시하면 원문이 그대로 전달됩니다',
                    '예: "카라향 인스타 이미지 시안 프롬프트 만들어줘 — 돌담 배경, 선물 느낌"',
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
                 ORDER BY created_at DESC LIMIT 30`, [agent.id]);
            if (lr.rows.length) {
                lessonsText = '\n\n## 📚 대표님 학습 노트 — 지식 문서와 충돌하면 학습 노트를 우선 적용할 것!\n'
                    + lr.rows.map(l => `- [${l.category || '일반'}] ${l.lesson}`).join('\n');
            }
        } catch (e) { /* 노트 로드 실패는 작성을 막지 않음 */ }

        // 오늘 날짜+요일 (KST) — 문구에 날짜 표기 시 요일 검산용
        const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
        const todayStr = nowKst.toISOString().slice(0, 10);
        const dayName = ['일', '월', '화', '수', '목', '금', '토'][nowKst.getUTCDay()];

        const systemPrompt = `너는 제주아꼼이네 농업회사법인(주) AGENT OFFICE 마케팅팀의 비주얼 디렉터 '미소'다.
아래 지식 문서의 Gemini 프롬프트 작성 원칙을 완전히 준수해 즉시 사용 가능한 프롬프트를 작성한다.
오늘 날짜: ${todayStr} (${dayName}요일, KST) — 설명·문구에 날짜를 쓸 때 요일은 이 기준으로 반드시 검산할 것.

## 작업 규칙 (반드시 준수)
1. 영문 프롬프트는 8단계 구조 순서 준수: 이미지 타입 → 주요 피사체 → 구도 → 조명 → 배경 → 브랜드 컬러(golden yellow #F5C800 main accent, navy blue #1B3A6B) → 분위기 → 기술 사양(4K 등).
2. 제주 정체성 키워드 적극 활용 (Jeju volcanic soil, basalt stone wall(돌담), tangerine orchard, Hallasan 등).
3. 절대 금지 단어: "AI generated", "cartoon", "cheap", "discount".
4. 이미지는 Gemini Nano Banana Pro, 영상은 Gemini Veo 3 기준. 지시에 '영상/릴스/쇼츠'가 있으면 영상(9:16, 15초 기준), 아니면 이미지 기본.
5. 비율 추천: 1:1 인스타·톡톡 / 9:16 쇼츠·릴스 / 16:9 자사몰 배너 / 4:5 상세페이지 — 사용처에 맞게.
6. 시안 수: 단일·구체 지시면 1개, 열린 지시면 2~3개 방향 제안.
7. 브랜드 톤앤매너(친근함·따뜻함·제주 감성·정성, 30-50대 여성 타겟) 반영. 과장·저가 느낌 금지.
8. 반드시 submit_prompts 도구로 제출한다. 도구 밖 텍스트 응답 금지.
${loadKnowledge()}${lessonsText}`;

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        let msg;
        try {
            msg = await anthropic.messages.create({
                model: MISO_MODEL,
                max_tokens: 4000,
                system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
                tools: [PROMPT_TOOL],
                tool_choice: { type: 'tool', name: 'submit_prompts' },
                messages: [{ role: 'user', content: `범 대표님 지시 (원문 그대로):\n${instruction}` }],
            });
        } catch (err) {
            // 오류 정직 표시 — 허위 결과 생성 금지
            throw new Error(err && err.status
                ? `Anthropic API 오류 (${err.status}): ${err.message}`
                : (err && err.message) || String(err));
        }
        const toolUse = msg.content.find(b => b.type === 'tool_use');
        if (!toolUse) throw new Error('미소 응답에서 프롬프트 결과(tool_use)를 찾지 못했습니다');
        const p = toolUse.input;
        const outputs = Array.isArray(p.outputs) ? p.outputs.filter(o => o && o.prompt_en) : [];
        if (outputs.length === 0) throw new Error('미소가 프롬프트를 생성하지 못했습니다');

        const mediaSummary = [...new Set(outputs.map(o => o.media))].join('·');
        return {
            summary: `완료: ${mediaSummary} 프롬프트 ${outputs.length}종 (${outputs.map(o => o.ratio).join(', ')})`,
            lines: [
                p.concept_note || '시안 프롬프트 작성 완료',
                outputs.map(o => `${o.label}(${o.media} ${o.ratio} · ${o.usage})`).join(' / '),
                '이미지·영상 생성은 대표님이 Gemini에서 직접 (자동 생성 없음)',
            ],
            report: {
                type: 'miso_prompt',
                outputs, concept_note: p.concept_note || '',
                model: MISO_MODEL, instruction,
                note: '미소는 프롬프트 작성까지만 — 생성은 Gemini(Nano Banana Pro/Veo 3)에서 대표가 직접 (자동 생성 경로 없음)',
            },
        };
    },
};
