SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER SCHEMA public OWNER TO postgres;
COMMENT ON SCHEMA public IS '';

SET default_tablespace = '';
SET default_table_access_method = heap;

CREATE TABLE public.audit_logs (
    id character varying NOT NULL,
    space_id character varying,
    user_id character varying,
    action character varying,
    entity_type character varying,
    entity_id character varying,
    details jsonb,
    created_at timestamp without time zone DEFAULT now()
);
ALTER TABLE public.audit_logs OWNER TO postgres;

CREATE TABLE public.comments (
    id character varying NOT NULL,
    issue_id character varying,
    user_id character varying,
    body text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
ALTER TABLE public.comments OWNER TO postgres;

CREATE TABLE public.custom_fields (
    id character varying NOT NULL,
    space_id character varying,
    name character varying NOT NULL,
    field_type character varying DEFAULT 'text'::character varying,
    options jsonb DEFAULT '[]'::jsonb,
    is_required boolean DEFAULT false,
    "position" integer DEFAULT 0,
    show_in text[] DEFAULT '{drawer}'::text[],
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT custom_fields_field_type_check CHECK (((field_type)::text = ANY ((ARRAY['text'::character varying, 'textarea'::character varying, 'number'::character varying, 'date'::character varying, 'select'::character varying, 'multi_select'::character varying, 'user'::character varying, 'checkbox'::character varying])::text[])))
);
ALTER TABLE public.custom_fields OWNER TO postgres;

CREATE TABLE public.invitations (
    id character varying NOT NULL,
    email character varying NOT NULL,
    org_id character varying,
    invited_by character varying,
    role character varying DEFAULT 'member'::character varying,
    token character varying NOT NULL,
    status character varying DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    expires_at timestamp without time zone,
    CONSTRAINT invitations_role_check CHECK (((role)::text = ANY ((ARRAY['owner'::character varying, 'admin'::character varying, 'member'::character varying])::text[]))),
    CONSTRAINT invitations_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'expired'::character varying, 'cancelled'::character varying])::text[])))
);
ALTER TABLE public.invitations OWNER TO postgres;

CREATE TABLE public.issue_attachments (
    id character varying NOT NULL,
    issue_id character varying,
    filename character varying NOT NULL,
    original_name character varying NOT NULL,
    size bigint DEFAULT 0,
    mime_type character varying,
    uploaded_by character varying,
    created_at timestamp without time zone DEFAULT now()
);
ALTER TABLE public.issue_attachments OWNER TO postgres;

CREATE TABLE public.issue_field_values (
    id character varying NOT NULL,
    issue_id character varying,
    field_id character varying,
    value text
);
ALTER TABLE public.issue_field_values OWNER TO postgres;

CREATE TABLE public.issue_history (
    id character varying NOT NULL,
    issue_id character varying,
    user_id character varying,
    field_name character varying NOT NULL,
    old_value text,
    new_value text,
    created_at timestamp without time zone DEFAULT now()
);
ALTER TABLE public.issue_history OWNER TO postgres;

CREATE TABLE public.issue_links (
    id character varying NOT NULL,
    source_id character varying,
    target_id character varying,
    link_type character varying DEFAULT 'relates_to'::character varying,
    created_at timestamp without time zone DEFAULT now()
);
ALTER TABLE public.issue_links OWNER TO postgres;

