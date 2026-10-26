#!/bin/sh
# Builds src/md_sound.wasm (the Mega Drive sound hardware) with clang's WebAssembly target; then run tools/build.py.
set -e
cd "$(dirname "$0")/.."
CF="--target=wasm32 -O2 -ffreestanding -nostdlib -Isound/inc -Ithird_party/chips -Ithird_party/Nuked-OPN2 -fvisibility=hidden -Wno-incompatible-library-redeclaration"
clang $CF -c sound/md_sound.c -o /tmp/md_sound.o
clang $CF -c third_party/Nuked-OPN2/ym3438.c -o /tmp/ym3438.o
wasm-ld --no-entry --export-dynamic -z stack-size=65536 --initial-memory=8388608 /tmp/md_sound.o /tmp/ym3438.o -o src/md_sound.wasm
ls -l src/md_sound.wasm
