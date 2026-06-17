"""
Phân tích ảnh lá cây bằng OpenCV (heuristic, không cần GPU):
  - Đo kích thước tán lá (rộng x cao) -> quy đổi pixel sang cm.
  - Phát hiện dấu hiệu sâu bệnh: vùng đốm nâu/vàng bất thường trên lá.

Lưu ý hiệu chỉnh: PIXELS_PER_CM phụ thuộc khoảng cách camera tới cây.
Hãy đặt 1 vật mốc có kích thước biết trước (vd thước 10cm) để hiệu chỉnh,
hoặc đo thủ công 1 lần rồi cập nhật hằng số dưới đây.
"""
import cv2
import numpy as np

# Hệ số hiệu chỉnh: số pixel tương ứng 1 cm (ĐO LẠI theo lắp đặt thực tế).
PIXELS_PER_CM = 12.0

# Ngưỡng HSV cho vùng lá khỏe (xanh lá)
GREEN_LOWER = np.array([35, 40, 40])
GREEN_UPPER = np.array([85, 255, 255])

# Ngưỡng HSV cho đốm bệnh (nâu/vàng/úa)
DISEASE_LOWER = np.array([10, 60, 40])
DISEASE_UPPER = np.array([30, 255, 220])


def analyze(image_bgr):
    """Nhận ảnh BGR (OpenCV), trả dict kết quả."""
    h, w = image_bgr.shape[:2]
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)

    # --- 1) Tách vùng lá (xanh) ---
    green_mask = cv2.inRange(hsv, GREEN_LOWER, GREEN_UPPER)
    green_mask = cv2.morphologyEx(green_mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    green_mask = cv2.morphologyEx(green_mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))

    canopy_w_cm = None
    canopy_h_cm = None
    leaf_area = 0

    contours, _ = cv2.findContours(green_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        biggest = max(contours, key=cv2.contourArea)
        leaf_area = cv2.contourArea(biggest)
        # Bỏ qua nhiễu quá nhỏ
        if leaf_area > (w * h) * 0.01:
            x, y, bw, bh = cv2.boundingRect(biggest)
            canopy_w_cm = round(bw / PIXELS_PER_CM, 1)
            canopy_h_cm = round(bh / PIXELS_PER_CM, 1)

    # --- 2) Phát hiện đốm bệnh trong vùng lá ---
    disease_mask = cv2.inRange(hsv, DISEASE_LOWER, DISEASE_UPPER)
    # chỉ xét đốm bệnh nằm gần/trong vùng lá
    leaf_dilated = cv2.dilate(green_mask, np.ones((15, 15), np.uint8))
    disease_in_leaf = cv2.bitwise_and(disease_mask, leaf_dilated)

    disease_area = int(np.count_nonzero(disease_in_leaf))
    total_leaf = int(np.count_nonzero(green_mask)) + disease_area
    ratio = (disease_area / total_leaf) if total_leaf > 0 else 0.0

    pest_detected = ratio > 0.05  # >5% diện tích lá có đốm bất thường
    confidence = round(min(0.99, ratio * 5), 3) if pest_detected else round(1 - ratio, 3)
    pest_label = "Leaf spot / đốm lá" if pest_detected else None

    return {
        "canopyWidth": canopy_w_cm,
        "canopyHeight": canopy_h_cm,
        "pestDetected": bool(pest_detected),
        "pestLabel": pest_label,
        "confidence": confidence,
        "diseaseRatio": round(ratio, 4),
    }
