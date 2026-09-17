-- Refocus Life Order FULL "family culture" on shared family life:
-- education, values, rules, responsibilities, and daily rituals.

begin;

update quiz_score_dimensions
   set description = '檢視教育方式、家庭價值、共同規則、角色分工與生活習慣是否被說清楚並持續實踐。',
       updated_at = now()
 where tenant_slug = 'lifeorder'
   and project_code = 'LO'
   and version_code = 'FULL'
   and dimension_key = 'family_culture';

update quiz_score_ranges as target
   set label = source.label,
       title = source.title,
       subtitle = source.subtitle,
       body = source.body,
       updated_at = now()
  from (
    values
      ('low',
       '目前最需要注意',
       '家庭常被放到忙完以後',
       '工作、責任和臨時狀況一多，家庭很容易只剩下需要處理的事。',
       $$接送、回訊息、付費、照顧都在進行；一家人想怎麼生活、哪些事值得優先留給彼此，卻很少有時間好好談。

孩子遇到問題怎麼陪、家務和照顧怎麼分、金錢怎麼安排、衝突怎麼面對，常在事情發生後才各自處理。家庭裡每個人都在努力，卻少了一套能一起依循的方式。

先保留一個最常被忙碌擠掉的家庭時刻，從一次固定吃飯、每週對話或一條共同規則開始。$$),
      ('mid',
       '已有基礎，下一步要讓彼此更有共識',
       '家庭有默契，還需要讓共識更穩',
       '你們已有自己的相處方式，也知道彼此在意什麼。',
       $$工作、照顧、金錢與不同角色同時靠近時，原本的默契容易被日常節奏沖淡。

孩子犯錯怎麼陪、誰負責哪些事、重要開支怎麼談、哪些時間留給家人，仍需要反覆協調。當共同原則沒有被說清楚，最能扛的人往往會承擔更多判斷與提醒。

挑一項最常重複協調的事，整理成每個人都聽得懂、做得到的約定。$$),
      ('high',
       '狀態清楚，適合整理成可延續的家庭共識',
       '家庭已被放進共同的人生安排',
       '你們的家庭責任、生活方式與重要價值已有清楚輪廓。',
       $$家人知道這個家重視什麼、遇到事情怎麼談、誰負責什麼，也有一些值得保留的相處習慣。

即使工作很忙、家庭角色持續改變，大家仍有時間回來確認彼此的需求與安排。這份共識讓家庭生活更有方向，也讓下一代能理解自己是在什麼樣的價值裡長大。

隨著孩子、長輩與工作階段改變，定期更新分工、規則與相處方式，讓家庭共識持續貼近現在的生活。$$)
  ) as source(range_key, label, title, subtitle, body)
 where target.tenant_slug = 'lifeorder'
   and target.project_code = 'LO'
   and target.version_code = 'FULL'
   and target.dimension_key = 'family_culture'
   and target.range_key = source.range_key;

update quiz_age_dimension_contents as target
   set body = source.body,
       action_text = source.action_text,
       updated_at = now()
  from (
    values
      ('under_35',
       $$這個階段不需要急著複製原生家庭，也不必急著定下未來所有規則。比較重要的是，開始看見哪些相處方式想保留，哪些想換一種做法。

放到「家文化」來看，重點是：當你與伴侶、家人或未來的孩子一起生活時，希望大家怎麼說話、怎麼分工、怎麼面對犯錯與做決定。$$,
       '先寫下一句你想帶進自己家庭的原則，例如：有問題先說，不用靠猜。'),
      ('35_45',
       $$這個階段常同時面對工作、伴侶、孩子與原生家庭。最容易累的往往不是事情多，而是每個人都以為你知道該怎麼做。

放到「家文化」來看，重點是把教養、家務、照顧、金錢與相處時間的期待說清楚，讓家庭不是只靠最能扛的人撐住。$$,
       '找一件最近常重複協調的事，和家人訂出一個大家做得到的分工或規則。'),
      ('45_55',
       $$這個階段常要同時照顧下一代、支持長輩，也重新安排自己的生活。若家庭裡沒有共同原則，很多決定很容易全落在少數人身上。

放到「家文化」來看，重點是一起談清楚：健康、金錢、照顧、教育與時間，這個家現在最重視什麼，又該怎麼分工。$$,
       '安排一次家庭對話，先談一件最需要共識的事，而不是一次處理所有問題。'),
      ('55_65',
       $$這個階段常伴隨角色轉換：孩子更獨立、長輩需要更多照顧，自己也開始思考往後想怎麼生活。

放到「家文化」來看，重點是讓家人知道彼此的期待與界線。家庭規則可以調整，但重要價值、責任與照顧方式要有地方能說清楚。$$,
       '把一項新的家庭角色或照顧安排談清楚：誰負責、需要什麼協助、遇到變化找誰商量。'),
      ('65_75',
       $$這個階段適合把一路累積的經驗與價值，從「我心裡知道」變成家人能一起使用的共識。

放到「家文化」來看，不只留下故事，也留下你怎麼看責任、健康、金錢、關係與孩子成長；這些能幫家人理解你，也讓下一代有可參考的方向。$$,
       '選一個家人都會碰到的主題，分享你的經驗與期待，並聽聽下一代怎麼想。'),
      ('75_plus',
       $$這個階段的家文化，不需要變成一份厚重的家訓。最重要的是讓家人知道：你珍惜什麼、希望大家怎麼互相照顧，以及哪些生活習慣想繼續留著。

這些話若能被說出來，家人以後遇到選擇時，就不只是在猜你的心意。$$,
       '留下一段簡短的話：這個家最希望大家一直記得、一直做到的是什麼。')
  ) as source(age_group, body, action_text)
 where target.tenant_slug = 'lifeorder'
   and target.project_code = 'LO'
   and target.version_code = 'FULL'
   and target.dimension_key = 'family_culture'
   and target.age_group = source.age_group;

commit;
