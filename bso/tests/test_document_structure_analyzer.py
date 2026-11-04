from pathlib import Path

from bso_parser import document_structure_analyzer as dsa


class _WritablePixmap:
    def __init__(self):
        self.path = None

    def save(self, path):
        self.path = Path(path)
        self.path.write_bytes(b"png")


def test_ocr_tempfile_is_closed_before_pixmap_save_and_removed(monkeypatch, tmp_path):
    monkeypatch.setenv("TEMP", str(tmp_path))
    monkeypatch.setenv("TMP", str(tmp_path))
    captured = {}

    def fake_run(*args, **kwargs):
        captured.update(kwargs)
        return type("Result", (), {"stdout": "OCR RESULT"})()

    monkeypatch.setattr(dsa.subprocess, "run", fake_run)
    pixmap = _WritablePixmap()

    result = dsa._ocr_pixmap(pixmap)

    assert result == "OCR RESULT"
    assert captured["encoding"] == "utf-8"
    assert captured["errors"] == "replace"
    assert pixmap.path is not None
    assert not pixmap.path.exists()


def test_tesseract_command_honors_explicit_override(monkeypatch):
    monkeypatch.setenv("BSO_TESSERACT_CMD", r"D:\OCR\tesseract.exe")
    assert dsa._tesseract_command() == r"D:\OCR\tesseract.exe"
