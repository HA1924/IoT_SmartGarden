"""
Microservice phân tích camera (Flask + OpenCV).

Hai cách dùng:
  A) ESP32-Cam / client POST ảnh tới  POST /analyze  -> trả JSON kết quả.
  B) Đặt PULL_STREAM_URL + chạy nền: service tự kéo frame từ ESP32-Cam,
     phân tích định kỳ và đẩy kết quả về Node (POST /api/camera/analysis).

Biến môi trường:
  PORT                (mặc định 5001)
  NODE_URL            URL server Node (vd http://localhost:3000)
  DEVICE_API_KEY      khớp với DEVICE_API_KEY của Node
  PULL_STREAM_URL     (tuỳ chọn) URL stream ESP32-Cam để tự kéo
  PULL_INTERVAL       giây giữa 2 lần phân tích khi tự kéo (mặc định 10)
"""
import os
import io
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
PULL_STREAM_URL = os.environ.get("PULL_STREAM_URL", "")
PULL_INTERVAL = int(os.environ.get("PULL_INTERVAL", 10))


def decode_image(raw_bytes):
    arr = np.frombuffer(raw_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img


def push_to_node(result):
    """Gửi kết quả phân tích về Node."""
    try:
        requests.post(
            f"{NODE_URL}/api/camera/analysis",
            json=result,
            headers={"x-api-key": API_KEY},
            timeout=5,
        )
    except Exception as e:
        print("[ai] không gửi được về Node:", e)


@app.route("/health")
def health():
    return jsonify({"ok": True})


@app.route("/analyze", methods=["POST"])
def analyze():
    """Nhận ảnh (multipart 'image' hoặc raw body), trả kết quả + đẩy về Node."""
    img = None
    if "image" in request.files:
        img = decode_image(request.files["image"].read())
    elif request.data:
        img = decode_image(request.data)

    if img is None:
        return jsonify({"error": "Không đọc được ảnh"}), 400

    result = detector.analyze(img)
    # Đẩy về Node (không bắt buộc thành công)
    push_to_node(result)
    return jsonify(result)


def pull_loop():
    """Tự kéo frame từ ESP32-Cam và phân tích định kỳ."""
    print(f"[ai] Tự kéo stream: {PULL_STREAM_URL} mỗi {PULL_INTERVAL}s")
    while True:
        try:
            cap = cv2.VideoCapture(PULL_STREAM_URL)
            ok, frame = cap.read()
            cap.release()
            if ok and frame is not None:
                result = detector.analyze(frame)
                print("[ai] kết quả:", result)
                push_to_node(result)
            else:
                print("[ai] không lấy được frame")
        except Exception as e:
            print("[ai] lỗi pull:", e)
        time.sleep(PULL_INTERVAL)


if __name__ == "__main__":
    if PULL_STREAM_URL:
        t = threading.Thread(target=pull_loop, daemon=True)
        t.start()
    app.run(host="0.0.0.0", port=PORT)
