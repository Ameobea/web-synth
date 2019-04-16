use diesel::{self, prelude::*};

use crate::models::effects::{Effect, InsertableEffect};
use crate::schema;
use crate::WebSynthDbConn;
use rocket_contrib::json::Json;
use serde_json;

#[get("/")]
pub fn index() -> &'static str {
    "Application successfully started!"
}

#[post("/effects", data = "<effect>")]
pub fn create_effect(
    conn: WebSynthDbConn,
    effect: Json<InsertableEffect>,
) -> Result<String, String> {
    let inserted_rows = diesel::insert_into(schema::effects::table)
        .values(&effect.0)
        .execute(&conn.0)
        .map_err(|err| -> String {
            println!("Error inserting row: {:?}", err);
            "Error inserting row into database".into()
        })?;

    Ok(format!("Inserted {} row(s).", inserted_rows))
}

#[get("/effects")]
pub fn list_effects(conn: WebSynthDbConn) -> Result<String, String> {
    use crate::schema::effects::dsl::*;

    let loaded_effects: Vec<Effect> = effects.load(&conn.0).map_err(|err| -> String {
        println!("Error querying effects: {:?}", err);
        "Error querying effects from the database".into()
    })?;

    Ok(serde_json::to_string(&loaded_effects).expect("Error serializing `Effect`s"))
}
