# -*- coding: utf-8 -*-
"""문서 구조 분석. 텍스트 없는 페이지는 헤더 OCR 후 필요한 페이지만 전체 OCR."""
import os
import shutil
import subprocess
import tempfile
import fitz
from .textnorm import ocr_sanitize

MIN_TEXT_CHARS = 40


def _tesseract_command() -> str:
    configured = os.environ.get("BSO_TESSERACT_CMD")
    if configured:
        return configured
    discovered = shutil.which("tesseract")
    if discovered:
        return discovered
    for candidate in (
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ):
        if os.path.isfile(candidate):
            return candidate
    return "tesseract"


def _ocr_pixmap(pix, psm="6", lang="kor+eng"):
    handle = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    path = handle.name
    handle.close()
    try:
        pix.save(path)
        result = subprocess.run(
            [_tesseract_command(), path, "stdout", "-l", lang, "--psm", psm],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        return result.stdout or ""
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ""
    finally:
        if os.path.exists(path):
            os.unlink(path)


class DocumentStructure:
    def __init__(self, pdf_path: str, ocr_available: bool = True, password: str | None = None):
        self.pdf_path = pdf_path
        self.doc = fitz.open(pdf_path)
        if password and self.doc.is_encrypted:
            if not self.doc.authenticate(password):
                raise ValueError("PDF 비밀번호 인증 실패")
        self.ocr_available = ocr_available
        self.ocr_pages_used = set()
        self._full_ocr_cache = {}
        self.pages = []
        for index, page in enumerate(self.doc):
            text = page.get_text() or ""
            has_text = len(text.strip()) >= MIN_TEXT_CHARS
            self.pages.append({"index": index, "page": index + 1, "has_text_layer": has_text,
                               "text": text if has_text else "", "header_text": "",
                               "width": page.rect.width, "height": page.rect.height,
                               "landscape": page.rect.width > page.rect.height})

    def header_text(self, index: int) -> str:
        page_meta = self.pages[index]
        if page_meta["has_text_layer"]:
            return page_meta["text"][:600]
        if page_meta["header_text"]:
            return page_meta["header_text"]
        if not self.ocr_available:
            return ""
        page = self.doc[index]
        clip = fitz.Rect(0, 0, page.rect.width, page.rect.height * 0.22)
        page_meta["header_text"] = ocr_sanitize(_ocr_pixmap(page.get_pixmap(dpi=160, clip=clip)))
        return page_meta["header_text"]

    def page_text(self, index: int, allow_ocr: bool = True) -> str:
        page_meta = self.pages[index]
        if page_meta["has_text_layer"]:
            return page_meta["text"]
        if not allow_ocr or not self.ocr_available:
            return ""
        if index in self._full_ocr_cache:
            return self._full_ocr_cache[index]
        best, best_score = "", -1
        psm_modes = ("4", "3", "6") if page_meta["landscape"] else ("3", "4", "6")
        for dpi in (250, 300):
            pixmap = self.doc[index].get_pixmap(dpi=dpi)
            for psm in psm_modes:
                text = ocr_sanitize(_ocr_pixmap(pixmap, psm=psm))
                score = (
                    sum(char.isdigit() for char in text) * 2
                    + sum('가' <= char <= '힣' for char in text)
                    + text.count(",") * 3
                )
                if score > best_score:
                    best, best_score = text, score
        self._full_ocr_cache[index] = best
        self.ocr_pages_used.add(index + 1)
        return best

    def page_text_tabular(self, index: int, allow_ocr: bool = True) -> str:
        page_meta = self.pages[index]
        if not page_meta["has_text_layer"]:
            return self.page_text(index, allow_ocr=allow_ocr)
        page = self.doc[index]
        words = page.get_text('words')
        if not words:
            return page_meta["text"]
        words_sorted = sorted(words, key=lambda w: ((w[1] + w[3]) / 2, w[0]))
        rows, cur = [], [words_sorted[0]]
        for w in words_sorted[1:]:
            y_c = (w[1] + w[3]) / 2
            row_y = sum((x[1] + x[3]) / 2 for x in cur) / len(cur)
            h = max(w[3] - w[1], cur[-1][3] - cur[-1][1], 1)
            if abs(y_c - row_y) <= h * 0.4:
                cur.append(w)
            else:
                rows.append(cur)
                cur = [w]
        if cur:
            rows.append(cur)
        lines = []
        for row in rows:
            row.sort(key=lambda w: w[0])
            lines.append(' '.join(w[4] for w in row))
        return '\n'.join(lines)

    def page_method(self, index: int) -> str:
        return "text" if self.pages[index]["has_text_layer"] else "ocr"

    @property
    def page_count(self):
        return len(self.pages)
