# SMSGate(회사폰 전달 앱) 연동 스펙 — #610-A

> 작성 2026-10-10 · 워커2 · **cloud 모드 기준**(대표 확정) · private 서버는 끝 절(추후용).
> 근거 = 공식 문서 원문(마크다운)·앱 저장소 원문을 직접 내려받아 읽음(요약 모델 경유 아님).
> - 문서 저장소 `android-sms-gateway/docs-web` master `docs/…`(= docs.sms-gate.app)
> - 앱 저장소 `capcom6/android-sms-gateway` master: `app/src/main/assets/api/swagger.json`(OpenAPI) · `AndroidManifest.xml` · `modules/receiver/SmsContentObserver.kt` · `MmsContentObserver.kt`
> - 릴리스: GitHub API `releases`
>
> 표기: **[문서]** 공식 문서 문장 · **[OpenAPI]** swagger.json · **[소스]** 앱 코드 · **[미확인]** 근거 못 찾음(실기기 시험으로 확정).
> 🔴 실기기 확인 전 숫자·동작은 문서상 값이다. 시험 결과가 다르면 이 문서를 고친다.
> 🔵 2026-10-10 2차·3차: 서버 구현(`sms/index.js` · `sms/selfcheck.js` · server.js)을 읽고 **10절 「서버 구현 현황」** 을 더함(3차 = v5.9.480 총검토 반영분). 1~9절은 앱 쪽 사실, 10절은 우리 서버가 실제로 하는 일.

## 0. 한눈에

| 항목 | 값 |
|---|---|
| 앱 | SMS Gateway for Android(SMSGate) · 패키지 `me.capcom.smsgateway` · Apache-2.0 |
| 최신 안정판 | **v1.77.1**(2026-10-01) · `app-release.apk` 12,646,990 바이트(약 12.1MB). v1.77.2 는 사전 배포판(쓰지 않음) |
| API 주소(cloud) | `https://api.sms-gate.app/3rdparty/v1` |
| 인증 | HTTP Basic(앱이 만든 아이디·비밀번호). JWT 도 있으나 쓰지 않음 |
| 폰 → 우리 서버 | **폰이 직접** 우리 https 주소로 POST(webhook). 앱 회사 서버를 거치지 않음 [문서: 「The device includes these headers」 · ping 흐름도 Device → Webhook] |
| 우리 서버 → 폰 | 우리 서버가 api.sms-gate.app 에 POST → 서버 DB 저장 → FCM 푸시(주)/SSE(보조) → 폰이 가져가 발송. 안전망 = 폰이 15분마다 폴링 [문서] |
| 요금 | cloud 「Completely free」 · 하루 1만 건 넘으면 지원에 알리라는 권고 · 새 cloud 사용자 유료화 가능성 문구 있음 [문서 pricing] |

## 1. webhook — 공통 봉투

모든 이벤트가 같은 봉투로 온다 [OpenAPI `WebHookEvent` · required 5개].

```json
{
  "deviceId": "ffffffffceb0b1db0000018e937c815b",
  "event": "sms:received",
  "id": "Ey6ECgOkVVFjz3CL48B8C",
  "webhookId": "LreFUt-Z3sSq0JufY9uWB",
  "payload": { }
}
```

- `id` = 이 webhook 사건의 고유 id → **중복 제거 열쇠**(재시도·여러 번 도착 대비) [문서 「Deduplicate based on `id`」].
- `webhookId` = 등록한 webhook 의 id.
- 시각 값은 폰 **현지 시각 + 오프셋** ISO 문자열(예 `2024-06-22T15:46:11.000+07:00`) → 회사폰이면 `+09:00`. `new Date()` 로 읽으면 된다.
- 응답: **30초 안에 2xx** 를 안 주면 재시도 [문서]. 받자마자 200 을 주고 처리는 뒤에서.

### 1-1. 이벤트별 payload (문서 예시 그대로)

**sms:received** — 받은 문자. 여러 조각 긴 문자는 다 모인 뒤 1회 [문서].
```json
{ "messageId": "abc123", "message": "Android is always a sweet treat!",
  "sender": "6505551212", "recipient": "+1234567890", "simNumber": 1,
  "receivedAt": "2024-06-22T15:46:11.000+07:00" }
```
- `messageId` = **내용 기반 ID · 고유 보장 없음**(같은 글이면 같을 수 있음) [문서 reading-messages] → DB 고유 열쇠로 쓰지 말 것. 중복 제거는 봉투 `id`.
- `sender` = 손님 번호. 형식은 통신사가 준 그대로(국내는 `01012345678` 또는 `+8210…` — **[미확인]** → 서버에서 숫자만 남겨 `010…` 로 정규화).
- `recipient` = 회사폰 번호 · **null 가능**(READ_PHONE_STATE 없음·통신사 미제공) [문서]. `simNumber` null 가능.

**sms:sent** — API 로 보낸 글이 통신사에 넘어감. 긴 글은 전 조각 발송 뒤 1회.
```json
{ "messageId": "msg-456", "sender": "+1234567890", "recipient": "+9998887777",
  "simNumber": 1, "partsCount": 1, "sentAt": "2026-02-18T02:05:00.000+07:00" }
```
- `messageId` = **보내기 API 가 돌려준 id 와 같다** [문서 webhooks: 「`messageId` refers to the outgoing message ID returned by `POST /3rdparty/v1/messages`」].
- `sender` = 회사폰 번호(null 가능) · `recipient` = 손님 번호.

**sms:delivered** — 손님 폰 수신 확인. **조각마다 1번씩** 온다(같은 `messageId`) [문서].
```json
{ "messageId": "msg-789", "sender": "+1234567890", "recipient": "+9998887777",
  "simNumber": 1, "deliveredAt": "2026-02-18T02:10:00.000+07:00" }
```

**sms:failed** — 어느 조각이든 실패하면 1회(다른 조각은 갔을 수 있음).
```json
{ "messageId": "msg-000", "sender": "+1234567890", "recipient": "+4445556666",
  "simNumber": 3, "failedAt": "2026-02-18T02:15:00.000+07:00", "reason": "Network error" }
```
- `reason` 에 `RESULT_ERROR_LIMIT_EXCEEDED`(발송 한도) · `RESULT_ERROR_GENERIC_FAILURE`(잔액·망·유심) · `RESULT_NO_DEFAULT_SMS_APP` · `RESULT_RIL_MODEM_ERR` 등이 온다 [문서 faq/errors].
- status-tracking 문서의 옛 예시에는 `phoneNumber` 필드도 보인다 → 파서는 `recipient || phoneNumber`.

