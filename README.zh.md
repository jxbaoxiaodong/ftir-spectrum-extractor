[English](README.md) | 中文 | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md)

# FTIR 光谱图像曲线提取工具

从图像中提取红外光谱曲线，将像素坐标转换为波数-强度 CSV 数据。专为从论文、截图或扫描图片中数字化 FTIR 光谱而设计。

## 功能概览

| 方法 | 原理 |
|------|------|
| **自动提取** | 自适应阈值 + 轮廓分析。12 种模式循环切换二值化方向和阈值 —— 多次点击，选效果最好的一次。 |
| **颜色提取** | 贝叶斯颜色分类。在曲线上选取种子区域，算法通过颜色分布分离曲线像素与背景。 |
| **手动描点** | 沿曲线标记引导点，三次样条插值生成约 200 个点，严格经过所有引导点。 |

提取后，像素点通过分段线性波数映射转换为光谱数据，支持非线性 FTIR 轴的 2000 cm⁻¹ 分割校准。

## 快速开始

```bash
pip install -r requirements.txt
python cv_service.py
# 服务启动于 http://localhost:5001
```

Docker：

```bash
docker build -t ftir-extractor .
docker run --rm -p 5001:5001 ftir-extractor
```

## API 接口

### `POST /analyze` — 自动提取

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

**参数**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `image` | string | — | 光谱图像的 base64 data-URI。 |
| `crop_coords` | object | 全图 | 裁剪区域 `{x, y, width, height}`。 |
| `threshold` | int | 200 | 二值化阈值（150/200/250）。 |
| `invert_threshold` | bool | true | `true` = 白底黑线；`false` = 黑底白线。 |
| `extraction_direction` | string | "average" | `"average"`、`"top_first"` 或 `"bottom_first"`。 |
| `use_grayscale` | bool | false | 强制灰度处理。 |
| `background_roi` | object | null | 背景采样区域，用于背景抑制。 |

**响应**

```json
{
  "success": true,
  "auto_curves": [{"points": [{"x": 10, "y": 150}, ...]}],
  "count": 850
}
```

### `POST /extract-color` — 颜色提取

```json
{
  "image": "data:image/jpeg;base64,...",
  "crop_coords": {"x": 0, "y": 0, "width": 900, "height": 400},
  "seed_boxes": [{"x": 100, "y": 200, "width": 60, "height": 30}],
  "tolerance": 30,
  "background_rois": [{"x": 10, "y": 10, "width": 80, "height": 80}]
}
```

**参数**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `seed_boxes` | array | — | 曲线上的矩形框，用于颜色采样。 |
| `seed_points` | array | — | 兼容旧版：曲线上的单独点。 |
| `tolerance` | int | 30 | 颜色容差（5–100），越高越宽松。 |
| `background_rois` | array | [] | 背景区域，用于减除。 |

### `POST /trace` — 手动描点

```json
{
  "image": "data:image/jpeg;base64,...",
  "crop_coords": {"x": 0, "y": 0, "width": 900, "height": 400},
  "guide_points": [{"x": 50, "y": 300}, {"x": 200, "y": 150}, {"x": 400, "y": 280}],
  "strategy": "vertical"
}
```

**参数**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `guide_points` | array | — | 至少 2 个曲线上的点。点越多精度越高。 |
| `strategy` | string | "vertical" | 插值策略。 |

### `GET /health`

```json
{"status": "ok", "service": "ftir-spectrum-extractor"}
```

## 像素 → 波数转换

提取像素点后，使用 `spectral_convert.py` 映射为波数-强度对：

```python
from spectral_convert import convert_pixels_to_spectral

points = [{"x": 50, "y": 300}, {"x": 100, "y": 250}, ...]

spectrum_params = {
    "start_wavenum": 4000,
    "end_wavenum": 400,
    "data_type": "absorbance",       # 或 "transmittance"
    "split_pixel_x": None,           # 非线性轴时设置
    "split_wavenum": 2000,
    "use_manual_axis_calibration": False,
    "axis_left_pixel_x": None,
    "axis_right_pixel_x": None,
}

crop_coords = {"x": 0, "y": 0, "width": 900, "height": 400}

spectral_data = convert_pixels_to_spectral(points, crop_coords, spectrum_params)
# → [{"wavenumber": 3998.5, "value": 0.8234}, ...]
```

支持：
- 线性和分段线性（2000 cm⁻¹ 分割）波数映射
- 自动或手动轴校准
- Y 轴归一化为吸光度（0–1）或透过率（0–100%）
- 按波数去重取平均

## 12 种自动提取模式

| 模式 | 阈值 | 二值化 | 方向 |
|------|------|--------|------|
| 1–4 | 200 | 反/正/反/正 | 平均/平均/从上/从下 |
| 5–8 | 150 | 反/正/反/正 | 平均/平均/从上/从下 |
| 9–12 | 250 | 反/正/反/正 | 平均/平均/从上/从下 |

多次点击"重试自动提取"，每次使用下一种模式，选择曲线最干净的结果。

## 项目结构

```
ftir-spectrum-extractor/
├── cv_service.py          # Flask CV 服务（自动/颜色/描点提取）
├── spectral_convert.py    # 像素 → 波数转换
├── requirements.txt
├── Dockerfile
└── LICENSE
```

## 关于 FTIR.fun

本工具是 **[FTIR.fun](https://ftir.fun)** 的开源提取引擎 —— 一个拥有 13 万+ FTIR 参考谱图的云端红外光谱分析平台。

在 [ftir.fun](https://ftir.fun) 你可以：
- 上传提取的 CSV，在谱库中检索匹配材质
- 获得基于化学知识图谱的 AI 峰位解析
- 生成可共享的三轴完整报告
- 解析 28+ 种仪器文件格式（Thermo .spa、Bruker .opus、JCAMP-DX 等）

**在线使用：** https://ftir.fun/spectrum/upload-image/

## 许可证

MIT
