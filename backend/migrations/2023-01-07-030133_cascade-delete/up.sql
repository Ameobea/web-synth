ALTER TABLE compositions_tags
  DROP FOREIGN KEY compositions_tags_ibfk_1;
ALTER TABLE compositions_tags
  ADD CONSTRAINT compositions_tags_ibfk_1
  FOREIGN KEY (composition_id) REFERENCES compositions (id)
  ON DELETE CASCADE;

ALTER TABLE compositions_tags
  DROP FOREIGN KEY compositions_tags_ibfk_2;
ALTER TABLE compositions_tags
  ADD CONSTRAINT compositions_tags_ibfk_2
  FOREIGN KEY (tag_id) REFERENCES tags (id)
  ON DELETE CASCADE;

ALTER TABLE looper_presets_tags
  DROP FOREIGN KEY IF EXISTS looper_presets_tags_ibfk_1;
ALTER TABLE looper_presets_tags
  ADD CONSTRAINT looper_presets_tags_ibfk_1
  FOREIGN KEY (looper_preset_id) REFERENCES looper_presets (id)
  ON DELETE CASCADE;

ALTER TABLE looper_presets_tags
  DROP FOREIGN KEY looper_presets_tags_ibfk_2;
ALTER TABLE looper_presets_tags
  ADD CONSTRAINT looper_presets_tags_ibfk_2
  FOREIGN KEY (tag_id) REFERENCES tags (id)
  ON DELETE CASCADE;

ALTER TABLE midi_compositions_tags
  DROP FOREIGN KEY midi_compositions_tags_ibfk_1;
ALTER TABLE midi_compositions_tags
  ADD CONSTRAINT midi_compositions_tags_ibfk_1
  FOREIGN KEY (midi_composition_id) REFERENCES midi_compositions (id)
  ON DELETE CASCADE;

ALTER TABLE midi_compositions_tags
  DROP FOREIGN KEY midi_compositions_tags_ibfk_2;
ALTER TABLE midi_compositions_tags
  ADD CONSTRAINT midi_compositions_tags_ibfk_2
  FOREIGN KEY (tag_id) REFERENCES tags (id)
  ON DELETE CASCADE;
