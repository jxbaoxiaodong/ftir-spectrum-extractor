[中文](README.zh.md) | [English](README.md) | [Español](README.es.md) | Français | [日本語](README.ja.md)

# FTIR Spectrum Image Extractor

Extrait des courbes de spectres infrarouges à partir d'images et convertit les coordonnées en pixels en données CSV nombre d'onde / intensité. Conçu pour numériser des spectres FTIR depuis des articles publiés, captures d'écran ou figures scannées.

## Fonctionnalités

| Méthode | Fonctionnement |
|---------|----------------|
| **Extraction auto** | Seuil adaptatif + analyse de contours. 12 modes alternent directions de binarisation et niveaux de seuil — cliquez plusieurs fois et choisissez le meilleur résultat. |
| **Extraction couleur** | Classification bayésienne de couleur. Sélectionnez des régions sur la courbe ; l'algorithme sépare la courbe du fond par distribution colorimétrique. |
| **Tracé manuel** | Marquez des points guides le long de la courbe ; l'interpolation cubique génère ~200 points passant strictement par tous les guides. |

## Démarrage rapide

```bash
pip install -r requirements.txt
python cv_service.py
# Serveur sur http://localhost:5001
```

Docker :

```bash
docker build -t ftir-extractor .
docker run --rm -p 5001:5001 ftir-extractor
```

## Points de terminaison API

### `POST /analyze` — Extraction auto

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `image` | string | — | Data-URI base64 de l'image du spectre. |
| `crop_coords` | object | image entière | Région de recadrage `{x, y, width, height}`. |
| `threshold` | int | 200 | Seuil de binarisation (150/200/250). |
| `invert_threshold` | bool | true | `true` = fond blanc / courbe sombre. |
| `extraction_direction` | string | "average" | `"average"`, `"top_first"` ou `"bottom_first"`. |
| `background_roi` | object | null | Région d'échantillonnage du fond. |

### `POST /extract-color` — Extraction couleur

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `seed_boxes` | array | — | Rectangles sur la courbe pour l'échantillonnage couleur. |
| `tolerance` | int | 30 | Tolérance couleur (5–100). |
| `background_rois` | array | [] | Régions de fond à soustraire. |

### `POST /trace` — Tracé manuel

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `guide_points` | array | — | Au moins 2 points sur la courbe. |
| `strategy` | string | "vertical" | Stratégie d'interpolation. |

### `GET /health`

```json
{"status": "ok", "service": "ftir-spectrum-extractor"}
```

## Conversion Pixel → Nombre d'onde

```python
from spectral_convert import convert_pixels_to_spectral

spectral_data = convert_pixels_to_spectral(points, crop_coords, spectrum_params)
# → [{"wavenumber": 3998.5, "value": 0.8234}, ...]
```

Supporte le mappage linéaire et linéaire par segments (division à 2000 cm⁻¹), calibration manuelle des axes et normalisation Y pour l'absorbance (0–1) ou la transmittance (0–100%).

## À propos de FTIR.fun

Cet outil est le moteur d'extraction open-source derrière **[FTIR.fun](https://ftir.fun)** — une plateforme cloud d'analyse par spectrométrie infrarouge avec plus de 130 000 spectres FTIR de référence.

Sur [ftir.fun](https://ftir.fun) vous pouvez :
- Téléverser le CSV extrait et rechercher des matériaux correspondants dans la bibliothèque spectrale
- Obtenir des explications de pics par IA appuyées sur un graphe de connaissances chimiques
- Générer des rapports tri-axiaux partageables
- Parser 28+ formats de fichiers d'instruments

**Essayez en ligne :** https://ftir.fun/spectrum/upload-image/

## Licence

MIT
