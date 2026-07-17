// AGENT OFFICE 실행 스크립트 — 예리 (마케팅팀 · 분석)
// 1차: 테스트 실행 모드. 후속 차수에서 Instagram Graph API/네이버 쇼핑 검색 연결.
module.exports = {
    steps: ['인스타 성과 데이터 수집 중...', '경쟁사 가격 조사 중...', '분석 리포트 정리 중...'],
    stepDelayMs: 2000,
    result() {
        return {
            summary: '완료: 테스트 실행 성공',
            lines: [
                '성과 기록 시나리오 테스트 통과',
                '경쟁 분석 파이프라인 정상',
                '인스타/네이버 API 연결은 후속 차수에서 진행됩니다',
            ],
        };
    },
};