**sms:cancelled** — 대기 중 취소됨. `{ messageId, sender, recipient, simNumber, cancelledAt }`.

**mms:received** — MMS 「도착 알림」(내려받기 전 · 메타만 · 글·사진 없음).
```json
{ "messageId": "mms_12345abcde", "sender": "6505551212", "recipient": "+1234567890",
  "simNumber": 1, "transactionId": "T1234567890ABC", "subject": "Photo attachment",
  "size": 125684, "contentClass": "IMAGE_BASIC", "receivedAt": "2025-08-23T05:15:30.000+07:00" }
```
- `messageId` = 통신사 ID(없으면 transactionId) · `subject`·`contentClass` null 가능.

**mms:downloaded** — 폰에 다 내려받아진 뒤. 글 + 사진.
```json
{ "messageId": "mms_12345abcde", "sender": "6505551212", "recipient": "+1234567890",
  "simNumber": 1, "body": "Hello! Here is the photo.", "subject": "Photo attachment",
  "attachments": [ { "partId": 1, "contentType": "image/jpeg", "name": "photo.jpg",
                     "size": 125684, "data": "/9j/4AAQ..." } ],
  "receivedAt": "2025-08-23T05:15:35.000+07:00" }
```
- 🔴 `messageId` = 폰 내부 `_id`(문서 필드 설명) → **`mms:received` 의 messageId 와 다르다**(예시 JSON 은 같게 적혀 있으나 필드 설명이 정본). 두 이벤트를 messageId 로 잇지 말고 **sender + 시각 근접**으로 묶는다.
- `attachments[].data` = Base64 · **null 가능** · `size` null/0 가능 · `name` null 가능 · 필수는 `partId`·`contentType` 뿐 [OpenAPI `MmsDownloadedAttachment`].
- `body` null 가능(사진만 온 경우).
- 첨부에 `text/plain`·`application/smil` 조각이 섞여 올 수 있음 **[미확인]** → `contentType` 이 `image/` 로 시작하는 것만 사진으로.

**system:ping** — 생존 신호. `payload.health` = 헬스 응답 꼴 [문서 webhooks·health]. OpenAPI 는 빈 object 로만 정의 → 필드를 믿고 파싱하지 말고 **「왔다」는 사실 + 시각만** 쓴다. (헬스 꼴 참고: `status` pass/warn/fail · `checks` 에 `battery:level`(25% 미만 warn · 10% 미만 fail) · `battery:charging` · `connection:status` · `messages:failed`.) cloud 모드 ping 에 어떤 checks 가 실리는지 **[미확인]**.
- 켜는 곳: 앱 Settings → Ping 에서 간격(초). 켜면 폰이 서버를 그 간격으로 폴링도 한다(기본 15분을 덮어씀) [문서 ping].

**app:started** — 앱(서비스) 시작.
```json
{ "simCards": [ { "slotIndex": 0, "simNumber": 1, "phoneNumber": "+79990001234",
                  "carrierName": "MTS", "iccid": "897010112233445" } ] }
```

**묶음 이벤트**(`sms:batch:received` · `mms:batch:received` · `mms:batch:downloaded` · `sms:batch:data-received`) — 받은함 다시 읽기(`POST /inbox/refresh`) 때만. `payload.messages[]`(100건까지 · 시간순). 평소엔 안 온다 → 1단계에서는 등록하지 않는다.

### 1-2. 직원이 폰에서 손으로 보낸 문자 — 🔴 **올라오지 않는다(소스 근거)**

- [소스] `AndroidManifest.xml` 의 발송 결과 수신기는 앱 자신의 `me.capcom.smsgateway.ACTION_SENT / ACTION_DELIVERED / ACTION_MMS_SENT` 만 받는다 = **앱이 API 로 보낸 글의 결과**.
- [소스] `SmsContentObserver.kt` 는 `content://sms` 를 지켜보지만 읽는 곳은 `Telephony.Sms.Inbox`(받은함)뿐. 보낸함(`content://sms/sent`)을 읽는 코드가 없다. `MmsContentObserver.kt` 도 `msg_box = 1`(받은함)만.
- [문서] `sms:sent`/`delivered`/`failed` 시험법 = 「Send an SMS … **from the app**」.
- [문서] `/inbox` 조회는 받은 글만 · cloud 모드에서는 동기 조회 자체가 없음(「GET 으로 읽기 지원 안 함」).
- 결론: **삼성 메시지에서 직원이 직접 친 답은 어떤 webhook 으로도 오지 않는다.** → 「직원 답변됨」 상태를 전달 앱으로는 못 만든다. 실기기 시험 c 로 한 번 더 확인하되, 설계는 「안 온다」를 기본으로:
  - 안 A: 직원 답은 **에이전트 오피스 「문자」 카드에서만** 보낸다(서버가 API 로 발송 → 상태 자동).
  - 안 B: 폰에서 답한 뒤 카드에서 [처리함].
  - 안 C: 직원 몫으로 넘긴 대화는 봇이 **사람이 풀 때까지 침묵**(쿨다운이 아니라 잠금) — 이중 답변을 구조로 막음. ← 워커2 권고(A 와 함께).

### 1-3. 서명 검증

[문서 webhooks 「Payload Signing」]
- 헤더 `X-Signature`(16진 소문자 HMAC) · `X-Timestamp`(**유닉스 초 · UTC**).
- 식: `HMAC-SHA256(key = 서명 키, message = 원문 body 문자열 + X-Timestamp 문자열)` → hex. **body 가 먼저, timestamp 가 뒤 · 구분자 없음.**
- 원문 body = **JSON 파싱 전 바이트 그대로**. Express 에서는 이 라우트만 `express.raw({ type: 'application/json', limit: '25mb' })` 로 받고 `req.body.toString('utf8')` 로 서명 → 그 뒤 `JSON.parse`.
- 서명 키 = 첫 요청 때 앱이 무작위 생성 · 앱 **Settings → Webhooks → Signing Key** 에서 보고 바꿈. 🔴 **폰에만 있는 값**(웹 대시보드·cloud API 로 못 다룸 — OpenAPI 「Must not be used with Cloud Server」) → 설치 때 폰 화면에서 읽어 Render env 로.
- 시각 검사: 문서 권고 ±5분. 🔴 단 **재시도는 최대 약 2일 뒤에도 온다** — 재시도 요청의 `X-Timestamp` 가 처음 시각인지 재전송 시각인지 **[미확인]**. → **서버 구현 = 서명 일치 + 시각 차 3일 미만**(재시도를 버리지 않음 · 10절).

