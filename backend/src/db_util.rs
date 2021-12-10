use std::collections::HashMap;

use diesel::{prelude::*, QueryResult};
use itertools::Itertools;

use crate::models::tags::{NewTag, Tag};

// Facilitate getting the primary key of the last inserted item
//
// https://github.com/diesel-rs/diesel/issues/1011#issuecomment-315536931
no_arg_sql_function!(last_insert_id, diesel::types::Bigint);

pub fn get_and_create_tag_ids(conn: &MysqlConnection, tags: Vec<String>) -> QueryResult<Vec<i64>> {
    use crate::schema::tags;

    let tags_clone = tags.clone();
    let existing_tags = tags::table
        .filter(tags::dsl::tag.eq_any(tags_clone))
        .load::<Tag>(conn)?;

    let tag_ids_by_name = existing_tags
        .into_iter()
        .map(|tag| (tag.tag, tag.id))
        .collect::<HashMap<_, _>>();

    let missing_tags: Vec<String> = tags
        .iter()
        .filter(|t| !tag_ids_by_name.contains_key(*t))
        .cloned()
        .collect();

    if !missing_tags.is_empty() {
        let new_tags = missing_tags
            .into_iter()
            .map(|tag| NewTag { tag })
            .collect_vec();

        diesel::insert_or_ignore_into(tags::table)
            .values(&new_tags)
            .execute(conn)?;

        return get_and_create_tag_ids(conn, tags);
    }

    let tag_ids: Vec<i64> = tags.into_iter().map(|tag| tag_ids_by_name[&tag]).collect();
    Ok(tag_ids)
}
