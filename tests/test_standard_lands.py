"""주변 표준지 조회(서버) — 합성 응답·가짜 제공자만 사용(네트워크·키 없음)."""
import unittest
import urllib.parse

from transaction_enrichment.standard_lands import KEEP_FIELDS, search_standard_lands, StandardLandSearch
from transaction_enrichment.providers import ProviderError

TARGET = "9999910101100010000"  # 합성 PNU


def square(lon, lat, d=0.0002):
    return {"type": "MultiPolygon", "coordinates": [[[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]]]}


class FakeGeometry:
    configured = True

    def __init__(self, shapes, fail=()):
        self.shapes = shapes
        self.fail = set(fail)
        self.data_calls = []

    def target(self, pnu):
        if pnu in self.fail:
            raise ProviderError("VWORLD_TRANSPORT_ERROR", "synthetic")
        g = self.shapes.get(pnu)
        return {"status": "EXACT_ONE", "pnu": pnu, "geometry": g, "jibun": None} if g else {"status": "NOT_FOUND", "pnu": pnu, "geometry": None}

    def _data(self, extra):
        self.data_calls.append(extra)
        if extra["data"] == "LT_C_ADRI_INFO":
            return [{"properties": {"li_cd": "9999910101", "full_nm": "가상도 가상시 숲내읍 바위리"}},
                    {"properties": {"li_cd": "9999910102", "full_nm": "가상도 가상시 숲내읍 냇가리"}}]
        return [{"properties": {"emd_cd": "99999101", "full_nm": "가상도 가상시 숲내읍"}},
                {"properties": {"emd_cd": "99999250", "full_nm": "가상도 가상시 들판동"}}]


class FakeLand:
    configured = True
    _api_key = "synthetic-not-a-key"

    def __init__(self, standard_by_ld, land_char):
        self.standard_by_ld = standard_by_ld
        self.land_char = land_char
        self.urls = []

    def _request_url(self, pnu, year):
        return f"https://example.invalid/landchar?pnu={pnu}&stdrYear={year}"

    def _transport(self, url, timeout):
        self.urls.append(url)
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
        if "landchar" in url:
            return {"landCharacteristicss": {"field": self.land_char.get(q["pnu"], [])}}
        ld = q["ldCode"]
        if ld == "9999925000":
            raise ProviderError("VWORLD_API_ERROR", "synthetic failure")
        rows = self.standard_by_ld.get(ld, [])
        return {"referLandPrices": {"field": rows, "totalCount": str(len(rows)), "resultCode": ""}}


def std(pnu, zoning_code, use_code, price, **extra):
    return {"pnu": pnu, "stdrYear": "2026", "pblntfPclnd": str(price), "prposArea1": zoning_code, "prposAreaNm1": "", "ladUseSittn": use_code,
            "ladUseSittnNm": "", "lndcgrCode": "02", "lndcgrCodeNm": "답", "ldCode": pnu[:10], "mnnmSlno": "1", "posesnStle": "SECRET", **extra}


def make():
    a, b, c, d = "9999910101100020000", "9999910102100030000", "9999910101100040000", "9999910102100050000"
    shapes = {TARGET: square(127.0, 36.0), a: square(127.002, 36.0), b: square(127.0, 36.002)}
    standard = {"9999910101": [std(a, "71", "510", 100000), std(c, "71", "510", 110000)], "9999910102": [std(b, "14", "130", 300000), std(d, "99", "999", 1)]}
    land_char = {a: [{"prposArea1": "71", "prposArea1Nm": "농림지역", "ladUseSittn": "510", "ladUseSittnNm": "전"}],
                 b: [{"prposArea1": "14", "prposArea1Nm": "제2종일반주거지역", "ladUseSittn": "130", "ladUseSittnNm": "단독"}],
                 # 같은 코드 99에 서로 다른 명칭 → 채우지 않음
                 d: [{"prposArea1": "99", "prposArea1Nm": "가명칭1"}, {"prposArea1": "99", "prposArea1Nm": "가명칭2"}]}
    geo = FakeGeometry(shapes, fail={d})
    return StandardLandSearch(geometry=geo, land=FakeLand(standard, land_char)), geo, (a, b, c, d)



