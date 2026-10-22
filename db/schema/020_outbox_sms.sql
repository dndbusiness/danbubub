-- SMS ללקוח (קישור לחתימה) דרך SLNG — ערוץ נוסף בתור היציאה (הנחיה 16). לא הרסני: רק מרחיב את הרשימה.
alter table outbox drop constraint if exists outbox_channel_check;
alter table outbox add constraint outbox_channel_check
  check (channel in ('email', 'whatsapp', 'calendar', 'drive', 'sheets', 'gmail_forward', 'sms'));
