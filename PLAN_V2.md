# PLAN v2 — AquaControl Pro: Nâng cấp 3 zone → 10 zone × 3 chậu

> Trạng thái: **ĐÃ CHỐT TOÀN BỘ — SẴN SÀNG THỰC HIỆN**. Chưa sửa file code nào.

---

## 1. Bối cảnh

### Hệ thống hiện tại
- **3 zone**, 1 ESP32 controller (`AQ-ESP-0922`) đọc 3 cảm biến đất + 1 DHT22 dùng chung + 1 cảm biến ánh sáng,
  điều khiển 3 bơm + 1 dải đèn LED.
- Backend Node/Express + Socket.IO + SQL Server; 6 trang dashboard; AI-service Python cho camera.
- Tưới **chỉ có 1 chế độ**: tự động theo ngưỡng (`automationService.evaluate`), cộng bật/tắt tay.

### Hệ thống muốn có
| Thành phần | Số lượng | Ghi chú |
|---|---|---|
| Zone | **10** | Mỗi zone 3 chậu cây |
| ESP32 | 10 (+1 master nếu chọn phương án B) | Mỗi zone 1 con |
| DHT22 | 10 | 1 con/zone (không còn dùng chung) |
| Cảm biến độ ẩm đất | **30** | 3 chậu/zone |
| Relay + bơm | 10 | 1 bơm/zone, tưới chung 3 chậu |
| Vòi | 60 | 2 vòi/chậu |

**Bỏ hẳn**: cảm biến ánh sáng, dải đèn LED, camera ESP32-Cam, AI-service Python.

**Giám sát**: hiển thị cả 10 zone trên cùng 1 trang.

---

## 1b. ✅ Các quyết định đã chốt

| # | Vấn đề | Quyết định |
|---|---|---|
| 1 | 3 cảm biến đất / 1 bơm → tưới theo giá trị nào | **Chậu khô nhất (min)**: bật khi `min(soil1,soil2,soil3) < ngưỡng` |
| 2 | Đèn LED + cảm biến ánh sáng | **Bỏ hoàn toàn** |
| 3 | Database | **Làm mới hoàn toàn** — viết lại `db/schema.sql`, drop & tạo lại |
| 4 | 3 chế độ tưới phối hợp thế nào | **Loại trừ: mỗi zone chọn 1 trong 3** — `threshold` / `schedule` / `manual` |
| 5 | Nút "Tưới 60s" khi zone ở chế độ khác | **Luôn bấm được**, ghi đè tạm thời rồi tự quay về chế độ cũ |
| 6 | Chu kỳ node gửi dữ liệu | **30 giây** (~28.800 dòng/ngày, ~90MB/tháng) |
| 7 | Thời lượng tưới theo lịch | **60 giây** mặc định (sửa được từng lịch) |
| 8 | Giới hạn an toàn cắt bơm | **`MaxRunMinutes` = 5 phút** |
| 9 | Ngưỡng độ ẩm mặc định | **30%**, nghỉ tối thiểu **20 phút** giữa 2 lần tưới |
| 10 | Đặt tên riêng cho zone | **Không** — cứ "Zone 1–10", **bỏ bảng `Zones`** khỏi thiết kế |
| 11 | API key thiết bị | **Mỗi node 1 key riêng**, lưu ở cột `Devices.ApiKey` |
| 12 | Kiến trúc phần cứng | **Phương án A — 10 node độc lập**, không dùng master |
| 13 | Múi giờ lịch tưới | **Cố định UTC+7 (giờ Việt Nam)**, không phụ thuộc đồng hồ máy chủ |
| 14 | Thời gian lưu dữ liệu | **Giữ hết, không gộp, không xoá** → downsample khi vẽ biểu đồ trở thành bắt buộc |
| 15 | Phạm vi bản v2 | **Làm đầy đủ**: gồm trang thống kê nước, phân trang Logs, phát hiện thiết bị offline |

### Cách 3 chế độ hoạt động (theo quyết định #4 và #5)

`PumpState.Mode` của mỗi zone nhận đúng 1 trong 3 giá trị:

| Mode | Ai điều khiển bơm | Ghi chú |
|---|---|---|
| `threshold` | `automationService` theo độ ẩm chậu khô nhất | Mặc định khi khởi tạo |
| `schedule` | `schedulerService` theo lịch trong `WateringSchedules` | Ngưỡng **không** can thiệp |
| `manual` | Chỉ admin bấm trên web | Không có gì tự động |

