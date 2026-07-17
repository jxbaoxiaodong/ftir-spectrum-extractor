[中文](README.zh.md) | English | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md)

# FTIR Spectrum Image Extractor

**Extract infrared spectrum curves from images and convert to wavenumber–intensity CSV data.**

Built specifically for **FTIR (Fourier Transform Infrared Spectroscopy)** spectrum digitization — extract wavenumber (cm⁻¹) vs. absorbance/transmittance data from published papers, screenshots, or scanned figures. The tool provides a complete interactive web interface: upload an image, crop the spectral region, set IR axis parameters, and export clean CSV ready for library search or further analysis.

> **For other spectroscopy / chromatography techniques:**
> This project is purpose-built for infrared spectra (IR / FT-IR / Mid-IR / NIR / Far-IR / ATR-FTIR). If you work with **Raman spectroscopy**, **UV-Vis (Ultraviolet-Visible)**, **GC (Gas Chromatography)**, **HPLC**, **GC-MS**, **LC-MS**, **XRD (X-Ray Diffraction)**, **NMR**, **fluorescence spectroscopy**, **TGA**, **DSC**, or other analytical curves, you can fork this project and modify the axis mapping (X: wavelength, retention time, 2θ, chemical shift, temperature, m/z; Y: intensity, response, weight%) to suit your instrument. The core image extraction algorithms (auto threshold, Bayesian color classification, cubic interpolation) are technique-agnostic.

## Features

| Method | How it works |
|--------|-------------|
| **Auto Extract** | Adaptive threshold + contour analysis. 12 modes rotate through binarization directions and threshold levels — click multiple times and pick the best result. |
| **Color Extract** | Bayesian color classification. Select seed regions on the curve; the algorithm separates curve pixels from background by color distribution. |
| **Manual Trace** | Mark guide points along the curve; cubic interpolation generates ~200 points passing strictly through all guides. |

After extraction, pixel points are converted to spectral data using piecewise-linear wavenumber mapping with optional 2000 cm⁻¹ axis split for non-linear FTIR axes.

## Quick Start

```bash
pip install -r requirements.txt
python app.py
# Open http://localhost:5001 in your browser
```

Docker:

```bash
docker build -t ftir-extractor .
docker run --rm -p 5001:5001 ftir-extractor
```

## How It Works (Interactive Web UI)

1. **Upload** — Upload a spectrum image (JPG/PNG, auto-scaled to 900px width)
2. **Crop & Parameters** — Drag the crop box to frame the spectral region; set start/end wavenumber, data type, and optional 2000 cm⁻¹ axis split
3. **Background Removal** — Select background regions to suppress grid lines and noise
4. **Extract** — Choose auto / color / manual trace; preview the extracted curve; adjust with eraser and wavenumber offset; download CSV

## API Endpoints

### `POST /spectrum/upload-image/` — Upload image

Multipart form with `image` field. Returns base64 data-URI of processed image.

### `POST /spectrum/crop/` — Save crop & parameters

```json
{
  "image_data": "data:image/jpeg;base64,...",
  "crop_coords": {"x": 50, "y": 30, "width": 800, "height": 350},
  "start_wavenum": 4000,
  "end_wavenum": 400,
  "data_type": "absorbance",
  "split_wavenum": 2000,
  "split_pixel_x": 450
}
```

### `POST /spectrum/auto-extract/` — Auto extraction

Automatically cycles through 12 modes (4 algorithms × 3 thresholds). Each call uses the next mode.

### `POST /spectrum/extract-color/` — Color extraction

```json
{
  "seed_boxes": [{"x": 100, "y": 200, "width": 60, "height": 30}],
  "tolerance": 30,
  "background_rois": [{"x": 10, "y": 10, "width": 80, "height": 80}]
}
```

### `POST /spectrum/trace/` — Manual trace

```json
{
  "guide_points": [{"x": 50, "y": 300}, {"x": 200, "y": 150}, {"x": 400, "y": 280}],
  "strategy": "vertical"
}
```

All extraction endpoints return:
```json
{
  "success": true,
  "points": [{"x": 10, "y": 150}, ...],
  "spectral_data": [{"wavenumber": 3998.5, "value": 0.82}, ...],
  "count": 850
}
```

## Pixel → Wavenumber Conversion

```python
from spectral_convert import convert_pixels_to_spectral

spectral_data = convert_pixels_to_spectral(points, crop_coords, spectrum_params)
# → [{"wavenumber": 3998.5, "value": 0.8234}, ...]
```

Supports:
- Linear and piecewise-linear (split at 2000 cm⁻¹) wavenumber mapping
- Automatic or manual axis calibration
- Y-axis normalization to absorbance (0–1) or transmittance (0–100%)
- Point deduplication by wavenumber averaging

## 12-Mode Auto Extraction

| Modes | Threshold | Binarization | Direction |
|-------|-----------|--------------|-----------|
| 1–4 | 200 | INV / Normal / INV / Normal | average / average / top / bottom |
| 5–8 | 150 | INV / Normal / INV / Normal | average / average / top / bottom |
| 9–12 | 250 | INV / Normal / INV / Normal | average / average / top / bottom |

Click "Retry Auto" multiple times — each click uses the next mode. Pick the result with the cleanest curve.

## Project Structure

```
ftir-spectrum-extractor/
├── app.py                 # Flask full-stack application (UI + API)
├── cv_engine.py           # Computer vision extraction algorithms
├── spectral_convert.py    # Pixel → wavenumber conversion
├── templates/
│   └── index.html         # Interactive extraction UI
├── static/
│   ├── js/app.js          # Frontend logic
│   └── css/style.css      # Styling
├── requirements.txt
├── Dockerfile
└── LICENSE
```

## Scope & Related Techniques

This tool **directly supports** infrared spectroscopy curve extraction:

- FTIR, FT-IR, ATR-FTIR, DRIFTS, transmission IR, reflection IR
- Mid-IR (4000–400 cm⁻¹), Near-Infrared (NIR), Far-IR
- Absorbance, transmittance, Kubelka-Munk
- Wavenumber (cm⁻¹) axis with optional non-linear split at 2000 cm⁻¹

**Can be adapted** (fork & modify axis parameters) for:

- Raman spectroscopy (Raman shift cm⁻¹, SERS, resonance Raman)
- UV-Vis spectroscopy (wavelength nm, optical density)
- Chromatography (GC, HPLC, UHPLC, GC-MS, LC-MS, retention time)
- Thermal analysis (TGA, DSC, DTA, temperature °C, weight loss)
- XRD (2θ), XRF, SAXS
- NMR (¹H, ¹³C, chemical shift ppm)
- Mass spectrometry (m/z)
- Fluorescence, photoluminescence, emission spectroscopy
- Electrochemistry (cyclic voltammetry, impedance)

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
