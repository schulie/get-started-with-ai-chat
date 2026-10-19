"""Package only reviewed source overlays; never include runtime data or secrets."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import tarfile

FRONTEND_FILES = [
    "release.json",
    "components/agents/AgentPreview.tsx", "components/agents/AgentPreview.module.css",
    "components/agents/AgentPreviewChatBot.tsx", "components/agents/AgentPreviewChatBot.module.css",
    "components/agents/AssistantMessage.tsx", "components/agents/AssistantMessage.module.css",
    "components/agents/UserMessage.module.css", "components/agents/chatbot/types.ts",
    "components/agents/chatbot/ChatInput.tsx", "components/agents/chatbot/ChatInput.module.css",
    "components/agents/chatbot/session.ts", "components/agents/chatbot/TaskStatus.tsx",
    "components/agents/hooks/useChatSession.ts", "components/core/Markdown.tsx",
    "components/core/Markdown.module.css", "components/core/media.ts",
    "components/core/Chart.tsx", "components/core/chartSpec.ts",
]


def release_version():
    repo = Path(__file__).resolve().parents[2]
    version = json.loads((repo / "src/frontend/src/release.json").read_text())["version"]
    assert isinstance(version, str) and re.fullmatch(r"\d+\.\d+\.\d+", version), "Expected a semantic release version"
    assert json.loads((repo / "src/frontend/package.json").read_text())["version"] == version, "Frontend package and release versions must match"
    return version


def package(output):
    here = Path(__file__).resolve().parent
    repo = here.parents[1]
    version = release_version()
    assert (repo / "src/api/privacy.py").read_bytes() == (here / "privacy.py").read_bytes(), "Privacy source and overlay must match"
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    entries = [(repo / "src/frontend/src" / name, "frontend/src/" + name) for name in FRONTEND_FILES]
    entries += [(repo / "src/frontend/src/release.json", "release.json")]
    entries += [(here / name, name) for name in ["Dockerfile", "patch_runtime.py", "patch_page.py", "privacy.py", "azure_openai_chat.py"]]
    entries += [(path, "tests/" + path.name) for path in sorted((here / "tests").glob("test_*.py"))]
    with tarfile.open(output, "w:gz") as archive:
        for path, destination in entries:
            assert path.is_file(), "Required reviewed source missing: " + str(path)
            archive.add(path, arcname=destination, recursive=False)
    return {"version": version, "archive": str(output), "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "files": [destination for _, destination in entries]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    print(json.dumps(package(args.output), indent=2))
