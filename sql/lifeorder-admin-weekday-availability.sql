begin;

update consultants
   set accepting = true,
       meet_tool = 'Zoom',
       time_zone = 'Asia/Taipei',
       interval_minutes = 60,
       buffer_before = 0,
       buffer_after = 0,
       min_days = 1,
       max_days = 14,
       project_codes = array['ALL']::text[]
 where tenant_slug = 'lifeorder'
   and login_email = 'nanako.lifeorder@gmail.com';

delete from availability_rules
 where tenant_slug = 'lifeorder'
   and consultant_id = (
     select id
       from consultants
      where tenant_slug = 'lifeorder'
        and login_email = 'nanako.lifeorder@gmail.com'
   );

insert into availability_rules(
  tenant_slug, consultant_id, kind, day_of_week, start_time, end_time
)
select 'lifeorder', id, 'weekly', weekday, '09:00', '17:00'
  from consultants
 cross join unnest(array[1, 2, 3, 4, 5]) as weekday
 where tenant_slug = 'lifeorder'
   and login_email = 'nanako.lifeorder@gmail.com';

commit;
