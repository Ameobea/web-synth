use diesel::prelude::*;
use itertools::Itertools;
use rocket::serde::json::Json;

use crate::{
  db_util::{
    build_tags_with_counts, get_and_create_tag_ids, last_insert_id, login::get_logged_in_user_id,
  },
  models::{
    subgraph_presets::{NewSubgraphPreset, NewSubgraphPresetTag, SerializedSubgraphPreset},
    tags::{EntityIdTag, TagCount},
    user::MaybeLoginToken,
    GenericPresetDescriptor, SaveGenericPresetRequest,
  },
  WebSynthDbConn,
};

#[get("/subgraph_presets")]
pub async fn get_subgraph_presets(
  conn: WebSynthDbConn,
) -> Result<Json<Vec<GenericPresetDescriptor>>, String> {
  use crate::schema::{subgraph_preset_tags, subgraph_presets, tags, users};

  let (subgraph_presets, preset_tags) = conn
    .run(|conn| -> QueryResult<(_, _)> {
      let presets = subgraph_presets::table
        .left_join(users::table)
        .select((
          subgraph_presets::dsl::id,
          subgraph_presets::dsl::title,
          subgraph_presets::dsl::description,
          users::dsl::id.nullable(),
          users::dsl::username.nullable(),
        ))
        .load::<(i64, String, String, Option<i64>, Option<String>)>(conn)?;

      let preset_tags: Vec<EntityIdTag> = subgraph_preset_tags::table
        .inner_join(tags::table)
        .select((
          subgraph_preset_tags::dsl::subgraph_preset_id,
          tags::dsl::tag,
        ))
        .load(conn)?;

      Ok((presets, preset_tags))
    })
    .await
    .map_err(|err| {
      error!("DB error loading subgraph presets from DB: {}", err);
      String::from("DB error loading subgraph presets from DB")
    })?;

  let mut tags_by_preset_id = preset_tags
    .into_iter()
    .into_group_map_by(|tag| tag.entity_id);

  let subgraph_presets = subgraph_presets
    .into_iter()
    .map(|(id, name, description, user_id, user_name)| {
      let tags = tags_by_preset_id
        .remove(&id)
        .unwrap_or_default()
        .iter()
        .map(|tag| tag.tag.clone())
        .collect_vec();

      GenericPresetDescriptor {
        id,
        name,
        description,
        tags,
        user_id,
        user_name,
      }
    })
    .collect_vec();

  Ok(Json(subgraph_presets))
}

#[get("/subgraph_preset/<preset_id>")]
pub async fn get_subgraph_preset_by_id(
  conn: WebSynthDbConn,
  preset_id: i64,
) -> Result<Option<Json<SerializedSubgraphPreset>>, String> {
  use crate::schema::subgraph_presets;

  let serialized_preset: Option<String> = conn
    .run(move |conn| -> QueryResult<Option<_>> {
      subgraph_presets::table
        .find(preset_id)
        .select(subgraph_presets::dsl::content)
        .first(conn)
        .optional()
    })
    .await
    .map_err(|err| {
      error!("DB error loading subgraph preset from DB: {}", err);
      String::from("DB error loading subgraph preset from DB")
    })?;

  let serialized_preset = match serialized_preset {
    Some(serialized_preset) => serialized_preset,
    None => return Ok(None),
  };
  let preset: SerializedSubgraphPreset =
    serde_json::from_str(&serialized_preset).map_err(|_err| {
      error!(
        "Invalid subgraph preset JSON found in DB: {}",
        serialized_preset
      );
      String::from("Invalid subgraph preset JSON found in DB")
    })?;

  Ok(Some(Json(preset)))
}

#[post("/subgraph_preset", data = "<subgraph_preset>")]
pub async fn create_subgraph_preset(
  conn: WebSynthDbConn,
  subgraph_preset: Json<SaveGenericPresetRequest<SerializedSubgraphPreset>>,
  login_token: MaybeLoginToken,
) -> Result<Json<i64>, String> {
  use crate::schema::{subgraph_preset_tags, subgraph_presets};

  let user_id = get_logged_in_user_id(&conn, login_token).await;

  let SaveGenericPresetRequest {
    preset,
    name,
    description,
    tags,
  } = subgraph_preset.into_inner();
  let serialized_subgraph: String = serde_json::to_string(&preset).unwrap();

  let created_preset_id = conn
    .run(move |conn| -> QueryResult<i64> {
      conn.transaction(move |conn| {
        diesel::insert_into(subgraph_presets::table)
          .values(NewSubgraphPreset {
            user_id,
            title: name,
            description,
            content: serialized_subgraph,
          })
          .execute(conn)?;
        let created_preset_id = diesel::select(last_insert_id()).first(conn)?;

        // Insert tags
        let tag_count = tags.len();
        let tag_ids = get_and_create_tag_ids(conn, tags)?;
        assert_eq!(tag_count, tag_ids.len());

        let new_tags: Vec<NewSubgraphPresetTag> = tag_ids
          .into_iter()
          .map(|tag_id| NewSubgraphPresetTag {
            subgraph_preset_id: created_preset_id,
            tag_id,
          })
          .collect();

        diesel::insert_into(subgraph_preset_tags::table)
          .values(new_tags)
          .execute(conn)?;

        Ok(created_preset_id)
      })
    })
    .await
    .map_err(|err| {
      error!("DB error inserting subgraph preset into DB: {}", err);
      String::from("DB error inserting subgraph preset into DB")
    })?;

  Ok(Json(created_preset_id))
}

#[get("/subgraph_preset_tags")]
pub async fn get_subgraph_preset_tags(conn: WebSynthDbConn) -> Result<Json<Vec<TagCount>>, String> {
  use crate::schema::{subgraph_preset_tags, tags};

  build_tags_with_counts(conn, move |conn| -> QueryResult<Vec<_>> {
    subgraph_preset_tags::table
      .inner_join(tags::table)
      .select((
        subgraph_preset_tags::dsl::subgraph_preset_id,
        tags::dsl::tag,
      ))
      .load(conn)
  })
  .await
}
