import fitz

from bso_graphics.fitz_sample_brief_renderer import generate_sample_brief


def test_fitz_renderer_creates_two_page_pdf_and_page_images(tmp_path):
    manifest = {
        "title": "검증",
        "map_output_status": "VERIFIED_SOURCE_GEOMETRY",
        "output_disclaimer": "검토용",
        "sample_brief": {
            "page1_title": "자동표1",
            "page1_summary": ["대상", "지역", "대", "현황", "표준지", "지역", "대", "현황", "A", "100,000", "도로", "형상"],
            "page1_rows": [{
                "company": "법인", "street": "1.00", "access": "1.00", "environment": "1.00",
                "parcel": "1.00", "admin": "1.00", "other": "1.00", "total": "1.000",
                "other_factor": "2.00", "applied_price": "200,000",
            }],
            "page1_claims": "원문 대조",
            "page1_review_required": False,
            "page2_title": "자동표2",
            "page2_calc_rows": [{
                "type": "사례", "lot": "사례지", "price": "150,000", "time_factor": "1.01000",
                "regional_factor": "1.00", "individual_factor": "1.050", "calculated_price": "159,075",
            }],
            "page2_rows": [{
                "company": "법인", "street": "1.00", "access": "1.00", "environment": "1.00",
                "parcel": "1.00", "admin": "1.00", "other": "1.00", "total": "1.000",
                "gap_ratio": "1.500", "decision": "1.50",
            }],
            "page2_claims": "역산 검토",
            "page2_review_required": False,
        },
    }

    paths = generate_sample_brief(manifest, tmp_path)

    assert all(path.is_file() and path.stat().st_size > 0 for path in paths)
    pdf = fitz.open(tmp_path / "final_sample_brief.pdf")
    assert pdf.page_count == 2
    assert "자동표1" in pdf[0].get_text()
    assert "자동표2" in pdf[1].get_text()
    pdf.close()


def test_fitz_renderer_does_not_substitute_subject_map_for_masked_case(tmp_path):
    pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 10, 10), False)
    (tmp_path / "subject_vs_standard.png").write_bytes(pixmap.tobytes("png"))
    manifest = {
        "title": "MASKED CASE",
        "map_output_status": "DRAFT_UNTIL_PC_VISUAL_REVIEW",
        "sample_brief": {
            "page1_title": "PAGE 1",
            "page1_summary": [],
            "page1_rows": [],
            "page1_claims": "PAGE 1 CLAIM",
            "page2_title": "PAGE 2",
            "page2_calc_rows": [],
            "page2_rows": [],
            "page2_claims": "MASKED LOT",
            "page2_review_required": True,
            "page2_map_unavailable": True,
            "page2_map_unavailable_message": "MASKED CASE MAP UNAVAILABLE",
        },
    }

    generate_sample_brief(manifest, tmp_path)

    pdf = fitz.open(tmp_path / "final_sample_brief.pdf")
    page2_text = pdf[1].get_text()
    assert "MASKED CASE MAP UNAVAILABLE" in page2_text
    pdf.close()
