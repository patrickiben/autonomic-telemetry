"""Embed the Rest lattice renderer so the Console stays a single offline file."""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
path = root / 'Autonomic_Telemetry_Console.html'
html = path.read_text()
start, end = '<!-- REST_LATTICE_START -->', '<!-- REST_LATTICE_END -->'
assert html.count(start) == html.count(end) == 1
module = (root / 'rest-lattice.js').read_text()
assert '</script' not in module.lower()
a, b = html.index(start), html.index(end) + len(end)
path.write_text(html[:a] + start + '\n<script>\n' + module + '\n</script>\n' + end + html[b:])
