# 문의시나리오 DB 통합 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 톡톡봇 시나리오 46개+영업시간외 1건을 회사프로그램 DB로 이관하고, [문의 관리] 화면에서 직원이 편집하면 톡톡봇이 5분 내 자동 반영(무중단 전환).

**Architecture:** 회사프로그램(Express+PostgreSQL, Render)에 `inquiry_scenarios` 테이블 + 봇 조회 API(신규 Bearer) + 관리 CRUD API + [문의 관리] 화면을 추가. 톡톡봇(별도 Render)은 `scenario-store.js`가 5분 캐시로 읽어가며, `SCENARIO_SOURCE` env로 하드코딩↔DB를 스위치(이중 상태 → 비교 검증 → 스위치 → 안정 후 제거).

**Tech Stack:** Node.js/Express, PostgreSQL(pg), vanilla JS 프론트(public/app.js), 톡톡봇은 axios 사용 중.

**Spec:** `docs/superpowers/specs/2026-07-25-inquiry-scenario-db-design.md` (대표 승인본)

## Global Constraints

- 회사프로그램 리포는 **PUBLIC** — `SCENARIO_API_TOKEN` 등 시크릿을 코드/커밋에 절대 넣지 않는다 (env로만).
- 시나리오 문구는 **1바이트도 수정 금지** — `{{가격표}}`/`{{판매현황}}`/`(예시)` 줄 원문 그대로.
- 물리삭제 금지(soft-delete `deleted_at`), 모든 변경 audit_logs 기록.
- 톡톡봇 응답 로직(딜레이 30초, 이모티콘, 매칭·AI 선택 로직) 수정 금지 — **데이터 출처만 교체**.
- 검증 통과 전 하드코딩 `scenarios.js` 제거 금지.
- 회사프로그램 다음 배포: **v5.9.55 / app.js 캐시 v=262** (`version.js`, `public/index.html`, `CHANGELOG.md` 갱신). 배포는 `npm run deploy` (Bash 타임아웃 540000ms 이상).
- 배포 전 `node --check server.js` + `node --check public/app.js` 필수.
- 이 리포에 테스트 프레임워크 없음(기존 관행) — 각 태스크는 `node --check` + 검증 스크립트/수동 검증으로 확인.
- 커밋 메시지 끝에 Co-Authored-By / Claude-Session 푸터(기존 커밋 참고).
- 톡톡봇 경로: `C:\Users\전승범\OneDrive\문서\★제주아꼼이네 톡톡봇` (별도 git 리포 — 커밋은 하되 **push(배포)는 대표가 마지막 1회**).

---

### Task 1: 회사프로그램 — inquiry_scenarios 테이블 + 전체스위치 시드

**Files:**
- Modify: `server.js` — initDB 안, `naver_auto_collect` 시드 직후(~774행 부근)

**Interfaces:**
- Produces: `inquiry_scenarios` 테이블(스펙 1절 DDL), `agent_office_config` 키 `inquiry_auto_reply`(JSONB 문자열 `"on"`)

- [ ] **Step 1: initDB에 테이블·인덱스·스위치 시드 추가**

`server.js`의 `ON CONFLICT (key) DO NOTHING`(naver_auto_collect 시드, ~774행) 바로 뒤에 삽입:

```js
    // 문의시나리오 DB 통합 (2026-07-25 설계문서): 톡톡봇 시나리오 단일 출처 — 물리삭제 금지(deleted_at)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS inquiry_scenarios (
            id SERIAL PRIMARY KEY,
            scenario_no INTEGER NOT NULL,
            name VARCHAR(100) NOT NULL,
            keywords JSONB NOT NULL DEFAULT '[]',
            response TEXT NOT NULL,
            action VARCHAR(20) NOT NULL DEFAULT '자동응답',
            enabled BOOLEAN NOT NULL DEFAULT true,
            channel VARCHAR(20) NOT NULL DEFAULT '톡톡',
            updated_by VARCHAR(50),
            updated_at TIMESTAMP DEFAULT NOW(),
            deleted_at TIMESTAMP
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_inquiry_scenarios_no ON inquiry_scenarios(scenario_no)`);
    // 전체 자동응답 스위치 (대표 전용 토글) — 기본 on
    await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('inquiry_auto_reply', '"on"'::jsonb)
        ON CONFLICT (key) DO NOTHING`);
```

- [ ] **Step 2: 문법 확인**

Run: `node --check server.js`
Expected: 출력 없음(성공)

- [ ] **Step 3: 커밋**

```bash
git add server.js
git commit -m "문의시나리오 1/5: inquiry_scenarios 테이블 + 전체스위치 시드"
```

---

### Task 2: 회사프로그램 — 톡톡봇 조회용 API `GET /api/scenarios`

**Files:**
- Modify: `server.js` — 관리 REST 라우트 블록 끝(`/api/admin/settlements`, ~4660행) 뒤에 추가

**Interfaces:**
- Consumes: Task 1의 `inquiry_scenarios`, `agent_office_config.inquiry_auto_reply`
- Produces: `GET /api/scenarios?channel=talktalk` — 헤더 `Authorization: Bearer <SCENARIO_API_TOKEN>` → `{ ok, auto_reply: 'on'|'off', count, scenarios: [{scenario_no, name, keywords, response, action, channel, updated_at}], updated_max }` (사용중·미삭제만, scenario_no 순)

- [ ] **Step 1: 라우트 추가**

