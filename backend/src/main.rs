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

use rocket::fairing::{Fairing, Info, Kind};
use rocket::{http::Method, Request, Response, http::Status};

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

fn main() {
    rocket::ignite()
        .attach(WebSynthDbConn::fairing())
        .mount(
            "/",
            routes![routes::index, routes::create_effect, routes::list_effects],
        )
        .attach(CorsFairing)
        .launch();
}
