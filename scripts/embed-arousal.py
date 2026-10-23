"""Embed the shared multivariate live engine and numerical library offline.

arousal-engine.js remains the explicitly historical two-feature model.
"""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
path = root / 'Autonomic_Telemetry_Console.html'
html = path.read_text()
start, end = '<!-- AROUSAL_ENGINE_START -->', '<!-- AROUSAL_ENGINE_END -->'
assert html.count(start) == html.count(end) == 1
module = '\n'.join((root / name).read_text() for name in ('research-math.js', 'multivariate-engine.js', 'analysis-view.js'))
assert '</script' not in module.lower()
a, b = html.index(start), html.index(end) + len(end)
styles = (root / 'analysis-view.css').read_text()
path.write_text(html[:a] + start + '\n<style>\n' + styles + '\n</style>\n<script>\n' + module + '\n</script>\n' + end + html[b:])
