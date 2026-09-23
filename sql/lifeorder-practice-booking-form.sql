begin;

insert into projects(tenant_slug, code, name, status, main_url, fallback_url, booking_notice, reject_type, reject_value)
values (
  'lifeorder',
  'LOP',
  '人生秩序完整實踐計畫',
  '啟用',
  '',
  '',
  $notice$
請填寫表單申請「人生秩序完整實踐計畫」諮詢。

注意 1：顧問時間與名額有限；若無法準時出席，請先不要預約。無故缺席者，團隊將不再安排本計畫的諮詢時段。

注意 2：申請資料不完整時，團隊無法判斷目前是否適合安排諮詢；請依實際情況完整填寫，避免失去本次資格。

注意 3：完成日期與時間選擇後，請先不要離開畫面。系統會顯示預約成功與下一步資訊。

如有填寫問題，請聯繫 LINE 官方客服：
https://line.me/R/ti/p/@492ktjwp
$notice$,
  'text',
  ''
);

insert into questions(tenant_slug, project_code, sort_order, title, type, options, reject_word, is_required)
values
  ('lifeorder', 'LOP', 10,
   '請簡單說明，目前你最想整理或推進的生活、家庭或人生議題是什麼？',
   '簡答', '[]'::jsonb, '', true),
  ('lifeorder', 'LOP', 20,
   '請參考你的「人生秩序 11 面向雷達圖」，寫下分數最高與最低的各一項，以及你對這兩個面向目前狀態的感覺。',
   '簡答', '[]'::jsonb, '', true),
  ('lifeorder', 'LOP', 30,
   '你希望透過「人生秩序完整實踐計畫」，在接下來 30 天先完成什麼改變？',
   '簡答', '[]'::jsonb, '', true),
  ('lifeorder', 'LOP', 40,
   '針對這個目標，你目前最難靠自己推進的是什麼？',
   '簡答', '[]'::jsonb, '', true),
  ('lifeorder', 'LOP', 50,
   '這個計畫需要投入 2 天深度課程與 30 天實踐。你目前準備好為自己的生活安排與改變投入多少？',
   '單選', '["我還在了解，暫時不適合投入","我願意先了解完整方案，確認適合度後做決定","我已準備好為自己安排時間與資源"]'::jsonb, '', true),
  ('lifeorder', 'LOP', 60,
   '如果經過諮詢確認適合，你最快可以什麼時候開始？',
   '單選', '["這一期即可開始","1 個月內可以安排","3 個月內規劃開始","目前只想先了解"]'::jsonb, '', true),
  ('lifeorder', 'LOP', 70,
   '還有什麼想讓娜娜子老師先知道的嗎？',
   '簡答', '[]'::jsonb, '', false),
  ('lifeorder', 'LOP', 80,
   '請再次確認：我已照實且完整填寫以上資料；若獲得預約資格，會準時出席諮詢。',
   '單選', '["是，我已確認"]'::jsonb, '', true);

commit;