CREATE TABLE public.issues (
    id character varying NOT NULL,
    space_id character varying,
    sprint_id character varying,
    parent_id character varying,
    key character varying,
    title character varying NOT NULL,
    description text,
    type character varying DEFAULT 'task'::character varying,
    status character varying DEFAULT 'To Do'::character varying,
    priority character varying DEFAULT 'medium'::character varying,
    assignee_id character varying,
    reporter_id character varying,
    story_points integer,
    labels text[] DEFAULT '{}'::text[],
    start_date date,
    due_date date,
    original_estimate integer DEFAULT 0,
    time_spent integer DEFAULT 0,
    "position" integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    fix_description text,
    deleted_at timestamp without time zone,
    team character varying(50),
    product_type character varying(50),
    deleted_by uuid,
    CONSTRAINT issues_priority_check CHECK (((priority)::text = ANY ((ARRAY['highest'::character varying, 'high'::character varying, 'medium'::character varying, 'low'::character varying, 'lowest'::character varying])::text[]))),
    CONSTRAINT issues_status_check CHECK (((status)::text = ANY ((ARRAY['To Do'::character varying, 'In Progress'::character varying, 'In Review'::character varying, 'Done'::character varying])::text[]))),
    CONSTRAINT issues_type_check CHECK (((type)::text = ANY ((ARRAY['epic'::character varying, 'story'::character varying, 'task'::character varying, 'bug'::character varying, 'subtask'::character varying])::text[])))
);
ALTER TABLE public.issues OWNER TO postgres;

CREATE TABLE public.notifications (
    id character varying NOT NULL,
    user_id character varying,
    space_id character varying,
    type character varying,
    title character varying,
    body text,
    is_read boolean DEFAULT false,
    link character varying,
    created_at timestamp without time zone DEFAULT now()
);
ALTER TABLE public.notifications OWNER TO postgres;

CREATE TABLE public.organizations (
    id character varying NOT NULL,
    name character varying NOT NULL,
    slug character varying NOT NULL,
    logo_url character varying,
    created_at timestamp without time zone DEFAULT now(),
    email_settings jsonb
);
ALTER TABLE public.organizations OWNER TO postgres;

CREATE TABLE public.roadmap_colors (
    color_key character varying NOT NULL,
    color character varying NOT NULL,
    created_by character varying NOT NULL
);
ALTER TABLE public.roadmap_colors OWNER TO postgres;

CREATE TABLE public.roadmap_items (
    id character varying NOT NULL,
    title character varying NOT NULL,
    description text,
    status character varying DEFAULT 'planned'::character varying,
    start_date date,
    end_date date,
    space_id character varying,
    issue_id character varying,
    color character varying DEFAULT '#4d90e0'::character varying,
    priority character varying DEFAULT 'medium'::character varying,
    assigned_to character varying,
    created_by character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    group_name character varying DEFAULT 'General'::character varying,
    category character varying DEFAULT 'Items'::character varying,
    milestone boolean DEFAULT false
);
ALTER TABLE public.roadmap_items OWNER TO postgres;

CREATE TABLE public.saved_filters (
    id character varying NOT NULL,
    space_id character varying,
    user_id character varying,
    name character varying NOT NULL,
    conditions jsonb DEFAULT '{}'::jsonb,
    is_shared boolean DEFAULT false,
    is_pinned boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);
ALTER TABLE public.saved_filters OWNER TO postgres;

CREATE TABLE public.session_expiry_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying NOT NULL,
    session_token character varying NOT NULL,
    reminder_sent_at timestamp without time zone DEFAULT now()
);
ALTER TABLE public.session_expiry_reminders OWNER TO postgres;

CREATE TABLE public.sessions (
    id character varying NOT NULL,
    user_id character varying,
    token character varying NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);
ALTER TABLE public.sessions OWNER TO postgres;

CREATE TABLE public.space_favorites (
    user_id character varying NOT NULL,
    space_id character varying NOT NULL
);
ALTER TABLE public.space_favorites OWNER TO postgres;

CREATE TABLE public.space_members (
    id character varying NOT NULL,
    space_id character varying,
    user_id character varying,
    role character varying DEFAULT 'member'::character varying,
    joined_at timestamp without time zone DEFAULT now(),
    CONSTRAINT space_members_role_check CHECK (((role)::text = ANY ((ARRAY['site_admin'::character varying, 'manager'::character varying, 'member'::character varying, 'viewer'::character varying])::text[])))
);
ALTER TABLE public.space_members OWNER TO postgres;

