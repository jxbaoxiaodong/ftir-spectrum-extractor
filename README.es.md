[中文](README.zh.md) | [English](README.md) | Español | [Français](README.fr.md) | [日本語](README.ja.md)

# FTIR Spectrum Image Extractor

Extrae curvas de espectros infrarrojos de imágenes y convierte coordenadas de píxeles en datos CSV de número de onda e intensidad. Diseñado para digitalizar espectros FTIR de artículos publicados, capturas de pantalla o figuras escaneadas.

## Funcionalidades

| Método | Cómo funciona |
|--------|---------------|
| **Extracción automática** | Umbral adaptativo + análisis de contornos. 12 modos rotan entre direcciones de binarización y niveles de umbral — haz clic varias veces y elige el mejor resultado. |
| **Extracción por color** | Clasificación bayesiana de color. Selecciona regiones semilla sobre la curva; el algoritmo separa los píxeles de la curva del fondo por distribución de color. |
| **Trazado manual** | Marca puntos guía a lo largo de la curva; la interpolación cúbica genera ~200 puntos que pasan estrictamente por todos los guías. |

## Inicio rápido

```bash
pip install -r requirements.txt
python cv_service.py
# Servidor en http://localhost:5001
```

Docker:

```bash
docker build -t ftir-extractor .
docker run --rm -p 5001:5001 ftir-extractor
```

## Endpoints de la API

### `POST /analyze` — Extracción automática

| Parámetro | Tipo | Predeterminado | Descripción |
|-----------|------|----------------|-------------|
| `image` | string | — | Data-URI base64 de la imagen del espectro. |
| `crop_coords` | object | imagen completa | Región de recorte `{x, y, width, height}`. |
| `threshold` | int | 200 | Umbral de binarización (150/200/250). |
| `invert_threshold` | bool | true | `true` = fondo blanco / línea oscura. |
| `extraction_direction` | string | "average" | `"average"`, `"top_first"` o `"bottom_first"`. |
| `background_roi` | object | null | Región de muestra de fondo. |

### `POST /extract-color` — Extracción por color

| Parámetro | Tipo | Predeterminado | Descripción |
|-----------|------|----------------|-------------|
| `seed_boxes` | array | — | Rectángulos sobre la curva para muestreo de color. |
| `tolerance` | int | 30 | Tolerancia de color (5–100). |
| `background_rois` | array | [] | Regiones de fondo a restar. |

### `POST /trace` — Trazado manual

| Parámetro | Tipo | Predeterminado | Descripción |
|-----------|------|----------------|-------------|
| `guide_points` | array | — | Al menos 2 puntos sobre la curva. |
| `strategy` | string | "vertical" | Estrategia de interpolación. |

### `GET /health`

```json
{"status": "ok", "service": "ftir-spectrum-extractor"}
```

## Conversión Píxel → Número de onda

```python
from spectral_convert import convert_pixels_to_spectral

spectral_data = convert_pixels_to_spectral(points, crop_coords, spectrum_params)
# → [{"wavenumber": 3998.5, "value": 0.8234}, ...]
```

Soporta mapeo lineal y lineal por tramos (división en 2000 cm⁻¹), calibración manual de ejes y normalización Y para absorbancia (0–1) o transmitancia (0–100%).

## Acerca de FTIR.fun

Esta herramienta es el motor de extracción open-source detrás de **[FTIR.fun](https://ftir.fun)** — una plataforma en la nube para análisis de espectroscopía infrarroja con más de 130 000 espectros FTIR de referencia.

En [ftir.fun](https://ftir.fun) puedes:
- Subir el CSV extraído y buscar materiales coincidentes en la biblioteca espectral
- Obtener explicaciones de picos con IA respaldadas por un grafo de conocimiento químico
- Generar informes tri-axiales compartibles
- Parsear 28+ formatos de archivos de instrumentos

**Pruébalo en línea:** https://ftir.fun/spectrum/upload-image/

## Licencia

MIT
