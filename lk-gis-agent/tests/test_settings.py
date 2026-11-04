import pytest
from pydantic import ValidationError

from app.core.settings import Settings


def test_external_bind_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(host="0.0.0.0")


def test_wildcard_cors_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(allowed_origins=["*"])


def test_loopback_defaults() -> None:
    settings = Settings()
    assert settings.host == "127.0.0.1"
    assert settings.port == 8765
