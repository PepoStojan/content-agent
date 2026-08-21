-- Phase 4.7 foundation — export_files metadata columns.
-- Locked: ED3/ED10 (docs/architecture/phase-4-7-export-plan.md).
--
-- mime_type and size_bytes are written once, at file-write time, so
-- the download response can set correct headers and the Export
-- history list can show file size without a Storage HEAD request
-- (Toyota "avoid unnecessary round-trips"). No `checksum` column —
-- ED10 explicitly rejected it: no demonstrated Storage-corruption
-- risk anywhere in this pipeline's existing usage to justify it.
--
-- NOT NULL per ED3's locked wording exactly ("mime_type text not
-- null" / "size_bytes integer not null", using bigint here as the
-- appropriately-sized integer type for a file size). No backfill
-- concern: `export_files` has zero rows today (Export generation is
-- not implemented until a later phase step), so a `not null` column
-- can be added directly with no default needed for existing data.

alter table export_files
  add column mime_type text not null,
  add column size_bytes bigint not null;
