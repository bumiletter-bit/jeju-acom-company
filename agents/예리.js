// 예리 (마케팅팀 · 인스타그램 담당) — 대표 7/22: 인스타 관련 업무 전담 AI 가동
// 담당: ①계정 아이디(핸들) 추천 ②첫 영상/릴스 방향·컨셉 ③릴스/영상 대본 ④게시물 문구·캡션·해시태그 ⑤성과 분석
// 원칙: 콘텐츠는 브랜드 톤에 맞게 창작. 성과 '분석'은 대표가 준 데이터가 있을 때만 (없으면 정직히 데이터 요청). 판매량·조회수·순위 등 수치는 데이터 없이 지어내지 않음.
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const YERI_MODEL = process.env.YERI_MODEL || 'claude-sonnet-4-6';
const BRAND_FILE = path.join(__dirname, '..', 'docs', 'knowledge', 'marketing', '브랜드가이드_v1.md');
const load = (fp) => { try { return fs.readFileSync(fp, 'utf8'); } catch (e) { return `(로드 실패: ${e.message})`; } };
const clean = v => String(v || '').replace(/<[^>]*>/g, '').trim();

// 강제 tool 호출로 구조화된 인스타 결과물 제출 (유연한 body — 대본/목록/분석 무엇이든 담김)
const INSTA_TOOL = {
    name: 'submit_insta',
    description: '인스타 관련 결과물을 제출한다.',
    strict: true,
    input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            kind: { type: 'string', enum: ['아이디추천', '영상방향', '대본', '게시물문구', '성과분석', '기타'], description: '결과물 종류' },
            business: { type: 'string', enum: ['농업회사법인', '오션라운지카페', '미정'], description: '대상 사업체' },
            summary: { type: 'string', description: '한 줄 요약 (대표 보고용)' },
            body: { type: 'string', description: '결과물 전체 — 아이디 목록/영상 방향 제안/대본(장면별)/게시물 문구/분석을 형식 자유(줄바꿈·번호 사용)로 완성해 담는다. 대본이면 후킹→장면별 자막→CTA 순으로 길어도 전부 담는다. 반드시 비우지 말 것.' },
            hashtags: { type: 'string', description: '해시태그 (게시물·대본이면 추천 해시태그, 없으면 빈 문자열)' },
            note: { type: 'string', description: '참고·다음 액션 한두 줄. 성과분석인데 데이터가 없으면 여기에 데이터 요청 안내' },
        },
        required: ['kind', 'business', 'summary', 'body', 'hashtags', 'note'],
    },
};

