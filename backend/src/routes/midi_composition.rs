use diesel::prelude::*;
use rocket_contrib::json::Json;

use crate::{models::midi_composition::*, WebSynthDbConn};

#[get("/midi_compositions")]
pub async fn get_midi_compositions(
    conn: WebSynthDbConn,
) -> Result<Json<Vec<MIDIComposition>>, String> {
    use crate::schema::midi_compositions;

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
             }| {
                let composition: SerializedMIDIEditorState =
                    match serde_json::from_str(&composition_json) {
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
                })
            },
        )
        .collect();
    Ok(Json(compositions))
}

#[post("/midi_compositions", data = "<composition>")]
pub async fn save_midi_composition(
    conn: WebSynthDbConn,
    composition: Json<NewMIDIComposition>,
) -> Result<(), String> {
    use crate::schema::midi_compositions;

    let serialized_comp = serde_json::to_string(&composition.0.composition)
        .expect("Failed to serialize MIDI composition");
    let insertable_comp = InsertableMIDIComposition {
        name: composition.name.clone(),
        description: composition.description.clone(),
        composition_json: serialized_comp,
    };

    conn.run(|conn| {
        diesel::insert_into(midi_compositions::table)
            .values(insertable_comp)
            .execute(conn)
            .map_err(|err| {
                error!("Error inserting MIDI composition into DB: {:?}", err);
                String::from("DB Error")
            })
    })
    .await?;
    Ok(())
}
