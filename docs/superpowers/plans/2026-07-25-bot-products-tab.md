# 판매현황 탭 이전 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 톡톡봇 판매현황·가격(bot_products) 관리를 회사프로그램 [문의 관리] 화면의 탭2로 이전하고, 봇의 시즌 시드 하드코딩("삭제해도 부활" 함정)을 제거한다.

**Architecture:** bot_products는 이미 회사프로그램과 같은 DB — 데이터 이동 없음. 회사프로그램에 컬럼 2개(ALTER)+CRUD API+탭 UI만 추가하면 봇은 1분 캐시로 자동 반영. 봇은 정리 배포 1회(시드 제거 + deleted_at 필터 + PRODUCTS_PAGE env 게이트)로 이중 상태 유지.

**Tech Stack:** Node.js/Express + PostgreSQL(pg), vanilla JS 프론트. 봇은 별도 리포.

**Spec:** `docs/superpowers/specs/2026-07-25-bot-products-tab-design.md` (대표 승인본)

## Global Constraints

- 스마트스토어 판매가 데이터 — '품목별 금액'(pricing, 거래처 결제가)과 데이터·화면·API 절대 통합 금지. 탭2에 "🏷️ 스마트스토어 판매가" 라벨 명시.
- 물리삭제 금지(soft-delete `deleted_at`), 모든 변경 audit_logs (targetType `bot_product`, source `bot-product`).
- 권한: 목록/추가/수정 = authMiddleware(직원 가능) / 삭제 = adminOnly + requireConfirm.
- status 허용값: `['판매중','품절','시즌종료']`.
- 시나리오 탭(기존 47건 화면) 동작 변경 금지 — 탭 래핑만. 봇 응답·치환 로직 수정 금지.
- 회사프로그램 다음 배포: **v5.9.56 / app.js 캐시 v=263** + CHANGELOG. `npm run deploy`(타임아웃 540000ms+), 사전 `node --check` 2종.
- 톡톡봇 리포는 커밋만, **push는 대표** (기존 /products 페이지는 게이트 스위치 전까지 정상 동작해야 함).
- 커밋 푸터: Co-Authored-By / Claude-Session (기존 커밋 참고).
- 테스트 프레임워크 없음 — `node --check` + 스크립트/수동 검증.

---

### Task 1: 회사프로그램 — bot_products 컬럼 추가 + CRUD API + 이력

**Files:**
- Modify: `server.js` — ①initDB의 inquiry_scenarios 블록(~794행) 뒤 ②문의시나리오 서비스(`svcSoftDeleteScenario`) 뒤 ③문의시나리오 라우트(`scenario-logs`) 뒤

**Interfaces:**
- Consumes: `writeAudit`, `adminActor`, `handleAdminErr`, `requireConfirm`, `authMiddleware`, `adminOnly` (기존)
- Produces:
  - `GET /api/agent-office/bot-products` → `{ products: [{id, name, status, price, updated_by, updated_at}] }` (미삭제, 판매중→품절→시즌종료→이름순)
  - `POST /api/agent-office/bot-products` body `{name, price?, status?}` (soft-delete 동명 존재 시 복구+덮어쓰기)
  - `PUT /api/agent-office/bot-products/:id` body `{name?, status?, price?}`
  - `DELETE /api/agent-office/bot-products/:id` body `{confirm:true}` — adminOnly, soft
  - `GET /api/agent-office/bot-product-logs` → audit 최근 100건

- [ ] **Step 1: initDB에 컬럼 추가** — inquiry_scenarios의 `inquiry_auto_reply` 시드 직후에 삽입:

