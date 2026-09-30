"""Client for the receipt service.

``ReceiptClient`` is async and uses aiohttp, which discord.py already depends
on. ``render_sync`` / ``list_templates_sync`` use only the standard library for
scripts and non-async code.

    client = ReceiptClient()
    png = await client.render("thermal", data)
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any, Optional

DEFAULT_BASE_URL = os.getenv("RECEIPT_SERVICE_URL", "http://127.0.0.1:3939")


class ReceiptServiceError(Exception):
    def __init__(self, message: str, status: Optional[int] = None, code: Optional[str] = None):
        super().__init__(message)
        self.status = status
        self.code = code


def _error_from_body(status: int, body: bytes) -> ReceiptServiceError:
    try:
        error = json.loads(body).get("error", {})
    except (ValueError, AttributeError):
        error = {}
    return ReceiptServiceError(error.get("message") or f"HTTP {status}", status, error.get("code"))


class ReceiptClient:
    def __init__(self, base_url: str = DEFAULT_BASE_URL, timeout: float = 30):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def list_templates(self) -> list[dict[str, Any]]:
        return json.loads(await self._request("GET", "/templates"))

    async def list_payments(self) -> list[dict[str, Any]]:
        return json.loads(await self._request("GET", "/payments"))

    async def render(self, template: str, data: dict[str, Any], scale: Optional[int] = None) -> bytes:
        payload = {"template": template, "data": data}
        if scale is not None:
            payload["scale"] = scale
        return await self._request("POST", "/render", payload)

    async def _request(self, method: str, path: str, payload: Optional[dict[str, Any]] = None) -> bytes:
        import aiohttp

        timeout = aiohttp.ClientTimeout(total=self.timeout)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.request(method, self.base_url + path, json=payload) as res:
                body = await res.read()
                if res.status != 200:
                    raise _error_from_body(res.status, body)
                return body


def _request_sync(method: str, path: str, payload: Optional[dict[str, Any]], base_url: str, timeout: float) -> bytes:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        base_url.rstrip("/") + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.read()
    except urllib.error.HTTPError as err:
        raise _error_from_body(err.code, err.read()) from None


def list_templates_sync(base_url: str = DEFAULT_BASE_URL, timeout: float = 30) -> list[dict[str, Any]]:
    return json.loads(_request_sync("GET", "/templates", None, base_url, timeout))


def render_sync(
    template: str,
    data: dict[str, Any],
    scale: Optional[int] = None,
    base_url: str = DEFAULT_BASE_URL,
    timeout: float = 30,
) -> bytes:
    payload = {"template": template, "data": data}
    if scale is not None:
        payload["scale"] = scale
    return _request_sync("POST", "/render", payload, base_url, timeout)
