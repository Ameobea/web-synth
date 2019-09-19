#![feature(proc_macro_hygiene, decl_macro)]

#[macro_use]
extern crate diesel;
extern crate dotenv;
#[macro_use]
extern crate rocket;
#[macro_use]
extern crate rocket_contrib;
extern crate serde;
extern crate serde_json;
#[macro_use]
extern crate serde_derive;
#[macro_use]
extern crate lazy_static;
#[macro_use]
extern crate log;
extern crate chrono;
extern crate fern;

use rocket::fairing::{Fairing, Info, Kind};
use rocket::{http::Method, http::Status, Request, Response};

pub mod conf;
pub mod models;
pub mod routes;
pub mod schema;

use self::conf::Conf;

lazy_static! {
    pub static ref CONF: Conf = Conf::default();
}

#[database("web_synth")]
pub struct WebSynthDbConn(diesel::MysqlConnection);

/// Roll-your-own CORS fairing
struct CorsFairing;

impl Fairing for CorsFairing {
    fn on_response(&self, request: &Request, response: &mut Response) {
        response.set_header(rocket::http::Header::new(
            "Access-Control-Allow-Origin",
            "*",
        ));
        response.set_header(rocket::http::Header::new(
            "Access-Control-Allow-Headers",
            "Content-Type",
        ));

        if response.status() == Status::NotFound && request.method() == Method::Options {
            response.set_status(Status::NoContent);
        }
    }

    fn info(&self) -> Info {
        Info {
            name: "CORS Fairing",
            kind: Kind::Response,
        }
    }
}

fn init_logger() -> Result<(), fern::InitError> {
    fern::Dispatch::new()
        .format(|out, message, record| {
            out.finish(format_args!(
                "{}[{}][{}] {}",
                chrono::Local::now().format("[%Y-%m-%d %H:%M:%S]"),
                record.target(),
                record.level(),
                message
            ))
        })
        .level(log::LevelFilter::Debug)
        .level_for("hyper", log::LevelFilter::Info)
        .level_for("mio", log::LevelFilter::Info)
        .level_for("tokio_core", log::LevelFilter::Info)
        .level_for("tokio_reactor", log::LevelFilter::Info)
        .chain(std::io::stdout())
        .apply()?;
    Ok(())
}

fn main() {
    if let Err(_) = dotenv::dotenv() {
        println!("Unable to parse .env file; continuing.");
    }

    init_logger()
        .map_err(|err| -> ! {
            panic!("Failed to initialize logger: {:?}", err);
        })
        .unwrap();

    let launch_err = rocket::ignite()
        .attach(WebSynthDbConn::fairing())
        .mount(
            "/",
            routes![
                routes::index,
                routes::create_effect,
                routes::list_effects,
                routes::save_composition,
                routes::get_compositions
            ],
        )
        .attach(CorsFairing)
        .launch();

    panic!("Error initializing Rocket: {:?}", launch_err);
}
