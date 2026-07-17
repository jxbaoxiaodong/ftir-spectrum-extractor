// ========== Global variables ==========
var originalImage = null;
var croppedImage = null;
var currentStep = 1;
var extractMode = 'color';
var colorBoxes = [];           // 取色框（原始图像绝对坐标）：{x, y, width, height}
var colorBoxPreview = null;    // 拖拽取色框时的预览矩形（显示坐标）
var isDraggingColorBox = false;
var colorBoxStart = null;
var cachedExtractImg = null;   // 缓存 cropped 图像元素，避免拖动时反复 new Image()
var editableExtractCanvas = null;
var editableExtractCtx = null;
var tracePoints = [];
var autoExtractedPoints = null;
var lastSpectralData = null;
var correctedSpectralData = null;
var uploadedSourceFilename = '';
var uploadedDownloadFilename = null;
var peakCorrectionAnchors = [];
var peakCorrectionActiveSelections = {};
var cropCoords = {};
var extractScale = 1;
var extractDisplayScale = 1;
var EXTRACT_CANVAS_BASE_MAX_WIDTH = 700;
var EXTRACT_CANVAS_TRACE_ZOOM_WIDTH = 1400;
var splitLineDisplayX = null;
var axisLeftDisplayX = null;
var axisRightDisplayX = null;
var isDraggingSplitLine = false;
var isDraggingAxisGuide = null;
var currentCurvePoints = [];
var eraserMode = false;
var isErasing = false;
var eraserSize = 12;
var pristineCurvePoints = [];
var pristineCroppedImageForErase = null;
var eraserImageDirty = false;
var backgroundBoxes = [];
var bgCanvas = null, bgCtx = null, bgScale = 1;
var isDraggingBgBox = false;
var bgStart = null;
var GLM51_COLORS = {
    bg: '#0a0e17',
    surface: '#111827',
    line: '#1e2d3d',
    text: '#e2e8f0',
    muted: '#8899aa',
    accent: '#22d3ee',
    accentStrong: '#0ea5e9',
    error: '#ef4444'
};
var ERASER_DEFAULT_BACKGROUND_RGB = { r: 255, g: 255, b: 255 };
var ERASER_BACKGROUND_RING_INNER_RATIO = 1.25;
var ERASER_BACKGROUND_RING_OUTER_RATIO = 2.25;
var ERASER_BACKGROUND_SAMPLE_STRIDE = 3;
var ERASER_MIN_BACKGROUND_SAMPLES = 8;
var ERASER_IMAGE_EXPORT_TYPE = 'image/jpeg';
var ERASER_IMAGE_EXPORT_QUALITY = 0.95;
var PEAK_CORRECTION_BANDS = [
    { key: 'high', labelKey: 'peakCorrectionBandHigh', fallback: 'High wavenumber' },
    { key: 'middle', labelKey: 'peakCorrectionBandMiddle', fallback: 'Middle wavenumber' },
    { key: 'low', labelKey: 'peakCorrectionBandLow', fallback: 'Low wavenumber' }
];
var PEAK_CORRECTION_REQUIRED_ANCHOR_COUNT = PEAK_CORRECTION_BANDS.length;
var PEAK_DETECTION_NEIGHBOR_SPAN = 2;
var PEAK_DETECTION_PROMINENCE_SPAN = 6;
var PEAK_DETECTION_MIN_BAND_POINTS = 5;

function getAdvancedUploadConfig() {
    var node = document.getElementById('ft-advanced-upload-config');
    if (!node) return {};
    try {
        return JSON.parse(node.textContent || '{}');
    } catch (error) {
        console.error('Invalid advanced upload config JSON', error);
        return {};
    }
}

var FT_ADVANCED_UPLOAD_CONFIG = getAdvancedUploadConfig();
var IS_AUTHENTICATED = Boolean(FT_ADVANCED_UPLOAD_CONFIG.isAuthenticated);

function advancedText(key, fallback) {
    if (FT_ADVANCED_UPLOAD_CONFIG.messages && FT_ADVANCED_UPLOAD_CONFIG.messages[key]) {
        return FT_ADVANCED_UPLOAD_CONFIG.messages[key];
    }
    return fallback || '';
}

function advancedFormat(key, values, fallback) {
    var template = advancedText(key, fallback);
    return String(template || '').replace(/\{(\w+)\}/g, function(_match, name) {
        return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : '';
    });
}

function userErrorMessage(message, fallbackKey) {
    var text = String(message || '').trim();
    return text || advancedText(fallbackKey || 'genericRequestFailed');
}

function parseErrorMessage(xhr) {
    try {
        var payload = JSON.parse(xhr.responseText || '{}');
        return payload.error || payload.message || payload.detail || '';
    } catch (_e) {
        return '';
    }
}

function logClientRequestError(context, error) {
    if (typeof console !== 'undefined' && console.error) {
        console.error(context, error);
    }
}

function deriveCsvDownloadFilename(rawName) {
    var trimmed = String(rawName || '').trim();
    if (!trimmed) {
        return advancedText('defaultDownloadFilename', advancedText('downloadFilename', 'ftir-spectrum.csv'));
    }
    var basename = trimmed.split(/[\\/]/).pop() || trimmed;
    var dotIndex = basename.lastIndexOf('.');
    var stem = dotIndex > 0 ? basename.slice(0, dotIndex) : basename;
    stem = stem.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ');
    if (!stem) {
        return advancedText('defaultDownloadFilename', advancedText('downloadFilename', 'ftir-spectrum.csv'));
    }
    return stem + '.csv';
}

function setUploadedFilenameState(sourceName, downloadName) {
    uploadedSourceFilename = String(sourceName || '').trim();
    uploadedDownloadFilename = deriveCsvDownloadFilename(downloadName || uploadedSourceFilename);
}

function effectiveSpectralData() {
    return (correctedSpectralData && correctedSpectralData.length) ? correctedSpectralData : lastSpectralData;
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function extractCanvasMaxWidthForMode(mode) {
    return mode === 'trace' ? EXTRACT_CANVAS_TRACE_ZOOM_WIDTH : EXTRACT_CANVAS_BASE_MAX_WIDTH;
}

function syncExtractCanvasViewport(mode) {
    var viewport = document.getElementById('extractCanvasViewport');
    if (!viewport) return;
    viewport.classList.toggle('is-trace-zoom', mode === 'trace');
}

function resizeExtractCanvasForImage(img, mode) {
    if (!extractCanvas || !img) return;
    var activeMode = mode || extractMode;
    var maxWidth = extractCanvasMaxWidthForMode(activeMode);
    if (activeMode === 'trace') {
        extractDisplayScale = Math.min(2, Math.max(1, maxWidth / Math.max(1, img.width)));
    } else {
        extractDisplayScale = Math.min(1, maxWidth / Math.max(1, img.width));
    }
    extractScale = extractDisplayScale;
    extractCanvas.width = Math.max(1, Math.round(img.width * extractScale));
    extractCanvas.height = Math.max(1, Math.round(img.height * extractScale));
    extractCanvas.style.width = extractCanvas.width + 'px';
    extractCanvas.style.height = extractCanvas.height + 'px';
    syncExtractCanvasViewport(activeMode);
}

setUploadedFilenameState('', advancedText('defaultDownloadFilename', advancedText('downloadFilename', 'ftir-spectrum.csv')));

function xhrJSON(url, payload, onSuccess, onError) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    // No CSRF token needed for standalone Flask app
    xhr.onreadystatechange = function() {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
            try { onSuccess(JSON.parse(xhr.responseText)); }
            catch(e) { onError(new Error(advancedText('genericRequestFailed'))); }
        } else {
            onError(new Error(userErrorMessage(parseErrorMessage(xhr), 'genericRequestFailed')));
        }
    };
    xhr.onerror = function() { onError(new Error(advancedText('genericRequestFailed'))); };
    xhr.send(JSON.stringify(payload));
}

function xhrForm(url, formData, onSuccess, onError) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.onreadystatechange = function() {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
            try { onSuccess(JSON.parse(xhr.responseText)); }
            catch(e) { onError(new Error(advancedText('genericRequestFailed'))); }
        } else {
            onError(new Error(userErrorMessage(parseErrorMessage(xhr), 'genericRequestFailed')));
        }
    };
    xhr.onerror = function() { onError(new Error(advancedText('genericRequestFailed'))); };
    xhr.send(formData);
}

function loadImage(src, callback) {
    var img = new Image();
    img.onload = function() { callback(img); };
    img.src = src;
}

// New: record split line ratio inside crop box
var currentSplitRatio = 0.5;
var currentAxisLeftRatio = 0.0;
var currentAxisRightRatio = 1.0;
var splitGuideTouched = false;
var axisGuidesTouched = false;

// ========== Wavenumber offset (visual shift) ==========
var currentWavenumOffset = 0;

// ========== Preview modal variables ==========
var modalCanvas = null, modalCtx = null;

function wavenumOffsetToPixelOffset(offsetWavenum, spectrumParams, cropCoords) {
    if (!offsetWavenum || !spectrumParams || !cropCoords) return 0;
    
    var startW = parseFloat(spectrumParams.start_wavenum || 4000);
    var endW = parseFloat(spectrumParams.end_wavenum || 400);
    var splitW = parseFloat(spectrumParams.split_wavenum || 2000);
    var splitPixelX = spectrumParams.split_pixel_x === null || spectrumParams.split_pixel_x === undefined
        ? null
        : parseFloat(spectrumParams.split_pixel_x);
    if (splitPixelX !== null && !isFinite(splitPixelX)) {
        splitPixelX = null;
    }
    
    var xMin = parseFloat(cropCoords.x || 0);
    var xMax = xMin + parseFloat(cropCoords.width || 1) - 1;
    var totalPixels = cropCoords.width || 1;
    
    var totalWavenumRange = Math.abs(startW - endW);
    if (totalWavenumRange === 0) return 0;
    
    var wavenumPerPixel;
    
    if (splitPixelX !== null && splitPixelX > xMin && splitPixelX < xMax) {
        var leftPixels = splitPixelX - xMin;
        var rightPixels = xMax - splitPixelX;
        var leftWavenumRange = Math.abs(startW - splitW);
        var rightWavenumRange = Math.abs(splitW - endW);
        var totalPixelsEffective = leftPixels + rightPixels;
        var totalWavenumEffective = leftWavenumRange + rightWavenumRange;
        wavenumPerPixel = totalWavenumEffective / totalPixelsEffective;
    } else {
        wavenumPerPixel = totalWavenumRange / totalPixels;
    }
    
    var direction = startW > endW ? -1 : 1;
    
    return offsetWavenum / wavenumPerPixel * direction;
}

function applyWavenumOffset() {
    var offsetInput = document.getElementById('wavenumOffset');
    var offset = parseInt(offsetInput.value || '0', 10);
    
    if (!isFinite(offset)) {
        alert(advancedText('invalidInteger'));
        return;
    }
    
    currentWavenumOffset = offset;
    var spectrumParams = getCurrentSpectrumParamsFromUI();
    
    if (currentCurvePoints && currentCurvePoints.length > 0) {
        resetPeakCorrectionState({ keepInputs: true });
        lastSpectralData = convertPixelsToSpectral(currentCurvePoints, cropCoords, spectrumParams);
        
        if (lastSpectralData && lastSpectralData.length > 0) {
        lastSpectralData = lastSpectralData.map(function(p) {
            return {
                wavenumber: Math.round((p.wavenumber + offset) * 10000) / 10000,
                value: p.value
            };
        });
        }
        
        drawPreviewChart(lastSpectralData);
        redrawExtractWithVisualOffset(offset, spectrumParams);
        
        var statusEl = document.getElementById('offsetStatus');
        statusEl.style.display = 'block';
        statusEl.textContent = offset > 0 ? 
            advancedFormat('offsetAppliedPositive', { offset: offset }, 'Offset applied: +' + offset + ' cm⁻¹') : 
            offset < 0 ? 
            advancedFormat('offsetAppliedNegative', { offset: offset }, 'Offset applied: ' + offset + ' cm⁻¹') :
            advancedText('offsetAppliedZero');
    }
}

function redrawExtractWithVisualOffset(offset, spectrumParams) {
    if (!extractCtx || !extractCanvas || !croppedImage) return;
    
    var pixelOffset = wavenumOffsetToPixelOffset(offset, spectrumParams, cropCoords);

    if (editableExtractCanvas) {
        applyCanvasDisplayModeFromImage(editableExtractCanvas);
        if (currentCurvePoints && currentCurvePoints.length > 0) {
            drawOffsetCurveOnExtractCanvas(currentCurvePoints, pixelOffset, offset);
        }
        drawSplitGuideLine();
        return;
    }
    
    var img = new Image();
    img.onload = function() {
        applyCanvasDisplayModeFromImage(img);
        
        if (currentCurvePoints && currentCurvePoints.length > 0) {
            drawOffsetCurveOnExtractCanvas(currentCurvePoints, pixelOffset, offset);
        }
        
        drawSplitGuideLine();
    };
    img.src = croppedImage;
}

function recalculateCurrentSpectralDataFromUI() {
    if (!currentCurvePoints || !currentCurvePoints.length || !cropCoords) return;
    maybeAutoFitAxisGuidesToCurve(currentCurvePoints);
    var spectrumParams = getCurrentSpectrumParamsFromUI();
    resetPeakCorrectionState({ keepInputs: true });
    lastSpectralData = convertPixelsToSpectral(currentCurvePoints, cropCoords, spectrumParams);
    if (currentWavenumOffset !== 0 && lastSpectralData) {
        lastSpectralData = lastSpectralData.map(function(p) {
            return {
                wavenumber: Math.round((p.wavenumber + currentWavenumOffset) * 10000) / 10000,
                value: p.value
            };
        });
    }
    drawPreviewChart(lastSpectralData);
    redrawExtractWithVisualOffset(currentWavenumOffset, spectrumParams);
}