```js
// 문서의 JavaScript 예시 그대로
const crypto = require('crypto');
function verifySignature(secretKey, payload, timestamp, signature) {
  const message = payload + timestamp;
  const expected = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  const sig = String(signature).trim().toLowerCase();
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
}
```

### 1-4. 재시도

[문서] 2xx 를 30초 안에 못 받으면: 10초 뒤 → 20초 → 40초 … 두 배씩 · 기본 **14회(약 2일)** · 횟수는 앱 Settings → Webhooks 에서 변경. 인터넷이 없으면 붙을 때까지 기다림(기본 「Require Internet connection」 켜짐).
- 의미: 우리 서버 배포 중(약 2분)·렌더 점검 때 온 문자는 **잃지 않고 늦게 온다**. 반대로 같은 사건이 두 번 올 수 있다 → 봉투 `id` 로 중복 제거 필수.
- 🔴 4xx·5xx 를 주면 그 사건도 2일간 재시도한다(문서는 2xx 아니면 전부 재시도). → **서버 구현 = 서명 실패 401 · 키 없음 503 을 그대로 둠**(키를 잘못 넣은 날의 문자가 버려지지 않고 키를 고치면 뒤늦게 들어옴) + 뒤늦게 들어온 글(문자 시각이 30분 넘게 지남)은 봇이 답하지 않고 직원 몫. 모르는 이벤트는 200 + 무시.

## 2. 보내기 API

`POST https://api.sms-gate.app/3rdparty/v1/messages` · `Authorization: Basic base64(아이디:비밀번호)` · `Content-Type: application/json`

```json
{
  "id": "akm-20261010-000123",
  "textMessage": { "text": "안녕하세요, 제주아꼼이네입니다." },
  "phoneNumbers": ["+821012345678"],
  "ttl": 3600,
  "withDeliveryReport": true,
  "priority": 0
}
```

| 필드 | 뜻 [문서 sending-messages · OpenAPI `smsgateway.Message`] |
|---|---|
| `id` | 우리가 정하는 고유 id(36자까지 · 없으면 자동). **같은 id 로 다시 보내면 409** → 중복 발송 방지 열쇠로 쓴다 |
| `textMessage.text` | 글(1~65535자). `message` 는 옛 필드(폐기 예정) |
| `phoneNumbers` | 1~100개. **E.164 꼴 필수**(`+8210…`) — 아니면 400. 쿼리 `?skipPhoneValidation=true` 로 검사 끔 가능. 국내 `010…` 그대로 보내면 받아지는지 **[미확인]** → `+82` 로 바꿔 보낸다 |
| `ttl` | 초(최소 5). 그 안에 못 보내면 실패 처리. `validUntil`(RFC3339)과 둘 중 하나. 🔴 **꼭 넣는다** — 폰이 꺼져 있다가 다음 날 켜지면 어제 답이 뒤늦게 나가는 것을 막음(봇 답 = 600~1800초 권고) |
| `withDeliveryReport` | 기본 true. `RESULT_ERROR_GENERIC_FAILURE` 가 잦으면 false 로 [문서] |
| `priority` | -128~127 · 기본 0. **100 이상이면 앱의 발송 상한·지연·근무 시간을 건너뜀** → 봇 답은 0 으로 두어 상한이 먹게 한다 |
| `simNumber` | 1~3 · 안 넣으면 기본 유심 |
| `scheduleAt` | 미래 시각(UTC) 예약 |
| `deviceId` | 계정에 폰이 여럿일 때 지정(21자) |
| `isEncrypted` | 종단 암호화(쓰면 번호 검사 생략 · 1단계 미사용) |
| 쿼리 `deviceActiveWithin` | 최근 N시간 안에 살아 있던 폰만 대상(0 = 끔) |

**응답** [OpenAPI]: `202` + 헤더 `Location`(상태 조회 주소) + 본문(`smsgateway.GetMessageResponse`):
```json
{ "id": "akm-20261010-000123", "deviceId": "PyDmBQZZXYmyxMwED8Fzy", "state": "Pending",
  "isHashed": false, "isEncrypted": false, "createdAt": "…",
  "recipients": [ { "phoneNumber": "+821012345678", "state": "Pending" } ], "states": {} }
```
- 본문 `id` == 나중에 오는 `sms:sent`/`delivered`/`failed` 의 `payload.messageId` [문서].
- 오류: 400(형식) · 401(인증) · 403 · **409(같은 id 이미 있음)** · 500 · **503(대기열 한도 — 「ensure device is online」)**. 오류 본문 `{ code, message, data }` 또는 `{ "error": "QueueLimitExceeded", "message": "queue limits exceeded: …" }`.
- cloud 대기열 규칙: 24시간 넘게 못 보낸 글이 있으면 새 글을 503 으로 거절 [문서] → ttl 을 넣으면 생기지 않는다.

**상태**: `Pending → Processed(폰이 받음) → Sent(통신사 접수) → Delivered` · `Failed` · `Cancelling/Cancelled`.
- 조회 `GET /messages/{id}` → `{ id, state, states{상태:시각}, recipients[{phoneNumber,state,error}] }`.
- 취소 `DELETE /messages/{id}`(Pending 일 때만 · 아니면 409 · 없으면 404).
- 🔴 임시 오류 뒤에는 안드로이드가 끝 상태를 안 알려 줄 수 있어 **Sent 에 머문 채 실제로는 도착**했을 수 있다 [문서] → 「Delivered 가 없으면 실패」로 보지 말 것. 성공 판정 = `sms:sent`.
- cloud 서버는 처리된 글 본문을 1분 안에 해시로 바꾼다 [문서 privacy] → 조회 응답의 번호가 「SHA256 앞 16자」로 올 수 있다(`isHashed`). 번호는 우리 DB 가 `id` 로 기억한다.

