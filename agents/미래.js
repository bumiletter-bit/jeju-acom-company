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

## 판정 원칙 (지시 #48 — 한결과 동일 기준)
- verdict='보완'은 실제 위반·누락이 있을 때만 (①우리다움 위반 ②실행 필수 요소[목적·대상·비용·다음 액션] 누락 ③거짓·근거 없는 수치)
- 문체 취향·사소한 개선 여지·더 좋게 만들 수 있다는 이유만으로는 verdict='통과' + 코멘트로 제안 (판정을 깎지 않는다)
- 지적에는 고치는 방법을 함께. 반드시 submit_review 도구로만 제출`;
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

// ===== 지시 #54-3: 실무 전환 (0원 코드) — 검수 게이트 제거 (기안 = 대표 직행), reviewContent는 보관만 =====
// ① 개발 백로그 관리: "백로그에 ~ 추가/보여줘" ② 버전·변경사항 안내: CHANGELOG 기반 조회 응답
const VERSION_FILE = path.join(__dirname, '..', 'version.js');
const CHANGELOG_FILE = path.join(__dirname, '..', 'CHANGELOG.md');

async function backlogAdd(pool, title) {
    const row = (await pool.query(
        `INSERT INTO dev_backlog (title, status) VALUES ($1, '대기') RETURNING id`, [title])).rows[0];
    return row.id;
}
async function backlogList(pool) {
    return (await pool.query(
        `SELECT id, title, status, to_char(created_at, 'MM-DD') AS d FROM dev_backlog
         WHERE is_deleted = false ORDER BY (status = '완료'), id DESC LIMIT 30`)).rows;
}

module.exports = {
    live: true, // 지시 #54: 실무 전환 — 백로그·버전 안내 (0원 코드)
    reviewContent, REVIEW_ITEMS, // 보관 (검수 게이트 비활성 — 삭제 없음 원칙)
    backlogAdd, backlogList, // 역량 박제용 export
    steps: ['백로그·버전 정보 확인 중...'],
    stepDelayMs: 1000,
    async result({ pool, params = {} }) {
        const q = String(params.order_content || '').trim();
        // ② 버전·변경사항 안내
        if (/버전|변경\s*사항|업데이트|뭐가 바뀌|체인지로그/i.test(q) && !/백로그/.test(q)) {
            let ver = '?';
            try { delete require.cache[require.resolve(VERSION_FILE)]; ver = require(VERSION_FILE).VERSION; } catch (e) { /* 무시 */ }
            let recent = '';
            try {
                const log = fs.readFileSync(CHANGELOG_FILE, 'utf8');
                const lines = log.split('\n').filter(l => l.startsWith('- [')).slice(0, 5);
                recent = lines.join('\n');
            } catch (e) { recent = '(CHANGELOG 로드 실패)'; }
            return {
                summary: `현재 버전 ${ver}`,
                lines: [`현재 버전: ${ver}`, '최근 변경 5건은 보고서 카드에서', 'CHANGELOG 전문은 저장소 CHANGELOG.md'],
                report: { type: 'mirae_version', version: ver, recent_changes: recent.slice(0, 2000), note: 'CHANGELOG 기반 자동 안내 (0원 코드 — 지시 #54)' },
            };
        }
        // ① 백로그
        if (/백로그/.test(q)) {
            const addMatch = q.match(/백로그에?\s*(.+?)\s*(추가|넣어|기록|올려)/);
            if (addMatch && addMatch[1] && addMatch[1].trim().length >= 2) {
                const title = addMatch[1].trim().slice(0, 200);
                const id = await backlogAdd(pool, title);
                const list = await backlogList(pool);
                return {
                    summary: `백로그 #${id} 기록: ${title.slice(0, 40)}`,
                    lines: [`"${title}" — 대기 상태로 기록했습니다`, `현재 백로그 ${list.length}건`, '구현 착수는 대표 지시로'],
                    report: { type: 'mirae_backlog', added: { id, title }, items: list, note: '나중에 만들 항목 목록 (지시 #54 — 착수는 대표 지시)' },
                };
            }
            const list = await backlogList(pool);
            return {
                summary: `백로그 ${list.length}건`,
                lines: list.length ? list.slice(0, 3).map(b => `#${b.id} [${b.status}] ${b.title.slice(0, 50)}`) : ['백로그가 비어 있습니다 — "백로그에 ○○ 추가해줘"로 기록'],
                report: { type: 'mirae_backlog', items: list, note: '나중에 만들 항목 목록 (지시 #54)' },
            };
        }
        return {
            summary: '미래 담당 업무 안내',
            lines: ['개발 백로그 관리: "백로그에 ○○ 추가해줘" / "백로그 보여줘"', '버전·변경사항 안내: "지금 버전 뭐야" / "최근 변경사항"', '기획서 작성은 기안 담당입니다'],
            report: { type: 'mirae_info', note: '지시 #54 실무 전환 — 백로그·버전 안내 (0원 코드)' },
        };
    },
};
