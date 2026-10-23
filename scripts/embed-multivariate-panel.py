"""Embed the shared live/replay model in Signal Lab without network assets."""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
path = root / 'Autonomic_Telemetry_Signal_Lab.html'
html = path.read_text()
start, end = '<!-- MULTIVARIATE_REPLAY_START -->', '<!-- MULTIVARIATE_REPLAY_END -->'
module = '\n'.join((root / name).read_text() for name in ('multivariate-engine.js', 'analysis-view.js'))
assert '</script' not in module.lower()
block = start + '\n<style>\n' + (root/'analysis-view.css').read_text() + '\n</style>\n<script>\n' + module + '\n</script>\n' + (root/'multivariate-panel.html').read_text() + '\n' + end
if start in html:
    assert html.count(start) == html.count(end) == 1
    a, b = html.index(start), html.index(end) + len(end)
    html = html[:a] + block + html[b:]
else:
    closing = '\n  </body>'
    assert html.count(closing) == 1
    html = html.replace(closing, '\n' + block + closing)
path.write_text(html)
