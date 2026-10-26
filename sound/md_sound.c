/* Mega Drive sound hardware for Blast Grid: Z80 (floooh/chips z80.h, zlib licence), YM2612 (Nuked-OPN2, LGPL-2.1),
   SN76489 (written here), and the Z80's view of the Mega Drive bus. The game's own sound driver runs on the Z80 from
   the player's ROM; JavaScript plays the 68000's part (uploads the driver, writes sound requests into Z80 RAM).
   Clocks follow the NTSC master clock (53.693175 MHz): Z80 = /15, YM2612 internal step = /42, PSG = /15/16. */
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#define CHIPS_IMPL
#include "z80.h"
#include "ym3438.h"

#define EXPORT __attribute__((visibility("default")))

void *memset(void *d, int c, size_t n) { uint8_t *p = d; while (n--) *p++ = (uint8_t)c; return d; }
void *memcpy(void *d, const void *s, size_t n) { uint8_t *p = d; const uint8_t *q = s; while (n--) *p++ = *q++; return d; }

static uint8_t rom[0x400000];
static uint32_t rom_size;
static uint8_t zram[0x2000];
static uint32_t bank;              /* 9-bit 68000 window: address = bank << 15 */
static z80_t cpu;
static uint64_t pins;
static ym3438_t ym;
static bool z80_running;

/* ---- SN76489 (the Mega Drive's PSG): three square channels and one noise channel ---- */
static struct { uint16_t tone[3]; uint8_t vol[4]; uint8_t noise; uint8_t latch; uint16_t cnt[4]; uint8_t out[4];
                uint16_t lfsr; } psg;
static const int16_t psg_vol[16] = { 4096, 3254, 2584, 2053, 1631, 1295, 1029, 817, 649, 516, 410, 325, 258, 205, 163, 0 };
static void psg_reset(void) { memset(&psg, 0, sizeof psg); for (int i = 0; i < 4; i++) psg.vol[i] = 15; psg.lfsr = 0x8000; }
static void psg_write(uint8_t d) {
    if (d & 0x80) {
        psg.latch = (d >> 4) & 7;
        int ch = psg.latch >> 1;
        if (psg.latch & 1) psg.vol[ch] = d & 15;
        else if (ch < 3) psg.tone[ch] = (psg.tone[ch] & 0x3F0) | (d & 15);
        else { psg.noise = d & 7; psg.lfsr = 0x8000; }
    } else {
        int ch = psg.latch >> 1;
        if (psg.latch & 1) psg.vol[ch] = d & 15;
        else if (ch < 3) psg.tone[ch] = (psg.tone[ch] & 15) | ((d & 0x3F) << 4);
        else { psg.noise = d & 7; psg.lfsr = 0x8000; }
    }
}
/* one PSG clock (master / 240) */
static void psg_clock(void) {
    for (int c = 0; c < 3; c++) {
        if (psg.cnt[c]) psg.cnt[c]--;
        if (!psg.cnt[c]) { psg.cnt[c] = psg.tone[c] ? psg.tone[c] : 1; psg.out[c] ^= 1; }
    }
    if (psg.cnt[3]) psg.cnt[3]--;
    if (!psg.cnt[3]) {
        int r = psg.noise & 3;
        psg.cnt[3] = r == 3 ? (psg.tone[2] ? psg.tone[2] : 1) : (0x10 << r);
        psg.out[3] ^= 1;
        if (psg.out[3]) {   /* shift once per full period */
            uint16_t fb = (psg.noise & 4) ? ((psg.lfsr & 1) ^ ((psg.lfsr >> 3) & 1)) : (psg.lfsr & 1);
            psg.lfsr = (psg.lfsr >> 1) | (fb << 15);
        }
    }
}
static int32_t psg_sample(void) {
    int32_t s = 0;
    for (int c = 0; c < 3; c++) if (psg.out[c] || psg.tone[c] <= 1) s += psg_vol[psg.vol[c]];
    if (psg.lfsr & 1) s += psg_vol[psg.vol[3]];
    return s;
}

/* ---- the Z80's bus ---- */
static uint8_t bus_read(uint16_t a) {
    if (a < 0x4000) return zram[a & 0x1FFF];
    if (a < 0x6000) return OPN2_Read(&ym, a & 3);
    if (a >= 0x8000) { uint32_t m = (bank << 15) | (a & 0x7FFF); return m < rom_size ? rom[m] : 0xFF; }
    return 0xFF;
}
static void bus_write(uint16_t a, uint8_t d) {
    if (a < 0x4000) zram[a & 0x1FFF] = d;
    else if (a < 0x6000) OPN2_Write(&ym, a & 3, d);
    else if (a < 0x6100) bank = ((bank >> 1) | ((uint32_t)(d & 1) << 8)) & 0x1FF;
    else if (a >= 0x7F10 && a < 0x7F18) psg_write(d);
}

