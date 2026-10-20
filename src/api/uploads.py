"""Bounded parsing in memory. Never execute files, follow links, or write uploads."""
import base64
import csv
import io
import json
import posixpath
import warnings
import zipfile
from dataclasses import dataclass, field
from pathlib import PurePath
from defusedxml import ElementTree as ET
from PIL import Image, ImageOps

MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 12 * 1024 * 1024
MAX_TEXT = 300_000
MAX_IMAGES = 8
MAX_FILES = 6
MAX_PIXELS = 16_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
TEXT_TYPES = {".txt", ".md", ".csv", ".tsv", ".json"}
IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".webp"}
AUDIO_TYPES = {".wav", ".mp3", ".m4a", ".ogg", ".webm", ".flac"}
VIDEO_TYPES = {".mp4", ".mov", ".mkv", ".webm"}
SUPPORTED = TEXT_TYPES | IMAGE_TYPES | AUDIO_TYPES | VIDEO_TYPES | {".pdf", ".docx", ".xlsx"}


class UploadError(ValueError):
    def __init__(self, code="invalid_file"):
        self.code = code
        super().__init__(code)


def decode_file(name, encoded):
    suffix = PurePath(name).suffix.lower()
    if suffix not in SUPPORTED or len(encoded) > (MAX_FILE_BYTES * 4 // 3 + 4):
        raise UploadError("unsupported_or_large_file")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        raise UploadError() from None
    if not data or len(data) > MAX_FILE_BYTES:
        raise UploadError("unsupported_or_large_file")
    return suffix, data


def normalize_image(data):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in {"PNG", "JPEG", "WEBP"} or getattr(image, "n_frames", 1) != 1:
                    raise UploadError()
                if image.width * image.height > MAX_PIXELS:
                    raise UploadError("image_too_large")
                image.load()
                clean = ImageOps.exif_transpose(image).convert("RGB")
                clean.thumbnail((2048, 2048))
                output = io.BytesIO()
                # Re-encoding drops EXIF, location, comments, and embedded profiles.
                clean.save(output, format="JPEG", quality=85)
        return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode("ascii")
    except UploadError:
        raise
    except Exception:
        raise UploadError() from None


def _package(data):
    archive = zipfile.ZipFile(io.BytesIO(data))
    entries = archive.infolist()
    if (len(entries) > 1000 or sum(e.file_size for e in entries) > 24 * 1024 * 1024
            or len({e.filename for e in entries}) != len(entries)
            or any(e.flag_bits & 1 or e.file_size > 12 * 1024 * 1024
                   or e.file_size > max(e.compress_size, 1) * 200
                   or e.filename.startswith("/") or ".." in e.filename.split("/") for e in entries)
            or any("vbaProject" in e.filename for e in entries)):
        archive.close()
        raise UploadError("unsafe_office_file")
    return archive


def _xml(archive, name):
    return ET.fromstring(archive.read(name))


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def office_text(data, suffix):
    with _package(data) as archive:
        if suffix == ".docx":
            names = [n for n in archive.namelist() if n == "word/document.xml"
                     or n.startswith(("word/header", "word/footer")) and n.endswith(".xml")]
            if "word/document.xml" not in names:
                raise UploadError()
            return "\n".join("".join(node.itertext()) for name in names
                             for node in _xml(archive, name).iter() if _local(node.tag) == "t")
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(n.itertext()) for n in _xml(archive, "xl/sharedStrings.xml")]
        relationships = {n.get("Id"): n.get("Target") for n in _xml(archive, "xl/_rels/workbook.xml.rels")
                         if n.get("TargetMode") != "External"}
        result, cells = [], 0
        for sheet in _xml(archive, "xl/workbook.xml").iter():
            if _local(sheet.tag) != "sheet":
                continue
            relation = sheet.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
            target = relationships.get(relation, "")
            target = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
            if not target.startswith("xl/worksheets/"):
                raise UploadError()
            result.append("Sheet: " + sheet.get("name", ""))
            for row in _xml(archive, target).iter():
                if _local(row.tag) != "row":
                    continue
                values = []
                for cell in row:
                    cells += 1
                    if cells > 20_000:
                        raise UploadError("spreadsheet_too_large")
                    value = next((n.text or "" for n in cell if _local(n.tag) == "v"), "")
                    if cell.get("t") == "s":
                        value = strings[int(value)]
                    elif cell.get("t") == "inlineStr":
                        value = "".join(n.text or "" for n in cell.iter() if _local(n.tag) == "t")
                    if not value and any(_local(n.tag) == "f" for n in cell):
                        value = "[formula has no cached value; not calculated]"
                    # Formulas and external links are never executed or fetched.
                    values.append(cell.get("r", "") + ": " + value)
                result.append(" | ".join(values))
        return "\n".join(result)


