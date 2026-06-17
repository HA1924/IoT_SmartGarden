// Tạo (hoặc cập nhật) tài khoản admin với mật khẩu hash bcrypt.
// Dùng:  npm run seed            -> tạo admin / admin123 (mặc định)
//        node server/scripts/seedAdmin.js <username> <password>
const bcrypt = require('bcryptjs');
const { query, getPool } = require('../db');

async function main() {
  const username = process.argv[2] || 'admin';
  const password = process.argv[3] || 'admin123';

  const hash = await bcrypt.hash(password, 10);

  // MERGE: có thì cập nhật mật khẩu, chưa có thì thêm mới.
  await query(
    `MERGE dbo.Users AS target
     USING (SELECT @u AS Username) AS src
       ON target.Username = src.Username
     WHEN MATCHED THEN
       UPDATE SET PasswordHash = @h
     WHEN NOT MATCHED THEN
       INSERT (Username, PasswordHash, Role) VALUES (@u, @h, 'admin');`,
    { u: username, h: hash }
  );

  console.log(`✔ Đã tạo/cập nhật admin: ${username} / ${password}`);
  console.log('  (Hãy đổi mật khẩu này trước khi dùng thật.)');
}

main()
  .catch((err) => {
    console.error('Lỗi seed admin:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    const pool = await getPool().catch(() => null);
    if (pool) await pool.close();
  });
