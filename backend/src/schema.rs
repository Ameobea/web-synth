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
    remote_sample_urls (id) {
        id -> Varchar,
        name -> Text,
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
        body -> Text,
    }
}

allow_tables_to_appear_in_same_query!(
    compositions,
    composition_tags,
    composition_tags_join,
    effects,
    remote_sample_urls,
    synth_presets,
    users,
    voice_presets,
);
