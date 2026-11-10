-- Reuse existing skill IDs when replacing the old volleyball category names.
-- If a canonical category already exists, keep the legacy row only for history.
DO $$
DECLARE alias RECORD;
BEGIN
  FOR alias IN
    SELECT * FROM (VALUES ('bump', 'passing'), ('set', 'setting'), ('spike', 'attack'),
                          ('attacking', 'attack'), ('serve', 'serving')) AS names(old_slug, new_slug)
  LOOP
    UPDATE "Skill" AS skill
    SET slug = alias.new_slug, "updatedAt" = CURRENT_TIMESTAMP
    FROM "Sport" AS sport
    WHERE skill."sportId" = sport.id
      AND sport.slug IN ('volleyball', 'beach-volleyball')
      AND skill.slug = alias.old_slug
      AND NOT EXISTS (
        SELECT 1 FROM "Skill" AS existing
        WHERE existing."sportId" = skill."sportId" AND existing.slug = alias.new_slug
      );
  END LOOP;
END $$;

INSERT INTO "Skill" (id, "sportId", name, slug, description, "requiredForSelfAssessment", active, "createdAt", "updatedAt")
SELECT gen_random_uuid(), sport.id, category.name, category.slug, category.description,
       NOT (sport.slug = 'volleyball' AND category.slug = 'serving'), true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Sport" AS sport
CROSS JOIN (VALUES
  ('Attack', 'attack', 'How effectively the player chooses and executes hits, shots, and placements to challenge the opposing defense.'),
  ('Defense', 'defense', 'How effectively the player reads attacks, positions themselves, and uses digs or blocks to keep the ball in play.'),
  ('Passing', 'passing', 'How consistently the player controls serve reception and directs the first touch toward a teammate for a playable next contact.'),
  ('Setting', 'setting', 'How consistently the player delivers an accurate, controlled set that gives a teammate a useful attacking opportunity.'),
  ('Serving', 'serving', 'How consistently the player serves accurately and uses placement, pace, or spin to pressure the opponent.')
) AS category(name, slug, description)
WHERE sport.slug IN ('volleyball', 'beach-volleyball')
ON CONFLICT ("sportId", slug) DO UPDATE
SET name = EXCLUDED.name, active = true,
    description = COALESCE(NULLIF("Skill".description, ''), EXCLUDED.description),
    "updatedAt" = CURRENT_TIMESTAMP;

-- Old categories remain available to historical ratings but cannot be selected.
UPDATE "Skill" AS skill
SET active = false, "updatedAt" = CURRENT_TIMESTAMP
FROM "Sport" AS sport
WHERE skill."sportId" = sport.id
  AND sport.slug IN ('volleyball', 'beach-volleyball')
  AND skill.slug NOT IN ('attack', 'defense', 'passing', 'setting', 'serving');