function drawOffsetCurveOnExtractCanvas(points, pixelOffset, wavenumOffset) {
    if (!extractCtx || !points || !points.length) return;
    
    var offsetPoints = points.map(function(p) {
        return {x: p.x + pixelOffset, y: p.y};
    });
    
    var cropX = cropCoords.x || 0;
    var cropY = cropCoords.y || 0;
    var cropW = cropCoords.width || extractCanvas.width;
    var cropH = cropCoords.height || extractCanvas.height;
    var xMin = cropX;
    var xMax = cropX + cropW;
    
    var visiblePoints = offsetPoints.filter(function(p) { return p.x >= xMin - 10 && p.x <= xMax + 10; });

    if (visiblePoints.length < 2) return;

    var sorted = visiblePoints.slice().sort(function(a, b) { return a.x - b.x; });

    extractCtx.strokeStyle = GLM51_COLORS.accent;
    extractCtx.lineWidth = 2;
    extractCtx.beginPath();

    sorted.forEach(function(p, i) {
        var displayX = (p.x - (cropCoords.x || 0)) * extractScale;
        var displayY = (p.y - (cropCoords.y || 0)) * extractScale;
        
        if (i === 0) extractCtx.moveTo(displayX, displayY);
        else extractCtx.lineTo(displayX, displayY);
    });
    
    extractCtx.stroke();
    
    extractCtx.save();
    extractCtx.fillStyle = GLM51_COLORS.accent;
    extractCtx.font = 'bold 14px sans-serif';
    extractCtx.shadowColor = 'rgba(0,0,0,0.8)';
    extractCtx.shadowBlur = 4;
    extractCtx.shadowOffsetX = 1;
    extractCtx.shadowOffsetY = 1;
    
    var label = wavenumOffset > 0 ? '+' + (wavenumOffset) + ' cm⁻¹' : 
                  wavenumOffset < 0 ? '' + (wavenumOffset) + ' cm⁻¹' : '0';
    
    extractCtx.fillText(label, 10, 25);
    
    if (wavenumOffset !== 0) {
        extractCtx.strokeStyle = 'rgba(34,211,238,0.35)';
        extractCtx.lineWidth = 1;
        extractCtx.setLineDash([4, 4]);
        extractCtx.beginPath();
        
        var originalSorted = points.slice().sort(function(a, b) { return a.x - b.x; });
        originalSorted.forEach(function(p, i) {
            var displayX = (p.x - (cropCoords.x || 0)) * extractScale;
            var displayY = (p.y - (cropCoords.y || 0)) * extractScale;
            if (i === 0) extractCtx.moveTo(displayX, displayY);
            else extractCtx.lineTo(displayX, displayY);
        });
        extractCtx.stroke();
        extractCtx.setLineDash([]);
        
        extractCtx.fillStyle = 'rgba(136,153,170,0.75)';
        extractCtx.font = '11px sans-serif';
        extractCtx.fillText(advancedText('labelOriginal'), 10, 42);
        extractCtx.fillStyle = GLM51_COLORS.accent;
        extractCtx.fillText(advancedText('labelShifted'), 10, 56);
    }
    
    extractCtx.restore();
}

function resetEditableExtractImage(img) {
    editableExtractCanvas = document.createElement('canvas');
    editableExtractCanvas.width = img.width;
    editableExtractCanvas.height = img.height;
    editableExtractCtx = editableExtractCanvas.getContext('2d');
    editableExtractCtx.drawImage(img, 0, 0);
}

function drawCurrentExtractBaseImage(fallbackImg) {
    if (!extractCtx || !extractCanvas) return;
    var base = editableExtractCanvas || fallbackImg || cachedExtractImg;
    if (!base) return;
    extractCtx.clearRect(0, 0, extractCanvas.width, extractCanvas.height);
    extractCtx.drawImage(base, 0, 0, extractCanvas.width, extractCanvas.height);
}

function applyCanvasDisplayModeFromImage(img) {
    drawCurrentExtractBaseImage(img);
}

function averageImageRegionColor(x, y, width, height) {
    if (!editableExtractCtx || !editableExtractCanvas) return null;
    var canvasW = editableExtractCanvas.width;
    var canvasH = editableExtractCanvas.height;
    var x0 = Math.max(0, Math.floor(x));
    var y0 = Math.max(0, Math.floor(y));
    var x1 = Math.min(canvasW, Math.ceil(x + width));
    var y1 = Math.min(canvasH, Math.ceil(y + height));
    if (x1 <= x0 || y1 <= y0) return null;

    var imageData = editableExtractCtx.getImageData(x0, y0, x1 - x0, y1 - y0);
    var data = imageData.data;
    var step = Math.max(1, ERASER_BACKGROUND_SAMPLE_STRIDE);
    var r = 0, g = 0, b = 0, count = 0;

    for (var py = 0; py < imageData.height; py += step) {
        for (var px = 0; px < imageData.width; px += step) {
            var idx = (py * imageData.width + px) * 4;
            r += data[idx];
            g += data[idx + 1];
            b += data[idx + 2];
            count++;
        }
    }

    if (count < ERASER_MIN_BACKGROUND_SAMPLES) return null;
    return {
        r: Math.round(r / count),
        g: Math.round(g / count),
        b: Math.round(b / count)
    };
}

function sampleBackgroundColorFromBoxes() {
    if (!backgroundBoxes || !backgroundBoxes.length) return null;
    var totalR = 0, totalG = 0, totalB = 0, count = 0;

    backgroundBoxes.forEach(function(box) {
        var color = averageImageRegionColor(box.x, box.y, box.width, box.height);
        if (!color) return;
        totalR += color.r;
        totalG += color.g;
        totalB += color.b;
        count++;
    });

    if (!count) return null;
    return {
        r: Math.round(totalR / count),
        g: Math.round(totalG / count),
        b: Math.round(totalB / count)
    };
}

function sampleLocalBackgroundColor(localX, localY, localRadius) {
    if (!editableExtractCtx || !editableExtractCanvas) return null;
    var outerRadius = Math.max(1, localRadius * ERASER_BACKGROUND_RING_OUTER_RATIO);
    var innerRadius = Math.max(0, localRadius * ERASER_BACKGROUND_RING_INNER_RATIO);
    var x0 = Math.max(0, Math.floor(localX - outerRadius));
    var y0 = Math.max(0, Math.floor(localY - outerRadius));
    var x1 = Math.min(editableExtractCanvas.width, Math.ceil(localX + outerRadius));
    var y1 = Math.min(editableExtractCanvas.height, Math.ceil(localY + outerRadius));
    if (x1 <= x0 || y1 <= y0) return null;

    var imageData = editableExtractCtx.getImageData(x0, y0, x1 - x0, y1 - y0);
    var data = imageData.data;
    var step = Math.max(1, ERASER_BACKGROUND_SAMPLE_STRIDE);
    var inner2 = innerRadius * innerRadius;
    var outer2 = outerRadius * outerRadius;
    var r = 0, g = 0, b = 0, count = 0;

    for (var py = 0; py < imageData.height; py += step) {
        for (var px = 0; px < imageData.width; px += step) {
            var absX = x0 + px;
            var absY = y0 + py;
            var dx = absX - localX;
            var dy = absY - localY;
            var dist2 = dx * dx + dy * dy;
            if (dist2 <= inner2 || dist2 > outer2) continue;
            var idx = (py * imageData.width + px) * 4;
            r += data[idx];
            g += data[idx + 1];
            b += data[idx + 2];
            count++;
        }
    }

    if (count < ERASER_MIN_BACKGROUND_SAMPLES) return null;
    return {
        r: Math.round(r / count),
        g: Math.round(g / count),
        b: Math.round(b / count)
    };
}

function eraserFillStyleFor(localX, localY, localRadius) {
    var color = sampleBackgroundColorFromBoxes() ||
        sampleLocalBackgroundColor(localX, localY, localRadius) ||
        ERASER_DEFAULT_BACKGROUND_RGB;
    return 'rgb(' + color.r + ',' + color.g + ',' + color.b + ')';
}

function convertImageDataToGrayscale(imageData) {
    var d = imageData.data;
    for (var i = 0; i < d.length; i += 4) {
        var g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        d[i] = g;
        d[i + 1] = g;
        d[i + 2] = g;
    }
    return imageData;
}

function getSpectrumYParams() {
    var dataType = document.getElementById('dataType').value;
    return {
        y_max: dataType === 'absorbance' ? 1.0 : 100.0,
        y_min: 0.0,
        data_type: dataType
    };
}

function isSplitWavenumEnabled() {
    var checkbox = document.getElementById('useSplitWavenum');
    return checkbox ? checkbox.checked : false;
}

function syncSplitWavenumControls() {
    var checkbox = document.getElementById('useSplitWavenum');
    var group = document.getElementById('splitParamsGroup');
    var enabled = checkbox ? checkbox.checked : false;
    if (group) {
        group.style.opacity = enabled ? '1' : '0.4';
        group.style.pointerEvents = enabled ? 'auto' : 'none';
    }
}

function updateSplitPixelInput() {
    var input = document.getElementById('splitPixelX');
    if (!input) return;

    if (cropCanvas && cropCanvas.width > 0 && originalImage && splitLineDisplayX !== null) {
        var scaleX = originalImage.width / cropCanvas.width;
        input.value = (splitLineDisplayX * scaleX).toFixed(2);
        return;
    }

    if (cropCoords && cropCoords.split_pixel_x != null) {
        input.value = parseFloat(cropCoords.split_pixel_x).toFixed(2);
        return;
    }

    input.value = '';
}

function getSplitParams() {
    if (!isSplitWavenumEnabled()) {
        return {
            split_wavenum: null,
            split_pixel_x: null
        };
    }
    var splitW = 2000;
    var splitX = null;
    if (cropCanvas && cropCanvas.width > 0 && originalImage && splitLineDisplayX !== null) {
        splitX = splitLineDisplayX * (originalImage.width / cropCanvas.width);
    } else {
        var splitXRaw = (document.getElementById('splitPixelX') ? document.getElementById('splitPixelX').value : '');
        splitX = parseFloat(splitXRaw || '');
    }
    return {
        split_wavenum: splitW,
        split_pixel_x: isFinite(splitX) ? splitX : null
    };
}

function updateAxisPixelInputs() {
    var leftInput = document.getElementById('axisLeftPixelX');
    var rightInput = document.getElementById('axisRightPixelX');
    if (!leftInput || !rightInput) return;

    var scaleX = cropCanvas && cropCanvas.width > 0 && originalImage ? (originalImage.width / cropCanvas.width) : 1;
    leftInput.value = axisLeftDisplayX === null ? '' : (axisLeftDisplayX * scaleX).toFixed(2);
    rightInput.value = axisRightDisplayX === null ? '' : (axisRightDisplayX * scaleX).toFixed(2);
}

function syncAxisGuidesToCropBox() {
    if (!cropBox) return;
    currentAxisLeftRatio = Math.max(0, Math.min(1, currentAxisLeftRatio));
    currentAxisRightRatio = Math.max(currentAxisLeftRatio, Math.min(1, currentAxisRightRatio));
    axisLeftDisplayX = cropBox.x + currentAxisLeftRatio * cropBox.w;
    axisRightDisplayX = cropBox.x + currentAxisRightRatio * cropBox.w;
    updateAxisPixelInputs();
    updateSplitPixelInput();
}

function getAxisParams() {
    if (cropCanvas && cropCanvas.width > 0 && originalImage && axisLeftDisplayX !== null && axisRightDisplayX !== null) {
        var scaleX = originalImage.width / cropCanvas.width;
        return {
            axis_left_pixel_x: axisLeftDisplayX * scaleX,
            axis_right_pixel_x: axisRightDisplayX * scaleX,
            use_manual_axis_calibration: axisGuidesTouched
        };
    }
    if (cropCoords && cropCoords.axis_left_pixel_x != null && cropCoords.axis_right_pixel_x != null) {
        return {
            axis_left_pixel_x: parseFloat(cropCoords.axis_left_pixel_x),
            axis_right_pixel_x: parseFloat(cropCoords.axis_right_pixel_x),
            use_manual_axis_calibration: Boolean(cropCoords.use_manual_axis_calibration)
        };
    }
    if (cropCoords && cropCoords.x != null && cropCoords.width != null) {
        var cropX = parseFloat(cropCoords.x || 0);
        var cropWidth = parseFloat(cropCoords.width || 1);
        return {
            axis_left_pixel_x: cropX,
            axis_right_pixel_x: cropX + cropWidth - 1,
            use_manual_axis_calibration: false
        };
    }
    return {
        axis_left_pixel_x: null,
        axis_right_pixel_x: null,
        use_manual_axis_calibration: false
    };
}

function maybeAutoFitAxisGuidesToCurve(points) {
    if (axisGuidesTouched || !points || !points.length || !cropCanvas || cropCanvas.width <= 0 || !originalImage || !cropBox) {
        return;
    }

    var xs = points.map(function(p) { return parseFloat(p.x || 0); }).filter(function(x) { return isFinite(x); });
    if (!xs.length) return;

    var scaleX = originalImage.width / cropCanvas.width;
    var minDisplayX = Math.max(cropBox.x, Math.min(cropBox.x + cropBox.w, Math.min.apply(null, xs) / scaleX));
    var maxDisplayX = Math.max(minDisplayX, Math.min(cropBox.x + cropBox.w, Math.max.apply(null, xs) / scaleX));

    axisLeftDisplayX = minDisplayX;
    axisRightDisplayX = maxDisplayX;
    currentAxisLeftRatio = cropBox.w ? (axisLeftDisplayX - cropBox.x) / cropBox.w : 0;
    currentAxisRightRatio = cropBox.w ? (axisRightDisplayX - cropBox.x) / cropBox.w : 1;
    updateAxisPixelInputs();

    if (typeof drawCropCanvas === 'function') {
        drawCropCanvas();
    }
}

