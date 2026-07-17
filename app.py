"""
FTIR Spectrum Image Extractor — Full-Stack Flask Application

Serves the interactive web UI and all API endpoints for spectrum curve extraction.
No external dependencies beyond Flask, OpenCV, NumPy, SciPy.
"""

import base64
import io
import logging
import os
import uuid

import cv2
import numpy as np
from flask import Flask, jsonify, render_template, request, session
from flask_cors import CORS
from PIL import Image

from cv_engine import (
    auto_extract_curve,
    decode_base64_image,
    decode_base64_image_color,
    extract_color_curve,
    trace_curve_by_guide,
)
from spectral_convert import convert_pixels_to_spectral

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["JSON_AS_ASCII"] = False
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024
app.secret_key = os.environ.get("SECRET_KEY", uuid.uuid4().hex)
CORS(app)

logger = logging.getLogger(__name__)

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

TARGET_WIDTH = 900

EXTRACTION_MODES = [
    {"threshold": 200, "invert": True, "direction": "average"},
    {"threshold": 200, "invert": False, "direction": "average"},
    {"threshold": 200, "invert": True, "direction": "top_first"},
    {"threshold": 200, "invert": False, "direction": "bottom_first"},
    {"threshold": 150, "invert": True, "direction": "average"},
    {"threshold": 150, "invert": False, "direction": "average"},
    {"threshold": 150, "invert": True, "direction": "top_first"},
    {"threshold": 150, "invert": False, "direction": "bottom_first"},
    {"threshold": 250, "invert": True, "direction": "average"},
    {"threshold": 250, "invert": False, "direction": "average"},
    {"threshold": 250, "invert": True, "direction": "top_first"},
    {"threshold": 250, "invert": False, "direction": "bottom_first"},
]


def get_extraction_mode():
    count = session.get("extract_count", 0)
    mode_idx = count % len(EXTRACTION_MODES)
    session["extract_count"] = count + 1
    return EXTRACTION_MODES[mode_idx], count + 1, mode_idx + 1


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# API: Upload
# ---------------------------------------------------------------------------

@app.route("/spectrum/upload-image/", methods=["POST"])
def upload_image():
    image_file = request.files.get("image")
    if not image_file:
        return jsonify({"error": "No image file uploaded"}), 400

    content_type = getattr(image_file, "content_type", "")
    if not content_type.startswith("image/"):
        return jsonify({"error": "File type must be an image"}), 400

    try:
        original_filename = getattr(image_file, "filename", "") or ""
        image_bytes = image_file.read()
        if not image_bytes:
            return jsonify({"error": "Image file is empty"}), 400

        img = Image.open(io.BytesIO(image_bytes))
        img.load()
        original_width, original_height = img.size

        if original_width != TARGET_WIDTH:
            scale = TARGET_WIDTH / original_width
            new_height = int(original_height * scale)
            img = img.resize((TARGET_WIDTH, new_height), Image.Resampling.LANCZOS)

        if img.mode in ("RGBA", "LA", "P"):
            background = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "RGBA":
                background.paste(img, mask=img.split()[-1])
            else:
                background.paste(img)
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")

        output = io.BytesIO()
        img.save(output, format="JPEG", quality=90)
        processed_bytes = output.getvalue()
        image_base64 = base64.b64encode(processed_bytes).decode("utf-8")
        data_uri = f"data:image/jpeg;base64,{image_base64}"

        stem = os.path.splitext(original_filename)[0] or "ftir-spectrum"
        download_filename = stem + ".csv"

        session["original_image"] = data_uri
        session["cropped_image"] = None
        session["crop_coords"] = None
        session["spectrum_params"] = None
        session["extract_count"] = 0

        return jsonify({
            "success": True,
            "image_data": data_uri,
            "original_filename": original_filename,
            "download_filename": download_filename,
        })

    except Exception:
        logger.exception("Image upload failed")
        return jsonify({"error": "Image processing failed"}), 500


# ---------------------------------------------------------------------------
# API: Crop
# ---------------------------------------------------------------------------

@app.route("/spectrum/crop/", methods=["POST"])
def crop():
    try:
        data = request.get_json()
        crop_coords = data.get("crop_coords")
        if not crop_coords:
            return jsonify({"error": "Missing crop coordinates"}), 400
        image_data = data.get("image_data")
        if not image_data:
            return jsonify({"error": "Missing image data"}), 400

        if "w" in crop_coords and "width" not in crop_coords:
            crop_coords["width"] = crop_coords["w"]
        if "h" in crop_coords and "height" not in crop_coords:
            crop_coords["height"] = crop_coords["h"]

        def to_none_or_float(v):
            return None if v in (None, "") else float(v)

        session["cropped_image"] = image_data
        session["crop_coords"] = crop_coords
        session["spectrum_params"] = {
            "start_wavenum": float(data.get("start_wavenum", 4000)),
            "end_wavenum": float(data.get("end_wavenum", 400)),
            "data_type": data.get("data_type", "absorbance"),
            "y_max": float(data.get("y_max", 1.0)),
            "y_min": float(data.get("y_min", 0.0)),
            "split_wavenum": to_none_or_float(data.get("split_wavenum")),
            "split_pixel_x": to_none_or_float(data.get("split_pixel_x")),
            "axis_left_pixel_x": to_none_or_float(data.get("axis_left_pixel_x")),
            "axis_right_pixel_x": to_none_or_float(data.get("axis_right_pixel_x")),
            "use_manual_axis_calibration": bool(data.get("use_manual_axis_calibration")),
        }
        session["extract_count"] = 0

        return jsonify({"success": True})
    except Exception:
        logger.exception("Crop save failed")
        return jsonify({"error": "Crop processing failed"}), 500


