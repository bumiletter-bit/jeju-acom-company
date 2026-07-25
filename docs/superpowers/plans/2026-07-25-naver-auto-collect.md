# 네이버 자동수집 타이머 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정산/주문/취소·반품/문의 4종 자동수집 타이머(DB 설정·화면 관리·전부 기본 OFF) + 송장변환 직전 취소 재확인 안전장치.

**Architecture:** server.js에 60초 틱 스케줄러 1개(한 틱에 가장 밀린 수집기 1개만 실행 — 몰림 방지). 설정·상태는 naver_auto_collect(DB)만 — 재시작 복원. 수집기는 전부 읽기 전용(naverRelay 경유, callWithRetry 재사용). 화면은 [데이터관리] 카드.

**Tech Stack:** Node/Express + PostgreSQL, naver-relay.js, 기존 notifyTelegram·writeAudit.

**Spec:** `docs/superpowers/specs/2026-07-25-naver-auto-collect-design.md` (대표 승인)

## Global Constraints

- 전부 기본 OFF 유지 · 주기/시각 하드코딩 금지(DB만) · 쓰기 API 호출 금지(읽기 전용) · convertDataSmart/naverFetchInvoiceOrders 수정 금지.
- 호출 간 350ms + 429 지수 백오프(기존 naverCallWithRetry 패턴 재사용 — Task 1에서 전역 함수로 추출).
- 텔레그램은 기존 notifyTelegram 경유. inquiry 문의 내용(PII 가능)은 DB만, 텔레그램엔 건수만.
- 배포: v5.9.60 / app.js 캐시 v=267 / CHANGELOG. `npm run deploy`(540000ms+), 사전 node --check 2종. 배포는 대표 확인 후.
- 커밋 푸터: Co-Authored-By / Claude-Session (기존 커밋 참고). 테스트 프레임워크 없음 — node --check + 스크립트 검증.

---

### Task 1 (직접·컨트롤러): DB + 스케줄러 + 수집기 4종 + canceled-since API

**Files:** Modify `server.js` — ①initDB(naver_auto_collect 시드 뒤) ②naverFetchInvoiceOrders 근처(수집기·스케줄러) ③라우트 블록(canceled-since)

Step 1: initDB 추가 (스펙 1절 SQL 그대로 — ALTER 2개, UPDATE 시드, naver_settle_snapshot·naver_inquiries CREATE).

Step 2: `naverCallWithRetry(req)` 전역 헬퍼 추출 — naverFetchInvoiceOrders 내부의 callWithRetry와 동일 로직(429 → 1s→2s→…16s 최대 5회, 최종 실패 텔레그램 1회). 기존 함수 내부는 무수정(내부 로컬 함수 유지 — 수정 금지 원칙), 새 전역은 수집기 전용.

Step 3: 수집기 4종 (스펙 3절 표 그대로):
- `collectSettlement()` — daily 3일 조회(pageSize 1000, 페이지 순회 상한 10) → naver_settle_snapshot INSERT + 30개 초과분 DELETE(스냅샷 테이블 정리는 soft-delete 예외로 허용: 원본이 네이버에 있음) → 텔레그램 요약.
- `collectOrderNew()` — last-changed-statuses(lastChangedFrom=체크포인트, lastChangedTo=now) → `lastChangedType==='PAYED'` 건수 → N>0 텔레그램 → 체크포인트 갱신(agent_office_config `naver_order_checkpoint`).
- `collectClaim()` — 같은 API, 체크포인트 `naver_claim_checkpoint`, type에 CANCEL/RETURN/EXCHANGE 포함 건수 → N>0 텔레그램.
- `collectInquiry()` — `GET /external/v1/pay-user/inquiries` (파라미터: startSearchDate/endSearchDate 최근 2일, page 순회 — 구현 전 포럼/문서로 최종 확정, 확정 불가 시 이 수집기만 '지원 예정' 처리하고 나머지 3종 진행) → inquiry_id 신규분만 naver_inquiries INSERT → 신규 N>0 텔레그램(건수만).
- 응답 파싱은 기존 pick(중첩 방어) 패턴 재사용.

Step 4: 스케줄러 — `setInterval(naverAutoCollectTick, 60*1000)`:
```
tick: if (실행중잠금) return; if (!naverRelay.configured()) return;
rows = SELECT * FROM naver_auto_collect;
due 필터: settlement → run_at_time 앵커(KST 오늘 HH:MM 지났고 last_run_at < 오늘 그 시각) / 나머지 → last_run_at IS NULL OR (now-last_run_at) >= interval_min분;
enabled&&due 중 가장 오래 밀린 1개만 실행 → UPDATE last_run_at=now, last_status, last_error;
실패 시 notifyTelegram('🛰️ [키] 자동수집 실패 — 사유').
```

Step 5: `GET /api/agent-office/naver/canceled-since?since=ISO` (adminOnly) — last-changed-statuses(since~now) → CANCEL/RETURN 계열 productOrderId 배열 반환 `{ok, canceled:[...ids], checked_from, checked_to}` (PII 없음).

Step 6: `node --check server.js` + 로컬 스모크(수집기 함수를 로컬 서버에서 1회 수동 호출 — 타이머 OFF 상태 무해) → 커밋.

### Task 2 (위임 Haiku + Sonnet 검수): 타이머 설정 API 3종

