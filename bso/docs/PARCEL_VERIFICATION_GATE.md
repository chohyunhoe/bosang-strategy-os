# PNU→SHP 필지 검증 게이트

## 결론

광명시흥 그래픽 게이트는 지도 렌더링 전에 `parcel_verification_result.json`을 먼저 생성합니다.
검증 결과가 `PASS`가 아니면 QGIS 지도, VWorld 항공사진 결합본, `final_sample_brief.pdf` 생성을 모두 차단합니다.

공주 manifest에는 검증 설정을 활성화하지 않았으므로 기존 공주 실행경로는 변경하지 않습니다.

## 검증 대상

광명시흥 manifest의 필수 검증 PNU는 다음과 같습니다.

- 과림동 120-7: `4139011200101200007`
- 과림동 120-8: `4139011200101200008`
- 과림동 130-7: `4139011200101300007`

각 PNU는 원본 SHP의 `PNU` 필드에서 **정확히 1건** 검색되어야 하며, `JIBUN` 속성도 각각 `120-7`, `120-8`, `130-7`로 시작해야 합니다.

## 결과 파일

```text
bso\graphics-output\GMSH_GWARIM_120_7_120_8\parcel_verification_result.json
```

결과에는 다음이 포함됩니다.

- 원본 SHP 파일명·경로
- feature ID
- 원본 DBF 전체 속성
- 원본 CRS 정보와 WKT
- geometry centroid
  - 원본 CRS
  - EPSG:5174
  - EPSG:4326 경도·위도
- geometry 면적과 bounding box
- 세 필지의 모든 조합에 대한
  - 거리(m)
  - 동서·남북 증분
  - 북쪽 기준 방위각
  - 8방위 상대방향
- manifest와 입력 ZIP의 크기·수정시각을 반영한 검증 지문

## FAIL 조건

다음 중 하나라도 발생하면 `FAIL`입니다.

- PNU 검색 건수가 0건 또는 2건 이상
- SHP 또는 PNU 필드 로딩 실패
- geometry 또는 centroid 생성 실패
- PNU와 `JIBUN` 속성 불일치
- 필수 PNU 설정 누락·중복
- 검증 이후 manifest 또는 입력 ZIP 변경으로 기존 PASS 지문이 만료됨

검증 실패 시 과거 `overview`, 비교지도 및 `final_sample_brief.pdf`를 제거하여 새 산출물로 오인되지 않도록 합니다.

## Windows 검증만 실행

`bso` 폴더에서:

```bat
RUN_PARCEL_VERIFICATION.cmd graphics-input\gwangmyeong_siheung.json
```

정상 결과:

```json
{
  "status": "PASS",
  "required_count": 3,
  "verified_count": 3
}
```

## 검증부터 최종본까지 단일 실행

```bat
RUN_GRAPHICS_GATE.cmd graphics-input\gwangmyeong_siheung.json
```

실행 순서:

1. `run_parcel_verification.py`
2. PASS 확인
3. `run_graphics_gate.py`
4. `run_sample_brief.py`

검증이 FAIL이면 2단계 이후로 진행하지 않습니다.

## PC에서 실행할 단일 명령

PowerShell의 현재 위치가 `bso` 폴더인 경우:

```powershell
.\RUN_GRAPHICS_GATE.cmd graphics-input\gwangmyeong_siheung.json
```

저장소 루트에서 한 번에 실행하려면:

```powershell
cd .\bso; .\RUN_GRAPHICS_GATE.cmd graphics-input\gwangmyeong_siheung.json
```

## 검토 순서

1. `parcel_verification_result.json`의 `status` 확인
2. 각 레코드의 `full_attributes.PNU`, `full_attributes.JIBUN` 확인
3. EPSG:4326 중심점과 실제 지도 위치 대조
4. `pairwise_relationships`의 거리·방향 확인
5. PASS인 경우에만 QGIS 지도와 칸샘플형 PDF 육안검수

지도나 항공사진을 생성형 이미지로 대체하지 않습니다.
