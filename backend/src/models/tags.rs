use crate::schema::tags;

#[derive(Insertable)]
#[table_name = "tags"]
pub struct NewTag {
    pub tag: String,
}

#[derive(Queryable)]
pub struct Tag {
    pub id: i64,
    pub tag: String,
}

#[derive(Serialize, Queryable)]
pub struct TagCount {
    pub name: String,
    pub count: i64,
}
