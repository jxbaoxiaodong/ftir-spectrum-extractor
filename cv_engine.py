"""
FTIR Spectrum Image Extractor — CV Engine

Pure computer vision functions for extracting infrared spectrum curves from images.
Three extraction methods:
  - Auto: adaptive threshold + contour analysis (12 mode rotation)
  - Color: Bayesian color classification from user-selected seed regions
  - Trace: cubic interpolation through manually marked guide points
"""

import base64
import logging

import cv2
import numpy as np
from scipy import interpolate

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Image decoding
# ---------------------------------------------------------------------------

def decode_base64_image(data_uri):
    """Decode a base64 data-URI to a grayscale numpy array."""
    _, base64_data = data_uri.split(",", 1)
    image_bytes = base64.b64decode(base64_data)
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError("Image decode failed")
    if len(img.shape) == 3 and img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2GRAY)
    elif len(img.shape) == 3:
        img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return img


def decode_base64_image_color(data_uri):
    """Decode a base64 data-URI to a BGR numpy array."""
    _, base64_data = data_uri.split(",", 1)
    image_bytes = base64.b64decode(base64_data)
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Image decode failed")
    return img


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def resolve_crop_mode(img_shape, crop_coords):
    """Resolve crop coordinates against actual image dimensions."""
    img_h, img_w = img_shape[:2]
    x = int(crop_coords.get("x", 0))
    y = int(crop_coords.get("y", 0))
    w = int(crop_coords.get("width", crop_coords.get("w", img_w)))
    h = int(crop_coords.get("height", crop_coords.get("h", img_h)))

    if w == img_w and h == img_h:
        return {"crop_x": 0, "crop_y": 0, "crop_w": img_w, "crop_h": img_h,
                "offset_x": x, "offset_y": y}

    if x >= img_w or y >= img_h:
        return {"crop_x": 0, "crop_y": 0, "crop_w": img_w, "crop_h": img_h,
                "offset_x": x, "offset_y": y}

    crop_x = max(0, min(x, img_w - 1))
    crop_y = max(0, min(y, img_h - 1))
    crop_w = max(1, min(w, img_w - crop_x))
    crop_h = max(1, min(h, img_h - crop_y))
    return {"crop_x": crop_x, "crop_y": crop_y, "crop_w": crop_w, "crop_h": crop_h,
            "offset_x": crop_x, "offset_y": crop_y}


def normalize_background_roi(background_roi, region):
    """Normalize a background ROI relative to the crop region."""
    if not background_roi:
        return None
    ox, oy = region["offset_x"], region["offset_y"]
    w, h = region["crop_w"], region["crop_h"]
    bx = int(background_roi.get("x", ox)) - ox
    by = int(background_roi.get("y", oy)) - oy
    bw = int(background_roi.get("width", background_roi.get("w", 0)))
    bh = int(background_roi.get("height", background_roi.get("h", 0)))
    if bw <= 0 or bh <= 0:
        return None
    bx = max(0, min(bx, w - 1))
    by = max(0, min(by, h - 1))
    bw = max(1, min(bw, w - bx))
    bh = max(1, min(bh, h - by))
    return {"x": bx, "y": by, "w": bw, "h": bh}


# ---------------------------------------------------------------------------
# Connected-component filtering
# ---------------------------------------------------------------------------

def _component_score(stats_row, img_w):
    area = int(stats_row[cv2.CC_STAT_AREA])
    width = int(stats_row[cv2.CC_STAT_WIDTH])
    height = int(stats_row[cv2.CC_STAT_HEIGHT])
    span_ratio = width / max(1, img_w)
    return (area * 0.6) + (width * height * 0.25) + (span_ratio * 1000)


def isolate_primary_component(mask, min_area=30, min_span_ratio=0.08, prefer_points=None):
    """Keep the most curve-like connected component, drop sparse outliers."""
    if mask is None or mask.size == 0:
        return mask

    n, labels, stats, _ = cv2.connectedComponentsWithStats(
        (mask > 0).astype(np.uint8), connectivity=8
    )
    if n <= 1:
        return mask

    h, w = mask.shape[:2]
    candidates = []
    for idx in range(1, n):
        area = int(stats[idx, cv2.CC_STAT_AREA])
        width = int(stats[idx, cv2.CC_STAT_WIDTH])
        if area < min_area or width < max(2, int(w * min_span_ratio)):
            continue
        candidates.append(idx)

    if not candidates:
        return mask

    if prefer_points:
        preferred = []
        for idx in candidates:
            for px, py in prefer_points:
                if 0 <= px < w and 0 <= py < h and labels[py, px] == idx:
                    preferred.append(idx)
                    break
        if preferred:
            candidates = preferred

    best = max(candidates, key=lambda idx: _component_score(stats[idx], w))
    out = np.zeros_like(mask)
    out[labels == best] = 255
    return out


