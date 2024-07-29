use diesel::prelude::*;
use itertools::Itertools;
use rocket::serde::json::Json;

use crate::{
  db_util::{build_tags_with_counts, get_and_create_tag_ids, last_insert_id},
  models::{
    midi_composition::*,
    tags::{EntityIdTag, TagCount},
  },
  WebSynthDbConn,
};

#[get("/midi_compositions")]
pub async fn get_midi_compositions(
  conn: WebSynthDbConn,
) -> Result<Json<Vec<MIDIComposition>>, String> {
  use crate::schema::{midi_compositions, midi_compositions_tags, tags};

  let compositions: Vec<QueryableMIDIComposition> = conn
    .run(|conn| {
      midi_compositions::table
        .select(midi_compositions::all_columns)
        .load(conn)
        .map_err(|err| {
          error!("Error querying MIDI compositions from DB: {:?}", err);
          String::from("DB Error")
        })
    })
    .await?;
  let compositions = compositions
    .into_iter()
    .filter_map(
      |QueryableMIDIComposition {
         id,
         name,
         description,
         composition_json,
         user_id,
         created_at,
       }| {
        let composition: SerializedMIDIEditorState = match serde_json::from_str(&composition_json) {
          Ok(parsed) => parsed,
          Err(err) => {
            error!("Error deserializing stored MIDI composition: {:?}", err);
            return None;
          },
        };
        Some(MIDIComposition {
          id,
          name,
          description,
          composition,
          tags: Vec::new(),
          user_id,
          created_at,
        })
      },
    )
    .collect_vec();

  let all_tags_for_compositions: Vec<EntityIdTag> = conn
    .run(|conn| {
      midi_compositions_tags::table
        .inner_join(tags::table)
        .select((
          midi_compositions_tags::dsl::midi_composition_id,
          tags::dsl::tag,
        ))
        .load(conn)
        .map_err(|err| {
          error!("Error querying MIDI compositions tags from DB: {:?}", err);
          String::from("DB Error")
        })
    })
    .await?;
  let tags_by_composition_id = all_tags_for_compositions
    .into_iter()
    .into_group_map_by(|tag| tag.entity_id);

  Ok(Json(
    compositions
      .into_iter()
      .map(|mut comp| {
        let tags = tags_by_composition_id
          .get(&comp.id)
          .map(|tags| tags.into_iter().map(|tag| tag.tag.clone()).collect())
          .unwrap_or_default();
        comp.tags = tags;
        comp
      })
      .collect_vec(),
  ))
}

#[post("/midi_compositions", data = "<composition>")]
pub async fn save_midi_composition(
  conn: WebSynthDbConn,
  composition: Json<NewMIDIComposition>,
) -> Result<(), String> {
  use crate::schema::{midi_compositions, midi_compositions_tags};

  let serialized_comp = serde_json::to_string(&composition.0.composition)
    .expect("Failed to serialize MIDI composition");
  let insertable_comp = InsertableMIDIComposition {
    name: composition.name.clone(),
    description: composition.description.clone(),
    composition_json: serialized_comp,
  };
  let tags = composition.tags.clone();

  conn
    .run(|conn| {
      conn.transaction(|conn| -> QueryResult<()> {
        diesel::insert_into(midi_compositions::table)
          .values(insertable_comp)
          .execute(conn)?;
        let created_preset_id = diesel::select(last_insert_id()).first(conn)?;

        // Insert tags
        let tag_count = tags.len();
        let tag_ids = get_and_create_tag_ids(conn, tags)?;
        assert_eq!(tag_count, tag_ids.len());

        let new_tags: Vec<NewMidiCompositionTag> = tag_ids
          .into_iter()
          .map(|tag_id| NewMidiCompositionTag {
            midi_composition_id: created_preset_id,
            tag_id,
          })
          .collect();

        diesel::insert_into(midi_compositions_tags::table)
          .values(new_tags)
          .execute(conn)?;

        Ok(())
      })
    })
    .await
    .map_err(|err| {
      error!("Error inserting MIDI composition into DB: {:?}", err);
      String::from("DB Error")
    })?;
  Ok(())
}

#[get("/midi_composition_tags")]
pub async fn get_midi_composition_tags(
  conn: WebSynthDbConn,
) -> Result<Json<Vec<TagCount>>, String> {
  use crate::schema::{midi_compositions_tags, tags};

  build_tags_with_counts(conn, move |conn| -> QueryResult<Vec<_>> {
    midi_compositions_tags::table
      .inner_join(tags::table)
      .select((
        midi_compositions_tags::dsl::midi_composition_id,
        tags::dsl::tag,
      ))
      .load(conn)
  })
  .await
}
