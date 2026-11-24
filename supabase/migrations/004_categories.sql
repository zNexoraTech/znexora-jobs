-- =============================================================
-- 004: industry categories ("robot" sorting)
--   * jobs.category: chosen in the form, or detected automatically from the
--     title/description (English, Japanese, Burmese keywords) when left empty
--   * job_alerts.category: seekers can get alerts for one industry
-- Run AFTER 001, 002, 003.
-- =============================================================

create or replace function public.valid_category(c text)
returns boolean language sql immutable as $$
  select c is null or c in ('restaurant','care','factory','construction','retail','hotel','cleaning',
                            'logistics','it','office','agriculture','education','other');
$$;

-- Keyword robot: first matching industry wins (order matters)
create or replace function public.guess_category(title text, description text)
returns text language plpgsql immutable as $$
declare
  s text := coalesce(title, '') || ' ' || coalesce(description, '');
  t text := coalesce(title, '');
begin
  -- the title is the strongest signal, so check it alone first, then title + description
  foreach s in array array[t, s] loop
    if s ~* '介護|ヘルパー|看護|nursing|caregiver|care ?worker|care home|elderly|စောင့်ရှောက်' then return 'care'; end if;
    if s ~* '飲食|レストラン|キッチン|調理|ホール|居酒屋|カフェ|ラーメン|restaurant|kitchen|cook|chef|waiter|waitress|dish|barista|cafe|စားသောက်ဆိုင်|ချက်ပြုတ်|စားဖို' then return 'restaurant'; end if;
    if s ~* 'ホテル|旅館|宿泊|フロント|ベッドメイク|hotel|ryokan|housekeep|front desk|ဟိုတယ်' then return 'hotel'; end if;
    if s ~* '清掃|ビルクリーニング|クリーンスタッフ|cleaning|cleaner|janitor|သန့်ရှင်းရေး' then return 'cleaning'; end if;
    if s ~* '建設|建築|土木|解体|現場作業|内装|塗装|鳶|construction|carpenter|scaffold|demolition|civil engineering|ဆောက်လုပ်ရေး' then return 'construction'; end if;
    if s ~* '倉庫|物流|配送|ドライバー|ピッキング|仕分け|梱包|運送|warehouse|logistics|delivery|driver|picking|packing|forklift|ဂိုဒေါင်|ကားမောင်း|ပစ္စည်းပို့' then return 'logistics'; end if;
    if s ~* '工場|製造|組立|ライン作業|検品|加工|溶接|factory|manufactur|assembly|production line|machine operator|welding|စက်ရုံ' then return 'factory'; end if;
    if s ~* '農業|農園|漁業|林業|畜産|farm|agricultur|fishery|fishing|forestry|စိုက်ပျိုး|လယ်|ငါးဖမ်း' then return 'agriculture'; end if;
    if s ~* 'コンビニ|販売|レジ|スーパー|ドラッグストア|店舗スタッフ|convenience store|retail|cashier|shop staff|sales assistant|supermarket|ဆိုင်ဝန်ထမ်း|အရောင်း' then return 'retail'; end if;
    if s ~ '(^|[^A-Za-z])IT([^A-Za-z]|$)|ＩＴ' or s ~* 'エンジニア|プログラマ|開発|インフラ|developer|software|programmer|web engineer|network engineer|devops|security engineer|data engineer|ဆော့ဖ်ဝဲ|ပရိုဂရမ်' then return 'it'; end if;
    if s ~* '講師|教師|先生|塾|teacher|tutor|instructor|language school|ဆရာ' then return 'education'; end if;
    if s ~* '事務|通訳|翻訳|営業|受付|経理|総務|office|admin|interpreter|translator|sales|reception|accounting|customer support|ရုံး|စကားပြန်|ဘာသာပြန်' then return 'office'; end if;
  end loop;
  return 'other';
end;
$$;

alter table public.jobs add column category text check (public.valid_category(category));
create index jobs_category_idx on public.jobs (category, status, created_at desc);

create or replace function public.set_job_category()
returns trigger language plpgsql as $$
begin
  if new.category is null or new.category = '' then
    new.category := public.guess_category(new.title, new.description);
  end if;
  return new;
end;
$$;
create trigger jobs_category before insert or update on public.jobs
  for each row execute function public.set_job_category();

-- Sort existing jobs once
update public.jobs set category = public.guess_category(title, description) where category is null;

alter table public.job_alerts add column category text check (public.valid_category(category));
