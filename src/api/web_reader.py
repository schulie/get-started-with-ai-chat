"""Read explicitly selected public HTTPS pages; no search or document forwarding."""
import asyncio
import ipaddress
import socket
from html.parser import HTMLParser
from urllib.parse import urlsplit, urljoin, urlunsplit
import aiohttp
from .uploads import UploadError

MAX_BYTES = 1024 * 1024
MAX_TEXT = 80_000


def public_address(address):
    ip = ipaddress.ip_address(address)
    return ip.is_global and not ip.is_multicast and not ip.is_unspecified


def public_url(url):
    try:
        if len(url) > 2048 or any(ord(char) < 33 or ord(char) == 127 for char in url) or "\\" in url:
            raise ValueError()
        parts = urlsplit(url)
        host = parts.hostname
        if (parts.scheme != "https" or not host or parts.username is not None
                or parts.password is not None or parts.port not in {None, 443}):
            raise ValueError()
        if host.endswith(".") or "." not in host or "%" in host:
            raise ValueError()
        try:
            literal = ipaddress.ip_address(host)
        except ValueError:
            pass  # DNS names are resolved and checked by the pinned connector below.
        else:
            if not public_address(str(literal)):
                raise ValueError()
        return urlunsplit(("https", parts.netloc, parts.path or "/", parts.query, ""))
    except (ValueError, UnicodeError):
        raise UploadError("public_https_url_required") from None


class PublicResolver(aiohttp.abc.AbstractResolver):
    def __init__(self):
        self.delegate = aiohttp.resolver.DefaultResolver()

    async def resolve(self, host, port=0, family=socket.AF_INET):
        records = await self.delegate.resolve(host, port, family)
        if not records or any(not public_address(record["host"]) for record in records):
            raise OSError("Non-public address denied")
        return records  # The connection uses these checked IPs, without a second DNS lookup.

    async def close(self):
        await self.delegate.close()


class PageText(HTMLParser):
    SKIP = {"script", "style", "noscript", "template", "svg", "head"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hidden = []
        self.chunks = []
        self.size = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.hidden.append(tag)
        if not self.hidden and tag in {"p", "div", "br", "li", "h1", "h2", "h3", "tr"}:
            self.handle_data("\n")

    def handle_endtag(self, tag):
        if self.hidden and tag == self.hidden[-1]:
            self.hidden.pop()

    def handle_data(self, text):
        if not self.hidden:
            self.size += len(text)
            if self.size > MAX_TEXT:
                raise UploadError("web_page_too_large")
            self.chunks.append(text)


def extract_page(body, content_type):
    text = body.decode("utf-8", errors="replace")
    if content_type == "text/html":
        parser = PageText()
        parser.feed(text)
        text = " ".join(parser.chunks)
    text = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    if not text or len(text) > MAX_TEXT:
        raise UploadError("empty_or_large_web_page")
    return text


async def read_public_page(url):
    url = public_url(url)
    resolver = PublicResolver()
    connector = aiohttp.TCPConnector(resolver=resolver, use_dns_cache=False)
    try:
        async with asyncio.timeout(15):
            async with aiohttp.ClientSession(connector=connector, trust_env=False,
                    auto_decompress=False,
                    cookie_jar=aiohttp.DummyCookieJar(),
                    headers={"User-Agent": "JMCGPT-Beta-PublicPageReader/1.0",
                             "Accept": "text/html, text/plain", "Accept-Encoding": "identity"}) as http:
                for redirect in range(4):
                    async with http.get(url, allow_redirects=False) as response:
                        if response.status in {301, 302, 303, 307, 308}:
                            if redirect == 3 or not response.headers.get("Location"):
                                raise UploadError("web_page_unavailable")
                            url = public_url(urljoin(url, response.headers["Location"]))
                            continue
                        if response.status != 200:
                            raise UploadError("web_page_unavailable")
                        if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                            raise UploadError("web_page_format_unsupported")
                        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
                        if content_type not in {"text/html", "text/plain"}:
                            raise UploadError("web_page_format_unsupported")
                        body = bytearray()
                        async for chunk in response.content.iter_chunked(16384):
                            body.extend(chunk)
                            if len(body) > MAX_BYTES:
                                raise UploadError("web_page_too_large")
                        return {"url": url, "text": extract_page(body, content_type)}
    except UploadError:
        raise
    except Exception:
        raise UploadError("web_page_unavailable") from None
    finally:
        await connector.close()
        await resolver.close()