**Ghi đè tạm thời**: khi bấm "Tưới 60s" ở bất kỳ chế độ nào → ghi `RunUntilUtc = now + 60s`, `Source = 'manual'`.
Trong khoảng đó, `automationService` và `schedulerService` **bỏ qua zone này**. Hết 60s, bơm tự tắt và
zone quay lại đúng chế độ cũ — **không cần đổi `Mode`**, nên cũng không sợ quên đổi lại.

---

## 2. ✅ Kiến trúc phần cứng: Phương án A — 10 node độc lập

Mỗi ESP32 tự nối WiFi → tự POST telemetry → tự GET lệnh → tự điều khiển relay zone mình.
**Không có master.**

**Lý do chọn**: không có điểm chết chung (1 node hỏng chỉ mất 1 zone, 9 zone vẫn tưới); không phải tự viết
giao thức Slave↔Master — phần khó debug nhất; 10 firmware giống hệt nhau chỉ khác `ZONE_ID`; mỗi zone tự
chạy được khi mất mạng; thêm zone chỉ là cắm thêm node.

**Hệ quả phải xử lý trong thiết kế** (đã đưa vào Mục 4):
- 10 node cùng poll lệnh → **bắt buộc cache lệnh trong RAM** (Mục 4.6), không để mỗi lần poll là một query SQL.
- 10 thiết bị, mỗi con 1 API key riêng (Mục 4.5).
- Phủ sóng WiFi phải tới cả 10 vị trí — **cần kiểm tra thực tế trước khi lắp**.
- Nên chuẩn bị OTA qua mạng để không phải tháo từng con xuống khi cập nhật firmware.

> `POST /api/telemetry` vẫn nhận mảng `zones[]` (node gửi mảng 1 phần tử). Giữ nguyên dạng mảng để sau này
> nếu phải chuyển sang kiến trúc có master thì backend không phải sửa.

### 3 nguyên tắc an toàn bắt buộc cho firmware (hiện chưa có cái nào)
- Lệnh tưới gửi kèm `durationSec`, **node tự đếm và tự tắt** → mất mạng giữa chừng bơm vẫn tắt đúng giờ.
- Node cache ngưỡng vào NVS, tự chạy khi mất mạng.
- **Watchdog 2 chiều**: node mất server > 3 phút → tắt bơm; server mất node > 2 phút → báo offline.

---

## 3. Database — viết lại `db/schema.sql`