```js
// 문의시나리오: 톡톡봇 조회용 (설계 2026-07-25) — 신규 Bearer(SCENARIO_API_TOKEN, 양쪽 Render env로만 보관)
//   PII 없음(시나리오 문구뿐). 사용중·미삭제만 번호순. auto_reply='off'면 봇이 시나리오 응답 중단.
app.get('/api/scenarios', async (req, res) => {
    try {
        const need = process.env.SCENARIO_API_TOKEN;
        if (!need) return res.status(503).json({ error: 'SCENARIO_API_TOKEN 미설정 (Render 환경변수)' });
        const got = (req.headers.authorization || '').replace('Bearer ', '');
        if (got !== need) return res.status(401).json({ error: 'unauthorized' });
        const channel = String(req.query.channel || 'talktalk');
        const chs = channel === 'talktalk' ? ['톡톡', '공통']
                  : channel === 'product' ? ['상품문의', '공통'] : ['톡톡', '상품문의', '공통'];
        const r = await pool.query(
            `SELECT scenario_no, name, keywords, response, action, channel, updated_at
             FROM inquiry_scenarios
             WHERE enabled = true AND deleted_at IS NULL AND channel = ANY($1)
             ORDER BY scenario_no ASC, id ASC`, [chs]);
        const cfg = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'inquiry_auto_reply'`);
        const autoReply = cfg.rows.length ? cfg.rows[0].value : 'on';
        res.json({
            ok: true, auto_reply: autoReply, count: r.rows.length, scenarios: r.rows,
            updated_max: r.rows.reduce((m, x) => (!m || x.updated_at > m) ? x.updated_at : m, null),
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
```

- [ ] **Step 2: 문법 확인** — `node --check server.js` → 성공

- [ ] **Step 3: 커밋** — `git add server.js && git commit -m "문의시나리오 2/5: 톡톡봇 조회 API(/api/scenarios, 신규 Bearer)"`

---

### Task 3: 회사프로그램 — 관리용 CRUD API + 이력 조회

**Files:**
- Modify: `server.js` — 품목 서비스(`svcDeactivateItem`, ~4580행) 뒤에 서비스 함수, 라우트 블록 끝에 라우트

**Interfaces:**
- Consumes: `writeAudit`, `adminActor`, `handleAdminErr`, `requireConfirm`, `authMiddleware`, `adminOnly` (기존)
- Produces (전부 로그인 필요, 표기한 것만 대표 전용):
  - `GET /api/agent-office/scenarios` → `{ scenarios, auto_reply }` (미삭제 전체, 사용중지 포함)
  - `POST /api/agent-office/scenarios` body `{name, keywords[], response, action?, channel?, enabled?}`
  - `PUT /api/agent-office/scenarios/:id` body 부분수정 (개별 ON/OFF 포함)
  - `DELETE /api/agent-office/scenarios/:id` body `{confirm:true}` — **adminOnly**, soft-delete
  - `PUT /api/agent-office/scenarios-auto-reply` body `{value:'on'|'off'}` — **adminOnly**
  - `GET /api/agent-office/scenario-logs` → audit_logs 중 target_type='inquiry_scenario' 최근 100건

- [ ] **Step 1: 서비스 함수 추가** (품목 서비스 패턴 그대로 — 차이: deleted_at·updated_by·직원 허용)

```js
// --- 문의시나리오 서비스 (설계 2026-07-25 — 추가·수정은 직원 가능, 삭제·전체스위치는 대표 전용) ---
const SCENARIO_ACTIONS = ['자동응답', '담당자연결'];
const SCENARIO_CHANNELS = ['톡톡', '상품문의', '공통'];
async function svcListScenarios() {
    const r = await pool.query(
        `SELECT id, scenario_no, name, keywords, response, action, enabled, channel, updated_by, updated_at
         FROM inquiry_scenarios WHERE deleted_at IS NULL ORDER BY scenario_no ASC, id ASC`);
    return r.rows;
}
async function svcCreateScenario({ name, keywords = [], response, action = '자동응답', channel = '톡톡', enabled = true }, actor) {
    if (!name || !String(name).trim()) throw { status: 400, message: '시나리오명(name)은 필수입니다' };
    if (!response || !String(response).trim()) throw { status: 400, message: '답변문구(response)는 필수입니다' };
    if (!SCENARIO_ACTIONS.includes(action)) throw { status: 400, message: '동작은 자동응답/담당자연결 중 하나여야 합니다' };
    if (!SCENARIO_CHANNELS.includes(channel)) throw { status: 400, message: '채널은 톡톡/상품문의/공통 중 하나여야 합니다' };
    const kw = Array.isArray(keywords) ? keywords.map(k => String(k).trim()).filter(Boolean) : [];
    const no = (await pool.query(`SELECT COALESCE(MAX(scenario_no), 0) + 1 AS n FROM inquiry_scenarios`)).rows[0].n;
    const r = await pool.query(
        `INSERT INTO inquiry_scenarios (scenario_no, name, keywords, response, action, channel, enabled, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [no, String(name).trim(), JSON.stringify(kw), response, action, channel, enabled !== false, actor?.name || null]);
    const row = r.rows[0];
    await writeAudit({ action: 'create', targetType: 'inquiry_scenario', targetId: row.id, changes: { after: row }, source: 'inquiry-scenario', actor });
    return row;
}
async function svcUpdateScenario(id, patch, actor) {
    const cur = await pool.query('SELECT * FROM inquiry_scenarios WHERE id=$1 AND deleted_at IS NULL', [id]);
    if (cur.rows.length === 0) throw { status: 404, message: '시나리오를 찾을 수 없습니다' };
    const before = cur.rows[0];
    if (patch.action !== undefined && !SCENARIO_ACTIONS.includes(patch.action)) throw { status: 400, message: '동작 값이 잘못되었습니다' };
    if (patch.channel !== undefined && !SCENARIO_CHANNELS.includes(patch.channel)) throw { status: 400, message: '채널 값이 잘못되었습니다' };
    const sets = ['updated_at = NOW()']; const params = [];
    for (const f of ['name', 'response', 'action', 'channel', 'enabled']) {
        if (patch[f] !== undefined) { params.push(patch[f]); sets.push(`${f}=$${params.length}`); }
    }
    if (patch.keywords !== undefined) {
        const kw = Array.isArray(patch.keywords) ? patch.keywords.map(k => String(k).trim()).filter(Boolean) : [];
        params.push(JSON.stringify(kw)); sets.push(`keywords=$${params.length}`);
    }
    if (params.length === 0) throw { status: 400, message: '수정할 내용이 없습니다' };
    params.push(actor?.name || null); sets.push(`updated_by=$${params.length}`);
    params.push(id);
    const r = await pool.query(`UPDATE inquiry_scenarios SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING *`, params);
    const after = r.rows[0];
    await writeAudit({ action: 'update', targetType: 'inquiry_scenario', targetId: Number(id), changes: { before, after }, source: 'inquiry-scenario', actor });
    return after;
}
async function svcSoftDeleteScenario(id, actor) {
    const cur = await pool.query('SELECT * FROM inquiry_scenarios WHERE id=$1 AND deleted_at IS NULL', [id]);
    if (cur.rows.length === 0) throw { status: 404, message: '시나리오를 찾을 수 없습니다' };
    const r = await pool.query(`UPDATE inquiry_scenarios SET deleted_at=NOW(), updated_by=$2, updated_at=NOW() WHERE id=$1 RETURNING *`, [id, actor?.name || null]);
    await writeAudit({ action: 'delete', targetType: 'inquiry_scenario', targetId: Number(id), changes: { before: cur.rows[0] }, source: 'inquiry-scenario', actor });
    return r.rows[0];
}
```

- [ ] **Step 2: 라우트 추가** (라우트 블록 끝, Task 2의 `/api/scenarios` 위쪽에)

```js
// --- 문의시나리오 관리 라우트 (직원 가능 / 삭제·전체스위치만 대표 전용) ---
app.get('/api/agent-office/scenarios', authMiddleware, async (req, res) => {
    try {
        const cfg = await pool.query(`SELECT value FROM agent_office_config WHERE key = 'inquiry_auto_reply'`);
        res.json({ scenarios: await svcListScenarios(), auto_reply: cfg.rows.length ? cfg.rows[0].value : 'on' });
    } catch (err) { handleAdminErr(res, err); }
});
app.post('/api/agent-office/scenarios', authMiddleware, async (req, res) => {
    try { res.json({ message: '시나리오가 추가되었습니다', scenario: await svcCreateScenario(req.body || {}, adminActor(req)) }); }
    catch (err) { handleAdminErr(res, err); }
});
app.put('/api/agent-office/scenarios/:id', authMiddleware, async (req, res) => {
    try { res.json({ message: '시나리오가 수정되었습니다', scenario: await svcUpdateScenario(req.params.id, req.body || {}, adminActor(req)) }); }
    catch (err) { handleAdminErr(res, err); }
});
app.delete('/api/agent-office/scenarios/:id', authMiddleware, adminOnly, async (req, res) => {
    if (!requireConfirm(req, res)) return;
    try { res.json({ message: '시나리오가 삭제되었습니다(복구 가능)', scenario: await svcSoftDeleteScenario(req.params.id, adminActor(req)) }); }
    catch (err) { handleAdminErr(res, err); }
});
app.put('/api/agent-office/scenarios-auto-reply', authMiddleware, adminOnly, async (req, res) => {
    try {
        const value = req.body?.value === 'off' ? 'off' : 'on';
        await pool.query(`INSERT INTO agent_office_config (key, value) VALUES ('inquiry_auto_reply', $1::jsonb)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(value)]);
        await writeAudit({ action: 'auto_reply_' + value, targetType: 'inquiry_scenario', targetId: null,
            changes: { after: { auto_reply: value } }, source: 'inquiry-scenario', actor: adminActor(req) });
        res.json({ message: `전체 자동응답을 ${value === 'on' ? '켰습니다' : '껐습니다'}`, auto_reply: value });
    } catch (err) { handleAdminErr(res, err); }
});
app.get('/api/agent-office/scenario-logs', authMiddleware, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT id, action, target_id, changes, actor_name, created_at FROM audit_logs
             WHERE target_type = 'inquiry_scenario' ORDER BY id DESC LIMIT 100`);
        res.json({ logs: r.rows });
    } catch (err) { handleAdminErr(res, err); }
});
```

- [ ] **Step 3: 문법 확인** — `node --check server.js` → 성공

- [ ] **Step 4: 커밋** — `git add server.js && git commit -m "문의시나리오 3/5: 관리 CRUD API + 수정이력 조회 (직원 가능, 삭제·전체스위치 대표 전용)"`

---

### Task 4: 마이그레이션 스크립트 (로컬 1회 실행)

**Files:**
- Create: `scripts/migrate-scenarios.js`

**Interfaces:**
- Consumes: 톡톡봇 `scenarios.js`의 `scenarios`(46개)·`afterHoursResponse`, 로컬 `.env`의 `DATABASE_URL`(scripts/db-backup.js와 동일 방식)
- Produces: DB에 47행(번호 0=영업시간외, 1~46=배열 순서) + 콘솔 대조표(번호·이름·키워드수·문구 md5·바이트수)

- [ ] **Step 1: 스크립트 작성**

```js
// scripts/migrate-scenarios.js — 문의시나리오 이관 (로컬 1회 실행: node scripts/migrate-scenarios.js)
// 톡톡봇 scenarios.js를 require로 직접 읽어 그대로 INSERT (재타이핑 금지 — 복사 오류 원천 차단)
// 테이블에 데이터가 있으면 중단 (중복 실행 방지)
require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');

const BOT_DIR = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 톡톡봇';
const { scenarios, afterHoursResponse } = require(path.join(BOT_DIR, 'scenarios.js'));

const dbConfig = { connectionString: process.env.DATABASE_URL };
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')) {
    dbConfig.ssl = { rejectUnauthorized: false };
}
const pool = new Pool(dbConfig);
const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex').slice(0, 10);

async function main() {
    if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL 미설정 (.env 확인)'); process.exit(1); }
    // 테이블 보장 (배포 전 실행해도 동작하도록 initDB와 동일 DDL)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS inquiry_scenarios (
            id SERIAL PRIMARY KEY, scenario_no INTEGER NOT NULL, name VARCHAR(100) NOT NULL,
            keywords JSONB NOT NULL DEFAULT '[]', response TEXT NOT NULL,
            action VARCHAR(20) NOT NULL DEFAULT '자동응답', enabled BOOLEAN NOT NULL DEFAULT true,
            channel VARCHAR(20) NOT NULL DEFAULT '톡톡', updated_by VARCHAR(50),
            updated_at TIMESTAMP DEFAULT NOW(), deleted_at TIMESTAMP)`);
    const cnt = (await pool.query('SELECT COUNT(*)::int AS c FROM inquiry_scenarios')).rows[0].c;
    if (cnt > 0) { console.error(`❌ 이미 ${cnt}건 존재 — 중복 이관 방지를 위해 중단합니다`); process.exit(1); }

    const rows = [
        { no: 0, name: '영업시간 외 자동응대', keywords: [], response: afterHoursResponse },
        ...scenarios.map((s, i) => ({ no: i + 1, name: s.name, keywords: s.keywords, response: s.response })),
    ];
    for (const r of rows) {
        await pool.query(
            `INSERT INTO inquiry_scenarios (scenario_no, name, keywords, response, action, channel, enabled, updated_by)
             VALUES ($1,$2,$3,$4,'자동응답','톡톡',true,'이관스크립트')`,
            [r.no, r.name, JSON.stringify(r.keywords), r.response]);
    }
    // 대조표: DB에서 다시 읽어 원본과 비교 (번호·이름·키워드수·md5·바이트수)
    const db = (await pool.query(`SELECT scenario_no, name, keywords, response FROM inquiry_scenarios ORDER BY scenario_no`)).rows;
    let allOk = true;
    console.log('번호 | 일치 | 이름 | 키워드수 | 문구md5 | 바이트');
    for (const r of rows) {
        const d = db.find(x => x.scenario_no === r.no);
        const ok = d && d.name === r.name && d.response === r.response
            && JSON.stringify(d.keywords) === JSON.stringify(r.keywords);
        if (!ok) allOk = false;
        console.log(`${String(r.no).padStart(2)} | ${ok ? '✅' : '❌'} | ${r.name} | ${r.keywords.length} | ${md5(r.response)} | ${Buffer.byteLength(r.response, 'utf8')}`);
    }
    console.log(allOk ? `\n✅ ${rows.length}건 전부 원본과 바이트 단위 일치` : '\n❌ 불일치 발견 — 위 표의 ❌ 행 확인');
    await pool.end();
    process.exit(allOk ? 0 : 1);
}
main().catch(e => { console.error('❌ 이관 실패:', e.message); process.exit(1); });
```

- [ ] **Step 2: 문법 확인** — `node --check scripts/migrate-scenarios.js` → 성공

- [ ] **Step 3: 실행 (로컬 → 원격 DB)**

Run: `node scripts/migrate-scenarios.js` (타임아웃 넉넉히)
Expected: 47행 표 전부 ✅ + `✅ 47건 전부 원본과 바이트 단위 일치`
주의: 재실행 시 "이미 47건 존재 — 중단" 이 정상.

- [ ] **Step 4: 대조표를 대표에게 보고** (완료 보고 항목 2번 — 표 캡처/붙여넣기)

- [ ] **Step 5: 커밋** — `git add scripts/migrate-scenarios.js && git commit -m "문의시나리오 4/5: 이관 스크립트 (47건, 바이트 대조표 포함)"`

---

### Task 5: [문의 관리] 화면

**Files:**
- Modify: `public/index.html` — ①사이드바 cs-room(157행 부근)과 data 사이에 nav 추가 ②`page-cs-room` 페이지 div 뒤에 `page-inquiry` 페이지 추가
- Modify: `public/app.js` — `switchPage`에 분기 추가(~299행 부근) + 페이지 렌더 함수들 추가(파일 말미)

**Interfaces:**
- Consumes: Task 3의 관리 API 5종 + `scenario-logs`, 기존 `api()` fetch 헬퍼, `currentUser.role`
- Produces: `data-page="inquiry"` 페이지. 직원(민주·승협) 접근 가능 — `adminOnlyPages`에 **넣지 않는다**. 세무사(accountant)는 기존 로직이 자동으로 숨김.

- [ ] **Step 1: index.html 사이드바에 nav 항목 추가** (cs-room `</a>` 뒤)

```html
                <a href="#" class="nav-item" data-page="inquiry">
                    <span class="nav-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-9 8.3 9.3 9.3 0 0 1-4-1L3 20l1.3-3.9A8.38 8.38 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5Z"/><path d="M9 10h6M9 13h4"/></svg></span>
                    <span class="nav-text">문의 관리</span>
                </a>
