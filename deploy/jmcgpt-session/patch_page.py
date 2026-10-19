"""Version built assets without replacing the deployed clinic page template."""
from pathlib import Path
import json
import os
import re

root = Path("/code/api")
version = json.loads(Path("/code/jmcgpt-release.json").read_text())["version"]
assert isinstance(version, str) and re.fullmatch(r"\d+\.\d+\.\d+", version), "Invalid application release version"
assert os.environ.get("JMCGPT_VERSION") == version, "Image label and application versions must match"
page = root / "templates/index.html"
text = page.read_text()
assert 'data-jmcgpt-release="20261018-clinic"' in text, "Unexpected deployed page"
text = text.replace('data-jmcgpt-release="20261018-clinic"', f'data-jmcgpt-release="{version}"', 1)
text, count = re.subn(r"\?v=jmcgpt-ui-20261018-clinic", f"?v=jmcgpt-{version}", text)
assert count == 2, "Expected both original versioned asset references"
script = (root / "static/react/assets/main-react-app.js").read_text()
for marker in [version, "Session only", "Working", "Regenerate", "Attach text file", "Download SVG"]:
    assert marker in script, "Expected frontend capability missing: " + marker
page.write_text(text)
print(f"JMCGPT {version} frontend version verified")
