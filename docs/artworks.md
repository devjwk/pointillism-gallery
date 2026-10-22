# 조선 회화 6점 추가

기존 회화 3점과 공개 예시 사진 1점을 그대로 두고 회화 6점을 추가했습니다. 갤러리는 **회화 9점 + 기존 예시 사진 1점 = 10점**입니다.

| 작품 | 작가 | 표시 연대 | 받은 원본 크기 | 출처·감상용 파일 |
|---|---|---|---|---|
| 금강전도 | 정선 | 1734 | 1630×2272 | [Commons](https://commons.wikimedia.org/wiki/File:Jeong_Seon-Geumgangjeondo.jpg) · [JPEG](../assets/artworks/images/geumgangjeondo.jpg) |
| 서당 | 김홍도 | 조선 후기 | 3663×4298 | [Commons](https://commons.wikimedia.org/wiki/File:Danwon_Seodang.jpg) · [JPEG](../assets/artworks/images/seodang.jpg) |
| 무동 | 김홍도 | 조선 후기 | 3637×4273 | [Commons](https://commons.wikimedia.org/wiki/File:Danwon_Mudong.jpg) · [JPEG](../assets/artworks/images/mudong.jpg) |
| 단오풍정 | 신윤복 | 조선 후기 | 1079×870 | [Commons](https://commons.wikimedia.org/wiki/File:Hyewon-Dano.pungjeong.jpg) · [JPEG](../assets/artworks/images/dano-pungjeong.jpg) |
| 월하정인 | 신윤복 | 조선 후기 | 2180×1868 | [Commons](https://commons.wikimedia.org/wiki/File:Hyewon-Wolha-jeongin-2.jpg) · [JPEG](../assets/artworks/images/wolha-jeongin.jpg) |
| 세한도 | 김정희 | 1844 | 12424×3325 | [Commons](https://commons.wikimedia.org/wiki/File:Sehando.jpg) · [JPEG](../assets/artworks/images/sehando.jpg) |

## 공개 사용 근거와 출처

- 각 파일의 Wikimedia Commons `imageinfo.extmetadata`에서 **LicenseShortName: Public domain**, **Copyrighted: False**, **Restrictions: 빈 값**을 확인한 파일만 선정했습니다. 이번 확인 범위는 이 6개 파일입니다.
- 원본 바이트 수와 Commons SHA-1을 대조했고 SHA-256도 기록했습니다. 파일별 출처 URL·다운로드 URL·크기·확인 시점·해시는 [출처 명세](../assets/artworks/sources.json)에 있습니다.
- 퍼블릭 도메인 회화와 충실한 복제 이미지에 대한 Commons 표시를 근거로 선택했습니다. 별도 모델·라이브러리 라이선스까지 이 표시로 허가되는 것은 아닙니다. 기존 예시 사진도 퍼블릭 도메인으로 간주하지 않습니다.
- 원본 제작 연대가 불확실한 서당·무동·단오풍정·월하정인은 단정한 연도 대신 **조선 후기**로 표시했습니다. 작품 해설은 수동 작성이며 자동 의미 인식 결과가 아닙니다.

## 데이터 구성

- `assets/artworks/catalog.js`: 기존 4점 데이터 + 새 6점의 작품 정보·프리셋·출처·지도 경로.
- `assets/artworks/maps/*.json`: 작품마다 밝기 900px 이하, RGB 420px 이하, 상대 깊이 520px 이하의 gzip/base64 지도. 파일의 `w/h`, `rw/rh`, `dw/dh`는 각 지도의 실제 크기입니다.
- `assets/artworks/images/*.jpg`: 원본의 비율을 유지한 1600px 이하 감상용 JPEG. 프로젝트에서 자르거나 확대하지 않았지만, Commons에 올라온 파일이 원화 전체나 두루마리 전체라는 뜻은 아닙니다.
- `assets/artworks/sources.json`: 원본과 파생 파일의 해시·크기, 실제 깊이 추정 실행 정보, 수동 해설과 한계.

새 지도를 한꺼번에 초기 스크립트에 넣지 않고 **작품 선택 시 해당 JSON만 GET**합니다. 로딩·압축 해제 실패는 오류로 표시하며, 다음 선택에서 재시도합니다. 성공한 지도는 탭 메모리에 재사용합니다.

## 실제 수행과 한계

- 6개 공개 이미지에서 Depth Anything V2 small q8을 Transformers.js 3.5.1 + 브라우저 로컬 WASM으로 실제 실행했습니다. 가중치는 저장소에 넣지 않았습니다.
- 밝기와 색상은 원본 이미지에서 계산했으며 확대 생성·얼굴 복원·숨은 면 생성은 하지 않았습니다.
- 깊이는 회화에서 추정한 상대값입니다. 실측 거리·정답 3D·완전한 뒷면이 아니며, 회화의 배치와 물리적인 공간 깊이가 일치한다고 보장하지 않습니다. 명암·필치 부조와 감상 프리셋도 정확도 향상의 증거가 아닙니다.
- **새 6점의 SAM 분할은 아직 실행하지 않았습니다.** 미리 만든 의미 마스크나 자동 피사체 이름이 있는 것처럼 표시하지 않습니다. 구성요소 분석 버튼은 기존처럼 별도로 실행할 수 있습니다.
- 모델 이름·라이브러리 버전·실행 시점은 기록했지만 고정 모델 리비전과 브라우저 픽셀 처리까지 묶은 완전한 비트 재현을 주장하지 않습니다.
- 모바일 실기기 성능과 다수 입력에 대한 지각 품질은 별도 검증 과제입니다.

## 검증 기록

- **JavaScript 64개 통과:** 기존 회귀, 새 6점의 gzip 지도·픽셀 수·출처·상대 깊이 기록, 지연 로더의 중복 요청·404 재시도·잘못된 경로·손상된 데이터 거부, 해설 이스케이프와 출처 링크 안전성.
- **로컬 PC 브라우저에서 새 6점 모두 확인:** 지도 로딩, 점묘 렌더링, 양축 360° 이상 실제 드래그 회전, 확대, 밀집도 100% → 0% → 100%. 각 작품에서 동일 점 풀·밝기 데이터·캐시가 유지됐고 검사 시 WebGL 오류 값은 0이었습니다.
- **기존 4점 재확인:** 모두 로딩·렌더링됐고, 기존 밝기·깊이·색상·분할 데이터의 해시를 자동 검사로 보존 확인했습니다.
- **GitHub Pages 하위 경로 확인:** `/pointillism-gallery/` 아래에서 새 지도 6개가 개별 `fetch`로 로드됐으며, 이미 본 작품을 다시 선택할 때 추가 지도 요청이 없었습니다. 네트워크 기록은 지도 로딩·캐시 범위 확인이지 전체 네트워크 감사가 아닙니다.
- [실제 로컬 브라우저 검사 기록](results/joseon-artworks.json). 데스크톱 1440×900, DPR 2의 관측이며 모바일 실기기 성능이나 지각 품질을 보증하지 않습니다.