```

- [ ] **Step 2: index.html에 페이지 마크업 추가** (다른 `class="page"` div들과 같은 컨테이너에, 기존 카드 스타일 재사용)

```html
            <!-- 문의 관리 (문의시나리오 DB 통합 2026-07-25) — 직원 편집 가능 · 삭제/전체스위치는 대표 전용 -->
            <div class="page" id="page-inquiry">
                <h1>문의 관리</h1>
                <p class="text-muted" style="font-size:13px; margin:4px 0 16px;">여기서 저장하면 톡톡봇에 5분 내 자동 반영됩니다. ⚠️ 답변문구에 고객 개인정보(이름·연락처·주소)를 넣지 마세요.</p>
                <div class="card">
                    <div class="card-header-row">
                        <h2>📋 시나리오 목록 <span id="inquiry-count" class="text-muted" style="font-size:13px; font-weight:400;"></span></h2>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <label id="inquiry-auto-reply-wrap" style="display:none; font-size:13px; gap:4px; align-items:center;">
                                전체 자동응답 <input type="checkbox" id="inquiry-auto-reply-toggle">
                            </label>
                            <button class="btn-primary" id="btn-inquiry-add">+ 새 시나리오</button>
                        </div>
                    </div>
                    <div id="inquiry-list" style="overflow-x:auto;"></div>
                </div>
                <div class="card" id="inquiry-edit-card" style="display:none;">
                    <h2 id="inquiry-edit-title">시나리오 수정</h2>
                    <input type="hidden" id="inquiry-edit-id">
                    <div style="display:grid; gap:10px; max-width:720px;">
                        <label style="font-size:13px;">시나리오명<br><input type="text" id="inquiry-edit-name" style="width:100%; padding:8px; border:1px solid var(--border,#ccc); border-radius:8px;"></label>
                        <label style="font-size:13px;">키워드 (쉼표로 구분)<br><input type="text" id="inquiry-edit-keywords" style="width:100%; padding:8px; border:1px solid var(--border,#ccc); border-radius:8px;"></label>
                        <label style="font-size:13px;">답변문구 <span class="text-muted">({{가격표}}·{{판매현황}}·"(예시)" 줄은 발송 시 실데이터로 자동 치환)</span><br>
                            <textarea id="inquiry-edit-response" rows="10" style="width:100%; padding:8px; border:1px solid var(--border,#ccc); border-radius:8px;"></textarea></label>
                        <div style="display:flex; gap:12px; flex-wrap:wrap; font-size:13px;">
                            <label>동작 <select id="inquiry-edit-action"><option>자동응답</option><option>담당자연결</option></select></label>
                            <label>채널 <select id="inquiry-edit-channel"><option>톡톡</option><option>상품문의</option><option>공통</option></select></label>
                            <label>사용 <input type="checkbox" id="inquiry-edit-enabled" checked></label>
                        </div>
                        <div>
                            <h3 style="font-size:14px; margin:8px 0 4px;">💬 고객에게 이렇게 보입니다</h3>
                            <div id="inquiry-preview" style="white-space:pre-wrap; background:var(--bg-soft,#f7f7f9); border:1px solid var(--border,#e2e2e6); border-radius:10px; padding:12px; font-size:13px;"></div>
                        </div>
                        <div style="display:flex; gap:8px;">
                            <button class="btn-primary" id="btn-inquiry-save">저장</button>
                            <button class="btn-sm btn-outline" id="btn-inquiry-cancel">취소</button>
                            <button class="btn-sm btn-outline" id="btn-inquiry-delete" style="display:none; color:#c0392b;">삭제 (대표 전용)</button>
                        </div>
                    </div>
                </div>
                <div class="card">
                    <h2>🕓 수정 이력</h2>
                    <div id="inquiry-logs" style="font-size:13px; overflow-x:auto;"></div>
                </div>
            </div>
