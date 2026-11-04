"""Allowlisted source adapter registry."""

from __future__ import annotations

from app.adapters.base import SourceAdapter


class AdapterRegistryError(RuntimeError):
    pass


class AdapterRegistry:
    """Registry that accepts only adapters eligible for automatic application."""

    def __init__(self) -> None:
        self._adapters: dict[str, SourceAdapter] = {}

    def register(self, adapter: SourceAdapter) -> None:
        if not adapter.auto_apply:
            raise AdapterRegistryError(
                f"Reference-only source cannot be registered for automatic use: {adapter.source_id}"
            )
        if adapter.source_id in self._adapters:
            raise AdapterRegistryError(f"Duplicate source adapter: {adapter.source_id}")
        self._adapters[adapter.source_id] = adapter

    def get(self, source_id: str) -> SourceAdapter:
        try:
            return self._adapters[source_id]
        except KeyError as exc:
            raise AdapterRegistryError(f"Unknown source adapter: {source_id}") from exc

    def source_ids(self) -> tuple[str, ...]:
        return tuple(sorted(self._adapters))
