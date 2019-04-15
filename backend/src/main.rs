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

fn main() {
    rocket::ignite()
        .attach(WebSynthDbConn::fairing())
        .mount(
            "/",
            routes![routes::index, routes::create_effect, routes::list_effects],
        )
        .launch();
}