**긴 글(국내 LMS)** — 🔴 **[미확인 · 시험 필수]**
- [문서] 앱은 GSM-7 160자 / 유니코드(한글) **70자**를 넘으면 **여러 조각 SMS 로 자동 분할**해 보낸다. `sms:sent.partsCount` = 조각 수. 9조각 이상이면 `RESULT_ERROR_LIMIT_EXCEEDED` 위험.
- 국내 통신사는 긴 글을 LMS(MMS 망)로 다루는 것으로 알려져 있어(워커2 일반 지식 · 근거 문서 없음) 분할 SMS 가 **하나로 이어져 보일지 · 조각으로 보일지 · 실패할지 모른다**.
- 대안 = `mmsMessage: { "text": "긴 글" }`(첨부 없이 글만 MMS). 단 [앱 README] 「대부분 통신사에서 MMS 발신은 앱이 **기본 SMS 앱이어야 안정적**」 · MMS 는 배달 확인 없음(`sms:delivered` 안 옴).
- → 설치 절차 시험 b-2(70자 넘는 한글)로 확정. 확정 전까지 **봇 답은 70자 이하 한 통**으로 설계하거나, 길면 문장 경계에서 나눠 여러 통(각각 70자 이하).

**발송 상한·지연**(통신사 스팸 차단 방지) [문서]
- 앱 Settings → Messages: 「Delay between messages」(최소~최대 초 무작위) · 「Limits」(분/시간/일당 건수 — 넘으면 주기가 돌 때까지 **멈춤**, 실패가 아니라 대기) · 「Working Hours」(시간대 밖이면 대기).
- API 로도: `PATCH /3rdparty/v1/settings` `{ "messages": { "limit_period": "PerHour", "limit_value": 30, "send_interval_min": 3, "send_interval_max": 8 } }` (`limit_period` = Disabled/PerMinute/Per30Minutes/PerHour/PerDay · cloud 는 계정 전체에 적용).
- 문서 표기 「통신사 대개 시간당 30~200건」(해외 기준 · 국내 수치 **[미확인]**). 대량이면 유심 정지 위험 문구 있음.
- 🔴 이 상한은 **앱이 보내는 글만** 센다. 번호당 하루 상한·쿨다운은 우리 서버가 따로 가져야 한다.

## 3. webhook 등록 API

이벤트 **하나당 하나씩** 등록 [문서 「Each webhook is registered for a single event」]. 앱 화면에는 등록 기능이 없고(목록 보기만: Settings → Webhooks → Registered webhooks) **API 또는 웹 대시보드**(`https://dashboard.sms-gate.app` · 같은 아이디·비밀번호)로 한다.

```sh
curl -X POST -u "<아이디>:<비밀번호>" -H "Content-Type: application/json" \
  -d '{ "url": "https://jeju-acom-company.onrender.com/api/sms/webhook", "event": "sms:received" }' \
  https://api.sms-gate.app/3rdparty/v1/webhooks
```
- 본문 `{ url, event, id?, deviceId? }` → `201` + `{ id, url, event, deviceId? }` [OpenAPI `smsgateway.Webhook` · required = event·url]. 🔵 문서 예시는 `device_id`, OpenAPI 는 `deviceId` 로 표기가 갈린다 → 폰이 한 대라 넣지 않는다.
- 목록 `GET /webhooks` · 삭제 `DELETE /webhooks/{id}`.
- 등록 뒤 폰에 반영되기까지 「some time」(동기화) · `sms:received` webhook 이 새로 등록되면 폰에 알림이 뜬다 [문서].
- 등록할 이벤트 9개: `sms:received` · `sms:sent` · `sms:delivered` · `sms:failed` · `sms:cancelled` · `mms:received` · `mms:downloaded` · `system:ping` · `app:started`(재부팅·강제 종료 뒤 복귀 신호).
- url 조건: https + 유효 인증서(렌더 충족). 모든 이벤트를 **한 주소**로 받고 봉투 `event` 로 가른다.
- 🔴 같은 url·event 를 두 번 등록하면 중복 등록되는지 덮는지 **[미확인]** → 등록 스크립트는 먼저 GET 으로 있는지 보고 없을 때만 POST.

## 4. MMS 사진

- 권한: `RECEIVE_MMS` 필수 · `RECEIVE_SMS` · (`READ_SMS` — 아래) [문서 mms · 소스 Manifest].
- 흐름: 통신사 알림 → `mms:received`(메타) → **폰의 기본 문자 앱이 내려받음** → 앱이 `content://mms` 에서 `m_type = 132 AND msg_box = 1`(다 받은 받은함 글)을 읽어 → `mms:downloaded` [소스 MmsContentObserver].
  - 따라서 🔴 **삼성 메시지의 「MMS 자동 다운로드」가 꺼져 있으면 `mms:downloaded` 가 직원이 손으로 받을 때까지 안 온다**(소스로부터의 추론 · 실기기 시험 d). 로밍 중 자동 다운로드 끔도 같은 결과.
  - `READ_SMS` 권한이 없으면 「MMS inbox observer not started」로 조용히 꺼진다 [소스] → 설치 때 SMS 권한 전부 허용.
- `data` 가 null 이면: cloud 모드에는 첨부를 다시 받는 길이 없다(`GET /inbox/{id}/attachments/{partId}` 는 OpenAPI 에 있으나 `/inbox` 묶음은 **Local 모드 전용** [문서]) → 「사진 옴 · 직원 몫」으로.
- 크기: 문서에 받는 쪽 한도 없음 · 「큰 첨부는 webhook 본문과 전달 성능에 영향」. 통신사 MMS 한도(문서 표기 300KB~1MB · 국내 **[미확인]**). Base64 는 원본의 약 1.37배. 사진 여러 장이면 수 MB → **이 라우트 body 한도 25MB**(전역 `express.json` 기본 100kb 에 걸리면 413 → 2일 재시도).
- 사진을 DB 에 넣을지: CLAUDE.md #610 ⑥(안 넣거나 30일 뒤 비우기 · #579 db_retention 에 종류 추가).

## 5. 개인정보 — cloud 모드에서 앱 회사 서버에 남는 것

