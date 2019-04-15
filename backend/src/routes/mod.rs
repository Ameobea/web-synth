use rocket::State;

use super::Conn;

#[get("/")]
pub fn index(pool: State<Conn>) -> &'static str {
    let conn = pool.inner();
    let c = &*conn.0;

    // conn.

    // conn.connect().expect("Unable to connect");

    "Application successfully started!"
}
