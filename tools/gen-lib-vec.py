#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成 assets/lib-vec.json —— 把 assets/FH6_Vinyl_Symbols.svg 里全部符号的灰度掩膜
（JPEG，尺寸约等于符号框的 4 倍，绝大多数是纯二值、无抗锯齿）追踪成矢量路径。

为什么需要它（2026-11-09）：
  符号素材本体是「约 4 倍于符号框」的二值掩膜。画布放大超过这个倍率后，位图不再有任何
  细节可采 ⇒ 边缘出现与放大倍数同宽的台阶（锯齿）。逐层纹理 LOD 只能做到素材原生分辨率，
  无法突破。追踪成路径后，显示走矢量，任意缩放都是硬边，且不再需要随缩放重建纹理。

每个符号的流程：
  1. marching squares 在 0.5 等值线取闭合环（二值场下交点恒落在像素边界，无插值误差）；
  2. RDP(eps=1.0px) 找显著折点，转角 > 42° 判为尖角；尖角位置再用两侧直边求交细化
     （二值栅格会把直角切成 1px 斜角，求交可把它还原成真正的尖点）；
  3. 从尖角把环切成若干段，段内高斯平滑（σ=1.6px）去掉 1px 台阶，端点钉在尖角上；
  4. 按 --err（默认 0.35px，低于素材自身的 ±0.5px 量化）拟合三次 Bézier；
  5. 输出 path：整数坐标（单位 = 符号单位的 1/1000），相对 c 命令，viewBox = 0 0 sw*1000 sh*1000。

用法：
  python tools/gen-lib-vec.py                 # 全量生成 assets/lib-vec.json
  python tools/gen-lib-vec.py --probe 40      # 只跑 40 个，打印体积统计，不写盘
  python tools/gen-lib-vec.py --err 0.45 --sigma 2.0