function thinPointsByX(points) {
    var grouped = {};
    points.forEach(function(p) {
        var x = Math.round(parseFloat(p.x || 0));
        var y = parseFloat(p.y || 0);
        if (!grouped[x]) grouped[x] = [];
        grouped[x].push(y);
    });
    var xs = Object.keys(grouped).map(Number).sort(function(a, b) { return a - b; });
    return xs.map(function(x) {
        var ys = grouped[x].slice().sort(function(a, b) { return a - b; });
        var m = ys.length % 2 ? ys[(ys.length - 1) / 2] : (ys[ys.length / 2 - 1] + ys[ys.length / 2]) / 2;
        return { x: x, y: Math.round(m) };
    });
}

function pixelXToWavenumber(x, xMin, xMax, startW, endW, splitPixelX, splitW) {
    var total = xMax - xMin;
    if (!total) return startW;

    if (splitPixelX === null || splitPixelX === undefined || splitPixelX <= xMin + 1 || splitPixelX >= xMax - 1) {
        var ratio = (x - xMin) / total;
        return startW > endW ? startW - ratio * (startW - endW) : startW + ratio * (endW - startW);
    }

    var sx = Math.min(Math.max(splitPixelX, xMin), xMax);
    if (x <= sx) {
        var leftLen = sx - xMin;
        var ratio = (x - xMin) / (leftLen || 1);
        return startW > splitW ? startW - ratio * (startW - splitW) : startW + ratio * (splitW - startW);
    } else {
        var rightLen = xMax - sx;
        var ratio = (x - sx) / (rightLen || 1);
        return splitW > endW ? splitW - ratio * (splitW - endW) : splitW + ratio * (endW - splitW);
    }
}

function convertPixelsToSpectral(points, cropCoords, spectrumParams) {
    var spectral = [];
    if (!points || !cropCoords || !spectrumParams) return spectral;

    var thin = thinPointsByX(points);
    if (!thin.length) return spectral;

    var xs = thin.map(function(p) { return parseFloat(p.x || 0); });
    var ys = thin.map(function(p) { return parseFloat(p.y || 0); });
    var axisXMin = Math.min.apply(null, xs);
    var axisXMax = Math.max.apply(null, xs);
    var axisYMin = Math.min.apply(null, ys);
    var axisYMax = Math.max.apply(null, ys);

    var startW = parseFloat(spectrumParams.start_wavenum || 4000);
    var endW = parseFloat(spectrumParams.end_wavenum || 500);
    var splitW = parseFloat(spectrumParams.split_wavenum || 2000);
    var splitPixelX = spectrumParams.split_pixel_x === null || spectrumParams.split_pixel_x === undefined
        ? null
        : parseFloat(spectrumParams.split_pixel_x);
    if (splitPixelX !== null && !isFinite(splitPixelX)) {
        splitPixelX = null;
    }
    var axisLeftPixelX = spectrumParams.axis_left_pixel_x === null || spectrumParams.axis_left_pixel_x === undefined
        ? null
        : parseFloat(spectrumParams.axis_left_pixel_x);
    var axisRightPixelX = spectrumParams.axis_right_pixel_x === null || spectrumParams.axis_right_pixel_x === undefined
        ? null
        : parseFloat(spectrumParams.axis_right_pixel_x);
    var useManualAxisCalibration = Boolean(spectrumParams.use_manual_axis_calibration);

    // 手动校准优先覆盖默认自动跨度。
    if (useManualAxisCalibration && isFinite(axisLeftPixelX) && isFinite(axisRightPixelX) && axisRightPixelX > axisLeftPixelX) {
        axisXMin = axisLeftPixelX;
        axisXMax = axisRightPixelX;
    }

    var dataType = spectrumParams.data_type || 'absorbance';
    var yMaxVal = dataType === 'absorbance' ? 1.0 : 100.0;
    var yMinVal = 0.0;
    var yRange = (axisYMax - axisYMin) !== 0 ? (axisYMax - axisYMin) : 1.0;

    thin.forEach(function(p) {
        var x = parseFloat(p.x || 0);
        var y = parseFloat(p.y || 0);
        var wavenum = pixelXToWavenumber(x, axisXMin, axisXMax, startW, endW, splitPixelX, splitW);
        var yRatio = (axisYMax - y) / yRange;
        var value = yMinVal + (yRatio * (yMaxVal - yMinVal));

        spectral.push({
            wavenumber: Math.round(wavenum * 10000) / 10000,
            value: Math.round(value * 10000) / 10000
        });
    });

    var uniq = {};
    spectral.forEach(function(row) {
        var key = String(row.wavenumber);
        if (!uniq[key]) uniq[key] = [];
        uniq[key].push(row.value);
    });

    var dedup = Object.keys(uniq).map(Number).sort(function(a, b) { return b - a; }).map(function(w) {
        var arr = uniq[String(w)];
        var avg = arr.reduce(function(s, v) { return s + v; }, 0) / arr.length;
        return { wavenumber: w, value: Math.round(avg * 10000) / 10000 };
    });

    return dedup;
}

function getCurrentSpectrumParamsFromUI() {
    var yParams = getSpectrumYParams();
    var splitParams = getSplitParams();
    var axisParams = getAxisParams();
    return {
        start_wavenum: parseFloat(document.getElementById('startWavenum').value),
        end_wavenum: parseFloat(document.getElementById('endWavenum').value),
        data_type: yParams.data_type,
        y_max: yParams.y_max,
        y_min: yParams.y_min,
        split_wavenum: splitParams.split_wavenum,
        split_pixel_x: splitParams.split_pixel_x,
        axis_left_pixel_x: axisParams.axis_left_pixel_x,
        axis_right_pixel_x: axisParams.axis_right_pixel_x,
        use_manual_axis_calibration: axisParams.use_manual_axis_calibration
    };
}

function initBackgroundCanvas() {
    bgCanvas = document.getElementById('bgCanvas');
    if (!bgCanvas) return;
    bgCtx = bgCanvas.getContext('2d');

    var img = new Image();
    img.onload = function() {
        var maxWidth = 760;
        bgScale = Math.min(1, maxWidth / img.width);
        bgCanvas.width = img.width * bgScale;
        bgCanvas.height = img.height * bgScale;
        backgroundBoxes = [];
        drawBackgroundCanvas();
        setupBackgroundEvents();
        updateBgBoxesInfo();
    };
    img.src = croppedImage;
}

function drawBackgroundCanvas(previewBox) {
    previewBox = previewBox === undefined ? null : previewBox;
    if (!bgCtx || !bgCanvas || !croppedImage) return;
    var img = new Image();
    img.onload = function() {
        bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
        bgCtx.drawImage(img, 0, 0, bgCanvas.width, bgCanvas.height);

        var bgMode = (document.getElementById('bgProcessingMode') ? document.getElementById('bgProcessingMode').value : '') || 'color';
        if (bgMode === 'grayscale') {
            var previewFrame = bgCtx.getImageData(0, 0, bgCanvas.width, bgCanvas.height);
            previewFrame = convertImageDataToGrayscale(previewFrame);
            bgCtx.putImageData(previewFrame, 0, 0);
        }

        var all = previewBox ? backgroundBoxes.concat([previewBox]) : backgroundBoxes;
        all.forEach(function(b, idx) {
            bgCtx.save();
            bgCtx.strokeStyle = 'rgba(34,211,238,0.95)';
            bgCtx.lineWidth = 2;
            bgCtx.setLineDash([6, 4]);
            bgCtx.strokeRect(b.x * bgScale, b.y * bgScale, b.width * bgScale, b.height * bgScale);
            bgCtx.setLineDash([]);
            bgCtx.fillStyle = 'rgba(34,211,238,0.12)';
            bgCtx.fillRect(b.x * bgScale, b.y * bgScale, b.width * bgScale, b.height * bgScale);
            bgCtx.fillStyle = GLM51_COLORS.accent;
            bgCtx.fillText(String(idx + 1), b.x * bgScale + 4, b.y * bgScale + 14);
            bgCtx.restore();
        });
    };
    img.src = croppedImage;
}

function setupBackgroundEvents() {
    if (!bgCanvas) return;
    bgCanvas.onmousedown = function(e) {
        var rect = bgCanvas.getBoundingClientRect();
        var x = (e.clientX - rect.left) * (bgCanvas.width / rect.width) / bgScale;
        var y = (e.clientY - rect.top) * (bgCanvas.height / rect.height) / bgScale;
        isDraggingBgBox = true;
    bgStart = { x: x, y: y };
    };

    bgCanvas.onmousemove = function(e) {
        if (!isDraggingBgBox || !bgStart) return;
        var rect = bgCanvas.getBoundingClientRect();
        var x = (e.clientX - rect.left) * (bgCanvas.width / rect.width) / bgScale;
        var y = (e.clientY - rect.top) * (bgCanvas.height / rect.height) / bgScale;
        var box = {
            x: Math.min(bgStart.x, x),
            y: Math.min(bgStart.y, y),
            width: Math.max(1, Math.abs(x - bgStart.x)),
            height: Math.max(1, Math.abs(y - bgStart.y))
        };
        drawBackgroundCanvas(box);
    };

    bgCanvas.onmouseup = function(e) {
        if (!isDraggingBgBox || !bgStart) return;
        var rect = bgCanvas.getBoundingClientRect();
        var x = (e.clientX - rect.left) * (bgCanvas.width / rect.width) / bgScale;
        var y = (e.clientY - rect.top) * (bgCanvas.height / rect.height) / bgScale;
        var box = {
            x: Math.min(bgStart.x, x),
            y: Math.min(bgStart.y, y),
            width: Math.max(1, Math.abs(x - bgStart.x)),
            height: Math.max(1, Math.abs(y - bgStart.y))
        };
        if (box.width >= 3 && box.height >= 3) {
            backgroundBoxes.push(box);
        }
        isDraggingBgBox = false;
        bgStart = null;
        drawBackgroundCanvas();
        updateBgBoxesInfo();
    };

    bgCanvas.onmouseleave = function() {
        isDraggingBgBox = false;
        bgStart = null;
    };
}

function updateBgBoxesInfo() {
    var el = document.getElementById('bgBoxesInfo');
    if (!el) return;
    el.textContent = advancedFormat('backgroundBoxesLabel', { count: backgroundBoxes.length }, 'Boxes: ' + backgroundBoxes.length);
}

function clearBackgroundBoxes() {
    backgroundBoxes = [];
    drawBackgroundCanvas();
    updateBgBoxesInfo();
}

function applyBackgroundRemovalToImageData(imageData, boxes, threshold) {
    var d = imageData.data;
    var w = imageData.width;
    var h = imageData.height;
    if (!boxes.length) return imageData;

    var minR = 255, minG = 255, minB = 255;
    var maxR = 0, maxG = 0, maxB = 0;
    var sampled = 0;

    boxes.forEach(function(b) {
        var x0 = Math.max(0, Math.floor(b.x));
        var y0 = Math.max(0, Math.floor(b.y));
        var x1 = Math.min(w, Math.floor(b.x + b.width));
        var y1 = Math.min(h, Math.floor(b.y + b.height));
        for (var yy = y0; yy < y1; yy++) {
            for (var xx = x0; xx < x1; xx++) {
                var idx = (yy * w + xx) * 4;
                var r = d[idx], g = d[idx + 1], bval = d[idx + 2];
                if (r < minR) minR = r; if (r > maxR) maxR = r;
                if (g < minG) minG = g; if (g > maxG) maxG = g;
                if (bval < minB) minB = bval; if (bval > maxB) maxB = bval;
                sampled++;
            }
        }
    });

    if (!sampled) return imageData;

    var loR = Math.max(0, minR - threshold);
    var hiR = Math.min(255, maxR + threshold);
    var loG = Math.max(0, minG - threshold);
    var hiG = Math.min(255, maxG + threshold);
    var loB = Math.max(0, minB - threshold);
    var hiB = Math.min(255, maxB + threshold);

    for (var i = 0; i < d.length; i += 4) {
        var r = d[i], g = d[i + 1], bval = d[i + 2];
        if (r >= loR && r <= hiR && g >= loG && g <= hiG && bval >= loB && bval <= hiB) {
            d[i] = 255;
            d[i + 1] = 255;
            d[i + 2] = 255;
        }
    }
    return imageData;
}

function applyBackgroundAndContinue() {
    if (!croppedImage) return;

    var threshold = parseInt((document.getElementById('bgThreshold') ? document.getElementById('bgThreshold').value : '') || '35', 10);
    var img = new Image();
    img.onload = function() {
        var temp = document.createElement('canvas');
        temp.width = img.width;
        temp.height = img.height;
        var tctx = temp.getContext('2d');
        tctx.drawImage(img, 0, 0, temp.width, temp.height);

        var frame = tctx.getImageData(0, 0, temp.width, temp.height);
        if (backgroundBoxes.length) {
            frame = applyBackgroundRemovalToImageData(frame, backgroundBoxes, threshold);
        }

        var bgMode = (document.getElementById('bgProcessingMode') ? document.getElementById('bgProcessingMode').value : '') || 'color';
        if (bgMode === 'grayscale') {
            frame = convertImageDataToGrayscale(frame);
        }

        tctx.putImageData(frame, 0, 0);
        croppedImage = temp.toDataURL('image/jpeg', 0.95);

        var currentUiSpectrumParams = getCurrentSpectrumParamsFromUI();
        var spectrumParams = {
            image_data: croppedImage,
            crop_coords: cropCoords,
            start_wavenum: currentUiSpectrumParams.start_wavenum || 4000,
            end_wavenum: currentUiSpectrumParams.end_wavenum || 400,
            data_type: currentUiSpectrumParams.data_type,
            y_max: currentUiSpectrumParams.y_max,
            y_min: currentUiSpectrumParams.y_min,
            split_wavenum: currentUiSpectrumParams.split_wavenum,
            split_pixel_x: currentUiSpectrumParams.split_pixel_x,
            axis_left_pixel_x: currentUiSpectrumParams.axis_left_pixel_x,
            axis_right_pixel_x: currentUiSpectrumParams.axis_right_pixel_x,
            use_manual_axis_calibration: currentUiSpectrumParams.use_manual_axis_calibration
        };

        showLoading(true, advancedText('loadingApplyingBackgroundRemoval'));
        xhrJSON('/spectrum/crop/', spectrumParams, function(data) {
            if (!data.success) {
                if (data.error) {
                    logClientRequestError('advanced upload background removal business failure', data.error);
                }
                alert(userErrorMessage(data.error, 'saveProcessedImageFailed'));
                showLoading(false);
                return;
            }
            updateStepIndicator(4);
            initExtractCanvas();
            showLoading(false);
        }, function(error) {
            logClientRequestError('advanced upload background removal failed', error);
            alert(userErrorMessage(error.message, 'saveProcessedImageFailed'));
            showLoading(false);
        });
    };
    img.src = croppedImage;
}