```

- [ ] **Step 3: app.js — switchPage 분기 추가** (기존 `if (pageName === 'pricing')` 줄 근처)

```js
    if (pageName === 'inquiry') renderInquiryPage().catch(console.error);
```

- [ ] **Step 4: app.js — 렌더·편집 로직 추가** (파일 말미)

```js
// =============================================
// 문의 관리 (문의시나리오 DB 통합 2026-07-25)
// 직원: 추가·수정·개별 ON/OFF / 대표만: 삭제·전체 자동응답 스위치
// =============================================
let inquiryScenarios = [];
async function renderInquiryPage() {
    const d = await api('/api/agent-office/scenarios');
    inquiryScenarios = d.scenarios || [];
    const isAdmin = currentUser?.role === 'admin';
    document.getElementById('inquiry-count').textContent = `(${inquiryScenarios.length}건)`;
    const wrap = document.getElementById('inquiry-auto-reply-wrap');
    wrap.style.display = isAdmin ? 'inline-flex' : 'none';
    document.getElementById('inquiry-auto-reply-toggle').checked = d.auto_reply !== 'off';
    const rows = inquiryScenarios.map(s => `
        <tr>
            <td>${s.scenario_no}</td>
            <td>${escapeHtml(s.name)}</td>
            <td>${escapeHtml(s.channel)}</td>
            <td>${escapeHtml(s.action)}</td>
            <td><input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="toggleScenario(${s.id}, this.checked)"></td>
            <td><button class="btn-sm btn-outline" onclick="openScenarioEdit(${s.id})">수정</button></td>
        </tr>`).join('');
    document.getElementById('inquiry-list').innerHTML = `
        <table class="data-table"><thead><tr><th>번호</th><th>시나리오명</th><th>채널</th><th>동작</th><th>사용</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>`;
    renderInquiryLogs().catch(console.error);
}
function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
window.toggleScenario = async function(id, enabled) {
    try { await api(`/api/agent-office/scenarios/${id}`, { method: 'PUT', body: JSON.stringify({ enabled }) }); }
    catch (e) { alert(e.message); }
    renderInquiryPage().catch(console.error);
};
window.openScenarioEdit = function(id) {
    const s = inquiryScenarios.find(x => x.id === id);
    if (!s) return;
    document.getElementById('inquiry-edit-card').style.display = '';
    document.getElementById('inquiry-edit-title').textContent = `시나리오 수정 — #${s.scenario_no} ${s.name}`;
    document.getElementById('inquiry-edit-id').value = s.id;
    document.getElementById('inquiry-edit-name').value = s.name;
    document.getElementById('inquiry-edit-keywords').value = (s.keywords || []).join(', ');
    document.getElementById('inquiry-edit-response').value = s.response;
    document.getElementById('inquiry-edit-action').value = s.action;
    document.getElementById('inquiry-edit-channel').value = s.channel;
    document.getElementById('inquiry-edit-enabled').checked = !!s.enabled;
    document.getElementById('btn-inquiry-delete').style.display = currentUser?.role === 'admin' ? '' : 'none';
    updateInquiryPreview();
    document.getElementById('inquiry-edit-card').scrollIntoView({ behavior: 'smooth' });
};
function updateInquiryPreview() {
    document.getElementById('inquiry-preview').textContent = document.getElementById('inquiry-edit-response').value;
}
function setupInquiryPage() {
    document.getElementById('btn-inquiry-add').addEventListener('click', () => {
        document.getElementById('inquiry-edit-card').style.display = '';
        document.getElementById('inquiry-edit-title').textContent = '새 시나리오';
        document.getElementById('inquiry-edit-id').value = '';
        ['inquiry-edit-name', 'inquiry-edit-keywords', 'inquiry-edit-response'].forEach(i => document.getElementById(i).value = '');
        document.getElementById('inquiry-edit-action').value = '자동응답';
        document.getElementById('inquiry-edit-channel').value = '톡톡';
        document.getElementById('inquiry-edit-enabled').checked = true;
        document.getElementById('btn-inquiry-delete').style.display = 'none';
        updateInquiryPreview();
    });
    document.getElementById('inquiry-edit-response').addEventListener('input', updateInquiryPreview);
    document.getElementById('btn-inquiry-cancel').addEventListener('click', () => {
        document.getElementById('inquiry-edit-card').style.display = 'none';
    });
    document.getElementById('btn-inquiry-save').addEventListener('click', async () => {
        const id = document.getElementById('inquiry-edit-id').value;
        const body = {
            name: document.getElementById('inquiry-edit-name').value.trim(),
            keywords: document.getElementById('inquiry-edit-keywords').value.split(',').map(s => s.trim()).filter(Boolean),
            response: document.getElementById('inquiry-edit-response').value,
            action: document.getElementById('inquiry-edit-action').value,
            channel: document.getElementById('inquiry-edit-channel').value,
            enabled: document.getElementById('inquiry-edit-enabled').checked,
        };
        try {
            if (id) await api(`/api/agent-office/scenarios/${id}`, { method: 'PUT', body: JSON.stringify(body) });
            else await api('/api/agent-office/scenarios', { method: 'POST', body: JSON.stringify(body) });
            document.getElementById('inquiry-edit-card').style.display = 'none';
            renderInquiryPage().catch(console.error);
        } catch (e) { alert(e.message); }
    });
    document.getElementById('btn-inquiry-delete').addEventListener('click', async () => {
        const id = document.getElementById('inquiry-edit-id').value;
        if (!id || !confirm('이 시나리오를 삭제할까요? (복구는 대표에게 요청)')) return;
        try {
            await api(`/api/agent-office/scenarios/${id}`, { method: 'DELETE', body: JSON.stringify({ confirm: true }) });
            document.getElementById('inquiry-edit-card').style.display = 'none';
            renderInquiryPage().catch(console.error);
        } catch (e) { alert(e.message); }
    });
    document.getElementById('inquiry-auto-reply-toggle').addEventListener('change', async (e) => {
        try { await api('/api/agent-office/scenarios-auto-reply', { method: 'PUT', body: JSON.stringify({ value: e.target.checked ? 'on' : 'off' }) }); }
        catch (err) { alert(err.message); e.target.checked = !e.target.checked; }
    });
}
async function renderInquiryLogs() {
    const d = await api('/api/agent-office/scenario-logs');
    const rows = (d.logs || []).map(l => {
        const name = l.changes?.after?.name || l.changes?.before?.name || (l.action.startsWith('auto_reply') ? '전체 자동응답' : '');
        const act = { create: '추가', update: '수정', delete: '삭제', auto_reply_on: '전체 ON', auto_reply_off: '전체 OFF' }[l.action] || l.action;
        return `<tr><td>${new Date(l.created_at).toLocaleString('ko-KR')}</td><td>${escapeHtml(l.actor_name || '-')}</td><td>${act}</td><td>${escapeHtml(name)}</td></tr>`;
    }).join('');
    document.getElementById('inquiry-logs').innerHTML = rows
        ? `<table class="data-table"><thead><tr><th>일시</th><th>수정자</th><th>작업</th><th>대상</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p class="text-muted">이력이 없습니다</p>';
}
setupInquiryPage();
```

주의: `api()` 헬퍼의 실제 시그니처(app.js 상단)를 확인해 fetch 옵션 형식을 맞출 것(POST에 headers 자동 포함 여부). `setupInquiryPage()` 호출은 DOM 준비 후 실행되는 위치(파일 말미)면 안전.

- [ ] **Step 5: 문법 확인** — `node --check public/app.js` → 성공

- [ ] **Step 6: 커밋** — `git add public/index.html public/app.js && git commit -m "문의시나리오 5/5: [문의 관리] 화면 (목록·편집·미리보기·이력, 직원 편집 가능)"`

---

### Task 6: 회사프로그램 배포 (v5.9.55)

**Files:**
- Modify: `version.js` — VERSION `'5.9.55'`
- Modify: `public/index.html` — `app.js?v=262`
- Modify: `CHANGELOG.md` — v5.9.55 항목 추가

- [ ] **Step 1: 버전·캐시·CHANGELOG 갱신** (CHANGELOG 형식은 기존 항목 참고)
- [ ] **Step 2: 검증** — `node --check server.js && node --check public/app.js` → 성공
- [ ] **Step 3: 배포** — `npm run deploy` (Bash 타임아웃 **540000ms**) → push 후 Render 재배포 ~2분
- [ ] **Step 4: Render 환경변수 안내(대표)** — `SCENARIO_API_TOKEN` 생성(`openssl rand -hex 32` 또는 PowerShell 랜덤) 후 **회사프로그램 서비스**에 등록. 값은 톡톡봇 서비스에도 동일하게 넣어야 함(Task 7).
- [ ] **Step 5: 배포 후 확인** — 관리자 로그인 → [문의 관리]에서 47건 목록 확인(Task 4를 먼저 실행했다면), 문구 1건 열어 미리보기 확인. `GET /api/scenarios`는 토큰 없이 401/503 응답 확인.

---

### Task 7: 톡톡봇 — scenario-store.js + 연결 (이중 상태)

**Files (톡톡봇 리포 `C:\Users\전승범\OneDrive\문서\★제주아꼼이네 톡톡봇`):**
- Create: `scenario-store.js`
- Modify: `ai-handler.js` — scenarios 참조를 store 경유로 교체, STATIC_SYSTEM_TEXT를 버전 캐시 함수로 교체, auto_reply off 처리
- Modify: `server.js` — 부팅 시 `scenarioStore.start()` 1줄
- Modify: `.env.example` — 신규 env 3종 문서화

**Interfaces:**
- Consumes: Task 2 API. env: `COMPANY_API_URL`(예: https://jeju-acom-company.onrender.com), `SCENARIO_API_TOKEN`, `SCENARIO_SOURCE`(`code`|`db`, 기본 `code`), (선택) `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`
- Produces: `scenarioStore.getScenarios()` → 시나리오 배열(하드코딩과 동일 형태 `{name, keywords, response}`; scenario_no 0(영업시간외)은 제외), `scenarioStore.getAutoReply()` → 'on'|'off', `scenarioStore.getVersion()` → 캐시 갱신마다 증가(프롬프트 재구성 트리거), `scenarioStore.start()`

- [ ] **Step 1: scenario-store.js 작성**

```js
/**
 * 시나리오 스토어 — 회사프로그램 DB에서 시나리오를 읽어오는 단일 창구 (문의시나리오 DB 통합)
 * - 5분 캐시. 실패 시 마지막 성공 캐시 유지. 캐시조차 없으면 하드코딩 폴백(전환기) + 텔레그램 1회.
 * - SCENARIO_SOURCE=db 일 때만 DB 데이터 사용. 기본(code)은 기존 하드코딩 그대로 (무중단 원칙).
 */
const axios = require("axios");
const { scenarios: codeScenarios } = require("./scenarios");

const SOURCE = (process.env.SCENARIO_SOURCE || "code").toLowerCase();
const BASE = (process.env.COMPANY_API_URL || "").replace(/\/$/, "");
const TOKEN = process.env.SCENARIO_API_TOKEN || "";
const REFRESH_MS = 5 * 60 * 1000;

let cache = null;        // { scenarios: [{name, keywords, response, ...}], auto_reply }
let version = 0;         // 캐시 갱신마다 증가 — ai-handler가 프롬프트 재구성 판단에 사용
let alerted = false;     // 텔레그램 스팸 방지 (기동 실패 알림 1회)

async function notifyTelegram(text) {
  const t = process.env.TELEGRAM_BOT_TOKEN, c = process.env.TELEGRAM_CHAT_ID;
  if (!t || !c) return;
  try {
    await axios.post(`https://api.telegram.org/bot${t}/sendMessage`, { chat_id: c, text });
  } catch (e) { console.error("[시나리오] 텔레그램 알림 실패:", e.message); }
}

