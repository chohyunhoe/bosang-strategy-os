# 보상전략 OS 그래픽 게이트 v0.1

## 결론

그래픽 게이트는 **연속지적도 ZIP + PNU manifest**를 입력받아 필지를 검증·추출하고, VWorld 위성타일을 로컬 GeoTIFF로 모자이크한 뒤 QGIS에서 필지 경계와 결합해 PNG/PDF를 생성합니다.
지도 게이트가 끝나면 별도 QGIS 프로세스가 칸샘플 형식의 세로형 2페이지 최종본을 조립합니다.

광명시흥은 렌더링 전에 PNU→SHP 검증을 의무화합니다. 검증이 PASS가 아니면 지도와 최종 PDF를 생성하지 않습니다.
공주는 검증 옵트인이 비활성화되어 기존 실행경로를 유지합니다.

## 로컬 준비

`bso/.env`:

```env
VWORLD_API_KEY=발급받은키
QGIS_PREFIX_PATH=C:\Program Files\QGIS 4.2.0\apps\qgis
QGIS_PYTHON=C:\Program Files\QGIS 4.2.0\apps\Python312\python.exe
```

연속지적도 ZIP 위치:

```text
bso\graphics-input\source\
├─ LSMD_CONT_LDREG_5174_충남_공주시.zip
└─ LSMD_CONT_LDREG_5174_경기_시흥시.zip
```

`.env`, ZIP 원문, 그래픽 출력물은 저장소에 커밋하지 않습니다.

## 전체 실행

`bso` 폴더에서:

```bat
RUN_GRAPHICS_GATE.cmd graphics-input\gongju_songseon_donghyeon.json
RUN_GRAPHICS_GATE.cmd graphics-input\gwangmyeong_siheung.json
```

Windows 배치 실행순서:

1. `run_parcel_verification.py` — 검증 옵트인 사건의 PNU·속성·중심점·거리·방향 확인
2. `run_graphics_gate.py` — PNU 추출, VWorld 로컬 모자이크, QGIS 지도·흐름도·보고서 생성
3. `run_sample_brief.py` — 칸샘플형 2페이지 PDF·PNG 조립

광명시흥에서 1단계가 FAIL이면 2·3단계는 실행하지 않습니다.

## 필지검증만 실행

```bat
RUN_PARCEL_VERIFICATION.cmd graphics-input\gwangmyeong_siheung.json
```

결과:

```text
graphics-output\GMSH_GWARIM_120_7_120_8\parcel_verification_result.json
```

세부 계약과 판정기준은 `docs/PARCEL_VERIFICATION_GATE.md`를 따릅니다.

## PNU 자동추출

manifest 예시:

```json
{
  "role": "subject",
  "archive": "source/LSMD_CONT_LDREG_5174_경기_시흥시.zip",
  "pnus": ["4139011200101200007", "4139011200101200008"],
  "lot": "120-7,120-8"
}
```

게이트는 ZIP을 임시폴더에 풀고 SHP의 `PNU` 필드로 필요한 필지를 필터링합니다.
선택 geometry는 `selected-geometry/*.geojson`으로 저장합니다.

## VWorld 배경

헤드리스 실시간 WMTS는 빈 타일을 반환할 수 있으므로 사용하지 않습니다.
필요 범위의 VWorld 위성 JPG 타일을 내려받아 world file·VRT·GeoTIFF를 만든 뒤 로컬 래스터로 사용합니다.

```text
_basemap-cache\z<zoom>_<signature>\
├─ *.jpg
├─ *.jgw
├─ *.prj
├─ mosaic.vrt
└─ vworld_satellite.tif
```

정상 결과 JSON:

```json
"background_source": "VWORLD_LOCAL_TILE_MOSAIC"
```

## 칸샘플형 최종본

### 1페이지

- 대상토지·비교표준지 기본정보표
- `subject_vs_standard.png` 항공사진 위치도
- 평가법인별 개별요인·그 밖의 요인·적용단가 표
- 주장사항 박스

### 2페이지

- 비교표준지·사례 산정표
- `standard_vs_case.png` 또는 사례 지번 마스킹 시 명시적 위치도 생성 불가 표시
- 평가법인별 사례 비교·격차율·결정값 표
- 주장사항 및 REVIEW_REQUIRED 안내

확인되지 않은 값은 추정하지 않습니다.

## 사건별 출력

```text
graphics-output\<case_id>\
├─ parcel_verification_result.json   # 검증 옵트인 사건
├─ overview.png / pdf
├─ subject_vs_standard.png / pdf
├─ standard_vs_case.png / pdf        # 사례 검토 해결 시
├─ other_factor_flow.png / pdf
├─ final_sample_page1.png
├─ final_sample_page2.png
├─ final_sample_brief.pdf
├─ selected-geometry\
├─ _basemap-cache\
├─ graphics_report.md / pdf
├─ brief_graphics_slots.json
└─ graphics_manifest_result.json
```

## Fail-closed 규칙

- PNU 검증 건수가 정확히 1건이 아니면 FAIL
- PNU와 `JIBUN`이 일치하지 않으면 FAIL
- 검증 이후 manifest 또는 ZIP이 변경되면 기존 PASS 무효
- 검증 FAIL 시 과거 지도와 최종본 삭제
- 사례 전체 지번·PNU가 확인되지 않으면 사례 레이어 등록과 `standard_vs_case` 생성 차단
- 좌표·필지·개별요인·법률 또는 감정평가 판단 추정 금지
- 생성형 이미지로 지도·항공사진 대체 금지

## 현재 광명시흥 검증 대상

- `4139011200101200007` — 과림동 120-7
- `4139011200101200008` — 과림동 120-8
- `4139011200101300007` — 과림동 130-7

평가사례는 원문에 `무지내동`까지만 공개되어 있습니다. 사례 PNU를 등록하지 않고 페이지 2는 `REVIEW_REQUIRED`와 위치도 생성 불가 상태를 유지합니다.