function redrawExtractBase() {
    if (!extractCtx || !extractCanvas || !croppedImage) return;
    var img = new Image();
    img.onload = function() {
        cachedExtractImg = img;
        resetEditableExtractImage(img);
        applyCanvasDisplayModeFromImage(img);
        if (currentCurvePoints && currentCurvePoints.length) {
            drawCurveOnExtractCanvas(currentCurvePoints);
        }
    };
    img.src = croppedImage;
}

function drawCurveOnExtractCanvas(points, isAuto) {
    isAuto = isAuto || false;
    if (!extractCtx || !points || !points.length) return;
    var sorted = points.slice().sort(function(a, b) { return a.x - b.x; });
    extractCtx.strokeStyle = isAuto ? GLM51_COLORS.accentStrong : GLM51_COLORS.accent;
    extractCtx.lineWidth = 2;
    extractCtx.beginPath();
    sorted.forEach(function(p, i) {
        var displayX = (p.x - (cropCoords.x || 0)) * extractScale;
        var displayY = (p.y - (cropCoords.y || 0)) * extractScale;
        if (i === 0) extractCtx.moveTo(displayX, displayY);
        else extractCtx.lineTo(displayX, displayY);
    });
    extractCtx.stroke();
}

function toggleEraserMode() {
    eraserMode = !eraserMode;
    var btn = document.getElementById('btn-eraser');
    var eraserTextSpan = document.getElementById('eraser-text');
    if (!btn || !eraserTextSpan) return;
    eraserTextSpan.textContent = eraserMode ? advancedText('eraserOn') : advancedText('eraserOff');
    btn.style.background = eraserMode ? 'rgba(14,165,233,0.22)' : 'rgba(30,45,61,0.6)';
    btn.style.color = eraserMode ? GLM51_COLORS.accent : GLM51_COLORS.muted;
    if (extractCanvas) extractCanvas.style.cursor = 'crosshair';
}

function persistErasedCroppedImageToSession() {
    if (!croppedImage || !cropCoords) return;
    var currentUiSpectrumParams = getCurrentSpectrumParamsFromUI();
    var payload = {
        image_data: croppedImage,
        crop_coords: cropCoords,
        start_wavenum: currentUiSpectrumParams.start_wavenum || 4000,
        end_wavenum: currentUiSpectrumParams.end_wavenum || 400,
        data_type: currentUiSpectrumParams.data_type,
        y_max: currentUiSpectrumParams.y_max,
        y_min: currentUiSpectrumParams.y_min,
        split_wavenum: currentUiSpectrumParams.split_wavenum,
        split_pixel_x: currentUiSpectrumParams.split_pixel_x,
        axis_left_pixel_x: currentUiSpectrumParams.axis_left_pixel_x,
        axis_right_pixel_x: currentUiSpectrumParams.axis_right_pixel_x,
        use_manual_axis_calibration: currentUiSpectrumParams.use_manual_axis_calibration
    };

    xhrJSON('/spectrum/crop/', payload, function(data) {
        if (!data.success && data.error) {
            logClientRequestError('advanced upload eraser session save business failure', data.error);
        }
    }, function(error) {
        logClientRequestError('advanced upload eraser session save failed', error);
    });
}

function finishEraseStroke() {
    if (!eraserImageDirty || !editableExtractCanvas) return;
    croppedImage = editableExtractCanvas.toDataURL(ERASER_IMAGE_EXPORT_TYPE, ERASER_IMAGE_EXPORT_QUALITY);
    eraserImageDirty = false;
    persistErasedCroppedImageToSession();
}

function paintImageAtDisplayPos(dx, dy) {
    if (!editableExtractCtx || !editableExtractCanvas) return;
    var radius = eraserSize || 12;
    var localX = dx / extractScale;
    var localY = dy / extractScale;
    var localRadius = radius / extractScale;

    editableExtractCtx.save();
    editableExtractCtx.beginPath();
    editableExtractCtx.arc(localX, localY, localRadius, 0, Math.PI * 2);
    editableExtractCtx.fillStyle = eraserFillStyleFor(localX, localY, localRadius);
    editableExtractCtx.fill();
    editableExtractCtx.restore();
    eraserImageDirty = true;
}

function eraseImageAndPointsAtDisplayPos(dx, dy) {
    paintImageAtDisplayPos(dx, dy);

    var cx = (cropCoords.x || 0) + (dx / extractScale);
    var cy = (cropCoords.y || 0) + (dy / extractScale);
    var radius = eraserSize || 12;
    var r2 = (radius / extractScale) * (radius / extractScale);
    if (currentCurvePoints && currentCurvePoints.length) {
        currentCurvePoints = currentCurvePoints.filter(function(p) {
            var dpx = p.x - cx;
            var dpy = p.y - cy;
            return (dpx*dpx + dpy*dpy) > r2;
        });
    }
    maybeAutoFitAxisGuidesToCurve(currentCurvePoints);
    resetPeakCorrectionState({ keepInputs: true });
    lastSpectralData = convertPixelsToSpectral(currentCurvePoints, cropCoords, getCurrentSpectrumParamsFromUI());
    
    if (currentWavenumOffset !== 0 && lastSpectralData) {
        lastSpectralData = lastSpectralData.map(function(p) {
            return {
                wavenumber: Math.round((p.wavenumber + currentWavenumOffset) * 10000) / 10000,
                value: p.value
            };
        });
    }

    redrawExtractWithVisualOffset(currentWavenumOffset, getCurrentSpectrumParamsFromUI());
    if (lastSpectralData && lastSpectralData.length) drawPreviewChart(lastSpectralData);
}

function resetAllErases() {
    if (!pristineCurvePoints || !pristineCurvePoints.length) return;
    currentCurvePoints = pristineCurvePoints.map(function(p) { return {x: p.x, y: p.y}; });
    maybeAutoFitAxisGuidesToCurve(currentCurvePoints);
    resetPeakCorrectionState({ keepInputs: true });
    lastSpectralData = convertPixelsToSpectral(currentCurvePoints, cropCoords, getCurrentSpectrumParamsFromUI());

    if (currentWavenumOffset !== 0 && lastSpectralData) {
        lastSpectralData = lastSpectralData.map(function(p) {
            return {
                wavenumber: Math.round((p.wavenumber + currentWavenumOffset) * 10000) / 10000,
                value: p.value
            };
        });
    }

    var redrawAfterReset = function() {
        redrawExtractWithVisualOffset(currentWavenumOffset, getCurrentSpectrumParamsFromUI());
        if (lastSpectralData && lastSpectralData.length) drawPreviewChart(lastSpectralData);
    };

    if (pristineCroppedImageForErase) {
        croppedImage = pristineCroppedImageForErase;
        eraserImageDirty = false;
        var img = new Image();
        img.onload = function() {
            cachedExtractImg = img;
            resetEditableExtractImage(img);
            redrawAfterReset();
            persistErasedCroppedImageToSession();
        };
        img.src = croppedImage;
    } else {
        redrawAfterReset();
    }
}

function updateStepIndicator(step) {
    currentStep = step;
    document.querySelectorAll('.ft-advanced-step').forEach(function(item, index) {
        item.classList.toggle('is-current', index + 1 === step);
        item.classList.toggle('is-complete', index + 1 < step);
    });

    if (step === 1) {
        document.getElementById('step-upload').style.border = '2px solid ' + (GLM51_COLORS.accent) + '';
    } else if (step > 1) {
        document.getElementById('step-upload').style.border = '1px solid ' + (GLM51_COLORS.accentStrong) + '';
        document.getElementById('step-upload').style.opacity = '0.7';
    }

    if (step === 2) {
        document.getElementById('step-crop').style.display = 'block';
        document.getElementById('step2-number').style.background = GLM51_COLORS.accent;
        document.getElementById('step2-number').style.color = GLM51_COLORS.bg;
        document.getElementById('step2-title').style.color = GLM51_COLORS.accent;
    } else if (step > 2) {
        document.getElementById('step2-number').style.background = GLM51_COLORS.accentStrong;
        document.getElementById('step2-number').style.color = GLM51_COLORS.text;
        document.getElementById('step2-title').style.color = GLM51_COLORS.accentStrong;
        document.getElementById('step2-title').textContent = advancedText('step2CompleteTitle');
    }

    if (step === 3) {
        document.getElementById('step-background').style.display = 'block';
        document.getElementById('step3-number').style.background = GLM51_COLORS.accent;
        document.getElementById('step3-number').style.color = GLM51_COLORS.bg;
        document.getElementById('step3-title').style.color = GLM51_COLORS.accent;
    } else if (step > 3) {
        document.getElementById('step-background').style.display = 'block';
        document.getElementById('step3-number').style.background = GLM51_COLORS.accentStrong;
        document.getElementById('step3-number').style.color = GLM51_COLORS.text;
        document.getElementById('step3-title').style.color = GLM51_COLORS.accentStrong;
        document.getElementById('step3-title').textContent = advancedText('step3CompleteTitle');
    }

    if (step === 4) {
        document.getElementById('step-extract').style.display = 'block';
        document.getElementById('step4-number').style.background = GLM51_COLORS.accent;
        document.getElementById('step4-number').style.color = GLM51_COLORS.bg;
        document.getElementById('step4-title').style.color = GLM51_COLORS.accent;
    }
}

document.getElementById('uploadForm').addEventListener('submit', function(e) {
    e.preventDefault();
    var formData = new FormData(e.target);
    showLoading(true, advancedText('uploading'));
    xhrForm('/spectrum/upload-image/', formData, function(data) {
        if (data.success) {
            setUploadedFilenameState(data.original_filename, data.download_filename);
            originalImage = new Image();
            originalImage.onload = function() {
                initCropCanvas();
                updateStepIndicator(2);
                showLoading(false);
            };
            originalImage.src = data.image_data;
        } else {
            if (data.error) {
                logClientRequestError('advanced upload image upload business failure', data.error);
            }
            alert(userErrorMessage(data.error, 'uploadFailed'));
            showLoading(false);
        }
    }, function(error) {
        logClientRequestError('advanced upload image upload failed', error);
        alert(userErrorMessage(error.message, 'uploadFailed'));
        showLoading(false);
    });
});

var cropCanvas, cropCtx;
var cropBox = {x: 50, y: 50, w: 200, h: 150};
var isDraggingCrop = false;
var isResizingCrop = false;
var cropDragCorner = null;

function initCropCanvas() {
    cropCanvas = document.getElementById('mainCanvas');
    cropCtx = cropCanvas.getContext('2d');

    var maxWidth = 800;
    var scale = Math.min(1, maxWidth / originalImage.width);
    cropCanvas.width = originalImage.width * scale;
    cropCanvas.height = originalImage.height * scale;

    cropBox = {
        x: cropCanvas.width * 0.1,
        y: cropCanvas.height * 0.1,
        w: cropCanvas.width * 0.8,
        h: cropCanvas.height * 0.8
    };

    splitLineDisplayX = cropBox.x + cropBox.w * 0.5;
    currentSplitRatio = 0.5;
    currentAxisLeftRatio = 0.0;
    currentAxisRightRatio = 1.0;
    splitGuideTouched = false;
    axisGuidesTouched = false;
    syncAxisGuidesToCropBox();
    drawCropCanvas();
    setupCropEvents();
}

