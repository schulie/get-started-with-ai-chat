"""Deployment policy for the stateless clinic app; never infer BAA coverage."""
import os
import re
from dataclasses import dataclass
from urllib.parse import urlsplit
from uuid import UUID


@dataclass(frozen=True)
class SecureConfig:
    tenant: str
    domain: str
    origin: str
    endpoint: str
    chat: str
    vision: str = ""
    images: str = ""
    transcription: str = ""
    approved: frozenset[str] = frozenset()
    api_version: str = "2024-10-21"
    image_api_version: str = ""
    resource_id: str = ""
    data_mode: str = "phi"
    web_enabled: bool = False
    video_analysis_enabled: bool = False

    def __post_init__(self):
        if self.data_mode not in {"phi", "non_sensitive_beta"}:
            raise ValueError("Invalid data mode")
        if self.web_enabled and self.data_mode != "non_sensitive_beta":
            raise ValueError("Web browsing requires a separate privacy review before PHI use")
        if self.video_analysis_enabled and (self.data_mode != "non_sensitive_beta" or "vision" not in self.approved):
            raise ValueError("Video analysis requires beta mode and an approved vision deployment")

    @classmethod
    def from_env(cls):
        tenant = str(UUID(os.environ["JMCGPT_TENANT_ID"]))
        domain = os.environ["JMCGPT_STAFF_DOMAIN"].lower()
        if not re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)+", domain):
            raise ValueError("Invalid staff domain")
        origin = os.environ["JMCGPT_PUBLIC_ORIGIN"]
        url = urlsplit(origin)
        if url.scheme != "https" or url.netloc != url.hostname or url.path or url.query or url.fragment:
            raise ValueError("A complete HTTPS public origin is required")
        endpoint = os.environ["AZURE_OPENAI_ENDPOINT"].rstrip("/")
        url = urlsplit(endpoint)
        if (url.scheme != "https" or not url.hostname or url.netloc != url.hostname
                or not url.hostname.endswith((".openai.azure.com", ".cognitiveservices.azure.com"))
                or url.path or url.query or url.fragment):
            raise ValueError("An Azure OpenAI resource endpoint is required")
        approved = frozenset(filter(None, os.environ.get("JMCGPT_APPROVED_CAPABILITIES", "").split(",")))
        if "chat" not in approved or approved - {"chat", "vision", "images", "transcription"}:
            raise ValueError("Explicitly configure reviewed service capabilities")
        resource_id = os.environ["AZURE_OPENAI_RESOURCE_ID"]
        if not re.fullmatch(r"/subscriptions/[0-9a-fA-F-]{36}/resourceGroups/[A-Za-z0-9_.()-]+/providers/Microsoft\.CognitiveServices/accounts/[A-Za-z0-9_-]+", resource_id, re.IGNORECASE):
            raise ValueError("An Azure resource ID is required for the live retention check")
        for name in ("ENABLE_AZURE_MONITOR_TRACING", "AZURE_TRACING_GEN_AI_CONTENT_RECORDING_ENABLED"):
            if os.getenv(name, "false").lower() != "false":
                raise ValueError("Content tracing must be disabled")
        values = {key: os.getenv(env, "") for key, env in {
            "chat": "AZURE_OPENAI_CHAT_DEPLOYMENT", "vision": "AZURE_OPENAI_VISION_DEPLOYMENT",
            "images": "AZURE_OPENAI_IMAGE_DEPLOYMENT", "transcription": "AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT",
        }.items()}
        for feature in approved:
            if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", values[feature]):
                raise ValueError("A reviewed model deployment is required for each enabled capability")
        api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21")
        image_api_version = os.getenv("AZURE_OPENAI_IMAGE_API_VERSION", "")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:-preview)?", api_version):
            raise ValueError("Invalid Azure API version")
        if "images" in approved and not re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:-preview)?", image_api_version):
            raise ValueError("Explicitly configure the reviewed image API version")
        return cls(tenant, domain, origin, endpoint, **values, approved=approved,
                   api_version=api_version, image_api_version=image_api_version, resource_id=resource_id,
                   data_mode=os.getenv("JMCGPT_DATA_MODE", "phi"),
                   web_enabled=os.getenv("JMCGPT_WEB_ENABLED", "false").lower() == "true",
                   video_analysis_enabled=os.getenv("JMCGPT_VIDEO_ANALYSIS_ENABLED", "false").lower() == "true")
