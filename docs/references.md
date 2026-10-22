# 참고 서비스·연구와 이 프로젝트의 선택

2026-10-22 공식 문서·논문 조사에 근거한 방향 비교다. 아래 서비스는 이 저장소의 실행 의존성이 아니며 실제 가입·업로드·유료 사용·성능 비교를 수행하지 않았다. 공급자의 기능 설명과 이 프로젝트의 설계 제안을 구별한다.

## 3D-RE-GEN · 객체와 환경을 함께 구성

[프로젝트](https://3dregen.jdihlmann.com/) · [논문](https://arxiv.org/abs/2512.17459) · [공식 코드](https://github.com/cgtuebingen/3D-RE-GEN)

단일 이미지의 객체와 배경을 분리하고 맥락 기반 보완·3D 자산 생성·배치를 결합한다. 초기 마스크 민감성, 배경 구멍·좌표 정합, 방향 최적화와 객체 세분화의 한계를 밝힌다. 지면에 놓이는 객체의 평면 정렬 제약이므로 한국화의 복수 시점·산악·여백에 그대로 적용된다고 가정하지 않는다.

참고할 점: component/환경 분리와 원본 시점 검수. 그 파이프라인 자체를 이 프로젝트의 독창성으로 주장하지 않는다.

## SAM 3D Objects · 맥락을 활용한 객체 생성

[공식 저장소](https://github.com/facebookresearch/sam-3d-objects) · [논문](https://arxiv.org/abs/2511.16624)

전체 장면과 객체 단서를 사용해 형상·질감·배치를 생성한다. 객체별 예측이며 접촉·안정성·관통 같은 물리 상호작용을 학습한 시스템은 아니다.

참고할 점: 객체 생성과 장면 조립의 검증을 분리한다. 숨은 면 생성은 실제 뒷면을 알아냈다는 뜻이 아니다.

## SceneReGen · 생성한 객체를 원본 장면에 배치

[논문](https://arxiv.org/abs/2608.23930)

완성 객체 생성과 공통 좌표계 배치를 연결한 공개 프리프린트다. 주요 정량 결과는 3D-FUTURE 부분집합 조건이며 저해상도 입력·강한 가림·질감·충돌 문제를 한계로 밝힌다.

참고할 점: 객체 품질과 장면의 위치·크기·상호 관통을 따로 평가한다. 사진·합성 실내 결과를 한국화 성능으로 일반화하지 않는다.

## World Labs Marble · 공간 탐색과 편집

[공식 소개](https://www.worldlabs.ai/blog/marble-world-model) · [생성과 편집](https://docs.worldlabs.ai/marble/create/prompt-guides/create-and-edit) · [메시 내보내기 한계](https://docs.worldlabs.ai/marble/export/mesh)

입력으로 탐색 가능한 세계를 만들고 편집·확장하는 방향이다. 단일 이미지에 없는 부분은 새로 생성되며, 메시 변환에는 구멍·떠 있는 표면 등의 한계가 있다. 모든 물체가 독립 편집 메시라고 일반화하지 않는다.

참고할 점: 생성 버튼보다 공간을 탐색하는 감상 흐름을 설계한다. 무한 확장 대신 원작과의 관계를 유지한다.

## Meshy · Tripo · 자산 제작과 국소 수정

[Meshy 이미지→3D](https://help.meshy.ai/en/articles/9996860-how-to-use-meshy-image-to-3d) · [Tripo 이미지→모델](https://developers.tripo3d.ai/en/docs/generation-image-to-model/standard) · [Tripo 국소 편집](https://developers.tripo3d.ai/en/docs/mesh-edit)

Meshy는 보이지 않는 부분을 추측하며 단일 대상을 권장한다. Tripo는 영역별 메시 수정 기능을 제공한다. 원본 색 우선 옵션이 원본 형상·구도 보존을 보장하지는 않는다.

참고할 점: 잘못 해석된 객체만 수정하는 작업 흐름. 이 갤러리는 범용 자산 제작기와 달리 작품의 맥락·여백·감상을 중심에 둔다.

## Apple SHARP · 좋은 시점 이동 영상과 완전한 3D 구별

[공식 소개](https://machinelearning.apple.com/research/sharp-monocular-view) · [논문](https://arxiv.org/abs/2512.10685)

사진에서 가까운 시점 이동을 위한 Gaussian 표현을 생성한다. 먼 시점 이동은 후속 과제이며 지각적 영상 품질 지표가 실제 형상·숨은 면의 정답을 입증하지 않는다.

참고할 점: 지원 시점 범위를 밝히고 고정 경로에서 감상 품질을 점검한다. 자유 회전 UI를 360도 품질 보장으로 설명하지 않는다.

## Google PAIR · 회화의 깊이 해석

[탐색 프로젝트](https://pair-code.github.io/depth-maps-art-and-illusions/art_history_vis/blogpost/blogpost_1.html)

회화 깊이 예측에서 시점 변경 시 드러나는 구조 오류와 정답 깊이 부재를 논의한 탐색 연구다. 최신 모델 비교 벤치마크나 한국화 일반 성능의 증거는 아니다.

참고할 점: 원작 구도 정합성·구조적 개연성·지각 품질을 분리한다. 구조 보존형 3D 점묘의 효과는 이 프로젝트에서 별도 검증해야 한다.

[제품 방향](project-direction.md) · [목표와 완료 기준](roadmap.md)
