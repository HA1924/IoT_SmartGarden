// Giữ tham chiếu Socket.IO server để các service/route emit sự kiện realtime.
let io = null;

function setIo(instance) {
  io = instance;
}

/**
 * Phát sự kiện tới tất cả client dashboard đang mở.
 * @param {string} event - vd 'telemetry', 'camera', 'actuator'
 * @param {*} payload
 */
function emit(event, payload) {
  if (io) io.emit(event, payload);
}

module.exports = { setIo, emit };