# ---------------------------------------------------------------------------
# Background suppression
# ---------------------------------------------------------------------------

def suppress_background_pixels(binary_mask, img_crop, bg_roi):
    """Suppress pixels similar to the user-selected background ROI."""
    if bg_roi is None:
        return binary_mask

    try:
        bx, by, bw, bh = bg_roi["x"], bg_roi["y"], bg_roi["w"], bg_roi["h"]
        patch = img_crop[by:by + bh, bx:bx + bw]
        if patch.size == 0:
            return binary_mask

        if len(img_crop.shape) == 2:
            mean = float(np.mean(patch))
            std = float(np.std(patch))
            lo = int(max(0, mean - 1.5 * std - 8))
            hi = int(min(255, mean + 1.5 * std + 8))
            bg_mask = cv2.inRange(img_crop, lo, hi)
        else:
            hsv = cv2.cvtColor(img_crop, cv2.COLOR_BGR2HSV)
            patch_hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
            mu = patch_hsv.reshape(-1, 3).mean(axis=0)
            sigma = patch_hsv.reshape(-1, 3).std(axis=0)
            h_tol = max(8, int(2.2 * sigma[0] + 6))
            s_tol = max(18, int(2.0 * sigma[1] + 10))
            v_tol = max(18, int(2.0 * sigma[2] + 10))
            lower = np.array([max(0, int(mu[0] - h_tol)), max(0, int(mu[1] - s_tol)),
                              max(0, int(mu[2] - v_tol))], dtype=np.uint8)
            upper = np.array([min(179, int(mu[0] + h_tol)), min(255, int(mu[1] + s_tol)),
                              min(255, int(mu[2] + v_tol))], dtype=np.uint8)
            bg_mask = cv2.inRange(hsv, lower, upper)

        keep = cv2.bitwise_not(bg_mask)
        return cv2.bitwise_and(binary_mask, keep)
    except Exception:
        return binary_mask


# ---------------------------------------------------------------------------
# Auto extraction (12-mode rotation)
# ---------------------------------------------------------------------------

def auto_extract_curve(img, crop_coords, threshold=200, background_roi=None,
                       invert_threshold=True, extraction_direction="average"):
    """
    Auto-extract a spectrum curve from a grayscale image.

    Supports multiple binarization directions and extraction strategies:
      - invert_threshold: True for white-bg/dark-line, False for dark-bg/light-line
      - extraction_direction: 'average', 'top_first', 'bottom_first'
    """
    region = resolve_crop_mode(img.shape, crop_coords or {})
    x, y, w, h = region["crop_x"], region["crop_y"], region["crop_w"], region["crop_h"]
    ox, oy = region["offset_x"], region["offset_y"]
    img_crop = img[y:y + h, x:x + w]
    if img_crop.size == 0:
        return []

    blurred = cv2.GaussianBlur(img_crop, (5, 5), 0)

    thresh_type = cv2.THRESH_BINARY_INV if invert_threshold else cv2.THRESH_BINARY
    binary = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_MEAN_C, thresh_type, 11, 2
    )

    if background_roi is not None:
        bg_roi = normalize_background_roi(background_roi, region)
        binary = suppress_background_pixels(binary, img_crop, bg_roi)

    extraction_direction = extraction_direction.lower()
    background_value = 255 if np.count_nonzero(binary == 255) >= (binary.size / 2.0) else 0

    def is_foreground(cy, cx):
        return int(binary[cy, cx]) != background_value

    if extraction_direction == "average":
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        y_dict = {}
        for contour in contours:
            for point in contour:
                cx, cy = point[0]
                if 0 <= cx < w and cy != 0 and cy != h - 1:
                    y_dict.setdefault(cx, []).append(cy)

        if not y_dict:
            return []

        points = []
        for cx in sorted(y_dict.keys()):
            avg_y = int(round(np.mean(y_dict[cx])))
            points.append({"x": int(cx + ox), "y": int(avg_y + oy)})

    elif extraction_direction == "top_first":
        points = []
        for cx in range(w):
            for cy in range(h):
                if is_foreground(cy, cx):
                    if cy + 1 < h and is_foreground(cy + 1, cx):
                        points.append({"x": int(cx + ox), "y": int(cy + oy)})
                        break
                    elif cy == h - 1:
                        points.append({"x": int(cx + ox), "y": int(cy + oy)})
                        break

    elif extraction_direction == "bottom_first":
        points = []
        for cx in range(w):
            for cy in range(h - 1, -1, -1):
                if is_foreground(cy, cx):
                    if cy - 1 >= 0 and is_foreground(cy - 1, cx):
                        points.append({"x": int(cx + ox), "y": int(cy + oy)})
                        break
                    elif cy == 0:
                        points.append({"x": int(cx + ox), "y": int(cy + oy)})
                        break
    else:
        return auto_extract_curve(img, crop_coords, threshold, background_roi,
                                  invert_threshold, "average")

    return points


