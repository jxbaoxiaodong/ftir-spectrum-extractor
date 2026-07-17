[中文](README.zh.md) | [English](README.md) | Español | [Français](README.fr.md) | [日本語](README.ja.md)

# FTIR Spectrum Image Extractor

**Extrae curvas de espectros infrarrojos de imágenes y convierte a datos CSV de número de onda e intensidad.**

Diseñado específicamente para la digitalización de espectros **FTIR (Espectroscopía Infrarroja por Transformada de Fourier, Fourier Transform Infrared Spectroscopy)** — extrae datos de número de onda (cm⁻¹) vs. absorbancia/transmitancia de artículos publicados, capturas de pantalla o figuras escaneadas. Proporciona una interfaz web interactiva completa: sube una imagen, recorta la región espectral, configura parámetros de ejes IR y exporta CSV limpio listo para búsqueda en bibliotecas espectrales.

> **Para otras técnicas de espectroscopía / cromatografía:**
> Este proyecto está diseñado específicamente para espectros infrarrojos (IR / FT-IR / Mid-IR / NIR / Far-IR / ATR-FTIR). Si trabajas con **espectroscopía Raman**, **UV-Vis**, **GC**, **HPLC**, **GC-MS**, **LC-MS**, **XRD**, **RMN**, **espectroscopía de fluorescencia**, **TGA**, **DSC** u otras curvas analíticas, puedes hacer un fork de este proyecto y modificar el mapeo de ejes (X: longitud de onda, tiempo de retención, 2θ, desplazamiento químico, temperatura, m/z; Y: intensidad, respuesta, pérdida de peso%) según tu instrumento. Los algoritmos centrales de extracción de imagen (umbral adaptativo, clasificación bayesiana de color, interpolación cúbica) son independientes de la técnica.

## Funcionalidades

| Método | Cómo funciona |
|--------|---------------|
| **Extracción automática** | Umbral adaptativo + análisis de contornos. 12 modos rotan entre direcciones de binarización y niveles de umbral — haz clic varias veces y elige el mejor resultado. |
| **Extracción por color** | Clasificación bayesiana de color. Selecciona regiones semilla sobre la curva; el algoritmo separa los píxeles de la curva del fondo por distribución de color. |
| **Trazado manual** | Marca puntos guía a lo largo de la curva; la interpolación cúbica genera ~200 puntos que pasan estrictamente por todos los guías. |

## Inicio rápido

```bash
pip install -r requirements.txt
python app.py
# Abre http://localhost:5001 en tu navegador
```

Docker:

```bash
docker build -t ftir-extractor .
docker run --rm -p 5001:5001 ftir-extractor
```

## Flujo de trabajo (Interfaz Web Interactiva)

1. **Subir** — Sube una imagen del espectro (JPG/PNG, escalada a 900px)
2. **Recortar y Parámetros** — Ajusta el recorte a la región espectral; configura números de onda, tipo de datos y división opcional en 2000 cm⁻¹
3. **Eliminación de fondo** — Selecciona regiones de fondo para suprimir líneas de cuadrícula y ruido
4. **Extraer** — Elige auto / color / trazado manual; previsualiza la curva; ajusta con borrador y offset; descarga CSV

## Alcance y técnicas relacionadas

Esta herramienta **soporta directamente** la extracción de curvas de espectroscopía infrarroja:

- FTIR, FT-IR, ATR-FTIR, DRIFTS, IR por transmisión, IR por reflexión
- Mid-IR (4000–400 cm⁻¹), NIR (Infrarrojo Cercano), Far-IR
- Absorbancia, transmitancia, Kubelka-Munk
- Eje de número de onda (cm⁻¹) con división no lineal opcional en 2000 cm⁻¹

**Se puede adaptar** (fork y modificar parámetros de ejes) para:

- Espectroscopía Raman (desplazamiento Raman cm⁻¹, SERS, Raman resonante)
- Espectroscopía UV-Vis (longitud de onda nm, densidad óptica)
- Cromatografía (GC, HPLC, UHPLC, GC-MS, LC-MS, tiempo de retención)
- Análisis térmico (TGA, DSC, DTA, temperatura °C, pérdida de peso)
- XRD (2θ), XRF, SAXS
- RMN (¹H, ¹³C, desplazamiento químico ppm)
- Espectrometría de masas (m/z)
- Fluorescencia, fotoluminiscencia, espectroscopía de emisión
- Electroquímica (voltametría cíclica, espectroscopía de impedancia)

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