"""
import base64
import io
import json
import math
import os
import re
import sys
import time
from multiprocessing import Pool

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'FH6_Vinyl_Symbols.svg')
DST = os.path.join(ROOT, 'assets', 'lib-vec.json')
PREF = 'xlink:href="data:image/jpeg;base64,'
ERR = 0.35
SIGMA = 1.2
MIN_IOU = 0.88        # 追踪结果与原掩膜的 IoU 门：低于它的符号不写进资产（运行期退回原栅格路径）。
                      # 0.88 而不是 0.95：细长条形素材（如 35×513 的竖条）1px 边缘误差就吃掉 6% IoU，
                      # 用高门槛会把本来正确的追踪拒掉；真正的坏样本（内外翻转）IoU 只有 0.08。
MAX_BYTES = 40000     # 单符号 path 上限：超过它不值得（多为噪点型素材），同样退回栅格
SIGMA_PRE = 0.9       # 追踪前对灰度场做高斯预平滑：纯二值场里两个环常常在一个像素点相切，
                      # 「每个交点只有一出边」的前提会被破坏，环会串错（实测某符号 IoU 掉到 0.33）。
CORNER_DEG = 42.0
UNIT = 1000.0        # 输出坐标单位 = 符号单位 / 1000


# ---------------------------------------------------------------- marching squares
def trace_rings(a, level=0.5):
    a = np.pad(np.asarray(a, dtype=np.float64), 1, mode='constant', constant_values=0.0)
    atl = a[:-1, :-1]; atr = a[:-1, 1:]
    abl = a[1:, :-1]; abr = a[1:, 1:]

    def frac(a0, a1):
        d = a1 - a0
        with np.errstate(divide='ignore', invalid='ignore'):
            t = np.where(np.abs(d) < 1e-12, 0.5, (level - a0) / d)
        return np.clip(t, 0.0, 1.0)

    tT = frac(atl, atr); tR = frac(atr, abr); tB = frac(abl, abr); tL = frac(atl, abl)
    I, J = np.indices(atl.shape)
    P = {
        'T': np.stack([J + tT, I * 1.0], axis=-1),
        'R': np.stack([J + 1.0, I + tR], axis=-1),
        'B': np.stack([J + tB, I + 1.0], axis=-1),
        'L': np.stack([J * 1.0, I + tL], axis=-1),
    }
    code = ((atl > level).astype(np.int8) << 3) | ((atr > level).astype(np.int8) << 2) | \
           ((abr > level).astype(np.int8) << 1) | (abl > level).astype(np.int8)
    CASES = {
        1: [('L', 'B')], 2: [('B', 'R')], 3: [('L', 'R')],
        4: [('R', 'T')], 6: [('B', 'T')], 7: [('L', 'T')],
        8: [('T', 'L')], 9: [('T', 'B')], 11: [('T', 'R')],
        12: [('R', 'L')], 13: [('R', 'B')], 14: [('B', 'L')],
    }
    out_edges = {}

    def add(p0, p1):
        k0 = (round(float(p0[0]), 3), round(float(p0[1]), 3))
        k1 = (round(float(p1[0]), 3), round(float(p1[1]), 3))
        if k0 == k1:
            return
        out_edges.setdefault(k0, []).append(k1)
        out_edges.setdefault(k1, [])

    ci, cj = np.nonzero((code != 0) & (code != 15))
    for i, j in zip(ci.tolist(), cj.tolist()):
        c = int(code[i, j])
        if c == 5 or c == 10:
            avg = (atl[i, j] + atr[i, j] + abl[i, j] + abr[i, j]) * 0.25
            if c == 5:
                segs = [('T', 'L'), ('R', 'B')] if avg > level else [('T', 'R'), ('L', 'B')]
            else:
                segs = [('L', 'B'), ('T', 'R')] if avg > level else [('R', 'B'), ('T', 'L')]
        else:
            segs = CASES.get(c, [])
        for s0, s1 in segs:
            add(P[s0][i, j], P[s1][i, j])

    rings, visited = [], set()
    for start in list(out_edges.keys()):
        for first in (out_edges.get(start) or []):
            if (start, first) in visited:
                continue
            ring = [start]
            visited.add((start, first))
            cur = first
            guard = 0
            while guard < 6000000:
                guard += 1
                if cur == start:
                    break
                ring.append(cur)
                nxt = None
                for cand in (out_edges.get(cur) or []):
                    if (cur, cand) not in visited:
                        nxt = cand
                        break
                if nxt is None:
                    break
                visited.add((cur, nxt))
                cur = nxt
            if len(ring) >= 4:
                rings.append(np.array(ring, dtype=np.float64))
    return rings


def trace_field(a):
    """灰度场 → 环。先高斯预平滑：纯二值场里两个环常在一个像素点相切，
    「每个交点只有一出边」的前提被破坏，环会串错（实测某符号 IoU 掉到 0.33）。"""
    f = gaussian_filter(a, SIGMA_PRE, mode='constant', cval=0.0) if SIGMA_PRE > 0 else a
    return trace_rings(f)


# ---------------------------------------------------------------- 几何
def ring_area(p):
    x = p[:, 0]; y = p[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def rdp_idx(pts, eps):
    n = len(pts)
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[n - 1] = True
    stack = [(0, n - 1)]
    while stack:
        i0, i1 = stack.pop()
        if i1 - i0 < 2:
            continue
        a = pts[i0]; b = pts[i1]
        ab = b - a
        L = float(math.hypot(ab[0], ab[1]))
        seg = pts[i0 + 1:i1]
        if len(seg) == 0:
            continue
        if L < 1e-12:
            d = np.linalg.norm(seg - a, axis=1)
        else:
            d = np.abs(ab[0] * (seg[:, 1] - a[1]) - ab[1] * (seg[:, 0] - a[0])) / L
        k = int(np.argmax(d))
        if d[k] > eps:
            m = i0 + 1 + k
            keep[m] = True
            stack.append((i0, m))
            stack.append((m, i1))
    return np.nonzero(keep)[0].tolist()


def _gk(sigma):
    r = int(max(1, round(sigma * 3)))
    x = np.arange(-r, r + 1)
    k = np.exp(-(x * x) / (2.0 * sigma * sigma))
    return k / k.sum()


def smooth_open(p, sigma):
    """开放点列高斯平滑（反射边界，端点钉住）。"""
    n = len(p)
    k = _gk(sigma)
    r = (len(k) - 1) // 2
    if n < 2 * r + 2:
        return p
    o = np.empty_like(p)
    for d in range(2):
        q = np.pad(p[:, d], r, mode='reflect')
        o[:, d] = np.convolve(q, k, mode='valid')
    o[0] = p[0]; o[-1] = p[-1]
    return o


def find_corners(ring):
    n = len(ring)
    keep = [k for k in rdp_idx(np.vstack([ring, ring[:1]]), 1.0) if k < n]
    if len(keep) < 3:
        return []
    out = []
    L = len(keep)
    for i in range(L):
        A = ring[keep[i - 1]]; B = ring[keep[i]]; C = ring[keep[(i + 1) % L]]
        v1 = B - A; v2 = C - B
        n1 = float(np.linalg.norm(v1)); n2 = float(np.linalg.norm(v2))
        if n1 < 1e-9 or n2 < 1e-9:
            continue
        cosang = float(np.dot(v1, v2)) / (n1 * n2)
        if math.degrees(math.acos(max(-1.0, min(1.0, cosang)))) > CORNER_DEG:
            out.append(keep[i])
    return sorted(set(out))


def refine_corner(ring, i, span=8):
    """把二值栅格切出来的 1px 斜角还原成真正的尖点：两侧各取一段直边求交。"""
    n = len(ring)
    if n < 4 * span + 8:
        return ring[i]
    a0 = ring[(i - span) % n]; a1 = ring[(i - 2) % n]
    b0 = ring[(i + 2) % n]; b1 = ring[(i + span) % n]
    da = a1 - a0; db = b1 - b0
    la = float(np.linalg.norm(da)); lb = float(np.linalg.norm(db))
    if la < 1e-9 or lb < 1e-9:
        return ring[i]
    da /= la; db /= lb
    den = da[0] * db[1] - da[1] * db[0]
    if abs(den) < 0.2:          # 近乎平行：不是尖角
        return ring[i]
    t = ((b0[0] - a0[0]) * db[1] - (b0[1] - a0[1]) * db[0]) / den
    p = a0 + da * t
    if float(np.linalg.norm(p - ring[i])) > 2.0:
        return ring[i]
    return p


# ---------------------------------------------------------------- Bézier 拟合（Schneider）
def _bez_all(p0, p1, p2, p3, U):
    mt = 1.0 - U
    return (np.outer(mt ** 3, p0) + np.outer(3 * mt * mt * U, p1) +
            np.outer(3 * mt * U * U, p2) + np.outer(U ** 3, p3))


def _chord_param(pts):
    d = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    u = np.concatenate([[0.0], np.cumsum(d)])
    total = float(u[-1])
    if total <= 1e-12:
        return np.linspace(0.0, 1.0, len(pts))
    return u / total


def _gen_bezier(pts, u, t1, t2):
    p0, p3 = pts[0], pts[-1]
    mt = 1.0 - u
    a1 = np.outer(3 * u * mt * mt, t1)
    a2 = np.outer(3 * u * u * mt, t2)
    c00 = float(np.einsum('ij,ij->', a1, a1))
    c01 = float(np.einsum('ij,ij->', a1, a2))
    c11 = float(np.einsum('ij,ij->', a2, a2))
    tmp = pts - (np.outer(mt ** 3, p0) + np.outer(u ** 3, p3))
    x0 = float(np.einsum('ij,ij->', a1, tmp))
    x1 = float(np.einsum('ij,ij->', a2, tmp))
    det = c00 * c11 - c01 * c01
    seg = float(np.linalg.norm(p3 - p0))
    if abs(det) < 1e-12:
        al = be = seg / 3.0
    else:
        al = (x0 * c11 - x1 * c01) / det
        be = (c00 * x1 - c01 * x0) / det
    lim = max(seg * 3.0, 1e-9)
    if al < 1e-6 or be < 1e-6 or al > lim or be > lim:
        al = be = seg / 3.0
    return np.array([p0, p0 + t1 * al, p3 + t2 * be, p3])


def _max_err(pts, u, bez):
    p0, p1, p2, p3 = bez
    d = np.linalg.norm(pts - _bez_all(p0, p1, p2, p3, u), axis=1)
    k = int(np.argmax(d))
    return float(d[k]), k


def _reparam(pts, u, bez):
    p0, p1, p2, p3 = bez
    u = u.copy()
    for _ in range(5):
        B = _bez_all(p0, p1, p2, p3, u)
        mt = 1.0 - u
        D = (np.outer(3 * mt * mt, (p1 - p0)) + np.outer(6 * mt * u, (p2 - p1)) +
             np.outer(3 * u * u, (p3 - p2)))
        num = np.einsum('ij,ij->i', (B - pts), D)
        den = np.einsum('ij,ij->i', D, D)
        den = np.where(den < 1e-12, 1e-12, den)
        u = np.clip(u - num / den, 0.0, 1.0)
    return u


def _split_bez(bez, t):
    p0, p1, p2, p3 = bez
    p01 = p0 + (p1 - p0) * t
    p12 = p1 + (p2 - p1) * t
    p23 = p2 + (p3 - p2) * t
    p012 = p01 + (p12 - p01) * t
    p123 = p12 + (p23 - p12) * t
    p = p012 + (p123 - p012) * t
    return np.array([p0, p01, p012, p]), np.array([p, p123, p23, p3])


def fit_cubic(pts, t1, t2, err, depth=0):
    n = len(pts)
    if n < 2:
        return []
    if n == 2:
        d = float(np.linalg.norm(pts[1] - pts[0])) / 3.0
        return [np.array([pts[0], pts[0] + t1 * d, pts[1] + t2 * d, pts[1]])]
    u = _chord_param(pts)
    bez = _gen_bezier(pts, u, t1, t2)
    e, split = _max_err(pts, u, bez)
    if e < err:
        return [bez]
    if e < err * 4.0 and n > 3:
        for _ in range(4):
            u2 = _reparam(pts, u, bez)
            bez = _gen_bezier(pts, u2, t1, t2)
            e, split = _max_err(pts, u2, bez)
            u = u2
            if e < err:
                return [bez]
    if depth > 20 or split <= 0 or split >= n - 1:
        return [bez]
    left, right = _split_bez(bez, float(u[split]))
    d = pts[split - 1] - pts[split + 1]
    nn = float(np.linalg.norm(d))
    c = d / nn if nn > 1e-9 else np.array([-t1[1], t1[0]])
    return fit_cubic(pts[:split + 1], t1, c, err, depth + 1) + \
        fit_cubic(pts[split:], -c, t2, err, depth + 1)


def fit_seg(pts, err):
    n = len(pts)
    if n < 2:
        return []
    if n == 2:
        return [np.array([pts[0], pts[0] * 2 / 3 + pts[1] / 3, pts[0] / 3 + pts[1] * 2 / 3, pts[1]])]
    d1 = pts[1] - pts[0]
    d2 = pts[-2] - pts[-1]
    n1 = float(np.linalg.norm(d1)); n2 = float(np.linalg.norm(d2))
    t1 = d1 / n1 if n1 > 1e-9 else np.array([1.0, 0.0])
    t2 = d2 / n2 if n2 > 1e-9 else np.array([-1.0, 0.0])
    return fit_cubic(np.asarray(pts, dtype=np.float64), t1, t2, err)


# ---------------------------------------------------------------- 输出
def _emit(segs, scale, with_m=True):
    """绝对 C 命令。
    ★ 不用相对 c：实测 Chromium 里相对 c 的三个坐标对**不是首尾相接**的
      （`M0 0 c100 0 100 100 0 100` 的墨迹宽 75 而不是 200），本仓的增量写法
      搬过去会把整条路径缩成 1/3 并出现畸形碎片；绝对 C 没有这个歧义。"""
    if not segs:
        return ''
    f = lambda v: str(int(round(v * scale)))
    out = ['M' + f(segs[0][0][0]) + ' ' + f(segs[0][0][1])] if with_m else []
    for b in segs:
        out.append('C' + f(b[1][0]) + ' ' + f(b[1][1]) + ' ' + f(b[2][0]) + ' ' + f(b[2][1]) +
                   ' ' + f(b[3][0]) + ' ' + f(b[3][1]))
    return ''.join(out)


def ring_to_d(ring, scale, err, sigma):
    n = len(ring)
    if n < 4:
        return ''
    corners = find_corners(ring)
    if len(corners) < 2:
        p = np.vstack([ring, ring[:1]])
        p = smooth_open(p, sigma)
        p[0] = ring[0]; p[-1] = ring[0]
        return _emit(fit_seg(p, err), scale) + 'z'
    pts = [refine_corner(ring, c) for c in corners]
    parts = []
    m = len(corners)
    for k in range(m):
        i0 = corners[k]
        i1 = corners[(k + 1) % m]
        if i1 <= i0:
            i1 += n
        # 取两端尖角之间的原始点（去掉斜角尖端），首尾换成细化后的尖点
        lo = i0 + 2
        hi = i1 - 2
        mid = ring[np.arange(lo, hi + 1) % n] if hi >= lo else np.zeros((0, 2))
        p = np.vstack([pts[k].reshape(1, 2), mid, pts[(k + 1) % m].reshape(1, 2)])
        if len(p) < 2:
            continue
        p = smooth_open(p, sigma)
        p[0] = pts[k]; p[-1] = pts[(k + 1) % m]
        segs = fit_seg(p, err)
        if segs:
            parts.append(segs)
    if not parts:
        return ''
    out = []
    for k, segs in enumerate(parts):
        out.append(_emit(segs, scale, k == 0))
    return ''.join(out) + 'z'


# ---------------------------------------------------------------- 单符号
def parse_symbols():
    txt = open(SRC, encoding='utf-8', errors='replace').read()
    pat = re.compile(r'<symbol\s+([^>]*)>')
    out = []
    for m in pat.finditer(txt):
        attrs = m.group(1)
        idm = re.search(r'id="([^"]+)"', attrs)
        wm = re.search(r'width="([^"]+)"', attrs)
        hm = re.search(r'height="([^"]+)"', attrs)
        if not (idm and wm and hm):
            continue
        end = txt.find('</symbol>', m.start())
        seg = txt[m.start():end]
        i = seg.find(PREF)
        if i < 0:
            continue
        b64 = re.match(r'[A-Za-z0-9+/=]+', seg[i + len(PREF):])
        if not b64:
            continue
        out.append((idm.group(1), float(wm.group(1)), float(hm.group(1)), b64.group(0)))
    return out, len(txt)


def raster_rings(rings, W, H, ss=2):
    """even-odd 栅格化（每环单独填充后 XOR），用来算 IoU。"""
    acc = np.zeros((H * ss, W * ss), dtype=bool)
    for r in rings:
        if len(r) < 3:
            continue
        img = Image.new('1', (W * ss, H * ss), 0)
        ImageDraw.Draw(img).polygon([(float(x) * ss, float(y) * ss) for x, y in r], fill=1)
        acc ^= np.asarray(img, dtype=bool)
    return np.asarray(Image.fromarray((acc.astype(np.uint8) * 255)).resize((W, H), Image.BOX),
                      dtype=np.float32) / 255.0


def parse_d(d):
    """M x y 然后若干绝对 C x1 y1 x2 y2 x3 y3，末尾 z（与 _emit 一一对应）。"""
    toks = re.findall(r'[MCz]|-?[0-9]+', d)
    rings, cur_ring, cur, i, n = [], [], np.zeros(2), 0, 0
    n = len(toks)
    while i < n:
        t = toks[i]
        if t == 'M':
            if cur_ring:
                rings.append(np.array(cur_ring))
            cur = np.array([float(toks[i + 1]), float(toks[i + 2])])
            cur_ring = [cur]
            i += 3
        elif t == 'C':
            nums = [float(x) for x in toks[i + 1:i + 7]]
            i += 7
            p0 = cur
            p1 = np.array(nums[0:2])
            p2 = np.array(nums[2:4])
            p3 = np.array(nums[4:6])
            for u in np.linspace(0, 1, 5)[1:]:
                mt = 1 - u
                cur_ring.append((mt ** 3) * p0 + 3 * (mt ** 2) * u * p1 + 3 * mt * u * u * p2 + (u ** 3) * p3)
            cur = p3
        elif t == 'z':
            if cur_ring:
                rings.append(np.array(cur_ring))
                cur_ring = []
            i += 1
        else:
            i += 1
    if cur_ring:
        rings.append(np.array(cur_ring))
    return rings


def build_one(item):
    key, sw, sh, b64 = item
    try:
        im = Image.open(io.BytesIO(base64.b64decode(b64))).convert('L')
    except Exception as e:
        return key, '', 'decode:' + str(e)[:80]
    a = np.asarray(im, dtype=np.float64) / 255.0
    rings = trace_field(a)
    # 输出单位：符号单位 × 1000。掩膜像素 → 符号单位的系数 sw/maskW，再 ×1000
    scale = sw / float(im.size[0]) * UNIT
    ds = []
    for r in rings:
        if abs(ring_area(r)) < 2.0:
            continue
        d = ring_to_d(r, scale, ERR, SIGMA)
        if d:
            ds.append(d)
    d = ''.join(ds)
    if not d:
        return key, '', 'empty'
    if len(d) > MAX_BYTES:
        return key, '', 'toolong:%d' % len(d)
    # 质量门：按符号单位还原成掩膜像素坐标，跟原掩膜算 IoU
    W, H = im.size
    pr = [[(x / UNIT / sw * W, y / UNIT / sh * H) for x, y in rr] for rr in parse_d(d)]
    pr = [np.array(rr) for rr in pr if len(rr) >= 3]
    rec = raster_rings(pr, W, H, ss=2)
    est = (rec > 0.5)
    tru = (a > 0.5)
    inter = float(np.count_nonzero(est & tru))
    union = float(np.count_nonzero(est | tru))
    iou = inter / max(1.0, union)
    if iou < MIN_IOU:
        return key, '', 'lowiou:%.3f' % iou
    return key, d, ''


def main():
    global ERR, SIGMA, SIGMA_PRE
    if '--err' in sys.argv:
        ERR = float(sys.argv[sys.argv.index('--err') + 1])
    if '--sigma' in sys.argv:
        SIGMA = float(sys.argv[sys.argv.index('--sigma') + 1])
    if '--presigma' in sys.argv:
        SIGMA_PRE = float(sys.argv[sys.argv.index('--presigma') + 1])
    syms, symlen = parse_symbols()
    probe = 0
    if '--probe' in sys.argv:
        probe = int(sys.argv[sys.argv.index('--probe') + 1])
    todo = syms[:probe] if probe else syms
    print('symbols=%d  symLen=%d  todo=%d  err=%.2f sigma=%.2f presigma=%.2f' % (
        len(syms), symlen, len(todo), ERR, SIGMA, SIGMA_PRE), flush=True)
    t0 = time.time()
    results, fails = {}, []
    workers = max(1, min(12, (os.cpu_count() or 4)))
    with Pool(workers) as pool:
        for i, (key, d, err) in enumerate(pool.imap_unordered(build_one, todo, chunksize=4)):
            if err or not d:
                fails.append((key, err or 'empty'))
            else:
                results[key] = d
            if (i + 1) % 100 == 0:
                print('  %d/%d  %.1fs' % (i + 1, len(todo), time.time() - t0), flush=True)
    total = sum(len(v) for v in results.values())
    print('done %.1fs  ok=%d fail=%d  bytes=%d  avg=%d  max=%d  (estimate 1400: %.2f MB)' % (
        time.time() - t0, len(results), len(fails), total,
        total // max(1, len(results)), max((len(v) for v in results.values()), default=0),
        (total / max(1, len(results))) * 1400 / 1048576.0), flush=True)
    if fails[:8]:
        print('  fails:', fails[:8], flush=True)
    if probe:
        return
    out = {'symLen': symlen, 'unit': UNIT, 'items': results}
    with io.open(DST, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('wrote %s  %.2f MB' % (DST, os.path.getsize(DST) / 1048576.0), flush=True)


if __name__ == '__main__':
    main()
