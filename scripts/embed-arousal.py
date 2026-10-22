"""Embed the pure estimator without introducing an online dependency."""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
path = root / 'Autonomic_Telemetry_Console.html'
html = path.read_text()
start, end = '<!-- AROUSAL_ENGINE_START -->', '<!-- AROUSAL_ENGINE_END -->'
assert html.count(start) == html.count(end) == 1
module = (root / 'arousal-engine.js').read_text()
assert '</script' not in module.lower()
a, b = html.index(start), html.index(end) + len(end)
path.write_text(html[:a] + start + '\n<script>\n' + module + '\n</script>\n' + end + html[b:])