function drawCropCanvas() {
    cropCtx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
    cropCtx.drawImage(originalImage, 0, 0, cropCanvas.width, cropCanvas.height);

    cropCtx.fillStyle = 'rgba(0,0,0,0.6)';
    cropCtx.fillRect(0, 0, cropCanvas.width, cropBox.y);
    cropCtx.fillRect(0, cropBox.y, cropBox.x, cropBox.h);
    cropCtx.fillRect(cropBox.x + cropBox.w, cropBox.y, cropCanvas.width - cropBox.x - cropBox.w, cropBox.h);
    cropCtx.fillRect(0, cropBox.y + cropBox.h, cropCanvas.width, cropCanvas.height - cropBox.y - cropBox.h);

    cropCtx.strokeStyle = GLM51_COLORS.accent;
    cropCtx.lineWidth = 3;
    cropCtx.setLineDash([8, 4]);
    cropCtx.strokeRect(cropBox.x, cropBox.y, cropBox.w, cropBox.h);
    cropCtx.setLineDash([]);

    // full-image boundary guides for crop box
    cropCtx.save();
    cropCtx.setLineDash([4, 4]);
    cropCtx.strokeStyle = 'rgba(34,211,238,0.55)';
    cropCtx.lineWidth = 1;
    cropCtx.beginPath();
    cropCtx.moveTo(cropBox.x, 0);
    cropCtx.lineTo(cropBox.x, cropCanvas.height);
    cropCtx.moveTo(cropBox.x + cropBox.w, 0);
    cropCtx.lineTo(cropBox.x + cropBox.w, cropCanvas.height);
    cropCtx.moveTo(0, cropBox.y);
    cropCtx.lineTo(cropCanvas.width, cropBox.y);
    cropCtx.moveTo(0, cropBox.y + cropBox.h);
    cropCtx.lineTo(cropCanvas.width, cropBox.y + cropBox.h);
    cropCtx.stroke();
    cropCtx.restore();

    syncAxisGuidesToCropBox();
    axisLeftDisplayX = Math.max(cropBox.x, Math.min(cropBox.x + cropBox.w, axisLeftDisplayX));
    axisRightDisplayX = Math.max(axisLeftDisplayX, Math.min(cropBox.x + cropBox.w, axisRightDisplayX));
    cropCtx.save();
    cropCtx.setLineDash([4, 3]);
    cropCtx.lineWidth = 2;
    cropCtx.strokeStyle = 'rgba(34,197,94,0.95)';
    cropCtx.beginPath();
    cropCtx.moveTo(axisLeftDisplayX, cropBox.y);
    cropCtx.lineTo(axisLeftDisplayX, cropBox.y + cropBox.h);
    cropCtx.stroke();
    cropCtx.strokeStyle = 'rgba(249,115,22,0.95)';
    cropCtx.beginPath();
    cropCtx.moveTo(axisRightDisplayX, cropBox.y);
    cropCtx.lineTo(axisRightDisplayX, cropBox.y + cropBox.h);
    cropCtx.stroke();
    cropCtx.setLineDash([]);
    cropCtx.fillStyle = 'rgba(34,197,94,0.95)';
    cropCtx.font = '12px sans-serif';
    cropCtx.fillText('START', axisLeftDisplayX + 4, cropBox.y + 14);
    cropCtx.fillStyle = 'rgba(249,115,22,0.95)';
    cropCtx.fillText('END', axisRightDisplayX + 4, cropBox.y + 28);
    cropCtx.restore();

    if (isSplitWavenumEnabled() && isFinite(splitLineDisplayX)) {
        var sx = Math.max(cropBox.x, Math.min(cropBox.x + cropBox.w, splitLineDisplayX));
        splitLineDisplayX = sx;
        updateSplitPixelInput();
        cropCtx.save();
        cropCtx.setLineDash([6, 4]);
        cropCtx.strokeStyle = 'rgba(14,165,233,0.95)';
        cropCtx.lineWidth = 2;
        cropCtx.beginPath();
        cropCtx.moveTo(sx, 0);
        cropCtx.lineTo(sx, cropCanvas.height);
        cropCtx.stroke();
        cropCtx.setLineDash([]);
        cropCtx.fillStyle = GLM51_COLORS.accentStrong;
        cropCtx.font = '12px sans-serif';
        cropCtx.fillText('2000', sx + 4, Math.max(12, cropBox.y - 6));
        cropCtx.restore();
    }
}

function setupCropEvents() {
    var startX, startY;

    cropCanvas.addEventListener('mousedown', function(e) {
        var rect = cropCanvas.getBoundingClientRect();
        var scaleX = cropCanvas.width / rect.width;
        var scaleY = cropCanvas.height / rect.height;
        var x = (e.clientX - rect.left) * scaleX;
        var y = (e.clientY - rect.top) * scaleY;

        startX = x;
        startY = y;

        var handleSize = 15;

        if (Math.abs(x - cropBox.x) < handleSize && Math.abs(y - cropBox.y) < handleSize) {
            isResizingCrop = true;
            cropDragCorner = 'tl';
        } else if (Math.abs(x - (cropBox.x + cropBox.w)) < handleSize && Math.abs(y - cropBox.y) < handleSize) {
            isResizingCrop = true;
            cropDragCorner = 'tr';
        } else if (Math.abs(x - cropBox.x) < handleSize && Math.abs(y - (cropBox.y + cropBox.h)) < handleSize) {
            isResizingCrop = true;
            cropDragCorner = 'bl';
        } else if (Math.abs(x - (cropBox.x + cropBox.w)) < handleSize && Math.abs(y - (cropBox.y + cropBox.h)) < handleSize) {
            isResizingCrop = true;
            cropDragCorner = 'br';
        } else if (isSplitWavenumEnabled() && Math.abs(x - splitLineDisplayX) < 10 && y >= cropBox.y && y <= cropBox.y + cropBox.h) {
            isDraggingSplitLine = true;
        } else if (Math.abs(x - axisLeftDisplayX) < 10 && y >= cropBox.y && y <= cropBox.y + cropBox.h) {
            isDraggingAxisGuide = 'left';
        } else if (Math.abs(x - axisRightDisplayX) < 10 && y >= cropBox.y && y <= cropBox.y + cropBox.h) {
            isDraggingAxisGuide = 'right';
        } else if (x >= cropBox.x && x <= cropBox.x + cropBox.w && y >= cropBox.y && y <= cropBox.y + cropBox.h) {
            isDraggingCrop = true;
        }
    });

    cropCanvas.addEventListener('mousemove', function(e) {
        var rect = cropCanvas.getBoundingClientRect();
        var scaleX = cropCanvas.width / rect.width;
        var scaleY = cropCanvas.height / rect.height;
        var x = (e.clientX - rect.left) * scaleX;
        var y = (e.clientY - rect.top) * scaleY;

        if (!isDraggingCrop && !isResizingCrop && !isDraggingSplitLine && !isDraggingAxisGuide) return;

        var dx = x - startX;
        var dy = y - startY;

        if (isDraggingSplitLine) {
            splitLineDisplayX = Math.max(cropBox.x, Math.min(cropBox.x + cropBox.w, x));
            currentSplitRatio = (splitLineDisplayX - cropBox.x) / cropBox.w;
            splitGuideTouched = true;
            updateSplitPixelInput();
            drawCropCanvas();
        } else if (isDraggingAxisGuide === 'left') {
            axisLeftDisplayX = Math.max(cropBox.x, Math.min(axisRightDisplayX - 20, x));
            currentAxisLeftRatio = (axisLeftDisplayX - cropBox.x) / cropBox.w;
            axisGuidesTouched = true;
            updateAxisPixelInputs();
            drawCropCanvas();
        } else if (isDraggingAxisGuide === 'right') {
            axisRightDisplayX = Math.max(axisLeftDisplayX + 20, Math.min(cropBox.x + cropBox.w, x));
            currentAxisRightRatio = (axisRightDisplayX - cropBox.x) / cropBox.w;
            axisGuidesTouched = true;
            updateAxisPixelInputs();
            drawCropCanvas();
        } else if (isDraggingCrop) {
            cropBox.x = Math.max(0, Math.min(cropCanvas.width - cropBox.w, cropBox.x + dx));
            cropBox.y = Math.max(0, Math.min(cropCanvas.height - cropBox.h, cropBox.y + dy));
            splitLineDisplayX = cropBox.x + currentSplitRatio * cropBox.w;
            syncAxisGuidesToCropBox();
            startX = x;
            startY = y;
            drawCropCanvas();
        } else if (isResizingCrop) {
            var minSize = 50;
            switch(cropDragCorner) {
                case 'br':
                    cropBox.w = Math.max(minSize, Math.min(cropCanvas.width - cropBox.x, cropBox.w + dx));
                    cropBox.h = Math.max(minSize, Math.min(cropCanvas.height - cropBox.y, cropBox.h + dy));
                    break;
                case 'tr':
                    cropBox.w = Math.max(minSize, Math.min(cropCanvas.width - cropBox.x, cropBox.w + dx));
                    var newY = Math.max(0, cropBox.y + dy);
                    cropBox.h = Math.max(minSize, cropBox.h + (cropBox.y - newY));
                    cropBox.y = newY;
                    break;
                case 'bl':
                    var newX = Math.max(0, cropBox.x + dx);
                    cropBox.w = Math.max(minSize, cropBox.w + (cropBox.x - newX));
                    cropBox.x = newX;
                    cropBox.h = Math.max(minSize, Math.min(cropCanvas.height - cropBox.y, cropBox.h + dy));
                    break;
                case 'tl':
                    var newX2 = Math.max(0, cropBox.x + dx);
                    var newY2 = Math.max(0, cropBox.y + dy);
                    cropBox.w = Math.max(minSize, cropBox.w + (cropBox.x - newX2));
                    cropBox.h = Math.max(minSize, cropBox.h + (cropBox.y - newY2));
                    cropBox.x = newX2;
                    cropBox.y = newY2;
                    break;
            }
            splitLineDisplayX = cropBox.x + currentSplitRatio * cropBox.w;
            syncAxisGuidesToCropBox();
            startX = x;
            startY = y;
            drawCropCanvas();
        }
    });

    cropCanvas.addEventListener('mouseup', function() {
        var shouldRecalculate = isDraggingSplitLine || Boolean(isDraggingAxisGuide);
        isDraggingCrop = false;
        isResizingCrop = false;
        isDraggingSplitLine = false;
        isDraggingAxisGuide = null;
        cropDragCorner = null;
        if (shouldRecalculate) {
            recalculateCurrentSpectralDataFromUI();
        }
    });
    cropCanvas.addEventListener('mouseleave', function() {
        var shouldRecalculate = isDraggingSplitLine || Boolean(isDraggingAxisGuide);
        isDraggingCrop = false;
        isResizingCrop = false;
        isDraggingSplitLine = false;
        isDraggingAxisGuide = null;
        cropDragCorner = null;
        if (shouldRecalculate) {
            recalculateCurrentSpectralDataFromUI();
        }
    });
}

function resetCrop() {
    cropBox = { x: cropCanvas.width * 0.1, y: cropCanvas.height * 0.1, w: cropCanvas.width * 0.8, h: cropCanvas.height * 0.8 };
    splitLineDisplayX = cropBox.x + cropBox.w * 0.5;
    currentSplitRatio = 0.5;
    currentAxisLeftRatio = 0.0;
    currentAxisRightRatio = 1.0;
    splitGuideTouched = false;
    axisGuidesTouched = false;
    syncAxisGuidesToCropBox();
    drawCropCanvas();
}

function applyCrop() {
    var scaleX = cropCanvas.width > 0 ? originalImage.width / cropCanvas.width : 1;
    var scaleY = cropCanvas.height > 0 ? originalImage.height / cropCanvas.height : 1;

    var originalCropX = Math.round(Number(cropBox.x) * scaleX) || 0;
    var originalCropY = Math.round(Number(cropBox.y) * scaleY) || 0;
    var originalCropW = Math.round(Number(cropBox.w) * scaleX) || 200;
    var originalCropH = Math.round(Number(cropBox.h) * scaleY) || 150;

    var originalSplitX = Math.round((cropBox.x + currentSplitRatio * cropBox.w) * scaleX) || 0;
    var originalAxisLeftX = axisLeftDisplayX !== null ? (axisLeftDisplayX * scaleX) : originalCropX;
    var originalAxisRightX = axisRightDisplayX !== null ? (axisRightDisplayX * scaleX) : (originalCropX + originalCropW - 1);
    var splitRatio = currentSplitRatio;

    var tempCanvas = document.createElement('canvas');
    tempCanvas.width = originalCropW;
    tempCanvas.height = originalCropH;
    var tempCtx = tempCanvas.getContext('2d');

    tempCtx.drawImage(originalImage, originalCropX, originalCropY, originalCropW, originalCropH, 0, 0, originalCropW, originalCropH);

    croppedImage = tempCanvas.toDataURL('image/jpeg', 0.9);

    cropCoords = {
        x: originalCropX,
        y: originalCropY,
        width: originalCropW,
        height: originalCropH,
        displayX: Number(cropBox.x) || 0,
        displayY: Number(cropBox.y) || 0,
        displayW: Number(cropBox.w) || 200,
        displayH: Number(cropBox.h) || 150,
        split_pixel_x: originalSplitX,
        split_pixel_ratio: Math.max(0, Math.min(1, isFinite(splitRatio) ? splitRatio : 0.5)),
        axis_left_pixel_x: originalAxisLeftX,
        axis_right_pixel_x: originalAxisRightX,
        use_manual_axis_calibration: axisGuidesTouched
    };

    updateSplitPixelInput();

    var yParams = getSpectrumYParams();
    var splitParams = getSplitParams();
    var axisParams = getAxisParams();
    var spectrumParams = {
        image_data: croppedImage,
        crop_coords: cropCoords,
        start_wavenum: parseFloat(document.getElementById('startWavenum').value) || 4000,
        end_wavenum: parseFloat(document.getElementById('endWavenum').value) || 400,
        data_type: yParams.data_type,
        y_max: yParams.y_max,
        y_min: yParams.y_min,
        split_wavenum: splitParams.split_wavenum,
        split_pixel_x: splitParams.split_pixel_x,
        axis_left_pixel_x: axisParams.axis_left_pixel_x,
        axis_right_pixel_x: axisParams.axis_right_pixel_x,
        use_manual_axis_calibration: axisParams.use_manual_axis_calibration
    };

    showLoading(true, advancedText('saving'));
    xhrJSON('/spectrum/crop/', spectrumParams, function(data) {
        if (data.success) {
            updateStepIndicator(3);
            initBackgroundCanvas();
            showLoading(false);
        } else {
            if (data.error) {
                logClientRequestError('advanced upload crop save business failure', data.error);
            }
            alert(userErrorMessage(data.error, 'saveCropFailed'));
            showLoading(false);
        }
    }, function(error) {
        logClientRequestError('advanced upload crop save failed', error);
        alert(userErrorMessage(error.message, 'saveCropFailed'));
        showLoading(false);
    });
}

var extractCanvas, extractCtx;

function drawSplitGuideLine() {
    if (!isSplitWavenumEnabled()) return;
    var splitParams = getSplitParams();
    var splitX = splitParams.split_pixel_x;
    if (!isFinite(splitX)) return;
    var cropX = cropCoords.x || 0;
    var localX = (splitX - cropX) * extractScale;

    if (!isFinite(localX) || localX < 0 || localX > extractCanvas.width) return;

    extractCtx.save();
    extractCtx.setLineDash([6, 4]);
    extractCtx.strokeStyle = 'rgba(14,165,233,0.95)';
    extractCtx.beginPath();
    extractCtx.moveTo(localX, 0);
    extractCtx.lineTo(localX, extractCanvas.height);
    extractCtx.stroke();
    extractCtx.fillStyle = GLM51_COLORS.accentStrong;
    extractCtx.font = '12px sans-serif';
    extractCtx.fillText('2000', localX + 4, 14);
    extractCtx.restore();
}

