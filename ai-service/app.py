"""
Microservice phân tích camera (Flask + OpenCV).

Hai cách dùng:
  A) ESP32-Cam / client POST ảnh tới  POST /analyze?zone=N  -> trả JSON kết quả.
  B) Đặt PULL_STREAM_URL_1/2/3 + chạy nền: service tự kéo frame từng zone,
     phân tích định kỳ và đẩy kết quả về Node (POST /api/camera/analysis).

Biến môi trường:
  PORT                  (mặc định 5001)
  NODE_URL              URL server Node (vd http://localhost:3000)
  DEVICE_API_KEY        khớp với DEVICE_API_KEY của Node
  PULL_STREAM_URL_1     URL stream camera Zone 1
  PULL_STREAM_URL_2     URL stream camera Zone 2
  PULL_STREAM_URL_3     URL stream camera Zone 3
  PULL_STREAM_URL       (tương thích cũ) fallback cho Zone 1 nếu _1 không đặt
  PULL_INTERVAL         giây giữa 2 lần phân tích mỗi zone (mặc định 10)
"""
import os
import time
import threading

import cv2
import numpy as np
import requests
from flask import Flask, request, jsonify

import detector

app = Flask(__name__)

PORT = int(os.environ.get("PORT", 5001))
NODE_URL = os.environ.get("NODE_URL", "http://localhost:3000")
API_KEY = os.environ.get("DEVICE_API_KEY", "esp32-secret-key-doi-di")
PULL_INTERVAL = int(os.environ.get("PULL_INTERVAL", 10))

# Đọc URL stream 3 zone; PULL_STREAM_URL cũ dùng làm fallback cho zone 1
_old_url = os.environ.get("PULL_STREAM_URL", "")
PULL_STREAM_URLS = {
    1: os.environ.get("PULL_STREAM_URL_1", _old_url),
    2: os.environ.get("PULL_STREAM_URL_2", ""),
    3: os.environ.get("PULL_STREAM_URL_3", ""),
}


def decode_image(raw_bytes):
    arr = np.frombuffer(raw_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def push_to_node(result, zone):
    """Gửi kết quả phân tích về Node, kèm zone để lưu đúng vị trí."""
    payload = {**result, "zone": zone}
    try:
        requests.post(
            f"{NODE_URL}/api/camera/analysis",
            json=payload,
            headers={"x-api-key": API_KEY},
            timeout=5,
        )
    except Exception as e:
        print(f"[ai] zone {zone}: không gửi được về Node:", e)


@app.route("/health")
def health():
    return jsonify({"ok": True})


@app.route("/analyze", methods=["POST"])
def analyze():
    """Nhận ảnh (multipart 'image' hoặc raw body), trả kết quả + đẩy về Node.
    Query param: ?zone=1 (mặc định 1)
    """
    zone = int(request.args.get("zone", 1))
    if zone not in (1, 2, 3):
        zone = 1

    img = None
    if "image" in request.files:
        img = decode_image(request.files["image"].read())
    elif request.data:
        img = decode_image(request.data)

    if img is None:
        return jsonify({"error": "Không đọc được ảnh"}), 400

    result = detector.analyze(img)
    push_to_node(result, zone)
    return jsonify({**result, "zone": zone})


def _to_capture_url(stream_url):
    """Chuyển URL stream :81/stream → URL chụp ảnh tĩnh /capture (port 80)."""
    if ":81/stream" in stream_url:
        return stream_url.replace(":81/stream", "/capture")
    return stream_url


def pull_loop_zone(zone, stream_url):
    """Tự kéo frame từ 1 ESP32-Cam và phân tích định kỳ cho zone cụ thể."""
    capture_url = _to_capture_url(stream_url)
    print(f"[ai] Zone {zone}: tự kéo frame {capture_url} mỗi {PULL_INTERVAL}s")
    while True:
        try:
            resp = requests.get(capture_url, timeout=10)
            if resp.status_code == 200:
                frame = decode_image(resp.content)
                if frame is not None:
                    result = detector.analyze(frame)
                    print(f"[ai] Zone {zone} kết quả:", result)
                    push_to_node(result, zone)
                else:
                    print(f"[ai] Zone {zone}: không decode được ảnh")
            else:
                print(f"[ai] Zone {zone}: HTTP {resp.status_code}")
        except Exception as e:
            print(f"[ai] Zone {zone} lỗi pull:", e)
        time.sleep(PULL_INTERVAL)


if __name__ == "__main__":
    # Khởi thread pull riêng cho từng zone có URL được cấu hình
    for z, url in PULL_STREAM_URLS.items():
        if url:
            t = threading.Thread(target=pull_loop_zone, args=(z, url), daemon=True)
            t.start()
    app.run(host="0.0.0.0", port=PORT)
