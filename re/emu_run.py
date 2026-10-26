import stable_retro as retro, numpy as np, sys
from PIL import Image
BTN = ['B','A','MODE','START','UP','DOWN','LEFT','RIGHT','C','Y','X','Z']
def mask(*names):
    m = np.zeros(12, dtype=np.uint8)
    for n in names: m[BTN.index(n)] = 1
    return m
class Emu:
    def __init__(self, rom='rom/s3d.md'):
        self.e = retro.RetroEmulator(rom)
        self.data = retro.data.GameData()
        self.e.configure_data(self.data)
        self.f = 0
    def run(self, frames, *buttons):
        for _ in range(frames):
            self.e.set_button_mask(mask(*buttons), 0); self.e.step(); self.f += 1
    def tap(self, *buttons, hold=4, rest=20):
        self.run(hold, *buttons); self.run(rest)
    def ram(self):
        self.data.update_ram()
        blocks = self.data.memory.blocks
        return blocks
    def shot(self, path):
        Image.fromarray(self.e.get_screen()).save(path)

def swapped(ram):
    b = bytearray(ram)
    b[0::2], b[1::2] = ram[1::2], ram[0::2]
    return bytes(b)
def mem(e):
    return swapped(bytes(e.ram()[0xff0000]))
def w16(m, addr, signed=False):
    import struct
    o = addr & 0xFFFF
    return struct.unpack('>h' if signed else '>H', m[o:o+2])[0]

def poke16(e, addr, val):
    """Write a big-endian word to 68k RAM (addr like 0xFFFFC1EC)."""
    full = 0xFF0000 | (addr & 0xFFFF)
    e.data.memory.assign(full, '>u2', val & 0xFFFF)