async function refresh() {
  if (!BASE || !TOKEN) return; // 미설정이면 조용히 하드코딩만 사용
  try {
    const r = await axios.get(`${BASE}/api/scenarios?channel=talktalk`, {
      headers: { Authorization: `Bearer ${TOKEN}` }, timeout: 15000,
    });
    if (!r.data || !Array.isArray(r.data.scenarios)) throw new Error("응답 형식 오류");
    const prev = JSON.stringify(cache);
    cache = { scenarios: r.data.scenarios, auto_reply: r.data.auto_reply === "off" ? "off" : "on" };
    if (JSON.stringify(cache) !== prev) version++;
    alerted = false;
    console.log(`[시나리오] 갱신 완료 — ${cache.scenarios.length}건, 자동응답 ${cache.auto_reply}, v${version}`);
  } catch (e) {
    console.error("[시나리오] 갱신 실패(기존 캐시 유지):", e.message);
    if (!cache && !alerted) {
      alerted = true;
      notifyTelegram(`⚠️ 톡톡봇: 시나리오 API 연결 실패 — 하드코딩 폴백으로 동작 중 (${e.message})`);
    }
  }
}

function start() {
  refresh();
  setInterval(refresh, REFRESH_MS);
}

// 봇이 쓰는 시나리오 목록 (영업시간외 scenario_no 0은 AI 답변목록에서 제외 — 기존과 동일 구성 유지)
function getScenarios() {
  if (SOURCE === "db" && cache) return cache.scenarios.filter(s => s.scenario_no !== 0);
  return codeScenarios;
}
function getAutoReply() {
  if (SOURCE === "db" && cache) return cache.auto_reply;
  return "on";
}
function getVersion() { return SOURCE === "db" ? version : -1; }