class StandardLandSearchTest(unittest.TestCase):
    def test_adjacent_legal_dongs_and_code_names_from_land_characteristics(self):
        s, geo, (a, b, c, d) = make()
        r = search_standard_lands({"pnu": TARGET, "year": 2026, "radius_m": 5000, "review_zoning": "농림지역"}, searcher=s)
        assert r["ok"] and r["status"] == "OK"
        assert r["search"]["radius_m"] == 2000  # 상한
        codes = [x["ld_code"] for x in r["search"]["legal_dongs"]]
        # 대상 법정동 먼저 · 인접 리 포함 · 리가 있는 읍면은 읍면 코드로 중복 조회하지 않음 · 리 없는 동은 '00'으로 포함
        assert codes == ["9999910101", "9999910102", "9999925000"]
        failed = [x for x in r["search"]["legal_dongs"] if x["status"] == "FAILED"]
        assert failed and failed[0]["code"] == "VWORLD_API_ERROR"
        rows = {x["pnu"]: x for x in r["rows"]}
        assert rows[a]["prposAreaNm1"] == "농림지역" and rows[a]["ladUseSittnNm"] == "전"
        assert rows[c]["prposAreaNm1"] == "농림지역"  # 같은 코드 쌍으로 채움(다른 PNU 응답)
        assert rows[b]["prposAreaNm1"] == "제2종일반주거지역"
        assert rows[d]["prposAreaNm1"] == ""  # 명칭 충돌 → 채우지 않음
        assert r["name_resolution"]["conflicts"] == {"prposArea1": ["99"]}
        assert "posesnStle" not in rows[a] and set(rows[a]) <= set(KEEP_FIELDS) | {"ldCodeNm", "name_filled_from_land_characteristics", "name_sources"}
        assert rows[a]["ldCodeNm"] == "가상도 가상시 숲내읍 바위리"


    def test_only_exact_one_parcels_get_coordinates(self):
        s, geo, (a, b, c, d) = make()
        r = search_standard_lands({"pnu": TARGET, "year": 2026}, searcher=s)
        loc = r["locations"]
        assert loc[a]["status"] == "EXACT_ONE" and len(loc[a]["centroid"]) == 2 and loc[a]["distance_m"] > 100
        assert loc[c]["status"] == "NOT_FOUND" and "centroid" not in loc[c]
        assert loc[d]["status"] == "FAILED" and "centroid" not in loc[d]
        assert r["search"]["radius_m"] == 1000
        rc = r["request_count"]
        assert rc["boundary"] == 2 and rc["standard"] == 3 and rc["land_characteristics"] == 3 and rc["cadastral"] == 1 + 4 and rc["total"] == sum(v for k, v in rc.items() if k != "total")


    def test_invalid_inputs_and_target_not_exact(self):
        s, geo, _ = make()
        assert search_standard_lands({"pnu": "123", "year": 2026}, searcher=s)["error_code"] == "PNU_INVALID"
        assert search_standard_lands({"pnu": TARGET, "year": "x"}, searcher=s)["error_code"] == "YEAR_INVALID"
        r = search_standard_lands({"pnu": "9999910101100990000", "year": 2026}, searcher=s)
        assert r["status"] == "TARGET_NOT_EXACT" and r["rows"] == [] and geo.data_calls == []


    def test_key_never_returned(self):
        s, _geo, _ = make()
        r = search_standard_lands({"pnu": TARGET, "year": 2026}, searcher=s)
        assert "synthetic-not-a-key" not in repr(r)

    def test_name_sources_per_parcel_and_mismatched_rows_not_learned(self):
        s, geo, (a, b, c, d) = make()
        # a: 같은 PNU·연도 응답 / c: 같은 코드지만 다른 필지 응답에서 배운 명칭 / b: 다른 연도 응답, d: 다른 PNU 응답 → 배우지 않음
        s.land.land_char = {a: [{"pnu": a, "stdrYear": "2026", "prposArea1": "71", "prposArea1Nm": "농림지역"}],
                            b: [{"pnu": b, "stdrYear": "2024", "prposArea1": "14", "prposArea1Nm": "옛명칭"}],
                            d: [{"pnu": a, "stdrYear": "2026", "prposArea1": "99", "prposArea1Nm": "남의값"}]}
        rows = {x["pnu"]: x for x in search_standard_lands({"pnu": TARGET, "year": 2026}, searcher=s)["rows"]}
        assert rows[a]["name_sources"]["prposAreaNm1"] == "SAME_PNU_LC"
        assert rows[b]["prposAreaNm1"] == "" and rows[d]["prposAreaNm1"] == ""
        s2, _, (a, b, c, d) = make()
        s2.land.land_char = {a: [{"pnu": a, "stdrYear": "2026", "prposArea1": "71", "prposArea1Nm": "농림지역", "ladUseSittn": "510", "ladUseSittnNm": "전"}]}
        rows = {x["pnu"]: x for x in search_standard_lands({"pnu": TARGET, "year": 2026}, searcher=s2)["rows"]}
        assert rows[c]["prposAreaNm1"] == "농림지역" and rows[c]["name_sources"]["prposAreaNm1"] == "OTHER_PNU_LC"

    def test_name_from_standard_row_and_unverified_source(self):
        s, geo, (a, b, c, d) = make()
        s.land.standard_by_ld["9999910101"][1]["prposAreaNm1"] = "농림지역"  # c에 명칭 있음 → a는 그 명칭을 빌림
        s.land.land_char = {}
        rows = {x["pnu"]: x for x in search_standard_lands({"pnu": TARGET, "year": 2026}, searcher=s)["rows"]}
        assert rows[a]["prposAreaNm1"] == "농림지역" and rows[a]["name_sources"]["prposAreaNm1"] == "STANDARD_ROW"
        s2, _, (a, b, c, d) = make()  # 응답에 PNU·연도 없음 → 같은 필지로 확인하지 않음
        rows = {x["pnu"]: x for x in search_standard_lands({"pnu": TARGET, "year": 2026}, searcher=s2)["rows"]}
        assert rows[a]["name_sources"]["prposAreaNm1"] == "UNVERIFIED_LC"

    def test_same_pnu_conflicting_land_rows_do_not_make_same_pnu_source(self):
        s, geo, (a, b, c, d) = make()
        s.land.land_char[a] = [{"pnu": a, "stdrYear": "2026", "prposArea1": x, "prposArea1Nm": n} for x, n in (("71", "농림지역"), ("14", "계획관리지역"))]
        rows = {x["pnu"]: x for x in search_standard_lands({"pnu": TARGET, "year": 2026}, searcher=s)["rows"]}
        assert rows[a].get("name_sources", {}).get("prposAreaNm1") != "SAME_PNU_LC"

    def test_failure_reports_consumed_calls(self):
        s, geo, _ = make()
        geo.fail.add(TARGET)
        r = search_standard_lands({"pnu": TARGET, "year": 2026}, searcher=s)
        assert not r["ok"] and r["request_count"]["total"] == 1
        assert search_standard_lands({"pnu": "9999910101100990000", "year": 2026}, searcher=make()[0])["request_count"]["total"] == 1


