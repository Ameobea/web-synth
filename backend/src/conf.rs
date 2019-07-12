use dotenv;

pub struct Conf {
    pub db_url: String,
}

impl Default for Conf {
    fn default() -> Self {
        Conf {
            db_url: dotenv::var("DATABASE_URL")
                .expect("The `DATABASE_URL` environment variable must be supplied!"),
        }
    }
}
