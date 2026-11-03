# #1001 인수인계(11/3 · 워커3) — 시공·가짜 자료 검증 끝 · 미커밋(패치 사본 ~/.akkome/wip-1001.patch · 새 파일 사본 ~/.akkome/wip-1001/)
바뀐 파일: scripts/desk/keyword-rank.js · server.js(krNoticeLines·틱) · public/app.js(renderRankAuto) · 새 파일 = scripts/verify-1001-keyword-auto.js(96/96) · docs/1001-keyword-auto-config.json(설정 keyword_rank.auto 값). verify-910-rank.js 30/30.
결정(총괄 채택): 고정 = 귤·제주귤·감귤·제주감귤 · 나머지 자동 · 품절 상품 짝 미리 깔기 · ignore = 대용량 12957301776·VIP 10801253976 · 취나물 13392734089 는 낱말 불확실해 짝 빼고 재오픈 때 알림으로.
배포 뒤 총괄: 설정 keyword_rank 에 auto = 위 json 합치기 + keywords 12→4(순서 무관 · 설정 전엔 종전과 같게 돔) · app.js 캐시 번호 · 확인 = `node scripts/desk/keyword-rank.js --list`(어사이드·쓰기 0) → 12개 기대.
남은 확인: 실제 어사이드 --dry(총괄 신호 뒤 · 키워드 2개 이하) · 보안 확인 실화면 멈춤은 가짜 자료로만 봄 · 실화면 순위관리 칸은 다음 09:30 수집 뒤 보임.