**Files:** Modify `server.js` — bot-product 라우트 뒤.
**Produces:** 전부 authMiddleware+adminOnly+audit(targetType 'naver_auto_collect', source 'naver-timer'):
```js
app.get('/api/agent-office/naver/auto-collect', authMiddleware, adminOnly, async (req, res) => {
    try {
        const r = await pool.query(`SELECT key, enabled, interval_min, run_at_time, last_run_at, last_status, last_error FROM naver_auto_collect ORDER BY key`);
        res.json({ timers: r.rows });
    } catch (err) { handleAdminErr(res, err); }
});
app.put('/api/agent-office/naver/auto-collect/:key', authMiddleware, adminOnly, async (req, res) => {
    try {
        const cur = await pool.query('SELECT * FROM naver_auto_collect WHERE key=$1', [req.params.key]);
        if (cur.rows.length === 0) throw { status: 404, message: '해당 타이머가 없습니다' };
        const before = cur.rows[0];
        const sets = ['updated_at = NOW()']; const params = [];
        if (req.body.enabled !== undefined) { params.push(!!req.body.enabled); sets.push(`enabled=$${params.length}`); }
        if (req.body.interval_min !== undefined) {
            const m = parseInt(req.body.interval_min);
            if (!Number.isFinite(m) || m < 5 || m > 1440) throw { status: 400, message: '주기는 5~1440분 사이로 입력하세요' };
            params.push(m); sets.push(`interval_min=$${params.length}`);
        }
        if (req.body.run_at_time !== undefined) {
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(req.body.run_at_time))) throw { status: 400, message: '실행 시각은 HH:MM(24시간) 형식으로 입력하세요' };
            params.push(String(req.body.run_at_time)); sets.push(`run_at_time=$${params.length}`);
        }
        if (params.length === 0) throw { status: 400, message: '수정할 내용이 없습니다' };
        params.push(req.params.key);
        const r = await pool.query(`UPDATE naver_auto_collect SET ${sets.join(', ')} WHERE key=$${params.length} RETURNING *`, params);
        await writeAudit({ action: 'update', targetType: 'naver_auto_collect', targetId: null, changes: { before, after: r.rows[0] }, source: 'naver-timer', actor: adminActor(req) });
        res.json({ message: '저장되었습니다', timer: r.rows[0] });
    } catch (err) { handleAdminErr(res, err); }
});
app.put('/api/agent-office/naver/auto-collect-all', authMiddleware, adminOnly, async (req, res) => {
    try {
        const on = !!req.body.enabled;
        await pool.query('UPDATE naver_auto_collect SET enabled=$1, updated_at=NOW()', [on]);
        await writeAudit({ action: on ? 'all_on' : 'all_off', targetType: 'naver_auto_collect', targetId: null, changes: { after: { enabled: on } }, source: 'naver-timer', actor: adminActor(req) });
        res.json({ message: on ? '전체 타이머를 켰습니다' : '전체 타이머를 껐습니다' });
    } catch (err) { handleAdminErr(res, err); }
});
```

### Task 3 (위임 Sonnet + Sonnet 검수): [데이터관리] 화면 카드

**Files:** Modify `public/index.html`(#naver-connect-card 아래), `public/app.js`.
- 카드 `#naver-timer-card`(display:none, admin에서 표시 — naver-connect-card와 같은 방식으로 updateUserUI에 1줄 추가): 헤더 "⏱️ 자동수집 타이머" + [전체 ON] [전체 OFF] 버튼. 표: 이름(정산/주문/취소·반품/문의) · ON/OFF 체크박스 · 주기 입력(분; settlement는 시각 HH:MM 입력) · 마지막 수집(로컬시각) · 상태(✅/❌+last_error 축약).
- 라벨 매핑 `{settlement:'정산(하루 1회)', order:'주문(신규 알림)', claim:'취소·반품(알림)', inquiry:'문의'}`. api()는 위치 인자. 데이터관리 페이지 진입 시 렌더(switchPage 'data' 분기에 호출 추가). [연결 테스트]·정산 조회 무수정.

### Task 4 (직접): 송장변환 직전 취소 재확인 (프론트)

**Files:** Modify `public/app.js`.
- `loadNaver()` 성공 시 `naverInvoiceLoadedAt = new Date().toISOString()` 기록(전역 let).
- `invoice-merge-btn` 클릭 핸들러를 async로 바꾸고 첫 줄에 `await recheckNaverCancellations();` 추가 (핸들러 나머지·convertDataSmart 무수정).
- `recheckNaverCancellations()`: 네이버발 데이터 없으면 즉시 리턴 → `canceled-since?since=` 호출 → canceled 배열을 Set으로 → `invoiceDataSmart = invoiceDataSmart.filter(r => !set.has(r._pid))` → N>0이면 msg에 "🛡️ 그 사이 취소 N건 자동 제외" + loadedAt 갱신. 실패 시 msg에 경고만, 변환 진행.

### Task 5 (직접): 배포 v5.9.60 + 최종 리뷰 + 문서

- version/캐시(v=267)/CHANGELOG → node --check 2종 → Fable 전체 리뷰(기존 송장변환 무회귀 중점) → **대표 확인 후** `npm run deploy` → CLAUDE.md("재확인 금지" 문구 대체 포함)·메모리 갱신 → 완료 보고(사용법: 데이터관리에서 타이머 ON).

## Self-Review
- 스펙 1↔T1, 2↔T1, 3↔T1, 4↔T1+T4, 5↔T2+T3, 6·7↔Global/T5 — 전부 커버. inquiry 파라미터 미확정 리스크는 T1에 부분 배포 대비 명시.