function initExtractCanvas() {
    extractCanvas = document.getElementById('extractCanvas');
    extractCtx = extractCanvas.getContext('2d');

    var img = new Image();
    img.onload = function() {
        resizeExtractCanvasForImage(img, extractMode);
        cachedExtractImg = img;  // 缓存用于拖动重绘
        resetEditableExtractImage(img);
        applyCanvasDisplayModeFromImage(img);
        autoTryExtract();

        extractCanvas.onmousedown = function(e) {
            var rect = extractCanvas.getBoundingClientRect();
            var dx = (e.clientX - rect.left) * (extractCanvas.width / rect.width);
            var dy = (e.clientY - rect.top) * (extractCanvas.height / rect.height);

            if (eraserMode) {
                e.preventDefault();
                isErasing = true;
                eraseImageAndPointsAtDisplayPos(dx, dy);
                return;
            }
            if (extractMode === 'color') {
                // 取色模式：开始拖框
                e.preventDefault();
                isDraggingColorBox = true;
                colorBoxStart = { x: dx, y: dy };
                colorBoxPreview = null;
            }
            // trace 模式：不在此处处理，mouseup 时统一加单点
        };
        extractCanvas.onmousemove = function(e) {
            var rect = extractCanvas.getBoundingClientRect();
            var dx = (e.clientX - rect.left) * (extractCanvas.width / rect.width);
            var dy = (e.clientY - rect.top) * (extractCanvas.height / rect.height);

            if (eraserMode && isErasing) {
                eraseImageAndPointsAtDisplayPos(dx, dy);
                return;
            }
            if (isDraggingColorBox && colorBoxStart) {
                colorBoxPreview = {
                    x: Math.min(colorBoxStart.x, dx),
                    y: Math.min(colorBoxStart.y, dy),
                    width: Math.max(1, Math.abs(dx - colorBoxStart.x)),
                    height: Math.max(1, Math.abs(dy - colorBoxStart.y))
                };
                drawManualSelections();
            }
        };
        extractCanvas.onmouseup = function(e) {
            var rect = extractCanvas.getBoundingClientRect();
            var dx = (e.clientX - rect.left) * (extractCanvas.width / rect.width);
            var dy = (e.clientY - rect.top) * (extractCanvas.height / rect.height);
            if (eraserMode) {
                finishEraseStroke();
                isErasing = false;
                return;
            }
            if (isDraggingColorBox && colorBoxStart) {
                var dispRect = {
                    x: Math.min(colorBoxStart.x, dx),
                    y: Math.min(colorBoxStart.y, dy),
                    width: Math.abs(dx - colorBoxStart.x),
                    height: Math.abs(dy - colorBoxStart.y)
                };
                isDraggingColorBox = false;
                colorBoxStart = null;
                colorBoxPreview = null;
                if (dispRect.width >= 3 && dispRect.height >= 3) {
                    var cropX = cropCoords.x || 0;
                    var cropY = cropCoords.y || 0;
                    colorBoxes.push({
                        x: cropX + dispRect.x / extractScale,
                        y: cropY + dispRect.y / extractScale,
                        width: dispRect.width / extractScale,
                        height: dispRect.height / extractScale
                    });
                    updateColorPointsList();
                }
                drawManualSelections();
                return;
            }
            // trace 模式：单击加单点
            if (extractMode === 'trace') {
                selectExtractPointAt(dx, dy);
            }
        };
        extractCanvas.onmouseleave = function() {
            if (isErasing) {
                finishEraseStroke();
            }
            isErasing = false;
            if (isDraggingColorBox) {
                isDraggingColorBox = false;
                colorBoxStart = null;
                colorBoxPreview = null;
                drawManualSelections();
            }
        };
    };
    img.src = croppedImage;
}

function autoTryExtract() {
    document.getElementById('auto-try-status').textContent = advancedText('detecting');

    var spectrumParams = getCurrentSpectrumParamsFromUI();

    xhrJSON('/spectrum/auto-extract/', { axes: cropCoords, spectrum_params: spectrumParams }, function(data) {
        if (data.success && data.points && data.points.length > 10) {
            autoExtractedPoints = data.points;
            lastSpectralData = data.spectral_data || convertPixelsToSpectral(data.points, cropCoords, spectrumParams);
            document.getElementById('auto-try-status').textContent = '✓ ' + advancedFormat(
                'autoDetectionSuccessWithCount',
                { count: lastSpectralData.length },
                'Auto-detection successful! (' + lastSpectralData.length + ' extracted data points)'
            );
            document.getElementById('auto-try-status').style.color = GLM51_COLORS.accent;
            displayResult(data.points, true);
        } else {
            if (data.error) {
                logClientRequestError('advanced upload auto detection business failure', data.error);
            }
            document.getElementById('auto-try-status').textContent =
                '✗ ' + userErrorMessage(data.error, 'autoDetectionFailed');
            document.getElementById('auto-try-status').style.color = GLM51_COLORS.muted;
        }
    }, function(error) {
        logClientRequestError('advanced upload auto detection failed', error);
        document.getElementById('auto-try-status').textContent =
            userErrorMessage(error.message, 'autoDetectionFailed');
        document.getElementById('auto-try-status').style.color = GLM51_COLORS.error;
    });
}

function retryAutoExtract() {
    document.getElementById('manual-panel').style.display = 'none';
    document.getElementById('color-control').style.display = 'none';
    document.getElementById('trace-control').style.display = 'none';

    document.getElementById('btn-color').style.background = 'rgba(10,14,23,0.9)';
    document.getElementById('btn-trace').style.background = 'rgba(10,14,23,0.9)';
    document.getElementById('btn-color').style.color = GLM51_COLORS.text;
    document.getElementById('btn-trace').style.color = GLM51_COLORS.text;

    autoTryExtract();
}

function setExtractMode(mode) {
    extractMode = mode;
    eraserMode = false;
    isErasing = false;
    document.getElementById('manual-panel').style.display = 'block';

    document.getElementById('btn-color').style.background = mode === 'color' ? 'rgba(34,211,238,0.16)' : 'rgba(10,14,23,0.9)';
    document.getElementById('btn-trace').style.background = mode === 'trace' ? 'rgba(34,211,238,0.16)' : 'rgba(10,14,23,0.9)';
    document.getElementById('btn-color').style.color = GLM51_COLORS.text;
    document.getElementById('btn-trace').style.color = GLM51_COLORS.text;
    document.getElementById('color-control').style.display = mode === 'color' ? 'block' : 'none';
    document.getElementById('trace-control').style.display = mode === 'trace' ? 'block' : 'none';

    var img = new Image();
    img.onload = function() {
        resizeExtractCanvasForImage(img, mode);
        cachedExtractImg = img;
        resetEditableExtractImage(img);
        applyCanvasDisplayModeFromImage(img);
        drawManualSelections();
    };
    img.src = croppedImage;

    extractCanvas.style.cursor = 'crosshair';
}

function selectExtractPointAt(displayX, displayY) {
    if (!extractCanvas || !extractCtx) return;
    var clampedDisplayX = Math.max(0, Math.min(extractCanvas.width - 1, displayX));
    var clampedDisplayY = Math.max(0, Math.min(extractCanvas.height - 1, displayY));
    var cropX = cropCoords.x || 0;
    var cropY = cropCoords.y || 0;
    var originalX = cropX + (clampedDisplayX / extractScale);
    var originalY = cropY + (clampedDisplayY / extractScale);

    tracePoints.push({
        x: Math.round(originalX),
        y: Math.round(originalY),
        displayX: clampedDisplayX,
        displayY: clampedDisplayY
    });
    updatePointList();
    drawManualSelections();
}

function handleExtractClick(e) {
    var rect = extractCanvas.getBoundingClientRect();
    var displayX = (e.clientX - rect.left) * (extractCanvas.width / rect.width);
    var displayY = (e.clientY - rect.top) * (extractCanvas.height / rect.height);
    selectExtractPointAt(displayX, displayY);
}

function drawManualSelections() {
    if (!extractCtx) return;
    var cropX = cropCoords.x || 0;
    var cropY = cropCoords.y || 0;

    if (extractMode === 'color') {
        // 重绘底图（用缓存图像，零异步开销）
        drawCurrentExtractBaseImage();
        var drawBox = function(b, isPreview) {
            var bx = (b.x - cropX) * extractScale;
            var by = (b.y - cropY) * extractScale;
            var bw = b.width * extractScale;
            var bh = b.height * extractScale;
            extractCtx.save();
            extractCtx.strokeStyle = isPreview ? 'rgba(239,68,68,0.95)' : 'rgba(34,211,238,0.95)';
            extractCtx.fillStyle = isPreview ? 'rgba(239,68,68,0.12)' : 'rgba(34,211,238,0.12)';
            extractCtx.lineWidth = 2;
            extractCtx.setLineDash(isPreview ? [4, 3] : [6, 4]);
            extractCtx.strokeRect(bx, by, bw, bh);
            extractCtx.fillRect(bx, by, bw, bh);
            extractCtx.setLineDash([]);
            extractCtx.restore();
        };
        colorBoxes.forEach(function(b) { drawBox(b, false); });
        if (colorBoxPreview) drawBox(colorBoxPreview, true);
        drawSplitGuideLine();
        return;
    }

    drawCurrentExtractBaseImage();

    tracePoints.forEach(function(p, i) {
        var x = (p.x - cropX) * extractScale;
        var y = (p.y - cropY) * extractScale;
        extractCtx.beginPath();
        extractCtx.arc(x, y, 5, 0, Math.PI * 2);
        extractCtx.fillStyle = GLM51_COLORS.accentStrong;
        extractCtx.fill();
        extractCtx.fillStyle = GLM51_COLORS.text;
        extractCtx.fillText(i + 1, x + 8, y - 8);

        if (i > 0) {
            var prev = tracePoints[i - 1];
            var px = (prev.x - cropX) * extractScale;
            var py = (prev.y - cropY) * extractScale;
            extractCtx.strokeStyle = 'rgba(14,165,233,0.5)';
            extractCtx.lineWidth = 2;
            extractCtx.beginPath();
            extractCtx.moveTo(px, py);
            extractCtx.lineTo(x, y);
            extractCtx.stroke();
        }
    });
    drawSplitGuideLine();
}

function updateColorPointsList() {
    var list = document.getElementById('color-points-list');
    if (colorBoxes.length === 0) {
        list.innerHTML = '<span class="ft-advanced-muted">' + advancedText('noColorBoxesSelected') + '</span>';
        return;
    }
    list.innerHTML = colorBoxes.map(function(b, i) {
        return '<div class="ft-advanced-point-row">' +
            '<span>Box ' + (i+1) + '</span>' +
            '<span class="ft-advanced-muted">' + Math.round(b.width) + '×' + Math.round(b.height) +
            ' @ (' + Math.round(b.x) + ', ' + Math.round(b.y) + ')</span>' +
            '</div>';
    }).join('');
}

function updatePointList() {
    var list = document.getElementById('point-list');
    if (tracePoints.length === 0) {
        list.innerHTML = '<span class="ft-advanced-muted">' + advancedText('noPoints') + '</span>';
        return;
    }
    list.innerHTML = tracePoints.map(function(p, i) {
        return '<div class="ft-advanced-point-row">' +
            '<span>Point ' + (i+1) + '</span>' +
            '<span class="ft-advanced-muted">(' + Math.round(p.x) + ', ' + Math.round(p.y) + ')</span>' +
            '</div>';
    }).join('');
}

function clearColorPoints() { colorBoxes = []; updateColorPointsList(); drawManualSelections(); }
function clearPoints() { tracePoints = []; updatePointList(); }

function extractByColor() {
    if (colorBoxes.length === 0) {
        alert(advancedText('selectColorBoxFirst'));
        return;
    }

    var spectrumParams = getCurrentSpectrumParamsFromUI();

    // 直接送 seed_boxes（每个框的原始图像绝对坐标），后端按框内所有像素学颜色分布
    var seedBoxes = colorBoxes.map(function(b) {
        return {
            x: Math.round(b.x),
            y: Math.round(b.y),
            width: Math.round(b.width),
            height: Math.round(b.height)
        };
    });

    // 把已采集的 backgroundBoxes（croppedImage 坐标）转为原图绝对坐标送给后端
    var cropX = cropCoords.x || 0;
    var cropY = cropCoords.y || 0;
    var bgRois = backgroundBoxes.map(function(b) {
        return {
            x: b.x + cropX,
            y: b.y + cropY,
            width: b.width,
            height: b.height
        };
    });

    showLoading(true, advancedText('extracting'));
    xhrJSON('/spectrum/extract-color/', {
        seed_boxes: seedBoxes,
        tolerance: parseInt(document.getElementById('colorTolerance').value),
        spectrum_params: spectrumParams,
        background_rois: bgRois
    }, function(data) {
        if (data.success) {
            lastSpectralData = data.spectral_data || convertPixelsToSpectral(data.points || [], cropCoords, spectrumParams);
            displayResult(data.points || []);
        } else {
            if (data.error) {
                logClientRequestError('advanced upload color extraction business failure', data.error);
            }
            alert(userErrorMessage(data.error, 'extractionFailed'));
        }
        showLoading(false);
    }, function(error) {
        logClientRequestError('advanced upload color extraction failed', error);
        alert(userErrorMessage(error.message, 'extractionFailed'));
        showLoading(false);
    });
}