CREATE TABLE public.spaces (
    id character varying NOT NULL,
    org_id character varying,
    name character varying NOT NULL,
    key character varying NOT NULL,
    description text,
    icon character varying,
    color character varying,
    space_type character varying DEFAULT 'scrum'::character varying,
    visibility character varying DEFAULT 'team'::character varying,
    owner_id character varying,
    is_archived boolean DEFAULT false,
    issue_counter integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT spaces_space_type_check CHECK (((space_type)::text = ANY ((ARRAY['scrum'::character varying, 'kanban'::character varying, 'hybrid'::character varying])::text[]))),
    CONSTRAINT spaces_visibility_check CHECK (((visibility)::text = ANY ((ARRAY['private'::character varying, 'team'::character varying, 'org'::character varying])::text[])))
);
ALTER TABLE public.spaces OWNER TO postgres;

CREATE TABLE public.sprints (
    id character varying NOT NULL,
    space_id character varying,
    name character varying NOT NULL,
    goal text,
    start_date date,
    end_date date,
    status character varying DEFAULT 'planning'::character varying,
    velocity integer DEFAULT 0,
    "position" integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT sprints_status_check CHECK (((status)::text = ANY ((ARRAY['planning'::character varying, 'active'::character varying, 'completed'::character varying])::text[])))
);
ALTER TABLE public.sprints OWNER TO postgres;

CREATE TABLE public.users (
    id character varying NOT NULL,
    org_id character varying,
    name character varying NOT NULL,
    email character varying NOT NULL,
    avatar_url character varying,
    color character varying,
    role character varying DEFAULT 'member'::character varying,
    password_hash character varying,
    is_active boolean DEFAULT true,
    last_login timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    theme character varying DEFAULT 'dark'::character varying,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['owner'::character varying, 'admin'::character varying, 'member'::character varying])::text[])))
);
ALTER TABLE public.users OWNER TO postgres;

CREATE TABLE public.worklogs (
    id character varying NOT NULL,
    issue_id character varying,
    user_id character varying,
    time_spent integer,
    work_date date,
    description text,
    is_billable boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now()
);
ALTER TABLE public.worklogs OWNER TO postgres;

-- Primary Keys
ALTER TABLE ONLY public.audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.comments ADD CONSTRAINT comments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.custom_fields ADD CONSTRAINT custom_fields_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.invitations ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.invitations ADD CONSTRAINT invitations_token_key UNIQUE (token);
ALTER TABLE ONLY public.issue_attachments ADD CONSTRAINT issue_attachments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.issue_field_values ADD CONSTRAINT issue_field_values_issue_id_field_id_key UNIQUE (issue_id, field_id);
ALTER TABLE ONLY public.issue_field_values ADD CONSTRAINT issue_field_values_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.issue_history ADD CONSTRAINT issue_history_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.issue_links ADD CONSTRAINT issue_links_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.issue_links ADD CONSTRAINT issue_links_source_id_target_id_link_type_key UNIQUE (source_id, target_id, link_type);
ALTER TABLE ONLY public.issues ADD CONSTRAINT issues_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.organizations ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.organizations ADD CONSTRAINT organizations_slug_key UNIQUE (slug);
ALTER TABLE ONLY public.roadmap_colors ADD CONSTRAINT roadmap_colors_pkey PRIMARY KEY (color_key, created_by);
ALTER TABLE ONLY public.roadmap_items ADD CONSTRAINT roadmap_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.saved_filters ADD CONSTRAINT saved_filters_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.session_expiry_reminders ADD CONSTRAINT session_expiry_reminders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.session_expiry_reminders ADD CONSTRAINT session_expiry_reminders_user_id_session_token_key UNIQUE (user_id, session_token);
ALTER TABLE ONLY public.sessions ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sessions ADD CONSTRAINT sessions_token_key UNIQUE (token);
ALTER TABLE ONLY public.space_favorites ADD CONSTRAINT space_favorites_pkey PRIMARY KEY (user_id, space_id);
ALTER TABLE ONLY public.space_members ADD CONSTRAINT space_members_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.space_members ADD CONSTRAINT space_members_space_id_user_id_key UNIQUE (space_id, user_id);
ALTER TABLE ONLY public.spaces ADD CONSTRAINT spaces_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sprints ADD CONSTRAINT sprints_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.worklogs ADD CONSTRAINT worklogs_pkey PRIMARY KEY (id);

