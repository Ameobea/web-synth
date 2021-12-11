table! {
    compositions (id) {
        id -> Bigint,
        author -> Bigint,
        title -> Text,
        description -> Text,
        content -> Longtext,
    }
}

table! {
    composition_tags (id) {
        id -> Bigint,
        tag -> Text,
    }
}

table! {
    composition_tags_join (id) {
        id -> Bigint,
        tag -> Bigint,
        composition -> Bigint,
    }
}

table! {
    effects (id) {
        id -> Bigint,
        title -> Varchar,
        description -> Text,
        code -> Text,
    }
}

table! {
    looper_presets (id) {
        id -> Bigint,
        author -> Nullable<Bigint>,
        name -> Text,
        description -> Text,
        serialized_looper_inst_state -> Longtext,
    }
}

table! {
    looper_presets_tags (id) {
        id -> Bigint,
        looper_preset_id -> Bigint,
        tag_id -> Bigint,
    }
}

table! {
    midi_compositions (id) {
        id -> Bigint,
        name -> Text,
        description -> Text,
        composition_json -> Text,
    }
}

table! {
    midi_compositions_tags (id) {
        id -> Bigint,
        midi_composition_id -> Bigint,
        tag_id -> Bigint,
    }
}

table! {
    remote_sample_urls (id, name) {
        id -> Varchar,
        name -> Varchar,
        sample_url -> Text,
    }
}

table! {
    synth_presets (id) {
        id -> Bigint,
        title -> Text,
        description -> Text,
        body -> Text,
    }
}

table! {
    tags (id) {
        id -> Bigint,
        tag -> Text,
    }
}

table! {
    users (id) {
        id -> Bigint,
        username -> Text,
        hashed_password -> Text,
        last_login -> Timestamp,
    }
}

table! {
    voice_presets (id) {
        id -> Bigint,
        title -> Text,
        description -> Text,
        body -> Longtext,
    }
}

joinable!(looper_presets -> users (author));
joinable!(looper_presets_tags -> looper_presets (looper_preset_id));
joinable!(looper_presets_tags -> tags (tag_id));
joinable!(midi_compositions_tags -> midi_compositions (midi_composition_id));
joinable!(midi_compositions_tags -> tags (tag_id));

allow_tables_to_appear_in_same_query!(
    compositions,
    composition_tags,
    composition_tags_join,
    effects,
    looper_presets,
    looper_presets_tags,
    midi_compositions,
    midi_compositions_tags,
    remote_sample_urls,
    synth_presets,
    tags,
    users,
    voice_presets,
);
