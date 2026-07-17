[English](README.md) | 中文 | [Español](README.es.md) | [Français](README.fr.md) | [日本語](README.ja.md)

# FTIR 光谱图像曲线提取工具

**从图像中提取红外光谱曲线，转换为波数-强度 CSV 数据。**

专为 **FTIR（傅里叶变换红外光谱，Fourier Transform Infrared Spectroscopy）** 谱图数字化设计——从论文、截图或扫描图片中提取波数（cm⁻¹）与吸光度/透过率数据。提供完整的交互式 Web 界面：上传图片、裁剪谱图区域、设置红外轴参数、导出可直接用于谱库检索或后续分析的干净 CSV。

> **其他光谱/色谱技术可参照修改：**
> 本项目专为红外光谱（IR / FT-IR / Mid-IR / NIR / Far-IR / ATR-FTIR）开发。如果你的工作涉及**拉曼光谱**、**紫外-可见光谱（UV-Vis）**、**气相色谱（GC）**、**高效液相色谱（HPLC）**、**气质联用（GC-MS）**、**液质联用（LC-MS）**、**X射线衍射（XRD）**、**核磁共振（NMR）**、**荧光光谱**、**热重分析（TGA）**、**差示扫描量热（DSC）** 或其他分析曲线，可以 fork 本项目并修改坐标轴映射（X轴：波长、保留时间、2θ、化学位移、温度、m/z；Y轴：强度、响应值、失重%）以适配你的仪器。核心图像提取算法（自适应阈值、贝叶斯颜色分类、三次插值）与具体分析技术无关。

## 功能概览

| 方法 | 原理 |
|------|------|
| **自动提取** | 自适应阈值 + 轮廓分析。12 种模式循环切换二值化方向和阈值——多次点击，选效果最好的一次。 |
| **颜色提取** | 贝叶斯颜色分类。在曲线上选取种子区域，算法通过颜色分布分离曲线像素与背景。 |
| **手动描点** | 沿曲线标记引导点，三次样条插值生成约 200 个点，严格经过所有引导点。 |

提取后，像素点通过分段线性波数映射转换为光谱数据，支持非线性 FTIR 轴的 2000 cm⁻¹ 分割校准。

## 快速开始

```bash
pip install -r requirements.txt
python app.py
# 浏览器打开 http://localhost:5001
```

Docker：

```bash
docker build -t ftir-extractor .
docker run --rm -p 5001:5001 ftir-extractor
```

## 使用流程（交互式 Web 界面）

1. **上传** — 上传光谱图片（JPG/PNG，自动缩放至 900px 宽度）
2. **裁剪与参数** — 拖动裁剪框对准光谱区域；设置起止波数、数据类型和可选的 2000 cm⁻¹ 轴分割
3. **背景去除** — 框选背景区域以抑制网格线和噪声
4. **提取** — 选择自动/颜色/手动描点；预览提取曲线；使用橡皮擦和波数偏移微调；下载 CSV

## API 接口

### `POST /spectrum/upload-image/` — 上传图片

Multipart 表单，`image` 字段。返回处理后图片的 base64 data-URI。

### `POST /spectrum/crop/` — 保存裁剪与参数

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

### `POST /spectrum/auto-extract/` — 自动提取

自动循环 12 种模式（4 种算法 × 3 种阈值）。每次调用使用下一个模式。

### `POST /spectrum/extract-color/` — 颜色提取

```json
{
  "seed_boxes": [{"x": 100, "y": 200, "width": 60, "height": 30}],
  "tolerance": 30,
  "background_rois": [{"x": 10, "y": 10, "width": 80, "height": 80}]
}
```

### `POST /spectrum/trace/` — 手动描点

```json
{
  "guide_points": [{"x": 50, "y": 300}, {"x": 200, "y": 150}, {"x": 400, "y": 280}],
  "strategy": "vertical"
}
```

所有提取接口返回：
```json
{
  "success": true,
  "points": [{"x": 10, "y": 150}, ...],
  "spectral_data": [{"wavenumber": 3998.5, "value": 0.82}, ...],
  "count": 850
}
```

## 像素 → 波数转换

```python
from spectral_convert import convert_pixels_to_spectral

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
├── app.py                 # Flask 全栈应用（UI + API）
├── cv_engine.py           # 计算机视觉提取算法
├── spectral_convert.py    # 像素 → 波数转换
├── templates/
│   └── index.html         # 交互式提取界面
├── static/
│   ├── js/app.js          # 前端逻辑
│   └── css/style.css      # 样式
├── requirements.txt
├── Dockerfile
└── LICENSE
```

## 适用范围与相关技术

本工具**直接支持**红外光谱曲线提取：

- FTIR、FT-IR、ATR-FTIR、DRIFTS、透射红外、反射红外
- 中红外（4000–400 cm⁻¹）、近红外（NIR）、远红外（Far-IR）
- 吸光度、透过率、Kubelka-Munk
- 波数（cm⁻¹）轴，支持 2000 cm⁻¹ 非线性分割校准

**可参照修改**（fork 后修改轴参数）适配：

- 拉曼光谱（拉曼位移 cm⁻¹、SERS、共振拉曼）
- 紫外-可见光谱（波长 nm、光密度）
- 色谱（GC 气相色谱、HPLC、UHPLC、GC-MS、LC-MS、保留时间）
- 热分析（TGA 热重、DSC 差示扫描量热、DTA、温度 °C、失重）
- XRD（2θ）、XRF、SAXS
- 核磁共振（¹H NMR、¹³C NMR、化学位移 ppm）
- 质谱（m/z）
- 荧光光谱、光致发光、发射光谱
- 电化学（循环伏安、阻抗谱）

## 关于 FTIR.fun

本工具是 **[FTIR.fun](https://ftir.fun)** 的开源提取引擎——一个拥有 13 万+ FTIR 参考谱图的云端红外光谱分析平台。

在 [ftir.fun](https://ftir.fun) 你可以：
- 上传提取的 CSV，在谱库中检索匹配材质
- 获得基于化学知识图谱的 AI 峰位解析
- 生成可共享的三轴完整报告
- 解析 28+ 种仪器文件格式（Thermo .spa、Bruker .opus、JCAMP-DX 等）

**在线使用：** https://ftir.fun/spectrum/upload-image/

## 许可证

MIT