@dataclass
class ParsedFile:
    text: str = ""
    images: list[str] = field(default_factory=list)
    audio: bytes = b""
    suffix: str = ""


def parse_file(suffix, data, video_enabled=False):
    try:
        if suffix in VIDEO_TYPES:
            from .video import parse_video
            video = parse_video(suffix, data, video_enabled)
            if video is not None:
                return video
        if suffix in IMAGE_TYPES:
            return ParsedFile(images=[normalize_image(data)])
        if suffix in AUDIO_TYPES:
            valid = {".wav": data.startswith(b"RIFF") and data[8:12] == b"WAVE",
                     ".mp3": data.startswith(b"ID3") or len(data) > 1 and data[0] == 255 and data[1] & 224 == 224,
                     ".flac": data.startswith(b"fLaC"), ".ogg": data.startswith(b"OggS"),
                     ".webm": data.startswith(b"\x1aE\xdf\xa3"), ".m4a": data[4:8] == b"ftyp"}[suffix]
            if not valid:
                raise UploadError()
            return ParsedFile(audio=data, suffix=suffix)
        if suffix in TEXT_TYPES:
            text = data.decode("utf-8-sig")
            if "\x00" in text:
                raise UploadError()
            if suffix == ".json":
                json.loads(text)
            if suffix in {".csv", ".tsv"}:
                if sum(len(row) for row in csv.reader(io.StringIO(text), delimiter="\t" if suffix == ".tsv" else ",")) > 20_000:
                    raise UploadError("spreadsheet_too_large")
            result = ParsedFile(text=text)
        elif suffix in {".docx", ".xlsx"}:
            result = ParsedFile(text=office_text(data, suffix))
            if suffix == ".docx":
                with _package(data) as archive:
                    for name in archive.namelist():
                        if name.startswith("word/media/"):
                            if len(result.images) >= MAX_IMAGES:
                                raise UploadError("too_many_images")
                            result.images.append(normalize_image(archive.read(name)))
        elif suffix == ".pdf":
            if not data.startswith(b"%PDF-"):
                raise UploadError()
            from pypdf import PdfReader
            import pypdfium2 as pdfium
            pdf = PdfReader(io.BytesIO(data))
            if pdf.is_encrypted or len(pdf.pages) > 40:
                raise UploadError("encrypted_or_large_pdf")
            result = ParsedFile()
            render = None
            try:
                for index, page in enumerate(pdf.pages):
                    # Bound decoded streams before invoking text extraction.
                    content = page.get_contents()
                    if content is not None and len(content.get_data()) > 12 * 1024 * 1024:
                        raise UploadError("pdf_page_too_large")
                    text = page.extract_text() or ""
                    result.text += f"\nPage {index + 1}:\n{text}"
                    if len(result.text) > MAX_TEXT:
                        raise UploadError("document_too_large")
                    if len(text.strip()) < 20 or page.get("/Resources", {}).get("/XObject"):
                        if len(result.images) >= MAX_IMAGES:
                            raise UploadError("too_many_scanned_pages")
                        if render is None:
                            render = pdfium.PdfDocument(data)
                        rendered_page = render[index]
                        width, height = rendered_page.get_size()
                        bitmap = rendered_page.render(scale=min(2, 1600 / max(width, height)))
                        try:
                            image = bitmap.to_pil()
                            output = io.BytesIO()
                            image.save(output, format="PNG")
                            result.images.append(normalize_image(output.getvalue()))
                        finally:
                            bitmap.close()
                            rendered_page.close()
            finally:
                if render is not None:
                    render.close()
        else:
            raise UploadError()
        if len(result.text) > MAX_TEXT or not result.text.strip() and not result.images:
            raise UploadError("empty_or_large_document")
        return result
    except UploadError:
        raise
    except Exception:
        raise UploadError() from None