```js
    // 판매현황 탭 이전 (2026-07-25 설계): bot_products(톡톡봇 가격표·판매현황, 같은 DB 공유)에 관리 컬럼 추가
    //   테이블 자체는 톡톡봇 products-store.js가 생성 — 없을 수도 있으므로 동일 DDL로 보장 후 ALTER
    await pool.query(`
        CREATE TABLE IF NOT EXISTS bot_products (
            id SERIAL PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            status TEXT NOT NULL DEFAULT '판매중',
            price TEXT DEFAULT '',
            memo TEXT DEFAULT '',
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    `);
    await pool.query(`ALTER TABLE bot_products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE bot_products ADD COLUMN IF NOT EXISTS updated_by VARCHAR(50)`);
```

- [ ] **Step 2: 서비스 함수** — `svcSoftDeleteScenario` 함수 뒤에 삽입:

```js
// --- 판매현황(bot_products) 서비스 (설계 2026-07-25 — 스마트스토어 판매가, 품목별 금액과 별개) ---
//   톡톡봇이 1분 캐시로 읽어가므로 저장만 하면 자동 반영. 삭제 반영은 봇 정리 배포(deleted_at 필터) 후.
const BOT_PRODUCT_STATUSES = ['판매중', '품절', '시즌종료'];
async function svcListBotProducts() {
    const r = await pool.query(
        `SELECT id, name, status, price, updated_by, updated_at FROM bot_products
         WHERE deleted_at IS NULL
         ORDER BY CASE status WHEN '판매중' THEN 0 WHEN '품절' THEN 1 ELSE 2 END, name`);
    return r.rows;
}
async function svcCreateBotProduct({ name, price = '', status = '판매중' }, actor) {
    const nm = String(name || '').trim();
    if (!nm) throw { status: 400, message: '품목명(name)은 필수입니다' };
    if (!BOT_PRODUCT_STATUSES.includes(status)) throw { status: 400, message: '상태는 판매중/품절/시즌종료 중 하나여야 합니다' };
    const cur = await pool.query('SELECT * FROM bot_products WHERE name = $1', [nm]);
    if (cur.rows.length && cur.rows[0].deleted_at === null) throw { status: 409, message: '이미 등록된 품목입니다 (목록에서 수정하세요)' };
    let row;
    if (cur.rows.length) {
        // soft-delete된 동명 품목 → 복구 + 덮어쓰기 (name UNIQUE 대응, 설계 2절)
        const r = await pool.query(
            `UPDATE bot_products SET deleted_at = NULL, status = $2, price = $3, updated_by = $4, updated_at = now()
             WHERE id = $1 RETURNING *`, [cur.rows[0].id, status, String(price || '').trim(), actor?.name || null]);
        row = r.rows[0];
        await writeAudit({ action: 'restore', targetType: 'bot_product', targetId: row.id, changes: { before: cur.rows[0], after: row }, source: 'bot-product', actor });
    } else {
        const r = await pool.query(
            `INSERT INTO bot_products (name, status, price, updated_by) VALUES ($1,$2,$3,$4) RETURNING *`,
            [nm, status, String(price || '').trim(), actor?.name || null]);
        row = r.rows[0];
        await writeAudit({ action: 'create', targetType: 'bot_product', targetId: row.id, changes: { after: row }, source: 'bot-product', actor });
    }
    return row;
}
async function svcUpdateBotProduct(id, patch, actor) {
    const cur = await pool.query('SELECT * FROM bot_products WHERE id=$1 AND deleted_at IS NULL', [id]);
    if (cur.rows.length === 0) throw { status: 404, message: '품목을 찾을 수 없습니다' };
    const before = cur.rows[0];
    if (patch.status !== undefined && !BOT_PRODUCT_STATUSES.includes(patch.status)) throw { status: 400, message: '상태 값이 잘못되었습니다' };
    if (patch.name !== undefined && !String(patch.name).trim()) throw { status: 400, message: '품목명은 비울 수 없습니다' };
    const sets = ['updated_at = now()']; const params = [];
    if (patch.name !== undefined) { params.push(String(patch.name).trim()); sets.push(`name=$${params.length}`); }
    if (patch.status !== undefined) { params.push(patch.status); sets.push(`status=$${params.length}`); }
    if (patch.price !== undefined) { params.push(String(patch.price || '').trim()); sets.push(`price=$${params.length}`); }
    if (params.length === 0) throw { status: 400, message: '수정할 내용이 없습니다' };
    params.push(actor?.name || null); sets.push(`updated_by=$${params.length}`);
    params.push(id);
    const r = await pool.query(`UPDATE bot_products SET ${sets.join(', ')} WHERE id=$${params.length} RETURNING *`, params);
    const after = r.rows[0];
    await writeAudit({ action: 'update', targetType: 'bot_product', targetId: Number(id), changes: { before, after }, source: 'bot-product', actor });
    return after;
}
async function svcSoftDeleteBotProduct(id, actor) {
    const cur = await pool.query('SELECT * FROM bot_products WHERE id=$1 AND deleted_at IS NULL', [id]);
    if (cur.rows.length === 0) throw { status: 404, message: '품목을 찾을 수 없습니다' };
    const r = await pool.query(`UPDATE bot_products SET deleted_at=now(), updated_by=$2, updated_at=now() WHERE id=$1 RETURNING *`, [id, actor?.name || null]);
    await writeAudit({ action: 'delete', targetType: 'bot_product', targetId: Number(id), changes: { before: cur.rows[0] }, source: 'bot-product', actor });
    return r.rows[0];
}
```

- [ ] **Step 3: 라우트** — `scenario-logs` 라우트 뒤에 삽입:

```js
// --- 판매현황(bot_products) 관리 라우트 (직원 가능 / 삭제만 대표 전용) ---
app.get('/api/agent-office/bot-products', authMiddleware, async (req, res) => {
    try { res.json({ products: await svcListBotProducts() }); }
    catch (err) { handleAdminErr(res, err); }
});
app.post('/api/agent-office/bot-products', authMiddleware, async (req, res) => {
    try { res.json({ message: '품목이 추가되었습니다', product: await svcCreateBotProduct(req.body || {}, adminActor(req)) }); }
    catch (err) { handleAdminErr(res, err); }
});
app.put('/api/agent-office/bot-products/:id', authMiddleware, async (req, res) => {
    try { res.json({ message: '저장되었습니다 (봇 답변에 1분 내 반영)', product: await svcUpdateBotProduct(req.params.id, req.body || {}, adminActor(req)) }); }
    catch (err) { handleAdminErr(res, err); }
});
app.delete('/api/agent-office/bot-products/:id', authMiddleware, adminOnly, async (req, res) => {
    if (!requireConfirm(req, res)) return;
    try { res.json({ message: '품목이 삭제되었습니다(복구 가능)', product: await svcSoftDeleteBotProduct(req.params.id, adminActor(req)) }); }
    catch (err) { handleAdminErr(res, err); }
});
app.get('/api/agent-office/bot-product-logs', authMiddleware, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT id, action, target_id, changes, actor_name, created_at FROM audit_logs
             WHERE target_type = 'bot_product' ORDER BY id DESC LIMIT 100`);
        res.json({ logs: r.rows });
    } catch (err) { handleAdminErr(res, err); }
});
```

- [ ] **Step 4: 검증** — `node --check server.js` → 성공
- [ ] **Step 5: 커밋** — `git add server.js && git commit -m "판매현황 탭 1/2: bot_products 관리 컬럼 + CRUD API (직원 가능·삭제 대표 전용)"` + 푸터

---

### Task 2: [문의 관리] 탭 구조 + 판매현황 탭 UI

**Files:**
- Modify: `public/index.html` — `#page-inquiry` 내부 (h1 아래 탭바 추가, 기존 3카드 래핑, 탭2 마크업 추가)
- Modify: `public/app.js` — 탭 전환 + 판매현황 렌더·저장 로직, 이력 카드 탭 연동

