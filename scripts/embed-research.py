"""Keep the shipped Signal Lab self-contained after editing research sources."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
lab = root / "Autonomic_Telemetry_Signal_Lab.html"
start = "<!-- RESEARCH_ENGINE_START -->"
end = "<!-- RESEARCH_ENGINE_END -->"
html = lab.read_text()
module = (root / "research-math.js").read_text()
panel = (root / "research-panel.html").read_text()
assert "</script" not in module.lower(), "Unsafe script terminator in module"
block = start + "\n<script>\n" + module + "\n</script>\n" + panel + "\n" + end
if start in html:
    assert html.count(start) == html.count(end) == 1
    a, b = html.index(start), html.index(end) + len(end)
    html = html[:a] + block + html[b:]
else:
    closing = "\n  </body>"
    assert html.count(closing) == 1
    html = html.replace(closing, "\n" + block + closing)
lab.write_text(html)