[문서 privacy/policy]
- **받은 문자·사진**: 폰이 우리 서버로 직접 보냄 → 앱 회사 서버를 안 거침.
- **보내는 글**(우리 서버 → api.sms-gate.app): 평문으로 저장됐다가 **처리 뒤 1분 안에 SHA256 해시**로 바뀜 · 1달 뒤 삭제 · 안 쓰는 기기는 1년 뒤 삭제 · 서버 로그 10일.
- 공유되는 기기 정보: 제조사·모델·앱 버전·FCM 토큰. 사용 통계·오류 보고 없음.
- 종단 암호화(선택): 보내는 글을 우리 서버에서 암호화 → 폰에서만 풀림(`isEncrypted`). 1단계 미사용 · 손님 번호·글이 1분간 평문으로 남는 점은 대표에게 알릴 것.
- webhook 등록 정보(우리 서버 주소)는 앱 회사 서버에 저장된다.

## 6. 감시

- `system:ping` 간격 권고 300초(배터리와 절충 · 문서는 배터리 경고만). 서버는 「마지막 ping 시각」을 저장 → 3회 연속 빠지면(15분) 텔레그램.
- `GET /3rdparty/v1/devices` → `lastSeen`(폰이 서버에 마지막으로 붙은 시각 · 쉬는 상태면 15분에 한 번이라 정확하지 않음 [문서]).
- 🔴 ping 은 **앱이 살아 있음**만 알려 준다. **채팅+ 가 다시 켜져 문자가 앱으로 안 오는 상태**는 ping 으로 못 잡는다 → 하루 1회 시험 문자 왕복(다른 번호 → 회사폰) 또는 「영업시간에 N시간 동안 받은 문자 0」 경고.

## 7. Render env 제안(값은 대표가 직접 · 저장소에 넣지 않음)

| 이름 | 값 |
|---|---|
| `SMSGATE_USER` / `SMSGATE_PASS` | 앱 Cloud Server 칸의 아이디·비밀번호 |
| `SMSGATE_SIGNING_KEY` | 앱 Settings → Webhooks → Signing Key |
| `SMSGATE_API_BASE` | `https://api.sms-gate.app/3rdparty/v1`(private 로 옮길 때 이것만 바꿈) |
| `SMS_PUBLIC_URL` | (선택) webhook 등록에 쓸 우리 주소 · 기본 `https://jeju-acom-company.onrender.com` |

- 코드가 읽는 다른 이름(같은 뜻 · 예비): `SMSGATE_WEBHOOK_SECRET`(= SIGNING_KEY) · `SMSGATE_LOGIN`/`SMSGATE_PASSWORD` · `SMSGATE_API`.
- 봉투 `deviceId` 대조(`SMSGATE_DEVICE_ID`)는 **구현돼 있지 않다** — 서명 키가 폰에만 있으므로 서명 검증이 그 역할을 한다.
- 값이 들어갔는지는 `GET /api/sms/config` 응답의 `gateway_env { user, pass, signing_key }`(참/거짓만)로 본다.

## 8. private 서버(추후 · 간단히)

[문서 getting-started/private-server · features/private-server]
- 구성: Go 서버 1 + (선택) 워커 1 + **MySQL/MariaDB**(빈 DB) + https 리버스 프록시. Docker 이미지 `ghcr.io/android-sms-gateway/server:latest` · 포트 3000 · 설정 `config.yml`(`gateway.mode: private` · `gateway.private_token` · `http.listen` · `database.*`) · 환경값 `CONFIG_PATH`.
- FCM: **자체 서버가 직접 FCM 을 쓰지 않는다.** 푸시 알림만 공용 서버(api.sms-gate.app)를 거쳐 FCM 으로 간다 — 그 요청에는 **FCM 토큰만** 실리고 글·번호는 없다 [문서]. Firebase 설정·앱 재빌드 불요. SSE 로 폰이 자체 서버에 상시 연결하는 길도 있음.
- 폰 설정: Settings → Cloud Server → API URL `https://<도메인>/api/mobile/v1` + Private Token. 🔴 **서버를 바꾸면 아이디·비밀번호가 초기화되고 기기를 다시 등록**해야 한다 → webhook 재등록·env 교체 필요.
- 렌더에 올릴 때 걸리는 것: **MySQL 이 필요**(우리 DB 는 PostgreSQL — 지원 여부 **[미확인]** · 문서는 MySQL/MariaDB 만 적음) → 서비스 1 + DB 1 추가 비용. 대안 = NCP 중계서버(101.79.16.213)에 Docker 로.
- API 경로는 같음(`/3rdparty/v1/…`) → `SMSGATE_API_BASE` 만 바꾸면 서버 코드 무변경.

## 9. 미확인 목록(실기기 시험·추가 조사로 확정)

> 시험 때 자료 확인은 `node scripts/sms-inspect.js`(10-6절).

1. 직원 수동 발신 — 소스상 「안 온다」. 실기기 시험 c 로 최종 확인.
2. 70자 넘는 한글 글이 국내 통신사에서 어떻게 가는지(분할 SMS · LMS · 실패) · 글만 있는 `mmsMessage` 가 기본 앱이 아닌 상태에서 나가는지.
3. `sender` 번호 형식(`010…` / `+8210…`) · `recipient` 가 채워지는지.
4. 보내기 `phoneNumbers` 에 `010…` 를 그대로 넣어도 되는지(문서는 E.164).
5. MMS: 삼성 메시지 자동 다운로드 상태에서 `mms:downloaded` 가 오는지 · `data` 가 채워지는지 · 사진 여러 장 본문 크기 · 첨부에 text/smil 조각이 섞이는지.
6. 재시도 요청의 `X-Timestamp`(처음 시각 / 재전송 시각).
7. 같은 url·event 중복 등록 시 동작.
8. cloud 모드 `system:ping` payload 의 checks 구성.
9. 폴드7(현행 안드로이드)에서 Play Protect 차단·「제한된 설정 허용」 화면의 정확한 한글 문구.
10. 채팅+ 를 끈 뒤 손님 화면 표시 · 업데이트·유심 재장착 뒤 다시 켜지는지.
11. 「Start on boot」 설정의 정확한 위치(문서는 이름만 언급) · 삼성 「사용하지 않는 앱 절전」 예외 경로.
12. 국내 통신사 시간당·일 발송 한도 · 무제한 요금제의 상업적 발송 약관.
13. private 서버의 PostgreSQL 지원 여부.

