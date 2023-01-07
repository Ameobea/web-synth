// @generated automatically by Diesel CLI.

diesel::table! {
    compositions (id) {
        id -> Bigint,
        title -> Text,
        description -> Text,
        content -> Longtext,
        user_id -> Nullable<Bigint>,
    }
}

diesel::table! {
    compositions_tags (id) {
        id -> Bigint,
        composition_id -> Bigint,
        tag_id -> Bigint,
    }
}

diesel::table! {
    effects (id) {
        id -> Bigint,
        title -> Varchar,
        description -> Text,
        code -> Text,
        user_id -> Nullable<Bigint>,
    }
}

diesel::table! {
    login_tokens (id) {
        id -> Unsigned<Integer>,
        user_id -> Bigint,
        token -> Text,
        created_at -> Timestamp,
    }
}

diesel::table! {
    looper_presets (id) {
        id -> Bigint,
        name -> Text,
        description -> Text,
        serialized_looper_inst_state -> Longtext,
        user_id -> Nullable<Bigint>,
    }
}

diesel::table! {
    looper_presets_tags (id) {
        id -> Bigint,
        looper_preset_id -> Bigint,
        tag_id -> Bigint,
    }
}

diesel::table! {
    midi_compositions (id) {
        id -> Bigint,
        name -> Text,
        description -> Text,
        composition_json -> Text,
        user_id -> Nullable<Bigint>,
    }
}

diesel::table! {
    midi_compositions_tags (id) {
        id -> Bigint,
        midi_composition_id -> Bigint,
        tag_id -> Bigint,
    }
}

diesel::table! {
    private_sample_libraries (id) {
        id -> Unsigned<Bigint>,
        user_id -> Bigint,
        bucket_name -> Text,
        region_json -> Text,
        public_url_base -> Text,
        access_key_id -> Text,
        secret_access_key -> Text,
        created_at -> Timestamp,
    }
}

diesel::table! {
    remote_sample_urls (id, name) {
        id -> Varchar,
        name -> Varchar,
        sample_url -> Text,
    }
}

diesel::table! {
    synth_presets (id) {
        id -> Bigint,
        title -> Text,
        description -> Text,
        body -> Text,
        user_id -> Nullable<Bigint>,
    }
}

diesel::table! {
    tags (id) {
        id -> Bigint,
        tag -> Text,
    }
}

diesel::table! {
    users (id) {
        id -> Bigint,
        username -> Text,
        hashed_password -> Text,
        last_login -> Timestamp,
    }
}

diesel::table! {
    voice_presets (id) {
        id -> Bigint,
        title -> Text,
        description -> Text,
        body -> Longtext,
        user_id -> Nullable<Bigint>,
    }
}

diesel::joinable!(compositions_tags -> compositions (composition_id));
diesel::joinable!(compositions_tags -> tags (tag_id));
diesel::joinable!(effects -> users (user_id));
diesel::joinable!(login_tokens -> users (user_id));
diesel::joinable!(looper_presets -> users (user_id));
diesel::joinable!(looper_presets_tags -> looper_presets (looper_preset_id));
diesel::joinable!(looper_presets_tags -> tags (tag_id));
diesel::joinable!(midi_compositions -> users (user_id));
diesel::joinable!(midi_compositions_tags -> midi_compositions (midi_composition_id));
diesel::joinable!(midi_compositions_tags -> tags (tag_id));
diesel::joinable!(private_sample_libraries -> users (user_id));
diesel::joinable!(synth_presets -> users (user_id));
diesel::joinable!(voice_presets -> users (user_id));

diesel::allow_tables_to_appear_in_same_query!(
    compositions,
    compositions_tags,
    effects,
    login_tokens,
    looper_presets,
    looper_presets_tags,
    midi_compositions,
    midi_compositions_tags,
    private_sample_libraries,
    remote_sample_urls,
    synth_presets,
    tags,
    users,
    voice_presets,
);
