#![feature(proc_macro_hygiene, decl_macro)]

use std::sync::Arc;

extern crate diesel;
extern crate dotenv;
#[macro_use]
extern crate rocket;
extern crate serde;
extern crate serde_json;
#[macro_use]
extern crate serde_derive;
extern crate r2d2;
extern crate r2d2_mysql;
#[macro_use]
extern crate lazy_static;

use diesel::prelude::*;
use mysql::{Opts, OptsBuilder};
use rocket::{Outcome, Request, State};
use rocket::http::Status;
use rocket::request::{self,FromRequest};

pub mod conf;
pub mod models;
pub mod routes;

use self::conf::Conf;

lazy_static! {
    static ref CONF: Conf = Conf::default();
}

pub struct Db(Arc<r2d2::Pool<r2d2_mysql::MysqlConnectionManager>>);

pub struct Conn(r2d2::PooledConnection<r2d2_mysql::MysqlConnectionManager>);

impl<'a, 'r> FromRequest<'a, 'r> for Conn {
    type Error = ();

    fn from_request(req: &'a Request<'r>) -> request::Outcome<Conn, Self::Error> {
        let pool = req.guard::<State<Db>>()?;
        match pool.0.get() {
            Ok(conn) => Outcome::Success(Conn(conn)),
            Err(_) => Outcome::Failure((Status::ServiceUnavailable, ()))
        }
    }
}

fn main() {
    let manager = r2d2_mysql::MysqlConnectionManager::new(OptsBuilder::from_opts(
        Opts::from_url(&CONF.db_url).expect("Unable to parse supplied `DB_URL`!"),
    ));
    let pool = Arc::new(r2d2::Pool::builder().max_size(4).build(manager).unwrap());

    rocket::ignite()
        .manage(Db(pool))
        .mount("/", routes![routes::index])
        .launch();
}