## 10. 서버 구현 현황(`sms/index.js` 를 읽은 대로 · 2026-10-10)

### 10-1. 받는 길
- `POST /api/sms/webhook`(로그인 없음 · 서명으로 보호). 원문은 server.js `express.json({ limit: '15mb', verify })` 가 이 주소일 때만 `req.rawBody` 에 담는다 → body 한도 **15MB**(사진 Base64 포함). 🔴 **env `SMSGATE_SIGNING_KEY` 를 넣는 순간부터 받은 글이 표에 적힌다** — 설정 `enabled` 와 무관(꺼져 있어도 기록 · 알림·발송만 없음). 키가 없으면 503 잠김.
- 순서: 서명 검사 → 실패면 `401 {error: no_sig|bad_sig|stale}` · 키 없음 `503 webhook locked` → 통과면 **즉시 200** `{ ok, accepted, event }` → 처리는 뒤에서(`setImmediate`). 같은 번호의 글은 한 줄로 차례대로 처리한다(동시에 두 건이 판정되지 않게). 처리 중 예외 → 그 대화 `staff_needed` + 텔레그램.
- 중복 제거: ①메모리 1차(봉투 id · 3일) ②**정본 = `sms_messages.envelope_id` 부분 UNIQUE**(받은 줄 INSERT 가 `ON CONFLICT DO NOTHING` → 재시작 뒤에도 같은 봉투는 한 번만).
- 신호 기록(`agent_office_config 'sms_gateway_state'`): `system:ping`·`app:started` 만 `last_ping_at` 을 갱신하고(`app:started` 는 `started_at` 과 횟수 `starts` 도), 그 밖의 이벤트는 `last_event_at`·`last_event` 만 갱신한다. **살아 있음 = 둘 중 최근 시각**이 `ping_alert_hours` 안. ping 하나하나의 이력은 남기지 않는다.
- 끊김 감시(켜져 있을 때만 · 1분 틱): 마지막 신호(위의 「둘 중 최근」)가 `ping_alert_hours`(기본 3시간) 넘게 없으면 텔레그램 1회 · 돌아오면 복구 1회. **신호 기록이 한 번도 없으면(켠 직후 · 폰 설치 전) 끊김으로 보지 않는다.**

### 10-2. 이벤트 처리
| 이벤트 | 서버가 하는 일 |
|---|---|
| `sms:received` | 번호(`payload.sender`) 없으면 건너뜀 → 받은 줄 기록 → 가르기·답(10-3) |
| `mms:received` | **기록만**(갈래 `photo_pending` · 답·알림 없음). 같은 번호에 최근 10분 안 사진 있는 MMS 줄이 이미 있으면(downloaded 가 먼저 옴) 건너뜀 |
| `mms:downloaded` | 같은 번호의 최근 **10분** 안 `photo_pending` 줄에 사진·글을 붙이고 그 줄로 가르기·답. 없으면 새 수신으로. 첨부는 `image/*` 만 사진 · `text/plain` 조각은 글로(사진 0장이면 일반 글 = 손님의 긴 글) |
| (5분 안에 downloaded 가 안 옴) | 그 줄을 `photo` 로 바꾸고 대화를 `staff_needed` · 「사진을 못 받았어요」 알림 |
| `sms:sent`·`delivered`·`failed` | `payload.messageId` 로 우리 발송 줄(gateway_id)을 찾아 상태 갱신(이미 delivered 인 줄은 되돌리지 않음) · failed 면 대화 `staff_needed` + 알림. 번호는 `payload.recipient` |
| 우리 id 가 아닌 발신 결과 | `sender = gateway_other` 줄(글 없음 → 「(전달 앱이 보낸 글 · 내용 없음)」) + 그 대화의 대기 발송 취소 + `staff_replied`(잠금). 🔴 직원이 삼성 메시지에서 손으로 보낸 글은 여기로 **오지 않는다**(1-2절) — 대시보드·다른 클라이언트 발신일 때만 |
| `sms:cancelled`·묶음(`*:batch:*`)·모르는 이벤트 | 200 + 무시 |