# ---------------------------------------------------------------------------
# Color extraction (Bayesian classification)
# ---------------------------------------------------------------------------

def _safe_hist(pixels, bins=(32, 32)):
    """Compute a 2D (H,S) histogram for a set of HSV pixels."""
    if pixels is None or len(pixels) == 0:
        return np.zeros(bins, dtype=np.float32)
    buf = np.ascontiguousarray(pixels).reshape(-1, 1, 3).astype(np.uint8)
    return cv2.calcHist([buf], [0, 1], None, list(bins), [0, 180, 0, 256])


def extract_color_curve(img, seed_points, tolerance, crop_coords,
                        background_roi=None, background_rois=None,
                        seed_boxes=None, prob_threshold=None):
    """
    Color-based curve extraction using two-stage Bayesian classification.

    Uses background ROI pixels to build a background histogram, subtracts from
    seed-box pixels to get pure curve colors, then back-projects a posterior
    probability map to isolate the curve.
    """
    region = resolve_crop_mode(img.shape, crop_coords or {})
    x, y, w, h = region["crop_x"], region["crop_y"], region["crop_w"], region["crop_h"]
    ox, oy = region["offset_x"], region["offset_y"]
    img_crop = img[y:y + h, x:x + w]
    if img_crop.size == 0:
        return []

    hsv = cv2.cvtColor(img_crop, cv2.COLOR_BGR2HSV)

    # Collect background pixels
    bg_roi_list = []
    if background_roi:
        bg_roi_list.append(normalize_background_roi(background_roi, region))
    if background_rois:
        for r in background_rois:
            nroi = normalize_background_roi(r, region)
            if nroi:
                bg_roi_list.append(nroi)
    bg_pixels = np.zeros((0, 3), dtype=np.uint8)
    for br in bg_roi_list:
        bx, by_, bw, bh = br["x"], br["y"], br["w"], br["h"]
        patch = hsv[by_:by_ + bh, bx:bx + bw]
        if patch.size:
            bg_pixels = np.concatenate([bg_pixels, patch.reshape(-1, 3)])

    # Collect curve seed pixels
    curve_boxes = []
    if seed_boxes:
        for sb in seed_boxes:
            nx = int(sb.get("x", 0)) - ox
            ny = int(sb.get("y", 0)) - oy
            nw = int(sb.get("width", sb.get("w", 0)))
            nh = int(sb.get("height", sb.get("h", 0)))
            if nw <= 0 or nh <= 0:
                continue
            nx = max(0, min(nx, w - 1))
            ny = max(0, min(ny, h - 1))
            nw = max(1, min(nw, w - nx))
            nh = max(1, min(nh, h - ny))
            curve_boxes.append((nx, ny, nw, nh))
    elif seed_points:
        sxs = [int(p.get("x", 0)) - ox for p in seed_points]
        sys_ = [int(p.get("y", 0)) - oy for p in seed_points]
        if sxs and sys_:
            bx0, by0 = max(0, min(sxs)), max(0, min(sys_))
            bx1, by1 = min(w, max(sxs) + 1), min(h, max(sys_) + 1)
            curve_boxes.append((bx0, by0, max(1, bx1 - bx0), max(1, by1 - by0)))

    if not curve_boxes:
        return []

    curve_pixels = np.zeros((0, 3), dtype=np.uint8)
    for (bx, by_, bw, bh) in curve_boxes:
        patch = hsv[by_:by_ + bh, bx:bx + bw]
        if patch.size:
            curve_pixels = np.concatenate([curve_pixels, patch.reshape(-1, 3)])
    if len(curve_pixels) == 0:
        return []

    if prob_threshold is None:
        prob_threshold = max(0.25, 0.6 - float(tolerance) / 250.0)

    bins = (32, 32)

    # Background histogram + purify curve pixels
    if len(bg_pixels) > 0:
        hist_bg = _safe_hist(bg_pixels, bins)
        hist_bg = hist_bg / (float(len(bg_pixels)) + 1e-6)
        curve_buf = curve_pixels.reshape(-1, 1, 3).astype(np.uint8)
        bg_prob_in_curve = cv2.calcBackProject(
            [curve_buf], [0, 1], hist_bg, [0, 180, 0, 256], scale=1
        ).flatten()
        if len(bg_prob_in_curve) > 0:
            cut = max(0.3, float(np.median(bg_prob_in_curve)) * 0.5)
            keep = bg_prob_in_curve < cut
            pure_curve = curve_pixels[keep]
        else:
            pure_curve = curve_pixels
        if len(pure_curve) == 0:
            pure_curve = curve_pixels
    else:
        hist_bg = None
        pure_curve = curve_pixels

    # Curve histogram + posterior
    hist_curve = _safe_hist(pure_curve, bins)
    hist_curve = hist_curve / (float(len(pure_curve)) + 1e-6)
    if hist_bg is not None:
        ratio = (hist_curve + 1e-8) / (hist_bg + 1e-8)
        posterior = ratio / (ratio + 1.0)
    else:
        max_v = float(hist_curve.max())
        posterior = hist_curve / (max_v + 1e-8)
        posterior = np.clip(posterior, 0.0, 1.0)

    # Back-project posterior onto entire crop
    prob = cv2.calcBackProject(
        [hsv], [0, 1], posterior, [0, 180, 0, 256], scale=255
    ).astype(np.float32) / 255.0
    mask = (prob > prob_threshold).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

    # Keep largest component intersecting curve boxes
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n_labels > 1:
        inside_labels = set()
        for (bx, by_, bw, bh) in curve_boxes:
            step_y = max(1, bh // 20)
            step_x = max(1, bw // 20)
            for yy in range(by_, by_ + bh, step_y):
                for xx in range(bx, bx + bw, step_x):
                    if 0 <= yy < h and 0 <= xx < w:
                        lbl = labels[yy, xx]
                        if lbl > 0:
                            inside_labels.add(lbl)
        best_lbl, best_area = 0, 0
        for lbl in inside_labels:
            area = int(stats[lbl, cv2.CC_STAT_AREA])
            if area > best_area:
                best_area = area
                best_lbl = lbl
        if best_lbl > 0:
            cleaned = np.zeros_like(mask)
            cleaned[labels == best_lbl] = 255
            mask = cleaned

    # Per-column max-probability walk
    ys_best = np.argmax(prob, axis=0).astype(np.int32)
    p_best = prob.max(axis=0)
    valid = p_best > prob_threshold
    ys_smooth = ys_best.astype(np.float32)
    xs_valid = np.where(valid)[0]
    for i in xs_valid:
        lo = max(0, i - 4)
        hi = min(prob.shape[1], i + 5)
        win = valid[lo:hi]
        if win.any():
            ys_smooth[i] = float(np.median(ys_best[lo:hi][win]))
    ys_final = ys_smooth[xs_valid].astype(np.int32)
    xs_final = xs_valid.astype(np.int32)

    if len(xs_final) < 20 and int((mask > 0).sum()) > 100:
        ys_fallback, xs_fallback = np.where(mask > 0)
        ys_final, xs_final = ys_fallback, xs_fallback

    points = [{"x": int(xs_final[i] + ox), "y": int(ys_final[i] + oy)}
              for i in range(len(xs_final))]
    return points


# ---------------------------------------------------------------------------
# Manual trace (cubic interpolation through guide points)
# ---------------------------------------------------------------------------

def trace_curve_by_guide(img, guide_points, strategy="vertical", crop_coords=None):
    """
    Trace a curve through user-marked guide points using cubic interpolation.
    Returns ~200 interpolated points strictly passing through all guides.
    """
    guide_points_sorted = sorted(guide_points, key=lambda p: p.get("x", 0))
    gx = [int(p.get("x", 0)) for p in guide_points_sorted]
    gy = [int(p.get("y", 0)) for p in guide_points_sorted]
    if len(gx) < 2 or len(set(gx)) < 2:
        return []

    region = resolve_crop_mode(img.shape, crop_coords or {})
    x, y, w, h = region["crop_x"], region["crop_y"], region["crop_w"], region["crop_h"]
    ox, oy = region["offset_x"], region["offset_y"]

    x_min = max(ox, min(gx))
    x_max = min(ox + w, max(gx))
    if x_min >= x_max:
        return []

    sample_x = np.linspace(x_min, x_max, num=200)
    try:
        f = interpolate.interp1d(gx, gy, kind="cubic", fill_value="extrapolate")
    except Exception:
        f = interpolate.interp1d(gx, gy, kind="linear", fill_value="extrapolate")
    sample_y = f(sample_x).astype(int)

    points_dict = {}
    for sx, sy in zip(sample_x.astype(int), sample_y):
        points_dict[sx] = sy
    for gx_i, gy_i in zip(gx, gy):
        points_dict[gx_i] = gy_i

    final_points = [{"x": int(k), "y": int(v)} for k, v in sorted(points_dict.items())]
    return final_points


