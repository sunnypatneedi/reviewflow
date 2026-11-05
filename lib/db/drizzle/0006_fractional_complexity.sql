-- Preserve historical ReviewFlow 1..5 values while accepting fractional Jev scores.
ALTER TABLE "rf_proposals" ALTER COLUMN "complexity" TYPE real USING "complexity"::real;
