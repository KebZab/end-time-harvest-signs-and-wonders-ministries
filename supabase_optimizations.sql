-- Apply after supabase_schema.sql. Small metadata notices; never stream verse bodies.
CREATE TABLE IF NOT EXISTS public.library_state (
 id integer PRIMARY KEY CHECK(id=1), revision bigint NOT NULL DEFAULT 0,
 entity text NOT NULL DEFAULT '', operation text NOT NULL DEFAULT '',
 ids bigint[] NOT NULL DEFAULT '{}', sermon_ids bigint[] NOT NULL DEFAULT '{}',
 position_only boolean NOT NULL DEFAULT false
);
INSERT INTO public.library_state(id) VALUES(1) ON CONFLICT DO NOTHING;
ALTER TABLE public.library_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.library_state FROM anon,authenticated;
GRANT SELECT ON public.library_state TO anon,authenticated;
DROP POLICY IF EXISTS public_library_state ON public.library_state;
CREATE POLICY public_library_state ON public.library_state FOR SELECT TO anon,authenticated USING(true);
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.notify_library_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed_ids bigint[]; affected bigint[]; positions boolean := false;
BEGIN
 IF TG_OP='DELETE' THEN
  SELECT array_agg(id) INTO changed_ids FROM old_rows;
  IF TG_TABLE_NAME='verses' THEN SELECT array_agg(DISTINCT sermon_id) INTO affected FROM old_rows;
  ELSE affected := changed_ids; END IF;
 ELSE
  SELECT array_agg(id) INTO changed_ids FROM new_rows;
  IF TG_TABLE_NAME='verses' THEN
   IF TG_OP='UPDATE' THEN
    SELECT array_agg(DISTINCT sermon_id) INTO affected FROM
      (SELECT sermon_id FROM new_rows UNION SELECT sermon_id FROM old_rows) a;
    SELECT bool_and((to_jsonb(n)-'position')=(to_jsonb(o)-'position')) INTO positions
      FROM new_rows n JOIN old_rows o USING(id);
   ELSE SELECT array_agg(DISTINCT sermon_id) INTO affected FROM new_rows; END IF;
  ELSE affected := changed_ids; END IF;
 END IF;
 IF changed_ids IS NULL THEN RETURN NULL; END IF;
 -- Large imports/reorders use a bounded invalidate notice.
 UPDATE public.library_state SET revision=revision+1,entity=TG_TABLE_NAME,operation=TG_OP,
  ids=CASE WHEN cardinality(changed_ids)<=100 THEN changed_ids ELSE '{}'::bigint[] END,
  sermon_ids=CASE WHEN cardinality(affected)<=100 THEN affected ELSE '{}'::bigint[] END,
  position_only=coalesce(positions,false) WHERE id=1;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.notify_library_change() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS library_sermons_insert ON public.sermons;
CREATE TRIGGER library_sermons_insert AFTER INSERT ON public.sermons REFERENCING NEW TABLE AS new_rows
 FOR EACH STATEMENT EXECUTE FUNCTION private.notify_library_change();
DROP TRIGGER IF EXISTS library_sermons_update ON public.sermons;
CREATE TRIGGER library_sermons_update AFTER UPDATE ON public.sermons REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
 FOR EACH STATEMENT EXECUTE FUNCTION private.notify_library_change();
DROP TRIGGER IF EXISTS library_sermons_delete ON public.sermons;
CREATE TRIGGER library_sermons_delete AFTER DELETE ON public.sermons REFERENCING OLD TABLE AS old_rows
 FOR EACH STATEMENT EXECUTE FUNCTION private.notify_library_change();
DROP TRIGGER IF EXISTS library_verses_insert ON public.verses;
CREATE TRIGGER library_verses_insert AFTER INSERT ON public.verses REFERENCING NEW TABLE AS new_rows
 FOR EACH STATEMENT EXECUTE FUNCTION private.notify_library_change();
DROP TRIGGER IF EXISTS library_verses_update ON public.verses;
CREATE TRIGGER library_verses_update AFTER UPDATE ON public.verses REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
 FOR EACH STATEMENT EXECUTE FUNCTION private.notify_library_change();
DROP TRIGGER IF EXISTS library_verses_delete ON public.verses;
CREATE TRIGGER library_verses_delete AFTER DELETE ON public.verses REFERENCING OLD TABLE AS old_rows
 FOR EACH STATEMENT EXECUTE FUNCTION private.notify_library_change();
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime'
  AND schemaname='public' AND tablename='library_state') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.library_state;
 END IF;
END $$;

-- Search on the server and return a bounded page of metadata, not scripture bodies.
CREATE OR REPLACE FUNCTION public.search_sermon_library(p_query text DEFAULT '',p_offset integer DEFAULT 0,p_limit integer DEFAULT 26)
RETURNS TABLE(id bigint,title text,pastor text,sermon_date date,updated_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT s.id,s.title,s.pastor,s.sermon_date,s.updated_at FROM public.sermons s
 WHERE coalesce(trim(p_query),'')='' OR
  strpos(lower(s.title||' '||s.pastor||' '||s.sermon_date::text||' '||s.description),lower(left(trim(p_query),200)))>0
  OR EXISTS(SELECT 1 FROM public.verses v WHERE v.sermon_id=s.id AND
   strpos(lower(v.book||' '||v.chapter::text||':'||coalesce(nullif(v.verse_list,''),v.verse_start::text,'')
    ||' '||v.note||' '||v.verse_text),lower(left(trim(p_query),200)))>0)
 ORDER BY s.sermon_date DESC,s.id DESC
 OFFSET greatest(0,coalesce(p_offset,0)) LIMIT least(26,greatest(1,coalesce(p_limit,26)))
$$;
REVOKE ALL ON FUNCTION public.search_sermon_library(text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_sermon_library(text,integer,integer) TO anon,authenticated;

-- One round trip, with the parent locked to keep simultaneous appends ordered.
CREATE OR REPLACE FUNCTION public.append_sermon_verses(p_sermon_id bigint,p_verses jsonb)
RETURNS SETOF public.verses LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE start_position integer;
BEGIN
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.sermons WHERE id=p_sermon_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sermon not found'; END IF;
 SELECT coalesce(max(position),-1)+1 INTO start_position FROM public.verses WHERE sermon_id=p_sermon_id;
 RETURN QUERY INSERT INTO public.verses(sermon_id,book,chapter,verse_start,verse_end,verse_list,translation,verse_text,highlights,note,position)
 SELECT p_sermon_id,v->>'book',(v->>'chapter')::integer,(v->>'verse_start')::integer,(v->>'verse_end')::integer,
 coalesce(v->>'verse_list',''),coalesce(v->>'translation','KJV'),coalesce(v->>'verse_text',''),
 coalesce(v->'highlights','[]'::jsonb),coalesce(v->>'note',''),start_position+(ord-1)::integer
 FROM jsonb_array_elements(p_verses) WITH ORDINALITY a(v,ord)
 RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.append_sermon_verses(bigint,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.append_sermon_verses(bigint,jsonb) TO authenticated;