/* ---- running: master clock bookkeeping, output at the YM2612's own rate (53267 Hz) ---- */
static uint32_t master_z80, master_ym, master_psg, frame_pos, int_left;
static int32_t acc_l, acc_r, ym_slot;
static int16_t outbuf[2 * 4096];
static int32_t dc_xl, dc_xr, dc_yl, dc_yr;   /* DC blocker state (Q8): the YM2612 output sits off zero */
#define FRAME 896040u   /* master clocks per NTSC frame: 3420 x 262 */

EXPORT uint8_t *md_rom(void) { return rom; }
EXPORT uint8_t *md_zram(void) { return zram; }
EXPORT int16_t *md_out(void) { return outbuf; }
EXPORT void md_set_rom_size(uint32_t n) { rom_size = n > sizeof rom ? sizeof rom : n; }
EXPORT void md_reset(void) {
    memset(zram, 0, sizeof zram); bank = 0; pins = z80_init(&cpu); z80_running = false;
    OPN2_SetChipType(ym3438_mode_ym2612); OPN2_Reset(&ym); psg_reset();
    master_z80 = master_ym = master_psg = frame_pos = int_left = 0; acc_l = acc_r = 0; ym_slot = 0; dc_xl = dc_xr = dc_yl = dc_yr = 0;
}
EXPORT void md_start(void) { pins = z80_reset(&cpu); z80_running = true; }
EXPORT void md_stop(void) { z80_running = false; }

static void z80_step(void) {
    if (!z80_running) return;
    if (int_left) { pins |= Z80_INT; int_left--; } else pins &= ~Z80_INT;
    pins = z80_tick(&cpu, pins);
    if (pins & Z80_MREQ) {
        uint16_t a = Z80_GET_ADDR(pins);
        if (pins & Z80_RD) { Z80_SET_DATA(pins, bus_read(a)); }
        else if (pins & Z80_WR) { bus_write(a, Z80_GET_DATA(pins)); }
    } else if (pins & Z80_IORQ) {
        if (pins & Z80_M1) { Z80_SET_DATA(pins, 0xFF); }    /* interrupt acknowledge (IM 1 ignores the byte) */
        else if (pins & Z80_RD) { Z80_SET_DATA(pins, 0xFF); }
    }
}

/* render n samples at 53267 Hz into outbuf (stereo int16) */
EXPORT int md_render(int n) {
    if (n > 4096) n = 4096;
    int made = 0;
    while (made < n) {
        /* advance the earliest of the three clocks by its period */
        uint32_t next_z = master_z80 + 15, next_y = master_ym + 42, next_p = master_psg + 240;
        if (next_z <= next_y && next_z <= next_p) {
            frame_pos += next_z - master_z80; master_z80 = next_z;
            if (frame_pos >= FRAME) { frame_pos -= FRAME; int_left = 228; }
            z80_step();
        } else if (next_y <= next_p) {
            master_ym = next_y;
            int16_t b[2]; OPN2_Clock(&ym, b); acc_l += b[0]; acc_r += b[1];
            if (++ym_slot == 24) {
                int32_t p = psg_sample() >> 2;
                int32_t l = acc_l * 6 + p, r = acc_r * 6 + p;
                /* y = x - x_prev + 0.995 y_prev, in fixed point */
                int32_t yl = l - dc_xl + (int32_t)(((int64_t)dc_yl * 255) >> 8), yr = r - dc_xr + (int32_t)(((int64_t)dc_yr * 255) >> 8);
                dc_xl = l; dc_xr = r; dc_yl = yl; dc_yr = yr; l = yl; r = yr;
                outbuf[made * 2] = (int16_t)(l > 32767 ? 32767 : l < -32768 ? -32768 : l);
                outbuf[made * 2 + 1] = (int16_t)(r > 32767 ? 32767 : r < -32768 ? -32768 : r);
                made++; acc_l = acc_r = 0; ym_slot = 0;
            }
        } else { master_psg = next_p; psg_clock(); }
        /* keep the counters small */
        if (master_z80 > 0x40000000u && master_ym > 0x40000000u && master_psg > 0x40000000u) {
            master_z80 -= 0x40000000u; master_ym -= 0x40000000u; master_psg -= 0x40000000u;
        }
    }
    return made;
}