module.exports = { start, getScenarios, getAutoReply, getVersion };
```

- [ ] **Step 2: ai-handler.js 수정** (응답 로직 무수정 — 데이터 출처만 교체)

  1. 상단 `const { scenarios } = require("./scenarios");` → `const scenarioStore = require("./scenario-store");` 로 교체.
  2. `STATIC_SYSTEM_TEXT` 상수(119~158행) → 같은 문자열을 만드는 함수 + 버전 캐시로 교체. **문구는 한 글자도 바꾸지 않고** `${scenarios.map(...)}` 부분만 인자로:

```js
// ── 정적 시스템 프롬프트 — 시나리오 캐시 버전이 바뀔 때만 재구성 (프롬프트 캐싱 유지)
let _staticCache = { version: null, text: "" };
function getStaticSystemText() {
  const v = scenarioStore.getVersion();
  if (_staticCache.version === v) return _staticCache.text;
  const scenarios = scenarioStore.getScenarios();
  _staticCache = { version: v, text: `당신은 "제주아꼼이네"의 AI 고객상담 담당자입니다.
... (기존 STATIC_SYSTEM_TEXT 전문을 그대로 — ## 답변 목록 부분만 아래처럼)
## 답변 목록
${scenarios.map(s => `### ${s.name}\n${s.response}`).join("\n\n")}
... (이후도 기존 전문 그대로)` };
  return _staticCache.text;
}
```

  3. `getAIResponse` 안의 참조 교체:
     - 맨 앞에 전체 스위치: `if (scenarioStore.getAutoReply() === "off") { console.log("[AI] 전체 자동응답 OFF — SKIP"); return { response: null, error: null }; }`
     - `scenarios.find(s => s.name === "가격 문의")` → `scenarioStore.getScenarios().find(...)`
     - `client.messages.create`의 `system` 첫 블록 `STATIC_SYSTEM_TEXT` → `getStaticSystemText()`
     - 안전망 2곳의 `scenarios.find(...)` → `scenarioStore.getScenarios().find(...)`

- [ ] **Step 3: server.js 부팅 연결** — `const { getAIResponse } = require("./ai-handler");` 아래에:

```js
const scenarioStore = require("./scenario-store"); // 문의시나리오 DB 통합 — 5분 캐시
scenarioStore.start();
```

- [ ] **Step 4: .env.example에 신규 env 문서화**

```
# --- 문의시나리오 DB 연동 (회사프로그램) ---
# SCENARIO_SOURCE: code(기존 하드코딩, 기본) | db(회사프로그램 DB — 비교 검증 통과 후 전환)
COMPANY_API_URL=https://jeju-acom-company.onrender.com
SCENARIO_API_TOKEN=your_scenario_api_token_here
SCENARIO_SOURCE=code
```

- [ ] **Step 5: 문법 확인** — 톡톡봇 폴더에서 `node --check scenario-store.js && node --check ai-handler.js && node --check server.js` → 성공

- [ ] **Step 6: 커밋 (push 금지 — 배포는 대표 최종 1회)**

```bash
git add scenario-store.js ai-handler.js server.js .env.example
git commit -m "시나리오 DB 이중상태: scenario-store 추가 (SCENARIO_SOURCE=code 기본, 무중단)"
```

---

### Task 8: 톡톡봇 — 비교 검증 스크립트 (47건 diff)

**Files:**
- Create: (톡톡봇 리포) `scripts/compare-scenarios.js`

**Interfaces:**
- Consumes: 하드코딩 `scenarios.js` + Task 2 API(로컬 실행, env `COMPANY_API_URL`/`SCENARIO_API_TOKEN` 필요 — 봇 `.env` 사용)

- [ ] **Step 1: 스크립트 작성**

```js
// scripts/compare-scenarios.js — 하드코딩 vs DB 답변 전수 비교 (지시문 STEP4-2)
// 실행: node scripts/compare-scenarios.js  (봇 .env의 COMPANY_API_URL/SCENARIO_API_TOKEN 사용)
require("dotenv").config();
const axios = require("axios");
const { scenarios, afterHoursResponse } = require("../scenarios");

async function main() {
  const BASE = (process.env.COMPANY_API_URL || "").replace(/\/$/, "");
  const r = await axios.get(`${BASE}/api/scenarios?channel=talktalk`, {
    headers: { Authorization: `Bearer ${process.env.SCENARIO_API_TOKEN}` }, timeout: 15000,
  });
  const db = r.data.scenarios;
  const dbByNo = Object.fromEntries(db.map(s => [s.scenario_no, s]));
  let fail = 0;
  const check = (no, name, keywords, response) => {
    const d = dbByNo[no];
    const problems = [];
    if (!d) problems.push("DB에 없음");
    else {
      if (d.name !== name) problems.push(`이름 다름: "${d.name}"`);
      if (d.response !== response) problems.push(`문구 다름 (DB ${d.response.length}자 vs 원본 ${response.length}자)`);
      if (JSON.stringify(d.keywords) !== JSON.stringify(keywords)) problems.push("키워드 다름");
    }
    if (problems.length) { fail++; console.log(`❌ #${no} ${name}: ${problems.join(", ")}`); }
    else console.log(`✅ #${no} ${name}`);
  };
  check(0, "영업시간 외 자동응대", [], afterHoursResponse);
  scenarios.forEach((s, i) => check(i + 1, s.name, s.keywords, s.response));
  console.log(fail === 0 ? `\n✅ 전체 ${scenarios.length + 1}건 완전 일치 — 스위치 가능` : `\n❌ ${fail}건 불일치 — 스위치 금지`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error("비교 실패:", e.response?.status || "", e.message); process.exit(1); });
