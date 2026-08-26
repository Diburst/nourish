-- Selectable pastel accent theme per user.
ALTER TABLE "User" ADD COLUMN "theme" TEXT NOT NULL DEFAULT 'neutral';
