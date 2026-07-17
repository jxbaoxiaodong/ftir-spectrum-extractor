[中文](README.zh.md) | [English](README.md) | [Español](README.es.md) | Français | [日本語](README.ja.md)

# FTIR Spectrum Image Extractor

**Extrait des courbes de spectres infrarouges à partir d'images et les convertit en données CSV nombre d'onde / intensité.**

Conçu spécifiquement pour la numérisation de spectres **FTIR (Spectroscopie Infrarouge à Transformée de Fourier, Fourier Transform Infrared Spectroscopy)** — extrait les données nombre d'onde (cm⁻¹) vs. absorbance/transmittance depuis des articles publiés, captures d'écran ou figures scannées. Fournit une interface web interactive complète : téléversez une image, recadrez la région spectrale, définissez les paramètres d'axes IR et exportez un CSV propre.

> **Pour d'autres techniques de spectroscopie / chromatographie :**
> Ce projet est conçu spécifiquement pour les spectres infrarouges (IR / FT-IR / Mid-IR / NIR / Far-IR / ATR-FTIR). Si vous travaillez avec la **spectroscopie Raman**, **UV-Vis**, **GC**, **HPLC**, **GC-MS**, **LC-MS**, **XRD**, **RMN**, **spectroscopie de fluorescence**, **ATG**, **DSC** ou d'autres courbes analytiques, vous pouvez forker ce projet et modifier le mappage d'axes (X : longueur d'onde, temps de rétention, 2θ, déplacement chimique, température, m/z ; Y : intensité, réponse, perte de masse%) selon votre instrument. Les algorithmes d'extraction d'image (seuil adaptatif, classification bayésienne de couleur, interpolation cubique) sont indépendants de la technique.

## Fonctionnalités

| Méthode | Fonctionnement |
|---------|----------------|
| **Extraction auto** | Seuil adaptatif + analyse de contours. 12 modes alternent directions de binarisation et niveaux de seuil — cliquez plusieurs fois et choisissez le meilleur résultat. |
| **Extraction couleur** | Classification bayésienne de couleur. Sélectionnez des régions sur la courbe ; l'algorithme sépare la courbe du fond par distribution colorimétrique. |
| **Tracé manuel** | Marquez des points guides le long de la courbe ; l'interpolation cubique génère ~200 points passant strictement par tous les guides. |

## Démarrage rapide

```bash
pip install -r requirements.txt
python app.py
# Ouvrez http://localhost:5001 dans votre navigateur
```

Docker :

```bash
docker build -t ftir-extractor .
docker run --rm -p 5001:5001 ftir-extractor
```

## Flux de travail (Interface Web Interactive)

1. **Téléverser** — Téléversez une image du spectre (JPG/PNG, redimensionnée à 900px)
2. **Recadrer et Paramètres** — Ajustez le cadre à la région spectrale ; définissez les nombres d'onde, le type de données et la division optionnelle à 2000 cm⁻¹
3. **Suppression du fond** — Sélectionnez des régions de fond pour supprimer les lignes de grille et le bruit
4. **Extraire** — Choisissez auto / couleur / tracé manuel ; prévisualisez la courbe ; ajustez avec la gomme et le décalage ; téléchargez le CSV

## Portée et techniques associées

Cet outil **supporte directement** l'extraction de courbes de spectroscopie infrarouge :

- FTIR, FT-IR, ATR-FTIR, DRIFTS, IR par transmission, IR par réflexion
- Mid-IR (4000–400 cm⁻¹), NIR (Proche Infrarouge), Far-IR
- Absorbance, transmittance, Kubelka-Munk
- Axe en nombre d'onde (cm⁻¹) avec division non linéaire optionnelle à 2000 cm⁻¹

**Peut être adapté** (fork et modification des paramètres d'axes) pour :

- Spectroscopie Raman (déplacement Raman cm⁻¹, SERS, Raman résonant)
- Spectroscopie UV-Vis (longueur d'onde nm, densité optique)
- Chromatographie (GC, HPLC, UHPLC, GC-MS, LC-MS, temps de rétention)
- Analyse thermique (ATG, DSC, ATD, température °C, perte de masse)
- XRD (2θ), XRF, SAXS
- RMN (¹H, ¹³C, déplacement chimique ppm)
- Spectrométrie de masse (m/z)
- Fluorescence, photoluminescence, spectroscopie d'émission
- Électrochimie (voltamétrie cyclique, spectroscopie d'impédance)

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