-- Indexes
CREATE INDEX idx_comments_issue_id ON public.comments USING btree (issue_id);
CREATE INDEX idx_issues_deleted_at ON public.issues USING btree (deleted_at);
CREATE INDEX idx_issues_space_id ON public.issues USING btree (space_id);
CREATE INDEX idx_issues_updated_at ON public.issues USING btree (updated_at);
CREATE INDEX idx_worklogs_issue_id ON public.worklogs USING btree (issue_id);

-- Foreign Keys
ALTER TABLE ONLY public.audit_logs ADD CONSTRAINT audit_logs_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);
ALTER TABLE ONLY public.audit_logs ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.comments ADD CONSTRAINT comments_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.issues(id);
ALTER TABLE ONLY public.comments ADD CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.custom_fields ADD CONSTRAINT custom_fields_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);
ALTER TABLE ONLY public.invitations ADD CONSTRAINT invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.invitations ADD CONSTRAINT invitations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
ALTER TABLE ONLY public.issue_attachments ADD CONSTRAINT issue_attachments_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.issues(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.issue_attachments ADD CONSTRAINT issue_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.issue_field_values ADD CONSTRAINT issue_field_values_field_id_fkey FOREIGN KEY (field_id) REFERENCES public.custom_fields(id);
ALTER TABLE ONLY public.issue_field_values ADD CONSTRAINT issue_field_values_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.issues(id);
ALTER TABLE ONLY public.issue_history ADD CONSTRAINT issue_history_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.issues(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.issue_history ADD CONSTRAINT issue_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.issue_links ADD CONSTRAINT issue_links_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.issues(id);
ALTER TABLE ONLY public.issue_links ADD CONSTRAINT issue_links_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.issues(id);
ALTER TABLE ONLY public.issues ADD CONSTRAINT issues_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.issues ADD CONSTRAINT issues_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.issues(id);
ALTER TABLE ONLY public.issues ADD CONSTRAINT issues_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.issues ADD CONSTRAINT issues_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);
ALTER TABLE ONLY public.issues ADD CONSTRAINT issues_sprint_id_fkey FOREIGN KEY (sprint_id) REFERENCES public.sprints(id);
ALTER TABLE ONLY public.notifications ADD CONSTRAINT notifications_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);
ALTER TABLE ONLY public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.roadmap_colors ADD CONSTRAINT roadmap_colors_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.roadmap_items ADD CONSTRAINT roadmap_items_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.roadmap_items ADD CONSTRAINT roadmap_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.roadmap_items ADD CONSTRAINT roadmap_items_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.issues(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.roadmap_items ADD CONSTRAINT roadmap_items_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.saved_filters ADD CONSTRAINT saved_filters_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);
ALTER TABLE ONLY public.saved_filters ADD CONSTRAINT saved_filters_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.sessions ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.space_favorites ADD CONSTRAINT space_favorites_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);
ALTER TABLE ONLY public.space_favorites ADD CONSTRAINT space_favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.space_members ADD CONSTRAINT space_members_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);
ALTER TABLE ONLY public.space_members ADD CONSTRAINT space_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.spaces ADD CONSTRAINT spaces_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
ALTER TABLE ONLY public.spaces ADD CONSTRAINT spaces_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.sprints ADD CONSTRAINT sprints_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.spaces(id);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
ALTER TABLE ONLY public.worklogs ADD CONSTRAINT worklogs_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.issues(id);
ALTER TABLE ONLY public.worklogs ADD CONSTRAINT worklogs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;