class StandardTraitsDirectTest(unittest.TestCase):
    """표준지 개별 직접조회(lookup_standard_traits) — 요청 PNU·연도와 일치하는 행만, 전수 조회 없음."""

    A, B, C, D = "9999910101100020000", "9999910102100030000", "9999910101100040000", "9999910102100050000"

    def searcher(self, land_char, fail=()):
        land = FakeLand({}, land_char)
        orig = land._transport

        def transport(url, timeout):
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
            if q.get("pnu") in fail:
                land.urls.append(url)
                raise ProviderError("VWORLD_TRANSPORT_ERROR", "synthetic")
            return orig(url, timeout)

        land._transport = transport
        return StandardLandSearch(geometry=FakeGeometry({}), land=land), land

    def lc(self, pnu, year="2026", **kw):
        return {"pnu": pnu, "stdrYear": year, "ladUseSittn": "510", "ladUseSittnNm": "전", "roadSideCode": "05", "roadSideCodeNm": "세로(가)",
                "tpgrphFrmCode": "05", "tpgrphFrmCodeNm": "부정형", "tpgrphHgCode": "02", "tpgrphHgCodeNm": "평지", "lndpclAr": "1234.5",
                "lndcgrCode": "01", "lndcgrCodeNm": "전", "prposArea1": "71", "prposArea1Nm": "농림지역", "posesnSeCode": "SECRET", **kw}

    def test_each_item_queried_by_own_pnu_and_year_with_exact_match(self):
        from transaction_enrichment.standard_lands import lookup_standard_traits
        s, land = self.searcher({self.A: [self.lc(self.A)], self.B: [self.lc(self.B, roadSideCodeNm="중로한면", roadSideCode="02")],
                                 self.C: [self.lc(self.C)]})
        r = lookup_standard_traits({"items": [{"pnu": self.A, "year": 2026}, {"pnu": self.B, "year": 2026}, {"pnu": self.C, "year": 2026}]}, searcher=s)
        assert r["ok"] and [x["status"] for x in r["items"]] == ["OK", "OK", "OK"]
        by = {x["pnu"]: x for x in r["items"]}
        assert by[self.B]["record"]["roadSideCodeNm"] == "중로한면" and by[self.A]["record"]["roadSideCodeNm"] == "세로(가)"
        assert by[self.A]["verified"] == {"pnu": True, "year": True} and by[self.A]["record"]["lndpclAr"] == "1234.5"
        assert "posesnSeCode" not in by[self.A]["record"]  # 필요한 특성 필드만
        # 항목마다 그 PNU·연도로 1회씩만(주변 표준지 전수 조회 없음)
        asked = sorted(dict(urllib.parse.parse_qsl(urllib.parse.urlparse(u).query))["pnu"] for u in land.urls)
        assert asked == sorted([self.A, self.B, self.C]) and all("stdrYear=2026" in u for u in land.urls)
        assert r["request_count"] == {"land_characteristics": 3, "total": 3}

    def test_other_parcel_or_year_rows_are_mismatch_not_values(self):
        from transaction_enrichment.standard_lands import lookup_standard_traits
        s, _ = self.searcher({self.A: [self.lc(self.D)], self.B: [self.lc(self.B, year="2025")]})
        r = lookup_standard_traits({"items": [{"pnu": self.A, "year": 2026}, {"pnu": self.B, "year": 2026}]}, searcher=s)
        a, b = r["items"]
        assert a["status"] == "MISMATCH" and "record" not in a and a["response_keys"] == [f"{self.D}|2026"]
        assert b["status"] == "MISMATCH" and "record" not in b and b["response_keys"] == [f"{self.B}|2025"]

    def test_row_conflict_keeps_both_rows_and_failure_and_not_found(self):
        from transaction_enrichment.standard_lands import lookup_standard_traits
        s, _ = self.searcher({self.A: [self.lc(self.A, lastUpdtDt="2026-01-01"), self.lc(self.A, roadSideCodeNm="맹지", roadSideCode="12", lastUpdtDt="2026-02-01")],
                              self.C: [self.lc(self.C, lastUpdtDt="2026-01-01"), self.lc(self.C, lastUpdtDt="2026-03-01")]}, fail={self.B})
        r = lookup_standard_traits({"items": [{"pnu": self.A, "year": 2026}, {"pnu": self.B, "year": 2026}, {"pnu": self.C, "year": 2026}, {"pnu": self.D, "year": 2026}]}, searcher=s)
        a, b, c, d = r["items"]
        assert a["status"] == "ROW_CONFLICT" and {x["roadSideCodeNm"] for x in a["rows"]} == {"세로(가)", "맹지"} and "roadSideCode" in a["conflict_fields"]
        assert b["status"] == "FAILED" and b["code"] == "VWORLD_TRANSPORT_ERROR"
        assert c["status"] == "OK" and c["record"]["lastUpdtDt"] == "2026-03-01"  # 갱신일만 다른 수정본은 최신으로 정리
        assert d["status"] == "NOT_FOUND"
        assert r["request_count"]["land_characteristics"] == 4

    def test_input_limits(self):
        from transaction_enrichment.standard_lands import lookup_standard_traits
        s, land = self.searcher({})
        assert lookup_standard_traits({"items": []}, searcher=s)["error_code"] == "ITEMS_INVALID"
        assert lookup_standard_traits({"items": [{"pnu": self.A, "year": 2026}] * 5}, searcher=s)["error_code"] == "TOO_MANY_ITEMS"
        assert lookup_standard_traits({"items": [{"pnu": "123", "year": 2026}]}, searcher=s)["error_code"] == "PNU_INVALID"
        assert lookup_standard_traits({"items": [{"pnu": self.A, "year": "x"}]}, searcher=s)["error_code"] == "YEAR_INVALID"
        assert land.urls == []
        r = lookup_standard_traits({"items": [{"pnu": self.A, "year": 2026}, {"pnu": self.A, "year": 2026}]}, searcher=s)
        assert len(r["items"]) == 1 and len(land.urls) == 1  # 같은 PNU·연도 중복은 1회


if __name__ == "__main__":
    unittest.main()
