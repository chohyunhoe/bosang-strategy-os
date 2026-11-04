# Technical Debt

PR-29G-1은 신규 기능을 추가하지 않고 PR-29H 의견서 보조문안 생성 전 화면 문구와 안전 고지를 안정화하는 범위로 진행했습니다. 아래 항목은 이번 PR에서 바로 통합하지 않고 후속 정리 대상으로 남깁니다.

## 후속 정리 필요 항목

- **stable wrapper chain 정리 필요**: stable1~16 계층형 override가 누적되어 함수 흐름 추적이 어렵습니다. 단, stable16 기준선 훼손 위험이 있어 이번 PR에서는 통합하지 않습니다.
- **CSS `:root` / override 통합 필요**: 전역 변수와 후행 override가 함께 남아 있어 스타일 변경 영향 범위를 파악하기 어렵습니다. 이번 PR에서는 CSS 전체 통합이나 재작성은 하지 않습니다.
- **`renderAll` 전체 재렌더 최적화 필요**: 일부 입력·검수 동작에서도 전체 섹션이 재렌더되어 성능과 스크롤 안정성 리스크가 있습니다. 후속 PR에서 섹션 단위 렌더 계약을 먼저 정리해야 합니다.
- **개발자 상세 메뉴 사용자 노출 최소화 필요**: JSON·API·OCR 관리, RowBand, Entity 후보, fallback 등 개발자 상세 용어는 일반 사용자 흐름에서 숨기거나 쉬운 설명을 병기해야 합니다. 이번 PR에서는 기능명은 유지하고 설명 문구만 보완했습니다.

## PR-30A 후속 정리 필요 항목

- **CSS override 통합은 별도 PR 필요**: 이번 PR은 모바일 워크플로우 안정화를 위해 공통 class를 재사용·보정했지만, 누적된 CSS override 전체 통합은 안정성 검토 후 별도 PR에서 처리해야 합니다.
- **stable wrapper chain 통합은 별도 PR 필요**: stable wrapper chain은 기존 동작 보존을 위해 유지했습니다. 함수 재배치는 회귀 범위가 크므로 별도 PR에서 정리해야 합니다.
- **renderAll 전체 재렌더 최적화는 별도 PR 필요**: 모바일 UX 보정과 별개로 전체 재렌더 비용 및 스크롤 안정성 최적화가 필요합니다.
- **개발자 상세 메뉴와 사용자 주 플로우 분리 필요**: Gemini importer, raw paste, JSON import 등 개발자성 기능은 고급 fallback으로 낮췄지만, 장기적으로 일반 사용자 주 플로우와 상세 메뉴를 더 명확히 분리해야 합니다.

## PR-30B-2 후속 테스트 부채

- **extraction preview 화면의 상태별 UI 분기 E2E 테스트 필요**: 브라우저에서 업로드 후 `TEXT_EXTRACTED`, `OCR_REQUIRED`, `EXTRACTION_FAILED`별 카드 구조와 접힘 영역 기본 상태를 검증해야 합니다.
- **TEXT_EXTRACTED/OCR_REQUIRED/EXTRACTION_FAILED 상태별 표시 회귀 테스트 필요**: 수동 텍스트 입력, 외부 OCR fallback, primary CTA 표시 조건이 후속 wrapper 변경으로 되돌아가지 않도록 상태별 회귀 테스트가 필요합니다.

## PR-30B-3 후속 테스트 부채

- **후보 검수 모바일 카드 UI의 실제 기기 E2E 테스트 필요**: iOS/Android 실제 브라우저에서 후보 카드 액션, 근거 보기, badge 줄바꿈 방지, 내부 스크롤을 확인해야 합니다.
- **extraction state transition E2E 테스트 필요**: 업로드 직후 `TEXT_EXTRACTION_PENDING`, 실행 중 `EXTRACTING`, 완료 `TEXT_EXTRACTED`, `OCR_REQUIRED`, `EXTRACTION_FAILED`, `CANDIDATES_READY` 전환을 브라우저에서 검증해야 합니다.
- **데스크톱 테이블과 모바일 카드 이중 렌더링 회귀 테스트 필요**: 같은 후보 데이터가 데스크톱 table과 모바일 card list에 일관되게 표시되는지 화면 폭별 회귀 테스트가 필요합니다.
