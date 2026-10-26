"""Assembles index.html: fills the #art and #game script tags from src/, and #level from tools/scribble_isle.json."""
import re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text()
def fill(tag_open, body):
    global html
    pat = re.compile('(' + re.escape(tag_open) + r'\n).*?(\n?</script>)', re.S)
    assert pat.search(html), tag_open
    html = pat.sub(lambda m: m.group(1) + body.rstrip('\n') + '\n</script>', html, count=1)
fill('<script id="s3d">', (root / 'src/s3d.js').read_text())
fill('<script id="art">', (root / 'src/art.js').read_text())
fill('<script id="game">', (root / 'src/game.js').read_text())
fill('<script type="application/json" id="level">', (root / 'tools/scribble_isle.json').read_text())
(root / 'index.html').write_text(html)
print('built index.html', len(html), 'bytes')
