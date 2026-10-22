# 기능별 구조와 수정 위치

## 목적

**한국 회화를 중심으로 원작의 색·구도·여백을 존중하며 공간을 점으로 탐색하는 갤러리를 지향한다.** 사진은 확장 기능이며, 장기적으로 맥락 기반 새 3D 장면과 자동 설정을 검토한다. 제품 방향·1–4순위·현재 구현은 각각 [방향](project-direction.md), [로드맵](roadmap.md), [현황](status.md)에서 구분한다.

실행 구조는 메인 감상 갤러리, 독립 검증 도구, 미실행 GPU 경로로 나뉜다. 문서 정리는 감상/실험 모드 분리나 생성 기능 구현을 뜻하지 않는다. 검증 도구의 기능을 메인 갤러리에 자동 통합하지 않으며 비공개 연구 자료를 가져오지 않는다.

## 디렉터리

```text
index.html                        기존 주소를 유지하는 갤러리 진입점
assets/artworks/catalog.js        기존에 공개된 작품 데이터
src/gallery/
  core/state.js                  상태와 공통 수치
  analysis/                      밝기·색·선·디테일·깊이 합성
  sampling/                      점 배치·완화·깊이 경계 보간 점
  scene/                         배치·목표 점·작품 전환
  inference/                     브라우저 깊이 추정·SlimSAM 분할
  render/                        WebGL 셰이더·버퍼·프레임 루프
  interaction/                   마우스·터치·키보드 시점 조작
  ui/                            작품 목록·패널·설정·업로드·레이아웃
  performance/                   자동 화질 조절
  bootstrap.js                   초기 실행
  styles.css                     갤러리 스타일
  order.json                     실행 소스 결합 순서
 dist/gallery.js                  생성된 실행 번들
 tools/scene-validation/
  index.html, styles.css         검증 전용 화면
  src/geometry/                  깊이에서 가시면 메쉬 생성
  src/inference/                 로컬 사진 깊이 추정
  src/sampling/                  삼각형 샘플링·참조 시점 밀도
  src/io/                        로컬 파일·스키마·안전성·리포트
  src/app.js                     검증 화면과 렌더러 연결
 pipelines/scene_reconstruction/  일회성 GPU 장면 생성 CLI · 미실행
 tests/js/, tests/python/        자동 테스트
 scripts/                        빌드·경로 점검·미리보기·가시면 변환 CLI
 docs/                           방향·로드맵·레퍼런스·사용법·현황
  results/                       공개 가능한 익명 측정과 검증 근거
  images/                        현행 문서 이미지와 캡처 조건
  archive/                       과거 README·소개 시안·이전 화면
```

## 메인 갤러리는 어떻게 실행되는가

1. `index.html`이 CSS, `assets/artworks/catalog.js`, `dist/gallery.js`를 읽는다.
2. `dist/gallery.js`는 `src/gallery/order.json`에 적힌 22개 소스의 **순서를 유지해 그대로 결합**한 파일이다.
3. 기존 코드를 서로 독립된 ES 모듈로 재작성한 것은 아니다. 공유 상태와 함수 선언 순서를 보존해, 구조 정리와 알고리즘 변경을 분리했다.
4. 소스를 수정하면 `npm run build`로 번들을 갱신하고 둘 다 커밋한다. 생성된 번들을 직접 수정하지 않는다.

분리 직후 데이터와 실행 코드를 다시 합친 내용이 원래 공개 커밋 `0dab2fe2b49e02780b90915f979aa0484ad25084`의 인라인 스크립트와 바이트 단위로 동일한지 확인했다. 당시 해시와 범위는 [분리 기록](gallery-migration.json)에 있다. 이 기록은 해당 구조 변경 시점의 증거이며, 이후 알고리즘 변경까지 동일하다고 보장하지 않는다.

## 기능별 수정 안내

- 선·필치·디테일 추출: `src/gallery/analysis/lines-details.js`
- 깊이 합성과 필터: `src/gallery/analysis/depth-composition.js`
- 기존 점 배치와 완화: `src/gallery/sampling/stipple.js`
- 깊이 경계 빈틈 보간: `src/gallery/sampling/gap-fill.js`
- 점의 이동·셰이더: `src/gallery/render/webgl.js`
- 작품 전환과 점 풀: `src/gallery/scene/transitions.js`
- 업로드·설정 연결: `src/gallery/ui/controls-upload.js`
- 새 표면 점묘 샘플러: `tools/scene-validation/src/sampling/surface-sampler.js`
- 새 사진 → 가시면 메쉬: `tools/scene-validation/src/geometry/visible-surface.js`
- 향후 생성 모델 연결: `pipelines/scene_reconstruction/adapters/`

## 검증과 공개 범위

```sh
npm run build
npm test
npm run test:python:stdlib
npm run preview
# http://127.0.0.1:8790/
# http://127.0.0.1:8790/tools/scene-validation/
```

Node.js 20 이상이면 npm 패키지를 설치하지 않아도 위 JS 빌드·테스트·미리보기를 실행할 수 있다. Python 표준 라이브러리 테스트는 GPU·모델 없이 실행된다. 추가 CPU 기하 테스트는 NumPy/Pillow/trimesh가 필요하고, GPU 생성 경로는 별도 공식 환경이 필요하다.

개인 원본 사진, 변환 결과, 모델 가중치, 실제 환경 변수와 인증 정보는 커밋하지 않는다. 기존에 공개되어 있던 내장 작품과 예시 사진의 데이터는 변경하지 않았다. `.gitignore`는 예방책일 뿐이므로, 게시 전에 `git status`와 diff를 직접 확인해야 한다. 비공개 연구 저장소의 실험 자료는 이 저장소로 옮기지 않는다.
