DM Booking SaaS 中央版

這份專案把原本「每個客戶都要安裝 GAS + Systeme 代碼」的模式，改成：

1. 核心代碼集中放在你自己的 GitHub / Vercel。
2. 資料集中放在一個 Postgres 資料庫，靠 tenant 區分不同客戶。
3. 客戶 Systeme / ClickFunnels 頁面只貼 iframe 安裝碼。
4. 每位顧問透過 Google OAuth 連接自己的 Calendar / Meet。
5. 之後維護只要更新 GitHub，Vercel 會重新部署中央版本。

重要檔案：

- public/booking.html：客人看的預約頁。
- public/admin.html：客戶使用的後台。
- public/embed.js：舊版 inline script 嵌入保留相容；新安裝以 iframe 為主。
- api/index.js：中央 API 入口。
- api/oauth-callback.js：Google OAuth 回呼。
- lib/*.js：資料庫、登入、OAuth、時段、預約邏輯。
- sql/schema.sql：第一次建立資料庫表格要執行的 SQL。
- snippets/systeme_booking_install.txt：貼到 Systeme 預約頁的安裝碼。
- snippets/systeme_admin_install.txt：貼到 Systeme 後台頁的安裝碼。
- docs/deployment_guide_zh.txt：GitHub / Vercel / Google OAuth 手把手教學。
- docs/migration_status_zh.txt：這次已移植與後續要補的功能清單。

請不要把真正的 .env、Google Client Secret、DATABASE_URL、JWT_SECRET 上傳到 GitHub。
真正的密鑰只放在 Vercel 的 Environment Variables。