```

- [ ] **Step 2: 실행** — (봇 `.env`에 COMPANY_API_URL·SCENARIO_API_TOKEN 넣은 뒤) `node scripts/compare-scenarios.js`
Expected: `✅ 전체 47건 완전 일치 — 스위치 가능`

- [ ] **Step 3: 결과를 대표 보고** (완료 보고 항목 4번)

- [ ] **Step 4: 커밋** — `git add scripts/compare-scenarios.js && git commit -m "시나리오 비교 검증 스크립트 (47건 전수 diff)"`

---

### Task 9: 전환 절차 문서 + 대표 안내

**Files:**
- Create: (회사프로그램 리포) `docs/문의시나리오_전환절차.md`

- [ ] **Step 1: 대표용 절차 문서 작성** — 내용에 반드시 포함:
  1. **Render 환경변수** — 회사프로그램: `SCENARIO_API_TOKEN`. 톡톡봇: `COMPANY_API_URL`, `SCENARIO_API_TOKEN`(동일값), `SCENARIO_SOURCE=code`, (선택) `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`.
  2. **톡톡봇 마지막 git 배포** — 봇 폴더에서 `git push` 1회 (Render 자동배포). 이후 문구 수정은 [문의 관리] 화면 저장만으로 5분 내 반영, 배포 불필요.
  3. **스위치** — 비교 스크립트 전건 일치 확인 후, Render 톡톡봇 서비스에서 `SCENARIO_SOURCE=db`로 변경(재시작만, 배포 아님).
  4. **검증 체크리스트** (지시문 STEP5): 화면에서 문구 수정 → 5분 내 실응답 반영 / 새 시나리오 추가 → 인식 / 개별 OFF → 응답 중지 / 전체 OFF(대표) → 전면 중지 / audit_logs 이력 확인.
  5. **안정 확인 후(며칠)** 하드코딩 제거는 별도 요청 시 진행(선택 정리 배포 1회).
- [ ] **Step 2: 커밋** — `git add docs/문의시나리오_전환절차.md && git commit -m "문의시나리오 전환절차 문서 (대표용)"`
- [ ] **Step 3: 대표에게 완료 보고** — 지시문 4절 5개 항목(테이블+API 목록 / 47건 대조표 / 화면 위치 / 비교 검증 결과 / 마지막 배포 절차) 정리해 보고.

---

## Self-Review 결과

- **스펙 커버리지**: 테이블(T1), 봇 API(T2), CRUD+이력(T3), 이관+대조표(T4), 화면(T5), 배포(T6), 봇 이중상태+캐시+폴백+텔레그램(T7), 비교검증(T8), 전환·검증 절차(T9) — 스펙 1~7절 전부 대응. 하드코딩 제거는 안정 확인 후 별도(스펙 5절 4단계와 일치).
- **주의점(실행자용)**: ①app.js의 `api()` 헬퍼 시그니처를 실제로 확인해 fetch 형식을 맞출 것 ②ai-handler 프롬프트 문자열은 기존 전문을 복사해 답변목록 부분만 치환(문구 개선 금지) ③`.data-table`/`.btn-*` 등 CSS 클래스는 기존 화면에서 실제 사용 클래스로 맞출 것 ④톡톡봇 리포에서 push 금지(커밋만).
