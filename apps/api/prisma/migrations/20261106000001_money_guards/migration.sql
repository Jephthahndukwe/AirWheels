-- Money guards enforced by Postgres itself, so no code path can bypass them.

-- 1. Quotes are unchangeable snapshots (PRC-02). The only allowed change is setting lockedAt once.
CREATE OR REPLACE FUNCTION aw_quote_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Quote % is an immutable snapshot and cannot be deleted', OLD.id;
  END IF;
  IF NEW."breakdown" IS DISTINCT FROM OLD."breakdown"
     OR NEW."request" IS DISTINCT FROM OLD."request"
     OR NEW."totalKobo" IS DISTINCT FROM OLD."totalKobo"
     OR NEW."marginKobo" IS DISTINCT FROM OLD."marginKobo"
     OR NEW."flagged" IS DISTINCT FROM OLD."flagged"
     OR NEW."pricingRuleVersion" IS DISTINCT FROM OLD."pricingRuleVersion"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."airlineId" IS DISTINCT FROM OLD."airlineId"
     OR NEW."channel" IS DISTINCT FROM OLD."channel"
     OR (OLD."lockedAt" IS NOT NULL AND NEW."lockedAt" IS DISTINCT FROM OLD."lockedAt") THEN
    RAISE EXCEPTION 'Quote % is an immutable snapshot', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quote_immutable BEFORE UPDATE OR DELETE ON "Quote"
  FOR EACH ROW EXECUTE FUNCTION aw_quote_immutable();

-- 2. The ledger is append-only (PAY-03).
CREATE OR REPLACE FUNCTION aw_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entry_append_only BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION aw_append_only();
CREATE TRIGGER ledger_transaction_append_only BEFORE UPDATE OR DELETE ON "LedgerTransaction"
  FOR EACH ROW EXECUTE FUNCTION aw_append_only();

-- 3. Every ledger transaction balances: checked at commit, so all its lines can be inserted first.
CREATE OR REPLACE FUNCTION aw_ledger_balanced() RETURNS trigger AS $$
DECLARE
  debits  numeric;
  credits numeric;
  bad     integer;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN "amountKobo" ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN "amountKobo" ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE "amountKobo" <= 0)
  INTO debits, credits, bad
  FROM "LedgerEntry" WHERE "transactionId" = NEW."transactionId";
  IF bad > 0 THEN
    RAISE EXCEPTION 'Ledger transaction % has a zero or negative line', NEW."transactionId";
  END IF;
  IF debits <> credits THEN
    RAISE EXCEPTION 'Ledger transaction % does not balance: debits % <> credits %', NEW."transactionId", debits, credits;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON "LedgerEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION aw_ledger_balanced();
