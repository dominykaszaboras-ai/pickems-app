-- Unordered-pair uniqueness for Friendship.
--
-- The Prisma @@unique([requesterId, receiverId]) constraint only blocks
-- duplicates in the SAME direction. Mutual concurrent adds (A→B and B→A
-- within ms of each other) would otherwise produce two PENDING rows for
-- the same logical pair. This expression index enforces "one Friendship
-- per unordered pair" at the storage layer so the race is impossible.
--
-- Project uses `prisma db push` (no migrations folder), so apply this
-- once via:
--   DATABASE_URL=... npx prisma db execute --schema prisma/schema.prisma \
--     --file prisma/manual-sql/friendship_pair_unique.sql
--
-- Safe to re-run: IF NOT EXISTS.

CREATE UNIQUE INDEX IF NOT EXISTS friendship_pair_unique
  ON "Friendship" (
    LEAST("requesterId", "receiverId"),
    GREATEST("requesterId", "receiverId")
  );
