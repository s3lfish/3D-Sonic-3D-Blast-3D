# Third-party code

Compiled into `src/md_sound.wasm` (the Mega Drive sound hardware) by `sound/build.sh`.

| Folder | What | Licence | Upstream |
| --- | --- | --- | --- |
| `chips/z80.h` | Z80 processor emulator by Andre Weissflog | zlib/libpng (`chips/LICENSE`) | https://github.com/floooh/chips |
| `Nuked-OPN2/` | YM2612 (OPN2) emulator by Nuke.YKT | LGPL-2.1 (`Nuked-OPN2/LICENSE`) | https://github.com/nukeykt/Nuked-OPN2 |

`VERSION` in each folder records the upstream commit used. Both are used unchanged. The LGPL allows these files to
be combined with this GPL-3.0 project; their full source is here, and `sound/build.sh` rebuilds the module from it.