function smartTrace() {
    if (tracePoints.length < 2) {
        alert(advancedText('markGuidePointsFirst'));
        return;
    }

    var spectrumParams = getCurrentSpectrumParamsFromUI();

    showLoading(true, advancedText('tracing'));
    xhrJSON('/spectrum/trace/', {
        guide_points: tracePoints.map(function(p) { return {x: p.x, y: p.y}; }),
        strategy: 'vertical',
        axes: cropCoords,
        spectrum_params: spectrumParams
    }, function(data) {
        if (data.success) {
            lastSpectralData = data.spectral_data || convertPixelsToSpectral(data.points || [], cropCoords, spectrumParams);
            displayResult(data.points || []);
        } else {
            if (data.error) {
                logClientRequestError('advanced upload smart trace business failure', data.error);
            }
            alert(userErrorMessage(data.error, 'tracingFailed'));
        }
        showLoading(false);
    }, function(error) {
        logClientRequestError('advanced upload smart trace failed', error);
        alert(userErrorMessage(error.message, 'tracingFailed'));
        showLoading(false);
    });
}

function resetPeakCorrectionState(options) {
    options = options || {};
    correctedSpectralData = null;
    peakCorrectionAnchors = [];
    peakCorrectionActiveSelections = {};
    if (!options.keepInputs) {
        var tableBody = document.getElementById('peakCorrectionTableBody');
        if (tableBody) tableBody.innerHTML = '';
    }
    hidePeakCorrectionError();
    setPeakCorrectionStatus('', false);
}

function setPeakCorrectionStatus(message, visible) {
    var statusEl = document.getElementById('peakCorrectionStatus');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.style.display = visible ? 'block' : 'none';
}

function showPeakCorrectionError(message) {
    var errorEl = document.getElementById('peakCorrectionError');
    if (!errorEl) {
        alert(message);
        return;
    }
    errorEl.textContent = message || '';
    errorEl.style.display = 'block';
}

function hidePeakCorrectionError() {
    var errorEl = document.getElementById('peakCorrectionError');
    if (!errorEl) return;
    errorEl.textContent = '';
    errorEl.style.display = 'none';
}

function spectralIsAbsorbanceMode(spectralData) {
    var dataTypeSelect = document.getElementById('dataType');
    var dataType = dataTypeSelect ? String(dataTypeSelect.value || '').toLowerCase() : '';
    if (dataType === 'transmittance' || dataType === 'transmission') return false;
    return true;
}

function bandBoundsForSpectralData(spectralData, bandIndex) {
    var ws = spectralData.map(function(row) { return Number(row.wavenumber); }).filter(function(value) { return isFinite(value); });
    var minW = Math.min.apply(null, ws);
    var maxW = Math.max.apply(null, ws);
    var range = Math.max(1e-9, maxW - minW);
    var bandSize = range / PEAK_CORRECTION_REQUIRED_ANCHOR_COUNT;
    var start = maxW - (bandIndex + 1) * bandSize;
    var end = maxW - bandIndex * bandSize;
    if (bandIndex === 0) {
        end = maxW;
    }
    if (bandIndex === PEAK_CORRECTION_REQUIRED_ANCHOR_COUNT - 1) {
        start = minW;
    }
    return {
        min: Math.min(start, end),
        max: Math.max(start, end)
    };
}

function buildPeakCandidatesForBand(spectralData, bounds, preferMaxima) {
    var candidates = [];
    if (!spectralData || spectralData.length < (PEAK_DETECTION_NEIGHBOR_SPAN * 2 + 1)) return candidates;

    for (var i = PEAK_DETECTION_NEIGHBOR_SPAN; i < spectralData.length - PEAK_DETECTION_NEIGHBOR_SPAN; i++) {
        var row = spectralData[i];
        var wn = Number(row.wavenumber);
        var val = Number(row.value);
        if (!isFinite(wn) || !isFinite(val)) continue;
        if (wn < bounds.min || wn > bounds.max) continue;

        var isExtremum = true;
        var localReference = [];
        for (var offset = 1; offset <= PEAK_DETECTION_NEIGHBOR_SPAN; offset++) {
            var prev = Number(spectralData[i - offset].value);
            var next = Number(spectralData[i + offset].value);
            localReference.push(prev, next);
            if (preferMaxima && (val < prev || val < next)) {
                isExtremum = false;
                break;
            }
            if (!preferMaxima && (val > prev || val > next)) {
                isExtremum = false;
                break;
            }
        }
        if (!isExtremum) continue;

        var leftIndex = Math.max(0, i - PEAK_DETECTION_PROMINENCE_SPAN);
        var rightIndex = Math.min(spectralData.length - 1, i + PEAK_DETECTION_PROMINENCE_SPAN);
        var shoulderValues = [];
        for (var cursor = leftIndex; cursor <= rightIndex; cursor++) {
            if (cursor === i) continue;
            shoulderValues.push(Number(spectralData[cursor].value));
        }
        var shoulderAverage = shoulderValues.length
            ? shoulderValues.reduce(function(sum, item) { return sum + item; }, 0) / shoulderValues.length
            : val;
        var prominence = preferMaxima ? (val - shoulderAverage) : (shoulderAverage - val);
        candidates.push({
            bandPeak: wn,
            prominence: prominence,
            rawValue: val
        });
    }
    return candidates;
}

function strongestBandPoint(spectralData, bounds, preferMaxima) {
    var filtered = spectralData.filter(function(row) {
        var wn = Number(row.wavenumber);
        var val = Number(row.value);
        return isFinite(wn) && isFinite(val) && wn >= bounds.min && wn <= bounds.max;
    });
    if (!filtered.length) return null;
    return filtered.reduce(function(best, row) {
        if (!best) return row;
        return preferMaxima
            ? (Number(row.value) > Number(best.value) ? row : best)
            : (Number(row.value) < Number(best.value) ? row : best);
    }, null);
}

function detectPeakCorrectionAnchors() {
    var spectralData = lastSpectralData;
    if (!spectralData || spectralData.length < PEAK_DETECTION_MIN_BAND_POINTS * PEAK_CORRECTION_REQUIRED_ANCHOR_COUNT) {
        return [];
    }

    var preferMaxima = spectralIsAbsorbanceMode(spectralData);
    var anchors = [];
    for (var bandIndex = 0; bandIndex < PEAK_CORRECTION_BANDS.length; bandIndex++) {
        var bandMeta = PEAK_CORRECTION_BANDS[bandIndex];
        var bounds = bandBoundsForSpectralData(spectralData, bandIndex);
        var candidates = buildPeakCandidatesForBand(spectralData, bounds, preferMaxima);
        var sortedCandidates = candidates.length
            ? candidates.sort(function(a, b) { return b.prominence - a.prominence; })
            : [];
        var uniqueCandidates = [];
        var seenCandidatePeaks = {};
        sortedCandidates.forEach(function(candidate) {
            var key = Number(candidate.bandPeak).toFixed(2);
            if (seenCandidatePeaks[key]) return;
            seenCandidatePeaks[key] = true;
            uniqueCandidates.push({
                detectedPeak: Number(candidate.bandPeak),
                prominence: Number(candidate.prominence || 0),
                rawValue: Number(candidate.rawValue)
            });
        });
        var bestCandidate = uniqueCandidates.length
            ? uniqueCandidates[0]
            : null;
        var fallbackPoint = !bestCandidate ? strongestBandPoint(spectralData, bounds, preferMaxima) : null;
        if (!bestCandidate && !fallbackPoint) {
            return [];
        }
        var candidateOptions = uniqueCandidates.slice(0, 8);
        if (!candidateOptions.length && fallbackPoint) {
            candidateOptions.push({
                detectedPeak: Number(fallbackPoint.wavenumber),
                prominence: 0,
                rawValue: Number(fallbackPoint.value)
            });
        }
        anchors.push({
            key: bandMeta.key,
            label: advancedText(bandMeta.labelKey, bandMeta.fallback),
            detectedPeak: bestCandidate ? Number(bestCandidate.detectedPeak) : Number(fallbackPoint.wavenumber),
            candidateOptions: candidateOptions
        });
    }
    return anchors;
}

function renderPeakCorrectionTable(anchors) {
    var tableBody = document.getElementById('peakCorrectionTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = anchors.map(function(anchor) {
        var anchorKey = String(anchor.key || '');
        var candidateOptions = Array.isArray(anchor.candidateOptions) ? anchor.candidateOptions : [];
        var selectedPeak = isFinite(Number(anchor.detectedPeak)) ? Number(anchor.detectedPeak) : null;
        var optionsHtml = candidateOptions.map(function(option, index) {
            var detectedPeak = Number(option.detectedPeak);
            var optionLabel = detectedPeak.toFixed(2);
            if (index === 0) {
                optionLabel += ' (' + advancedText('peakCorrectionDefaultOption', 'Default') + ')';
            }
            var selectedAttr = selectedPeak !== null && Math.abs(detectedPeak - selectedPeak) < 0.0001 ? ' selected' : '';
            return '<option value="' + escapeHtml(detectedPeak.toFixed(4)) + '"' + selectedAttr + '>' + escapeHtml(optionLabel) + '</option>';
        }).join('');
        return '' +
            '<tr data-peak-band="' + anchorKey + '">' +
            '<td style="padding:10px 8px; border-bottom:1px solid rgba(255,255,255,0.08);">' + anchor.label + '</td>' +
            '<td style="padding:10px 8px; border-bottom:1px solid rgba(255,255,255,0.08);">' +
                '<div style="display:grid; gap:6px;">' +
                    '<select data-peak-detected-select="' + anchorKey + '"' +
                    ' style="width:100%; padding:8px; border-radius:6px; border:1px solid rgba(255,255,255,0.2); background:rgba(0,0,0,0.28); color:#fff;">' +
                    optionsHtml +
                    '</select>' +
                    '<span data-peak-detected="' + anchorKey + '" style="color:#8899aa; font-size:0.82em;">' +
                    escapeHtml(advancedFormat('peakCorrectionDetectedValue', { peak: anchor.detectedPeak.toFixed(2) }, 'Auto-marked peaks: ' + anchor.detectedPeak.toFixed(2))) +
                    '</span>' +
                '</div>' +
            '</td>' +
            '<td style="padding:10px 8px; border-bottom:1px solid rgba(255,255,255,0.08);">' +
                '<input type="number" step="0.01" inputmode="decimal" data-peak-corrected="' + anchorKey + '"' +
                ' style="width:100%; padding:8px; border-radius:6px; border:1px solid rgba(255,255,255,0.2); background:rgba(0,0,0,0.28); color:#fff;">' +
            '</td>' +
            '</tr>';
    }).join('');
    peakCorrectionActiveSelections = {};
    anchors.forEach(function(anchor) {
        peakCorrectionActiveSelections[anchor.key] = Number(anchor.detectedPeak);
    });
    tableBody.querySelectorAll('[data-peak-detected-select]').forEach(function(selectEl) {
        selectEl.addEventListener('change', function() {
            var key = String(selectEl.getAttribute('data-peak-detected-select') || '');
            var selectedPeak = Number(selectEl.value);
            if (!key || !isFinite(selectedPeak)) return;
            peakCorrectionActiveSelections[key] = selectedPeak;
            var infoEl = document.querySelector('[data-peak-detected="' + key + '"]');
            if (infoEl) {
                infoEl.textContent = advancedFormat('peakCorrectionDetectedValue', { peak: selectedPeak.toFixed(2) }, 'Auto-marked peaks: ' + selectedPeak.toFixed(2));
            }
        });
    });
}

function openPeakCorrectionModal() {
    if (!lastSpectralData || !lastSpectralData.length) {
        alert(advancedText('peakCorrectionNeedData'));
        return;
    }
    hidePeakCorrectionError();
    peakCorrectionAnchors = detectPeakCorrectionAnchors();
    if (peakCorrectionAnchors.length !== PEAK_CORRECTION_REQUIRED_ANCHOR_COUNT) {
        renderPeakCorrectionTable([]);
        showPeakCorrectionError(advancedText('peakCorrectionDetectFailed'));
        document.getElementById('peakCorrectionModal').style.display = 'flex';
        return;
    }
    renderPeakCorrectionTable(peakCorrectionAnchors);
    document.getElementById('peakCorrectionModal').style.display = 'flex';
}

function closePeakCorrectionModal() {
    var modal = document.getElementById('peakCorrectionModal');
    if (modal) modal.style.display = 'none';
}

function collectPeakCorrectionInputs() {
    if (peakCorrectionAnchors.length !== PEAK_CORRECTION_REQUIRED_ANCHOR_COUNT) return [];
    return peakCorrectionAnchors.map(function(anchor) {
        var input = document.querySelector('[data-peak-corrected="' + anchor.key + '"]');
        var selectedDetectedPeak = peakCorrectionActiveSelections.hasOwnProperty(anchor.key)
            ? Number(peakCorrectionActiveSelections[anchor.key])
            : Number(anchor.detectedPeak);
        return {
            key: anchor.key,
            label: anchor.label,
            detectedPeak: selectedDetectedPeak,
            correctedPeakRaw: input ? String(input.value || '').trim() : '',
            correctedPeak: Number(input ? input.value : NaN)
        };
    });
}

function peaksPreserveOrder(anchorRows) {
    if (!anchorRows || anchorRows.length < 2) return true;
    var detectedDirection = anchorRows[0].detectedPeak > anchorRows[anchorRows.length - 1].detectedPeak ? 'descending' : 'ascending';
    for (var i = 1; i < anchorRows.length; i++) {
        if (detectedDirection === 'descending' && !(anchorRows[i - 1].correctedPeak > anchorRows[i].correctedPeak)) {
            return false;
        }
        if (detectedDirection === 'ascending' && !(anchorRows[i - 1].correctedPeak < anchorRows[i].correctedPeak)) {
            return false;
        }
    }
    return true;
}

