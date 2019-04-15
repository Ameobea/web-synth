/// An effect is a component in the audio graph that transforms input signals into output signals.
/// Its functionality is described by Faust code.
pub struct Effect {
    pub title: String,
    pub description: String,
    pub code: String,
}
