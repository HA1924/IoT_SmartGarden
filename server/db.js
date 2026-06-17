// Quản lý connection pool tới SQL Server bằng driver `mssql`.
// Dùng 1 pool dùng chung cho toàn app (khuyến nghị của mssql).
const sql = require('mssql');
const config = require('./config');

let poolPromise = null;

/**
 * Lấy connection pool (tạo lần đầu, sau đó tái dùng).
 * @returns {Promise<sql.ConnectionPool>}
 */
function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config.db)
      .connect()
      .then((pool) => {
        console.log('[db] Đã kết nối SQL Server:', config.db.server, '/', config.db.database);
        return pool;
      })
      .catch((err) => {
        // Reset để lần gọi sau thử kết nối lại
        poolPromise = null;
        console.error('[db] Lỗi kết nối SQL Server:', err.message);
        throw err;
      });
  }
  return poolPromise;
}

/**
 * Tiện ích chạy query có tham số.
 * @param {string} text - câu SQL, dùng @param
 * @param {Object} params - { tên: giá trị }  (tự suy kiểu cơ bản)
 */
async function query(text, params = {}) {
  const pool = await getPool();
  const request = pool.request();
  for (const [key, value] of Object.entries(params)) {
    request.input(key, value);
  }
  return request.query(text);
}

module.exports = { sql, getPool, query };
