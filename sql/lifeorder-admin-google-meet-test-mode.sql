update consultants
   set accepting = true,
       meet_tool = 'Google Meet'
 where tenant_slug = 'lifeorder'
   and login_email = 'nanako.lifeorder@gmail.com';
