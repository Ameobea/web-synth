#![feature(proc_macro_hygiene, decl_macro)]

#[macro_use]
extern crate diesel;
extern crate dotenv;
#[macro_use]
extern crate rocket;
extern crate serde;
extern crate serde_json;
#[macro_use]
extern crate serde_derive;
#[macro_use]
extern crate lazy_static;
#[macro_use]
extern crate log;
extern crate chrono;
extern crate tokio;
#[macro_use]
extern crate rocket_sync_db_pools;

use rocket::{
    fairing::{Fairing, Info, Kind},
    http::{Method, Status},
    Request, Response,
};

pub mod conf;
pub mod models;
pub mod routes;
pub mod schema;

#[database("web_synth")]
pub struct WebSynthDbConn(diesel::MysqlConnection);

/// Roll-your-own CORS fairing
struct CorsFairing;

#[rocket::async_trait]
impl Fairing for CorsFairing {
    async fn on_response<'r>(&self, req: &'r Request<'_>, res: &mut Response<'r>) {
        res.set_header(rocket::http::Header::new(
            "Access-Control-Allow-Origin",
            "*",
        ));
        res.set_header(rocket::http::Header::new(
            "Access-Control-Allow-Headers",
            "Content-Type",
        ));

        if res.status() == Status::NotFound && req.method() == Method::Options {
            res.set_status(Status::NoContent);
        }
    }

    fn info(&self) -> Info {
        Info {
            name: "CORS Fairing",
            kind: Kind::Response,
        }
    }
}

#[rocket::main]
async fn main() {
    if let Err(_) = dotenv::dotenv() {
        println!("Unable to parse .env file; continuing.");
    }

    rocket::build()
        .attach(WebSynthDbConn::fairing())
        .mount("/", routes![
            routes::index,
            routes::create_effect,
            routes::list_effects,
            routes::save_composition,
            routes::get_compositions,
            routes::get_synth_presets,
            routes::create_synth_preset,
            routes::get_synth_voice_presets,
            routes::create_synth_voice_preset,
            routes::get_composition_by_id,
            routes::list_remote_samples,
            routes::store_remote_sample,
            routes::save_midi_composition,
            routes::get_midi_compositions,
        ])
        .attach(CorsFairing)
        .attach(rocket_async_compression::Compression::fairing())
        .ignite()
        .await
        .expect("Error starting Rocket")
        .launch()
        .await
        .expect("Error running Rocket");

    println!("Exited cleanly");
}
