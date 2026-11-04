"""Public adapter contracts for the LK GIS Agent."""

from app.adapters.base import (
    AdapterError,
    AdapterErrorCode,
    FetchKind,
    FetchRequest,
    FetchResult,
    JsonTransport,
    ProvenanceRecord,
    SourceAdapter,
    TransportResponse,
)
from app.adapters.datago_attributes import (
    AttributeFieldMap,
    DataGoAttributeAdapter,
    DataGoAttributeConfig,
    PublicAttributeProfile,
)
from app.adapters.registry import AdapterRegistry, AdapterRegistryError
from app.adapters.vworld_wfs import VWorldGeometryAdapter, VWorldGeometryConfig

__all__ = [
    "AdapterError",
    "AdapterErrorCode",
    "AdapterRegistry",
    "AdapterRegistryError",
    "AttributeFieldMap",
    "DataGoAttributeAdapter",
    "DataGoAttributeConfig",
    "FetchKind",
    "FetchRequest",
    "FetchResult",
    "JsonTransport",
    "ProvenanceRecord",
    "PublicAttributeProfile",
    "SourceAdapter",
    "TransportResponse",
    "VWorldGeometryAdapter",
    "VWorldGeometryConfig",
]
