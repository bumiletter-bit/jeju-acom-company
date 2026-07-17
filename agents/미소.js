// AGENT OFFICE 실행 스크립트 — 미소 (마케팅팀 · 디자인)
// 1차: 테스트 실행 모드. 후속 차수에서 Gemini 이미지/Higgsfield 영상 연결.
module.exports = {
    steps: ['브랜드 가이드 확인 중...', '시안 방향 구상 중...', 'Gemini 프롬프트 작성 중...'],
    stepDelayMs: 2000,
    result() {
        return {
            summary: '완료: 테스트 실행 성공',
            lines: [
                '브랜드 컬러(#F5C800/#1B3A6B) 가이드 로드 정상',
                '이미지 프롬프트 생성 시나리오 테스트 통과',
                'Gemini/Higgsfield 연결은 후속 차수에서 진행됩니다',
            ],
        };
    },
};
