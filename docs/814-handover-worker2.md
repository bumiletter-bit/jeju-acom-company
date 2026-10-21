# #814 계산서 발행현황 — 워커2 인수인계(10/21 재부팅 전 · 문법 통과 상태)

## 끝난 것
- 계약 `docs/814-api.md`(워커1·총괄에 보냄 · 화면 = 워커1)
- 서버 `tax-invoices.js`(새 파일): 표 tax_invoices(ensureTable · dedup_key UNIQUE · 승인번호 부분 UNIQUE) · `upsertRow`(같은 메일 m: → a: 키 승격 · 사람이 누른 status/memo 보존 · PDF 없이 오면 기존 유지) · API 6개(GET /api/tax-invoices?month · /search?q · POST /:id/confirm|hold|reset · GET /:id/pdf · 전부 adminOnly) · 월 합계 대조 settleTotals(sion=대성(시온) · hyodon=효돈농협 · cj=박스×3100+cj_carryover) · audit tax_invoice_*
- `server.js` 2줄: `require('./tax-invoices.js').mount(app, {...})` (#776 메일 줄 바로 위)
- `agents/세미.js` 1줄: module.exports 에 `_fetchSettlements: fetchSettlements`
- 창구 `scripts/desk/invoice-month.js <YYYY-MM> [--dry] [--force] [--limit n] [--order id]` + `scripts/desk/pdf-unlock.py`(PyMuPDF · 비번 = 환경변수 PDF_PASSWORD · `python -P`)
- 검증 `scripts/verify-814-tax-invoice.js` 38/38(파서 손보기 전 기준 · 아래 「다음 할 일」 ③에서 다시)

## 실물 확인으로 알게 된 것(🔴 설계 바뀜)
- 계산서 메일 첨부는 PDF 가 아니라 **보안메일 HTML**: 홈택스 `NTS_eTaxInvoice.html`(srtk.hometax.go.kr 의 공식 JS 를 내려받아 풂) · 농협 `FirstBill_Tax.html`(JS 내장). 둘 다 비밀번호 칸에 사업자번호 → 브라우저 안에서 풀림.
- 화면 없는 크롬(Playwright)으로 3통 모두 풀고 칸 전부 읽힘 확인(값은 보고에 안 씀): 홈택스 「(제주조천점->…)」 uid 65020 · FirstBill 효돈 65391 · FirstBill 「제주감귤농협 조천지점」 65399. 공급가액+세액=합계 맞음.
- 🔴 **공급자 매핑**: 홈택스 「(제주조천점->…)」 = 품목 **택배서비스**(공급자 616-24-54059 · CJ 대리점으로 보임 · 시온 아님) · FirstBill 「제주감귤농협 조천지점」(616-82-10027 · 농산물대금 · 면세) = 시온 후보 · FirstBill 효돈(786-82-00357). → 공급자는 **계산서 안 사업자번호**로 가름(설정 `tax_invoice.suppliers {cj:[…],sion:[…],hyodon:[…]}`) — 이 세 번호가 맞는지 **대표 확인 필요**(총괄에 보고할 것).
- mail_index 분류: FirstBill 조천지점 메일은 supplier null(색인 match 에 「조천지점」 없음) · 다른 발행처(네이버·네이버클라우드·탐라OA·IT공작소 등)도 tax_invoice 로 잡힘 → 「기타」로 들어감(의도대로).
- FirstBill 승인번호 = 숫자+영문 24자 · 표 꼴 = 「작성일자 공급가액 세액 (수정사유) (비고) 날짜 금액 세액」 · 합계 = 「금액을 (청구) 함 n」 · 꼬리 글 「전자세금계산서로써」 때문에 종류는 처음 나오는 이름으로.

## 하다 만 것
- `scripts/desk/invoice-month.js`:
  - `parseInvoiceText` 표 꼴·영문 승인번호·종류 판정 고침 = 끝(실물 3통 맞음).
  - `supplierNameOf` · `supplierByBiz` · `openSecureHtml(file, pw)` 함수 = **써 두었으나 main 에 아직 안 이음**.
  - main 의 첨부 고르기는 아직 PDF 만(`att = … .pdf`) → HTML 첨부면 지금은 「첨부 PDF 없음(본문)」 길로 감.

## 다음 할 일 순서
1. main: 첨부 고르기 = PDF 먼저, 없으면 `.html/.htm`·text/html → `openSecureHtml(src, pw)` → `parseInvoiceText(text)` · `pdf`(page.pdf 로 만든 열람용 PDF)를 pdf_data 에 · 이름 = 원 이름.pdf. 끝나면 `_browser.close()`(main 끝 finally).
2. main: `row.supplier = supplierByBiz(parsed.supplier_bizno, cfg.suppliers) || mm.parsed.supplier || 'other'` · `row.supplier_name = supplierNameOf(text) || …`.
3. 검증 보강: verify-814 ④ 에 가짜 보안메일 HTML(비번 맞으면 iframe srcdoc 에 계산서 표 꼴 글을 넣는 작은 JS · 인터넷 없이) 1통 + 공급자 번호 매핑 + 표 꼴 파서 단위 시험(FirstBill·홈택스 꼴 가짜 글) → 다시 돌려 n/n.
4. 업무지식.md(★에이전트오피스) 「계산서 정리」 절 한 줄 + 창구 CLAUDE.md 4-1 줄은 총괄에게 문장 제안(문서는 총괄 몫).
5. 총괄 보고: 줄 수 · 검증 수치 · 대표 확인 3건(공급자 번호 3개 · 홈택스 제주조천점 = CJ 맞는지 · 설정 `tax_invoice` 값 = {pdf_password, suppliers}).

## 검증 명령
- `node --check tax-invoices.js scripts/desk/invoice-month.js server.js agents/세미.js`
- `PGLITE_DIR="C:/Users/전승범/AppData/Local/Temp/claude/C--Users-----OneDrive------------------/ecbcf2e3-dcf3-4d84-9c40-0db3395f9a01/scratchpad/pgl" node scripts/verify-814-tax-invoice.js` (pglite = 스크래치에 `npm i @electric-sql/pglite@0.2.17` · 재부팅 뒤 스크래치가 바뀌면 새로 설치)
- 실물 시험 스크립트 = 스크래치 `s814/sec814.js`(값 안 찍음 · MINE=1 일 때만 내 화면에 값) · 받은 첨부 = `%LOCALAPPDATA%\akkome\mail\65020-…, 65391-…, 65399-…`(재부팅 뒤 지워도 됨)

## 함정
- bash heredoc·`node -e` 안 역슬래시가 사라짐(정규식 깨짐) → 코드는 Write/Edit 로.
- `python -I` 는 사용자 설치 PyMuPDF 를 못 찾음 → `-P`.
- pglite 는 bytea 를 Uint8Array 로 줌 → PDF 응답은 Buffer.from.
- 실DB 쓰기는 가짜 검증만(표는 배포 initDB 때 · 설정 tax_invoice 는 총괄) · 실메일은 읽기만(attach 결과 report_files 줄이 남음 — 도구는 is_deleted 처리).
- 결과 보고에 금액·사람 이름 안 씀.