Bỏ: `CameraAnalysis`, cột `Light`, `LightThreshold`, actuator `led`. Không tạo bảng `Zones`.
**Sửa luôn đường dẫn file DB** đang hardcode `E:\PROJECT\DB_IOT_GARDEN\` ở dòng 15 và 22 — để chạy được trên máy khác.
Vì đã chốt **giữ hết dữ liệu, không xoá** (quyết định #14), `MAXSIZE` nâng từ 500MB lên **UNLIMITED**
(hoặc tối thiểu 10GB) — 500MB chỉ chứa được khoảng 5 tháng.

| Bảng | Thay đổi | Cột chính |
|---|---|---|
| `Users` | giữ nguyên | |
| `Devices` | sửa | `DeviceId`, `Zone` (NULL nếu master), `Type` ('zone-node'/'master'), **`ApiKey`** (UNIQUE), `LastSeen`, `Rssi`, `Uptime`, `FwVersion`, `IsOnline` |
| `Telemetry` | sửa | `Zone`, `Temperature`, `AirHumidity`, **`Soil1`,`Soil2`,`Soil3`**, `SoilMin`, `CreatedAt` — bỏ `Light`. 1 dòng = 1 zone 1 lần gửi |
| `PumpState` | thay `ActuatorState` | `Zone` (PK), `State`, **`Mode`** ('threshold'/'schedule'/'manual'), `RunUntilUtc`, `Source`, `UpdatedBy`, `UpdatedAt` |
| `AutomationRules` | sửa | `Zone`, `SoilThreshold` **=30**, `HysteresisPct` **=15**, `MaxRunMinutes` **=5**, `MinRestMinutes` **=20**, `Enabled` — bỏ `LightThreshold` |
| `WateringSchedules` | **MỚI** | `Id`, `Zone`, `DaysOfWeek` (bitmask 7 bit), `StartTime` (TIME, **giờ VN UTC+7**), `DurationSec` **=60**, `Enabled` |
| `WateringRuns` | **MỚI** | `Id`, `Zone`, `StartedAt`, `EndedAt`, `DurationSec`, `Trigger` ('manual'/'schedule'/'threshold'), `TriggeredBy`, `StopReason` ('normal'/'max-runtime'/'manual-stop'/'offline') |
| `EventLog` | giữ nguyên | |

**Seed**: 10 dòng `PumpState` (Mode mặc định `threshold`), 10 dòng `AutomationRules`, 10 dòng `Devices`
(`AQ-ZONE-01`…`AQ-ZONE-10`, mỗi dòng 1 `ApiKey` ngẫu nhiên).

**Dung lượng** với chu kỳ 30s: ~28.800 dòng/ngày ≈ ~90MB/tháng, giữ vĩnh viễn → sau 1 năm khoảng 1GB.
Không xoá thì **bắt buộc** phải có index đúng (`IX_Telemetry_Zone_Time`) và **downsample khi query** (Mục 4.4),
nếu không trang Overview sẽ chậm dần rồi treo.

---

## 4. Backend

### 4.1 Service mới: `irrigationService.js` — cửa duy nhất để bật/tắt bơm
Mọi chế độ đều đi qua đây, không nơi nào ghi thẳng vào `PumpState`:
```
start(zone, { durationSec, trigger, by })   // ghi PumpState + RunUntilUtc, mở WateringRuns, emit, log
stop(zone, { reason, by })                  // đóng WateringRuns, emit, log
tick()                                      // mỗi 5s: tắt bơm hết RunUntilUtc, cắt bơm chạy quá MaxRunMinutes
```
`tick()` chính là chỗ vá lỗ hổng lớn nhất hiện nay: **bơm không có giới hạn thời gian chạy**.

### 4.2 Service sửa: `automationService.js` (chế độ `threshold`)
- Chỉ xử lý zone có `Mode = 'threshold'`; bỏ qua zone đang có `RunUntilUtc > now` (đang bị ghi đè tay).
- Đổi đầu vào từ `z.soilMoisture` → `min(soil1, soil2, soil3)`; giữ hysteresis đã thêm trong working tree.
- Bỏ toàn bộ nhánh LED.
- Chỉ bật khi bơm đã nghỉ đủ `MinRestMinutes`; bật qua `irrigationService.start(..., trigger:'threshold')`.
- Bỏ qua giá trị soil ngoài 0–100 hoặc NaN — chống cảm biến hỏng làm bơm chạy mãi.

### 4.3 Service mới: `schedulerService.js` (chế độ `schedule`)
`setInterval` 20s: so `StartTime` + `DaysOfWeek` với **giờ Việt Nam (UTC+7)** — quy đổi từ `Date.now()`,
**không dùng đồng hồ local của máy chủ**, để lịch chạy đúng dù server đặt ở Nhật hay ở nhà bạn.
Chỉ xét zone có `Mode = 'schedule'`
và không đang bị ghi đè tay → `irrigationService.start(zone, { durationSec, trigger:'schedule' })`.
Chống chạy trùng bằng cờ "đã chạy trong phút này".

### 4.4 Service mới: `deviceMonitorService.js` + downsample khi query
- Mỗi 30s quét `Devices.LastSeen`; quá 120s → `IsOnline = 0`, log warning, emit `device`.
- **Không có job xoá/gộp dữ liệu** (quyết định #14 — giữ hết). Bù lại, `getHistory()` phải **gom nhóm bằng SQL**
  trước khi trả về, chọn bucket theo khoảng thời gian: 24h → 5 phút, 7d → 30 phút, 30d trở lên → 1 giờ.
  Mỗi biểu đồ chỉ nhận tối đa vài trăm điểm thay vì hàng trăm nghìn dòng thô.

### 4.5 Xác thực thiết bị bằng key riêng — sửa `server/middleware/auth.js`
`requireApiKey` hiện so sánh với `config.deviceApiKey`. Đổi thành: tra `x-api-key` trong bảng `Devices`
(**cache Map trong RAM**, nạp lúc khởi động), rồi gắn `req.device = { deviceId, zone }`.
- Sai key → 401 như cũ.
- Node gửi telemetry cho zone khác với zone của key → từ chối, ghi log warning.
- Giữ `DEVICE_API_KEY` trong `.env` làm **key dự phòng cho `simulate.js`** và công cụ test, chấp nhận mọi zone.

### 4.6 Cache lệnh trong RAM
`GET /api/commands` bị 10 node poll liên tục → giữ bản sao `PumpState` trong Map ở module, chỉ đọc DB
lúc khởi động và khi có thay đổi. Trả thêm `rulesVersion` để node biết khi nào cần tải lại cấu hình.

### 4.7 API sau khi sửa
| Method | Route | Mô tả | Bảo vệ |
|---|---|---|---|
| POST | `/api/telemetry` | `{deviceId, rssi, uptime, zones:[{zone,temperature,airHumidity,soil:[a,b,c]}]}` | ApiKey theo thiết bị |
| GET | `/api/commands?zone=N` | `{zone, pump:{state,mode,durationSec,remainingSec}, rules:{...}, rulesVersion, serverTime}` | ApiKey theo thiết bị |
| POST | `/api/control/water` | **Nút tưới tay**: `{zone, durationSec=60}` — dùng được ở mọi chế độ | session |
| POST | `/api/control/stop` | Dừng bơm zone ngay | session |
| GET/POST | `/api/control` | Trạng thái 10 bơm / đổi Mode (threshold-schedule-manual) | session |
| GET | `/api/telemetry/latest` \| `/history` | history **downsample bằng SQL** theo bucket thời gian | session |
| GET | `/api/devices` | Trạng thái online 10 node | session |
| GET/POST/PUT/DELETE | `/api/schedules` | CRUD lịch tưới | session |
| GET/PUT | `/api/rules`, `/api/rules/:zone` | Ngưỡng, hysteresis, MaxRunMinutes, MinRestMinutes | session |
| GET | `/api/stats/watering` | Số lần tưới / tổng phút bơm theo zone theo ngày | session |
| GET | `/api/export/csv`, `/preview` | Thêm cột Soil1/2/3, bỏ Light | session |
| GET/DELETE | `/api/logs` | thêm phân trang | session |
| ~~/api/camera/*~~ | | **xoá toàn bộ** | |

### 4.8 Socket.IO
Event: `telemetry` (1 zone/lần), `pump` (thay `actuator`, kèm `remainingSec`), `device` (online/offline), `log`.

---

## 5. Frontend

| Trang | Việc cần làm |
|---|---|
| **Overview** (`index.html`) | Lưới **10 zone** (`grid-cols-2 md:grid-cols-3 xl:grid-cols-5`). Mỗi card: "Zone N", chip online/offline, nhiệt độ + ẩm không khí, **3 thanh nhỏ cho 3 chậu** (chậu khô nhất tô đỏ), trạng thái bơm + **đếm ngược**, nút **"Water 60s"** ngay trên card (luôn bật) |
| **Sensors** | Bảng 10 zone × (T, RH, Soil1, Soil2, Soil3, Min, thời gian) + export CSV |
| **Control** | 10 thẻ bơm: chọn chế độ bằng **3 nút Threshold / Schedule / Manual**, nút Water (chọn 30/60/120s), nút Stop |
| **Schedules** (MỚI) | Danh sách lịch + form thêm/sửa/xoá: zone, ngày trong tuần, giờ, thời lượng (mặc định 60s), bật/tắt |
| **Configuration** | 10 thẻ: ngưỡng độ ẩm, hysteresis, MaxRunMinutes, MinRestMinutes, bật/tắt. **Bỏ ô Light threshold** |
| **Logs** | Giữ + phân trang |
| ~~Camera~~ | **Xoá trang + mục nav + `camera.js`** |
| `common.js` | `NAV_ITEMS`: bỏ Camera, thêm Schedules; chip "System: Online" nối vào `/api/devices` thật thay vì chữ cứng |
| Biểu đồ | 10 đường quá rối → cho chọn tối đa 3–4 zone để so sánh; dữ liệu đã downsample từ server |

Giữ design system "HydroLogic Intelligence" (`.glass-card`, Inter, primary `#003d9b`) và quy ước ngôn ngữ
trong `CLAUDE.md`: **text hiển thị tiếng Anh, comment tiếng Việt**.

