# #739 카페24 옵션 시험·이름 바꾸기 — 러너 계약 (워커1 · 2026-10-18)

> 코드 = server.js `// #739 시작` ~ `// #739 끝`(cafe24OptRun) · 러너 = 기존 `cafe24_product_request` → `cafe24_product_result` 의 **`opt`** 칸(10초 틱) · 검증 = `node scripts/verify-739-cafe24-option.js` · 근거 = docs/737-cafe24-option-api.md(워커3).

| action | 입력 | 결과(out.opt) |
|---|---|---|
| `test_product_create` | — | 시험 상품 「테스트 옵션(시험용 · 구매 금지)」(진열·판매 F · 1000원 · 옵션 테스트A·B) · 있으면 재사용 · 새로 24시간 1개 · 번호 = 설정 `cafe24_test_products` |
| `options_get` / `variants_get` | `{ product_no }` | options{ groups[{option_name, values[]}], raw(원문), option_type, option_list_type } / variants[{ code, opts, add, selling, display }] |
| `options_put` | `{ product_no, options, original_options }` | **시험 상품만** · 원문 꼴로 PUT · 전·후 품목 대조(kept·removed·added·changed·renamed) |
| `option_rename` | `{ product_no, group?(=option_name), from, to, order_id?, revert? }` | PUT 통과 = **즉시 `ok:true · pending_confirm:true · put_at · expect{group, from, to}`** + variants_before · options_before · revert(반대 요청) · PUT 오류 = ok:false(code·reason·detail·variants_unchanged) |

- 🔴 실측(10/18 시험 상품 120): **값 추가 PUT = 422 「The number of Existing option value and edited option value is wrong.」**(API 로 안 됨 확정) · **이름 바꾸기 = 된다 · 품목 코드·추가금·판매·진열 유지** · 단 **읽기 반영이 약 1~1.5분 늦고 그 사이 옛값·새값이 오락가락** → 러너는 기다리지 않고 pending_confirm 으로 돌려줌. **확인은 창구 도구(mall-option.js) 몫** = options_get 15초 간격 최대 3분 · 새 이름이 2번 연속 보이면 성공 → variants_get 으로 품목이 variants_before 와 같은지(코드·추가금·판매·진열) · 3분 안에 안 정해지면 「반영 지연 — 몇 분 뒤 확인」(실패 아님).
- PUT 꼴 = GET 원문 옵션 객체 깊은 복사 위에 option_text 만(그림·색·표시 꼴 보존) · 텍스트만 꼴(문서 예시)은 우리 상품에서 422 「Existing option value does not exist.」 · 옵션 GET·PUT 에만 `X-Cafe24-Api-Version: 2026-09-01`(cafe24.js extraHeaders · 필요 여부 미확정).
- 운영 상품 option_rename = 설정 `cafe24_option_rename.enabled === true` 일 때만(기본 꺼짐) · 옵션 삭제·재등록 길 없음(품목 전부 지워짐).
