from pathlib import Path
from urllib.error import URLError

import pytest

from bso_graphics.vworld_local_basemap import _download


def test_tile_download_error_does_not_expose_api_key(tmp_path, monkeypatch):
    secret = "SECRET-VWORLD-KEY"
    url = f"https://api.vworld.kr/req/wmts/1.0.0/{secret}/Satellite/18/1/2.jpeg"

    def fail(*_args, **_kwargs):
        raise URLError("network blocked")

    monkeypatch.setattr("bso_graphics.vworld_local_basemap.urllib.request.urlopen", fail)

    with pytest.raises(RuntimeError) as exc_info:
        _download(url, Path(tmp_path) / "tile.jpeg", "http://localhost", retries=1)

    message = str(exc_info.value)
    assert secret not in message
    assert "VWorld tile download failed" in message
