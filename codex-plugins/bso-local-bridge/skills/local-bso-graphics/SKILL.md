---
name: local-bso-graphics
description: Use the user's local Windows BSO checkout to check or run PNU exact verification and QGIS/VWorld graphics manifests without exposing the local bridge or VWorld key to the internet. Use when BSO graphics must be generated from Codex and direct VWorld calls are blocked by the cloud network path.
---

# Local BSO Graphics

Use the `bso-local-bridge` MCP tools instead of calling `api.vworld.kr` from the cloud environment.

1. Call `bso_local_bridge_status` first.
2. When `transport_status` is `CODEX_NETWORK_ESCALATION_REQUIRED`, do not retry the MCP network probe. Run `scripts/probe_vworld_local.ps1` through approved host execution (`require_escalated`) for a fixed non-case connectivity check, then run `bso/RUN_GRAPHICS_GATE.cmd` through the same approved host path for real manifests. This is the supported Codex Desktop path; it does not create a public bridge.
3. When the transport is `DIRECT_LOCAL_NETWORK`, `bso_vworld_connection_probe` may be used directly. It uses a fixed non-case coordinate and returns no key or URL.
4. Call `bso_list_graphics_outputs` before generating anything. Reuse existing verified outputs when they satisfy the request.
5. Call `bso_run_graphics_gate` only when direct local network is available. Under the Codex sandbox, use approved host execution instead. The manifest must already exist under `bso/graphics-input`.
6. Never ask for, read, print, return, or transmit the VWorld API key. The local runner reads it from `bso/.env` or the repository-root `.env` and returns only status metadata.
7. Never expose the loopback HTTP bridge through a public tunnel.
8. Do not run a manifest whose target, standard, or case PNU is ambiguous. Report `REVIEW_REQUIRED` or the returned blocker instead.
9. Treat generated maps as review material until `parcel_verification_result.json` is `PASS` and the PNG has been visually checked.
10. Return relative output paths and verification status. Do not claim legal or appraisal conclusions.
