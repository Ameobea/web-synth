use std::collections::HashMap;

use diesel::{prelude::*, QueryResult};
use fxhash::FxHashMap;
use itertools::Itertools;
use rocket::serde::json::Json;

use crate::{
  models::tags::{EntityIdTag, NewTag, Tag, TagCount},
  WebSynthDbConn,
};

pub mod login;
pub mod private_sample_libraries;

// Facilitate getting the primary key of the last inserted item
//
// https://github.com/diesel-rs/diesel/issues/1011#issuecomment-315536931
define_sql_function! {
  fn last_insert_id() -> BigInt;
}

pub fn get_and_create_tag_ids(
  conn: &mut MysqlConnection,
  tags: Vec<String>,
) -> QueryResult<Vec<i64>> {
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

pub async fn build_tags_with_counts(
  conn: WebSynthDbConn,
  get_all_entity_id_tags: impl FnOnce(&mut MysqlConnection) -> QueryResult<Vec<EntityIdTag>>
    + Send
    + 'static,
) -> Result<Json<Vec<TagCount>>, String> {
  let all_looper_preset_tags: Vec<EntityIdTag> =
    conn.run(get_all_entity_id_tags).await.map_err(|err| {
      error!("DB error loading preset tags from DB: {}", err);
      String::from("DB error loading preset tags from DB")
    })?;

  let mut counts_by_tag: FxHashMap<String, i64> = FxHashMap::default();
  for looper_preset_tag in all_looper_preset_tags {
    let tag = looper_preset_tag.tag.clone();
    let count = counts_by_tag.entry(tag).or_insert(0);
    *count += 1;
  }

  let counts: Vec<TagCount> = counts_by_tag
    .into_iter()
    .map(|(tag_name, count)| TagCount {
      name: tag_name,
      count,
    })
    .collect();
  Ok(Json(counts))
}