### 10-3. 받은 글 가르기·답(위에서부터 먼저 걸리는 것)
1. 갈래 `otp`·`ad`·`carrier`(대화 중이 아닌 번호) → `ignored` · 기록만.
2. 대화 상태가 `staff_replied`·`staff_needed`(잠금) 또는 **`draft`(초안 대기)** → 봇 침묵 · `staff_needed`(초안 글은 남김 · AI 를 다시 부르지 않음) · 「손님이 다시 보냈어요」 알림.
3. **꺼짐 또는 `record` 모드** → 아무것도 안 보냄. 클레임·사진(사진이 붙은 글 전부)만 `staff_needed`(알림은 켜져 있을 때만), 나머지는 상태를 바꾸지 않음(`new`).
4. 문자 시각이 **30분 넘게 지난 글**(재시도·비행기 모드 뒤) → 답 없이 `staff_needed`(`late_to_staff`).
5. 쿨다운(`cooldown_min` · #625 기본 10분) 안 · 오늘 봇이 이미 `daily_cap`(#625 기본 3)번 답함 · 같은 질문을 24시간 안에 또 보냄(#625 · 띄어쓰기·기호만 다른 글 = 같은 글) · **유예 중인 봇 답이 큐에 있음**(유예 75초 안에 온 둘째 글) → `staff_needed`. 🔵 쿨다운과 「오늘 답한 횟수」는 **봇 답을 큐에 넣는 순간 1번** 오른다(조각 수와 무관 · 보낸 뒤가 아님).
6. 번호로 주문 찾기 → **사진이 붙었으면 글이 클레임이어도 사진 판독**(판독 실패·한도 초과·파손 확신 낮음·문구 검사 걸림 → 직원), 아니면 규칙 답 → AI 답. AI 글에 약속 낱말(환불·반품·교환·보상·무료 수거·취소 처리·포인트·적립·쿠폰·할인·재발송·재배송)이 있으면 직원. 답이 없거나 「사람」 판정이면 `staff_needed`(초안이 있으면 `draft_text` 에). 주문이 여러 건이면 주문 물음(발송·주문)일 때만 「받는 분 성함」을 1회 되묻는다.
7. `draft` 모드 → 대화 `draft` + 초안 알림(직원이 [이대로 보내기]). `auto` 모드 → `hold_sec`(기본 75초) 뒤 보낼 줄을 큐에 · 대화 `bot_replied`.
- 대화 상태 값: `new · bot_replied · cooldown · staff_needed · draft · staff_replied · closed · ignored`.
- **직원 알림은 대화당 5분에 한 번**(손님이 연달아 보내도 푸시가 쏟아지지 않게 · `sms_threads.last_notify_at`) · 알림 본문에는 손님 원문을 싣지 않는다(「에이전트 오피스 「문자」 카드에서 확인해 주세요」 · 제목에 끝 4자리만).
- 🔵 `staff_replied` 잠금은 직원이 [대화 끝내기]를 누를 때까지 풀리지 않는다(자동 해제 없음 — 대표 결정 대기).
- 줄의 `sender`: `customer`(받음) · `bot` · `staff_desk`(화면에서 직원 발송) · `gateway_other`. 줄의 `state`: `received` / `queued → sending → sent → delivered` · `failed` · `cancelled`.

### 10-4. 보내기
- 큐 틱 **10초마다 · 한 번에 5줄**(우선순위 높은 것 먼저). 꺼져 있으면(`enabled` false) 큐를 돌리지 않는다. **시간당 상한 `hourly_send_cap`(기본 30)은 봇 답에만** 걸린다 — 걸리면 봇 답은 쉬고 직원 답은 나감 · 텔레그램 1시간 1회.
- 봇 줄은 보내기 직전에 대화 상태를 다시 본다 — `staff_replied`·`staff_needed`·`closed` 면 `cancelled`(유예 사이 직원이 답함).
- 요청: `{ id, textMessage:{text}, phoneNumbers:[+82…], ttl: ttl_sec(기본 600), priority }`. **id 는 줄마다 고정**(`akk-<줄 id>-<해시 8자>` → gateway_id 에 저장) — 같은 줄을 다시 보내도 같은 id 라 게이트웨이가 409 로 막는다. 줄 집기는 `UPDATE … WHERE state='queued' RETURNING` 으로 한 번만(틱 두 번·인스턴스 둘이 겹쳐도 1통). 여러 통으로 나눌 때 1통째 9 · 2통째 8 …(앱 기본이 나중 것 먼저라서 · 100 미만이라 앱 상한은 그대로 적용).
- 응답 202 → 줄은 **`sending` 유지** · `sent_at` 기록. 실제 `sent`/`delivered`/`failed` 는 webhook 이 적는다. 409 = 같은 id 가 이미 있음 = 성공으로 봄. 20초 타임아웃이면 같은 id 로 1회 더. 그 밖 오류 → 줄 `failed` + 대화 `staff_needed` + 알림.
- **멈춘 줄 정리 `sweepStuck`**(보내기 틱·감시 틱마다): ①보낼 시각이 15분 넘게 지난 `queued`(꺼 둔 사이 쌓인 큐) → `cancelled:stale` + 대화 `staff_needed`(며칠 뒤 켰을 때 옛 답이 나가지 않게) ②`sending` 인데 `sent_at` 없음(202 를 못 받고 죽음) · 만든 지 2분 → 같은 id 로 다시 `queued` ③`sent_at` 뒤 `ttl_sec + 600초` 가 지나도 결과 webhook 이 없음 → `failed`(`no_result`) + 대화 `staff_needed` + 「보낸 결과가 안 와요(폰 꺼짐?)」 알림 ④받은 지 2분 넘었는데 `new` 로 남고 보낸 줄이 없는 대화(판정 전에 죽음) → `staff_needed` + 알림 — **켜져 있고 record 모드가 아닐 때만**(record 에서는 `new` 가 정상) · 인증번호·광고·통신사·인사·사진 대기 갈래는 제외 · 만든 지 하루 안 대화만.
- **나누기**(`max_chars` 기본 70 · 문장 경계): 봇 자동 답과 직원 화면 발송(`/reply`)·초안 보내기(`/send-draft`) 모두 조각으로 나눠 큐에 넣는다. 다듬은 뒤 글이 비면 400. 초안 보내기는 두 번 눌러도 1회만 나간다.

### 10-5. 화면·관리 API(전부 로그인 필요)
| 주소 | 뜻 |
|---|---|
| `GET /api/sms/summary` | 켜짐·모드·상태별 건수·오늘 받음/봇/직원·`gateway { last_ping_at, alive }` |
| `GET /api/sms/threads?status=&q=&limit=` · `GET /api/sms/threads/:id` · `GET /api/sms/images/:id` | 대화 목록·한 건·사진(번호는 끝 4자리·가림값만 나감) |
| `POST /api/sms/threads/:id/reply` `{text}` | 직원 답 발송(큐에 · 대화 `staff_replied`) — 꺼져 있으면 409 |
| `POST /api/sms/threads/:id/send-draft` | 봇 초안 그대로 발송 |
| `POST /api/sms/threads/:id/handled` | **[처리함]** — 대기 발송 취소 + `staff_replied`(직원이 폰에서 답했을 때) |
| `POST /api/sms/threads/:id/close` | 종결(`closed`) |
| `GET /api/sms/config` | 설정 + `gateway_env`(값 유무) + `modules`(가르기·규칙·주문 찾기·사진·AI 모듈 유무) |
| `POST /api/sms/config`(관리자) | 설정 바꾸기 — 예 `{"enabled":true,"mode":"record"}`. 값 범위는 서버가 고름(틀리면 기본값) · audit 기록 · 10초 안 반영 |
| `POST /api/sms/register-webhooks`(관리자) | webhook 9종 등록(있는 것은 `exists`). 응답 `{ url, before, result:[{event,status,id 또는 code,detail}] }` · 목록 조회 실패면 `{ error:'list 401', hint }` |

**모드 3단계**(설정 `agent_office_config 'sms_gateway'` · 행이 없으면 꺼짐)
| 단계 | 설정 | 동작 |
|---|---|---|
| 0 꺼짐 | 행 없음 또는 `enabled:false` | webhook 은 받아 기록만 · 알림 없음 · 보내기 큐 멈춤 · 화면 발송 409 |
| 1 기록 | `enabled:true, mode:'record'` | 기록 + 클레임·사진 알림 · 봇은 아무것도 안 보냄 · 직원 화면 발송 가능 |
| 2 초안 | `mode:'draft'` | 봇이 초안만 · 직원이 [이대로 보내기] |
| 3 자동 | `mode:'auto'` | 유예 뒤 자동 발송 — 🔴 첫 전환은 대표 「고」 뒤 |

### 10-5b. 보관 정리(매일 03:50 KST · `retentionRun`)
- `agent_office_config 'db_retention'.enabled` 가 **불리언 true** 일 때만 돈다(#579 스위치 · 지금 켜져 있음). 실패하면 다음 틱에 다시.
- 사진: `sms_images` 만든 지 `image_days`(기본 30)일 지난 줄의 `data` 를 비움(`purged_at`). 발송 전 주문 표(`sms_preorders`) 7일.
- **송장 표(`delivery_shipments`) 60일 = 세기만.** 대상 건수를 `agent_office_config 'sms_retention_last'.shipments_target` 에 적을 뿐 지우지 않는다. 설정 `sms_gateway.purge_shipments === true` 일 때만 실제 삭제(한 번에 5,000행) + 주인 없는 `delivery_status`(60일) 삭제. 켜는 것은 대표 「고」 뒤.
- audit 은 사진 비움 또는 송장 삭제가 1건 이상일 때만 1줄(source `db_retention` · 번호·이름 없음).
- 셀프 조회 시도 표(`sms_selfcheck_hits`)의 하루 지난 줄 정리는 보관 스위치와 무관하게 돈다.

### 10-5c. 손님 셀프 조회 「내 주문 어디쯤?」(`sms/selfcheck.js` · 공개 · 로그인 없음)
- `GET /track-order`(화면) · `POST /api/track-order {name, tail}`(본문 2kb 한도) · `GET /track-order/go?t=토큰`(10분 암호 토큰 → CJ 조회 화면으로 302 · 🔵 그 Location 에는 운송장 전체가 실린다).
- 찾는 범위: 최근 30일 송장 표 · 받는 분 성함 전체 일치 + (받는 분 또는 구매자) 번호 끝 4자리. 응답 = 보낸 날·품목·상자 수·운송장 끝 4자리·단계·도착 예정(주소·전체 번호·이름 없음). 여러 건이면 「여러 건」만.
- **시도 제한(10분 창)**: IP 5회 · 성함 30회 · 끝자리 20회 · **전체 200회**(넘으면 429 + 텔레그램 1시간 1회) · 「없음」이 10번 이어진 IP 는 60분 잠금 · 동시 조회 8건. IP = `x-forwarded-for` 의 **마지막 값**(프록시가 붙인 값 · 🔵 렌더가 실제로 그렇게 붙이는지는 배포 뒤 헤더로 확인할 것). 응답 최소 300ms. 열쇠는 해시로만 저장.
- 헤더: `X-Robots-Tag: noindex, nofollow` · `Cache-Control: no-store` · `Referrer-Policy: no-referrer`.

### 10-6. 점검 도구 — `scripts/sms-inspect.js`(읽기만)
```
node scripts/sms-inspect.js                 # 최근 2시간 요약 + 시험 a~f 판정 + 대화별 줄
node scripts/sms-inspect.js --since 30m     # 기간(30m · 2h · 1d)
node scripts/sms-inspect.js --thread 12     # 대화 하나 전부
node scripts/sms-inspect.js --events        # 들어온 순서대로 한 줄씩
node scripts/sms-inspect.js --json          # 그대로 JSON
```
- 번호는 가림값·손님 글 80자·주소 꼴 「[주소]」·글 속 전화번호 가림. SELECT 만 · 외부 호출 없음.
- 판정은 「자료로 보이는 것」만: a 받은 줄 · b 우리 발송의 state · b-2 70자 넘는 한 통/나눠 보낸 조각 · c `gateway_other` 줄 유무 · d 사진 바이트 · e 마지막 신호 · f 문자 시각과 서버 도착 시각 차이·같은 글 중복. 폰 화면에서만 보이는 것(대화창 표시·한 덩어리 여부·순서)은 판정하지 않는다.
- 「보관」 줄 = 마지막 보관 정리 결과(`sms_retention_last`: 사진 비움 · 송장 60일 대상 건수 · 세기만/삭제).
- DB 에 안 남는 것: `partsCount`(조각 수) · 서명 실패 횟수 · ping 하나하나의 이력(마지막 ping·앱 시작 횟수는 남음) · 처리 결과 action(`late_to_staff` 등) → 렌더 로그의 「[문자] … → …」 줄로 본다.

### 10-7. 검증 스크립트 쓰는 규칙
- 서버 흐름 `scripts/verify-610-server.js` · 운영 갈래 `scripts/verify-610-ops.js`(보관 정리 · 멈춘 줄 정리 · 보내기 동시 실행 · 봉투 중복 · 사진 순서 뒤집힘 · 켠 직후 알림). 둘 다 **실DB + 가짜 deps**(설정·알림·텔레그램·발송·audit 은 가짜).
- 🔴 **문자 검증(server · ops)은 한 번에 하나씩.** `sendTick`·`sweepStuck`·`retentionRun` 은 표 전체를 보므로 둘을 같이 돌리면 서로의 시험 줄을 집는다(상대 줄을 가짜 게이트웨이로 「보냄」 처리 · staff_needed 로 바꿈).
- 🔴 **가짜 `deps.stateMerge` 를 반드시 넘긴다.** 안 넘기면 시험 신호가 실 설정 행 `sms_gateway_state` 에 남아, 화면에 가짜 「마지막 신호」가 보이고 「신호 기록이 없으면 끊김 알림 안 함」이 깨진다(10/10 실제로 남아 총괄이 행 삭제).
- 🔴 **실사용이 시작된 뒤에는 ops 검증을 돌리지 않는다**(가짜 게이트웨이가 실제 대기 문자를 「보낸 것」으로 만든다). ops 는 시작할 때 실제 줄(60일 지난 송장 · 30일 지난 사진 · 대기 발송 · 최근 1시간 new 대화)을 세어 1건이라도 있으면 exit 3 으로 멈춘다 — `--force` 는 쓰지 말 것.
- 시험 줄: server = 번호 `0999000…` · ops = 번호 `0999600…` + 운송장 `9996000000xx`. 끝에 그 줄만 지운다.