**Interfaces:**
- Consumes: Task 1 API 5종, 기존 `api(url, method, body)`(위치 인자!), `escapeHtml`(app.js 기존), `currentUser.role`, 기존 `renderInquiryPage()`/`renderInquiryLogs()`/`setupInquiryPage()`
- Produces: `window.switchInquiryTab(name)` (`'scenario'|'products'`), `renderBotProducts()`, `renderBotProductLogs()`

- [ ] **Step 1: index.html — 탭바 + 래핑.** `#page-inquiry`의 `<h1>문의 관리</h1>` + 안내문 바로 아래에 탭바 추가, 기존 카드들(목록 카드·편집 카드)을 `<div id="inquiry-tab-scenario">...</div>`로 감싸고, 그 뒤에 탭2 컨테이너 추가. 마지막 수정 이력 카드는 두 탭 공용으로 래핑 밖에 유지:

```html
                <div style="display:flex; gap:6px; margin-bottom:14px;">
                    <button class="btn-sm" id="inquiry-tab-btn-scenario" onclick="switchInquiryTab('scenario')">💬 시나리오</button>
                    <button class="btn-sm btn-outline" id="inquiry-tab-btn-products" onclick="switchInquiryTab('products')">🏷️ 판매현황·가격</button>
                </div>
                <div id="inquiry-tab-scenario">
                    <!-- 기존 시나리오 목록 카드 + 편집 카드 (그대로 이동, 내용 무수정) -->
                </div>
                <div id="inquiry-tab-products" style="display:none;">
                    <div class="card">
                        <div class="card-header-row">
                            <h2>🏷️ 판매현황·가격 <span class="text-muted" style="font-size:13px; font-weight:400;">스마트스토어 판매가 — 품목별 금액(거래처 결제가)과 다른 데이터입니다</span></h2>
                            <button class="btn-primary" id="btn-botprod-add-toggle">+ 품목 추가</button>
                        </div>
                        <p class="text-muted" style="font-size:13px; margin:4px 0 10px;">저장하면 톡톡봇 답변({{가격표}}·{{판매현황}})에 1분 내 자동 반영됩니다.</p>
                        <div id="botprod-add-form" style="display:none; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
                            <input type="text" id="botprod-add-name" placeholder="품목명 (예: 카라향 3kg)" style="flex:1; min-width:180px; padding:8px; border:1px solid var(--border,#ccc); border-radius:8px;">
                            <input type="text" id="botprod-add-price" placeholder="가격 (예: 19,900원)" style="width:140px; padding:8px; border:1px solid var(--border,#ccc); border-radius:8px;">
                            <button class="btn-primary" id="btn-botprod-add">추가</button>
                        </div>
                        <div id="botprod-list" style="overflow-x:auto;"></div>
                    </div>
                </div>
```

