"""Writes tools/scribble_isle.json into the #level tag of index.html."""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text()
level = (root / 'tools' / 'scribble_isle.json').read_text().strip()
pat = re.compile(r'(<script type="application/json" id="level">\n).*?(\n</script>)', re.S)
assert pat.search(html), 'level tag not found'
html = pat.sub(lambda m: m.group(1) + level + m.group(2), html, count=1)
(root / 'index.html').write_text(html)
print('embedded', len(level), 'bytes')