---

## 6. Firmware — `firmware/zone-node/zone-node.ino` (1 file, nạp cho cả 10 con)

- Đầu file chỉ sửa: `ZONE_ID`, `WIFI_SSID/PASS`, `SERVER_BASE`, `API_KEY` (key riêng của node đó).
- Chân đề xuất: Soil 1/2/3 = GPIO **32/33/34** (ADC1), DHT22 = GPIO **4** (trở kéo 10kΩ),
  Relay bơm = GPIO **25** (active-LOW, đặt HIGH trước `pinMode`).
- POST telemetry mỗi **30s**, GET lệnh mỗi **5s**.
- **Tự đếm ngược `durationSec`** và tự tắt — không phụ thuộc server.
- **Failsafe**: > 3 phút không gọi được server → tắt bơm.
- Cache ngưỡng vào NVS → mất mạng vẫn tưới theo ngưỡng cục bộ.
- Lọc NaN của DHT22, kẹp giá trị soil về 0–100.

File `firmware/esp32/esp32.ino` hiện tại (3 zone, có LED + cảm biến ánh sáng) sẽ được thay bằng file này.

---

## 7. Dọn dẹp

**Xoá**: `ai-service/` (toàn bộ), `server/routes/camera.js`, `server/public/camera.html`,
`server/public/js/camera.js`, `server/public/captures/`, route `/captures` và `/api/camera` trong `app.js`,
biến `ESP32CAM_*` + `AI_SERVICE_URL` trong `config.js` và `.env.example`.