- [ ] **Step 2: app.js — 탭 전환 + 판매현황 로직** (문의 관리 블록 끝, `setupInquiryPage()` 호출 직전에 추가):

```js
// --- 판매현황·가격 탭 (bot_products — 스마트스토어 판매가, 봇 1분 캐시 자동 반영) ---
let botProducts = [];
let inquiryActiveTab = 'scenario';
window.switchInquiryTab = function(name) {
    inquiryActiveTab = name;
    document.getElementById('inquiry-tab-scenario').style.display = name === 'scenario' ? '' : 'none';
    document.getElementById('inquiry-tab-products').style.display = name === 'products' ? '' : 'none';
    const bS = document.getElementById('inquiry-tab-btn-scenario'), bP = document.getElementById('inquiry-tab-btn-products');
    bS.className = name === 'scenario' ? 'btn-sm' : 'btn-sm btn-outline';
    bP.className = name === 'products' ? 'btn-sm' : 'btn-sm btn-outline';
    if (name === 'products') renderBotProducts().catch(console.error);
    else renderInquiryLogs().catch(console.error);
};
const BOTPROD_STATUSES = ['판매중', '품절', '시즌종료'];
async function renderBotProducts() {
    const d = await api('/api/agent-office/bot-products');
    botProducts = d.products || [];
    const isAdmin = currentUser?.role === 'admin';
    const rows = botProducts.map(p => `
        <tr>
            <td>${escapeHtml(p.name)}</td>
            <td style="white-space:nowrap;">${BOTPROD_STATUSES.map(s =>
                `<button class="btn-sm ${p.status === s ? 'btn-primary' : 'btn-outline'}" onclick="setBotProdStatus(${p.id}, '${s}')">${s}</button>`).join(' ')}</td>
            <td><input type="text" id="botprod-price-${p.id}" value="${escapeHtml(p.price || '')}" placeholder="가격" style="width:110px; padding:6px; border:1px solid var(--border,#ccc); border-radius:8px;"></td>
            <td style="white-space:nowrap;">
                <button class="btn-sm btn-outline" onclick="saveBotProdPrice(${p.id})">저장</button>
                ${isAdmin ? `<button class="btn-sm btn-outline" style="color:#c0392b;" onclick="deleteBotProd(${p.id})">삭제</button>` : ''}
            </td>
        </tr>`).join('');
    document.getElementById('botprod-list').innerHTML = `
        <table class="data-table"><thead><tr><th>품목명</th><th>상태</th><th>가격</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>`;
    renderBotProductLogs().catch(console.error);
}
window.setBotProdStatus = async function(id, status) {
    try { await api('/api/agent-office/bot-products/' + id, 'PUT', { status }); }
    catch (e) { alert(e.message); }
    renderBotProducts().catch(console.error);
};
window.saveBotProdPrice = async function(id) {
    try { await api('/api/agent-office/bot-products/' + id, 'PUT', { price: document.getElementById('botprod-price-' + id).value }); }
    catch (e) { alert(e.message); }
    renderBotProducts().catch(console.error);
};
window.deleteBotProd = async function(id) {
    const p = botProducts.find(x => x.id === id);
    if (!p || !confirm(`"${p.name}" 품목을 삭제할까요? (복구 가능)`)) return;
    try { await api('/api/agent-office/bot-products/' + id, 'DELETE', { confirm: true }); }
    catch (e) { alert(e.message); }
    renderBotProducts().catch(console.error);
};
async function renderBotProductLogs() {
    const d = await api('/api/agent-office/bot-product-logs');
    const rows = (d.logs || []).map(l => {
        const name = l.changes?.after?.name || l.changes?.before?.name || '';
        const act = { create: '추가', restore: '복구', update: '수정', delete: '삭제' }[l.action] || l.action;
        return `<tr><td>${new Date(l.created_at).toLocaleString('ko-KR')}</td><td>${escapeHtml(l.actor_name || '-')}</td><td>${escapeHtml(act)}</td><td>${escapeHtml(name)}</td></tr>`;
    }).join('');
    document.getElementById('inquiry-logs').innerHTML = rows
        ? `<table class="data-table"><thead><tr><th>일시</th><th>수정자</th><th>작업</th><th>대상</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p class="text-muted">이력이 없습니다</p>';
}
function setupBotProductsTab() {
    document.getElementById('btn-botprod-add-toggle').addEventListener('click', () => {
        const f = document.getElementById('botprod-add-form');
        f.style.display = f.style.display === 'none' ? 'flex' : 'none';
    });
    document.getElementById('btn-botprod-add').addEventListener('click', async () => {
        const name = document.getElementById('botprod-add-name').value.trim();
        if (!name) return alert('품목명을 입력하세요');
        try {
            await api('/api/agent-office/bot-products', 'POST', { name, price: document.getElementById('botprod-add-price').value });
            document.getElementById('botprod-add-name').value = '';
            document.getElementById('botprod-add-price').value = '';
            renderBotProducts().catch(console.error);
        } catch (e) { alert(e.message); }
    });
}
setupBotProductsTab();
```

추가로: `switchPage`의 `if (pageName === 'inquiry')` 분기에서 페이지 진입 시 활성 탭 유지(기존 `renderInquiryPage()` 호출 유지 + `if (inquiryActiveTab === 'products') renderBotProducts().catch(console.error);` 추가). 수정 이력 카드 제목 옆이나 위에 현재 탭 기준임을 알 수 있게 할 필요는 없음(YAGNI) — 탭 전환 시 이력이 함께 갱신되므로 충분.

- [ ] **Step 3: 검증** — `node --check public/app.js`; index.html 삽입부 태그 균형 육안 확인
- [ ] **Step 4: 커밋** — `git add public/index.html public/app.js && git commit -m "판매현황 탭 2/2: [문의 관리] 탭 구조 + 판매현황·가격 탭 (스마트스토어 판매가)"` + 푸터

---

### Task 3: 회사프로그램 배포 v5.9.56 (대표 확인 후)

- [ ] **Step 1:** `version.js` → `'v5.9.56'`, `public/index.html` → `app.js?v=263`, `CHANGELOG.md`에 v5.9.56 항목(판매현황 탭 이전 + API + 봇 정리 예고)
- [ ] **Step 2:** `node --check server.js && node --check public/app.js` → 성공
- [ ] **Step 3:** **대표 확인 후** `npm run deploy` (540000ms)
- [ ] **Step 4:** 배포 후 [문의 관리] 탭2에서 36건 목록·가격 저장 → 봇 답변 반영(1~2분) 확인

---

### Task 4: 톡톡봇 정리 배포 코드 (직접 — 컨트롤러)

**Files:** (톡톡봇 리포) `products-store.js`

- [ ] **Step 1: 시드 제거** — `DEFAULT_PRODUCTS`·`SOLDOUT_DEFAULTS`·`PREORDER_PRODUCTS` 상수 삭제, `ensureTable()`에서 시드 등록 루프 3개와 `DELETE FROM bot_products WHERE name = '청귤(풋귤)'` 줄 삭제. `ensureTable()`은 아래만 남김:

```js
async function ensureTable() {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_products (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT '판매중',
      price TEXT DEFAULT '',
      memo TEXT DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `);
  // 판매현황 관리가 회사프로그램 [문의 관리] 탭으로 이전됨 (2026-07-25) — 시드·시즌 목록 하드코딩 제거.
  // soft-delete 컬럼 보장 (회사프로그램 initDB와 동일 ALTER — 어느 쪽이 먼저 떠도 안전)
  await pool.query(`ALTER TABLE bot_products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  tableReady = true;
}
```

- [ ] **Step 2: 조회에 deleted_at 필터** — `getStoreStatus()`의 SELECT를:

```js
const { rows } = await pool.query("SELECT name, status, price FROM bot_products WHERE deleted_at IS NULL ORDER BY status, name");
```

`/products` 페이지 목록 SELECT에도 `WHERE deleted_at IS NULL` 추가, `/products/delete`는 물리 DELETE → `UPDATE bot_products SET deleted_at = now() WHERE id = $1` 로 교체(물리삭제 금지).

- [ ] **Step 3: PRODUCTS_PAGE env 게이트** — `/products`(GET)·`/products/add`·`/products/save`·`/products/delete` 4개 라우트 최상단에:

```js
  if ((process.env.PRODUCTS_PAGE || "on").toLowerCase() === "off") {
    return res.status(410).send("판매현황 관리는 회사프로그램 [문의 관리] > 판매현황·가격 탭으로 이전되었습니다.");
  }
```

`/unmatched`(문의 로그)는 게이트 대상 아님 — 수정 금지.

- [ ] **Step 4: 검증** — `node --check products-store.js` + code모드 스모크(getStoreStatus 로드)
- [ ] **Step 5: 커밋 (push 금지)** — `git commit -m "판매현황 관리 회사프로그램 이전: 시드 하드코딩 제거 + deleted_at 필터 + PRODUCTS_PAGE 게이트"` + 푸터
- [ ] **Step 6: 독립 검토** (Fable) — "SOURCE 그대로일 때 봇 답변 무변화(시드 제거는 DB가 이미 36건 일치라 무영향)" 관점

---

### Task 5: 절차 문서 갱신 + 완료 보고 (직접)

- [ ] **Step 1:** `docs/문의시나리오_전환절차.md`에 "판매현황 탭 이전" 절 추가: ①봇 폴더 `git push`(정리 배포) ②탭2 검증 체크리스트(스펙 5절) ③검증 후 Render 톡톡봇 `PRODUCTS_PAGE=off`(배포 아님) ④이후 /products 접속 시 이전 안내만 표시
- [ ] **Step 2:** CLAUDE.md·메모리 갱신, 커밋
- [ ] **Step 3:** 대표 보고: 대조 결과(완전 일치)·화면 위치·검증 체크리스트·남은 대표 작업(봇 push, 스위치)

## Self-Review 결과
- 스펙 1절(탭 UI)=T2, 2절(DB)=T1·T4, 3절(API)=T1, 4절(봇 정리)=T4, 5절(검증)=T3·T5, 6절(금지)=Global Constraints — 전부 커버.
- 주의(실행자용): api()는 위치 인자. onclick 인자 `'${s}'`는 BOTPROD_STATUSES 고정 리터럴이라 안전. 품목명은 escapeHtml 필수(이미 반영). Task 2에서 기존 시나리오 카드들을 래핑할 때 **내용 무수정으로 이동만**.