module.exports = {
    live: true, // 대표 7/22: 인스타 전담 AI (Sonnet)
    steps: ['인스타 요청 분석 중...', '브랜드 톤 맞춤 구상 중...', '결과물 작성·검토 중...'],
    stepDelayMs: 1400,
    async result({ agent, pool, params = {} }) {
        const instruction = String(params.order_content || '').trim();
        if (!instruction) {
            return {
                summary: '지시 내용이 없어 작성하지 않았습니다',
                lines: ['예리는 인스타 지시 원문이 있어야 작성합니다', '예: "오션라운지 인스타 첫 릴스 대본 써줘", "인스타 계정 아이디 추천해줘"'],
            };
        }
        if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다 (Render 환경변수 확인 필요)');

        // 학습 노트 (활성) — 우선 적용
        let lessonsText = '';
        try {
            const lr = await pool.query(
                `SELECT lesson, category FROM agent_lessons WHERE agent_id = $1 AND status='active' AND is_deleted=false ORDER BY created_at DESC LIMIT 10`, [agent.id]);
            if (lr.rows.length) lessonsText = '\n\n## 📚 대표님 학습 노트 (우선 적용)\n' + lr.rows.map(l => `- [${l.category || '일반'}] ${l.lesson}`).join('\n');
        } catch (e) { /* 노트 로드 실패는 작성을 막지 않음 */ }

        // 성과 데이터 (있으면 분석에 사용)
        const perf = Array.isArray(params.performance_data) ? params.performance_data : [];
        const perfText = perf.length ? '\n\n## 전달된 성과 데이터 (분석용 — 이 데이터만 근거)\n' + JSON.stringify(perf).slice(0, 2000) : '';

        let personaText = '';
        try { personaText = '\n\n===== [예리 특성] =====\n' + load(path.join(__dirname, '..', 'docs', 'agents', '예리_특성.md')); } catch (e) { /* 특성 없으면 생략 */ }

        const systemPrompt = `너는 제주아꼼이네 AGENT OFFICE 마케팅팀의 인스타그램 담당 '예리'다.${personaText}
인스타 관련 업무를 전담한다: ①계정 아이디(핸들) 추천 ②첫 영상/릴스 방향·컨셉 제안 ③릴스/영상 대본 ④게시물 문구·캡션·해시태그 ⑤성과 분석.

## 두 사업체 구분 (대상에 맞게 톤·소재를 다르게)
- 제주아꼼이네 농업회사법인: 감귤·호박 등 농산물, 30-50대 여성 타겟, 제주 감성·정성·산지직송.
- 제주아꼼이네 오션라운지 카페: 카페·디저트·바다뷰, 감성·방문 유도·인증샷.
지시가 어느 쪽인지 판단해 business에 표시하고 그 톤으로 작성한다. 불명확하면 '미정'.

## 작업 규칙 (반드시 준수)
1. 요청 종류(kind)를 판단해 그에 맞는 결과물을 body에 완성해 담는다.
   · 아이디추천: 계정 핸들 3개 내외 + 각 이유 (예: "@jeju_ocean_lounge — 바다뷰 카페 감성, 부르기 쉬움").
   · 영상방향: 첫 영상 컨셉 2~3개 방향 + 각 이유·예상 장면.
   · 대본: 후킹 첫 문장(1~2초 스톱) → 장면별 자막/나레이션(장면 번호, 릴스 15~30초·3~6컷) → CTA. 길어도 전부 담는다.
   · 게시물문구: 캡션 본문 + 해시태그(hashtags).
2. 성과 '분석'은 대표가 준 데이터가 있을 때만 그 데이터를 근거로 답한다. 데이터가 없으면 지어내지 말고, note에 "성과 데이터(팔로워·조회수·반응 등)를 주시면 분석해드리겠습니다"라고 정직히 안내하고 body엔 데이터 없이 가능한 일반 방향 팁만 담는다.
3. 판매량·조회수·순위 등 구체 수치는 데이터 없이 지어내지 않는다 (정직 원칙).
4. 브랜드 톤(친근·따뜻·제주 감성) 유지. 과장·허위 금지. 반드시 submit_insta 도구로 제출하고 body를 절대 비우지 않는다.

===== [브랜드가이드] =====
${load(BRAND_FILE)}${perfText}${lessonsText}`;

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const genOnce = async () => {
            const msg = await anthropic.messages.create({
                model: YERI_MODEL, max_tokens: 8000, // 대본 등 긴 결과물 여유
                system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
                tools: [INSTA_TOOL], tool_choice: { type: 'tool', name: 'submit_insta' },
                messages: [{ role: 'user', content: `범 대표님 지시 (원문 그대로):\n${instruction}` }],
            });
            const tu = msg.content.find(b => b.type === 'tool_use');
            return tu ? tu.input : null;
        };
        let a;
        try {
            a = await genOnce();
            if (!a || !clean(a.body)) a = await genOnce(); // 빈 결과면 1회 재시도
            if (!a || !clean(a.body)) throw new Error('예리가 결과물을 생성하지 못했습니다 — 다시 시도하거나 지시를 조금 더 구체적으로 주세요');
        } catch (err) {
            throw new Error(err && err.status
                ? `Anthropic API 오류 (${err.status}): ${err.message}`
                : (err && err.message) || String(err));
        }

        const report = {
            type: 'yeri_insta',
            kind: a.kind || '기타', business: a.business || '미정',
            body: clean(a.body).slice(0, 8000),
            hashtags: clean(a.hashtags).slice(0, 500),
            note: clean(a.note).slice(0, 500),
            model: YERI_MODEL, instruction,
        };
        return {
            summary: `완료: 인스타 ${report.kind}${report.business !== '미정' ? ` (${report.business})` : ''} — ${clean(a.summary).slice(0, 50)}`,
            lines: [
                clean(a.summary) || '인스타 결과물 작성 완료',
                clean(a.body).split('\n').map(x => x.trim()).filter(Boolean).slice(0, 2).join(' / ').slice(0, 120),
                report.hashtags ? '해시태그: ' + report.hashtags.slice(0, 60) : '상세는 보고서 카드에서',
            ],
            report,
        };
    },
};
