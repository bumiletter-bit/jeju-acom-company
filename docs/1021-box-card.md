# #1021 메모함 「박스별 카드」 설계서 (워커3 · 2026-11-05 · 대표 「고」 뒤 시공)

> 대표 원문(11/5): 「사이즈·과수 누르고 번호 누르면 여기(정리 결과 카드의 주문 안내 줄)에 2박스를 강조해 주고, 2박스 누르면 2박스 사이즈 메모 카드가 나와서 주소든 보내는이든 사이즈든 배송메모든 (박스마다) 변경할 수 있도록」
> 지금 = 최종발주에만 박스별 카드(#601·#611·#618 · `public/final-order.js` 1583~1702 · 한 박스 = `t 꼬리 · o 옵션명 · n 받는 분 · p 번호1 · p2 번호2 · a 주소 · m 배송메세지 · s 이번에 안 보냄`) · 메모함엔 없음 · **박스별 보내는이는 최종발주에도 없음**(보내는이는 주문 단위 `st.patch.sender` → `core.buildRows senderByKey`).

## 0. 대표 구상과 달라지는 점(먼저 읽을 것)

1. **박스별 카드 저장 = 메모함 「박스별」 줄 하나.** 메모 칸 글(「010-… S사이즈 1박스 M사이즈 1박스」)로 넣지 않고, #955 배송메모 줄과 같은 길(for-ship 의 별도 목록)로 최종발주가 바로 읽는다. 이유 = 사이즈가 없는 박스별(2박스 중 1박스만 다른 주소·다른 보내는이)은 글 줄로 쓰면 종전 파서가 「날짜 없는 요청 줄」로 잘못 읽는다(#858 과 같은 함정). 줄 글(`line`)은 사람이 읽는 요약(「박스별 2박스 · S 1 · M 1 · 박스2 받는 분 바꿈」)이고 파서는 이 줄을 건너뛴다. → 총괄 ①의 「종전 파서 호환 글 유지」와 다름 · 종전 「번호 S사이즈로」 줄·「S사이즈 1건 M사이즈 1건」 줄은 그대로 살아 있다(이 줄들은 박스별 카드를 안 열었을 때의 길).
2. **메모함 카드의 받는 분 번호·배송메세지 칸은 처음엔 빈칸**(메모함 주문 찾기 `GET /api/order-memo/lookup` 응답에 번호·메모가 없음 · 이름·주소는 있음) · 빈칸 = 「주문 그대로」(최종발주 박스 줄과 같은 뜻) · 최종발주 카드에서 실제 주문 값이 채워져 보인다.
3. **「2박스」 강조 단추 자리** = 그 번호 주문이 1건이면 주문 안내 줄(`lkText` 의 「… 2박스 · 11/4 결제」)의 「2박스」 · 2건 이상이면 #938 주문별 목록(`ordHtml`) 줄마다의 「n박스」(눌러서 주문을 고르는 셈 = `checked.pno`).
4. **보내는 분 박스별 = 양식 「보내는사람·보내는사람연락처」 칸만**(「보내는이 변경주소」 칸은 박스별로 안 함 · 주문 단위 그대로).
5. 사이즈뿐 아니라 **과수(만감류)도 같은 카드**(꼬리표가 「사이즈·과수」 하나이므로) · 칸은 품목에 따라 사이즈 칩(귤 로얄과) 또는 과수 숫자(만감류) · 그 밖 품목은 꼬리 칸 없음(받는 분·보내는 분·메모만).

## 1. 뜻 · 완료 기준 · 무회귀 경계

- **뜻**: 손님 한 주문(2~20박스)의 박스마다 사이즈/과수 · 받는 분(이름·번호·주소) · 배송메세지 · 보내는 분(이름·번호) · 「이번에 안 보냄」을 **메모함에서 미리** 적어 두면, 다음 최종발주의 「직접 고치기」 박스 줄에 그대로 채워져 양식 줄이 박스별로 나뉘어 나간다(사람이 최종발주 카드에서 바꾼 값이 우선).
- **완료 기준**: ①메모함 꼬리표 사이즈·과수 + 번호 → 정리 결과 카드 주문 안내 줄 「n박스」 단추 → 박스별 카드 → 저장 = `order_memo_rows` 1줄(`kind line` · `note 박스별 …` · `boxes JSONB`) ②`GET for-ship` 에 `box_rows[]` · `memo_text` 엔 안 들어감 ③최종발주 = 그 주문 박스 줄 미리 채움(사이즈·받는 분·보내는 분·안 보냄) + 파일 = 박스 묶음 수만큼 줄(연보라) + 박스별 보내는 분 칸 ④합 ≠ 주문 박스 수 · 주문 없음 · 같은 번호 주문 여럿(pno 없음) = 안 채우고 참고 줄 + 확인 카드(「확인함」만 · 되묻기 0) ⑤입력삭제 줄·현금 줄엔 없음 ⑥`box_rows` 가 없을 때 최종발주 결과 파일 = 종전 바이트 동일.
- **무회귀 경계**: 시공 파일 = 워커3 `public/final-order.js` 만 · 워커2 몫 `order-memo.js`(+ `docs/850-api.md`) · 워커1 몫 `public/ao-ordermemo.js`·`ao-ordermemo.css` · **`public/final-order-core.js` 무접촉**(아래 3-4 열쇠 꼼수로 core 변경 0) · `server.js`·`invoice-v2.js`·자동 송장 무접촉 · 실DB 쓰기 = 기동 `ALTER TABLE … ADD COLUMN IF NOT EXISTS boxes JSONB` 1칸만(배포 때) · 되돌리기 = 칸은 두고 코드만 되돌려도 무해(안 읽으면 끝).

## 2. 저장 꼴(서버 · 워커2 몫)

### 2-1 표
- `order_memo_rows.boxes JSONB`(새 칸 · `ALTER TABLE order_memo_rows ADD COLUMN IF NOT EXISTS boxes JSONB` · order-memo.js 380~384 줄 `checked`·`addr_ok`·`service`·`pair_orig`·`exp_site` 뒤 한 줄).
- `checked` 는 종전 꼴 그대로 재사용 `{ plat, as, at, buyer?, pno? }`(`cleanChecked` 311~315 · 개인정보 없음 유지) — 박스별 줄은 **주문을 가리키는 열쇠** = `pno`(상품주문번호 · 있으면) → 없으면 `key`(구매자 번호) + `plat`.
- `cells` 는 안 씀(현금 13칸 양식 전용) · `kind = 'line'` · `line_key = 구매자 번호`(다른 메모함 줄과 같은 꼴 · 입력삭제 짝·배지는 이 줄을 안 봄).
- `note = '박스별 ' + 요약` · `line = [날짜(ship_date 있으면 M/D), key, note, plat].join('\t')`(#938 `expandOrders` 와 같은 꼴 · 사람이 읽는 글 · 파서는 건너뜀).
- **요약 글 꼴(고정)** = 「2박스 · 박스1=S · 박스2=M(받는 분·보내는 분 바꿈) · 박스3=안 보냄」 — 사이즈 글자는 반드시 `박스n=` 뒤에 붙여 쓴다(앞에 빈칸이 없으면 core `SIZE_TOK`·메모함 `DUP_KINDS` size 정규식에 안 걸림 · 「S 1」「S사이즈」 꼴 금지) · 과수 = 「박스1=13과」 · 바꾼 칸 낱말 = 받는 분·번호·주소·배송메세지·보내는 분(값 글자는 안 넣음).
- **`checkLine`(95~120)·`lineBadge`(#1019)·`isIndivLine`(160) 에서 박스별 줄 건너뛰기** = `const bx = BOX_NOTE.test(note) && Array.isArray(r.boxes)`(저장 전 `_boxes`) 를 `sm`(배송메모) 과 같은 자리에서 보고 `V2.parseLines`·`core.sizeLines`·`gwaLines` 를 돌리지 않는다(안 그러면 요약 글이 「메모 칸이 읽지 못하는 꼴」로 `sure=false` → for-ship `held` 에 영원히 남음 · 검토자 Q1) · `lineBadge` 는 박스별 줄을 `type 'box'` 로 = 주문 있으면 ok · 없으면 fail(사이즈 판정 없음).

### 2-2 `boxes` 값(검증 함수 `cleanBoxes` · `cleanChecked` 바로 아래 새 함수)
```
boxes = [ { t, o, n, p, p2, a, m, s, sn, sp }, … ]   // 길이 = 그 주문 박스 수(2~20) · 칸 전부 문자열 · '' = 주문 그대로
t  꼬리 글(최종발주 tailNorm 꼴 「S사이즈로!」「13과로!」 · '' = 꼬리 없음)   ≤ 40
o  옵션명 바꿈(단가표 이름 · 보통 '')                                        ≤ 120
n  받는 분 이름 ≤ 20 · p/p2 받는 분 번호 ≤ 14(숫자·하이픈만) · a 주소 ≤ 200 · m 배송메세지 ≤ 300
s  이번에 안 보냄 = '1' 또는 ''
sn 보내는 분 이름 ≤ 20 · sp 보내는 분 번호 ≤ 14   ← 새 칸(최종발주 BOX_F 에도 추가 · 3-2)
```
- `cleanBoxes(v)`: 배열 아니거나 길이 2 미만·20 초과 → `null` · 항목마다 위 열 키만 남기고 문자열 trim·길이 자름 · `s` 는 `'1'`/`''` · 전부 빈 항목만이면(바꾼 것 0) `null` · 탭·줄바꿈 → 한 칸.
- 저장: `POST /api/order-memo` rows[].boxes(566~577 · INSERT 열에 `boxes` 추가 · `cleanBoxes` 통과값 · `kind==='line'` 일 때만) · `PUT /rows/:id` body.boxes(628~635 UPDATE 열 추가 · `'boxes' in b` 일 때만 바뀜 · `null` = 지움 · 번호(key)나 판매처가 바뀌면 `checked` 와 같이 비움(주문 열쇠가 달라짐)) · `rowOut`(497~505) + `ROW_COLS`(507) 에 `boxes`.
- `BOX_NOTE = /^박스별(?:\s|$)/`(155 `SHIP_NOTE` 옆) · `isIndivLine`(160) 에 `!BOX_NOTE.test(note)` 추가(「박스별」 줄은 입력삭제 아님) · `#1020 line badge` 계산이 note 를 보면 박스별 줄은 제외(워커1·2 가 #1020 끝낸 뒤 총괄이 맞춤).

### 2-3 `GET /api/order-memo/for-ship?date=` (`pickForShip` 317~335 · 순수)
- 박스별 줄(`kind line` + `BOX_NOTE` + `boxes` 있음)은 `lines`/`memo_text` 에 **안 넣고** `box_rows` 로:
  `box_rows: [{ id, key: line_key, plat, line, ship_date, checked, boxes }]` · 날짜 규칙 = 배송메모 줄과 같게(`sd > date` → `box_wait[{id, ship_date}]` · `sd < date` → `held(['지난 날짜예요'])` · 없거나 같으면 `box_rows`) · `ids` 에 포함(「오늘 씀」 표시 · 비우기 종전 그대로).
- `boxes` 없는 「박스별」 줄(옛 저장·지운 값) = 종전처럼 `lines` 로(글이 「박스별 …」 이라 최종발주 prepLines 가 「요청 줄 · 확인 필요」로 보임 — 사람이 지움 · 발생 길 없음).
- `docs/850-api.md` 2-7 에 `box_rows`·`box_wait` 한 줄 + §9 「박스별 `boxes`」 절(위 2-2).
- 963 줄 `sm !== '1'`(옛 화면·중간발주) 응답 = `delete x.box_rows; delete x.box_wait` 추가 + `rows.filter(r => !shipMemoOf(r) && !isBoxRow(r))`(배송메모 줄과 같은 처리 · 검토자 Q7).

### 2-4 서버에 안 넣는 것
- 박스 수 ≠ 주문 박스 수 판정(최종발주가 그때 주문으로 판정 · 메모함은 저장 때 lookup qty 와 같을 때만 저장하게 화면이 막음) · 입력삭제·현금 줄 무관 · 자동 송장 무관(주문 단위 그대로) · lookup 응답 무변경.

## 3. 최종발주(`public/final-order.js` · 워커3 시공)

### 3-1 받기
- `OMF`(272) 에 `boxRows: []` · 340~344 `OMF.shipMemos` 옆 `OMF.boxRows = Array.isArray(r.box_rows) ? r.box_rows : []` · `[빼기]`(OMF.removed)·`again`(391) 때 같이 비움 · 옛 서버(칸 없음) = `[]` = 아무 일 없음.
- 메모함 띠(`fo-om-band` · 925~929 판정 글 옆) 에 `· 박스별 n줄` 수만(글 줄은 안 늘림).

### 3-2 박스 꼴 확장(1583~1586 · 2513~2522)
- `BOX_F = ['t','o','n','p','p2','a','m','s','sn','sp']` · `boxArr`(1585) 그대로(BOX_F 순회) · `boxGroupX`(2513): `b.sn || b.sp` 면 `g.sender = { name: b.sn, phone: b.sp }` · `boxExpand`(2516): `sn: (g.sender||{}).name||'' · sp: …phone||''` · `boxHasX`(2517): `g.sender` 도 참 · `boxExtraText`(2521): `g.sender` 면 「보내는 분 ○○」 낱말 추가 · `changed` 판정(1599·1612) = BOX_F 중 t·s 뺀 칸이라 sn·sp 자동 포함.
- `boxesHtml`(1588~1600) 박스 줄의 `more`(받는 분 칸 묶음 · `rc` 있을 때) 뒤에 **보내는 분 두 칸** `<label>보내는 분<input data-bsn maxlength=20></label><label>보내는 분 번호<input data-bsp inputmode=tel maxlength=14></label>`(placeholder = 지금 보내는 분 = `st.patch.sender?.name || e.sender?.name || 구매자`) · `boxRead`(1603~1615) 에 `data-bsn/data-bsp` 읽기(`rc` 조건 밖 · 입력삭제 주문엔 안 그림 = 현금파일 줄이 나감) · `onFixInput`(1647~1655) 의 `[data-brc]` 와 같이 `[data-bsn],[data-bsp]` → `boxRead`.

### 3-3 메모함 박스별 → 주문(새 함수 `boxPlan(cards, info)` · 931 `shipMemoPlan` 바로 뒤 · 같은 자리에서 호출)
```
st.omBoxes = new Map()   // 주문 key → { arr(박스 수만큼 BOX_F 객체), g(boxGroupX), id, line }
각 m of OMF.boxRows:
  ch = {네이버:naver,쿠팡:coupang,자사몰:cafe24}[m.plat] · pno = m.checked?.pno · d = digitsOf(m.key)
  hit = merged.filter(e => (!ch || e.ch===ch) && (pno ? idsOf(e).includes(pno) : buyerTel(e)===d))
  hit 0            → info 「메모함 박스별 ✕ 주문 없음: {m.line} → 취소·이미 발송인지 확인」(shipLine 꼴 아님 · keys [])
  hit ≥2 (pno 있든 없든) → 안 채움 · 카드 { id:'boxm:'+m.id, type:'line', tag:'메모함 박스별', title:m.line, lines:[이유 (pno 없음 → 「이 번호 주문이 n건 — 메모함에서 주문을 골라 다시 저장」 · pno 있음 → 「이 주문이 n줄(쿠팡·자사몰 한 주문 여러 줄)이에요 — 최종발주 카드에서 직접 고쳐 주세요」), 주문 1~6], choices:[['skip','확인함']] }   ← 검토자 Q2: 쿠팡·자사몰 pno = 주문번호라 여러 줄이 같은 pno · 박스별은 **주문 1줄일 때만**
  e = hit[0] · e.individual → info 「입력삭제 주문엔 박스별을 안 넣어요(현금파일 줄이 나감)」
  m.boxes.length !== qtyNow(e) → 안 채움 · 카드 'boxq:'+m.id 「메모함은 n박스인데 주문은 q박스예요 — 최종발주 카드에서 직접 고치거나 메모함 줄을 고쳐 다시 판정」 choices [['skip','확인함']]
  else arr = m.boxes.map(BOX_F 꼴 · t 는 tailNorm · o 는 inCatalog 아니면 '' 로 버리고 info 한 줄) · st.omBoxes.set(keyOf(e), { arr, g: boxGroupX(arr), id: m.id, line: m.line })
       info 「메모함 박스별: {m.line} → {boxText(g)}{boxHasX ? ' · '+boxExtraText(g) : ''}」 keys [k]
```
- **우선순위**(`boxesOf` 2524~2528 한 줄 바꿈): `p.boxes`(카드) → `p.tail != null`(카드 꼬리 하나 = 박스별 없음) → **`st.omBoxes.get(k).g`(메모함 카드)** → `st.sizeBoxes.get(k)`(메모 줄 글) · 합 = qtyNow 검사 종전 그대로.
- `tailOf`(2530) 는 `boxesOf` 를 먼저 보므로 자동 · `sizeApply`(659~717) 무변경(사이즈 줄 글은 종전대로 · 같은 주문에 둘 다 있으면 omBoxes 가 이김 = info 한 줄 「메모 줄 사이즈보다 메모함 박스별 카드가 먼저예요」).
- **카드 미리 채움**: `fixHtml`(1666~1669) `bxCur = boxesOf(e1)` → `boxExpand(bxCur)` 가 sn·sp 까지 펴므로 변경 0 · 단 `boxExpand` 는 묶음(g)이라 같은 값 박스는 순서가 묶여 보일 수 있음 → `st.omBoxes` 가 있으면 `arr`(저장된 박스 순서 그대로)를 씀: `bv = … : JSON.stringify(om ? om.arr : bxCur ? boxExpand(bxCur) : …)`.
- `fixApply`(1714~1727): 사람이 카드에서 [적용] → `set.boxes = g` 종전 길(`boxesBy 'card'`) · `fixUndo` 종전 · 바꿀 곳 셋(검토자 Q3·Q6):
  - 1722 비교 기준 = `const base = om ? om.arr : cur ? boxExpand(cur) : null` → `if (!base || JSON.stringify(base) !== JSON.stringify(arr))`(묶음(g)은 순서가 재배열돼 같은 값도 「바꿈」으로 보임 → 저장된 박스 순서 `om.arr` 와 비교) · 같으면 패치 없이 메모함 값 그대로 나감.
  - 1721 분기 조건 = `g.length > 1 || g.some(x => x.sender)` — 묶음이 하나라도(전부 같은 값) 보내는 분이 적혀 있으면 박스별 길(`set.boxes = g`)로 보낸다. `else`(1723~1726 단일 값) 분기는 sn·sp 를 안 옮기므로 그대로 두면 보내는 분이 조용히 버려진다. 묶음 1개 = make() 에서 줄 1개로 나가며 보내는 분 칸만 바뀜(수량 나눔 없음).
  - 입력삭제 주문(`e1.individual`)은 보내는 분 칸을 안 그린다(현금파일 줄이 나감 · 종전 `rc1` 조건과 같이).
- 1301~1304 「말로 바꾼 것」 참고 = `p.boxes`(사람) 만 종전대로 · 메모함 몫은 boxPlan 의 info.

### 3-4 파일(`make()` 2200~2205 `program2`)
```
bx.forEach(b => { … cells[4]·[5] 종전 · r = b.rcpt 종전 ·
  if (b.sender && b.sender.name) { cells[0] = lil(/드림$/.test(nm) ? nm : nm + ' 드림'); if (b.sender.phone) cells[1] = lil(b.sender.phone);
      const od = sby.get(row.key); if (od && od.addr) cells[12] = lil(od.addr); }   // 주문 단위 「보내는이 변경주소」는 그대로 싣는다(열쇠를 바꾸면 core 가 안 넣으므로 여기서 · 검토자 Q4)
  program2.push({ key: b.sender && b.sender.name ? row.key + '\u0001b' + i : row.key, cells }); })
```
- `core.buildRows`(838~866) 는 `p.key` 를 **`senderOf(p.key)` 에만** 쓴다(실측 · place 는 key 안 봄 · 검토자 확인) → 박스별 보내는 분이 있는 줄은 열쇠를 바꿔 주문 단위 `senderByKey`(sby · 2630~2633) 가 name·phone 을 덮지 않게 한다 · 보내는 분 없는 박스는 열쇠 그대로 = 주문 단위 보내는이 종전대로(파랑) · 박스별 보내는 분 칸 색 = 연보라(`lil` · 다른 박스별 칸과 같음 · 주문 단위는 종전 파랑 그대로). **core 변경 0.**
- 박스별 보내는 분 이름이 없고 번호만 적힌 박스(`sp` 만) = 번호만 바꿈(cells[1]) · 열쇠는 바꾸지 않음(주문 단위 보내는이 이름이 있으면 그 이름 + 이 번호 · core 가 phone 을 덮으므로 `sp` 는 core 뒤가 아니라 열쇠를 바꿔야 함) → 단순화 = **`sp` 만 있는 박스도 열쇠를 바꾸고 cells[0] 은 주문 단위 보내는이 이름(sby 있으면 그 이름 + 드림 · 없으면 주문 값 그대로)** 으로 채운다.
- 색 = `patchStyle`(연보라 · 종전 박스 줄과 같음) · 스토어 시트 한 줄 종전 · 거래처 수량 표 종전(옵션·수량 칸만 봄).
- 2578~2579 결과 요약(add)·3037 보내는이 셈 = `p.boxes` 기준 종전 · 메모함 몫은 boxPlan info 만(요약 글 안 늘림).

### 3-5 「오늘 씀」·비우기
- `box_rows[].id` 는 for-ship `ids` 에 있어 종전 `omPost(used)` 길 그대로 · 사람이 메모 칸에서 지울 글이 아니므로 「넣은 줄을 지웠다」 되돌림 대상 아님(배송메모 줄과 같음 · `shipAppliedIds` 꼴 별도 계산 없음 · 단순).

## 4. 메모함 화면(`public/ao-ordermemo.js`·`css` · 워커1 몫 · #1020 끝난 뒤)

### 4-1 들어가는 길
- 꼬리표 「사이즈·과수」(69 `TAGS` · 370 입력판) → 번호 → [넣기] → `raw` 에 「010-… S사이즈로」 → [입력하기] → 정리 결과 카드 줄(`kind line`) · 종전 그대로.
- **「n박스」 단추**: `lkHtml`(1636) — 줄이 사이즈·과수 줄(`TAG_RE.size` 또는 `/\d{1,2}과로/` 가 note·line 에 맞음 · `INDIV_RE`·날짜·보내는이 줄 제외)이고 **박스 수 출처 = `lkIn(r)` 중 `as === 'buyer'` 인 줄(받는 분 번호로 찾은 `recv` 줄은 제외) 가운데 그 주문번호(`pno || order_no`)의 match 줄이 딱 1개인 주문의 `qty`**(검토자 Q5 · 쿠팡·자사몰 한 주문 여러 줄 = match 여러 개 = 단추 없음 · 안내 「주문이 여러 줄이라 최종발주 카드에서 박스별로」) · 그 `qty ≥ 2` 이고 `ordList(r).length < 2` 면 `lkText` 의 「n박스」 글자를 `<button class="om-btn sm om-boxbtn" data-cact="boxcard" data-ri data-o="(pno||order_no)">n박스 · 박스별로</button>` 로 바꿈 · `ordHtml`(1556~1559) 주문 2건↑ 목록 줄마다 같은 조건이면 같은 단추(data-o = 그 주문) · 주문 못 찾음·1박스·여러 줄 주문 = 단추 없음.
- 입력삭제 줄(`isIndivText`)·현금 줄·보내는이 줄·날짜 줄 = 단추 없음(④).

### 4-2 박스별 카드(`om-boxes-ri` 판 · `ordHtml` 아래 `<div id="om-box-ri">`)
- 박스 수 = 고른 주문 `qty`(2~20 · 넘으면 「20박스까지만」 안내) · 줄마다: 번호 「박스 n」 · 꼬리 = `sizeItem(option)` 이면 칩 2S/S/M/없음(`om-seg` 꼴 · 처음 값 = 줄에 적힌 사이즈 전부) · `gwaItem(option)` 이면 과수 숫자 칸(처음 값 = 줄 과수) · 그 밖 = 꼬리 칸 없음 · 받는 분 이름(placeholder = lookup `recv_name` 또는 「주문 그대로」) · 번호1·번호2(placeholder 「주문 그대로」) · 주소(placeholder = lookup `addr`) · 배송메세지(placeholder 「주문 그대로」) · 보내는 분 이름·번호(placeholder 「주문 그대로」) · ☐ 이번에 안 보냄 · 「전부 같게」 = 1번 박스 값을 모든 박스에(최종발주 위쪽 꼬리 칸 꼴).
- 빈칸 = 주문 그대로(최종발주 BOX 규칙과 같음) · 번호 칸은 숫자·하이픈만 · 저장 단추 = **[박스별로 저장]**(카드 전체 [저장]과 별개가 아님 — 체크·고른 뜻은 저장 단추가 실행 = 메모리 feedback-save-button-does-pending-action · 카드 [저장] 을 누르면 열려 있는 박스 판도 같이 저장).
- 저장 = 그 줄을 **박스별 줄로 바꿈**: `kind 'line'` · `key` 그대로(구매자 번호) · `plat` · `checked = { plat, as, at, buyer?, pno: 고른 주문 pno }`(`smSave` 1448~1455 꼴) · `boxes = [...]`(§2-2 꼴 · 꼬리는 `t` 에 「S사이즈로!」 꼴 = `tailFromNote`(998~1005) 와 같은 글자) · `note = '박스별 ' + 요약` · `line = [날짜, key, note, plat].join('\t')` · 요약 = 「2박스 · S 1 · M 1 · 박스2 받는 분·보내는 분 바꿈 · 박스3 안 보냄」(최종발주 `boxText`·`boxExtraText` 낱말 그대로 · 주소·번호 글자는 요약에 안 넣음).
- 전부 빈칸(바꾼 것 0 · 꼬리도 전부 줄 사이즈와 같음) → 저장 안 하고 종전 사이즈 줄 그대로(안내 「박스마다 다른 것이 없어 사이즈 줄로 저장해요」).
- `outRow`(2267)·`stripTmp`(1532) 에 `boxes` 보존 · `API.save/update` body rows[].boxes · 고치기(edit) 모드 = `r.boxes` 있으면 판을 펼쳐 둠 · 번호를 바꾸면 판 비움(주문이 달라짐).

### 4-3 목록·표시
- 목록 줄(733 `previewOf`) = 요약 글 그대로 + 알약 `<span class="om-pill k-box">박스별 n박스</span>`(648 `cashPill` 옆 새 `linePill`) · 정리 결과 카드 머리 tags(1101~1103) 에 「박스별 n줄」.
- `DUP_KINDS`(1897) **맨 앞**에 `['box', '박스별', n => /^박스별/.test(n)]` 를 넣고 `size` 판정 함수는 `!/^박스별/.test(n) && (종전 정규식)` 으로(요약 글은 `박스n=S` 꼴이라 종전 정규식에 안 걸리지만 이중 안전 · 검토자 Q8) — 같은 번호에 열린 박스별 줄이 있으면 종전 「바꿀지 묻기」 길(되묻기 아님 · 종전 겹침 판정) · 같은 번호 사이즈 줄 + 박스별 줄 = 박스별이 최종발주에서 이기므로 사이즈 줄은 묻기 대상(「사이즈 줄은 박스별 줄에 들어 있어요 · 지울까요」).
- css: `.om-boxbtn`(om-lk 안 단추 · `om-lk-fix` 꼴 406~407) · `.om-boxrow`(격자 · 폰 390 = 칸 세로 · PC = 받는 분 3칸 한 줄) · `.om-pill.k-box`.

## 5. 검증 계획(꼭 필요한 것만 · 대표 「효율적으로 나눠」)

| 번호 | 무엇 | 누가 | 꼴 |
|---|---|---|---|
| V1 | 서버 순수 = `verify-1021-server.js`(pglite · 실제 order-memo.js) : 저장 boxes → GET rows boxes 그대로 · `cleanBoxes` 거름(21개·긴 글·모르는 칸·전부 빈칸 → null) · for-ship `box_rows` 1 · `memo_text` 에 없음 · 뒤 날짜 `box_wait` · 지난 날짜 held · PUT boxes null 지움 · 번호 바꾸면 boxes·checked 비움 · 박스별 줄은 `isIndivLine` 거짓 | 워커2 | verify-938-roundtrip 꼴 · 약 20항목 |
| V2 | 최종발주 실코드 = `verify-1021-fo.js`(verify-955-fo 꼴 · 가짜 주문 2박스+3박스 · 가짜 for-ship `box_rows`) : ①직접 고치기 카드 박스 줄 미리 채움(사이즈 칩 on · 받는 분 이름 · 보내는 분 칸 값) ②[파일 만들기] → 택배사 양식 2줄(옵션 「… S사이즈로!」/「… M사이즈로!」 · 수량 1·1 · 2줄째 수취인명·보내는사람 「○○ 드림」·연보라) ③박스 수 다름 1건 = 카드 1 + 파일 종전 ④`box_rows` 없음 = 결과 파일 바이트 종전 HEAD 와 동일(무회귀) | 워커3 | 약 15항목 |
| V3 | 메모함 실클릭 1회 = `verify-1021-ui.js`(verify-955-ui 꼴 · pglite + 실제 ao-ordermemo.js) : 사이즈 줄 → 「2박스」 단추 → 판 → 저장 → for-ship `box_rows` · 고치기 재열기 · 390/1280 넘침 0 | 워커1 | Playwright 1회(총괄 줄 세움) |
| 스모크 | `verify-900-2b` 1회(워커1 파일 바뀜) | 교차 점검 때 | 종전 |

- 안 돌리는 것: 508-ui B 전체 · 568-dark(색 토큰 새로 안 씀 · `.om-pill.k-box` 는 종전 알약 색 재사용) · 자동 송장 검증(주문 단위 무변경).

## 6. 순서

1. 설계서 → 총괄 → 대표 「고」.
2. 워커3 = final-order.js(§3 · V2) — 워커1·2 와 동시에 가능(파일 겹침 0 · 메모함 쪽이 없어도 `box_rows` 가짜로 검증).
3. 워커2 = order-memo.js(§2 · V1) + docs/850-api.md — #1019 끝난 뒤.
4. 워커1 = ao-ordermemo.js·css(§4 · V3) — #1020 끝난 뒤 · #1020 line badge 가 박스별 줄을 어떻게 볼지 한 줄 맞춤(제안 = 박스별 줄도 `pno`/번호로 매칭완료·실패 배지 · 안 되면 배지 없음).
5. 교차 점검 1회(시공자 아닌 워커 · diff 읽기 + V1~V3 결과 대조) → 배포(총괄).

## 7. 검토자(빌더 점검) 대조 뒤 워커3이 정한 것 — 대표·총괄이 다르게 원하면 말해 주세요
| | 물음 | 정한 것 |
|---|---|---|
| Q1 | 「박스별 …」 줄이 `checkLine` 파서에 걸려 `sure=false` 가 될 수 있음 | 배송메모 줄과 같이 파서 건너뜀(§2-2) + 요약 글에 빈칸 앞 사이즈 글자 안 씀(`박스1=S`) |
| Q2 | 쿠팡·자사몰 한 주문 여러 줄 = 같은 pno 로 주문 2줄↑ | 박스별은 **주문 1줄일 때만** · 여러 줄이면 메모함 단추 없음 + 최종발주는 확인 카드(§3-3·§4-1) |
| Q3 | 최종발주 카드에서 박스 전부 같은 값 + 보내는 분 적으면 종전 분기가 보내는 분을 버림 | 묶음 1개라도 보내는 분 있으면 박스별 길(§3-3) |
| Q4 | 열쇠를 바꾼 줄은 주문 단위 「보내는이 변경주소」(13번째 칸)를 잃음 | make() 에서 그 주소를 직접 싣는다(§3-4) · 색 = 연보라 |
| Q5 | 메모함 「n박스」 수의 출처 | 구매자 번호 match 줄 1개인 주문의 qty(§4-1) |
| Q6 | 메모함 값과 같아도 「바꿈」으로 보이는 비교식 | 저장된 박스 순서 `om.arr` 와 비교(§3-3) |
| Q7 | 옛 화면·중간발주 for-ship(sm≠1) 응답 | `box_rows` 지움(§2-3) |
| Q8 | 겹침 판정(DUP_KINDS)이 박스별 줄을 사이즈 줄로도 봄 | box 종류 먼저 + size 판정에서 「박스별」 제외(§4-3) |
| 확인 | core `buildRows` 의 `p.key` 는 `senderOf` 에만 쓰임 · `boxArr`·`boxGroupX`·`boxExpand` 는 BOX_F 순회라 sn·sp 자동 수용 · `cleanChecked` 화이트리스트 · lookup 응답 `qty` 있음 | 설계 그대로 |

## 8. 열어 둔 것(후보 · 이번엔 안 함)
- 박스별 「보내는이 변경주소」 칸 · 박스별 줄의 #1020 배지 · 메모함 카드에서 받는 분 번호·배송메세지 실제 값 보이기(lookup 응답 확장 = order-memo.js 823~828 · 개인정보 칸 늘어남 → 대표 결정) · 20박스 넘는 단체 주문(최종발주도 20 한도).