function remapWavenumberByAnchors(wavenumber, anchorRowsAsc) {
    if (!anchorRowsAsc.length) return wavenumber;
    if (anchorRowsAsc.length === 1) {
        return wavenumber + (anchorRowsAsc[0].correctedPeak - anchorRowsAsc[0].detectedPeak);
    }

    if (wavenumber <= anchorRowsAsc[0].detectedPeak) {
        return wavenumber + (anchorRowsAsc[0].correctedPeak - anchorRowsAsc[0].detectedPeak);
    }
    if (wavenumber >= anchorRowsAsc[anchorRowsAsc.length - 1].detectedPeak) {
        return wavenumber + (
            anchorRowsAsc[anchorRowsAsc.length - 1].correctedPeak -
            anchorRowsAsc[anchorRowsAsc.length - 1].detectedPeak
        );
    }

    for (var i = 0; i < anchorRowsAsc.length - 1; i++) {
        var left = anchorRowsAsc[i];
        var right = anchorRowsAsc[i + 1];
        if (wavenumber < left.detectedPeak || wavenumber > right.detectedPeak) continue;
        var segmentRange = right.detectedPeak - left.detectedPeak;
        if (!segmentRange) {
            return wavenumber + (left.correctedPeak - left.detectedPeak);
        }
        var ratio = (wavenumber - left.detectedPeak) / segmentRange;
        return left.correctedPeak + ratio * (right.correctedPeak - left.correctedPeak);
    }

    return wavenumber;
}

function applyPeakCorrection() {
    hidePeakCorrectionError();
    var anchorRows = collectPeakCorrectionInputs();
    if (anchorRows.length !== PEAK_CORRECTION_REQUIRED_ANCHOR_COUNT) {
        showPeakCorrectionError(advancedText('peakCorrectionNeedData'));
        return;
    }
    if (anchorRows.some(function(row) { return !row.correctedPeakRaw; })) {
        showPeakCorrectionError(advancedText('peakCorrectionNeedAllBands'));
        return;
    }
    if (anchorRows.some(function(row) { return !isFinite(row.correctedPeak); })) {
        showPeakCorrectionError(advancedText('peakCorrectionNeedNumeric'));
        return;
    }
    if (!peaksPreserveOrder(anchorRows)) {
        showPeakCorrectionError(advancedText('peakCorrectionOrderInvalid'));
        return;
    }
    var anchorRowsAsc = anchorRows.slice().sort(function(a, b) { return a.detectedPeak - b.detectedPeak; });
    correctedSpectralData = (lastSpectralData || []).map(function(row) {
        return {
            wavenumber: Math.round(remapWavenumberByAnchors(Number(row.wavenumber), anchorRowsAsc) * 10000) / 10000,
            value: row.value
        };
    }).sort(function(a, b) { return b.wavenumber - a.wavenumber; });
    drawPreviewChart(correctedSpectralData);
    setPeakCorrectionStatus(advancedText('peakCorrectionAppliedSummary'), true);
    closePeakCorrectionModal();
}

function resetPeakCorrection() {
    correctedSpectralData = null;
    drawPreviewChart(lastSpectralData || []);
    setPeakCorrectionStatus(advancedText('peakCorrectionResetSummary'), true);
    hidePeakCorrectionError();
}

function displayResult(points, isAuto) {
    isAuto = isAuto || false;
    var thinned = thinPointsByX(points);
    currentCurvePoints = thinned.map(function(p) { return {x: p.x, y: p.y}; });
    pristineCurvePoints = currentCurvePoints.map(function(p) { return {x: p.x, y: p.y}; });
    pristineCroppedImageForErase = croppedImage;
    eraserImageDirty = false;
    maybeAutoFitAxisGuidesToCurve(currentCurvePoints);
    
    currentWavenumOffset = 0;
    var offsetInput = document.getElementById('wavenumOffset');
    if (offsetInput) offsetInput.value = '0';
    var statusEl = document.getElementById('offsetStatus');
    if (statusEl) statusEl.style.display = 'none';
    resetPeakCorrectionState();
    
    redrawExtractBase();
    drawCurveOnExtractCanvas(currentCurvePoints, isAuto);
    
    document.getElementById('result-panel').style.display = 'block';
    if (lastSpectralData && lastSpectralData.length > 0) drawPreviewChart(lastSpectralData);
}

function drawPreviewChart(spectralData) {
    var canvas = document.getElementById('previewCanvas');
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, w, h);

    if (!spectralData || spectralData.length < 2) return;

    var pad = 15;
    var ws = spectralData.map(function(d) { return d.wavenumber; });
    var vs = spectralData.map(function(d) { return d.value; });
    var minW = Math.min.apply(null, ws), maxW = Math.max.apply(null, ws);
    var minV = Math.min.apply(null, vs), maxV = Math.max.apply(null, vs);
    var rangeV = (maxV - minV) || 1;

    ctx.strokeStyle = GLM51_COLORS.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();

    spectralData.forEach(function(d, i) {
        var x = pad + (1 - (d.wavenumber - minW) / ((maxW - minW) || 1)) * (w - 2 * pad);
        var y = pad + (1 - (d.value - minV) / rangeV) * (h - 2 * pad);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
}

// ========== Preview Modal Functions ==========
function showPreviewModal() {
    var displayData = effectiveSpectralData();
    if (!displayData || displayData.length === 0) {
        alert(advancedText('noPreviewData'));
        return;
    }

    var modal = document.getElementById('curvePreviewModal');
    modal.style.display = 'flex';

    modalCanvas = document.getElementById('modalCanvas');
    modalCtx = modalCanvas.getContext('2d');
    drawModalChart(displayData);

    modalCanvas.onmousemove = function(e) {
        var rect = modalCanvas.getBoundingClientRect();
        var scaleX = modalCanvas.width / rect.width;
        var scaleY = modalCanvas.height / rect.height;
        var mouseX = (e.clientX - rect.left) * scaleX;
        var mouseY = (e.clientY - rect.top) * scaleY;

        var coordDiv = document.getElementById('modal-coords');
        var dataPoint = findClosestDataPoint(mouseX, mouseY, displayData, modalCanvas.width, modalCanvas.height);
        if (dataPoint) {
            var unit = (displayData[0] && document.getElementById <= 1) ? 'Abs' : '%T';
            coordDiv.textContent =
                advancedText('wavenumberLabel') + ': ' + (dataPoint.wavenumber.toFixed(2)) +
                ' cm⁻¹ | ' + advancedText('valueLabel') + ': ' + (dataPoint.value.toFixed(4)) + ' ' + unit;
        } else {
            coordDiv.textContent = advancedText('hoverCurveValues');
        }
    };

    modalCanvas.onmouseleave = function() {
        document.getElementById('modal-coords').textContent = advancedText('hoverCurveValues');
    };
}

function closePreviewModal() {
    document.getElementById('curvePreviewModal').style.display = 'none';
}

function drawModalChart(spectralData) {
    var w = modalCanvas.width, h = modalCanvas.height;
    modalCtx.clearRect(0, 0, w, h);
    modalCtx.fillStyle = GLM51_COLORS.bg;
    modalCtx.fillRect(0, 0, w, h);

    if (!spectralData || spectralData.length < 2) return;

    var pad = 40;
    var ws = spectralData.map(function(d) { return d.wavenumber; });
    var vs = spectralData.map(function(d) { return d.value; });
    var minW = Math.min.apply(null, ws), maxW = Math.max.apply(null, ws);
    var minV = Math.min.apply(null, vs), maxV = Math.max.apply(null, vs);
    var rangeV = (maxV - minV) || 1;

    modalCtx.strokeStyle = GLM51_COLORS.line;
    modalCtx.lineWidth = 1;
    modalCtx.beginPath();
    modalCtx.moveTo(pad, pad);
    modalCtx.lineTo(pad, h - pad);
    modalCtx.lineTo(w - pad, h - pad);
    modalCtx.stroke();

    modalCtx.strokeStyle = GLM51_COLORS.accent;
    modalCtx.lineWidth = 2;
    modalCtx.beginPath();

    spectralData.forEach(function(d, i) {
        var x = pad + (1 - (d.wavenumber - minW) / ((maxW - minW) || 1)) * (w - 2 * pad);
        var y = pad + (1 - (d.value - minV) / rangeV) * (h - 2 * pad);
        if (i === 0) modalCtx.moveTo(x, y);
        else modalCtx.lineTo(x, y);
    });
    modalCtx.stroke();

    modalCanvas._spectralData = spectralData;
    modalCanvas._minW = minW;
    modalCanvas._maxW = maxW;
    modalCanvas._minV = minV;
    modalCanvas._maxV = maxV;
    modalCanvas._pad = pad;
}

function findClosestDataPoint(mouseX, mouseY, spectralData, canvasW, canvasH) {
    if (!spectralData || !spectralData.length) return null;

    var pad = modalCanvas._pad || 40;
    var minW = modalCanvas._minW, maxW = modalCanvas._maxW;
    var minV = modalCanvas._minV, maxV = modalCanvas._maxV;
    var rangeV = (maxV - minV) || 1;

    var minDist = Infinity;
    var closest = null;

    spectralData.forEach(function(d) {
        var x = pad + (1 - (d.wavenumber - minW) / ((maxW - minW) || 1)) * (canvasW - 2 * pad);
        var y = pad + (1 - (d.value - minV) / rangeV) * (canvasH - 2 * pad);
        var dist = Math.sqrt((mouseX - x)*(mouseX - x)+(mouseY - y)*(mouseY - y));
        if (dist < minDist) {
            minDist = dist;
            closest = d;
        }
    });

    return minDist < 50 ? closest : null;
}

function downloadCSV() {
    if (!IS_AUTHENTICATED) {
        alert(advancedText('pleaseLoginDownloadCsv'));
        return;
    }
    var exportData = effectiveSpectralData();
    if (!exportData || exportData.length === 0) {
        alert(advancedText('noDataToExport'));
        return;
    }

    var csv = '';
    exportData.forEach(function(p) {
        csv += '' + (p.wavenumber) + ',' + (p.value) + '\n';
    });

    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = uploadedDownloadFilename || advancedText('defaultDownloadFilename', advancedText('downloadFilename'));
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
function goHome() {
    window.location.href = '/';
}

function showLoading(show, text) {
    var loading = document.getElementById('loading');
    loading.style.display = show ? 'flex' : 'none';
    if (text) document.getElementById('loadingText').textContent = text;
}

var colorToleranceEl = document.getElementById('colorTolerance');
if (colorToleranceEl) {
    colorToleranceEl.addEventListener('input', function(e) {
        document.getElementById('toleranceValue').textContent = e.target.value;
    });
}
var bgThresholdEl = document.getElementById('bgThreshold');
if (bgThresholdEl) {
    bgThresholdEl.addEventListener('input', function(e) {
        var el = document.getElementById('bgThresholdValue');
        if (el) el.textContent = e.target.value;
    });
}
var bgProcessingModeEl = document.getElementById('bgProcessingMode');
if (bgProcessingModeEl) {
    bgProcessingModeEl.addEventListener('change', function() {
        drawBackgroundCanvas();
    });
}
var eraserSizeEl = document.getElementById('eraserSize');
if (eraserSizeEl) {
    eraserSizeEl.addEventListener('input', function(e) {
        eraserSize = parseInt(e.target.value || '12');
    });
}

var useSplitWavenumCheckbox = document.getElementById('useSplitWavenum');
syncSplitWavenumControls();
if (useSplitWavenumCheckbox) {
    useSplitWavenumCheckbox.addEventListener('change', function() {
        syncSplitWavenumControls();
        if (typeof drawCropCanvas === 'function') {
            drawCropCanvas();
        }
        recalculateCurrentSpectralDataFromUI();
    });
}

['startWavenum', 'endWavenum'].forEach(function(id) {
    var input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('input', function() {
        recalculateCurrentSpectralDataFromUI();
    });
});

var dataTypeSelect = document.getElementById('dataType');
if (dataTypeSelect) {
    dataTypeSelect.addEventListener('change', function() {
        recalculateCurrentSpectralDataFromUI();
    });
}

document.querySelectorAll('[data-ft-action]').forEach(function(element) {
    element.addEventListener('click', function() {
        var action = element.dataset.ftAction;
        if (action === 'set-extract-mode') {
            setExtractMode(element.dataset.ftMode || 'color');
            return;
        }
        var actionMap = {
            resetCrop: resetCrop,
            applyCrop: applyCrop,
            clearBackgroundBoxes: clearBackgroundBoxes,
            applyBackgroundAndContinue: applyBackgroundAndContinue,
            retryAutoExtract: retryAutoExtract,
            clearColorPoints: clearColorPoints,
            extractByColor: extractByColor,
            clearPoints: clearPoints,
            smartTrace: smartTrace,
            toggleEraserMode: toggleEraserMode,
            resetAllErases: resetAllErases,
            applyWavenumOffset: applyWavenumOffset,
            openPeakCorrectionModal: openPeakCorrectionModal,
            closePeakCorrectionModal: closePeakCorrectionModal,
            applyPeakCorrection: applyPeakCorrection,
            resetPeakCorrection: resetPeakCorrection,
            showPreviewModal: showPreviewModal,
            closePreviewModal: closePreviewModal,
            downloadCSV: downloadCSV,
            goHome: goHome
        };
        var handler = actionMap[action];
        if (typeof handler === 'function') handler();
    });
});


window.resetCrop = resetCrop;
window.applyCrop = applyCrop;
window.clearBackgroundBoxes = clearBackgroundBoxes;
window.applyBackgroundAndContinue = applyBackgroundAndContinue;
window.retryAutoExtract = retryAutoExtract;
window.setExtractMode = setExtractMode;
window.clearColorPoints = clearColorPoints;
window.extractByColor = extractByColor;
window.clearPoints = clearPoints;
window.smartTrace = smartTrace;
window.toggleEraserMode = toggleEraserMode;
window.resetAllErases = resetAllErases;
window.applyWavenumOffset = applyWavenumOffset;
window.openPeakCorrectionModal = openPeakCorrectionModal;
window.closePeakCorrectionModal = closePeakCorrectionModal;
window.applyPeakCorrection = applyPeakCorrection;
window.resetPeakCorrection = resetPeakCorrection;
window.showPreviewModal = showPreviewModal;
window.closePreviewModal = closePreviewModal;
window.downloadCSV = downloadCSV;
window.goHome = goHome;
