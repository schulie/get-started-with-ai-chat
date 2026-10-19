"""Build and optionally activate the session release using existing Azure resources.

Run in an authenticated Azure CLI environment. No provisioning, role changes,
model deployment, database creation, or authentication changes are performed.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import re
from pathlib import Path
import subprocess
import tarfile
import tempfile
import time
from package import package, release_version

APP = "ca-api-ax6jwjezmywau"
GROUP = "rg-jmcai"
REGISTRY = "crax6jwjezmywau"
BASE_IMAGE = "crax6jwjezmywau.azurecr.io/api_and_frontend@sha256:04262c42bbca8f4ec9c8e4c03849c5a7f494cd0fa7e4b24d6830865a5a3bac8e"


def az(*args):
    # Never print complete resource configuration or Azure CLI errors with contents.
    result = subprocess.run(["az", *args, "--only-show-errors", "--output", "json"], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Azure command failed; check Azure access and resource configuration.")
    return json.loads(result.stdout) if result.stdout.strip() else None


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def snapshot():
    resource = az("containerapp", "show", "--name", APP, "--resource-group", GROUP)
    props = resource["properties"]
    template = deepcopy(props["template"])
    template.pop("revisionSuffix", None)
    main = next(item for item in template["containers"] if item["name"] == "main")
    image = main.pop("image")
    model = next((item.get("value") for item in main.get("env", []) if item["name"] == "AZURE_AI_CHAT_DEPLOYMENT_NAME"), None)
    hosts = [item["name"] for item in props["configuration"].get("ingress", {}).get("customDomains", [])]
    auth = az("containerapp", "auth", "show", "--name", APP, "--resource-group", GROUP)
    return {"image": image, "model": model, "hosts": hosts,
        "configuration": digest(props["configuration"]), "identity": digest(resource.get("identity")),
        "template": digest(template), "authentication": digest(auth.get("properties", auth))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--activate", action="store_true", help="Promote the tested image to the existing app")
    parser.add_argument("--expected-current-image", default=BASE_IMAGE,
        help="Previously verified immutable live image; activation stops if it changed")
    args = parser.parse_args()
    version = release_version()
    before = snapshot()
    expected_prefix = REGISTRY + ".azurecr.io/api_and_frontend@sha256:"
    assert args.expected_current_image.startswith(expected_prefix) and re.fullmatch(r"[0-9a-f]{64}", args.expected_current_image[len(expected_prefix):]), "Expected an immutable image in the existing repository"
    assert before["image"] == args.expected_current_image, "The live image differs from the expected current image; inspect it before deployment"
    assert before["model"] == "jmcgpt-astra", "Unexpected model deployment"
    assert "jmcgpt.jaymedical.com" in before["hosts"], "Unexpected custom-domain target"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
    tag = "api_and_frontend:jmcgpt-" + version + "-" + stamp
    with tempfile.TemporaryDirectory(prefix="jmcgpt-source-") as directory:
        root = Path(directory)
        archive = root / "context.tar.gz"
        package(archive)
        context = root / "context"
        context.mkdir()
        with tarfile.open(archive) as source:
            # All archive entries come from the packaging allowlist above.
            source.extractall(context, filter="data")
        result = az("acr", "build", "--registry", REGISTRY, "--image", tag,
            "--file", str(context / "Dockerfile"), "--build-arg", "JMCGPT_VERSION=" + version,
            "--build-arg", "JMCGPT_PUBLIC_ORIGIN=https://jmcgpt.jaymedical.com",
            "--no-logs", str(context))
    manifest = az("acr", "repository", "show", "--name", REGISTRY, "--image", tag)
    image = REGISTRY + ".azurecr.io/api_and_frontend@" + manifest["digest"]
    if not args.activate:
        print(json.dumps({"version": version, "built_image": image, "activated": False, "build_id": result.get("runId") if isinstance(result, dict) else None}))
        return
    assert snapshot() == before, "Application changed during build; activation stopped"
    revision_suffix = "v" + version.replace(".", "-") + "-" + stamp
    az("containerapp", "update", "--name", APP, "--resource-group", GROUP,
        "--container-name", "main", "--image", image, "--revision-suffix", revision_suffix)
    revision_name = APP + "--" + revision_suffix
    deadline = time.monotonic() + 300
    while True:
        revision = az("containerapp", "revision", "show", "--name", APP,
            "--resource-group", GROUP, "--revision", revision_name)["properties"]
        if (revision.get("healthState") == "Healthy" and revision.get("runningState") == "Running"
            and revision.get("provisioningState") == "Provisioned" and revision.get("trafficWeight") == 100):
            break
        if revision.get("provisioningState") == "Failed" or time.monotonic() >= deadline:
            raise RuntimeError("The new revision has not become healthy with 100% traffic; inspect Azure before reporting completion.")
        time.sleep(10)
    after = snapshot()
    assert after["image"] == image, "Image activation was not confirmed"
    for field in ("configuration", "identity", "template", "authentication", "model", "hosts"):
        assert after[field] == before[field], "Unexpected application change: " + field
    print(json.dumps({"version": version, "activated": True, "image": image, "rollback_image": before["image"],
        "configuration_identity_authentication_preserved": True, "healthy_revision": revision_name, "traffic_percent": 100, "url": "https://jmcgpt.jaymedical.com/"}))


if __name__ == "__main__":
    main()
