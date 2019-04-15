use dotenv;

pub struct Conf {
    pub db_url: String,
}

impl Default for Conf {
    fn default() -> Self {
        dotenv::dotenv().expect("Unable to parse .env file!");

        Conf {
            db_url: dotenv::var("DB_URL").expect("The `DB_URL` environment variable must be supplied!")
        }
    }
}
