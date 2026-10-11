# 문의 대화 창 서버 계약 (#658 · 2026-10-11)

톡톡 · 상품문의 · 주문문의를 문자 전용 창과 같은 꼴(목록 · 대화 · 보내기)로 쓰는 라우트. 모듈 = `inbox-threads.js`(server.js 에는 장착 한 줄) · 검증 = `scripts/verify-658-inbox.js`.
로그인한 직원 전원(authMiddleware). 기존 「확인 필요 문의」 칸(`/api/agent-office/desk/inbox`)과 문의 관리 화면 라우트는 그대로다.

**읽음은 두 가지다(교차 점검 손질 10/11)**: ①이 창의 「열면 읽음」 = 따로 둔 표식(표 `inbox_thread_reads`) — 열기만 해서는 `reviewed_at` 을 안 찍는다(「확인 필요 문의」 칸·아침 정리에서 조용히 사라지지 않게) ②`reviewed_at`([확인] 버튼과 같은 칸) = **이 창에서 답을 보내 성공했을 때만** 찍는다. 다른 화면에서 [확인]한 글은 이 창에서도 읽은 것으로 센다.

## 라우트

| 라우트 | 하는 일 |
|---|---|
| `GET /api/inbox/threads?ch=talk\|qna\|inquiry&scope=active\|open\|all&q=` | 목록. active = 안 읽은 것만 · **open = 답이 필요한데 아직 아무도 안 답한 것(읽음 무관 · 14일)** · all = 최근 30일 전부(톡톡 200 · 문의 300). 응답 `{ ok, ch, scope, days, threads[], counts, at }` |
| `GET /api/inbox/counts` | 탭 숫자만 `{ counts: { talk:{unread,open}, qna:{…}, inquiry:{…} } }` — unread = 이 창에서 안 읽은 대화 수 · **open = 답 안 한 대화 수(읽음 무관 · 문자의 staff_open 과 같은 뜻)** · 8초 기억 · 채널을 못 읽으면 그 채널만 null |
| `GET /api/inbox/threads/:ch/:id?peek=1` | 대화. **열면 읽음**(peek=1 이면 안 바꿈). 응답 `{ thread, messages[], draft, can_send, cannot_why, can_draft, post_error, limits }` |
| `POST …/:ch/:id/send { text, seen? }` | 보내기(확인 단계 없음 · 누르면 바로). 성공 `{ ok:true, state }` · 실패 `{ ok:false, error(한국어), code? }` |
| `POST …/:ch/:id/read` · `…/unread` | 읽음 · 안 읽음으로 되돌리기 |
| `POST …/talk/:id/draft` | 톡톡 초안 만들기(버튼을 눌렀을 때만 · AI 1회). `{ ok:true, draft, used_today, cap }` 또는 `{ ok:false, error, code:'no_draft' }` |

## 칸

- **threads[]** = `{ ch, id, title, sub, last_text, last_at, last_dir(in|out), unread, needs_reply, state, why, has_draft, can_send }` · 톡톡만 `sub_ch`(talk · kakao · mall).
  - `id`: 톡톡 = 가린 열쇠 16자(손님 식별값은 응답에 없음) · 상품문의·주문문의 = 문의 번호 글자.
  - `title`: 톡톡 = 「톡톡 손님 ab12」(열쇠 끝 4자 · 카카오 손님 · 자사몰 손님) · 문의 = 상품명. `sub`: 톡톡 = 품목 · 주문문의 = 옵션.
  - `state`: open(아무도 안 답함) · ai(봇이 답함) · staff(톡톡 — 직원이 답함) · done(문의 — 사람이 답함).
  - `needs_reply`: 답이 필요한데 아직 아무도(봇·직원) 안 답함 — 읽어도 그대로 true(scope=open · counts.open 이 세는 것 · 대화 응답의 thread 에도 있음).
  - `unread`: 톡톡 = 이 창에서 마지막으로 읽은 뒤(또는 [확인]한 줄 뒤)에 온 손님 글 수 · 문의 = 0/1. 「안 읽음으로」 되돌리면 1. 마지막 글에 직원이 이미 답했으면 0. **봇이 답한 글은 3일 · 안 답한 글은 14일**까지만 안 읽음으로 센다.
  - `why`: 봇이 안 답한 사유(봇이 넘긴 글 · 봇이 답한 뒤 30분 안에 다시 온 글 · 사진 · 자동 등록 실패 · 반품·교환·환불 분류 · 주문문의 분류명).
- **messages[]** = `{ id, direction(in|out), sender(customer|bot|staff), body, at }` + 톡톡 손님 글에 `image_url`(사진 · body 는 빈 글) · `note`(봇이 안 답한 사유) + 직원 답에 `by`(이름 · 없을 수 있음) · `via`(office = 에이전트 오피스에서 보냄 · center = 스마트스토어 센터에서 침).
  - 톡톡: 한 대화 여러 통. 🔴 봇·직원 답의 `at` 은 그 손님 글 시각이다(톡톡 기록에 답 시각이 따로 없음 — `limits.time_note`).
  - 상품문의·주문문의: 질문 1(+ 답 1). 주문문의 질문 = 제목 + 줄바꿈 + 내용.
