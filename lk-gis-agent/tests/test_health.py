from fastapi.testclient import TestClient

from app.core.settings import Settings
from app.main import create_app


def test_health_contract_without_qgis() -> None:
    client = TestClient(create_app(Settings()))
    response = client.get("/v1/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["agent_version"] == "0.1.0.dev0"
    assert isinstance(payload["qgis_detected"], bool)
    assert set(payload) == {"status", "agent_version", "qgis_detected", "qgis_version"}