**Cập nhật**: `CLAUDE.md` (mô tả hệ thống mới + hợp đồng dữ liệu mới), `README.md`, `HOSTING.md` (bỏ camera/AI),
`server/scripts/simulate.js` (**giả lập 10 node gửi song song, chu kỳ 30s** — công cụ test chính),
`.env.example` (đủ biến mới, để máy host dựng lại được), `firmware/PLAN.md` + `HUONG_DAN.md`.

**Lưu ý**: `firmware/esp32/esp32.ino` đang untracked và 2 thay đổi trong working tree (hysteresis + CSS switch)
chưa commit → nên commit trước khi bắt đầu để có điểm quay lui.

---

## 8. Thứ tự thực hiện

| Phase | Nội dung | Phụ thuộc |
|---|---|---|
| **0** | Commit trạng thái hiện tại | — |
| **1** | Viết lại `db/schema.sql` (10 zone, 3 bảng mới, đường dẫn file DB linh hoạt) + chạy SSMS + `npm run seed` | — |
| **2** | Backend core: `telemetryService`, `irrigationService`, `PumpState`, auth theo key riêng, commands cache, API control/water | Phase 1 |
| **3** | Tự động + an toàn: `automationService` (min-soil, mode threshold), `schedulerService` (UTC+7), `deviceMonitorService`, downsample history | Phase 2 |
| **4** | Frontend: Overview 10 zone, Control 3 chế độ, Schedules, Configuration, Stats, xoá Camera | Phase 2–3 |
| **5** | Firmware `zone-node.ino` (phương án A) | Phase 2 |
| **6** | Dọn dẹp + cập nhật tài liệu | Cuối |

Phase 1–4 làm và test đầy đủ bằng `simulate.js` **trước khi** đụng phần cứng thật.
Hai việc của bạn chạy song song, không chặn Phase nào: **đo sóng WiFi tại 10 vị trí zone**, và
**kiểm tra PC cá nhân có làm host được không**.

---

## 9. Kiểm thử

1. `npm run simulate` (bản mới) giả lập 10 node → 10 card hiện đủ, realtime chạy, biểu đồ có dữ liệu.
2. **Chế độ threshold**: ép 1 chậu của zone 3 xuống 20% → bơm zone 3 bật (min-soil), 2 chậu kia vẫn ẩm;
   đẩy lên 45% → tắt (hysteresis). Zone đang ở `schedule` thì **không** bật dù đất khô.
3. **Chế độ manual**: bấm "Water 60s" → bơm bật, đếm ngược trên UI, tự tắt sau 60s, `WateringRuns` ghi 1 dòng.
4. **Ghi đè tạm thời**: zone đang `threshold`, bấm Water 60s → automation không can thiệp trong 60s,
   sau đó zone tự quay lại chạy theo ngưỡng, `Mode` vẫn là `threshold`.
5. **Chế độ schedule**: tạo lịch chạy sau 1 phút → bơm bật đúng giờ, đúng 60s.
6. **An toàn — MaxRunMinutes**: giả lập cảm biến hỏng (soil luôn 5%) → bơm bị cắt sau 5 phút, log `max-runtime`.
7. **An toàn — offline**: dừng simulate 1 node → sau 2 phút UI báo offline, có log warning.
8. **API key riêng**: dùng key của zone 1 gửi dữ liệu zone 2 → bị từ chối, có log.
9. **Tải**: 10 node poll đồng thời → CPU/SQL không tăng bất thường (nhờ cache RAM).
10. **CSV**: xuất và mở bằng Excel, đủ cột Soil1/2/3, không còn cột Light.

---

## 10. Trạng thái quyết định

**Không còn câu hỏi nào đang mở** — toàn bộ 15 quyết định đã chốt ở Mục 1b.

Hai việc thuộc phần bạn làm, chạy song song với việc code:

| Việc | Vì sao cần | Hạn chót |
|---|---|---|
| Đo sóng WiFi tại 10 vị trí zone | Phương án A yêu cầu cả 10 node bắt được WiFi. Zone nào yếu thì phải thêm repeater trước khi lắp | Trước khi lắp phần cứng |
| Kiểm tra PC cá nhân làm host được không | Quyết định nơi deploy cuối cùng | Trước khi deploy |
