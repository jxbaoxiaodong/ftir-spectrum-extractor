[中文](README.zh.md) | [English](README.md) | [Español](README.es.md) | [Français](README.fr.md) | 日本語

# FTIR スペクトル画像抽出ツール

画像から赤外スペクトル曲線を抽出し、ピクセル座標を波数-強度 CSV データに変換します。論文・スクリーンショット・スキャン図版から FTIR スペクトルをデジタル化するために設計されています。

## 機能一覧

| 方法 | 仕組み |
|------|--------|
| **自動抽出** | 適応的閾値 + 輪郭解析。12 モードが二値化方向と閾値レベルを切り替え — 複数回クリックして最良の結果を選択。 |
| **カラー抽出** | ベイズ色分類。曲線上のシード領域を選択；アルゴリズムが色分布から曲線ピクセルと背景を分離。 |
| **手動トレース** | 曲線に沿ってガイドポイントを配置；3 次スプライン補間で全ガイドを厳密に通る約 200 点を生成。 |

## クイックスタート

```bash
pip install -r requirements.txt
python cv_service.py
# サーバーが http://localhost:5001 で起動
```

Docker：

```bash
docker build -t ftir-extractor .
docker run --rm -p 5001:5001 ftir-extractor
```

## API エンドポイント

### `POST /analyze` — 自動抽出

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|-----------|------|
| `image` | string | — | スペクトル画像の base64 data-URI。 |
| `crop_coords` | object | 全画像 | クロップ領域 `{x, y, width, height}`。 |
| `threshold` | int | 200 | 二値化閾値（150/200/250）。 |
| `invert_threshold` | bool | true | `true` = 白背景/暗い曲線；`false` = 暗背景/明るい曲線。 |
| `extraction_direction` | string | "average" | `"average"`、`"top_first"`、`"bottom_first"`。 |
| `background_roi` | object | null | 背景サンプリング領域。 |

### `POST /extract-color` — カラー抽出

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|-----------|------|
| `seed_boxes` | array | — | 曲線上の色サンプリング矩形。 |
| `tolerance` | int | 30 | 色許容範囲（5–100）。 |
| `background_rois` | array | [] | 減算する背景領域。 |

### `POST /trace` — 手動トレース

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|-----------|------|
| `guide_points` | array | — | 曲線上の最低 2 点。多いほど精度向上。 |
| `strategy` | string | "vertical" | 補間ストラテジー。 |

### `GET /health`

```json
{"status": "ok", "service": "ftir-spectrum-extractor"}
```

## ピクセル → 波数変換

```python
from spectral_convert import convert_pixels_to_spectral

spectral_data = convert_pixels_to_spectral(points, crop_coords, spectrum_params)
# → [{"wavenumber": 3998.5, "value": 0.8234}, ...]
```

線形およびセグメント線形（2000 cm⁻¹ 分割）波数マッピング、手動軸校正、Y 軸正規化（吸光度 0–1 / 透過率 0–100%）に対応。

## FTIR.fun について

このツールは **[FTIR.fun](https://ftir.fun)** のオープンソース抽出エンジンです — 13 万件以上の FTIR 参照スペクトルを持つクラウド赤外分光分析プラットフォーム。

[ftir.fun](https://ftir.fun) でできること：
- 抽出した CSV をアップロードし、スペクトルライブラリで材料を検索
- 化学ナレッジグラフに基づく AI ピーク解説を取得
- 共有可能なトライアクシスレポートを生成
- 28 以上の測定ファイル形式を解析

**オンラインで試す：** https://ftir.fun/spectrum/upload-image/

## ライセンス

MIT
