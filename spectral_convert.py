"""
Pixel-to-spectral coordinate conversion.

Converts extracted pixel points (x, y) into spectral data (wavenumber, intensity)
using linear or piecewise-linear mapping with optional 2000 cm⁻¹ axis split.
"""

from statistics import median


def thin_points_by_x(points):
    """Aggregate points by integer X, keeping the median Y per column."""
    if not points:
        return []

    grouped = {}
    for p in points:
        x = int(round(float(p.get("x", 0))))
        y = float(p.get("y", 0))
        grouped.setdefault(x, []).append(y)

    thinned = []
    for x in sorted(grouped.keys()):
        ys = grouped[x]
        thinned.append({"x": float(x), "y": float(round(median(ys)))})

    return thinned


def pixel_x_to_wavenumber(x, x_min, x_max, start_w, end_w,
                          split_pixel_x=None, split_w=2000.0):
    """
    Map a pixel X coordinate to a wavenumber using piecewise linear interpolation.

    For spectra with non-linear axes (common in FTIR where the 4000-2000 region
    is compressed), a split point divides the mapping into two linear segments.

    Args:
        x: Pixel X coordinate to convert.
        x_min: Left boundary pixel X (maps to start_w).
        x_max: Right boundary pixel X (maps to end_w).
        start_w: Wavenumber at the left edge (typically 4000 cm⁻¹).
        end_w: Wavenumber at the right edge (typically 400 cm⁻¹).
        split_pixel_x: Optional pixel X where the axis changes scale.
        split_w: Wavenumber at the split point (default 2000 cm⁻¹).

    Returns:
        Wavenumber in cm⁻¹.
    """
    total = x_max - x_min
    if total <= 0:
        return start_w

    if split_pixel_x is None:
        ratio = (x - x_min) / total
        if start_w > end_w:
            return start_w - ratio * (start_w - end_w)
        else:
            return start_w + ratio * (end_w - start_w)

    split_x = min(max(split_pixel_x, x_min), x_max)

    if x <= split_x:
        left_len = split_x - x_min
        if left_len <= 0:
            return split_w
        ratio = (x - x_min) / left_len
        if start_w > split_w:
            return start_w - ratio * (start_w - split_w)
        else:
            return start_w + ratio * (split_w - start_w)
    else:
        right_len = x_max - split_x
        if right_len <= 0:
            return split_w
        ratio = (x - split_x) / right_len
        if split_w > end_w:
            return split_w - ratio * (split_w - end_w)
        else:
            return split_w + ratio * (end_w - split_w)


def convert_pixels_to_spectral(points, crop_coords, spectrum_params):
    """
    Convert pixel coordinate points to spectral data (wavenumber + normalized value).

    Args:
        points: List of {"x": float, "y": float} pixel coordinates.
        crop_coords: Crop region dict with x, y, width, height.
        spectrum_params: Dict with keys:
            - start_wavenum: Left wavenumber (default 4000)
            - end_wavenum: Right wavenumber (default 400)
            - data_type: 'absorbance' (0-1) or 'transmittance' (0-100%)
            - split_pixel_x: Optional axis split pixel X
            - split_wavenum: Wavenumber at split (default 2000)
            - axis_left_pixel_x: Optional manual left calibration pixel
            - axis_right_pixel_x: Optional manual right calibration pixel
            - use_manual_axis_calibration: Boolean

    Returns:
        List of {"wavenumber": float, "value": float} sorted high→low wavenumber.
    """
    if not points:
        return []

    points = thin_points_by_x(points)

    xs = [p["x"] for p in points]
    ys = [p["y"] for p in points]
    axis_x_min = float(min(xs))
    axis_x_max = float(max(xs))
    axis_y_min = float(min(ys))
    axis_y_max = float(max(ys))

    start_w = float(spectrum_params.get("start_wavenum", 4000))
    end_w = float(spectrum_params.get("end_wavenum", 400))
    split_pixel_x = spectrum_params.get("split_pixel_x", None)
    split_wavenum = spectrum_params.get("split_wavenum", 2000.0)
    axis_left_pixel_x = spectrum_params.get("axis_left_pixel_x", None)
    axis_right_pixel_x = spectrum_params.get("axis_right_pixel_x", None)
    use_manual = _coerce_bool(spectrum_params.get("use_manual_axis_calibration"))
    data_type = spectrum_params.get("data_type", "absorbance")

    if split_pixel_x is not None:
        split_pixel_x = float(split_pixel_x)
    if split_wavenum is not None:
        split_wavenum = float(split_wavenum)
    if axis_left_pixel_x is not None:
        axis_left_pixel_x = float(axis_left_pixel_x)
    if axis_right_pixel_x is not None:
        axis_right_pixel_x = float(axis_right_pixel_x)

    if (use_manual and axis_left_pixel_x is not None
            and axis_right_pixel_x is not None
            and axis_right_pixel_x > axis_left_pixel_x):
        axis_x_min = axis_left_pixel_x
        axis_x_max = axis_right_pixel_x

    spectral = []
    for p in points:
        x = float(p["x"])
        y = float(p["y"])
        wavenum = pixel_x_to_wavenumber(
            x, axis_x_min, axis_x_max, start_w, end_w,
            split_pixel_x=split_pixel_x,
            split_w=split_wavenum if split_wavenum is not None else 2000.0,
        )
        spectral.append({"wavenumber": wavenum, "value": y})

    # Y-axis normalization
    if data_type in ("transmittance", "transmission"):
        y_max_val, y_min_val = 100.0, 0.0
    else:
        y_max_val, y_min_val = 1.0, 0.0

    y_range = axis_y_max - axis_y_min if axis_y_max > axis_y_min else 1.0

    for row in spectral:
        y_ratio = (axis_y_max - row["value"]) / y_range
        row["value"] = round(y_min_val + y_ratio * (y_max_val - y_min_val), 4)
        row["wavenumber"] = round(row["wavenumber"], 4)

    # Deduplicate by wavenumber (average values at same wavenumber)
    uniq = {}
    for row in spectral:
        uniq.setdefault(row["wavenumber"], []).append(row["value"])

    deduped = []
    for w in sorted(uniq.keys(), reverse=True):
        vals = uniq[w]
        deduped.append({"wavenumber": w, "value": round(sum(vals) / len(vals), 4)})

    return deduped


def _coerce_bool(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in {"1", "true", "yes", "on"}
