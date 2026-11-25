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
        assert "posesnStle" not in rows[a] and set(rows[a]) <= set(KEEP_FIELDS) | {"ldCodeNm", "name_filled_from_land_characteristics"}
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


if __name__ == "__main__":
    unittest.main()