# ---------------------------------------------------------------------------
# API: Auto Extract
# ---------------------------------------------------------------------------

@app.route("/spectrum/auto-extract/", methods=["POST"])
def auto_extract():
    try:
        data = request.get_json() or {}
        cropped_image = session.get("cropped_image")
        crop_coords = session.get("crop_coords")
        spectrum_params = data.get("spectrum_params") or session.get("spectrum_params", {})

        use_grayscale = bool(data.get("use_grayscale", False))
        background_roi = data.get("background_roi")

        if not cropped_image:
            return jsonify({"error": "Cropped image not found. Please upload and crop first."}), 400
        if not crop_coords:
            return jsonify({"error": "Crop coordinates not found."}), 400

        mode, call_count, mode_number = get_extraction_mode()

        if use_grayscale:
            img = decode_base64_image(cropped_image)
        else:
            img_color = decode_base64_image_color(cropped_image)
            img = cv2.cvtColor(img_color, cv2.COLOR_BGR2GRAY)

        points = auto_extract_curve(
            img, crop_coords, mode["threshold"], background_roi,
            invert_threshold=mode["invert"],
            extraction_direction=mode["direction"],
        )

        if not points:
            return jsonify({"success": False, "error": "No curve detected", "mode": mode_number})

        if len(points) < 5:
            return jsonify({
                "success": False,
                "error": f"Too few points extracted ({len(points)})",
                "mode": mode_number,
            })

        spectral_data = convert_pixels_to_spectral(points, crop_coords, spectrum_params)

        return jsonify({
            "success": True,
            "points": points,
            "spectral_data": spectral_data,
            "count": len(points),
            "mode": mode_number,
            "total_calls": call_count,
            "threshold_used": mode["threshold"],
            "invert": mode["invert"],
            "direction": mode["direction"],
        })

    except Exception:
        logger.exception("Auto extract failed")
        return jsonify({"error": "Auto extraction failed"}), 500


# ---------------------------------------------------------------------------
# API: Color Extract
# ---------------------------------------------------------------------------

@app.route("/spectrum/extract-color/", methods=["POST"])
def extract_color():
    try:
        data = request.get_json()
        cropped_image = session.get("cropped_image")
        crop_coords = session.get("crop_coords")
        spectrum_params = data.get("spectrum_params") or session.get("spectrum_params", {})

        if not cropped_image:
            return jsonify({"error": "Cropped image not found."}), 400
        if not crop_coords:
            return jsonify({"error": "Crop coordinates not found."}), 400

        seed_points = data.get("seed_points", [])
        tolerance = int(data.get("tolerance", 30))
        use_grayscale = bool(data.get("use_grayscale", False))
        background_roi = data.get("background_roi")
        background_rois = data.get("background_rois") or []
        seed_boxes = data.get("seed_boxes") or []

        if not seed_points and not seed_boxes:
            return jsonify({"error": "No color sample points selected"}), 400

        img = decode_base64_image_color(cropped_image)
        if use_grayscale:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            img = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)

        points = extract_color_curve(
            img, seed_points, tolerance, crop_coords,
            background_roi, background_rois, seed_boxes,
        )

        if not points:
            return jsonify({"success": False, "error": "No curve extracted"})

        spectral_data = convert_pixels_to_spectral(points, crop_coords, spectrum_params)
        return jsonify({"success": True, "points": points, "spectral_data": spectral_data, "count": len(points)})

    except Exception:
        logger.exception("Color extract failed")
        return jsonify({"error": "Color extraction failed"}), 500


# ---------------------------------------------------------------------------
# API: Trace
# ---------------------------------------------------------------------------

@app.route("/spectrum/trace/", methods=["POST"])
def trace():
    try:
        data = request.get_json()
        cropped_image = session.get("cropped_image")
        crop_coords = session.get("crop_coords")
        spectrum_params = data.get("spectrum_params") or session.get("spectrum_params", {})

        if not cropped_image:
            return jsonify({"error": "Cropped image not found."}), 400
        if not crop_coords:
            return jsonify({"error": "Crop coordinates not found."}), 400

        guide_points = data.get("guide_points", [])
        strategy = data.get("strategy", "vertical")
        use_grayscale = bool(data.get("use_grayscale", False))

        if len(guide_points) < 2:
            return jsonify({"error": "At least 2 guide points required"}), 400

        if use_grayscale:
            img = decode_base64_image(cropped_image)
        else:
            img_color = decode_base64_image_color(cropped_image)
            img = cv2.cvtColor(img_color, cv2.COLOR_BGR2GRAY)

        points = trace_curve_by_guide(img, guide_points, strategy, crop_coords)
        if not points:
            return jsonify({"success": False, "error": "Trace failed"})

        spectral_data = convert_pixels_to_spectral(points, crop_coords, spectrum_params)
        return jsonify({"success": True, "points": points, "spectral_data": spectral_data, "count": len(points)})

    except Exception:
        logger.exception("Trace failed")
        return jsonify({"error": "Trace extraction failed"}), 500


# ---------------------------------------------------------------------------
# API: Health
# ---------------------------------------------------------------------------

@app.route("/health")
def health():
    return jsonify({"status": "ok", "service": "ftir-spectrum-extractor"})


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=5001, debug=debug)
