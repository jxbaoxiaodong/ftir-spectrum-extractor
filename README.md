[中文](README.zh.md) | English | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md)

# FTIR Spectrum Image Extractor

Extract infrared spectrum curves from images and convert pixel coordinates to wavenumber-intensity CSV data. Designed for digitizing FTIR spectra from published papers, screenshots, or scanned figures.

## What it does

| Method | How it works |
|--------|-------------|
| **Auto Extract** | Adaptive threshold + contour analysis. 12 modes rotate through binarization directions and threshold levels — click multiple times and pick the best result. |
| **Color Extract** | Bayesian color classification. Select seed regions on the curve; the algorithm separates curve pixels from background by color distribution. |
| **Manual Trace** | Mark guide points along the curve; cubic interpolation generates ~200 points passing strictly through all guides. |

After extraction, pixel points are converted to spectral data using piecewise-linear wavenumber mapping with optional 2000 cm⁻¹ axis split for non-linear FTIR axes.

## Quick Start

```bash
pip install -r requirements.txt
python cv_service.py
# Server starts on http://localhost:5001
```

Docker:

```bash
docker build -t ftir-extractor .
docker run --rm -p 5001:5001 ftir-extractor
```

## API Endpoints

### `POST /analyze` — Auto Extract

```json
{
  "image": "data:image/jpeg;base64,...",
  "crop_coords": {"x": 0, "y": 0, "width": 900, "height": 400},
  "threshold": 200,
  "invert_threshold": true,
  "extraction_direction": "average",
  "use_grayscale": false,
  "background_roi": {"x": 10, "y": 10, "width": 50, "height": 50}
}
```

**Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `image` | string | — | Base64 data-URI of the spectrum image. |
| `crop_coords` | object | full image | Crop region `{x, y, width, height}`. |
| `threshold` | int | 200 | Binarization threshold (150/200/250). |
| `invert_threshold` | bool | true | `true` = white background / dark curve; `false` = dark background / light curve. |
| `extraction_direction` | string | "average" | `"average"`, `"top_first"`, or `"bottom_first"`. |
| `use_grayscale` | bool | false | Force grayscale processing. |
| `background_roi` | object | null | Background sample region for suppression. |

**Response**

```json
{
  "success": true,
  "auto_curves": [{"points": [{"x": 10, "y": 150}, ...]}],
  "count": 850
}
```

### `POST /extract-color` — Color Extract

```json
{
  "image": "data:image/jpeg;base64,...",
  "crop_coords": {"x": 0, "y": 0, "width": 900, "height": 400},
  "seed_boxes": [{"x": 100, "y": 200, "width": 60, "height": 30}],
  "tolerance": 30,
  "background_rois": [{"x": 10, "y": 10, "width": 80, "height": 80}]
}
```

**Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `seed_boxes` | array | — | Rectangles on the curve for color sampling. |
| `seed_points` | array | — | Legacy: individual points on the curve. |
| `tolerance` | int | 30 | Color tolerance (5–100). Higher = more permissive. |
| `background_rois` | array | [] | Background regions to subtract. |

### `POST /trace` — Manual Trace

```json
{
  "image": "data:image/jpeg;base64,...",
  "crop_coords": {"x": 0, "y": 0, "width": 900, "height": 400},
  "guide_points": [{"x": 50, "y": 300}, {"x": 200, "y": 150}, {"x": 400, "y": 280}],
  "strategy": "vertical"
}
```

**Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `guide_points` | array | — | At least 2 points along the curve. More points = higher accuracy. |
| `strategy` | string | "vertical" | Interpolation strategy. |

### `GET /health`

```json
{"status": "ok", "service": "ftir-spectrum-extractor"}
```

## Pixel → Wavenumber Conversion

After extracting pixel points, use `spectral_convert.py` to map them to wavenumber-intensity pairs:

```python
from spectral_convert import convert_pixels_to_spectral

points = [{"x": 50, "y": 300}, {"x": 100, "y": 250}, ...]

spectrum_params = {
    "start_wavenum": 4000,
    "end_wavenum": 400,
    "data_type": "absorbance",       # or "transmittance"
    "split_pixel_x": None,           # set for non-linear axes
    "split_wavenum": 2000,
    "use_manual_axis_calibration": False,
    "axis_left_pixel_x": None,
    "axis_right_pixel_x": None,
}

crop_coords = {"x": 0, "y": 0, "width": 900, "height": 400}

spectral_data = convert_pixels_to_spectral(points, crop_coords, spectrum_params)
# → [{"wavenumber": 3998.5, "value": 0.8234}, ...]
```

The conversion handles:
- Linear and piecewise-linear (split at 2000 cm⁻¹) wavenumber mapping
- Automatic or manual axis calibration
- Y-axis normalization to absorbance (0–1) or transmittance (0–100%)
- Point deduplication by wavenumber averaging

## 12-Mode Auto Extraction

The auto extractor rotates through 12 modes (4 algorithms × 3 thresholds):

| Modes | Threshold | Binarization | Direction |
|-------|-----------|--------------|-----------|
| 1–4 | 200 | INV / Normal / INV / Normal | average / average / top / bottom |
| 5–8 | 150 | INV / Normal / INV / Normal | average / average / top / bottom |
| 9–12 | 250 | INV / Normal / INV / Normal | average / average / top / bottom |

Click "Retry Auto" multiple times — each click uses the next mode. Pick the result with the cleanest curve.

## Project Structure

```
ftir-spectrum-extractor/
├── cv_service.py          # Flask CV server (auto/color/trace extraction)
├── spectral_convert.py    # Pixel → wavenumber conversion
├── requirements.txt
├── Dockerfile
└── LICENSE
```

## About FTIR.fun

This tool is the open-source extraction engine behind **[FTIR.fun](https://ftir.fun)** — a cloud platform for infrared spectroscopy analysis with 130,000+ FTIR reference spectra.

On [ftir.fun](https://ftir.fun) you can:
- Upload the extracted CSV and search it against the spectral library for material identification
- Get AI-powered peak explanations backed by a chemical knowledge graph
- Run full tri-axis reports with shareable result URLs
- Access 28+ instrument file format parsing (Thermo .spa, Bruker .opus, JCAMP-DX, etc.)

**Try it online:** https://ftir.fun/spectrum/upload-image/

## License

MIT
