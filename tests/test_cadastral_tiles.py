"""화면 범위 지적경계(0.01° 격자 칸) — 가짜 제공자·합성 응답만(네트워크·키 없음)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

from transaction_enrichment.providers import CADASTRAL_PAGE_SIZE, ProviderError, cadastral_tile_bbox, fetch_cadastral_tile  # noqa: E402
import public_data_bridge as bridge  # noqa: E402

TARGET = "9999910101100010000"


def feat(i, lon=127.311, lat=36.621):
    pnu = f"99999101012{i:04d}0000"
    return {"properties": {"pnu": pnu, "jibun": f"{i} 답"},
            "geometry": {"type": "Polygon", "coordinates": [[[lon, lat], [lon + 0.0001, lat], [lon + 0.0001, lat + 0.0001], [lon, lat]]]}}


class FakeProvider:
    """record.total 만큼의 합성 지적 객체를 page/size로 나눠 돌려준다."""
    configured = True

    def __init__(self, totals, meta=True, fail=()):
        self.totals = totals  # {(ix, iy): total}
        self.meta = meta
        self.fail = set(fail)
        self.calls = []

    def _raw(self, extra):
        box = extra["geomFilter"][4:-1].split(",")
        key = (round(float(box[0]) * 100), round(float(box[1]) * 100))
        self.calls.append((key, int(extra["page"]), int(extra["size"])))
        if key in self.fail:
            raise ProviderError("VWORLD_TRANSPORT_ERROR", "synthetic")
        total = self.totals.get(key, 0); size = int(extra["size"]); page = int(extra["page"])
        start = (page - 1) * size
        items = [feat(i) for i in range(start, min(total, start + size))]
        resp = {"status": "OK" if items else "NOT_FOUND", "result": {"featureCollection": {"features": items}}}
        if self.meta:
            resp["record"] = {"total": str(total), "current": str(len(items))}
            resp["page"] = {"total": str(max(1, -(-total // size))), "current": str(page), "size": str(size)}
        return {"response": resp}


class CadastralTileTest(unittest.TestCase):
    def test_bbox_grid_and_bounds(self):
        self.assertEqual(cadastral_tile_bbox(12731, 3662), [127.31, 36.62, 127.32, 36.63])
        with self.assertRaises(ProviderError):
            cadastral_tile_bbox(10000, 3662)

    def test_pages_until_record_total(self):
        p = FakeProvider({(12731, 3662): 2300})
        r = fetch_cadastral_tile(p, 12731, 3662, TARGET)
        self.assertEqual(r["status"], "COMPLETE"); self.assertEqual(r["total"], 2300); self.assertEqual(r["received"], 2300)
        self.assertEqual([c[1] for c in p.calls], [1, 2, 3]); self.assertTrue(all(c[2] == CADASTRAL_PAGE_SIZE for c in p.calls))

    def test_over_page_limit_is_partial_not_complete(self):
        r = fetch_cadastral_tile(FakeProvider({(12731, 3662): 3500}), 12731, 3662, TARGET)
        self.assertEqual(r["status"], "PARTIAL"); self.assertEqual(r["reason"], "PAGE_LIMIT"); self.assertEqual(r["received"], 3000); self.assertEqual(r["total"], 3500)

    def test_missing_count_meta_is_never_complete(self):
        r = fetch_cadastral_tile(FakeProvider({(12731, 3662): 40}, meta=False), 12731, 3662, TARGET)
        self.assertEqual(r["status"], "COUNT_UNKNOWN"); self.assertEqual(len(r["features"]), 40)

    def test_empty_tile_is_complete_zero(self):
        r = fetch_cadastral_tile(FakeProvider({}), 12731, 3662, TARGET)
        self.assertEqual(r["status"], "COMPLETE"); self.assertEqual(r["total"], 0); self.assertEqual(r["features"], [])

    def test_target_excluded(self):
        p = FakeProvider({(12731, 3662): 3})
        first = fetch_cadastral_tile(p, 12731, 3662, "")["features"][0]["pnu"]
        r = fetch_cadastral_tile(p, 12731, 3662, first)
        self.assertNotIn(first, [f["pnu"] for f in r["features"]]); self.assertEqual(r["status"], "COMPLETE")

    def test_bridge_tiles_budget_and_failures(self):
        p = FakeProvider({(12731, 3662): 2500, (12732, 3662): 2500, (12733, 3662): 2500, (12734, 3662): 10}, fail={(12734, 3662)})
        r = bridge.parcel_map_tiles(TARGET, [[12731, 3662], [12732, 3662], [12733, 3662], [12734, 3662]], p)
        st = [(t["tile"], t["status"], t.get("reason")) for t in r["tiles"]]
        self.assertEqual(st[0][1], "COMPLETE"); self.assertEqual(st[1][1], "COMPLETE")  # 3+3 = 6회
        self.assertEqual(st[2][1], "PARTIAL"); self.assertEqual(st[2][2], "CALL_BUDGET")  # 남은 예산 2회 → 2,000/2,500
        self.assertEqual(st[3][1], "NOT_QUERIED"); self.assertEqual(st[3][2], "CALL_BUDGET")
        self.assertLessEqual(r["request_count"], bridge.TILE_CALL_BUDGET)

    def test_bridge_tile_failure_isolated(self):
        r = bridge.parcel_map_tiles(TARGET, [[12731, 3662], [12734, 3662]], FakeProvider({(12731, 3662): 5}, fail={(12734, 3662)}))
        self.assertEqual([t["status"] for t in r["tiles"]], ["COMPLETE", "FAILED"])

    def test_bridge_rejects_bad_tiles(self):
        p = FakeProvider({})
        for bad in ([], [[1, 2]] * 5, [["a", 1]], [[True, 1]], "x"):
            self.assertEqual(bridge.parcel_map_tiles(TARGET, bad, p)["error_code"], "TILES_INVALID")
        self.assertEqual(p.calls, [])
        out = bridge.parcel_map_tiles(TARGET, [[1, 2]], p)
        self.assertEqual(out["tiles"][0]["status"], "FAILED"); self.assertEqual(out["tiles"][0]["reason"], "TILE_INVALID")

    def test_failed_tile_calls_are_counted(self):
        # 실패한 칸이 이미 쓴 VWorld 호출도 request_count에 남는다(0으로 사라지지 않음)
        p = FakeProvider({(12731, 3662): 0}, fail={(12732, 3662)})
        r = bridge.parcel_map_tiles(TARGET, [[12731, 3662], [12732, 3662]], p)
        self.assertEqual(r["request_count"], len(p.calls)); self.assertEqual(r["request_count"], 2)


if __name__ == "__main__":
    unittest.main()
