fn main() {
    let lookup_table_size = 1024 * 4 * 4;
    let mut file_content = String::from("pub const SINE_LOOKUP_TABLE: [f32; 1024 * 4 * 4] = [");
    for i in 0..lookup_table_size {
        let val = (std::f32::consts::PI * 2. * (i as f32 / lookup_table_size as f32)).sin();
        file_content.push_str(&format!("{:.32},", val));
    }

    file_content.push_str("];");
    std::fs::write("src/lookup_tables.rs", file_content.as_bytes()).unwrap();
}
