# #910 네이버 키워드 순위 자동 수집(어사이드 · 09:30 · 텔레그램) — 설계(총괄 claude-56 · 2026-10-28 · 대표 「고」)

대표 원문: 「우리가 매일 네이버 순위 조사하고 회사프로그램에 올리는데 매일 오전 9시 30분쯤 · 이걸 어사이드로 · 텔레그램으로도 보내주는 거지 · 우리가 판매하는 상품들로 매일 체크되고 순위도 보게」 → 「대조 안 하고 바로 진행 · 이상은 우리가 보고 알 수 있어 · 9시 30분 · 고」.

## 구도
- 대표 PC 창구 대기 프로그램(launcher.js)이 KST 09:30 하루 1회 `node scripts/desk/keyword-rank.js --apply` 를 띄움(scratchMaybe 꼴 · 기다리지 않음 · 결과는 로그 + 설정 keyword_rank_last).
- keyword-rank.js = 어사이드(aside.exe · MCP stdio exec/repl 를 스크립트가 직접 말함 · Claude 호출 0 · 토큰 0)로 키워드마다 ①m.shopping.naver.com 검색 → 광고 표시 뺀 목록에서 우리 스토어 첫 상품 위치 = 쇼핑 순위 ②광고 묶음 안 위치 = 광고 순위 ③m.search.naver.com 통합검색 파워링크 묶음 안 위치 = 파워링크 순위 · 40위(2쪽) 밖·없음 = NULL.
- 저장 = keyword_rankings UPSERT(date, keyword) — 기존 /api/rankings/bulk 와 같은 SQL · created_by NULL + 새 칸 source TEXT('auto'|'manual') · 직원이 같은 날 손으로 붙여 넣으면 manual 이 덮음(종전 upsert 그대로).
- 서버 1분 틱(server.js) = keyword_rank_last.date 가 오늘이고 notified 아니면 텔레그램 1통(지금 카톡 글 꼴 「아꼼이네 주요 키워드 순위기준 (YY.MM.DD. HH:MM 기준) 쇼핑검색-모바일 귤(28위) 광고3위 파워링크5위 …」 + 어제 대비 ↑↓ · 없음 = 「-」) + 회사프로그램 알림 종(type rank) · 10:00 지나도 오늘 auto 줄 0 이면 텔레그램 「오늘 순위 미수집 — 직원 손 입력」 1통(하루 1회).
- 설정 agent_office_config 'keyword_rank' = { enabled:true, time:"09:30", keywords:[귤·제주귤·감귤·제주감귤·타이벡귤·황금향·제주황금향·레몬·제주레몬], store:{ names:["제주아꼼이네"], hosts:["smartstore.naver.com/jejuakkome","brand.naver.com/jejuakkome"] }, max_rank:40, miss_alert:"10:00" } — 총괄이 배포 뒤 넣음. 키워드 목록 = 순위관리 화면 칸에서 전 직원 편집(PUT).
- 화면 순위관리 = 키워드 목록 칸([저장] · 전 직원) · 자동 줄 「자동」 배지 · NULL = 「-」 · 그래프 spanGaps 그대로.

## 배정
- A 워커3(claude-6a · Fable · 어사이드) = scripts/desk/keyword-rank.js(--dry 기본 · --apply · --date) + 오늘 09:07 직원 값과 1회 비교 숫자 보고(대조 기간은 없음 · 참고만). 네이버 로그인 상태 어사이드 창 · 429·캡차 = 그 키워드 NULL + errors[] · 한 키워드 3쪽 넘게 안 봄 · 요청 사이 1.5초.
- B 워커2(claude-35 · 서버·launcher) = server.js 틱 2종 + 텔레그램 글 + 알림 + source 칸 + 설정 PUT /api/rankings/keywords(전 직원) · launcher.js 09:30 틱 · verify-910.
- C 워커1(claude-5d · 화면) = public/app.js 순위관리 키워드 목록 칸·자동 배지·「-」 · 캐시는 총괄.
- 총괄 = 설정 넣기 · 배포 · 창구 재시작 · 첫 09:30 실동작(10/29) 확인 · CLAUDE.md·업무지식 한 줄.

## 한계(대표에게 알림 끝)
모바일 결과는 로그인·개인화·지역으로 직원 폰과 1~3위 차이 가능 · 광고·파워링크는 입찰 순환 · PC 꺼짐·네이버 막힘이면 그날 미수집 알림 → 직원 손 입력.