- **draft** = 글 또는 null. 문의 = 수집할 때 만든 초안(안 답한 건만) · 톡톡 = [초안 만들기]로 만든 것(손님이 새 글을 보내면 null).
- **limits** = `{ max_chars(톡톡 1000 · 문의 2000), confirm:false, public(상품문의 true), pii_note, time_note }`.
- 시각은 전부 `2026-10-11T03:04:05Z` 글자.

## 보내기 규칙

- 판정 순서: 보낼 수 없는 대화(이미 답함 409 `already` · 카카오 등 400) → `seen` 대조 → 보내기. `seen` 은 **문자열일 때만** 서버 초안과 글자 대조 → 다르면 409 `code:'draft_changed'` + `draft`(문자 창 send-draft 와 같은 뜻 · 초안이 없으면 빈 글 `''` 과 대조).
- **톡톡**: `talk_outbox` 에 넣고 배달 결과를 최대 30초 기다린다.
  - 400 = 빈 글 · 1,000자 넘음 · 결제 낱말(계좌·입금·이체·송금…) · 카카오/자사몰 손님 · 마지막 대화 7일 넘음(`cannot_why` 와 같은 글)
  - 409 `duplicate` = 같은 손님에게 같은 글이 아직 가는 중(10분까지)이거나 1분 안에 이미 나감 · 502 `send_failed` = 톡톡봇·네이버가 거절(사유 글 포함)
  - 504 `timeout_cancelled` = 30초 안에 못 나가 취소함(다시 보내도 됨) · 504 `timeout_unknown` = 나가는 중인데 결과를 못 받음(다시 보내면 두 번 나갈 수 있음)
  - 성공하면 그 대화는 읽음 · 초안 지움 · 톡톡봇은 직원이 답한 것으로 보고 30분 조용해진다.
- **상품문의 · 주문문의**: 기존 등록 함수(`naverPostQnaAnswer` · `naverPostInquiryAnswer`)를 그대로 부른다.
  - 409 `already` = 이미 답변함(「수정은 스마트스토어 센터에서」) · 409 `busy` = 다른 사람이 지금 등록하는 중(집기 칸 `posting_at` · 2분 넘으면 풀림)
  - 403 `pii` = 개인정보 검사에 걸림(사유 글에 걸린 글자) — **상품문의는 전화번호·이메일·주소·긴 숫자 전부** · **주문문의는 전화번호만 뺌**(비공개 · 대표 2026-10-11)
  - 400·404 = 등록 함수의 사유 글(`post_failed`) · **502 `post_failed` = 네이버·중계서버가 거절하거나 오류(그쪽의 401·403·5xx 포함 · `upstream` 에 그 상태값)** — 이 라우트는 바깥 서비스 때문에 401 을 내지 않는다(화면이 401 을 로그인 만료로 읽으므로)
- 보내기 성공마다 audit 1건(채널 · 열쇠 · 글자 수 — 글 내용은 안 남김).

## 설정 · 표

- 초안 하루 상한 = `agent_office_config 'inbox_threads'` `{ "draft_daily_cap": 50 }`(0 = 상한 없음) · 넘으면 429 `draft_cap`. 그날 쓴 횟수 = `'inbox_threads_state'`.
- 첫 요청 때 만드는 것(없는 것만 · 잠금 대기 3초 · 실패하면 1분 뒤 다시): `naver_qnas.posting_at` · `naver_inquiries.posting_at` · 표 `inbox_thread_drafts(ch, tkey, body, src_id, made_by, made_at)` · 표 `inbox_thread_reads(ch, tkey, read_at, read_by, forced_unread)`.
- 알고 둘 틈(종전부터): 네이버 등록은 성공했는데 그 뒤 DB 기록이 실패하면 다음 수집 때까지 「안 답함」으로 보여 다시 등록할 수 있다 · 문의 관리 화면의 등록 라우트는 집기 칸(`posting_at`)을 보지 않는다(두 화면에서 같은 순간 누르는 경우).
- 톡톡 초안은 회사프로그램의 자동답변 엔진(문자 갈래 = 이모지·꼬리 없는 짧은 글)을 쓴다 — 톡톡봇의 답 엔진과는 다른 것이라 말투가 조금 다를 수 있다(직원이 고쳐 보내는 초안).

## 안 되는 것

카카오·자사몰 손님에게 보내기 · 이미 답한 문의 고치기 · 톡톡 손님의 이름·번호·구매이력(네이버가 식별값만 줌) · 톡톡 사진 보내기.
